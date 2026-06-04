import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth/next';
import { Topbar, Tag } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { IndiaMapWrapper } from '@/components/risansi/IndiaMapWrapper';
import { ClientCoverageList } from '@/components/risansi/ClientCoverageList';
import { WeekNav } from '@/components/risansi/WeekNav';
import { MonthNav } from '@/components/risansi/MonthNav';
import { AssignVisitButton } from '@/components/risansi/AssignVisitButton';
import AssignVisitDrawer, { AssignVisitRowBtn } from '@/components/risansi/AssignVisitDrawer';
import type { DrawerRep } from '@/components/risansi/AssignVisitDrawer';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Types ──────────────────────────────────────────────────────

interface VisitFeedRow {
  id: string; visit_date: string; status: string; purpose: string | null;
  outcome: string | null; summary: string | null; performance_feedback: string | null;
  action_points: string | null;
  check_in_time: string | null; submitted_at: string | null;
  client_id: string; legal_name: string; code: string; industry: string | null;
  city: string | null; tier: string | null;
  rep_name: string;
}

interface OverdueRow {
  id: string; code: string; legal_name: string;
  industry: string | null; tier: string | null; status: string;
  state: string | null; city: string | null;
  last_visit_date: string | null; days_overdue: number | null;
  rep_name: string;
}

interface CalendarVisit {
  id: string; visit_date: string; status: string; purpose: string;
  outcome: string | null;
  client_id: string; client_name: string; client_code: string;
  industry: string | null; city: string | null; tier: string | null;
  rep_id: string; rep_name: string;
}

interface MapClient {
  id: string; code: string; legal_name: string;
  industry: string | null; city: string | null; state: string | null;
  country: string | null;
  last_visit_date: string | null; days_since: number | null;
  tier: string | null; rep_name: string | null;
}

interface StatsRow {
  total_active: number; visited_fy: number; overdue: number; never_visited: number;
}

// ── Constants ──────────────────────────────────────────────────

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

const SORT_MAP: Record<string, string> = {
  name:         'c.legal_name',
  days_overdue: 'days_overdue',
  last_visit:   'c.last_visit_date',
  rep:          'rep_name',
};

// ── Page ───────────────────────────────────────────────────────

