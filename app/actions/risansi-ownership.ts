'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Rep ownership: who owns a client, who covers it, and who manages whom.
//
// Every write in here is admin-gated and returns its failure rather than
// throwing it. Next.js redacts errors thrown out of a server action in
// production, so a thrown one reaches the browser as "an unexpected response"
// and the reason stays on the server — which is exactly how the outstanding
// upload failed silently for weeks.

export type Outcome = { ok: true; message?: string } | { ok: false; error: string };

const fail = (e: unknown): Outcome => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e) || 'Unknown error',
});

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== 'admin' && role !== 'sysadmin') return null;
  return { email: session?.user?.email ?? '' };
}

const touch = () => {
  revalidatePath('/risansi/admin/reps');
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/pipeline');
};

// ── the owner ─────────────────────────────────────────────────────

/** Set (or clear, with null) the one rep who owns a client. */
export async function setPrimaryRep(clientId: number, repId: number | null): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change client ownership.' };
  if (!Number.isInteger(clientId) || clientId <= 0) return { ok: false, error: 'Invalid client.' };
  try {
    if (repId != null) {
      // A person cannot own and cover the same client — covering is what the
      // others do. Promoting a secondary therefore removes the secondary row
      // rather than leaving the client listing them twice.
      await risansiPool.query(
        'DELETE FROM client_secondary_reps WHERE client_id = $1 AND rep_id = $2', [clientId, repId]);
    }
    const r = await risansiPool.query(
      'UPDATE clients SET primary_rep_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [clientId, repId]);
    if (!r.rowCount) return { ok: false, error: 'That client no longer exists, or has been archived.' };
    touch();
    return { ok: true, message: repId == null ? 'Owner cleared.' : 'Owner set.' };
  } catch (e) { return fail(e); }
}

// ── the people covering it ────────────────────────────────────────

export async function addSecondaryRep(clientId: number, repId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change who covers a client.' };
  try {
    const { rows } = await risansiPool.query<{ primary_rep_id: number | null }>(
      'SELECT primary_rep_id FROM clients WHERE id = $1 AND deleted_at IS NULL', [clientId]);
    if (!rows.length) return { ok: false, error: 'That client no longer exists, or has been archived.' };
    if (rows[0].primary_rep_id === repId) {
      return { ok: false, error: 'They already own this client, so there is nothing to cover.' };
    }
    await risansiPool.query(
      `INSERT INTO client_secondary_reps (client_id, rep_id, added_by)
       VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
       ON CONFLICT DO NOTHING`,
      [clientId, repId, me.email]);
    touch();
    return { ok: true, message: 'Added as covering rep.' };
  } catch (e) { return fail(e); }
}

export async function removeSecondaryRep(clientId: number, repId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change who covers a client.' };
  try {
    await risansiPool.query(
      'DELETE FROM client_secondary_reps WHERE client_id = $1 AND rep_id = $2', [clientId, repId]);
    touch();
    return { ok: true, message: 'Removed.' };
  } catch (e) { return fail(e); }
}

// ── the hierarchy ─────────────────────────────────────────────────

