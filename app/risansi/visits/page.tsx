import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth/next';
import { Topbar, Tag } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { WeekNav } from '@/components/risansi/WeekNav';
import { AssignVisitButton } from '@/components/risansi/AssignVisitButton';
import { AssignVisitRowBtn } from '@/components/risansi/AssignVisitDrawer';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    console.error('[visits/page] query failed:', err);
    return fallback;
  }
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Types ──────────────────────────────────────────────────────

interface VisitCalRow {
  id: string;
  visit_date: string;
  status: string;
  purpose: string;
  outcome: string | null;
  client_id: string;
  client_name: string;
  client_code: string;
  industry: string | null;
  city: string | null;
  tier: string | null;
  rep_id: string;
  rep_name: string;
}

interface RepRow {
  id: string;
  name: string;
  zone: string | null;
  route: string | null;
}

interface OverdueRow {
  id: string;
  code: string;
  legal_name: string;
  industry: string | null;
  tier: string | null;
  state: string | null;
  city: string | null;
  last_visit_date: string | null;
  days_overdue: number | null;
  rep_name: string;
}

// ── Purpose → colour map ───────────────────────────────────────

const PURPOSE_COLORS: Record<string, string> = {
  'Routine':                       '#3B82F6',
  'Quote Follow-up':               '#D97706',
  'Complaint Resolution':          '#E02424',
  'New Opportunity':               '#0E9F6E',
  'Equipment Assessment':          '#7C3AED',
  'Management Relationship Visit': '#0A3D8F',
};

const STATUS_BG: Record<string, string> = {
  'planned':    'var(--bg-elev)',
  'checked-in': '#DBEAFE',
  'completed':  '#D1FAE5',
  'missed':     '#FDE8E8',
  'cancelled':  '#F3F4F6',
};

// ── VisitCard — server-rendered visit pill ─────────────────────

