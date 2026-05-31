import type { CSSProperties } from 'react';
import { Fragment } from 'react';
import { Topbar, Tag } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { initials } from '@/lib/risansi-utils';
import { assignVisit } from '@/app/actions/risansi';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Data shapes ────────────────────────────────────────────────

interface Rep {
  id: string;
  name: string;
}

interface WeekVisit {
  id: string;
  client_id: string;
  rep_id: string;
  visit_date: string;     // YYYY-MM-DD
  purpose: string | null;
  status: string;
  outcome: string | null;
  client_name: string;
  client_code: string;
}

interface WeekStats {
  planned: string;
  completed: string;
  missed: string;
  checked_in: string;
}

interface OverdueAccount {
  id: string;
  client_code: string;
  legal_name: string;
  industry: string;
  zone: string | null;
  last_visit: string | null;      // YYYY-MM-DD or null
  days_since: number | null;
  rep_id: string | null;
  rep_name: string | null;
}

// ── Week helpers ───────────────────────────────────────────────

function weekMonday(dateStr?: string): string {
  let d: Date;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, day] = dateStr.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date();
  }
  const dow  = d.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Constants ──────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PURPOSE_COLOR: Record<string, string> = {
  'Routine':              'var(--fg-3)',
  'Quote Follow-up':      'var(--accent)',
  'Complaint':            'var(--neg)',
  'New Opp':              'var(--pos)',
  'Equipment Assessment': 'var(--info)',
  'Mgmt Relationship':    'oklch(0.55 0.10 280)',
};

const STATUS_BG: Record<string, string> = {
  'completed':  'oklch(0.97 0.05 145)',
  'planned':    'var(--bg-paper)',
  'missed':     'oklch(0.97 0.04 15)',
  'checked-in': 'var(--accent-soft)',
  'checked_in': 'var(--accent-soft)',
};

const PURPOSES = ['Routine', 'Quote Follow-up', 'New Opp', 'Complaint', 'Equipment Assessment', 'Mgmt Relationship'];

