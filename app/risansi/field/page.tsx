import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth/next';
import { Topbar, Tag } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { IndiaMapWrapper } from '@/components/risansi/IndiaMapWrapper';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function addDays(s: string, n: number): string {
  const [y, m, day] = s.split('-').map(Number);
  const d = new Date(y, m-1, day+n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

interface VisitFeedRow {
  id: string; visit_date: string; status: string; purpose: string | null;
  outcome: string | null; summary: string | null; performance_feedback: string | null;
  action_points: string | null;
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

interface MapClient {
  id: string; code: string; legal_name: string;
  industry: string | null; city: string | null; state: string | null;
  last_visit_date: string | null; days_since: number | null;
  tier: string | null; rep_name: string | null;
}

interface StatsRow {
  total_active: number; visited_fy: number; overdue: number; never_visited: number;
}

const SORT_MAP: Record<string, string> = {
  name:         'c.legal_name',
  days_overdue: 'days_overdue',
  last_visit:   'c.last_visit_date',
  rep:          'rep_name',
};

export default async function FieldActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  const isRep   = role === 'rep';

  const sp      = await searchParams;
  const tab     = typeof sp.tab === 'string' ? sp.tab : 'feed';
  const sortKey = typeof sp.sort === 'string' ? sp.sort : 'days_overdue';
  const sortDir = sp.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol = SORT_MAP[sortKey] ?? 'days_overdue';

  const today    = todayStr();
  const monthAgo = addDays(today, -30);

  // Resolve rep id if role = rep
  let repId: string | null = null;
  if (isRep && session?.user?.email) {
    const { rows } = await risansiPool.query<{ id: string }>(
      `SELECT id FROM reps WHERE email = $1 LIMIT 1`,
      [session.user.email],
    );
    repId = rows[0]?.id ?? null;
  }

  const [feed, overdue, mapClients, stats] = await Promise.all([

    // Visit Feed — last 50 non-planned visits
    q<VisitFeedRow[]>(async () => {
      const repCond = (isRep && repId) ? `AND r.id = $1` : '';
      const params  = (isRep && repId) ? [repId] : [];
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
         WHERE v.status != 'planned' ${repCond}
         ORDER BY v.visit_date DESC, v.created_at DESC
         LIMIT 50`,
        params,
      );
      return rows;
    }, []),

    // Overdue accounts
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

    // Map data
    q<MapClient[]>(async () => {
      const repCond = (isRep && repId) ? `AND c.primary_rep_id = $1` : '';
      const params  = (isRep && repId) ? [repId] : [];
      const { rows } = await risansiPool.query<MapClient>(
        `SELECT
           c.id::text, c.code, c.legal_name,
           c.industry, c.city, c.state,
           c.last_visit_date::text,
           EXTRACT(DAY FROM NOW() - c.last_visit_date)::int AS days_since,
           c.tier,
           COALESCE(r.name, c.primary_rep_name) AS rep_name
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL ${repCond}`,
        params,
      );
      return rows;
    }, []),

    // Stats
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
        total_active:   Number(r?.total_active   ?? 0),
        visited_fy:     Number(r?.visited_fy     ?? 0),
        overdue:        Number(r?.overdue        ?? 0),
        never_visited:  Number(r?.never_visited  ?? 0),
      };
    }, { total_active: 0, visited_fy: 0, overdue: 0, never_visited: 0 }),
  ]);

  function tabHref(t: string) { return `/risansi/field?tab=${t}`; }

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
          <StatCard label="Total Active" value={stats.total_active} />
          <StatCard label="Visited (Last 90d)" value={stats.visited_fy} color="var(--pos)" />
          <StatCard label="Overdue (90d+)" value={stats.overdue} color="var(--warn)" />
          <StatCard label="Never Visited" value={stats.never_visited} color="var(--neg)" />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 18, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
          {[
            { id: 'feed',    label: 'Visit Feed' },
            { id: 'overdue', label: `Overdue (${stats.overdue.toLocaleString('en-IN')})` },
            { id: 'map',     label: 'Map' },
          ].map(t => (
            <a key={t.id} href={tabHref(t.id)} style={{
              display: 'block',
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.1s',
            }}>
              {t.label}
            </a>
          ))}
        </div>

        {/* ── Tab: Visit Feed ────────────────────────────────────── */}
        {tab === 'feed' && (
          feed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--fg-3)', fontSize: 13 }}>
              No completed visits yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {feed.map(v => {
                const statusKind = v.status === 'completed' ? 'pos' : v.status === 'checked-in' ? 'info' : 'warn';
                const pfKind     = v.performance_feedback?.toLowerCase().includes('good') ? 'pos'
                                 : v.performance_feedback?.toLowerCase().includes('poor') ? 'neg' : 'warn';
                return (
                  <div key={v.id} style={FEED_CARD}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Link href={`/risansi/clients/${v.code}`}
                            style={{ fontWeight: 500, fontSize: 13, color: 'var(--fg)', textDecoration: 'none' }}>
                            {v.legal_name}
                          </Link>
                          {v.tier && <Tag kind="accent">{v.tier}</Tag>}
                          {v.industry && <Tag>{v.industry}</Tag>}
                          <Tag kind={statusKind}>{v.status}</Tag>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                          {v.rep_name} · {v.visit_date} {v.city ? `· ${v.city}` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', flexShrink: 0 }}>
                        {v.purpose}
                      </div>
                    </div>

                    {/* Content */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 40 }}>
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
                      {v.performance_feedback && (
                        <div style={{ marginTop: 2 }}>
                          <Tag kind={pfKind}>Feedback: {v.performance_feedback}</Tag>
                        </div>
                      )}
                      {v.action_points && (
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                          → {v.action_points}{v.action_points.length >= 100 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── Tab: Overdue ───────────────────────────────────────── */}
        {tab === 'overdue' && (
          stats.overdue === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pos)', fontSize: 13, fontWeight: 500 }}>
              ✓ All clients visited within 90 days
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', overflow: 'hidden',
            }}>
              {stats.overdue > 200 && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
                  Showing first 200 of {stats.overdue.toLocaleString('en-IN')} overdue clients
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <th style={TH}>Client</th>
                    <th style={TH}>Industry</th>
                    <th style={TH}>State</th>
                    <th style={TH}>Rep</th>
                    <OverdueSortTH col="last_visit"   label="Last Visit"    curSort={sortKey} curDir={sortDir} />
                    <OverdueSortTH col="days_overdue" label="Days Overdue"  curSort={sortKey} curDir={sortDir} />
                    <th style={TH}>Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((acc, i) => {
                    const d = acc.days_overdue;
                    const dColor = d == null || d > 365 ? 'var(--neg)' : d > 180 ? 'oklch(0.55 0.18 50)' : 'var(--warn)';
                    return (
                      <tr key={acc.id} style={{ borderBottom: i < overdue.length-1 ? '1px solid var(--line)' : 'none' }}>
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
                        <td style={{ ...TD, fontSize: 12, color: 'var(--fg-2)' }}>
                          {acc.rep_name || '—'}
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                          {acc.last_visit_date ?? 'Never'}
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: dColor, fontWeight: 500 }}>
                          {d == null ? 'Never visited' : `${d}d`}
                        </td>
                        <td style={TD}>
                          {acc.tier ? <Tag kind={acc.tier === 'Key' ? 'accent' : undefined}>{acc.tier}</Tag> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── Tab: Map ───────────────────────────────────────────── */}
        {tab === 'map' && (
          <IndiaMapWrapper clients={mapClients.map(c => ({
            id:              c.id,
            legal_name:      c.legal_name,
            city:            c.city,
            state:           c.state,
            last_visit_date: c.last_visit_date,
            tier:            c.tier,
            rep_name:        c.rep_name ?? '',
          }))} />
        )}

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

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

const FEED_CARD: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', padding: '14px 16px',
};

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
