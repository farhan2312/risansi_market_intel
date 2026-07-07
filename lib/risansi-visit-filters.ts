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
  const scope = admin ? '' : ` AND tr.id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid})`;
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
              AND ta.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid})
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