export default async function FieldActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  const isRep   = role === 'rep';

  const sp         = await searchParams;
  const tab        = typeof sp.tab  === 'string' ? sp.tab  : 'calendar';
  const feedTab    = typeof sp.feed === 'string' ? sp.feed : 'today';
  const sortKey    = typeof sp.sort === 'string' ? sp.sort : 'days_overdue';
  const sortDir    = sp.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol    = SORT_MAP[sortKey] ?? 'days_overdue';
  const weekOffset  = parseInt(typeof sp.week  === 'string' ? sp.week  : '0', 10) || 0;
  const monthOffset = parseInt(typeof sp.month === 'string' ? sp.month : '0', 10) || 0;

  // ── Date range computation ───────────────────────────────────

  const todayDate = new Date();
  const todayISO  = dateStr(todayDate);

  // Week bounds (for admin calendar)
  const dow  = todayDate.getDay();
  const mon  = new Date(todayDate);
  mon.setDate(todayDate.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const weekStart = dateStr(mon);
  const weekEnd   = dateStr(sun);
  const weekLabel = `${mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const weekDays  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds = dateStr(d);
    return {
      date:    ds,
      label:   d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      isToday: ds === todayISO,
    };
  });

  // Month bounds (for rep calendar)
  const mDate     = new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1);
  const mNext     = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 1);
  const monthStart = dateStr(mDate);
  const monthEnd   = dateStr(mNext);
  const monthLabel = mDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const daysInMonth    = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate();
  const firstDayOffset = (mDate.getDay() + 6) % 7; // 0=Mon
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(mDate.getFullYear(), mDate.getMonth(), i + 1);
    const ds = dateStr(d);
    return {
      date:      ds,
      dayNum:    i + 1,
      isToday:   ds === todayISO,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });

  // ── Rep lookup ───────────────────────────────────────────────

  // Prefer the session's linked rep_id; fall back to email lookup for reps
  // approved before rep-linking existed.
  let repId: string | null = session?.user?.repId != null ? String(session.user.repId) : null;
  if (isRep && !repId && session?.user?.email) {
    const { rows } = await risansiPool.query<{ id: string }>(
      `SELECT id FROM reps WHERE email = $1 LIMIT 1`,
      [session.user.email],
    );
    repId = rows[0]?.id ?? null;
  }

  // ── Queries ──────────────────────────────────────────────────

  const [feed, overdue, calendarVisits, calendarReps, mapClients, stats] = await Promise.all([

    // 1. Visit feed — filtered by sub-tab (upcoming / today / past)
    q<VisitFeedRow[]>(async () => {
      const repCond = (isRep && repId) ? `AND r.id = $1` : '';
      const params  = (isRep && repId) ? [repId] : [];
      const filter =
        feedTab === 'upcoming' ? `v.status = 'planned' AND v.visit_date >= CURRENT_DATE`
        : feedTab === 'today'  ? `v.visit_date = CURRENT_DATE`
        : `(v.visit_date < CURRENT_DATE OR v.status = 'completed')`;
      const orderBy =
        feedTab === 'upcoming' ? `v.visit_date ASC`
        : feedTab === 'today'  ? `v.check_in_time ASC NULLS LAST`
        : `v.visit_date DESC, v.created_at DESC`;
      const { rows } = await risansiPool.query<VisitFeedRow>(
        `SELECT
           v.id,
           v.visit_date::text          AS visit_date,
           v.status,
           COALESCE(v.purpose, '')     AS purpose,
           v.outcome,
           v.summary,
           v.performance_feedback,
           LEFT(v.action_points, 100)  AS action_points,
           v.check_in_time::text       AS check_in_time,
           v.submitted_at::text        AS submitted_at,
           c.id::text                  AS client_id,
           c.legal_name,
           c.code,
           c.industry,
           c.city,
           c.tier,
           COALESCE(r.name, '—')       AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE ${filter} ${repCond}
         ORDER BY ${orderBy}
         LIMIT 50`,
        params,
      );
      return rows;
    }, []),

    // 2. Overdue accounts
    q<OverdueRow[]>(async () => {
      const repCond = (isRep && repId) ? `AND c.primary_rep_id = $1` : '';
      const params  = (isRep && repId) ? [repId] : [];
      const { rows } = await risansiPool.query<OverdueRow>(
        `SELECT
           c.id::text, c.code, c.legal_name, c.industry, c.tier, c.status,
           c.state, c.city, c.last_visit_date::text,
           CASE
             WHEN c.last_visit_date IS NULL THEN NULL
             ELSE (CURRENT_DATE - c.last_visit_date)
           END AS days_overdue,
           COALESCE(r.name, c.primary_rep_name, '—') AS rep_name
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE c.status = 'ACTIVE'
           AND c.deleted_at IS NULL
           -- exclude future dates (planned visits that leaked into last_visit_date)
           AND (c.last_visit_date IS NULL OR c.last_visit_date <= CURRENT_DATE)
           AND (
             c.last_visit_date IS NULL OR
             c.last_visit_date < CURRENT_DATE - INTERVAL '90 days'
           )
           ${repCond}
         ORDER BY ${sortCol} ${sortDir} NULLS FIRST
         LIMIT 200`,
        params,
      );
      return rows;
    }, []),

    // 3. Calendar visits (week for admin, month for rep)
    q<CalendarVisit[]>(async () => {
      const [from, to] = isRep ? [monthStart, monthEnd] : [weekStart, weekEnd];
      const repCond    = (isRep && repId) ? `AND r.id = $3` : '';
      const params: (string | null)[] = isRep && repId ? [from, to, repId] : [from, to];
      const { rows } = await risansiPool.query<CalendarVisit>(
        `SELECT
           v.id::text,
           v.visit_date::text          AS visit_date,
           v.status,
           COALESCE(v.purpose, '')     AS purpose,
           v.outcome,
           c.id::text                  AS client_id,
           c.legal_name                AS client_name,
           c.code                      AS client_code,
           c.industry, c.city, c.tier,
           COALESCE(r.id::text, '')    AS rep_id,
           COALESCE(r.name, '—')       AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE v.visit_date >= $1
           AND v.visit_date < $2
           ${repCond}
         ORDER BY v.visit_date ASC, v.created_at ASC NULLS LAST`,
        params,
      );
      return rows;
    }, []),

    // 4. Reps list (admin only, for week grid + AssignVisit)
    q<DrawerRep[]>(async () => {
      if (isRep) return [];
      const { rows } = await risansiPool.query<{ id: string; name: string; route: string | null }>(
        `SELECT id::text AS id, name, route FROM reps WHERE is_active = TRUE ORDER BY name ASC`,
      );
      return rows;
    }, []),

    // 5. Map data
    q<MapClient[]>(async () => {
      const repCond = (isRep && repId) ? `AND c.primary_rep_id = $1` : '';
      const params  = (isRep && repId) ? [repId] : [];
      const { rows } = await risansiPool.query<MapClient>(
        `SELECT
           c.id::text, c.code, c.legal_name,
           c.industry, c.city, c.state, c.country,
           c.last_visit_date::text,
           EXTRACT(DAY FROM NOW() - c.last_visit_date)::int AS days_since,
           c.tier,
           COALESCE(r.name, c.primary_rep_name) AS rep_name
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL ${repCond}
         ORDER BY c.last_visit_date ASC NULLS FIRST`,
        params,
      );
      return rows;
    }, []),

    // 6. Stats
    q<StatsRow>(async () => {
      const repCond = (isRep && repId) ? `AND primary_rep_id = $1` : '';
      const params  = (isRep && repId) ? [repId] : [];
      const { rows } = await risansiPool.query<{
        total_active: string; visited_fy: string; overdue: string; never_visited: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::text                                        AS total_active,
           COUNT(*) FILTER (WHERE status = 'ACTIVE'
             AND last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text                      AS visited_fy,
           COUNT(*) FILTER (WHERE status = 'ACTIVE'
             AND (last_visit_date IS NULL
               OR last_visit_date < CURRENT_DATE - INTERVAL '90 days'))::text                     AS overdue,
           COUNT(*) FILTER (WHERE status = 'ACTIVE'
             AND last_visit_date IS NULL)::text                                                    AS never_visited
         FROM clients
         WHERE deleted_at IS NULL ${repCond}`,
        params,
      );
      const r = rows[0];
      return {
        total_active:  Number(r?.total_active  ?? 0),
        visited_fy:    Number(r?.visited_fy    ?? 0),
        overdue:       Number(r?.overdue       ?? 0),
        never_visited: Number(r?.never_visited ?? 0),
      };
    }, { total_active: 0, visited_fy: 0, overdue: 0, never_visited: 0 }),
  ]);

  // ── Derived ──────────────────────────────────────────────────

  const INDIAN_STATES = new Set([
    'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu And Kashmir', 'Jharkhand', 'Karnataka', 'Kerala',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Dadra & Nagar Haveli',
  ]);
  const indiaMapClients = mapClients.filter(c => c.state && INDIAN_STATES.has(c.state));
  const intlMapClients  = mapClients.filter(c => !c.state || !INDIAN_STATES.has(c.state));

  // Calendar stats (for week view header)
  const calPlanned   = calendarVisits.filter(v => v.status !== 'cancelled').length;
  const calCompleted = calendarVisits.filter(v => v.status === 'completed').length;
  const calPct       = calPlanned > 0 ? Math.round((calCompleted / calPlanned) * 100) : 0;

  function tabHref(t: string, extra?: Record<string, string>) {
    const p = new URLSearchParams({ tab: t, ...extra });
    return `/risansi/field?${p.toString()}`;
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Field Activity']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Field Activity
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {isRep ? 'Your visits and clients' : 'All reps · visits and coverage'}
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <StatCard label="Total Active"     value={stats.total_active} />
          <StatCard label="Visited (Last 90d)" value={stats.visited_fy} color="var(--pos)" />
          <StatCard label="Overdue (90d+)"   value={stats.overdue}      color="var(--warn)" />
          <StatCard label="Never Visited"    value={stats.never_visited} color="var(--neg)" />
        </div>

        {/* AssignVisit drawer — always mounted for overdue row buttons (rep locked to self) */}
        <div style={{ display: 'none' }}>
          <AssignVisitDrawer reps={calendarReps} hideButton={true} role={role} repId={repId ?? undefined} currentUserName={session?.user?.name ?? undefined} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 18, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
          {[
            { id: 'calendar', label: 'Calendar' },
            { id: 'feed',     label: 'Visit Feed' },
            { id: 'overdue',  label: `Overdue (${stats.overdue.toLocaleString('en-IN')})` },
            { id: 'map',      label: 'Map' },
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

        {/* ── Tab: Visit Feed ──────────────────────────────────── */}
        {tab === 'feed' && (
          <div>
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
              {[
                { id: 'upcoming', label: 'Upcoming' },
                { id: 'today',    label: 'Today' },
                { id: 'past',     label: 'Past' },
              ].map(st => (
                <a key={st.id} href={tabHref('feed', { feed: st.id })} style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12,
                  fontWeight: feedTab === st.id ? 600 : 400,
                  textDecoration: 'none',
                  color: feedTab === st.id ? '#0A3D8F' : 'var(--fg-3)',
                  background: feedTab === st.id ? '#EBF1FB' : 'transparent',
                  border: `1px solid ${feedTab === st.id ? '#1A5CB8' : 'var(--line)'}`,
                }}>
                  {st.label}
                </a>
              ))}
            </div>

            {feed.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--fg-3)', fontSize: 13 }}>
                {feedTab === 'upcoming' ? 'No upcoming visits planned'
                  : feedTab === 'today' ? 'No visits scheduled today'
                  : 'No past visits'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {feed.map(v => {
                  const statusKind = v.status === 'completed' ? 'pos' : v.status === 'checked-in' ? 'info' : 'warn';
                  const isClosed   = !!v.submitted_at;
                  const cta        = isClosed ? '🔒 View Report'
                    : v.check_in_time ? 'Continue Report →' : 'Start Report →';
                  return (
                    <Link key={v.id} href={`/risansi/visits/${v.id}`} style={{ ...FEED_CARD, display: 'block', textDecoration: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: v.outcome || v.summary ? 8 : 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--fg)' }}>{v.legal_name}</span>
                            {v.tier && <Tag kind="accent">{v.tier}</Tag>}
                            {v.industry && <Tag>{v.industry}</Tag>}
                            <Tag kind={statusKind}>{v.status}</Tag>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                            {v.rep_name} · {v.visit_date} {v.city ? `· ${v.city}` : ''}{v.purpose ? ` · ${v.purpose}` : ''}
                          </div>
                        </div>
                        <div style={{
                          fontSize: 11, flexShrink: 0, fontWeight: 500,
                          color: isClosed ? 'var(--fg-3)' : '#0A3D8F',
                        }}>
                          {cta}
                        </div>
                      </div>
                      {(v.outcome || v.summary) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {v.outcome && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                              <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>Outcome: </span>{v.outcome}
                            </div>
                          )}
                          {v.summary && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                              <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>Summary: </span>{v.summary}
                            </div>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Calendar ────────────────────────────────────── */}
        {tab === 'calendar' && (
          !isRep ? (
            /* ─── ADMIN / MANAGER: Week Grid ─── */
            <div>
              {/* Calendar header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Week of {weekLabel}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <span style={CHIP}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{calPlanned}</span>
                      {' '}visits
                    </span>
                    <span style={{
                      ...CHIP,
                      color: calPct >= 80 ? '#065F46' : calPct >= 50 ? '#92400E' : '#9B1C1C',
                      background: calPct >= 80 ? '#D1FAE5' : calPct >= 50 ? '#FEF3C7' : '#FEE2E2',
                      borderColor: calPct >= 80 ? '#6EE7B7' : calPct >= 50 ? '#FCD34D' : '#FCA5A5',
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{calPct}%</span>
                      {' '}done
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <AssignVisitButton reps={calendarReps} role={role} repId={repId ?? undefined} currentUserName={session?.user?.name ?? undefined} />
                  <WeekNav currentOffset={weekOffset} />
                </div>
              </div>

              {/* Week grid */}
              <div style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{
                          width: 140, padding: '10px 12px', textAlign: 'left',
                          background: 'var(--bg-elev)', borderBottom: '2px solid var(--line)',
                          borderRight: '1px solid var(--line)',
                          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                          fontWeight: 600, color: 'var(--fg-3)',
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
                      {calendarReps.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                            No active reps
                          </td>
                        </tr>
                      ) : calendarReps.map(rep => (
                        <tr key={rep.id}>
                          <td style={{
                            padding: '8px 10px', verticalAlign: 'top',
                            borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)',
                            background: 'var(--bg-paper)',
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{rep.name}</div>
                            {rep.route && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{rep.route}</div>}
                          </td>
                          {weekDays.map(day => {
                            const dayVisits = calendarVisits.filter(v => v.rep_id === rep.id && v.visit_date === day.date);
                            return (
                              <td key={day.date} style={{
                                padding: 4, verticalAlign: 'top',
                                background: day.isToday ? 'rgba(235,241,251,0.45)' : 'transparent',
                                borderBottom: '1px solid var(--line)',
                                borderRight: '1px solid rgba(0,0,0,0.04)', minHeight: 60,
                              }}>
                                {dayVisits.length > 0
                                  ? dayVisits.map(v => <CalendarVisitCard key={v.id} visit={v} />)
                                  : <div style={{ height: 50, margin: 2, border: '1px dashed rgba(0,0,0,0.08)', borderRadius: 4 }} />
                                }
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
                  display: 'flex', gap: 16, flexWrap: 'wrap', background: 'var(--bg-elev)',
                }}>
                  {Object.entries(PURPOSE_COLORS).map(([label, color]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-3)' }}>
                      <div style={{ width: 3, height: 12, borderRadius: 1, background: color, flexShrink: 0 }} />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ─── REP: Month Grid ─── */
            <div>
              {/* Month header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 16,
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
                  {monthLabel}
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--fg-3)', marginLeft: 10 }}>
                    {calendarVisits.length} visit{calendarVisits.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <AssignVisitButton reps={calendarReps} role={role} repId={repId ?? undefined} currentUserName={session?.user?.name ?? undefined} />
                  <MonthNav currentOffset={monthOffset} />
                </div>
              </div>

              {/* Month grid */}
              <div style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                {/* Day headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d} style={{
                      padding: '8px', textAlign: 'center', fontSize: 11,
                      fontWeight: 600, color: 'var(--fg-3)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{d}</div>
                  ))}
                </div>

                {/* Calendar cells */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  {/* Leading empty cells */}
                  {Array.from({ length: firstDayOffset }).map((_, i) => (
                    <div key={`e-${i}`} style={{
                      minHeight: 90, background: 'var(--bg-elev)',
                      borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)',
                    }} />
                  ))}

                  {/* Day cells */}
                  {monthDays.map(day => {
                    const dayVisits = calendarVisits.filter(v => v.visit_date === day.date);
                    return (
                      <div key={day.date} style={{
                        minHeight: 90, padding: 6,
                        borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)',
                        background: day.isToday ? 'rgba(235,241,251,0.6)' : day.isWeekend ? 'var(--bg-elev)' : 'var(--bg-paper)',
                      }}>
                        {/* Day number */}
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', marginBottom: 4,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: day.isToday ? 700 : 400,
                          background: day.isToday ? '#1A5CB8' : 'transparent',
                          color: day.isToday ? '#fff' : 'var(--fg-3)',
                        }}>
                          {day.dayNum}
                        </div>

                        {/* Visit cards */}
                        {dayVisits.map(v => <CalendarVisitCard key={v.id} visit={v} compact />)}

                        {/* Empty placeholder */}
                        {dayVisits.length === 0 && !day.isWeekend && (
                          <div style={{ height: 16, border: '1px dashed rgba(0,0,0,0.08)', borderRadius: 3, opacity: 0.5 }} />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div style={{
                  padding: '10px 14px', borderTop: '1px solid var(--line)',
                  display: 'flex', gap: 16, flexWrap: 'wrap', background: 'var(--bg-elev)',
                }}>
                  {Object.entries(STATUS_BG).slice(0, 4).map(([status, bg]) => (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-3)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: bg, border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                      {status}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}

        {/* ── Tab: Overdue ─────────────────────────────────────── */}
        {tab === 'overdue' && (
          stats.overdue === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pos)', fontSize: 13, fontWeight: 500 }}>
              ✓ All clients visited within 90 days
            </div>
          ) : (
            <>
              {stats.overdue > 200 && (
                <div style={{ fontSize: 11, color: 'var(--fg-3)', padding: '0 0 12px', textAlign: 'right' }}>
                  Showing first 200 of {stats.overdue.toLocaleString('en-IN')}
                </div>
              )}

              <div style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      <th style={TH}>Client</th>
                      <th style={TH}>Industry</th>
                      <th style={TH}>State</th>
                      <th style={TH}>Tier</th>
                      <th style={TH}>Rep</th>
                      <OverdueSortTH col="last_visit"   label="Last Visit"   curSort={sortKey} curDir={sortDir} />
                      <OverdueSortTH col="days_overdue" label="Days Overdue" curSort={sortKey} curDir={sortDir} />
                      <th style={TH}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.map((acc, i) => {
                      const d      = acc.days_overdue;
                      const dColor = d == null || d > 365 ? 'var(--neg)' : d > 180 ? 'oklch(0.55 0.18 50)' : 'var(--warn)';
                      return (
                        <tr key={acc.id} style={{ borderBottom: i < overdue.length - 1 ? '1px solid var(--line)' : 'none' }}>
                          <td style={{ ...TD, minWidth: 160 }}>
                            <Link href={`/risansi/clients/${acc.code}`}
                              style={{ fontWeight: 500, color: 'var(--fg)', textDecoration: 'none' }}>
                              {acc.legal_name}
                            </Link>
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                              {acc.code}
                            </div>
                          </td>
                          <td style={TD}>{acc.industry ?? '—'}</td>
                          <td style={{ ...TD, color: 'var(--fg-3)' }}>{acc.state ?? '—'}</td>
                          <td style={TD}>
                            {acc.tier ? <Tag kind={acc.tier === 'Key' ? 'accent' : undefined}>{acc.tier}</Tag> : '—'}
                          </td>
                          <td style={{ ...TD, fontSize: 11, color: 'var(--fg-2)' }}>{acc.rep_name}</td>
                          <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                            {acc.last_visit_date ?? <span style={{ color: 'var(--neg)' }}>Never</span>}
                          </td>
                          <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: dColor, fontWeight: 500 }}>
                            {d == null ? '—' : d > 365 ? '1yr+' : `${d}d`}
                          </td>
                          <td style={TD}>
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

        {/* ── Tab: Map ─────────────────────────────────────────── */}
        {tab === 'map' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
            <div>
              <IndiaMapWrapper clients={indiaMapClients.map(c => ({
                id:              c.id,
                legal_name:      c.legal_name,
                city:            c.city,
                state:           c.state,
                last_visit_date: c.last_visit_date,
                tier:            c.tier,
                rep_name:        c.rep_name ?? '',
              }))} />
              <InternationalPanel clients={intlMapClients} />
            </div>
            <ClientCoverageList clients={mapClients.map(c => ({
              id:              c.id,
              code:            c.code,
              legal_name:      c.legal_name,
              city:            c.city,
              state:           c.state,
              country:         c.country,
              industry:        c.industry,
              tier:            c.tier,
              last_visit_date: c.last_visit_date,
              rep_name:        c.rep_name,
            }))} />
          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function CalendarVisitCard({ visit, compact = false }: { visit: CalendarVisit; compact?: boolean }) {
  const color = PURPOSE_COLORS[visit.purpose] ?? '#6B7FA3';
  const bg    = STATUS_BG[visit.status] ?? 'var(--bg-elev)';
  const statusColor =
    visit.status === 'completed'  ? '#065F46' :
    visit.status === 'missed'     ? '#9B1C1C' :
    visit.status === 'checked-in' ? '#1E40AF' :
    'var(--fg-3)';

  return (
    <Link
      href={`/risansi/clients/${visit.client_code}`}
      style={{
        display: 'block', margin: '2px', padding: compact ? '3px 5px' : '5px 7px',
        borderRadius: 4, borderLeft: `3px solid ${color}`,
        background: bg, textDecoration: 'none',
      }}
    >
      <div style={{
        fontSize: compact ? 10 : 11, fontWeight: 600, color: 'var(--fg)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: compact ? 100 : 130,
      }}>
        {visit.client_name}
      </div>
      {!compact && (
        <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>
          {visit.purpose || 'Visit'}
        </div>
      )}
      <div style={{ marginTop: 2 }}>
        <span style={{
          fontSize: 9, fontWeight: 600, textTransform: 'uppercase' as const,
          letterSpacing: '0.06em', color: statusColor,
        }}>
          {visit.status}
        </span>
      </div>
    </Link>
  );
}

function InternationalPanel({ clients }: { clients: MapClient[] }) {
  if (clients.length === 0) return null;

  const grouped: Record<string, MapClient[]> = {};
  clients.forEach(c => {
    const region = c.state || c.country || 'Unknown';
    if (!grouped[region]) grouped[region] = [];
    grouped[region].push(c);
  });

  const now = Date.now();

  return (
    <div style={{
      marginTop: 12, background: 'var(--bg-paper)',
      border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0A3D8F' }}>
          International Clients
        </span>
        <span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: 'auto' }}>
          {clients.length} clients · {Object.keys(grouped).length} regions
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)' }}>
        {Object.entries(grouped)
          .sort((a, b) => b[1].length - a[1].length)
          .map(([region, regionClients]) => (
            <div key={region} style={{ padding: '10px 14px', background: 'var(--bg-paper)' }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: '#0A3D8F',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
              }}>
                {region} ({regionClients.length})
              </div>
              {regionClients.slice(0, 4).map(c => {
                const days = c.last_visit_date
                  ? Math.floor((now - new Date(c.last_visit_date).getTime()) / 86_400_000)
                  : null;
                // null OR future date → treat as never visited (red)
                const dot = days === null || days < 0 ? '#DC2626' : days <= 90 ? '#0E9F6E' : '#D97706';
                return (
                  <div key={c.id} style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.legal_name}</span>
                  </div>
                );
              })}
              {regionClients.length > 4 && (
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                  +{regionClients.length - 4} more
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg-paper)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: color ?? 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}

function OverdueSortTH({ col, label, curSort, curDir }: {
  col: string; label: string; curSort: string; curDir: string;
}) {
  const isActive = curSort === col;
  const nextDir  = isActive && curDir === 'DESC' ? 'asc' : 'desc';
  return (
    <th style={{ ...TH, cursor: 'pointer' }}>
      <a href={`/risansi/field?tab=overdue&sort=${col}&dir=${nextDir}`}
         style={{ textDecoration: 'none', color: isActive ? 'var(--accent)' : 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}>
        {label}
        {isActive && <span>{curDir === 'DESC' ? '↓' : '↑'}</span>}
      </a>
    </th>
  );
}

// ── Style constants ────────────────────────────────────────────

const FEED_CARD: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', padding: '14px 16px',
};

const CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '4px 10px', borderRadius: 20, fontSize: 12,
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
