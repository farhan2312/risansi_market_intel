'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Admin access required');
  }
  return session!;
}

function deriveInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 3) || 'R';
}

export async function createRep(formData: FormData) {
  await requireAdmin();

  const name     = (formData.get('name')     as string | null)?.trim() ?? '';
  const repCode  = (formData.get('rep_code') as string | null)?.trim() || null;
  const email    = (formData.get('email')    as string | null)?.trim().toLowerCase() || null;
  const zone     = (formData.get('zone')     as string | null)?.trim() || null;
  const route    = (formData.get('route')    as string | null)?.trim() || null;
  const role     = (formData.get('role')     as string | null)?.trim() || 'rep';
  const targetCr = formData.get('target_cr') ? parseFloat(formData.get('target_cr') as string) : null;
  const initials = (formData.get('initials') as string | null)?.trim() || deriveInitials(name);

  if (!name)  throw new Error('Name is required');
  if (!email) throw new Error('Email is required');

  const existing = await risansiPool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length > 0) {
    throw new Error(`A user with email "${email}" already exists`);
  }

  await risansiPool.query(
    `INSERT INTO users
       (rep_code, name, initials, email, zone, route, target_cr, role, status, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Approved',TRUE,NOW(),NOW())`,
    [repCode, name, initials, email, zone, route, targetCr, role],
  );

  revalidatePath('/risansi/admin/reps');
}

export async function updateRep(repId: number, formData: FormData) {
  await requireAdmin();

  const name     = (formData.get('name')  as string | null)?.trim() ?? '';
  const zone     = (formData.get('zone')  as string | null)?.trim() || null;
  const route    = (formData.get('route') as string | null)?.trim() || null;
  const email    = (formData.get('email') as string | null)?.trim().toLowerCase() || null;
  const role     = (formData.get('role')  as string | null)?.trim() || 'rep';
  const targetCr = formData.get('target_cr') ? parseFloat(formData.get('target_cr') as string) : null;
  const isActive = formData.get('is_active') === 'true';

  if (!name) throw new Error('Name is required');

  await risansiPool.query(
    `UPDATE users SET
       name = $1, zone = $2, route = $3, email = $4,
       target_cr = $5, is_active = $6, role = $7, updated_at = NOW()
     WHERE id = $8`,
    [name, zone, route, email, targetCr, isActive, role, repId],
  );

  revalidatePath('/risansi/admin/reps');
}

export async function updateRouteRep(routeId: number, repId: number | null) {
  await requireAdmin();
  await risansiPool.query('UPDATE tour_routes SET primary_rep_id = $1 WHERE id = $2', [repId, routeId]);
  revalidatePath('/risansi/admin/reps');
}

export async function createTour(formData: FormData) {
  await requireAdmin();

  const name            = (formData.get('name') as string | null)?.trim() ?? '';
  const zone            = (formData.get('zone') as string | null)?.trim() ?? '';
  const primaryRepId    = formData.get('primary_rep_id') ? parseInt(formData.get('primary_rep_id') as string, 10) : null;
  const visitFreqKey    = formData.get('visit_freq_key_days') ? parseInt(formData.get('visit_freq_key_days') as string, 10) : 90;
  const visitFreqStd    = formData.get('visit_freq_std_days') ? parseInt(formData.get('visit_freq_std_days') as string, 10) : 180;
  const alertKey        = formData.get('alert_key_days') ? parseInt(formData.get('alert_key_days') as string, 10) : 100;
  const alertStd        = formData.get('alert_std_days') ? parseInt(formData.get('alert_std_days') as string, 10) : 200;

  if (!name) {
    throw new Error('Tour name is required');
  }
  if (!zone) {
    throw new Error('Zone is required');
  }

  const existing = await risansiPool.query('SELECT id FROM tour_routes WHERE LOWER(name) = LOWER($1)', [name]);
  if (existing.rows.length > 0) {
    throw new Error(`Tour "${name}" already exists`);
  }

  await risansiPool.query(
    `INSERT INTO tour_routes
       (name, zone, primary_rep_id, visit_freq_key_days, visit_freq_std_days, alert_key_days, alert_std_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [name, zone, primaryRepId, visitFreqKey, visitFreqStd, alertKey, alertStd],
  );

  revalidatePath('/risansi/admin/reps');
}
