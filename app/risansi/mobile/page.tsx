import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentFY } from '@/lib/risansi-utils';
import Link from 'next/link';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Data shapes ────────────────────────────────────────────────

interface Rep {
  id: string;
  name: string;
  route: string | null;
  zone: string | null;
}

interface TodayVisit {
  id: string;
  client_name: string;
  client_code: string;
  industry: string;
  purpose: string | null;
  status: string;
  outcome: string | null;
}

interface OverdueClient {
  id: string;
  client_code: string;
  legal_name: string;
  days_since: number | null;
}

interface Task {
  id: string;
  title: string;
  due_date: string | null;
  priority: string | null;
}

// ── Helpers ────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Status display ─────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  'completed':  'var(--pos)',
  'checked-in': 'var(--accent)',
  'en-route':   'var(--warn)',
  'planned':    'var(--fg-3)',
  'missed':     'var(--neg)',
};

const STATUS_BG: Record<string, string> = {
  'completed':  'oklch(0.97 0.05 145)',
  'checked-in': 'var(--accent-soft)',
  'en-route':   'oklch(0.97 0.06 80)',
  'planned':    'var(--bg-elev)',
  'missed':     'oklch(0.97 0.04 15)',
};

// ── Page ───────────────────────────────────────────────────────

export default async function MobileDayPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? '';
  const fy = getCurrentFY();
  const today = todayStr();

  // Week bounds (Mon–Sun)
  const d = new Date();
  const dow  = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const weekStart = addDays(today, diff);
  const weekEnd   = addDays(weekStart, 6);

  // Get rep from DB
  const rep = await q<Rep | null>(async () => {
    const { rows } = await risansiPool.query<Rep>(
      `SELECT id, name, route, zone FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }, null);

  const repId = rep?.id ?? null;

  const [todayVisits, weekStats, ytdRevenue, overdueClients, openTasks] = await Promise.all([

    // 1. Today's visits for rep
    q<TodayVisit[]>(async () => {
      const { rows } = await risansiPool.query<TodayVisit>(`
        SELECT v.id, c.legal_name AS client_name, c.client_code, c.industry,
               v.purpose, v.status, v.outcome
        FROM visits v
        JOIN clients c ON c.id = v.client_id
        WHERE v.rep_id = $1 AND v.visit_date = $2::date
        ORDER BY v.created_at
      `, [repId, today]);
      return rows;
    }, []),

    // 2. Week compliance stats
    q<{ completed: string; missed: string }>(async () => {
      const { rows } = await risansiPool.query<{ completed: string; missed: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
          COUNT(*) FILTER (WHERE status = 'missed')::text    AS missed
        FROM visits
        WHERE rep_id = $1
          AND visit_date >= $2::date
          AND visit_date <= $3::date
      `, [repId, weekStart, weekEnd]);
      return rows[0] ?? { completed: '0', missed: '0' };
    }, { completed: '0', missed: '0' }),

    // 3. YTD revenue for quota %
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ ytd: string }>(`
        SELECT COALESCE(SUM(o.order_value), 0)::text AS ytd
        FROM orders o
        JOIN clients c ON c.id = o.client_id
        WHERE c.rep_id = $1 AND o.financial_year = $2
      `, [repId, fy.code]);
      return Number(rows[0]?.ytd ?? 0);
    }, 0),

    // 4. Overdue clients (60+ days no completed visit)
    q<OverdueClient[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; client_code: string; legal_name: string; days_since: string | null;
      }>(`
        SELECT c.id, c.client_code, c.legal_name,
               CASE
                 WHEN MAX(v.visit_date) IS NULL THEN NULL
                 ELSE EXTRACT(DAY FROM NOW() - MAX(v.visit_date)::timestamp)::int
               END::text AS days_since
        FROM clients c
        LEFT JOIN visits v ON v.client_id = c.id AND v.status = 'completed'
        WHERE c.rep_id = $1 AND c.status = 'Active'
        GROUP BY c.id
        HAVING MAX(v.visit_date) IS NULL
            OR MAX(v.visit_date) < (NOW() - INTERVAL '60 days')
        ORDER BY MAX(v.visit_date) ASC NULLS FIRST
        LIMIT 5
      `, [repId]);
      return rows.map(r => ({ ...r, days_since: r.days_since != null ? Number(r.days_since) : null }));
    }, []),

    // 5. Open tasks for rep
    q<Task[]>(async () => {
      const { rows } = await risansiPool.query<Task>(`
        SELECT id, title, due_date::text, priority
        FROM tasks
        WHERE rep_id = $1 AND status NOT IN ('completed','cancelled')
        ORDER BY due_date ASC NULLS LAST
        LIMIT 5
      `, [repId]);
      return rows;
    }, []),
  ]);

  // Derived
  const completed  = Number(weekStats.completed);
  const missed     = Number(weekStats.missed);
  const closeable  = completed + missed;
  const compliance = closeable > 0 ? Math.round((completed / closeable) * 100) : 100;

  // Quota: assumes target 1 Cr per month × 12 months — or 0 if no target configured
  const quotaTarget = 50; // Cr — placeholder; ideally from annual_targets
  const quotaPct = quotaTarget > 0 ? Math.min(Math.round((ytdRevenue / quotaTarget) * 100), 200) : 0;

  const displayName = rep?.name ?? session?.user?.name ?? email.split('@')[0];
  const firstName = displayName.split(' ')[0];

  // Today's date display
  const todayDisplay = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div style={{ paddingBottom: 16 }}>

      {/* Header */}
      <div style={{ padding: '24px 16px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', lineHeight: 1.2 }}>
          {greeting()}, {firstName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {todayDisplay}
          {rep?.zone && ` · ${rep.zone}`}
          {rep?.route && ` · ${rep.route}`}
        </div>

        {/* Stat chips */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <StatChip
            label="Today"
            value={todayVisits.length === 0 ? 'No visits' : `${todayVisits.filter(v => v.status === 'completed' || v.status === 'checked-in').length} / ${todayVisits.length}`}
            color="var(--fg)"
          />
          <StatChip
            label="Compliance"
            value={`${compliance}%`}
            color={compliance >= 80 ? 'var(--pos)' : compliance >= 60 ? 'var(--warn)' : 'var(--neg)'}
          />
          <StatChip
            label="Quota"
            value={quotaPct > 0 ? `${quotaPct}%` : '—'}
            color={quotaPct >= 100 ? 'var(--pos)' : 'var(--fg)'}
          />
        </div>
      </div>

      {/* Today's visits */}
      <div style={{ padding: '16px 16px 0' }}>
        <div style={SECTION_LABEL}>Today&rsquo;s Visits</div>
      </div>

      {todayVisits.length === 0 ? (
        <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
          No visits scheduled today
        </div>
      ) : (
        <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {todayVisits.map(v => (
            <Link key={v.id} href={`/risansi/mobile/visit/${v.id}/report`} style={{ textDecoration: 'none' }}>
              <div style={{
                background: STATUS_BG[v.status] ?? 'var(--bg-paper)',
                border: '1px solid var(--line)',
                borderRadius: 10, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--fg)', lineHeight: 1.3 }}>
                      {v.client_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {v.client_code} · {v.industry}
                    </div>
                    {v.purpose && (
                      <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 4 }}>{v.purpose}</div>
                    )}
                  </div>
                  <div style={{
                    flexShrink: 0,
                    fontSize: 11, fontWeight: 500,
                    color: STATUS_COLOR[v.status] ?? 'var(--fg-3)',
                    textTransform: 'capitalize',
                    padding: '3px 8px',
                    background: 'var(--bg-paper)',
                    border: `1px solid ${STATUS_COLOR[v.status] ?? 'var(--line)'}`,
                    borderRadius: 20,
                  }}>
                    {v.status.replace('-', ' ')}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Start new visit CTA if nothing checked in */}
      {!todayVisits.some(v => v.status === 'checked-in') && (
        <div style={{ padding: '12px 16px 0' }}>
          <Link href="/risansi/mobile/visit/new" style={{
            display: 'block', textDecoration: 'none', textAlign: 'center',
            padding: '12px', background: 'var(--accent-soft)',
            border: '1px dashed var(--accent-line)',
            borderRadius: 10, fontSize: 13,
            color: 'var(--accent)', fontWeight: 500,
          }}>
            + Start a visit
          </Link>
        </div>
      )}

      {/* Overdue alerts */}
      {overdueClients.length > 0 && (
        <div style={{ padding: '20px 16px 0' }}>
          <div style={SECTION_LABEL}>Overdue Accounts</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {overdueClients.map(c => (
              <div key={c.id} style={{
                background: 'oklch(0.97 0.04 15)',
                border: '1px solid oklch(0.88 0.07 15)',
                borderLeft: '3px solid var(--neg)',
                borderRadius: 8, padding: '10px 12px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                    {c.client_code}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--neg)', fontFamily: 'var(--font-mono)', fontWeight: 500, flexShrink: 0 }}>
                  {c.days_since != null ? `${c.days_since}d` : 'Never'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {openTasks.length > 0 && (
        <div style={{ padding: '20px 16px 0' }}>
          <div style={SECTION_LABEL}>Open Tasks</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {openTasks.map(t => (
              <div key={t.id} style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '10px 12px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}>
                <div style={{ fontSize: 13, color: 'var(--fg)', flex: 1, minWidth: 0 }}>{t.title}</div>
                {t.due_date && (
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
      borderRadius: 8, padding: '8px 12px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color, marginTop: 2, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const SECTION_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
  color: 'var(--fg-3)',
};
