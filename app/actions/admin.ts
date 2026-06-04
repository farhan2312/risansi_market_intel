'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

const VALID_ROLES = ['rep', 'manager', 'admin'];

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const role = session.user.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/api/auth/signin');
  return session.user;
}

export async function approveUser(formData: FormData) {
  const admin    = await requireAdmin();
  const id       = parseInt(formData.get('id') as string);
  const role     = formData.get('role') as string;
  const safeRole = VALID_ROLES.includes(role) ? role : 'rep';
  const repId    = formData.get('rep_id') ? parseInt(formData.get('rep_id') as string) : null;

  // Resolve the user's email so we can link it to the reps table
  let userEmail: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ user_email: string }>(
      'SELECT user_email FROM access_requests WHERE id = $1', [id],
    );
    userEmail = rows[0]?.user_email ?? null;
  } catch { /* ignore */ }

  // Approve — include rep_id. If the column doesn't exist yet, retry without it
  // so approval still works before the migration is run.
  try {
    await risansiPool.query(
      `UPDATE access_requests SET
         status        = 'Approved',
         role          = $1,
         approved_role = $1,
         rep_id        = $2,
         reviewed_at   = NOW(),
         reviewed_by   = $3
       WHERE id = $4`,
      [safeRole, safeRole === 'rep' ? repId : null, admin.email, id],
    );
  } catch {
    await risansiPool.query(
      `UPDATE access_requests SET
         status        = 'Approved',
         role          = $1,
         approved_role = $1,
         reviewed_at   = NOW(),
         reviewed_by   = $2
       WHERE id = $3`,
      [safeRole, admin.email, id],
    );
  }

  // Link the approved rep's login email onto the reps row
  if (safeRole === 'rep' && repId && userEmail) {
    try {
      await risansiPool.query(
        'UPDATE reps SET email = $1, updated_at = NOW() WHERE id = $2',
        [userEmail, repId],
      );
    } catch { /* ignore */ }
  }

  revalidatePath('/admin');
  revalidatePath('/risansi/admin/reps');
}

// Create a rep on the fly while approving an access request. Returns the new id.
export async function createRepFromApproval(formData: FormData): Promise<number> {
  await requireAdmin();

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name) throw new Error('Name is required');

  const parts   = name.toLowerCase().split(/\s+/);
  const base    = 'r-' + (parts[0]?.slice(0, 4) ?? 'rep') + '-' + (parts[1]?.slice(0, 4) ?? '000');
  const existing = await risansiPool.query('SELECT id FROM reps WHERE rep_code = $1', [base]);
  const finalCode = existing.rows.length > 0 ? `${base}-${Date.now().toString().slice(-3)}` : base;

  const initials = name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 3) || 'R';

  const result = await risansiPool.query<{ id: number }>(
    `INSERT INTO reps
       (rep_code, name, initials, zone, route, target_cr, role, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'rep',TRUE,NOW(),NOW())
     RETURNING id`,
    [
      finalCode, name, initials,
      (formData.get('zone') as string | null)?.trim() || null,
      (formData.get('route') as string | null)?.trim() || null,
      formData.get('target_cr') ? parseFloat(formData.get('target_cr') as string) : null,
    ],
  );

  revalidatePath('/admin');
  revalidatePath('/risansi/admin/reps');
  return result.rows[0].id;
}

export async function rejectUser(formData: FormData) {
  const admin = await requireAdmin();
  const id    = parseInt(formData.get('id') as string);

  await risansiPool.query(
    `UPDATE access_requests SET
       status      = 'Rejected',
       reviewed_at = NOW(),
       reviewed_by = $1
     WHERE id = $2`,
    [admin.email, id],
  );
  revalidatePath('/admin');
}

export async function revokeUser(formData: FormData) {
  const admin = await requireAdmin();
  const id    = parseInt(formData.get('id') as string);

  await risansiPool.query(
    `UPDATE access_requests SET
       status      = 'Revoked',
       reviewed_at = NOW(),
       reviewed_by = $1
     WHERE id = $2`,
    [admin.email, id],
  );
  revalidatePath('/admin');
}

export async function reapproveUser(formData: FormData) {
  const admin    = await requireAdmin();
  const id       = parseInt(formData.get('id') as string);
  const role     = formData.get('role') as string;
  const safeRole = VALID_ROLES.includes(role) ? role : 'rep';

  await risansiPool.query(
    `UPDATE access_requests SET
       status      = 'Approved',
       role        = $1,
       reviewed_at = NOW(),
       reviewed_by = $2
     WHERE id = $3`,
    [safeRole, admin.email, id],
  );
  revalidatePath('/admin');
}
