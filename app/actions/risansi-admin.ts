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

  try {
    await risansiPool.query(
      `UPDATE access_requests
       SET status = 'Approved', reviewed_at = NOW(), reviewed_by = $2
       WHERE user_email = $1`,
      [email, admin.email],
    );
  } catch {
    // reviewed_at / reviewed_by columns may not exist yet — fall back
    await risansiPool.query(
      `UPDATE access_requests SET status = 'Approved' WHERE user_email = $1`,
      [email],
    );
  }

  await logActivity('access_request', email, 'approved', admin.email!);
  revalidatePath('/risansi/admin');
}

// ── Reject a pending access request ───────────────────────────

export async function rejectAccessRequest(formData: FormData) {
  const admin = await requireAdmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  try {
    await risansiPool.query(
      `UPDATE access_requests
       SET status = 'Rejected', reviewed_at = NOW(), reviewed_by = $2
       WHERE user_email = $1`,
      [email, admin.email],
    );
  } catch {
    await risansiPool.query(
      `UPDATE access_requests SET status = 'Rejected' WHERE user_email = $1`,
      [email],
    );
  }

  await logActivity('access_request', email, 'rejected', admin.email!);
  revalidatePath('/risansi/admin');
}

// ── Revoke an approved user's access ──────────────────────────

export async function revokeAccess(formData: FormData) {
  const admin = await requireAdmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  try {
    await risansiPool.query(
      `UPDATE access_requests
       SET status = 'Revoked', reviewed_at = NOW(), reviewed_by = $2
       WHERE user_email = $1`,
      [email, admin.email],
    );
  } catch {
    await risansiPool.query(
      `UPDATE access_requests SET status = 'Revoked' WHERE user_email = $1`,
      [email],
    );
  }

  await logActivity('access_request', email, 'revoked', admin.email!);
  revalidatePath('/risansi/admin');
}
