'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// ── Gate ───────────────────────────────────────────────────────
// Every action in this file is sysadmin-only. requireSysadmin throws on
// anything below the sysadmin tier, and returns the acting user's email
// (lowercased) for audit attribution.

async function requireSysadmin(): Promise<string> {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? '';
  if (role !== 'sysadmin') {
    throw new Error('Sysadmin access required');
  }
  return (session!.user.email ?? 'system').toLowerCase();
}

// ── Audit helper ───────────────────────────────────────────────
// Best-effort: a failed audit write must never break the actual mutation.

async function audit(
  entityType: string,
  entityId: string | number,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  changedBy: string,
): Promise<void> {
  try {
    await risansiPool.query(
      `INSERT INTO assignment_audit
         (entity_type, entity_id, action, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [
        entityType,
        String(entityId),
        action,
        oldValue == null ? null : JSON.stringify(oldValue),
        newValue == null ? null : JSON.stringify(newValue),
        changedBy,
      ],
    );
  } catch {
    /* audit is non-critical */
  }
}

function parseIntArray(raw: FormDataEntryValue | null): number[] {
  try {
    const parsed = JSON.parse((raw as string) || '[]');
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(n => parseInt(String(n), 10)).filter(n => Number.isInteger(n) && n > 0))]
      : [];
  } catch {
    return [];
  }
}

// ── deleteUser ─────────────────────────────────────────────────
// Removes a user. Guards against deleting someone who still owns clients,
// visits, or opportunities unless `force` is set. On delete we also clear
// their tour assignments (client_assignments cascades via the users FK).

export async function deleteUser(formData: FormData): Promise<void> {
  const actor = await requireSysadmin();
  const id = parseInt(formData.get('id') as string, 10);
  const force = formData.get('force') === 'true';

  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid user id');

  // Snapshot for audit + ownership guard.
  const { rows: userRows } = await risansiPool.query<{ email: string; name: string; role: string }>(
    'SELECT email, name, role FROM users WHERE id = $1',
    [id],
  );
  if (!userRows[0]) throw new Error('User not found');

  if (!force) {
    const { rows } = await risansiPool.query<{
      clients: string; visits: string; opps: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM client_assignments WHERE user_id = $1)::text AS clients,
         (SELECT COUNT(*) FROM visits        WHERE rep_id = $1)::text       AS visits,
         (SELECT COUNT(*) FROM opportunities WHERE rep_id = $1)::text       AS opps`,
      [id],
    );
    const clients = Number(rows[0]?.clients ?? 0);
    const visits  = Number(rows[0]?.visits ?? 0);
    const opps    = Number(rows[0]?.opps ?? 0);
    if (clients > 0 || visits > 0 || opps > 0) {
      const parts: string[] = [];
      if (clients) parts.push(`${clients} client${clients !== 1 ? 's' : ''}`);
      if (visits)  parts.push(`${visits} visit${visits !== 1 ? 's' : ''}`);
      if (opps)    parts.push(`${opps} opportunit${opps !== 1 ? 'ies' : 'y'}`);
      throw new Error(
        `Cannot delete — this user still owns ${parts.join(', ')}. Reassign them first, or use force delete.`,
      );
    }
  }

  // Tour assignments have no cascade on users delete — remove explicitly.
  await risansiPool.query('DELETE FROM tour_assignments WHERE rep_id = $1', [id]);
  // client_assignments cascades via the users FK (ON DELETE CASCADE).
  await risansiPool.query('DELETE FROM users WHERE id = $1', [id]);

  await audit('user', id, 'delete', userRows[0], null, actor);

  revalidatePath('/risansi/admin/users');
  revalidatePath('/risansi/admin/reps');
}

// ── setUserTours ───────────────────────────────────────────────
// Replace the full set of tours a user is assigned to. `tour_ids` is a JSON
// array of tour_routes.id. `role` is the assignment role ('rep'|'manager').

export async function setUserTours(formData: FormData): Promise<void> {
  const actor = await requireSysadmin();
  const userId = parseInt(formData.get('user_id') as string, 10);
  const role = (formData.get('role') as string | null)?.trim() === 'manager' ? 'manager' : 'rep';
  const tourIds = parseIntArray(formData.get('tour_ids'));

  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid user id');

  const { rows: before } = await risansiPool.query<{ tour_id: number }>(
    'SELECT tour_id FROM tour_assignments WHERE rep_id = $1', [userId],
  );
  const beforeIds = before.map(r => r.tour_id);

  await risansiPool.query('DELETE FROM tour_assignments WHERE rep_id = $1', [userId]);
  for (const tourId of tourIds) {
    await risansiPool.query(
      `INSERT INTO tour_assignments (tour_id, rep_id, role, assigned_by, assigned_at)
       VALUES ($1, $2, $3, (SELECT id FROM users WHERE lower(email) = lower($4)), NOW())
       ON CONFLICT (tour_id, rep_id) DO UPDATE SET role = EXCLUDED.role`,
      [tourId, userId, role, actor],
    );
  }

  await audit('tour_assignment', userId, 'update', { tour_ids: beforeIds }, { tour_ids: tourIds, role }, actor);

  revalidatePath('/risansi/admin/tours');
  revalidatePath('/risansi/admin/users');
}

