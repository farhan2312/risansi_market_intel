'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Reps & Tours management is a System Admin (sysadmin) capability.
async function requireSysadmin() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'sysadmin') {
    throw new Error('System admin access required');
  }
  return session!;
}

function deriveInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 3) || 'R';
}

export async function createRep(formData: FormData) {
  const session = await requireSysadmin();

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

  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO users
       (rep_code, name, initials, email, zone, route, target_cr, role, status, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Approved',TRUE,NOW(),NOW())
     RETURNING id`,
    [repCode, name, initials, email, zone, route, targetCr, role],
  );
  const newUserId = rows[0].id;

  // Optionally assign the new rep/manager to tours in the same step (capability 1).
  const tourIds = (() => {
    try {
      const arr = JSON.parse((formData.get('tour_ids') as string) || '[]');
      return Array.isArray(arr) ? arr.map(n => parseInt(String(n), 10)).filter(Number.isInteger) : [];
    } catch { return []; }
  })();
  if ((role === 'rep' || role === 'manager') && tourIds.length > 0) {
    for (const tid of tourIds) {
      await risansiPool.query(
        `INSERT INTO tour_assignments (tour_id, rep_id, role, assigned_by, assigned_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [tid, newUserId, role, session.user?.email ?? null],
      );
    }
  }

  revalidatePath('/risansi/admin/reps');
  revalidatePath('/risansi/admin/tours');
}

export async function updateRep(repId: number, formData: FormData) {
  await requireSysadmin();

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

export async function createTour(formData: FormData) {
  await requireSysadmin();

  const name            = (formData.get('name') as string | null)?.trim() ?? '';
  const zone            = (formData.get('zone') as string | null)?.trim() ?? '';
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
       (name, zone, visit_freq_key_days, visit_freq_std_days, alert_key_days, alert_std_days)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, zone, visitFreqKey, visitFreqStd, alertKey, alertStd],
  );

  revalidatePath('/risansi/admin/reps');
}
