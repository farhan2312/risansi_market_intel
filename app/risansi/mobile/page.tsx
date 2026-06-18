import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getGreeting, fmtCr, formatRev } from '@/lib/risansi-utils';
import { getCurrentUser, clientVisibilitySql, ownerVisibilitySql } from '@/lib/risansi-auth';
import Link from 'next/link';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface TodayVisit {
  id: string; client_name: string; code: string; industry: string | null;
  purpose: string | null; status: string;
}
interface OverdueClient { id: string; code: string; legal_name: string; days_since: number | null; }
interface Task { id: string; title: string; due_date: string | null; priority: string | null; client_name: string | null; }

// ── Status display ─────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  'completed': 'var(--pos)', 'checked-in': 'var(--accent)',
  'planned': 'var(--fg-3)', 'missed': 'var(--neg)',
};
const STATUS_BG: Record<string, string> = {
  'completed': 'var(--pos-soft)', 'checked-in': 'var(--accent-soft)',
  'planned': 'var(--bg-elev)', 'missed': 'var(--neg-soft)',
};

const FY_START = '2025-04-01', FY_END = '2026-04-01';
const PFY_START = '2024-04-01', PFY_END = '2025-04-01';

// ── Page ───────────────────────────────────────────────────────

export default async function MobileDayPage() {
  const session = await getServerSession(authOptions);
  const email   = session?.user?.email ?? '';
  const role    = session?.user?.role ?? 'rep';

  // Per-user visibility (inline ids, no params) — works for reps and managers.
  const currentUser = await getCurrentUser();
  const cVis  = clientVisibilitySql(currentUser, 'c');
  const cAnd  = cVis ? ` AND (${cVis})` : '';
  const vVis  = ownerVisibilitySql(currentUser, 'v.rep_id');
  const vAnd  = vVis ? ` AND (${vVis})` : '';
  const oVis  = ownerVisibilitySql(currentUser, 'o.rep_id');
  const oAnd  = oVis ? ` AND (${oVis})` : '';

  let repId: number | null = session?.user?.repId ?? null;
  if (repId == null && email) {
    const r = await q(async () => (await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [email])).rows[0]?.id ?? null, null);
    repId = r;
  }

  const [
    plannedToday, doneThisWeek, overdueCount, pipeline, fyRev, prevFyRev,
    annTarget, todayVisits, overdueClients, openTasks, tasksDue,
  ] = await Promise.all([

    // Visits planned for today (my scope)
    q<number>(async () => Number((await risansiPool.query<{ n: string }>(
      `SELECT COUNT(*)::text n FROM visits v WHERE v.visit_date = CURRENT_DATE AND v.status = 'planned'${vAnd}`)).rows[0]?.n ?? 0), 0),

    // Completed visits in the last 7 days
    q<number>(async () => Number((await risansiPool.query<{ n: string }>(
      `SELECT COUNT(*)::text n FROM visits v WHERE v.status IN ('completed','checked-in') AND v.visit_date >= CURRENT_DATE - INTERVAL '7 days'${vAnd}`)).rows[0]?.n ?? 0), 0),

    // Active clients overdue 90+ days
    q<number>(async () => Number((await risansiPool.query<{ n: string }>(
      `SELECT COUNT(*)::text n FROM clients c WHERE c.status='ACTIVE' AND c.deleted_at IS NULL
        AND (c.last_visit_date IS NULL OR c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')${cAnd}`)).rows[0]?.n ?? 0), 0),

    // Open pipeline value (Cr)
    q<number>(async () => Number((await risansiPool.query<{ t: string }>(
      `SELECT COALESCE(SUM(o.value_cr),0)::text t FROM opportunities o WHERE o.stage NOT IN ('Won','Lost')${oAnd}`)).rows[0]?.t ?? 0), 0),

    // FY revenue (₹) for my clients
    q<number>(async () => Number((await risansiPool.query<{ t: string }>(
      `SELECT COALESCE(SUM(crm.total_value),0)::text t FROM client_revenue_monthly crm JOIN clients c ON c.id = crm.client_id
        WHERE crm.month >= '${FY_START}' AND crm.month < '${FY_END}' AND c.deleted_at IS NULL${cAnd}`)).rows[0]?.t ?? 0), 0),

    // Previous FY revenue (for delta)
    q<number>(async () => Number((await risansiPool.query<{ t: string }>(
      `SELECT COALESCE(SUM(crm.total_value),0)::text t FROM client_revenue_monthly crm JOIN clients c ON c.id = crm.client_id
        WHERE crm.month >= '${PFY_START}' AND crm.month < '${PFY_END}' AND c.deleted_at IS NULL${cAnd}`)).rows[0]?.t ?? 0), 0),

    // Annual target (Cr) from settings
    q<number>(async () => {
      const v = parseFloat((await risansiPool.query<{ value: string }>(
        `SELECT value FROM app_settings WHERE key='annual_target_cr' LIMIT 1`)).rows[0]?.value ?? '');
      return Number.isFinite(v) && v > 0 ? v : 32;
    }, 32),

    // Today's visits list
    q<TodayVisit[]>(async () => (await risansiPool.query<TodayVisit>(
      `SELECT v.id, c.legal_name AS client_name, c.code, c.industry, v.purpose, v.status
       FROM visits v JOIN clients c ON c.id = v.client_id
       WHERE v.visit_date = CURRENT_DATE${vAnd}
       ORDER BY v.created_at`)).rows, []),

    // Overdue clients list (top 6)
    q<OverdueClient[]>(async () => (await risansiPool.query<{ id: string; code: string; legal_name: string; days_since: string | null }>(
      `SELECT c.id::text, c.code, c.legal_name,
              COALESCE(EXTRACT(DAY FROM NOW() - c.last_visit_date)::int, NULL)::text AS days_since
       FROM clients c WHERE c.status='ACTIVE' AND c.deleted_at IS NULL
        AND (c.last_visit_date IS NULL OR c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')${cAnd}
       ORDER BY c.last_visit_date ASC NULLS FIRST LIMIT 6`)).rows
      .map(r => ({ ...r, days_since: r.days_since != null ? Number(r.days_since) : null })), []),

    // Open tasks assigned to me (top 6)
    q<Task[]>(async () => repId == null ? [] : (await risansiPool.query<Task>(
      `SELECT t.id::text, t.title, t.due_date::text AS due_date, t.priority, c.legal_name AS client_name
       FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.assigned_to_rep = $1 AND t.status NOT IN ('completed','cancelled')
       ORDER BY t.due_date ASC NULLS LAST LIMIT 6`, [repId])).rows, []),

    // Tasks due today or overdue (count)
    q<number>(async () => repId == null ? 0 : Number((await risansiPool.query<{ n: string }>(
      `SELECT COUNT(*)::text n FROM tasks WHERE assigned_to_rep = $1 AND status NOT IN ('completed','cancelled')
        AND due_date IS NOT NULL AND due_date <= CURRENT_DATE`, [repId])).rows[0]?.n ?? 0), 0),
  ]);

  const fyDelta = prevFyRev > 0 ? ((fyRev - prevFyRev) / prevFyRev) * 100 : null;
  const displayName = session?.user?.name ?? email.split('@')[0];
  const firstName = (displayName ?? 'there').split(' ')[0];
  const todayDisplay = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const roleLabel = role === 'manager' ? 'Your team' : role === 'rep' ? 'Your accounts' : 'All accounts';

  return (
    <div style={{ paddingBottom: 16 }}>

      {/* Header */}
      <div style={{ padding: '22px 16px 14px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)', lineHeight: 1.2 }}>
          {getGreeting()}, {firstName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {todayDisplay} · {roleLabel}
        </div>
      </div>

      {/* ── KPI grid ── */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <Kpi label="Planned Today"  value={String(plannedToday)} accent={plannedToday > 0 ? 'var(--accent)' : 'var(--fg-3)'}
            sub={plannedToday > 0 ? 'visits to do' : 'nothing scheduled'} href="/risansi/field?tab=calendar" />
          <Kpi label="Done · 7 days"  value={String(doneThisWeek)} sub="visits completed" href="/risansi/field?tab=feed" />
          <Kpi label="Overdue"        value={String(overdueCount)} accent={overdueCount > 0 ? 'var(--neg)' : 'var(--pos)'}
            sub="90+ days no visit" href="/risansi/field?tab=overdue" />
          <Kpi label="Open Pipeline"  value={pipeline > 0 ? fmtCr(pipeline) : '—'} sub="open opportunities" href="/risansi/pipeline" />
          <Kpi label="FY 25-26 Rev"   value={fyRev > 0 ? formatRev(fyRev) : '—'}
            sub={fyDelta != null ? `${fyDelta >= 0 ? '▲ +' : '▼ '}${fyDelta.toFixed(0)}% vs LY` : `target ₹${annTarget} Cr`}
            subColor={fyDelta == null ? 'var(--fg-3)' : fyDelta >= 0 ? 'var(--pos)' : 'var(--neg)'} href="/risansi/revenue" />
          <Kpi label="Tasks Due"      value={String(tasksDue)} accent={tasksDue > 0 ? 'var(--warn)' : 'var(--pos)'}
            sub="due today / overdue" />
        </div>
      </div>

      {/* Today's visits */}
      <div style={{ padding: '18px 16px 0' }}>
        <div style={SECTION_LABEL}>Today&rsquo;s Visits</div>
      </div>
      {todayVisits.length === 0 ? (
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ padding: '18px', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)', background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 10 }}>
            No visits scheduled today
          </div>
        </div>
      ) : (
        <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {todayVisits.map(v => (
            <Link key={v.id} href={`/risansi/visits/${v.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: STATUS_BG[v.status] ?? 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--fg)', lineHeight: 1.3 }}>{v.client_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {v.code}{v.industry ? ` · ${v.industry}` : ''}
                    </div>
                    {v.purpose && <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 4 }}>{v.purpose}</div>}
                  </div>
                  <div style={{
                    flexShrink: 0, fontSize: 11, fontWeight: 500, color: STATUS_COLOR[v.status] ?? 'var(--fg-3)',
                    textTransform: 'capitalize', padding: '3px 8px', background: 'var(--bg-paper)',
                    border: `1px solid ${STATUS_COLOR[v.status] ?? 'var(--line)'}`, borderRadius: 20,
                  }}>
                    {v.status.replace('-', ' ')}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Start new visit CTA */}
      {!todayVisits.some(v => v.status === 'checked-in') && (
        <div style={{ padding: '12px 16px 0' }}>
          <Link href="/risansi/mobile/visit/new" style={{
            display: 'block', textDecoration: 'none', textAlign: 'center', padding: '12px',
            background: 'var(--accent-soft)', border: '1px dashed var(--accent-line)', borderRadius: 10,
            fontSize: 13, color: 'var(--accent)', fontWeight: 600,
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
              <Link key={c.id} href={`/risansi/clients/${c.code}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--neg-soft)', border: '1px solid var(--line)', borderLeft: '3px solid var(--neg)',
                  borderRadius: 8, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{c.code}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--neg)', fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0 }}>
                    {c.days_since != null ? `${c.days_since}d` : 'Never'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {openTasks.length > 0 && (
        <div style={{ padding: '20px 16px 0' }}>
          <div style={SECTION_LABEL}>Open Tasks</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {openTasks.map(t => {
              const overdue = !!t.due_date && new Date(t.due_date + 'T00:00:00') < new Date(new Date().toDateString());
              return (
                <div key={t.id} style={{
                  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--fg)' }}>{t.title}</div>
                    {t.client_name && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{t.client_name}</div>}
                  </div>
                  {t.due_date && (
                    <div style={{ fontSize: 11, color: overdue ? 'var(--neg)' : 'var(--fg-3)', fontFamily: 'var(--font-mono)', flexShrink: 0, fontWeight: overdue ? 600 : 400 }}>
                      {new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Kpi({ label, value, sub, accent, subColor, href }: {
  label: string; value: string; sub?: string; accent?: string; subColor?: string; href?: string;
}) {
  const body = (
    <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 12px 11px' }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color: accent ?? 'var(--fg)', marginTop: 4, lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: subColor ?? 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{body}</Link> : body;
}

const SECTION_LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.10em', color: 'var(--fg-3)',
};
