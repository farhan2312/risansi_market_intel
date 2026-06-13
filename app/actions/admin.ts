'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

const VALID_ROLES = ['rep', 'manager', 'admin', 'sysadmin'];

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const role = session.user.role ?? '';
  if (!hasRole(role, 'admin')) redirect('/api/auth/signin');
  return session.user;
}

function deriveInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 3) || 'R';
}

async function auditTourAssignment(userId: number, adminEmail: string | null | undefined) {
  try {
    await risansiPool.query(
      `INSERT INTO assignment_audit (entity_type, entity_id, action, changed_by, changed_at)
       VALUES ('tour_assignment', $1, 'update', $2, NOW())`,
      [userId, adminEmail ?? null],
    );
  } catch { /* best-effort */ }
}

export async function approveUser(formData: FormData) {
  const admin    = await requireAdmin();
  const id       = parseInt(formData.get('id') as string); // users.id
  const role     = formData.get('role') as string;
  const safeRole = VALID_ROLES.includes(role) ? role : 'rep';

  // Only rep & manager roles receive tour assignments.
  // (tour_assignments.role has a CHECK constraint allowing only 'rep'|'manager'.)
  const linksRep = safeRole === 'rep' || safeRole === 'manager';

  // The user record IS the person now — just flip status + role.
  await risansiPool.query(
    `UPDATE users SET
       status     = 'Approved',
       role       = $1,
       updated_at = NOW()
     WHERE id = $2`,
    [safeRole, id],
  );

  // Assign tours. The role stored on each assignment mirrors the user's role
  // ('rep' or 'manager'). Idempotent via the (tour_id, rep_id) unique key.
  const tourIds = formData.getAll('tour_ids[]')
    .map(v => parseInt(v as string, 10))
    .filter(n => !isNaN(n));

  if (linksRep && tourIds.length > 0) {
    for (const tourId of tourIds) {
      try {
        await risansiPool.query(
          `INSERT INTO tour_assignments (tour_id, rep_id, role, assigned_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tour_id, rep_id) DO UPDATE SET
             role        = EXCLUDED.role,
             assigned_by = EXCLUDED.assigned_by`,
          [tourId, id, safeRole, admin.email],
        );
      } catch { /* skip a bad tour id, keep the rest */ }
    }
    await auditTourAssignment(id, admin.email);
  }

  revalidatePath('/admin');
  revalidatePath('/risansi/admin/reps');
}

// Create a new user row directly (e.g. when an admin adds someone manually).
// Returns the new id. Email is the key.
export async function createRepFromApproval(formData: FormData): Promise<number> {
  await requireAdmin();

  const name  = (formData.get('name')  as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim().toLowerCase() || null;
  if (!email) throw new Error('Email is required');
  if (!name)  throw new Error('Name is required');

  const initials = deriveInitials(name);

  const result = await risansiPool.query<{ id: number }>(
    `INSERT INTO users
       (email, name, initials, zone, route, target_cr, role, status, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'rep','Approved',TRUE,NOW(),NOW())
     RETURNING id`,
    [
      email, name, initials,
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
  await requireAdmin();
  const id = parseInt(formData.get('id') as string); // users.id

  await risansiPool.query(
    `UPDATE users SET status = 'Rejected', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  revalidatePath('/admin');
}

export async function revokeUser(formData: FormData) {
  await requireAdmin();
  const id = parseInt(formData.get('id') as string); // users.id

  // No 'Revoked' status in the CHECK constraint — use 'Rejected'.
  await risansiPool.query(
    `UPDATE users SET status = 'Rejected', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  revalidatePath('/admin');
}

export async function reapproveUser(formData: FormData) {
  await requireAdmin();
  const id       = parseInt(formData.get('id') as string); // users.id
  const role     = formData.get('role') as string;
  const safeRole = VALID_ROLES.includes(role) ? role : 'rep';

  await risansiPool.query(
    `UPDATE users SET status = 'Approved', role = $1, updated_at = NOW() WHERE id = $2`,
    [safeRole, id],
  );
  revalidatePath('/admin');
}
