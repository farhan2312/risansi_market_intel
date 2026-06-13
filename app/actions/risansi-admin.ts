'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const role = session.user.role ?? '';
  if (!hasRole(role, 'admin')) redirect('/risansi');
  return session.user;
}

async function logActivity(entity: string, id: string, action: string, email: string) {
  try {
    await risansiPool.query(
      `INSERT INTO risansi_activity_log (entity_type, entity_id, action, email, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [entity, id, action, email],
    );
  } catch { /* non-critical */ }
}

// ── Approve a pending access request ──────────────────────────

export async function approveAccessRequest(formData: FormData) {
  const admin = await requireAdmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  await risansiPool.query(
    `UPDATE users
     SET status = 'Approved', updated_at = NOW()
     WHERE lower(email) = lower($1)`,
    [email],
  );

  await logActivity('access_request', email, 'approved', admin.email!);
  revalidatePath('/risansi/admin');
}

// ── Reject a pending access request ───────────────────────────

export async function rejectAccessRequest(formData: FormData) {
  const admin = await requireAdmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  await risansiPool.query(
    `UPDATE users
     SET status = 'Rejected', updated_at = NOW()
     WHERE lower(email) = lower($1)`,
    [email],
  );

  await logActivity('access_request', email, 'rejected', admin.email!);
  revalidatePath('/risansi/admin');
}

// ── Revoke an approved user's access ──────────────────────────

export async function revokeAccess(formData: FormData) {
  const admin = await requireAdmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  // No 'Revoked' status in the CHECK constraint — use 'Rejected'.
  await risansiPool.query(
    `UPDATE users
     SET status = 'Rejected', updated_at = NOW()
     WHERE lower(email) = lower($1)`,
    [email],
  );

  await logActivity('access_request', email, 'revoked', admin.email!);
  revalidatePath('/risansi/admin');
}
