// Shared Action Registry task queries.
// Columns are exactly what <ActionQueueRow> (QueueTask) consumes. The SELECT,
// ordering and per-role WHERE clauses live here so the dedicated Action
// Registry page (/risansi/registry) and any future caller stay in sync.

const TASK_SELECT = `
    t.id, t.title, t.due_date, t.priority, t.status, t.assigned_to_external,
    c.id AS client_id, c.code AS client_code, c.legal_name AS client_name,
    COALESCE(r.name, '—') AS assigned_rep_name
  FROM tasks t
  LEFT JOIN clients c ON t.client_id = c.id
  LEFT JOIN users r ON t.assigned_to_rep = r.id`;

const TASK_ORDER = `
  ORDER BY
    CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
    t.due_date ASC NULLS LAST,
    t.created_at DESC
  LIMIT 50`;

// Rep / manager view: tasks assigned to / created by / on a visit owned by the
// user, whose client is on one of the user's tours, or whose client has been
// granted to them via special access. $1 = users.id, $2 = email.
export const REP_TASKS_QUERY = `SELECT ${TASK_SELECT}
  WHERE (
    t.assigned_to_rep = $1
    OR t.created_by = $2
    OR EXISTS (SELECT 1 FROM visits vs WHERE vs.id = t.visit_id AND vs.rep_id = $1)
    OR EXISTS (SELECT 1 FROM clients cl WHERE cl.id = t.client_id AND cl.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $1))
    OR EXISTS (SELECT 1 FROM client_rep_access cra WHERE cra.client_id = t.client_id AND cra.rep_id = $1)
  )${TASK_ORDER}`;

// Admin / sysadmin view: every task.
export const ADMIN_TASKS_QUERY = `SELECT ${TASK_SELECT}${TASK_ORDER}`;
