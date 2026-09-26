import { STATUSES, LEGACY_STATUSES, isOpenStatus, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintListRow, HolderDwell } from '@/lib/risansi-complaint-rows';

// The numbers above the complaints list: how many are open and late, how old
// they are, how long closing takes, who is holding them, who holds longest,
// what keeps going wrong. Pure — rows in, summary out — so a script can check
// it against the database and the page cannot disagree with the export.

export interface Bar { key: string; label: string; count: number; overdue?: number; days?: number }
export interface HolderBar { key: string; label: string; department: string; userId: number | null; open: number; days: number; avgDays: number; stretches: number; totalDays: number }
export interface StatusStep { status: string; count: number; avgDays: number | null; stretches: number }
/** One client's record: how many complaints, how many are still live, how bad. */
export interface ClientBar {
  key: string;           // client_id as text, or 'none' for complaints raised against no client
  label: string;         // legal name
  code: string | null;
  count: number; open: number; overdue: number;
  /** Flagged at closure as a repeat of something already complained about. */
  repeats: number;
  /** Worst severity seen, S1 first. Null when nothing has been rated. */
  worst: Severity | null;
  /** The most recent complaint date, 'YYYY-MM-DD'. */
  last: string;
}

export interface ComplaintSummary {
  total: number; workflow: number; legacy: number;
  open: number; overdue: number; closed: number; resolvedAwaitingClose: number;
  /** Nobody has started on these: the stage is still Open. */
  purelyOpen: number; purelyOpenOverdue: number;
  /** Started but not finished — investigation, action, replacement, the customer. */
  partiallyOpen: number; partiallyOpenOverdue: number;
  avgOpenAge: number | null; oldestOpen: number | null;
  avgTimeToClose: number | null; medianTimeToClose: number | null; closedCount: number;
  raisedThisMonth: number; closedThisMonth: number; raised30: number; closed30: number;
  repeatCount: number; repeatRate: number | null; reopened: number;
  bySeverity: Bar[];                 // open, S1..S4 + unrated
  funnel: StatusStep[];              // current count per status + average days a complaint spends there
  byHolderDept: HolderBar[];         // who holds the open ones now, and for how long in total
  byHolderPerson: HolderBar[];       // the named people, longest first
  longestSitting: ComplaintListRow[];// top open by days in status
  byResponsible: Bar[]; byCategory: Bar[]; byType: Bar[]; byChannel: Bar[];
  byRep: Bar[];
  /** Every client with a complaint, worst record first. The page shows the top few. */
  byClient: ClientBar[];
  /** How many clients are behind the complaints in view. */
  clientCount: number;
  months: { key: string; label: string; raised: number; closed: number }[];
  openByAge: { label: string; count: number }[];
}

const SEV_ORDER: (Severity | 'none')[] = ['S1', 'S2', 'S3', 'S4', 'none'];
const SEV_LABEL: Record<string, string> = { S1: 'S1 Critical', S2: 'S2 Major', S3: 'S3 Moderate', S4: 'S4 Minor', none: 'Not yet rated' };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ym = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : null);

