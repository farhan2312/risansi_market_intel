// Shared Action Registry task query builder.
// Columns are exactly what <ActionQueueRow> (QueueTask) consumes. Visibility,
// filters, ordering and the LIMIT are composed here so the Action Registry page
// (/risansi/registry) and any future caller stay in sync.


// FROM + joins shared by the row query and the count query, so both apply the
// exact same visibility + filter WHERE against the same relations.
const TASK_FROM = `
  FROM tasks t
  LEFT JOIN clients c ON t.client_id = c.id
  LEFT JOIN users r ON t.assigned_to_rep = r.id`;

// due_date is cast to text (YYYY-MM-DD) so the client never has to unwind a
// date→UTC-ISO round-trip when deciding overdue / formatting the day.
const TASK_COLS = `
    t.id, t.title, t.due_date::text AS due_date, t.priority, t.status, t.assigned_to_external,
    t.resolution_note,
    c.id AS client_id, c.code AS client_code, c.legal_name AS client_name,
    COALESCE(r.name, '—') AS assigned_rep_name`;

const TASK_ORDER = `
  ORDER BY
    CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
    t.due_date ASC NULLS LAST,
    t.created_at DESC
  LIMIT 200`;

// Due-date buckets (disjoint), keyed by their filter label. Overdue excludes
// completed tasks so a done-but-late item isn't flagged as still overdue, and
// uses < CURRENT_DATE (date-only) so something due *today* is "Due today", not
// overdue. The header count (buildTasksCountQuery) uses the same rule.
export const TASK_DUE_BUCKETS = ['Overdue', 'Due today', 'This week', 'Later', 'No due date'];
function dueBucketSql(label: string): string {
  switch (label) {
    case 'Overdue':     return `(t.due_date < CURRENT_DATE AND t.status <> 'completed')`;
    case 'Due today':   return `t.due_date = CURRENT_DATE`;
    case 'This week':   return `(t.due_date > CURRENT_DATE AND t.due_date <= CURRENT_DATE + 7)`;
    case 'Later':       return `t.due_date > CURRENT_DATE + 7`;
    case 'No due date': return `t.due_date IS NULL`;
    default:            return '';
  }
}

// Two responsible-filter sentinels beyond the rep names.
export const RESP_EXTERNAL   = 'External';
export const RESP_UNASSIGNED = 'Unassigned';

export interface TaskFilters {
  status?:      string[];   // task.status values
  priority?:    string[];   // task.priority values
  responsible?: string[];   // rep names, plus RESP_EXTERNAL / RESP_UNASSIGNED
  due?:         string[];   // TASK_DUE_BUCKETS labels
}

export interface TaskQueryOpts {
  isAdmin: boolean;
  repId: number | null;
  email: string;
  filters?: TaskFilters;
  mine?: boolean;   // scope to the caller's own actions (assigned to or created by them)
}

// Rep / manager visibility for an action: it is assigned to you, you raised it,
// it hangs off a visit you own, or you can reach its client.
//
// The client limb is what the ownership migration changes — own it, cover it, or
// manage somebody who does, rather than sharing a route with it. The first three
// limbs are untouched and matter more than they look: an action assigned to you
// on a client you have no relationship with is still yours to do, which is the
// same principle as the in-flight rule on opportunities and visits.
//
// This does not use clientScopeSql because the parameters are positional here
// ($1 rep, $2 email) while that helper inlines the id, and mixing the two
// conventions inside one WHERE is how a query ends up with the wrong id in it.
function repVisibilitySql(): string {
  const clientLimb =
    `EXISTS (SELECT 1 FROM clients cl WHERE cl.id = t.client_id
              AND (cl.primary_rep_id = $1
                   OR cl.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1)))
     OR EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = t.client_id
                 AND (s.rep_id = $1
                      OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1)))`;
  return `(
    t.assigned_to_rep = $1
    OR t.created_by = $2
    OR EXISTS (SELECT 1 FROM visits vs WHERE vs.id = t.visit_id AND vs.rep_id = $1)
    OR ${clientLimb}
    OR EXISTS (SELECT 1 FROM client_rep_access cra WHERE cra.client_id = t.client_id AND cra.rep_id = $1)
  )`;
}

// Compose the shared WHERE (visibility + filters) and its params. Admins see
// every task; reps/managers see only what belongs to them. Filters are ANDed on
// top. A non-empty `due` list whose labels all fail to map yields FALSE (match
// nothing) rather than silently dropping the filter.
function buildWhere(opts: TaskQueryOpts): { where: string; params: (string | number | string[])[] } {
  const conds: string[] = [];
  const params: (string | number | string[])[] = [];

  // $1 = repId, $2 = email — pushed whenever the visibility clause (non-admin) or
  // the "mine" scope needs them; both reference $1/$2 directly.
  if (!opts.isAdmin || opts.mine) {
    params.push(opts.repId ?? 0, opts.email);   // $1, $2
  }
  if (!opts.isAdmin) conds.push(repVisibilitySql());
  if (opts.mine)     conds.push(`(t.assigned_to_rep = $1 OR t.created_by = $2)`);

  const f = opts.filters ?? {};
  if (f.status?.length)   { conds.push(`t.status = ANY($${params.length + 1}::text[])`);   params.push(f.status); }
  if (f.priority?.length) { conds.push(`t.priority = ANY($${params.length + 1}::text[])`); params.push(f.priority); }

  if (f.responsible?.length) {
    const names = f.responsible.filter(v => v !== RESP_EXTERNAL && v !== RESP_UNASSIGNED);
    const parts: string[] = [];
    if (names.length) { parts.push(`r.name = ANY($${params.length + 1}::text[])`); params.push(names); }
    if (f.responsible.includes(RESP_EXTERNAL))   parts.push(`t.assigned_to_external IS NOT NULL`);
    if (f.responsible.includes(RESP_UNASSIGNED)) parts.push(`(t.assigned_to_rep IS NULL AND t.assigned_to_external IS NULL)`);
    if (parts.length) conds.push(`(${parts.join(' OR ')})`);
  }

  if (f.due?.length) {
    const dueParts = f.due.map(dueBucketSql).filter(Boolean);
    // Non-empty selection that maps to nothing → match nothing, don't fail open.
    conds.push(dueParts.length ? `(${dueParts.join(' OR ')})` : 'FALSE');
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

/** Build the Action Registry row query + params (visibility + filters, capped). */
export function buildTasksQuery(opts: TaskQueryOpts): { sql: string; params: (string | number | string[])[] } {
  const { where, params } = buildWhere(opts);
  return { sql: `SELECT ${TASK_COLS} ${TASK_FROM} ${where} ${TASK_ORDER}`, params };
}

/**
 * Build the companion count query — open + overdue tallies over the *whole*
 * matched set (no LIMIT), so the header doesn't plateau at 200. Overdue uses the
 * same < CURRENT_DATE, non-completed rule as the Overdue bucket.
 */
export function buildTasksCountQuery(opts: TaskQueryOpts): { sql: string; params: (string | number | string[])[] } {
  const { where, params } = buildWhere(opts);
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE t.status <> 'completed')::text AS open_count,
      COUNT(*) FILTER (WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::text AS overdue_count
    ${TASK_FROM} ${where}`;
  return { sql, params };
}
