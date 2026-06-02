'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

const VALID_ROLES = ['rep', 'manager', 'admin'];

async function isSysAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  const adminEmails = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? 'admin@risansi.com')
    .split(',').map(e => e.trim().toLowerCase());
  return adminEmails.includes(session?.user?.email?.toLowerCase() ?? '');
}

async function requireSysAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  if (!await isSysAdmin()) redirect('/api/auth/signin');
  return session.user;
}

export async function approveUser(formData: FormData) {
  const admin = await requireSysAdmin();
  const id    = parseInt(formData.get('id') as string);
  const role  = formData.get('role') as string;
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

export async function rejectUser(formData: FormData) {
  const admin = await requireSysAdmin();
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
  const admin = await requireSysAdmin();
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
  const admin = await requireSysAdmin();
  const id    = parseInt(formData.get('id') as string);
  const role  = formData.get('role') as string;
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
