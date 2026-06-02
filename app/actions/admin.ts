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
  revalidatePath('/admin');
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
