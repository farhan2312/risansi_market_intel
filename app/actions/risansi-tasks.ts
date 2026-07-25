'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { notifyActionAssigned } from '@/lib/risansi-email';

async function requireEmail(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  return session.user.email;
}

// Email the assignee when a new action is recorded for them — but only if they
// are a user in the system (assigned_to_rep) with an email, and not the person
// who created it. Best-effort: any failure is logged and swallowed so it can
// never break task creation.
async function notifyAssignee(opts: {
  assignedToRep: number; creatorEmail: string; clientId: number;
  title: string; description?: string | null; dueDate?: string | null; priority?: string | null;
}) {
  try {
    const assignee = (await risansiPool.query<{ id: number; name: string | null; email: string | null }>(
      'SELECT id, name, email FROM users WHERE id = $1', [opts.assignedToRep],
    )).rows[0];
    if (!assignee?.email) return;
    if (assignee.email.toLowerCase() === opts.creatorEmail.toLowerCase()) return;  // don't self-notify

    const [creatorRes, clientRes] = await Promise.all([
      risansiPool.query<{ name: string | null }>('SELECT name FROM users WHERE email = $1', [opts.creatorEmail]),
      risansiPool.query<{ legal_name: string | null }>('SELECT legal_name FROM clients WHERE id = $1', [opts.clientId]),
    ]);

    await notifyActionAssigned({
      to: assignee.email,
      toName: assignee.name,
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
}: {
  visitId: number;
  clientId: number;
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: string;
  assignedToRep?: number | null;
  assignedToExternal?: string | null;
}) {
  const email = await requireEmail();

  if (!title.trim()) throw new Error('Title is required');

  await risansiPool.query(
    `INSERT INTO tasks (
       visit_id, client_id, assigned_to_rep, assigned_to_external,
       title, description, due_date, priority, status,
       created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, NOW(), NOW())`,
    [
      visitId,
      clientId,
      assignedToRep ?? null,
      assignedToExternal?.trim() || null,
      title.trim(),
      description?.trim() || null,
      dueDate || null,
      priority ?? 'Medium',
      email,
    ],
  );

  revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath('/risansi');
  revalidatePath('/risansi/field');

  // Notify the assignee by email (only for in-system reps; best-effort).
  if (assignedToRep) {
    await notifyAssignee({
      assignedToRep,
      creatorEmail: email,
      clientId,
      title: title.trim(),
      description: description?.trim() || null,
      dueDate: dueDate || null,
      priority: priority ?? 'Medium',
    });
  }
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
