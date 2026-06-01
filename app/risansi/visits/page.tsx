import type { CSSProperties } from 'react';
import { Fragment } from 'react';
import { Topbar, Tag, MultiSelectFilter, ActiveFilterBar, SortableTH } from '@/components/risansi';
import AssignVisitDrawer, { AssignVisitRowBtn, type DrawerRep } from '@/components/risansi/AssignVisitDrawer';
import risansiPool from '@/lib/db-risansi';
import { formatRev } from '@/lib/risansi-utils';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface RepRow extends DrawerRep {
  initials: string | null;
  zone:     string | null;
}

interface WeekVisit {
  id:           string;
  visit_date:   string;
  status:       string;
  purpose:      string | null;
  outcome:      string | null;
  client_id:    string;
  client_name:  string;
  client_code:  string;
  industry:     string | null;
  city:         string | null;
  tier:         string | null;
  rep_name:     string;
  rep_id:       string | null;
}

interface WeekStats {
  planned:    string;
  completed:  string;
  missed:     string;
  checked_in: string;
}

interface OverdueAccount {
  id:              string;
  code:            string;
  legal_name:      string;
  industry:        string | null;
  tier:            string | null;
  status:          string;
  state:           string | null;
  city:            string | null;
  last_visit_date: string | null;
  last_visit_fy:   string | null;
  days_overdue:    number | null;
  rep_name:        string;
  rep_id:          string | null;
  rep_initials:    string | null;
  tour_name:       string | null;
  visit_count:     number | null;
  ytd_inr:         number;
}

// ── Week date helpers ──────────────────────────────────────────