function VisitCard({ visit }: { visit: VisitCalRow }) {
  const color = PURPOSE_COLORS[visit.purpose] ?? '#6B7FA3';
  const bg    = STATUS_BG[visit.status] ?? 'var(--bg-elev)';
  const statusColor =
    visit.status === 'completed'  ? '#065F46' :
    visit.status === 'missed'     ? '#9B1C1C' :
    visit.status === 'checked-in' ? '#1E40AF' :
    'var(--fg-3)';

  return (
    <Link
      href={`/risansi/clients/${visit.client_id}`}
      style={{
        display: 'block', margin: '2px', padding: '5px 7px',
        borderRadius: 5, borderLeft: `3px solid ${color}`,
        background: bg, textDecoration: 'none',
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--fg)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 130,
      }}>
        {visit.client_name}
      </div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>
        {visit.purpose || 'Visit'}
      </div>
      <div style={{ marginTop: 3 }}>
        <span style={{
          fontSize: 9, fontWeight: 600,
          textTransform: 'uppercase' as const, letterSpacing: '0.06em',
          color: statusColor,
        }}>
          {visit.status}
        </span>
      </div>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default async function VisitCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session    = await getServerSession(authOptions);
  const role       = session?.user?.role ?? 'rep';
  const isRep      = role === 'rep';
  const sp         = await searchParams;
  const weekOffset = parseInt(typeof sp.week === 'string' ? sp.week : '0', 10) || 0;
  const tab        = typeof sp.tab === 'string' ? sp.tab : 'week';

  // ── Week bounds ──────────────────────────────────────────────
  const today     = new Date();
  const dayOfWeek = today.getDay();
  const monday    = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const weekStart = toDateStr(monday);
  const weekEnd   = toDateStr(sunday);
  const todayStr  = toDateStr(today);
  const weekLabel = `${monday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toDateStr(d);
    return {
      date:    dateStr,
      label:   d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      isToday: dateStr === todayStr,
    };
  });

  // ── Rep lookup for rep role ──────────────────────────────────
  let repEmail: string | null = isRep ? (session?.user?.email ?? null) : null;

  // ── Queries ──────────────────────────────────────────────────
  const [visits, reps, overdue] = await Promise.all([

    // This week's visits
    q<VisitCalRow[]>(async () => {
      const repCond = isRep ? `AND r.email = $3` : '';
      const params  = isRep
        ? [weekStart, weekEnd, repEmail!]
        : [weekStart, weekEnd];
      const { rows } = await risansiPool.query<VisitCalRow>(
        `SELECT
           v.id::text,
           v.visit_date::text         AS visit_date,
           v.status,
           COALESCE(v.purpose, '')    AS purpose,
           v.outcome,
           c.id::text                 AS client_id,
           c.legal_name               AS client_name,
           c.code                     AS client_code,
           c.industry,
           c.city,
           c.tier,
           r.id::text                 AS rep_id,
           COALESCE(r.name,    '—')   AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE v.visit_date >= $1
           AND v.visit_date <= $2
           ${repCond}
         ORDER BY v.visit_date ASC, v.created_at ASC NULLS LAST`,
        params,
      );
      return rows;
    }, []),

    // Active reps
    q<RepRow[]>(async () => {
      const repCond = isRep ? `AND email = $1` : '';
      const params  = isRep ? [repEmail!] : [];
      const { rows } = await risansiPool.query<RepRow>(
        `SELECT
           id::text,
           name,
           zone,
           route
         FROM reps
         WHERE is_active = TRUE ${repCond}
         ORDER BY name ASC`,
        params,
      );
      return rows;
    }, []),

    // Overdue accounts
    q<OverdueRow[]>(async () => {
      const repCond = isRep ? `AND r.email = $1` : '';
      const params  = isRep ? [repEmail!] : [];
      const { rows } = await risansiPool.query<OverdueRow>(
        `SELECT
           c.id::text,
           c.code,
           c.legal_name,
           c.industry,
           c.tier,
           c.state,
           c.city,
           c.last_visit_date::text,
           COALESCE(
             EXTRACT(DAY FROM NOW() - c.last_visit_date)::int,
             9999
           )                                                  AS days_overdue,
           COALESCE(r.name, c.primary_rep_name, '—')          AS rep_name
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE c.status = 'ACTIVE'
           AND c.deleted_at IS NULL
           AND (
             c.last_visit_date IS NULL
             OR (c.tier = 'Key' AND
                 c.last_visit_date < NOW() - INTERVAL '100 days')
             OR ((c.tier IS NULL OR c.tier != 'Key') AND
                 c.last_visit_date < NOW() - INTERVAL '200 days')
           )
           ${repCond}
         ORDER BY days_overdue DESC NULLS FIRST
         LIMIT 20`,
        params,
      );
      return rows;
    }, []),
  ]);

  // ── Stats ────────────────────────────────────────────────────
  const totalPlanned   = visits.filter(v => v.status !== 'cancelled').length;
  const totalCompleted = visits.filter(v => v.status === 'completed').length;
  const compliancePct  = totalPlanned > 0
    ? Math.round((totalCompleted / totalPlanned) * 100)
    : 0;
  const keyOverdue = overdue.filter(r => r.tier === 'Key').length;
  const stdOverdue = overdue.length - keyOverdue;

  // Tab href helpers
  function tabHref(t: string) {
    const weekPart = weekOffset !== 0 ? `&week=${weekOffset}` : '';
    return `/risansi/visits?tab=${t}${weekPart}`;
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Visit Plan']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: 20,
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Visit Plan
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              Week of {weekLabel}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Stat chips */}
            <div style={CHIP}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{totalPlanned}</span>
              {' '}visits this week
            </div>
            <div style={{
              ...CHIP,
              color: compliancePct >= 80 ? '#065F46' : compliancePct >= 50 ? '#92400E' : '#9B1C1C',
              background: compliancePct >= 80 ? '#D1FAE5' : compliancePct >= 50 ? '#FEF3C7' : '#FEE2E2',
              borderColor: compliancePct >= 80 ? '#6EE7B7' : compliancePct >= 50 ? '#FCD34D' : '#FCA5A5',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{compliancePct}%</span>
              {' '}compliance
            </div>
            {/* Assign Visit button (client island — drawer listens to custom events from row btns) */}
            <AssignVisitButton reps={reps} />
            {/* Week navigation (client island) */}
            <WeekNav currentOffset={weekOffset} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 2, marginBottom: 16,
          borderBottom: '1px solid var(--line)', paddingBottom: 0,
        }}>
          {[
            { id: 'week',    label: 'Week View' },
            { id: 'overdue', label: `Overdue (${overdue.length})` },
          ].map(t => (
            <a key={t.id} href={tabHref(t.id)} style={{
              display: 'block', padding: '8px 16px', fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.1s',
            }}>
              {t.label}
            </a>
          ))}
        </div>

        {/* ── Week View ─────────────────────────────────────────── */}
        {tab === 'week' && (
          <div style={{
            background: 'var(--bg-paper)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius)', overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse',
                tableLayout: 'fixed', minWidth: 900,
              }}>
                <thead>
                  <tr>
                    <th style={{
                      width: 140, padding: '10px 12px', textAlign: 'left',
                      background: 'var(--bg-elev)',
                      borderBottom: '2px solid var(--line)',
                      borderRight: '1px solid var(--line)',
                      fontSize: 10, textTransform: 'uppercase',
                      letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)',
                    }}>
                      Rep
                    </th>
                    {weekDays.map(day => (
                      <th key={day.date} style={{
                        padding: '8px 6px', textAlign: 'center',
                        background: day.isToday ? '#EBF1FB' : 'var(--bg-elev)',
                        borderBottom: '2px solid var(--line)',
                        borderRight: '1px solid rgba(0,0,0,0.05)',
                        fontSize: 11,
                        fontWeight: day.isToday ? 700 : 500,
                        color: day.isToday ? '#1A5CB8' : 'var(--fg-3)',
                      }}>
                        {day.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reps.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{
                        padding: '40px 0', textAlign: 'center',
                        color: 'var(--fg-3)', fontSize: 13,
                      }}>
                        No active reps found
                      </td>
                    </tr>
                  ) : reps.map(rep => (
                    <tr key={rep.id}>
                      {/* Rep column */}
                      <td style={{
                        padding: '8px 10px', verticalAlign: 'top',
                        borderBottom: '1px solid var(--line)',
                        borderRight: '1px solid var(--line)',
                        background: 'var(--bg-paper)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 600, color: 'var(--fg)',
                              whiteSpace: 'nowrap', overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {rep.name}
                            </div>
                            {(rep.route ?? rep.zone) && (
                              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>
                                {rep.route ?? rep.zone}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Day cells */}
                      {weekDays.map(day => {
                        const dayVisits = visits.filter(v =>
                          v.rep_id === rep.id && v.visit_date === day.date,
                        );
                        return (
                          <td key={day.date} style={{
                            padding: '4px', verticalAlign: 'top',
                            background: day.isToday
                              ? 'rgba(235,241,251,0.45)' : 'transparent',
                            borderBottom: '1px solid var(--line)',
                            borderRight: '1px solid rgba(0,0,0,0.04)',
                            minHeight: 60,
                          }}>
                            {dayVisits.length > 0
                              ? dayVisits.map(v => <VisitCard key={v.id} visit={v} />)
                              : (
                                <div style={{
                                  height: 50, margin: 2,
                                  border: '1px dashed rgba(0,0,0,0.08)',
                                  borderRadius: 4,
                                }} />
                              )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div style={{
              padding: '10px 14px', borderTop: '1px solid var(--line)',
              display: 'flex', gap: 16, flexWrap: 'wrap',
              background: 'var(--bg-elev)',
            }}>
              {Object.entries(PURPOSE_COLORS).map(([label, color]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-3)' }}>
                  <div style={{ width: 3, height: 12, borderRadius: 1, background: color, flexShrink: 0 }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Overdue Tab ───────────────────────────────────────── */}
        {tab === 'overdue' && (
          overdue.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pos)', fontSize: 13, fontWeight: 500 }}>
              ✓ No accounts overdue — all clients visited within threshold
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 12 }}>
                <span style={{ color: 'var(--neg)', fontWeight: 600 }}>{keyOverdue}</span>
                {' '}Key account{keyOverdue !== 1 ? 's' : ''} overdue
                {' · '}
                <span style={{ fontWeight: 500 }}>{stdOverdue}</span>
                {' '}Standard account{stdOverdue !== 1 ? 's' : ''} overdue
              </div>

              <div style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      <th style={TH}>Client</th>
                      <th style={TH}>Industry</th>
                      <th style={TH}>Tier</th>
                      <th style={TH}>State</th>
                      <th style={TH}>Last Visit</th>
                      <th style={TH}>Days Overdue</th>
                      <th style={TH}>Rep</th>
                      <th style={TH}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.map((acc, i) => {
                      const d       = acc.days_overdue ?? 9999;
                      const dColor  =
                        d === 9999 || d > 200 ? 'var(--neg)' : 'var(--warn)';
                      const dWeight = d > 200 ? 600 : 500;
                      const dLabel  =
                        d === 9999          ? 'Never visited' :
                        d > 365             ? `${Math.floor(d / 365)}yr+` :
                        `${d}d`;
                      return (
                        <tr key={acc.id} style={{
                          borderBottom: i < overdue.length - 1
                            ? '1px solid var(--line)' : 'none',
                        }}>
                          <td style={{ ...TD, minWidth: 160 }}>
                            <Link
                              href={`/risansi/clients/${acc.code}`}
                              style={{ fontWeight: 500, color: 'var(--fg)', textDecoration: 'none' }}
                            >
                              {acc.legal_name}
                            </Link>
                            <div style={{
                              fontSize: 10, color: 'var(--fg-3)',
                              fontFamily: 'var(--font-mono)', marginTop: 1,
                            }}>
                              {acc.code}
                            </div>
                          </td>
                          <td style={TD}>{acc.industry ?? '—'}</td>
                          <td style={TD}>
                            {acc.tier
                              ? <Tag kind={acc.tier === 'Key' ? 'accent' : undefined}>{acc.tier}</Tag>
                              : '—'}
                          </td>
                          <td style={{ ...TD, color: 'var(--fg-3)' }}>{acc.state ?? '—'}</td>
                          <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                            {acc.last_visit_date ?? 'Never'}
                          </td>
                          <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: dColor, fontWeight: dWeight }}>
                            {dLabel}
                          </td>
                          <td style={{ ...TD, fontSize: 12, color: 'var(--fg-2)' }}>
                            {acc.rep_name || '—'}
                          </td>
                          <td style={TD}>
                            {/* Dispatches OPEN_VISIT_DRAWER event — picked up by AssignVisitButton's drawer */}
                            <AssignVisitRowBtn
                              clientId={acc.id}
                              clientName={acc.legal_name}
                              clientCode={acc.code}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '5px 10px', borderRadius: 20, fontSize: 12, fontWeight: 400,
  background: 'var(--bg-elev)', color: 'var(--fg-2)', border: '1px solid var(--line)',
};

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
