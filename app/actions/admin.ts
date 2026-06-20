'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';

const VALID_ROLES = ['rep', 'manager', 'admin', 'sysadmin'];

// Access-approval / user creation is now a System Admin (sysadmin) capability.
async function requireSysadmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const role = session.user.role ?? '';
  if (role !== 'sysadmin') redirect('/api/auth/signin');
  return session.user;
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
  const admin    = await requireSysadmin();
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

// ── resetUserPassword ──────────────────────────────────────────
// Sysadmin sets a temporary password for a user and forces a change at next
// login (must_change_password = true). The temp password is communicated to
// the user out of band; on next sign-in the layout routes them to
// /change-password, where they enter the temp value as their "current"
// password and pick a new one.
export async function resetUserPassword(formData: FormData) {
  const admin = await requireSysadmin();
  const id    = parseInt(formData.get('id') as string, 10);
  const tempPw = (formData.get('temp_password') as string | null) ?? '';

  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid user id');
  if (typeof tempPw !== 'string' || tempPw.length < 8) {
    throw new Error('Temporary password must be at least 8 characters');
  }

  const { rows } = await risansiPool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('User not found');

  // Cost factor 10 to match signup / change-password.
  const hash = await bcrypt.hash(tempPw, 10);
  await risansiPool.query(
    `UPDATE users SET password_hash = $1, must_change_password = true, updated_at = NOW() WHERE id = $2`,
    [hash, id],
  );

  await recordAudit({
    action: 'password_reset', entityType: 'user', entityId: id, entityLabel: rows[0].email,
    summary: `Reset password for ${rows[0].email} (forced change at next login)`,
    actorEmail: admin.email ?? null, actorRole: 'sysadmin',
  });

  revalidatePath('/admin');
}

export async function rejectUser(formData: FormData) {
  await requireSysadmin();
  const id = parseInt(formData.get('id') as string); // users.id

  await risansiPool.query(
    `UPDATE users SET status = 'Rejected', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  revalidatePath('/admin');
}

export async function revokeUser(formData: FormData) {
  await requireSysadmin();
  const id = parseInt(formData.get('id') as string); // users.id

  // No 'Revoked' status in the CHECK constraint — use 'Rejected'.
  await risansiPool.query(
    `UPDATE users SET status = 'Rejected', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  revalidatePath('/admin');
}

export async function reapproveUser(formData: FormData) {
  await requireSysadmin();
  const id       = parseInt(formData.get('id') as string); // users.id
  const role     = formData.get('role') as string;
  const safeRole = VALID_ROLES.includes(role) ? role : 'rep';

  await risansiPool.query(
    `UPDATE users SET status = 'Approved', role = $1, updated_at = NOW() WHERE id = $2`,
    [safeRole, id],
  );
  revalidatePath('/admin');
}