/** One cell of the Teams matrix. `on` ticks it, off unticks. */
export async function setManagerRep(managerId: number, repId: number, on: boolean): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change teams.' };
  if (managerId === repId) {
    return { ok: false, error: 'Nobody manages themselves — they already see their own clients by owning them.' };
  }
  try {
    if (on) {
      await risansiPool.query(
        `INSERT INTO manager_reps (manager_id, rep_id, added_by)
         VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
         ON CONFLICT DO NOTHING`,
        [managerId, repId, me.email]);
    } else {
      await risansiPool.query(
        'DELETE FROM manager_reps WHERE manager_id = $1 AND rep_id = $2', [managerId, repId]);
    }
    revalidatePath('/risansi/admin/reps');
    revalidatePath('/risansi/field');
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ── handing over a book ───────────────────────────────────────────

export interface MovePreview {
  owned: number;
  covered: number;
  alreadyTheirs: number;
}

/** What a move would do, without doing it. */
export async function previewMove(fromRepId: number, toRepId: number): Promise<MovePreview | null> {
  if (!(await requireAdmin())) return null;
  try {
    const { rows } = await risansiPool.query<{ owned: string; covered: string; already: string }>(
      `SELECT
         (SELECT count(*) FROM clients
           WHERE primary_rep_id = $1 AND deleted_at IS NULL)::text AS owned,
         (SELECT count(*) FROM client_secondary_reps s
            JOIN clients c ON c.id = s.client_id AND c.deleted_at IS NULL
           WHERE s.rep_id = $1)::text AS covered,
         (SELECT count(*) FROM clients
           WHERE primary_rep_id = $1 AND deleted_at IS NULL
             AND id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $2))::text AS already`,
      [fromRepId, toRepId]);
    return {
      owned: Number(rows[0]?.owned ?? 0),
      covered: Number(rows[0]?.covered ?? 0),
      alreadyTheirs: Number(rows[0]?.already ?? 0),
    };
  } catch { return null; }
}

/**
 * Hand one person's book to another.
 *
 * Deliberately a deliberate act rather than something that happens when an
 * account is deactivated. Silent reassignment is how ownership drifted in the
 * first place, and a leaver's clients showing up in the Unassigned tab is a
 * better outcome than them quietly becoming somebody else's problem.
 */
export async function moveClients(
  fromRepId: number, toRepId: number, what: 'owned' | 'covered' | 'both',
): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can move clients.' };
  if (fromRepId === toRepId) return { ok: false, error: 'Those are the same person.' };

  const c = await risansiPool.connect();
  try {
    await c.query('BEGIN');
    let owned = 0, covered = 0;

    if (what === 'owned' || what === 'both') {
      // The receiver may already cover some of what they are about to own.
      // Clear that first, or the client ends up listing them as both.
      await c.query(
        `DELETE FROM client_secondary_reps
          WHERE rep_id = $2
            AND client_id IN (SELECT id FROM clients WHERE primary_rep_id = $1 AND deleted_at IS NULL)`,
        [fromRepId, toRepId]);
      const r = await c.query(
        `UPDATE clients SET primary_rep_id = $2, updated_at = NOW()
          WHERE primary_rep_id = $1 AND deleted_at IS NULL`, [fromRepId, toRepId]);
      owned = r.rowCount ?? 0;
    }

    if (what === 'covered' || what === 'both') {
      // Move the covering rows, skipping any client the receiver now owns —
      // owning it already includes everything covering it would give them.
      const r = await c.query(
        `UPDATE client_secondary_reps s SET rep_id = $2
          WHERE s.rep_id = $1
            AND NOT EXISTS (SELECT 1 FROM client_secondary_reps k
                             WHERE k.client_id = s.client_id AND k.rep_id = $2)
            AND NOT EXISTS (SELECT 1 FROM clients c2
                             WHERE c2.id = s.client_id AND c2.primary_rep_id = $2)`,
        [fromRepId, toRepId]);
      covered = r.rowCount ?? 0;
      // Anything left is a duplicate of what the receiver already had.
      await c.query('DELETE FROM client_secondary_reps WHERE rep_id = $1', [fromRepId]);
    }

    await c.query('COMMIT');
    touch();
    const bits = [owned ? `${owned} owned` : '', covered ? `${covered} covered` : ''].filter(Boolean);
    return { ok: true, message: bits.length ? `Moved ${bits.join(' and ')}.` : 'Nothing to move.' };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return fail(e);
  } finally { c.release(); }
}

// ── the recycle bin ───────────────────────────────────────────────

/** Bring an archived client back. */
export async function restoreClient(clientId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can restore a client.' };
  try {
    const r = await risansiPool.query(
      'UPDATE clients SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL',
      [clientId]);
    if (!r.rowCount) return { ok: false, error: 'That client is not archived.' };
    revalidatePath('/risansi/admin/recoverable');
    touch();
    return { ok: true, message: 'Restored. It has no owner until you set one.' };
  } catch (e) { return fail(e); }
}