function count<T>(rows: T[], key: (r: T) => string | null | undefined, opts: { label?: (k: string) => string; overdue?: (r: T) => boolean; blank?: string } = {}): Bar[] {
  const m = new Map<string, Bar>();
  for (const r of rows) {
    const k = key(r) || opts.blank || '';
    if (!k) continue;
    const b = m.get(k) ?? { key: k, label: opts.label ? opts.label(k) : k, count: 0, overdue: 0 };
    b.count++; if (opts.overdue?.(r)) b.overdue!++;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Complaints rolled up by account, worst record first: most complaints, then
 * most still live, then most recent. 'none' collects the few raised against no
 * client at all.
 */
export function clientBars(rows: ComplaintListRow[]): ClientBar[] {
  const raised = (r: ComplaintListRow) => (r.complaint_date ?? r.created_at).slice(0, 10);
  const clients = new Map<string, ClientBar>();
  for (const r of rows) {
    const key = r.client_id == null ? 'none' : String(r.client_id);
    const b = clients.get(key) ?? {
      key, label: r.client_name ?? (key === 'none' ? 'No client on the complaint' : `Client #${key}`),
      code: r.client_code, count: 0, open: 0, overdue: 0, repeats: 0, worst: null, last: '',
    };
    b.count++;
    if (isOpenStatus(r.status)) b.open++;
    if (r.overdue) b.overdue++;
    if (r.repeat_complaint === true) b.repeats++;
    if (r.severity && (b.worst == null || SEV_ORDER.indexOf(r.severity) < SEV_ORDER.indexOf(b.worst))) b.worst = r.severity;
    const on = raised(r);
    if (on > b.last) b.last = on;
    clients.set(key, b);
  }
  return [...clients.values()].sort((a, b) =>
    b.count - a.count || b.open - a.open || b.last.localeCompare(a.last) || a.label.localeCompare(b.label));
}

export function summariseComplaints(rows: ComplaintListRow[], dwells: HolderDwell[], nowIso = new Date().toISOString()): ComplaintSummary {
  const today = nowIso.slice(0, 10), thisMonth = today.slice(0, 7);
  const d30 = new Date(Date.parse(nowIso) - 30 * 86400000).toISOString().slice(0, 10);

  const openRows = rows.filter(r => isOpenStatus(r.status));
  const closedRows = rows.filter(r => !isOpenStatus(r.status));
  const wf = rows.filter(r => r.schema_version >= 2);
  const closeDays = closedRows.map(r => r.age_days).filter(d => Number.isFinite(d) && d >= 0);
  const openAges = openRows.map(r => r.age_days);

  const closedOn = (r: ComplaintListRow) => (r.closed_at ?? r.resolved_at ?? '').slice(0, 10);
  const raisedOn = (r: ComplaintListRow) => (r.complaint_date ?? r.created_at).slice(0, 10);

  // Twelve months, raised vs closed.
  const months: ComplaintSummary['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ key, label: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), raised: 0, closed: 0 });
  }
  const mi = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    const a = mi.get(ym(raisedOn(r)) ?? ''); if (a != null) months[a].raised++;
    const c = closedRows.includes(r) ? mi.get(ym(closedOn(r)) ?? '') : undefined; if (c != null) months[c].closed++;
  }

  // Funnel: where the open ones are now, and how long complaints spend in each status (historic, workflow only).
  const perStatus = new Map<string, number[]>();
  for (const d of dwells) (perStatus.get(d.status) ?? perStatus.set(d.status, []).get(d.status)!).push(d.days);
  // The seven workflow stages, plus any legacy stage that actually holds rows —
  // otherwise "every stage" quietly leaves out the In Progress and Awaiting
  // Client complaints that make up most of the history.
  const step = (s: string): StatusStep => ({
    status: s, count: rows.filter(r => r.status === s).length,
    avgDays: avg(perStatus.get(s) ?? []), stretches: (perStatus.get(s) ?? []).length,
  });
  const funnel: StatusStep[] = [
    ...STATUSES.map(step),
    ...LEGACY_STATUSES.filter(s => !(STATUSES as readonly string[]).includes(s))
      .map(step).filter(x => x.count > 0),
  ];

  // Holders: current load (open now) and total historic time held.
  const holderKey = (dept: string, uid: number | null, name: string | null) => (uid != null ? `${dept}|${uid}` : dept);
  const holders = new Map<string, HolderBar>();
  const bump = (dept: string, uid: number | null, name: string | null, byPerson: boolean) => {
    const key = byPerson ? holderKey(dept, uid, name) : dept;
    const label = byPerson ? (name ? `${name} · ${dept}` : `${dept} (unassigned)`) : dept;
    let h = holders.get(key);
    if (!h) { h = { key, label, department: dept, userId: byPerson ? uid : null, open: 0, days: 0, avgDays: 0, stretches: 0, totalDays: 0 }; holders.set(key, h); }
    return h;
  };
  const deptBars = new Map<string, HolderBar>(), personBars = new Map<string, HolderBar>();
  for (const [byPerson, store] of [[false, deptBars], [true, personBars]] as const) {
    holders.clear();
    for (const r of openRows) {
      if (r.schema_version < 2) continue;
      const h = bump(r.holder_department ?? 'Complaint Team', r.holder_user_id, r.holder_name, byPerson);
      h.open++; h.days += r.days_in_status;
    }
    for (const d of dwells) {
      const h = bump(d.department, d.holder_user_id, d.holder_name, byPerson);
      h.totalDays += d.days; h.stretches++;
    }
    for (const h of holders.values()) { h.avgDays = h.stretches ? h.totalDays / h.stretches : 0; store.set(h.key, h); }
  }
  const sortHolders = (m: Map<string, HolderBar>) => [...m.values()].sort((a, b) => b.days - a.days || b.totalDays - a.totalDays);

  const openWf = openRows.filter(r => r.schema_version >= 2);
  const bySeverity: Bar[] = SEV_ORDER.map(s => ({
    key: s, label: SEV_LABEL[s],
    count: openWf.filter(r => (r.severity ?? 'none') === s).length,
    overdue: openWf.filter(r => (r.severity ?? 'none') === s && r.overdue).length,
  }));

  const ageBuckets = [[-1, 7, '≤7d'], [7, 30, '8–30d'], [30, 90, '31–90d'], [90, Infinity, '>90d']] as const;
  const openByAge = ageBuckets.map(([lo, hi, label]) => ({ label, count: openRows.filter(r => r.age_days > lo && r.age_days <= hi).length }));

  const byClient = clientBars(rows);

  const repeatBase = wf.filter(r => r.repeat_complaint != null);
  const repeatCount = wf.filter(r => r.repeat_complaint === true).length;

  return {
    total: rows.length, workflow: wf.length, legacy: rows.length - wf.length,
    open: openRows.length, overdue: openRows.filter(r => r.overdue).length, closed: closedRows.length,
    purelyOpen: openRows.filter(r => r.status === 'Open').length,
    purelyOpenOverdue: openRows.filter(r => r.status === 'Open' && r.overdue).length,
    partiallyOpen: openRows.filter(r => r.status !== 'Open').length,
    partiallyOpenOverdue: openRows.filter(r => r.status !== 'Open' && r.overdue).length,
    resolvedAwaitingClose: rows.filter(r => r.status === 'Resolved').length,
    avgOpenAge: avg(openAges), oldestOpen: openAges.length ? Math.round(Math.max(...openAges)) : null,
    avgTimeToClose: avg(closeDays), medianTimeToClose: median(closeDays), closedCount: closeDays.length,
    raisedThisMonth: rows.filter(r => raisedOn(r).startsWith(thisMonth)).length,
    closedThisMonth: closedRows.filter(r => closedOn(r).startsWith(thisMonth)).length,
    raised30: rows.filter(r => raisedOn(r) >= d30).length,
    closed30: closedRows.filter(r => closedOn(r) >= d30).length,
    repeatCount, repeatRate: repeatBase.length ? repeatCount / repeatBase.length : null,
    reopened: wf.filter(r => r.reopen_count > 0).length,
    bySeverity, funnel,
    byHolderDept: sortHolders(deptBars), byHolderPerson: sortHolders(personBars).filter(h => h.userId != null || h.open > 0),
    longestSitting: [...openWf].sort((a, b) => b.days_in_status - a.days_in_status).slice(0, 6),
    byResponsible: count(wf, r => r.responsible_department, { overdue: r => r.overdue }),
    byCategory: count(wf, r => r.defect_category, { overdue: r => r.overdue }),
    byType: count(wf, r => r.complaint_type, { overdue: r => r.overdue }),
    byChannel: count(rows, r => r.channel, { overdue: r => r.overdue }),
    byRep: count(openRows, r => r.rep_name ?? (r.rep_user_id ? `#${r.rep_user_id}` : 'No rep'), { overdue: r => r.overdue }),
    byClient, clientCount: byClient.length,
    months, openByAge,
  };
}
