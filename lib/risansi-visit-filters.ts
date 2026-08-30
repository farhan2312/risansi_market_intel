import risansiPool from '@/lib/db-risansi';
import { hasRole, type CurrentUser } from '@/lib/risansi-auth';

// Shared zone / tour / rep filters for the visit + calendar pages.
// Filter values are the display NAMES (zone name, tour name, rep name) — matching
// the clients-page convention — so the removable pills read nicely. Names come
// from trusted DB rows and are single-quote-escaped before inlining.

export interface VisitFilters {
  zones: string[];
  tours: string[];
  reps:  string[];
  clientAnd: string;   // predicate for a clients alias `c` (zone + tour + rep-via-tour)
  visitAnd:  string;   // predicate for a visits alias `v` joined to clients `c`
  active: boolean;
}

const esc  = (s: string) => s.replace(/'/g, "''");
const arr  = (vals: string[]) => vals.map(v => `'${esc(v)}'`).join(',');
const list = (x: unknown) => (typeof x === 'string' && x ? x.split(',').map(s => s.trim()).filter(Boolean) : []);

export function parseVisitFilters(sp: Record<string, string | string[] | undefined>): VisitFilters {
  const zones = list(sp.zone), tours = list(sp.tour), reps = list(sp.rep);
  const c: string[] = [], v: string[] = [];

  if (zones.length) {
    const p = `c.tour_id IN (SELECT id FROM tour_routes WHERE zone IN (${arr(zones)}))`;
    c.push(p); v.push(p);
  }
  if (tours.length) {
    const p = `c.tour_id IN (SELECT id FROM tour_routes WHERE name IN (${arr(tours)}))`;
    c.push(p); v.push(p);
  }
  if (reps.length) {
    // Visit rows carry the rep on v.rep_id and always did. What changed is the
    // client side: a client now names its own reps rather than borrowing them
    // from a route, so "clients this rep works" is a direct question instead of
    // a hop through a route roster.
    //
    // Zone and tour above are untouched. A route is still an attribute of the
    // client, so filtering by one remains meaningful — it just no longer decides
    // who may see anything.
    c.push(`(c.primary_rep_id IN (SELECT id FROM users WHERE name IN (${arr(reps)}))
          OR c.id IN (SELECT s.client_id FROM client_secondary_reps s
                        JOIN users u ON u.id = s.rep_id WHERE u.name IN (${arr(reps)})))`);
    v.push(`v.rep_id IN (SELECT id FROM users WHERE name IN (${arr(reps)}))`);
  }

  return {
    zones, tours, reps,
    clientAnd: c.length ? ' AND ' + c.join(' AND ') : '',
    visitAnd:  v.length ? ' AND ' + v.join(' AND ') : '',
    active: zones.length + tours.length + reps.length > 0,
  };
}

export interface VisitFilterOptions { zones: string[]; tours: string[]; reps: string[]; }

// Options for the dropdowns, scoped to what the user may see (admin → all;
// rep/manager → the routes their own clients sit on, and the people under them).
export async function getVisitFilterOptions(user: CurrentUser): Promise<VisitFilterOptions> {
  const admin = hasRole(user.role, 'admin');
  const uid   = Number(user.id) || 0;
  // Routes the user may see. A roster no longer decides this: the routes worth
  // offering are the ones their own clients actually sit on, so a shared route
  // stops putting a colleague's territory in the dropdown. Clients with no route
  // contribute nothing, which is correct — there is no route to filter by.
  const ownTours = `(SELECT c.tour_id FROM clients c
                      WHERE c.tour_id IS NOT NULL AND c.deleted_at IS NULL
                        AND (c.primary_rep_id = ${uid}
                             OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})
                             OR c.id IN (SELECT s.client_id FROM client_secondary_reps s
                                          WHERE s.rep_id = ${uid}
                                             OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid}))
                             OR c.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid})))`;
  const scope = admin ? '' : ` AND tr.id IN ${ownTours}`;
  const q = async (sql: string) => { try { return (await risansiPool.query<{ v: string }>(sql)).rows.map(r => r.v); } catch { return []; } };

  const [zones, tours, reps] = await Promise.all([
    q(`SELECT DISTINCT tr.zone AS v FROM tour_routes tr WHERE tr.zone IS NOT NULL AND tr.zone <> ''${scope} ORDER BY 1`),
    q(`SELECT tr.name AS v FROM tour_routes tr WHERE TRUE${scope} ORDER BY tr.name`),
    admin
      ? q(`SELECT name AS v FROM users WHERE is_active = TRUE AND role IN ('rep','manager') ORDER BY name`)
      // Yourself, plus anyone you manage. Sharing a route with somebody is no
      // longer a reason to see their name in your filter bar — the hierarchy is
      // explicit, so the list is exactly the people whose work is yours to look at.
      : q(`SELECT DISTINCT u.name AS v FROM users u
            WHERE u.is_active = TRUE
              AND u.role IN ('rep','manager')
              AND (u.id = ${uid} OR u.id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid}))
            ORDER BY u.name`),
  ]);
  return { zones, tours, reps };
}

// Rep NAMES assigned to a tour matching the active zone/tour filter — so those
// reps appear as calendar rows even with no visits in the period. Returns [] when
// no zone/tour filter is active (the caller then shows all reps).
export async function getScopedRepNames(f: VisitFilters): Promise<string[]> {
  if (!f.zones.length && !f.tours.length) return [];
  const conds: string[] = [];
  if (f.zones.length) conds.push(`tr.zone IN (${arr(f.zones)})`);
  if (f.tours.length) conds.push(`tr.name IN (${arr(f.tours)})`);
  try {
    // A route has no reps of its own — its clients do. So "who works this zone"
    // is "who owns or covers a client on it", which is the question the calendar
    // was always trying to ask.
    const sql = `SELECT DISTINCT u.name AS v
           FROM users u
           JOIN clients c ON (c.primary_rep_id = u.id
                              OR c.id IN (SELECT s.client_id FROM client_secondary_reps s WHERE s.rep_id = u.id))
           JOIN tour_routes tr ON tr.id = c.tour_id
          WHERE u.is_active = TRUE AND u.role IN ('rep','manager')
            AND c.deleted_at IS NULL AND ${conds.join(' AND ')}
          ORDER BY u.name`;
    const { rows } = await risansiPool.query<{ v: string }>(sql);
    return rows.map(r => r.v);
  } catch { return []; }
}

/**
 * User ids whose exhibition attendance a viewer may see, already narrowed by the
 * active zone / tour / rep filters.
 *
 * Three things make this its own query rather than a reuse of the rep-name list
 * the filter bar runs on.
 *
 * IDS, NOT NAMES. users.name has no unique constraint — email is the unique key —
 * so a name list silently matches a namesake, which for an exhibition means
 * showing a block against the wrong person.
 *
 * EVERY ROLE. getVisitFilterOptions restricts to rep/manager because those are
 * the people who make visits. An exhibition team has no such restriction: the
 * picker offers every active user and directors do get added. Scoping team
 * members through a rep/manager list drops them from everyone's calendar but
 * their own.
 *
 * AN EMPTY RESULT MEANS EMPTY. getScopedRepNames returns [] for "no filter",
 * "filter matched nobody" and "the query threw" alike, so a caller cannot tell
 * them apart; a zone filter matching no reps would widen the scope instead of
 * emptying it. Here the filters are conditions inside one query, so no match is
 * no rows.
 *
 * The viewer is always in the base set — a manager with nobody under them would
 * otherwise not see their own exhibitions — but they are subject to the filters
 * like anyone else, so filtering to another rep hides your own blocks rather
 * than leaving them stuck on screen.
 */
export async function getExhibitionScopeUserIds(
  user: CurrentUser, f: VisitFilters,
): Promise<number[]> {
  const uid   = Number(user.id) || 0;
  const admin = hasRole(user.role, 'admin');

  const conds: string[] = ['u.is_active = TRUE'];
  if (!admin) {
    // Yourself plus your team. Sharing a route with somebody used to put their
    // exhibition blocks on your calendar, which on a busy shared route meant a
    // rep watching half the office travel; the hierarchy is explicit now.
    conds.push(`(u.id = ${uid}
                 OR u.id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid}))`);
  }
  if (f.reps.length) conds.push(`u.name IN (${arr(f.reps)})`);
  if (f.zones.length || f.tours.length) {
    const zt: string[] = [];
    if (f.zones.length) zt.push(`tr.zone IN (${arr(f.zones)})`);
    if (f.tours.length) zt.push(`tr.name IN (${arr(f.tours)})`);
    // A route has no reps of its own, so "who works this zone" resolves through
    // the clients sitting on it — the same shape as getScopedRepNames, so the
    // calendar's rows and its blocks cannot disagree about who belongs here.
    conds.push(`EXISTS (SELECT 1 FROM clients c
                          JOIN tour_routes tr ON tr.id = c.tour_id
                         WHERE c.deleted_at IS NULL
                           AND (c.primary_rep_id = u.id
                                OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u.id))
                           AND ${zt.join(' AND ')})`);
  }

  try {
    const { rows } = await risansiPool.query<{ id: string }>(
      `SELECT u.id::text AS id FROM users u WHERE ${conds.join(' AND ')}`,
    );
    return rows.map(r => Number(r.id)).filter(Number.isInteger);
  } catch {
    // An empty scope shows no blocks, which is the safe direction to fail: a
    // missing block is a calendar that looks the way it did last week, whereas
    // a block on the wrong person is a wrong answer.
    return [];
  }
}
