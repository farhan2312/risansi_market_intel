'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient, hasRole, canEditVisitReport } from '@/lib/risansi-auth';
import { notifyActionAssigned } from '@/lib/risansi-email';
import { pushInApp } from '@/lib/risansi-inapp';

async function requireEmail(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  return session.user.email;
}

/**
 * May the current user change/delete this task? A session alone was the whole
 * check before, so any rep could complete or delete any team's tasks by id.
 * Allowed if: admin+, the task's creator, its assigned rep, or someone who can
 * see the task's client. Throws otherwise.
 */
async function assertCanManageTask(taskId: number): Promise<void> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<{ client_id: number | null; created_by: string | null; assigned_to_rep: number | null }>(
    'SELECT client_id, created_by, assigned_to_rep FROM tasks WHERE id = $1', [taskId],
  );
  const t = rows[0];
  if (!t) throw new Error('Task not found.');
  if (hasRole(user.role, 'admin')) return;
  if (user.email && t.created_by && t.created_by.toLowerCase() === user.email.toLowerCase()) return;
  if (user.id != null && t.assigned_to_rep != null && Number(t.assigned_to_rep) === Number(user.id)) return;
  if (t.client_id != null && await canViewClient(user, Number(t.client_id))) return;
  throw new Error('You do not have permission to change this task.');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Email whoever a new action was assigned to — the in-system rep (looked up by
// id) or an external person at the address captured with them. Best-effort: any
// failure is logged and swallowed so it can never break task creation.
async function notifyActionRecipient(opts: {
  creatorEmail: string; clientId: number;
  assignedToRep?: number | null; assignedToExternal?: string | null; assignedToExternalEmail?: string | null;
  title: string; description?: string | null; dueDate?: string | null; priority?: string | null;
}) {
  try {
    let to: string | null = null;
    let toName: string | null = null;

    if (opts.assignedToRep) {
      const rep = (await risansiPool.query<{ name: string | null; email: string | null }>(
        'SELECT name, email FROM users WHERE id = $1', [opts.assignedToRep],
      )).rows[0];
      if (!rep?.email) return;
      if (rep.email.toLowerCase() === opts.creatorEmail.toLowerCase()) return;  // don't self-notify
      to = rep.email; toName = rep.name;
    } else if (opts.assignedToExternal && opts.assignedToExternalEmail) {
      to = opts.assignedToExternalEmail; toName = opts.assignedToExternal;
    }
    if (!to) return;

    const [creatorRes, clientRes] = await Promise.all([
      risansiPool.query<{ name: string | null }>('SELECT name FROM users WHERE email = $1', [opts.creatorEmail]),
      risansiPool.query<{ legal_name: string | null }>('SELECT legal_name FROM clients WHERE id = $1', [opts.clientId]),
    ]);

    await notifyActionAssigned({
      to, toName,
      assignedBy: creatorRes.rows[0]?.name || opts.creatorEmail,
      title: opts.title,
      description: opts.description,
      clientName: clientRes.rows[0]?.legal_name,
      dueDate: opts.dueDate,
      priority: opts.priority,
    });
    // In-app row for an in-system assignee (external handlers get email only).
    if (opts.assignedToRep) {
      await pushInApp([opts.assignedToRep], {
        kind: 'action_assigned', section: 'Action Registry', actor: opts.creatorEmail,
        title: `New action: ${opts.title}`, body: opts.description ?? null,
        link: '/risansi/registry', entityType: 'client', entityId: String(opts.clientId),
      });
    }
  } catch (e) {
    console.error('[addTask] assignee notification failed', e);
  }
}

export async function addTask({
  visitId,
  clientId,
  title,
  description,
  dueDate,
  priority,
  assignedToRep,
  assignedToExternal,
  assignedToExternalEmail,
}: {
  visitId?: number | null;   // null when recorded standalone (e.g. from the Client 360 page)
  clientId: number;
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: string;
  assignedToRep?: number | null;
  assignedToExternal?: string | null;
  assignedToExternalEmail?: string | null;
}) {
  // Authorise: the caller must be able to see this client (admins/sysadmins always
  // can; reps only for clients they work). This also gates the outbound
  // external-assignee email so it can't be used to send from an arbitrary client.
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');

  // Tour membership is the usual test but not the only legitimate route in. Reps
  // routinely file visits for clients they do not own, and 1,279
  // clients carry no tour at all — for those, canViewClient is false for every
  // non-admin, so the rep filling in the report could not raise an action on it.
  // Whoever may fill in a visit report may also raise an action against it, so
  // fall back to the visit's own edit rule. The visit must actually belong to the
  // client being filed against, otherwise a caller could pair their own visit id
  // with somebody else's client id and write a task outside their scope.
  let allowed = await canViewClient(user, clientId);
  if (!allowed && visitId) {
    const { rows } = await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
      'SELECT rep_id, client_id FROM visits WHERE id = $1', [visitId],
    );
    const v = rows[0];
    if (v && v.client_id != null && Number(v.client_id) === Number(clientId)) {
      allowed = await canEditVisitReport({ role: user.role, repId: user.id }, v.rep_id);
    }
  }
  if (!allowed) {
    // Log it: Next redacts server-action error messages in production, so without
    // this a denial reaches the rep as an opaque "unexpected response" and leaves
    // no trace anywhere to diagnose it from.
    console.error('[addTask] denied', { user: user.email, role: user.role, clientId, visitId });
    throw new Error('You do not have access to this client.');
  }
  const email = user.email;

  if (!title.trim()) throw new Error('Title is required');

  const external      = assignedToExternal?.trim() || null;
  const externalEmail = assignedToExternalEmail?.trim() || null;

  // Somebody has to be doing it. Enforced here and not only in the form: the
  // form is one caller, and an action with nobody on it is invisible in the one
  // list people actually read — their own.
  if (!assignedToRep && !external) {
    throw new Error('Choose who is doing this — a rep in the system, or a named person outside it.');
  }

  // An external assignee (not in the system) must come with a valid email.
  if (external && !assignedToRep) {
    if (!externalEmail) throw new Error('An email is required for a person outside the system.');
    if (!EMAIL_RE.test(externalEmail)) throw new Error('Please enter a valid email for the external person.');
  }

  await risansiPool.query(
    `INSERT INTO tasks (
       visit_id, client_id, assigned_to_rep, assigned_to_external, assigned_to_external_email,
       title, description, due_date, priority, status,
       created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, NOW(), NOW())`,
    [
      visitId ?? null,
      clientId,
      assignedToRep ?? null,
      external,
      external ? externalEmail : null,
      title.trim(),
      description?.trim() || null,
      dueDate || null,
      priority ?? 'Medium',
      email,
    ],
  );

  if (visitId) revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
  revalidatePath(`/risansi/clients/${clientId}`);

  // Notify the assignee by email — in-system rep or external person (best-effort).
  await notifyActionRecipient({
    creatorEmail: email,
    clientId,
    assignedToRep: assignedToRep ?? null,
    assignedToExternal: external,
    assignedToExternalEmail: external ? externalEmail : null,
    title: title.trim(),
    description: description?.trim() || null,
    dueDate: dueDate || null,
    priority: priority ?? 'Medium',
  });
}

