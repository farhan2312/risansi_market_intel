import risansiPool from '@/lib/db-risansi';
import { complaintVisibilitySql, type CurrentUser } from '@/lib/risansi-auth';
import { STATUSES, LEGACY_STATUSES, isOpenStatus, type Severity } from '@/lib/risansi-complaint-flow';

// The complaints list, as rows, and the numbers on top of it.
//
// One loader feeds the Complaints page, its analytics, the Client 360 panel
// and the export, so they never disagree about who holds what. The holder of
// a complaint is whoever the latest stage-log row names; "days in status" is
// measured from that row. Everything is computed for the rows the user may
// see — a rep's analytics are over their clients' complaints, the Complaint
// Team's over all.

export interface ComplaintListRow {
  id: number; complaint_no: string; legacy_ref: string | null;
  client_id: number | null; client_name: string | null; client_code: string | null;
  status: string; schema_version: number; severity: Severity | null;
  complaint_type: string | null; defect_category: string | null; defect_reason: string | null;
  responsible_department: string | null; channel: string | null;
  complaint_date: string | null; created_at: string; resolved_at: string | null; closed_at: string | null;
  details: string | null; contact_person: string | null;
  rep_user_id: number | null; rep_name: string | null;
  holder_department: string | null; holder_user_id: number | null; holder_name: string | null;
  since: string | null; days_in_status: number; age_days: number;
  target_completion_date: string | null; overdue: boolean;
  repeat_complaint: boolean | null; reopen_count: number;
  investigation_assigned_to: number | null; action_assigned_to: number | null;
  action_category: string | null; pump_model: string | null; pump_serial_no: string | null;
}

export interface ComplaintFilters {
  status?: string;      // one status, or 'open' / 'closed'
  sev?: string;         // S1..S4 or 'none'
  dept?: string;        // current holder department
  holder?: string;      // current holder user id
  type?: string;        // complaint_type
  cat?: string;         // defect_category
  resp?: string;        // responsible_department
  rep?: string;         // rep_user_id
  era?: string;         // 'workflow' | 'legacy'
  q?: string;           // free text
  overdue?: string;     // '1'
  from?: string; to?: string; // complaint_date range
}

export const FILTER_KEYS: (keyof ComplaintFilters)[] = ['status', 'sev', 'dept', 'holder', 'type', 'cat', 'resp', 'rep', 'era', 'q', 'overdue', 'from', 'to'];

export function parseComplaintFilters(sp: Record<string, string | string[] | undefined>): ComplaintFilters {
  const f: ComplaintFilters = {};
  for (const k of FILTER_KEYS) { const v = sp[k]; if (typeof v === 'string' && v !== '') f[k] = v; }
  return f;
}

const OPEN_LIST = [...STATUSES.filter(isOpenStatus), ...LEGACY_STATUSES.filter(isOpenStatus)];