function weekMonday(s?: string): string {
  let d: Date;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date();
  }
  const dow  = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(s: string, n: number): string {
  const [y, m, day] = s.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(s: string): string {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtDateLong(s: string): string {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PURPOSE_COLOR: Record<string, string> = {
  'Routine':                       '#3B82F6',
  'Quote Follow-up':               '#D97706',
  'Complaint Resolution':          '#E02424',
  'New Opportunity':               '#0E9F6E',
  'Equipment Assessment':          '#7C3AED',
  'Management Relationship Visit': '#0A3D8F',
};

// Sort map for overdue table
const SORT_MAP: Record<string, string> = {
  name:         'c.legal_name',
  days_overdue: 'days_overdue',
  last_visit:   'c.last_visit_date',
  ytd:          'ytd_inr',
  rep:          'rep_name',
  tier:         'c.tier',
  state:        'c.state',
};

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp    = await searchParams;
  const tab   = typeof sp.tab === 'string' ? sp.tab : 'week';
  const wParm = typeof sp.w   === 'string' ? sp.w   : undefined;

  // Overdue tab filters
  const repFilts  = typeof sp.rep  === 'string' && sp.rep  ? sp.rep.split(',').filter(Boolean)  : [];
  const tierFilts = typeof sp.tier === 'string' && sp.tier ? sp.tier.split(',').filter(Boolean) : [];

  // Overdue sort
  const sortKey  = typeof sp.sort === 'string' ? sp.sort : 'days_overdue';
  const orderDir = sp.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol  = SORT_MAP[sortKey] ?? 'days_overdue';

  const monday = weekMonday(wParm);
  const sunday = addDays(monday, 6);
  const today  = todayStr();
  const days   = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const prevWeek = addDays(monday, -7);
  const nextWeek = addDays(monday,  7);
  const isThisWk = monday === weekMonday();

  const startDisp = fmtDate(monday);
  const endDisp   = fmtDateLong(sunday);
  const weekLabel = `${startDisp} – ${endDisp}`;

  // Build overdue WHERE conditions
  const overdueConds: string[] = [];
  const overdueVals: (string | string[])[] = [];
  let idx = 1;

  if (repFilts.length > 0) {
    overdueConds.push(`COALESCE(r.name, c.primary_rep_name, '—') = ANY($${idx}::text[])`);
    overdueVals.push(repFilts); idx++;
  }
  if (tierFilts.length > 0) {
    overdueConds.push(`c.tier = ANY($${idx}::text[])`);
    overdueVals.push(tierFilts); idx++;
  }

  const [reps, weekVisits, stats, overdueAccounts, repOptions, tierOptions] = await Promise.all([

    q<RepRow[]>(async () => {
      try {
        const { rows } = await risansiPool.query<RepRow>(
          `SELECT id, name, initials, zone, route FROM reps WHERE is_active = TRUE ORDER BY name ASC`,
        );
        return rows;
      } catch {
        const { rows } = await risansiPool.query<{ id: string; name: string }>(
          `SELECT id, name FROM reps ORDER BY name ASC`,
        );
        return rows.map(r => ({ ...r, initials: null, zone: null, route: null }));
      }
    }, []),

    q<WeekVisit[]>(async () => {
      const { rows } = await risansiPool.query<WeekVisit & { visit_date: string }>(`
        SELECT
          v.id,
          v.visit_date::text          AS visit_date,
          v.status,
          v.purpose,
          v.outcome,
          c.id                        AS client_id,
          c.legal_name                AS client_name,
          c.code                      AS client_code,
          c.industry,
          c.city,
          c.tier,
          COALESCE(r.name, c.primary_rep_name, '—') AS rep_name,
          r.id                        AS rep_id
        FROM visits v
        JOIN   clients c ON c.id = v.client_id
        LEFT JOIN reps r ON r.id = v.rep_id
        WHERE v.visit_date >= $1::date
          AND v.visit_date <  $2::date
        ORDER BY v.visit_date ASC, v.check_in_time ASC NULLS LAST
      `, [monday, addDays(monday, 7)]);
      return rows;
    }, []),

    q<WeekStats>(async () => {
      const { rows } = await risansiPool.query<WeekStats>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'planned')::text                    AS planned,
          COUNT(*) FILTER (WHERE status = 'completed')::text                  AS completed,
          COUNT(*) FILTER (WHERE status = 'missed')::text                     AS missed,
          COUNT(*) FILTER (WHERE status IN ('checked-in','checked_in'))::text AS checked_in
        FROM visits
        WHERE visit_date >= $1::date AND visit_date < $2::date
      `, [monday, addDays(monday, 7)]);
      return rows[0] ?? { planned: '0', completed: '0', missed: '0', checked_in: '0' };
    }, { planned: '0', completed: '0', missed: '0', checked_in: '0' }),

    q<OverdueAccount[]>(async () => {
      const extraConds = overdueConds.length > 0 ? `AND ${overdueConds.join(' AND ')}` : '';
      const { rows } = await risansiPool.query<{
        id: string; code: string; legal_name: string;
        industry: string | null; tier: string | null; status: string;
        state: string | null; city: string | null;
        last_visit_date: string | null; last_visit_fy: string | null;
        days_overdue: string | null;
        tour_name: string | null; visit_count: string | null;
        rep_name: string; rep_initials: string | null;
        ytd_inr: string;
      }>(`
        SELECT
          c.id, c.code, c.legal_name, c.industry,
          c.tier, c.status, c.state, c.city,
          c.last_visit_date, c.last_visit_fy,
          CURRENT_DATE - c.last_visit_date AS days_overdue,
          c.tour_name, c.visit_count,
          COALESCE(r.name, c.primary_rep_name, '—') AS rep_name,
          COALESCE(r.initials,
            UPPER(LEFT(COALESCE(c.primary_rep_name,'?'),1)) ||
            UPPER(LEFT(SPLIT_PART(COALESCE(c.primary_rep_name,'? ?'),' ',2),1))
          ) AS rep_initials,
          COALESCE(c.rev_2526_total, 0) AS ytd_inr
        FROM clients c
        LEFT JOIN reps r ON c.primary_rep_id = r.id
        WHERE c.status='ACTIVE' AND c.deleted_at IS NULL
          AND (
            c.last_visit_date IS NULL
            OR (c.tier='Key'  AND c.last_visit_date < NOW() - INTERVAL '100 days')
            OR (c.tier!='Key' AND c.last_visit_date < NOW() - INTERVAL '200 days')
          )
          ${extraConds}
        ORDER BY ${sortCol} ${orderDir} NULLS FIRST
        LIMIT 100
      `, overdueVals as string[]);
      return rows.map(r => ({
        ...r,
        rep_id:       null,
        days_overdue: r.days_overdue != null ? Number(r.days_overdue) : null,
        visit_count:  r.visit_count != null ? Number(r.visit_count) : null,
        ytd_inr:      Number(r.ytd_inr ?? 0),
      }));
    }, []),

    // Rep options for filter
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ name: string }>(
        `SELECT DISTINCT name FROM reps WHERE deleted_at IS NULL ORDER BY name`,
      );
      return rows.map(r => r.name);
    }, []),

    // Tier options for filter
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ tier: string }>(
        `SELECT DISTINCT tier FROM clients WHERE tier IS NOT NULL AND deleted_at IS NULL ORDER BY tier`,
      );
      return rows.map(r => r.tier);
    }, []),
  ]);

  // ── Derived stats ──────────────────────────────────────────

  const nPlanned   = Number(stats.planned);
  const nCompleted = Number(stats.completed);
  const nMissed    = Number(stats.missed);
  const nCheckedIn = Number(stats.checked_in);
  const nTotal     = nPlanned + nCompleted + nMissed + nCheckedIn;
  const denomComp  = nPlanned + nCompleted + nMissed;
  const compliance = denomComp > 0 ? Math.round((nCompleted / denomComp) * 100) : 0;

  const byRepDay: Record<string, Record<string, WeekVisit[]>> = {};
  for (const v of weekVisits) {
    const rid = v.rep_id ?? '__unassigned__';
    if (!byRepDay[rid]) byRepDay[rid] = {};
    if (!byRepDay[rid][v.visit_date]) byRepDay[rid][v.visit_date] = [];
    byRepDay[rid][v.visit_date].push(v);
  }

  const keyOverdue     = overdueAccounts.filter(a => a.tier === 'Key').length;
  const stdOverdue     = overdueAccounts.filter(a => a.tier !== 'Key').length;
  const totalExposureInr = overdueAccounts.reduce((s, a) => s + a.ytd_inr, 0);

  const curSort = sortKey;
  const curDir  = orderDir === 'DESC' ? 'desc' : 'asc';
  const anyFilter = repFilts.length > 0 || tierFilts.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Visit Plan']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 48px', background: '#F4F7FC' }}>

        {/* ── Page header ───────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: '#0D1B2A' }}>
              Visit Plan
            </div>
            <div style={{ fontSize: 12, color: '#6B7FA3', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
              Week of {weekLabel}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={STAT_CHIP}>
              {nTotal} visit{nTotal !== 1 ? 's' : ''} planned this week
            </span>
            <span style={{
              ...STAT_CHIP,
              background: compliance >= 80 ? '#D1FAE5' : compliance >= 60 ? '#FEF3C7' : '#FEE2E2',
              color:      compliance >= 80 ? '#065F46' : compliance >= 60 ? '#92400E' : '#9B1C1C',
            }}>
              {denomComp > 0 ? `${compliance}% compliance` : '— compliance'}
            </span>
            <AssignVisitDrawer reps={reps} />
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '2px solid #DDE6F5', marginBottom: 18, gap: 0 }}>
          <TabLink href={`?tab=week${wParm ? '&w=' + wParm : ''}`} active={tab !== 'overdue'}>
            Week View
          </TabLink>
          <TabLink href={`?tab=overdue${wParm ? '&w=' + wParm : ''}`} active={tab === 'overdue'}>
            Overdue Accounts
            {overdueAccounts.length > 0 && (
              <span style={{ marginLeft: 6, background: '#FEE2E2', color: '#9B1C1C', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
                {overdueAccounts.length}
              </span>
            )}
          </TabLink>
        </div>

        {/* ── Tab 1: Week View ─────────────────────────────── */}
        {tab !== 'overdue' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <a href={`?tab=week&w=${prevWeek}`} style={NAV_BTN}>← Prev</a>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#2C3E5A' }}>{weekLabel}</span>
              <a href={`?tab=week&w=${nextWeek}`} style={NAV_BTN}>Next →</a>
              {!isThisWk && (
                <a href="?tab=week" style={{ ...NAV_BTN, color: '#0A3D8F', borderColor: '#0A3D8F' }}>
                  This week
                </a>
              )}
            </div>

            {reps.length === 0 ? (
              <div style={{ ...PANEL, padding: 48, textAlign: 'center', fontSize: 13, color: '#6B7FA3' }}>
                No active reps configured.
              </div>
            ) : weekVisits.length === 0 ? (
              <div style={{ ...PANEL, padding: 48, textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#2C3E5A', marginBottom: 8 }}>
                  No visits planned for this week.
                </div>
                <div style={{ fontSize: 13, color: '#6B7FA3' }}>
                  Use + Assign Visit to add visits.
                </div>
              </div>
            ) : (
              <div style={{ ...PANEL, overflowX: 'auto', marginBottom: 14 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `140px repeat(7, minmax(130px, 1fr))`,
                  minWidth: 1050,
                }}>
                  <div style={HEAD_CELL} />
                  {days.map((day, i) => {
                    const isToday = day === today;
                    const d = new Date(day + 'T00:00:00');
                    return (
                      <div key={day} style={{ ...HEAD_CELL, background: isToday ? '#EBF1FB' : '#F8FAFC' }}>
                        <div style={{ fontSize: 9, color: isToday ? '#0A3D8F' : '#6B7FA3', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: isToday ? 700 : 500 }}>
                          {DAY_LABELS[i]}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: isToday ? 700 : 400, color: isToday ? '#0A3D8F' : '#0D1B2A', marginTop: 2 }}>
                          {d.getDate()}
                        </div>
                      </div>
                    );
                  })}

                  {reps.map((rep, repIdx) => {
                    const abbr = rep.initials
                      ?? (rep.name.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?');
                    const isLast  = repIdx === reps.length - 1;
                    const rowLine = isLast ? 'none' : '1px solid #DDE6F5';

                    return (
                      <Fragment key={rep.id}>
                        <div style={{
                          ...BODY_CELL,
                          borderBottom: rowLine,
                          padding: '10px 12px',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 4,
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 6,
                            background: '#EBF1FB', color: '#0A3D8F',
                            display: 'grid', placeItems: 'center',
                            fontSize: 11, fontWeight: 700,
                          }}>
                            {abbr}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 500, textAlign: 'center', lineHeight: 1.25, color: '#2C3E5A' }}>
                            {rep.name.split(' ')[0]}
                          </div>
                          {rep.route && (
                            <div style={{ fontSize: 9, color: '#6B7FA3', textAlign: 'center' }}>
                              {rep.route}
                            </div>
                          )}
                        </div>

                        {days.map(day => {
                          const dayVisits = byRepDay[rep.id]?.[day] ?? [];
                          const isToday   = day === today;
                          return (
                            <div key={day} style={{
                              ...BODY_CELL,
                              borderBottom: rowLine,
                              padding: 5, minHeight: 72,
                              background: isToday ? 'rgba(235,241,251,0.45)' : 'transparent',
                              verticalAlign: 'top',
                            }}>
                              {dayVisits.length === 0 ? (
                                <div style={{ height: '100%', minHeight: 62, border: '1px dashed #E2E8F0', borderRadius: 4, margin: 1 }} />
                              ) : (
                                dayVisits.map(v => <VisitCard key={v.id} visit={v} />)
                              )}
                            </div>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: '#6B7FA3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Purpose
              </div>
              {Object.entries(PURPOSE_COLOR).map(([purpose, color]) => (
                <div key={purpose} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#2C3E5A' }}>
                  <div style={{ width: 3, height: 14, background: color, borderRadius: 2, flexShrink: 0 }} />
                  {purpose}
                </div>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ fontSize: 10, color: '#6B7FA3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div>
                {[
                  ['Planned',    '#F3F4F6', '#374151'],
                  ['Checked-in', '#1A5CB8', '#fff'],
                  ['Completed',  '#0E9F6E', '#fff'],
                  ['Missed',     '#E02424', '#fff'],
                ].map(([label, bg, fg]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#2C3E5A' }}>
                    <div style={{ width: 10, height: 10, background: bg, border: label === 'Planned' ? '1px solid #DDE6F5' : 'none', borderRadius: 2 }} />
                    <span style={{ color: '#6B7FA3', fontSize: 10 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Tab 2: Overdue Accounts ──────────────────────── */}
        {tab === 'overdue' && (
          <>
            {/* Summary strip */}
            <div style={{ ...PANEL, padding: '12px 16px', marginBottom: 10, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              {keyOverdue > 0 && (
                <div style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: '#E02424', fontFamily: 'var(--font-mono)' }}>{keyOverdue}</span>
                  <span style={{ color: '#6B7FA3', marginLeft: 5 }}>key account{keyOverdue !== 1 ? 's' : ''} overdue</span>
                </div>
              )}
              {stdOverdue > 0 && (
                <div style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: '#D97706', fontFamily: 'var(--font-mono)' }}>{stdOverdue}</span>
                  <span style={{ color: '#6B7FA3', marginLeft: 5 }}>standard account{stdOverdue !== 1 ? 's' : ''} overdue</span>
                </div>
              )}
              {totalExposureInr > 0 && (
                <div style={{ fontSize: 12, marginLeft: 'auto' }}>
                  <span style={{ color: '#6B7FA3' }}>Total exposure: </span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0D1B2A' }}>
                    {formatRev(totalExposureInr)}
                  </span>
                </div>
              )}
              {overdueAccounts.length === 0 && !anyFilter && (
                <div style={{ fontSize: 13, color: '#0E9F6E', fontWeight: 500 }}>
                  ✓ All accounts are within visit frequency thresholds.
                </div>
              )}
            </div>

            {/* Filter row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <MultiSelectFilter param="rep"  label="Rep"  options={repOptions}  selected={repFilts}  />
              <MultiSelectFilter param="tier" label="Tier" options={tierOptions} selected={tierFilts} />
            </div>

            {/* Active filter pills */}
            {anyFilter && (
              <ActiveFilterBar filters={[
                { param: 'rep',  label: 'Rep',  values: repFilts  },
                { param: 'tier', label: 'Tier', values: tierFilts },
              ]} />
            )}

            {overdueAccounts.length === 0 ? (
              <div style={{ ...PANEL, padding: '32px 0', textAlign: 'center', fontSize: 13, color: '#6B7FA3', marginTop: 8 }}>
                No overdue accounts match the current filters.
              </div>
            ) : (
              <div style={{ ...PANEL, overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <SortableTH col="name"         label="Client"        currentSort={curSort} currentDir={curDir} style={OD_TH} />
                      <th style={OD_TH}>Industry</th>
                      <SortableTH col="state"        label="State"         currentSort={curSort} currentDir={curDir} style={OD_TH} />
                      <SortableTH col="tier"         label="Tier"          currentSort={curSort} currentDir={curDir} style={OD_TH} />
                      <SortableTH col="last_visit"   label="Last Visit"    currentSort={curSort} currentDir={curDir} style={OD_TH} />
                      <SortableTH col="days_overdue" label="Days Overdue"  currentSort={curSort} currentDir={curDir} style={OD_TH} align="right" />
                      <SortableTH col="ytd"          label="25–26 Revenue" currentSort={curSort} currentDir={curDir} style={OD_TH} align="right" />
                      <SortableTH col="rep"          label="Rep"           currentSort={curSort} currentDir={curDir} style={OD_TH} />
                      <th style={OD_TH}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueAccounts.map((a, i) => {
                      const last = overdueAccounts.length - 1;
                      const { color: dColor, label: dLabel, bold: dBold } = overdueStyle(a.days_overdue);
                      return (
                        <tr key={a.id} style={{ borderBottom: i < last ? '1px solid #EBF1FB' : 'none' }}>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                            <div style={{ fontWeight: 600, fontSize: 12, color: '#0D1B2A' }}>{a.legal_name}</div>
                            <div style={{ fontSize: 10, color: '#6B7FA3', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                              {a.code}{a.tour_name ? ` · ${a.tour_name}` : ''}
                            </div>
                          </td>
                          <td style={TD}>
                            {a.industry ? <Tag>{a.industry}</Tag> : <span style={{ color: '#6B7FA3' }}>—</span>}
                          </td>
                          <td style={{ ...TD, color: '#6B7FA3' }}>{a.state ?? '—'}</td>
                          <td style={TD}>
                            {a.tier
                              ? <Tag kind={a.tier === 'Key' ? 'warn' : undefined}>{a.tier}</Tag>
                              : <span style={{ color: '#6B7FA3' }}>—</span>}
                          </td>
                          <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B7FA3' }}>
                            {a.last_visit_date ? fmtDateLong(a.last_visit_date) : '—'}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: dColor, fontWeight: dBold ? 700 : 500 }}>
                            {dLabel}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {a.ytd_inr > 0 ? formatRev(a.ytd_inr) : '—'}
                          </td>
                          <td style={{ ...TD, color: '#2C3E5A' }}>{a.rep_name}</td>
                          <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                            <AssignVisitRowBtn
                              clientId={a.id}
                              clientName={a.legal_name}
                              clientCode={a.code}
                              repId={a.rep_id ?? undefined}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}

// ── Visit card ─────────────────────────────────────────────────

function VisitCard({ visit: v }: { visit: WeekVisit }) {
  const purposeColor = PURPOSE_COLOR[v.purpose ?? ''] ?? '#94A3B8';
  const { bg: statusBg, fg: statusFg, cross } = statusStyle(v.status);

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #E2E8F0',
      borderLeft: `4px solid ${purposeColor}`,
      borderRadius: 4,
      padding: '5px 7px',
      marginBottom: 4,
      textDecoration: cross ? 'line-through' : 'none',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#0D1B2A', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v.client_name}
      </div>
      <div style={{ fontSize: 9, color: '#6B7FA3', marginTop: 1, marginBottom: 4 }}>
        {v.purpose ?? 'Visit'}
      </div>
      <div style={{
        display: 'inline-block', padding: '1px 5px',
        borderRadius: 3, fontSize: 9, fontWeight: 700,
        letterSpacing: '0.03em', background: statusBg, color: statusFg,
        textTransform: 'uppercase',
      }}>
        {v.status.replace(/_/g, '-')}
      </div>
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '8px 16px', fontSize: 13, textDecoration: 'none',
      fontWeight: active ? 600 : 400,
      color: active ? '#0A3D8F' : '#6B7FA3',
      borderBottom: active ? '2px solid #0A3D8F' : '2px solid transparent',
      marginBottom: -2,
      transition: 'color 0.15s',
    }}>
      {children}
    </a>
  );
}

function statusStyle(status: string): { bg: string; fg: string; cross: boolean } {
  switch (status) {
    case 'completed':   return { bg: '#0E9F6E', fg: '#fff', cross: false };
    case 'checked-in':
    case 'checked_in':  return { bg: '#1A5CB8', fg: '#fff', cross: false };
    case 'missed':      return { bg: '#E02424', fg: '#fff', cross: false };
    case 'cancelled':   return { bg: '#F3F4F6', fg: '#6B7280', cross: true };
    default:            return { bg: '#F3F4F6', fg: '#374151', cross: false };
  }
}

function overdueStyle(days: number | null): { color: string; label: string; bold: boolean } {
  if (days == null) return { color: '#E02424', label: 'Never visited', bold: true };
  if (days > 365)   return { color: '#E02424', label: '1yr+',          bold: true };
  if (days > 200)   return { color: '#E02424', label: `${days}d ago`,  bold: false };
  if (days > 100)   return { color: '#D97706', label: `${days}d ago`,  bold: false };
  return { color: '#6B7FA3', label: `${days}d ago`, bold: false };
}

// ── Style constants ────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: '#fff', border: '1px solid #DDE6F5', borderRadius: 8,
};

const STAT_CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '5px 12px', fontSize: 12, fontWeight: 500,
  background: '#EBF1FB', color: '#0A3D8F',
  borderRadius: 20, whiteSpace: 'nowrap',
};

const HEAD_CELL: CSSProperties = {
  padding: '10px 12px',
  background: '#F8FAFC',
  borderBottom: '2px solid #DDE6F5',
  borderRight: '1px solid #DDE6F5',
};

const BODY_CELL: CSSProperties = {
  borderRight: '1px solid #DDE6F5',
};

const NAV_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '5px 10px', fontSize: 12, fontFamily: 'inherit',
  background: '#fff', border: '1px solid #CBD5E1',
  color: '#2C3E5A', borderRadius: 5, textDecoration: 'none',
};

const OD_TH: CSSProperties = {
  padding:       '9px 12px',
  textAlign:     'left',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    700,
  color:         '#6B7FA3',
  background:    '#EBF1FB',
  borderBottom:  '2px solid #DDE6F5',
  whiteSpace:    'nowrap',
};

const TD: CSSProperties = {
  padding: '10px 12px', verticalAlign: 'middle', fontSize: 12,
};
