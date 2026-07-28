'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';

// ── Special access ────────────────────────────────────────────────
// Admins/sysadmins grant a rep direct access to a client, independent of the
// client's tour. A granted rep sees the client everywhere they'd see a tour
// client (lists, dashboard, plan-visit picker) and can create visits and
// opportunities for it — enforced by the client_rep_access clause in the
// visibility predicates (lib/risansi-auth.ts). These actions manage the grants.

export interface SpecialRep {
  rep_id: number;
  name:   string;
  role:   string;
  zone:   string | null;
  granted_by: string | null;
}

/** Every action here is admin-only. Throws for anyone below admin. */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!hasRole(user.role, 'admin')) throw new Error('Forbidden');
  return user;
}

/** Reps currently granted special access to a client, name-sorted. */
async function grantsFor(clientId: number): Promise<SpecialRep[]> {
  const { rows } = await risansiPool.query<SpecialRep>(
    `SELECT a.rep_id, u.name, u.role, u.zone, a.granted_by
       FROM client_rep_access a
       JOIN users u ON u.id = a.rep_id
      WHERE a.client_id = $1
      ORDER BY u.name`,
    [clientId],
  );
  return rows;
}

/** Read a client's current special-access grants (admin only). */
export async function listClientAccess(clientId: number): Promise<SpecialRep[]> {
  await requireAdmin();
  return grantsFor(clientId);
}

/**
 * Grant a rep direct access to a client. Only active reps/managers are
 * grantable (granting to an admin is meaningless — they already see all).
 * Idempotent via the (client_id, rep_id) unique constraint. Returns the fresh
 * grant list so the caller can update in place.
 */
export async function grantClientAccess(clientId: number, repId: number): Promise<SpecialRep[]> {
  const user = await requireAdmin();

  const { rows: ok } = await risansiPool.query(
    `SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE AND role IN ('rep', 'manager')`,
    [repId],
  );
  if (ok.length === 0) throw new Error('That user cannot be granted access (must be an active rep or manager).');

  await risansiPool.query(
    `INSERT INTO client_rep_access (client_id, rep_id, granted_by)
       VALUES ($1, $2, $3)
     ON CONFLICT (client_id, rep_id) DO NOTHING`,
    [clientId, repId, user.email ?? null],
  );

  revalidatePath('/risansi/admin/clients');
  return grantsFor(clientId);
}

/** Revoke a rep's special access to a client. Returns the fresh grant list. */
export async function revokeClientAccess(clientId: number, repId: number): Promise<SpecialRep[]> {
  await requireAdmin();

  await risansiPool.query(
    `DELETE FROM client_rep_access WHERE client_id = $1 AND rep_id = $2`,
    [clientId, repId],
  );

  revalidatePath('/risansi/admin/clients');
  return grantsFor(clientId);
}