export async function loadComplaintRows(user: CurrentUser, opts: { clientId?: number; filters?: ComplaintFilters } = {}): Promise<ComplaintListRow[]> {
  const f = opts.filters ?? {};
  const conds: string[] = [];
  const outer: string[] = [];   // on the lateral holder row, so after the subquery
  const params: unknown[] = [];
  const add = (sql: string, v: unknown, into: string[] = conds) => { params.push(v); into.push(sql.replace('?', `$${params.length}`)); };

  const vis = complaintVisibilitySql(user, 'c');
  if (vis) conds.push(`(${vis})`);
  if (opts.clientId != null) add('c.client_id = ?', opts.clientId);

  if (f.status === 'open') conds.push(`c.status = ANY(ARRAY[${OPEN_LIST.map(s => `'${s}'`).join(',')}])`);
  else if (f.status === 'closed') conds.push(`c.status IN ('Resolved', 'Closed')`);
  else if (f.status) add('c.status = ?', f.status);
  if (f.sev === 'none') conds.push('c.severity IS NULL AND c.schema_version >= 2');
  else if (f.sev) add('c.severity = ?', f.sev);
  if (f.type) add('c.complaint_type = ?', f.type);
  if (f.cat) add('c.defect_category = ?', f.cat);
  if (f.resp) add('c.responsible_department = ?', f.resp);
  if (f.rep) add('c.rep_user_id = ?', Number(f.rep) || 0);
  if (f.era === 'legacy') conds.push('c.schema_version < 2');
  else if (f.era === 'workflow') conds.push('c.schema_version >= 2');
  if (f.from) add('COALESCE(c.complaint_date, c.created_at::date) >= ?::date', f.from);
  if (f.to) add('COALESCE(c.complaint_date, c.created_at::date) <= ?::date', f.to);
  if (f.q) {
    params.push(`%${f.q.trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(c.complaint_no ILIKE ${p} OR c.legacy_ref ILIKE ${p} OR cl.legal_name ILIKE ${p} OR c.details ILIKE ${p} OR c.pump_serial_no ILIKE ${p} OR c.ec_no ILIKE ${p})`);
  }
  if (f.dept) add('x.holder_department = ?', f.dept, outer);
  if (f.holder) add('x.holder_user_id = ?', Number(f.holder) || 0, outer);
  if (f.overdue === '1') outer.push('x.overdue');

  const { rows } = await risansiPool.query<ComplaintListRow>(`
    SELECT * FROM (
      SELECT c.id, c.complaint_no, c.legacy_ref, c.client_id, cl.legal_name AS client_name, cl.code AS client_code,
             c.status, c.schema_version, c.severity, c.complaint_type, c.defect_category, c.defect_reason,
             c.responsible_department, c.channel,
             c.complaint_date::text AS complaint_date, c.created_at::text AS created_at,
             c.resolved_at::text AS resolved_at, c.closed_at::text AS closed_at,
             c.details, c.contact_person, c.rep_user_id, ur.name AS rep_name,
             l.holder_department, l.holder_user_id, hu.name AS holder_name, l.created_at::text AS since,
             COALESCE(EXTRACT(EPOCH FROM (now() - l.created_at)) / 86400, 0)::float AS days_in_status,
             (EXTRACT(EPOCH FROM (COALESCE(c.closed_at, c.resolved_at, now()) - COALESCE(c.complaint_date::timestamptz, c.created_at))) / 86400)::float AS age_days,
             c.target_completion_date::text AS target_completion_date,
             (c.target_completion_date IS NOT NULL AND c.target_completion_date < CURRENT_DATE
              AND c.status NOT IN ('Resolved', 'Closed')) AS overdue,
             c.repeat_complaint, COALESCE(c.reopen_count, 0)::int AS reopen_count,
             c.investigation_assigned_to, c.action_assigned_to, c.action_category, c.pump_model, c.pump_serial_no
        FROM complaints c
        LEFT JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN users ur ON ur.id = c.rep_user_id
        LEFT JOIN LATERAL (
          SELECT s.holder_department, s.holder_user_id, s.created_at
            FROM complaint_stage_log s WHERE s.complaint_id = c.id
           ORDER BY s.created_at DESC, s.id DESC LIMIT 1) l ON TRUE
        LEFT JOIN users hu ON hu.id = l.holder_user_id
       ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
    ) x
    ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
    ORDER BY CASE WHEN x.status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END,
             x.overdue DESC, x.days_in_status DESC, x.id DESC`, params);
  return rows;
}

// ── Historic dwell per holder, across every complaint the user may see ──

export interface HolderDwell {
  department: string; holder_user_id: number | null; holder_name: string | null;
  status: string; complaint_id: number; days: number; current: boolean;
}

export async function loadHolderDwells(user: CurrentUser, opts: { clientId?: number } = {}): Promise<HolderDwell[]> {
  const vis = complaintVisibilitySql(user, 'c');
  const params: unknown[] = [];
  const conds = ['c.schema_version >= 2'];
  if (vis) conds.push(`(${vis})`);
  if (opts.clientId != null) { params.push(opts.clientId); conds.push(`c.client_id = $${params.length}`); }
  const { rows } = await risansiPool.query<HolderDwell>(`
    SELECT COALESCE(l.holder_department, 'Complaint Team') AS department, l.holder_user_id, u.name AS holder_name,
           l.to_status AS status, l.complaint_id,
           (EXTRACT(EPOCH FROM (COALESCE(LEAD(l.created_at) OVER w, now()) - l.created_at)) / 86400)::float AS days,
           (LEAD(l.created_at) OVER w IS NULL) AS current
      FROM complaint_stage_log l
      JOIN complaints c ON c.id = l.complaint_id
      LEFT JOIN users u ON u.id = l.holder_user_id
     WHERE ${conds.join(' AND ')}
    WINDOW w AS (PARTITION BY l.complaint_id ORDER BY l.created_at, l.id)`, params);
  // Time after Resolved / Closed is nobody's.
  return rows.filter(r => isOpenStatus(r.status));
}
