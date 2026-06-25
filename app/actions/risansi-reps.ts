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

  if (!Number.isInteger(repId) || repId <= 0) throw new Error('Invalid user id');

  // Only update the columns that were actually submitted. The Reps & Managers
  // inline editor submits a subset (name, zone, route, status) and must NOT
  // clobber account fields it doesn't show — email, role and target are owned
  // by Users & Access. (A form that omits `role` previously reset it to 'rep',
  // silently downgrading managers.)
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if (formData.has('name')) {
    const name = (formData.get('name') as string).trim();
    if (!name) throw new Error('Name is required');
    set('name', name);
  }
  if (formData.has('zone'))     set('zone',     (formData.get('zone')     as string).trim() || null);
  if (formData.has('route'))    set('route',    (formData.get('route')    as string).trim() || null);
  if (formData.has('rep_code')) set('rep_code', (formData.get('rep_code') as string).trim() || null);
  if (formData.has('email'))    set('email',    (formData.get('email')    as string).trim().toLowerCase() || null);
  if (formData.has('role'))     set('role',     (formData.get('role')     as string).trim() || 'rep');
  if (formData.has('target_cr')) {
    const raw = (formData.get('target_cr') as string).trim();
    const n = parseFloat(raw);
    set('target_cr', raw && Number.isFinite(n) ? n : null);
  }
  if (formData.has('is_active')) {
    // Hidden 'false' + checkbox 'true' both submit when checked; the last wins.
    // A lone <select> or hidden input submits a single value.
    const all = formData.getAll('is_active');
    set('is_active', all[all.length - 1] === 'true');
  }

  if (sets.length === 0) return;

  vals.push(repId);
  await risansiPool.query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
    vals,
  );

  revalidatePath('/risansi/admin/reps');
  revalidatePath('/admin');
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

// Delete a tour. Its clients are unassigned (tour_id → NULL) and its
// rep/manager assignments removed first, in one transaction.
export async function deleteTour(formData: FormData) {
  await requireSysadmin();

  const id = parseInt(formData.get('id') as string, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid tour');

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE clients SET tour_id = NULL, updated_at = NOW() WHERE tour_id = $1', [id]);
    await client.query('DELETE FROM tour_assignments WHERE tour_id = $1', [id]);
    await client.query('DELETE FROM tour_routes WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  revalidatePath('/risansi/admin/reps');
  revalidatePath('/risansi/clients');
}
