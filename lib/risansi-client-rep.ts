// Who owns a client's work?
//
// A client sits on a tour (clients.tour_id); the tour carries a roster
// (tour_assignments) and an explicit owner (tour_routes.primary_rep_id).
// Four separate call sites used to answer this question inline, all with the
// same shape — `role='rep' ORDER BY assigned_at, rep_id LIMIT 1` — and all of
// them ignored primary_rep_id entirely. On a tour with two reps that tie-break
// silently hands every client to whichever rep was assigned first, which is an
// artefact of insertion order rather than a statement about ownership.
//
// This module is the single answer. It consults the explicit owner first and
// only falls back to the roster, so a tour that has been curated is respected.

import risansiPool from '@/lib/db-risansi';

/** How the owner was arrived at — surfaced so callers can explain themselves. */
export type RepBasis = 'tour-owner' | 'sole-rep' | 'creator-on-tour' | 'roster-order' | 'none';

export interface ResolvedRep {
  repId: number | null;
  basis: RepBasis;
  /** True when the tour has several reps and none is designated. */
  ambiguous: boolean;
}

/**
 * Resolve the rep who should own new work for a client.
 *
 * Beyond the SQL above this adds two interactive-only rungs. When a tour has
 * several reps and no designated owner, the person creating the record is a
 * far better guess than insertion order — if they are on that tour, it is
 * theirs. Only if they are not do we fall back to the old ordering, so the
 * form always resolves to somebody and never blocks on a data-quality gap.
 */
export async function resolveClientPrimaryRep(
  clientId: number | string,
  creatorRepId?: number | null,
): Promise<ResolvedRep> {
  // Deactivating a user is a flag flip, not a delete: tour_routes.primary_rep_id
  // and tour_assignments rows both survive it. Filtering on is_active here stops
  // new work being parked on someone who has left.
  const { rows } = await risansiPool.query<{
    tour_owner: number | null;
    rep_ids: number[] | null;
    manager_ids: number[] | null;
  }>(
    `SELECT (SELECT u.id FROM users u WHERE u.id = tr.primary_rep_id AND u.is_active) AS tour_owner,
            (SELECT array_agg(ta.rep_id ORDER BY ta.assigned_at, ta.rep_id)
               FROM tour_assignments ta
               JOIN users ru ON ru.id = ta.rep_id AND ru.is_active
              WHERE ta.tour_id = c.tour_id AND ta.role = 'rep') AS rep_ids,
            (SELECT array_agg(ta.rep_id ORDER BY ta.assigned_at, ta.rep_id)
               FROM tour_assignments ta
               JOIN users ru ON ru.id = ta.rep_id AND ru.is_active
              WHERE ta.tour_id = c.tour_id AND ta.role = 'manager') AS manager_ids
       FROM clients c
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
      WHERE c.id = $1`,
    [clientId],
  );

  const row = rows[0];
  if (!row) return { repId: null, basis: 'none', ambiguous: false };

  if (row.tour_owner != null) return { repId: row.tour_owner, basis: 'tour-owner', ambiguous: false };

  // Pick an owner from a candidate roster: a sole member owns outright; several
  // members prefer the creator (if on the tour), else the first by roster order.
  const pick = (ids: number[]): ResolvedRep => {
    if (ids.length === 1) return { repId: ids[0], basis: 'sole-rep', ambiguous: false };
    if (creatorRepId != null && ids.includes(creatorRepId)) {
      return { repId: creatorRepId, basis: 'creator-on-tour', ambiguous: true };
    }
    return { repId: ids[0], basis: 'roster-order', ambiguous: true };
  };

  // Reps own the work. But a manager-only tour (a one-person team like a lone
  // manager who is also the field rep) still needs an owner — the manager acts
  // as the rep. So ownership needs at least one person, rep OR manager.
  const reps = row.rep_ids ?? [];
  if (reps.length > 0) return pick(reps);
  const managers = row.manager_ids ?? [];
  if (managers.length > 0) return pick(managers);
  return { repId: null, basis: 'none', ambiguous: false };
}