/**
 * Open or close an action.
 *
 * Closing requires a resolution note — what was actually done — and the note is
 * written once. If the action already carries one (it was closed, reopened and
 * is being closed again) the original stands and any note passed here is
 * ignored, so the record cannot be quietly rewritten after the fact.
 *
 * Reopening leaves the note alone rather than clearing it: it is the account of
 * a closure that genuinely happened, and erasing it would lose that history.
 */
export async function updateTaskStatus(
  taskId: number, status: 'open' | 'completed', resolutionNote?: string,
) {
  const email = await requireEmail();
  await assertCanManageTask(taskId);
  if (status !== 'open' && status !== 'completed') throw new Error('Invalid status.');

  const { rows } = await risansiPool.query<{ resolution_note: string | null }>(
    'SELECT resolution_note FROM tasks WHERE id = $1', [taskId],
  );
  if (!rows[0]) throw new Error('Action not found.');
  const existing = rows[0].resolution_note;

  const note = (resolutionNote ?? '').trim();
  if (status === 'completed' && !existing && !note) {
    throw new Error('Add a resolution note describing what was done before closing this action.');
  }

  await risansiPool.query(
    `UPDATE tasks
       SET status          = $1,
           completed_at    = $2,
           completed_by    = $3,
           -- COALESCE, so the first note written is the one that survives.
           resolution_note = COALESCE(resolution_note, $5),
           updated_at      = NOW()
     WHERE id = $4`,
    [
      status,
      status === 'completed' ? new Date() : null,
      status === 'completed' ? email : null,
      taskId,
      status === 'completed' && note ? note.slice(0, 2000) : null,
    ],
  );

  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/registry');
}

export async function deleteTask(taskId: number) {
  await requireEmail();
  await assertCanManageTask(taskId);

  const taskRes = await risansiPool.query<{ visit_id: number | null }>(
    'SELECT visit_id FROM tasks WHERE id = $1',
    [taskId],
  );
  const visitId = taskRes.rows[0]?.visit_id;

  await risansiPool.query('DELETE FROM tasks WHERE id = $1', [taskId]);

  if (visitId) revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
}
