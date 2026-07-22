'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { isBugStatus } from '@/lib/risansi-bugs';

// Resolve (and authorise) the acting system admin, returning their display name
// for the recorded_by / resolved_by stamps. Throws if the caller isn't a sysadmin.
async function requireSysadminName(): Promise<string> {
  const user = await getCurrentUser();
  if (!hasRole(user.role, 'sysadmin')) throw new Error('Only the system admin can manage bugs.');
  const u = (await risansiPool.query<{ name: string | null; email: string | null }>(
    'SELECT name, email FROM users WHERE id = $1', [user.id],
  )).rows[0];
  return u?.name || user.email || 'System Admin';
}

// Move a bug along the pipeline. Stamps recorded_* the first time it leaves
// "reported", and resolved_* when it reaches "fixed" (cleared if it moves back
// out, so turnaround never reflects a fix that was reopened).
export async function updateBugStatus(bugId: number, status: string) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  if (!isBugStatus(status)) throw new Error('Invalid status.');
  const name = await requireSysadminName();

  const cur = (await risansiPool.query<{ status: string; recorded_at: string | null; resolved_at: string | null }>(
    'SELECT status, recorded_at, resolved_at FROM bugs WHERE id = $1', [bugId],
  )).rows[0];
  if (!cur) throw new Error('Bug not found.');

  const sets: string[] = ['status = $2', 'updated_at = now()'];
  const vals: (string | number)[] = [bugId, status];
  let idx = 3;

  if (status !== 'reported' && !cur.recorded_at) {
    sets.push(`recorded_by = $${idx++}`, 'recorded_at = now()');
    vals.push(name);
  }
  if (status === 'fixed' && !cur.resolved_at) {
    sets.push(`resolved_by = $${idx++}`, 'resolved_at = now()');
    vals.push(name);
  } else if (status !== 'fixed' && cur.resolved_at) {
    sets.push('resolved_by = NULL', 'resolved_at = NULL');
  }

  await risansiPool.query(`UPDATE bugs SET ${sets.join(', ')} WHERE id = $1`, vals);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}

// Edit a bug's severity (triage) — sysadmin only.
export async function updateBugSeverity(bugId: number, severity: string) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  if (!['low', 'medium', 'high'].includes(severity)) throw new Error('Invalid severity.');
  await requireSysadminName();
  await risansiPool.query('UPDATE bugs SET severity = $2, updated_at = now() WHERE id = $1', [bugId, severity]);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}

// Delete a bug (and its screenshot, via ON DELETE CASCADE) — sysadmin only.
export async function deleteBug(bugId: number) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  await requireSysadminName();
  await risansiPool.query('DELETE FROM bugs WHERE id = $1', [bugId]);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}