// ── assignUserToTour ───────────────────────────────────────────
// Add (or update the role of) a single user↔tour assignment.

export async function assignUserToTour(formData: FormData): Promise<void> {
  const actor = await requireSysadmin();
  const tourId = parseInt(formData.get('tour_id') as string, 10);
  const userId = parseInt(formData.get('user_id') as string, 10);
  const role = (formData.get('role') as string | null)?.trim() === 'manager' ? 'manager' : 'rep';

  if (!Number.isInteger(tourId) || tourId <= 0) throw new Error('Invalid tour id');
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Please select a user');

  await risansiPool.query(
    `INSERT INTO tour_assignments (tour_id, rep_id, role, assigned_by, assigned_at)
     VALUES ($1, $2, $3, (SELECT id FROM users WHERE lower(email) = lower($4)), NOW())
     ON CONFLICT (tour_id, rep_id) DO UPDATE SET role = EXCLUDED.role`,
    [tourId, userId, role, actor],
  );

  await audit('tour_assignment', tourId, 'add', null, { user_id: userId, role }, actor);

  revalidatePath('/risansi/admin/tours');
}

// ── removeUserFromTour ─────────────────────────────────────────

export async function removeUserFromTour(formData: FormData): Promise<void> {
  const actor = await requireSysadmin();
  const tourId = parseInt(formData.get('tour_id') as string, 10);
  const userId = parseInt(formData.get('user_id') as string, 10);

  if (!Number.isInteger(tourId) || tourId <= 0) throw new Error('Invalid tour id');
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid user id');

  await risansiPool.query(
    'DELETE FROM tour_assignments WHERE tour_id = $1 AND rep_id = $2',
    [tourId, userId],
  );

  await audit('tour_assignment', tourId, 'remove', { user_id: userId }, null, actor);

  revalidatePath('/risansi/admin/tours');
}

// ── setTourPrimaryUser ─────────────────────────────────────────
// Sets the tour's primary user (legacy tour_routes.primary_rep_id column,
// which still drives some reads). Ensures that user is also assigned to the
// tour. Pass a blank/0 user id to clear the primary.

export async function setTourPrimaryUser(formData: FormData): Promise<void> {
  const actor = await requireSysadmin();
  const tourId = parseInt(formData.get('tour_id') as string, 10);
  const rawUser = formData.get('user_id') as string | null;
  const userId = rawUser && rawUser !== '' ? parseInt(rawUser, 10) : null;

  if (!Number.isInteger(tourId) || tourId <= 0) throw new Error('Invalid tour id');

  const { rows: before } = await risansiPool.query<{ primary_rep_id: number | null }>(
    'SELECT primary_rep_id FROM tour_routes WHERE id = $1', [tourId],
  );

  // A primary user should also be a member of the tour.
  if (userId) {
    await risansiPool.query(
      `INSERT INTO tour_assignments (tour_id, rep_id, role, assigned_by, assigned_at)
       VALUES ($1, $2, 'rep', (SELECT id FROM users WHERE lower(email) = lower($3)), NOW())
       ON CONFLICT (tour_id, rep_id) DO NOTHING`,
      [tourId, userId, actor],
    );
  }

  await risansiPool.query(
    'UPDATE tour_routes SET primary_rep_id = $1 WHERE id = $2',
    [userId, tourId],
  );

  await audit(
    'tour_assignment', tourId, 'update',
    { primary_rep_id: before[0]?.primary_rep_id ?? null },
    { primary_rep_id: userId },
    actor,
  );

  revalidatePath('/risansi/admin/tours');
}

// ── mapClients ─────────────────────────────────────────────────
// Bulk-map unassigned clients. For each client id: insert the given owner
// users into client_assignments (idempotent), and/or set the client's tour.
// At least one of ownerIds / tourId must be supplied.

export async function mapClients(formData: FormData): Promise<void> {
  const actor = await requireSysadmin();
  const clientIds = parseIntArray(formData.get('client_ids'));
  const ownerIds = parseIntArray(formData.get('owner_ids'));
  const rawTour = formData.get('tour_id') as string | null;
  const tourId = rawTour && rawTour !== '' ? parseInt(rawTour, 10) : null;

  if (clientIds.length === 0) throw new Error('Select at least one client');
  if (ownerIds.length === 0 && !tourId) {
    throw new Error('Select at least one owner or a tour to assign');
  }

  for (const clientId of clientIds) {
    if (ownerIds.length > 0) {
      for (const uid of ownerIds) {
        await risansiPool.query(
          `INSERT INTO client_assignments (client_id, user_id, assigned_by, assigned_at)
           VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)), NOW())
           ON CONFLICT (client_id, user_id) DO NOTHING`,
          [clientId, uid, actor],
        );
      }
    }

    if (tourId) {
      await risansiPool.query(
        `UPDATE clients SET
           tour_id   = $1,
           updated_at = NOW()
         WHERE id = $2`,
        [tourId, clientId],
      );
    }

    await audit(
      'client_owner', clientId, 'update',
      null,
      { owner_ids: ownerIds, tour_id: tourId },
      actor,
    );
  }

  revalidatePath('/risansi/admin/unassigned');
  revalidatePath('/risansi/admin/clients');
  revalidatePath('/risansi/clients');
}
