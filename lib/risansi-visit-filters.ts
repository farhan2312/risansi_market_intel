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
    // client rows have no rep column, so scope by reps assigned to the client's tour;
    // visit rows carry the actual rep on v.rep_id.
    c.push(`c.tour_id IN (SELECT ta.tour_id FROM tour_assignments ta JOIN users u ON u.id = ta.rep_id WHERE u.name IN (${arr(reps)}))`);
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
// rep/manager → only their tours' zones/tours and reps who share a tour).
export async function getVisitFilterOptions(user: CurrentUser): Promise<VisitFilterOptions> {
  const admin = hasRole(user.role, 'admin');
  const uid   = Number(user.id) || 0;
  // Tours the user may see: their own tours PLUS the tours of any client granted
  // to them by special access (tourless granted clients contribute nothing).
  const ownTours = `(SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid}
                     UNION SELECT tour_id FROM clients WHERE id IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid}))`;
  const scope = admin ? '' : ` AND tr.id IN ${ownTours}`;
  const q = async (sql: string) => { try { return (await risansiPool.query<{ v: string }>(sql)).rows.map(r => r.v); } catch { return []; } };

  const [zones, tours, reps] = await Promise.all([
    q(`SELECT DISTINCT tr.zone AS v FROM tour_routes tr WHERE tr.zone IS NOT NULL AND tr.zone <> ''${scope} ORDER BY 1`),
    q(`SELECT tr.name AS v FROM tour_routes tr WHERE TRUE${scope} ORDER BY tr.name`),
    admin
      ? q(`SELECT name AS v FROM users WHERE is_active = TRUE AND role IN ('rep','manager') ORDER BY name`)
      : q(`SELECT DISTINCT u.name AS v FROM users u
             JOIN tour_assignments ta ON ta.rep_id = u.id
            WHERE u.is_active = TRUE
              AND u.role IN ('rep','manager')
              AND ta.tour_id IN ${ownTours}
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
    const { rows } = await risansiPool.query<{ v: string }>(
      `SELECT DISTINCT u.name AS v
         FROM users u
         JOIN tour_assignments ta ON ta.rep_id = u.id
         JOIN tour_routes tr ON tr.id = ta.tour_id
        WHERE u.is_active = TRUE AND u.role IN ('rep','manager') AND ${conds.join(' AND ')}
        ORDER BY u.name`,
    );
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
 * The viewer is always in the base set — a manager with no tour assignments
 * would otherwise not see their own exhibitions — but they are subject to the
 * filters like anyone else, so filtering to another rep hides your own blocks
 * rather than leaving them stuck on screen.
 */
export async function getExhibitionScopeUserIds(
  user: CurrentUser, f: VisitFilters,
): Promise<number[]> {
  const uid   = Number(user.id) || 0;
  const admin = hasRole(user.role, 'admin');

  const ownTours = `(SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid}
                     UNION SELECT tour_id FROM clients WHERE id IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid}))`;

  const conds: string[] = ['u.is_active = TRUE'];
  if (!admin) {
    conds.push(`(u.id = ${uid}
                 OR EXISTS (SELECT 1 FROM tour_assignments ta
                             WHERE ta.rep_id = u.id AND ta.tour_id IN ${ownTours}))`);
  }
  if (f.reps.length) conds.push(`u.name IN (${arr(f.reps)})`);
  if (f.zones.length || f.tours.length) {
    const zt: string[] = [];
    if (f.zones.length) zt.push(`tr.zone IN (${arr(f.zones)})`);
    if (f.tours.length) zt.push(`tr.name IN (${arr(f.tours)})`);
    conds.push(`EXISTS (SELECT 1 FROM tour_assignments ta
                          JOIN tour_routes tr ON tr.id = ta.tour_id
                         WHERE ta.rep_id = u.id AND ${zt.join(' AND ')})`);
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