// ── Page ───────────────────────────────────────────────────────

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp    = await searchParams;
  const wParm = typeof sp.w === 'string' ? sp.w : undefined;

  const monday = weekMonday(wParm);
  const sunday = addDays(monday, 6);
  const today  = todayStr();

  // 7 date strings for the week
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  // Prev / next week links
  const prevWeek = addDays(monday, -7);
  const nextWeek = addDays(monday, 7);

  // Human-readable week label
  const startDisp = new Date(monday + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const endDisp   = new Date(sunday + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const weekLabel = `${startDisp} – ${endDisp}`;

  const [reps, weekVisits, stats, overdueAccounts] = await Promise.all([

    // 1. All users (reps) for the calendar rows
    q<Rep[]>(async () => {
      const { rows } = await risansiPool.query<Rep>(
        `SELECT id, name FROM reps ORDER BY name`,
      );
      return rows;
    }, []),

    // 2. Visits for the week
    q<WeekVisit[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; client_id: string; rep_id: string;
        visit_date: string; purpose: string | null; status: string; outcome: string | null;
        client_name: string; client_code: string;
      }>(`
        SELECT v.id, v.client_id, v.rep_id,
               v.visit_date::text AS visit_date,
               v.purpose, v.status, v.outcome,
               c.legal_name AS client_name, c.code AS client_code
        FROM visits v
        JOIN clients c ON c.id = v.client_id
        WHERE v.visit_date >= $1::date AND v.visit_date <= $2::date
        ORDER BY v.visit_date, c.legal_name
      `, [monday, sunday]);
      return rows;
    }, []),

    // 3. Week KPI stats
    q<WeekStats>(async () => {
      const { rows } = await risansiPool.query<WeekStats>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'planned')::text                            AS planned,
          COUNT(*) FILTER (WHERE status = 'completed')::text                          AS completed,
          COUNT(*) FILTER (WHERE status = 'missed')::text                             AS missed,
          COUNT(*) FILTER (WHERE status IN ('checked-in','checked_in'))::text         AS checked_in
        FROM visits
        WHERE visit_date >= $1::date AND visit_date <= $2::date
      `, [monday, sunday]);
      return rows[0] ?? { planned: '0', completed: '0', missed: '0', checked_in: '0' };
    }, { planned: '0', completed: '0', missed: '0', checked_in: '0' }),

    // 4. Overdue accounts — active clients with no visit in 90+ days
    q<OverdueAccount[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; client_code: string; legal_name: string;
        industry: string; zone: string | null;
        last_visit: string | null; days_since: string | null;
        rep_id: string | null; rep_name: string | null;
      }>(`
        SELECT c.id, c.code AS client_code, c.legal_name, c.industry, c.zone,
               MAX(v.visit_date)::text AS last_visit,
               CASE
                 WHEN MAX(v.visit_date) IS NULL THEN NULL
                 ELSE EXTRACT(DAY FROM NOW() - MAX(v.visit_date)::timestamp)::int
               END::text AS days_since,
               r.id AS rep_id, r.name AS rep_name
        FROM clients c
        LEFT JOIN visits v ON v.client_id = c.id
        LEFT JOIN reps r ON r.id = c.primary_rep_id
        WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL
        GROUP BY c.id, c.code, c.legal_name, c.industry, c.zone, r.id, r.name
        HAVING MAX(v.visit_date) IS NULL
            OR MAX(v.visit_date) < (NOW() - INTERVAL '90 days')
        ORDER BY MAX(v.visit_date) ASC NULLS FIRST
        LIMIT 10
      `);
      return rows.map(r => ({ ...r, days_since: r.days_since != null ? Number(r.days_since) : null }));
    }, []),
  ]);

  // ── Derived values ─────────────────────────────────────────

  const planned    = Number(stats.planned);
  const completed  = Number(stats.completed);
  const missed     = Number(stats.missed);
  const checkedIn  = Number(stats.checked_in);
  const total      = planned + completed + missed + checkedIn;
  const closeable  = completed + missed;
  const compliance = closeable > 0 ? Math.round((completed / closeable) * 100) : 0;

  // Build visit lookup: repId → dateStr → visits[]
  const byRepDay: Record<string, Record<string, WeekVisit[]>> = {};
  for (const v of weekVisits) {
    if (!byRepDay[v.rep_id]) byRepDay[v.rep_id] = {};
    if (!byRepDay[v.rep_id][v.visit_date]) byRepDay[v.rep_id][v.visit_date] = [];
    byRepDay[v.rep_id][v.visit_date].push(v);
  }

  const tomorrow = addDays(today, 1);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Visit Calendar']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page head */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Visit Calendar
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {reps.length} rep{reps.length !== 1 ? 's' : ''}
              {' · '}{total} visit{total !== 1 ? 's' : ''} this week
              {overdueAccounts.length > 0 && ` · ${overdueAccounts.length} overdue account${overdueAccounts.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
          <KpiCard label="Visits Scheduled" value={String(total)} sub="this week" />
          <KpiCard label="Completed" value={String(completed)} sub={`of ${closeable > 0 ? closeable : total} closeable`} pos />
          <KpiCard label="Missed" value={String(missed)} sub="did not happen" neg={missed > 0} />
          <KpiCard label="Compliance" value={closeable > 0 ? `${compliance}%` : '—'} sub="completed / closeable" pos={compliance >= 80} neg={compliance > 0 && compliance < 60} />
          <KpiCard label="At-Risk Accounts" value={String(overdueAccounts.length)} sub="90+ days no visit" neg={overdueAccounts.length > 0} />
        </div>

        {/* Week navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <a href={`/risansi/visits?w=${prevWeek}`} style={NAV_BTN}>← Prev</a>
          <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{weekLabel}</span>
          <a href={`/risansi/visits?w=${nextWeek}`} style={NAV_BTN}>Next →</a>
          {monday !== weekMonday() && (
            <a href="/risansi/visits" style={{ ...NAV_BTN, color: 'var(--accent)' }}>This week</a>
          )}
        </div>

        {/* Calendar grid */}
        {reps.length === 0 ? (
          <div style={{ ...PANEL, padding: '32px', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
            No reps configured
          </div>
        ) : (
          <div style={{ ...PANEL, overflowX: 'auto', marginBottom: 14 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `150px repeat(7, minmax(120px, 1fr))`,
              minWidth: 1000,
            }}>

              {/* Header row */}
              <div style={GRID_HEAD_CELL} />
              {days.map((day, i) => {
                const isToday = day === today;
                const d = new Date(day + 'T00:00:00');
                return (
                  <div key={day} style={{
                    ...GRID_HEAD_CELL,
                    background: isToday ? 'var(--accent-soft)' : undefined,
                  }}>
                    <div style={{ fontSize: 10, color: isToday ? 'var(--accent)' : 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {DAY_LABELS[i]}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: isToday ? 600 : 400, color: isToday ? 'var(--accent)' : 'var(--fg)', marginTop: 2 }}>
                      {d.getDate()}
                    </div>
                  </div>
                );
              })}

              {/* Rep rows */}
              {reps.map((rep, repIdx) => {
                const repInitials = initials(rep.name);
                const isLast = repIdx === reps.length - 1;
                const rowBorder = isLast ? undefined : '1px solid var(--line)';
                return (
                  <Fragment key={rep.id}>
                    {/* Rep label */}
                    <div style={{
                      ...GRID_CELL,
                      borderBottom: rowBorder,
                      padding: '10px 12px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      justifyContent: 'center',
                    }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 6,
                        background: 'var(--bg-sunk)', color: 'var(--fg-2)',
                        display: 'grid', placeItems: 'center',
                        fontSize: 11, fontWeight: 600,
                      }}>
                        {repInitials}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 500, textAlign: 'center', lineHeight: 1.2 }}>
                        {rep.name.split(' ')[0]}
                      </div>
                    </div>

                    {/* Day cells */}
                    {days.map(day => {
                      const dayVisits = byRepDay[rep.id]?.[day] ?? [];
                      const isToday = day === today;
                      return (
                        <div key={day} style={{
                          ...GRID_CELL,
                          borderBottom: rowBorder,
                          padding: 6, minHeight: 64,
                          background: isToday ? 'oklch(0.99 0.01 60)' : undefined,
                          verticalAlign: 'top',
                        }}>
                          {dayVisits.map(v => {
                            const purposeColor = PURPOSE_COLOR[v.purpose ?? 'Routine'] ?? 'var(--fg-3)';
                            const statusBg = STATUS_BG[v.status] ?? 'var(--bg-paper)';
                            return (
                              <div key={v.id} style={{
                                background: statusBg,
                                borderLeft: `2px solid ${purposeColor}`,
                                borderRadius: 3,
                                padding: '5px 7px',
                                marginBottom: 4,
                                border: '1px solid var(--line)',
                                borderLeftWidth: 2,
                                borderLeftColor: purposeColor,
                              }}>
                                <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {v.client_name}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>
                                  {v.purpose ?? 'Visit'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Visit purpose legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {Object.entries(PURPOSE_COLOR).map(([purpose, color]) => (
            <div key={purpose} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-3)' }}>
              <div style={{ width: 3, height: 12, background: color, borderRadius: 1 }} />
              {purpose}
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {[
              ['Completed', 'oklch(0.97 0.05 145)'],
              ['Planned',   'var(--bg-paper)'],
              ['Missed',    'oklch(0.97 0.04 15)'],
            ].map(([label, bg]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--fg-3)' }}>
                <div style={{ width: 10, height: 10, background: bg, border: '1px solid var(--line)', borderRadius: 2 }} />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Overdue accounts */}
        {overdueAccounts.length > 0 && (
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>At-Risk Accounts</span>
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-3)' }}>
                no visit in 90+ days
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--neg)', fontWeight: 500 }}>{overdueAccounts.length}</span>
            </div>
            <div>
              {overdueAccounts.map((account, i) => (
                <div
                  key={account.id}
                  style={{
                    display: 'flex', gap: 12, padding: '14px',
                    borderBottom: i < overdueAccounts.length - 1 ? '1px solid var(--line)' : 'none',
                    alignItems: 'flex-start', flexWrap: 'wrap',
                  }}
                >
                  {/* Red left bar */}
                  <div style={{ width: 4, alignSelf: 'stretch', background: 'var(--neg)', borderRadius: 2, flexShrink: 0 }} />

                  {/* Client info */}
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 12 }}>{account.legal_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2, lineHeight: 1.5 }}>
                      {account.client_code}
                      {account.industry ? ` · ${account.industry}` : ''}
                      {account.zone ? ` · ${account.zone}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--neg)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                      {account.days_since != null
                        ? `Last visited ${account.days_since} days ago`
                        : 'Never visited'}
                      {account.last_visit ? ` (${new Date(account.last_visit + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})` : ''}
                    </div>
                  </div>

                  {/* Assign visit form */}
                  <form action={assignVisit} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                    <input type="hidden" name="client_id" value={account.id} />
                    <select name="rep_id" defaultValue={account.rep_id ?? ''} style={FORM_FIELD}>
                      <option value="">Select rep</option>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <input type="date" name="visit_date" defaultValue={tomorrow} style={FORM_FIELD} />
                    <select name="purpose" style={FORM_FIELD}>
                      {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <button type="submit" style={BTN}>Assign visit →</button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function KpiCard({ label, value, sub, pos = false, neg = false }: {
  label: string; value: string; sub?: string; pos?: boolean; neg?: boolean;
}) {
  const valueColor = pos ? 'var(--pos)' : neg ? 'var(--neg)' : 'var(--fg)';
  return (
    <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, marginTop: 4, color: valueColor, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};

const PANEL_H: CSSProperties = {
  padding: '12px 14px', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', gap: 8,
};

const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };

const GRID_HEAD_CELL: CSSProperties = {
  padding: '10px 12px',
  background: 'var(--bg-elev)',
  borderBottom: '1px solid var(--line)',
  borderRight: '1px solid var(--line)',
};

const GRID_CELL: CSSProperties = {
  borderRight: '1px solid var(--line)',
};

const NAV_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '5px 10px', fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  color: 'var(--fg)', borderRadius: 5, textDecoration: 'none',
  cursor: 'pointer',
};

const FORM_FIELD: CSSProperties = {
  height: 30, padding: '0 8px',
  fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)',
  borderRadius: 5, color: 'var(--fg)', outline: 'none',
};

const BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 11px', fontSize: 12, fontFamily: 'inherit',
  fontWeight: 500, background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', color: 'var(--fg)',
  borderRadius: 5, cursor: 'pointer',
};
