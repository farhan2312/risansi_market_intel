'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import { notifyActionAssigned } from '@/lib/risansi-email';

async function requireEmail(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  return session.user.email;
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
  // can; reps only for clients on their tours). This also gates the outbound
  // external-assignee email so it can't be used to send from an arbitrary client.
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');
  if (!(await canViewClient(user, clientId))) {
    throw new Error('You do not have access to this client.');
  }
  const email = user.email;

  if (!title.trim()) throw new Error('Title is required');

  const external      = assignedToExternal?.trim() || null;
  const externalEmail = assignedToExternalEmail?.trim() || null;
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

export async function updateTaskStatus(taskId: number, status: 'open' | 'completed') {
  const email = await requireEmail();

  await risansiPool.query(
    `UPDATE tasks
       SET status       = $1,
           completed_at = $2,
           completed_by = $3,
           updated_at   = NOW()
     WHERE id = $4`,
    [
      status,
      status === 'completed' ? new Date() : null,
      status === 'completed' ? email : null,
      taskId,
    ],
  );

  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
}

export async function deleteTask(taskId: number) {
  await requireEmail();

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
