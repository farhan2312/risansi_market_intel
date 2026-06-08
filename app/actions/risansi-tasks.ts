'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

async function requireEmail(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  return session.user.email;
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
