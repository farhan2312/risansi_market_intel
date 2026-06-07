import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Donut } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { formatRev } from '@/lib/risansi-utils';
import { RevenueTopClients, type RevenueClientRow } from '@/components/risansi/RevenueTopClients';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

const INR_TO_L = 100_000;
const CUR_FY_START = '2025-04-01';
const CUR_FY_END   = '2026-04-01';
const PREV_FY_START = '2024-04-01';
const PREV_FY_END   = '2025-04-01';

// 'YYYY-MM-01' + n months (n may be negative)
function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function monthLabel(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
function monthLabelLong(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function fyLabel(start: number): string {
  return `FY ${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

interface ByIndustry { industry: string; clients: number; pump: number; spare: number; total: number; }
interface ByRep { rep: string; zone: string | null; clients: number; total: number; target_cr: number | null; }
interface ByCat { category: string; clients: number; total: number; }
interface YoY { fyStart: number; pump: number; spare: number; total: number; }
interface MonthPoint { ym: string; pump: number; spare: number; total: number; }

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ── Role / rep scoping ──────────────────────────────────────
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  const isRep   = role === 'rep';
  let repId: number | null = session?.user?.repId ?? null;
  if (isRep && repId == null && session?.user?.email) {
    const r = await risansiPool.query<{ id: number }>('SELECT id FROM reps WHERE email = $1 LIMIT 1', [session.user.email]);
    repId = r.rows[0]?.id ?? null;
  }
  const personal = isRep && sp.view !== 'full';
  const scoped   = personal && repId != null;
  const repCond  = scoped ? ` AND c.primary_rep_id = $REP` : '';

  // Build a query's param list, substituting the $REP placeholder with the next index.
  function withRep(sql: string, baseParams: (string | number)[]): [string, (string | number)[]] {
    if (!scoped) return [sql.replace(/ AND c\.primary_rep_id = \$REP/g, ''), baseParams];
    const idx = baseParams.length + 1;
    return [sql.replace(/\$REP/g, String(idx)), [...baseParams, repId as number]];
  }

  // ── Period (month filter or full FY) ────────────────────────
  const monthSel = typeof sp.month === 'string' && /^\d{4}-\d{2}-01$/.test(sp.month) ? sp.month : null;
  const periodStart = monthSel ?? CUR_FY_START;
  const periodEnd   = monthSel ? addMonths(monthSel, 1) : CUR_FY_END;
  const prevStart   = monthSel ? addMonths(monthSel, -12) : PREV_FY_START;
  const prevEnd     = monthSel ? addMonths(periodEnd, -12) : PREV_FY_END;

  function buildUrl(over: { view?: string | null; month?: string | null }): string {
    const view  = 'view' in over ? over.view  : (personal ? null : (isRep ? 'full' : null));
    const month = 'month' in over ? over.month : monthSel;
    const p = new URLSearchParams();
    if (view) p.set('view', view);
    if (month) p.set('month', month);
    const qs = p.toString();
    return `/risansi/revenue${qs ? `?${qs}` : ''}`;
  }

  const [summary, activeClients, yoy, monthly, byIndustry, byRep, topClients, byCat, monthTiles] = await Promise.all([

    // 1. FY summary — current + previous period, pump/spare, clients billed
    q(async () => {
      const [sql, params] = withRep(
        `SELECT
           COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS cur_total,
           COALESCE(SUM(crm.pump_value)  FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS cur_pump,
           COALESCE(SUM(crm.spare_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS cur_spare,
           COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $3 AND crm.month < $4),0)::text AS prev_total,
           COUNT(DISTINCT crm.client_id) FILTER (WHERE crm.month >= $1 AND crm.month < $2 AND crm.total_value > 0)::text AS billed
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}`,
        [periodStart, periodEnd, prevStart, prevEnd],
      );
      const { rows } = await risansiPool.query<{ cur_total: string; cur_pump: string; cur_spare: string; prev_total: string; billed: string }>(sql, params);
      const r = rows[0];
      return {
        total: Number(r?.cur_total ?? 0), pump: Number(r?.cur_pump ?? 0), spare: Number(r?.cur_spare ?? 0),
        prevTotal: Number(r?.prev_total ?? 0), billed: Number(r?.billed ?? 0),
      };
    }, { total: 0, pump: 0, spare: 0, prevTotal: 0, billed: 0 }),

    // 2. Total active clients (scope-aware)
    q(async () => {
      const [sql, params] = withRep(`SELECT COUNT(*)::text AS n FROM clients c WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'${repCond}`, []);
      const { rows } = await risansiPool.query<{ n: string }>(sql, params);
      return Number(rows[0]?.n ?? 0);
    }, 0),

    // 3. YoY by FY (not month-filtered — it's a trend)
    q<YoY[]>(async () => {
      const [sql, params] = withRep(
        `SELECT (CASE WHEN EXTRACT(MONTH FROM crm.month) >= 4 THEN EXTRACT(YEAR FROM crm.month) ELSE EXTRACT(YEAR FROM crm.month) - 1 END)::int AS fy_start,
                COALESCE(SUM(crm.pump_value),0)::text AS pump,
                COALESCE(SUM(crm.spare_value),0)::text AS spare,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}
         GROUP BY 1 ORDER BY 1 DESC LIMIT 5`,
        [],
      );
      const { rows } = await risansiPool.query<{ fy_start: number; pump: string; spare: string; total: string }>(sql, params);
      return rows.map(r => ({ fyStart: Number(r.fy_start), pump: Number(r.pump), spare: Number(r.spare), total: Number(r.total) })).reverse();
    }, []),

    // 4. Monthly trend — distinct months present (annual snapshots), most recent 24
    q<MonthPoint[]>(async () => {
      const [sql, params] = withRep(
        `SELECT to_char(crm.month,'YYYY-MM-01') AS ym,
                COALESCE(SUM(crm.pump_value),0)::text AS pump,
                COALESCE(SUM(crm.spare_value),0)::text AS spare,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}
         GROUP BY ym ORDER BY ym DESC LIMIT 24`,
        [],
      );
      const { rows } = await risansiPool.query<{ ym: string; pump: string; spare: string; total: string }>(sql, params);
      return rows.map(r => ({ ym: r.ym, pump: Number(r.pump), spare: Number(r.spare), total: Number(r.total) })).reverse();
    }, []),

    // 5. By industry (period)
    q<ByIndustry[]>(async () => {
      const [sql, params] = withRep(
        `SELECT COALESCE(c.industry,'Other') AS industry,
                COUNT(DISTINCT crm.client_id)::text AS clients,
                COALESCE(SUM(crm.pump_value),0)::text AS pump,
                COALESCE(SUM(crm.spare_value),0)::text AS spare,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL AND crm.month >= $1 AND crm.month < $2${repCond}
         GROUP BY COALESCE(c.industry,'Other') HAVING SUM(crm.total_value) > 0
         ORDER BY SUM(crm.total_value) DESC LIMIT 15`,
        [periodStart, periodEnd],
      );
      const { rows } = await risansiPool.query<{ industry: string; clients: string; pump: string; spare: string; total: string }>(sql, params);
      return rows.map(r => ({ industry: r.industry, clients: Number(r.clients), pump: Number(r.pump), spare: Number(r.spare), total: Number(r.total) }));
    }, []),

    // 6. By rep / zone (period) + target
    q<ByRep[]>(async () => {
      const [sql, params] = withRep(
        `SELECT COALESCE(r.name, c.primary_rep_name, 'Unassigned') AS rep,
                r.zone, r.target_cr::text AS target_cr,
                COUNT(DISTINCT crm.client_id)::text AS clients,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         LEFT JOIN reps r ON r.id = c.primary_rep_id
         WHERE c.deleted_at IS NULL AND crm.month >= $1 AND crm.month < $2${repCond}
         GROUP BY COALESCE(r.name, c.primary_rep_name, 'Unassigned'), r.zone, r.target_cr
         HAVING SUM(crm.total_value) > 0 ORDER BY SUM(crm.total_value) DESC LIMIT 30`,
        [periodStart, periodEnd],
      );
      const { rows } = await risansiPool.query<{ rep: string; zone: string | null; target_cr: string | null; clients: string; total: string }>(sql, params);
      return rows.map(r => ({ rep: r.rep, zone: r.zone, clients: Number(r.clients), total: Number(r.total), target_cr: r.target_cr != null ? Number(r.target_cr) : null }));
    }, []),

    // 7. Top clients (current + previous period for vs LY) — fetch up to 100, paginated client-side
    q<RevenueClientRow[]>(async () => {
      const [sql, params] = withRep(
        `SELECT c.id::text AS id, c.code, c.legal_name, c.industry, c.state, c.tier,
                COALESCE(r.name, c.primary_rep_name, '—') AS rep_name,
                COALESCE(SUM(crm.pump_value)  FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS pump,
                COALESCE(SUM(crm.spare_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS spare,
                COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS total,
                COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $3 AND crm.month < $4),0)::text AS prev_total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         LEFT JOIN reps r ON r.id = c.primary_rep_id
         WHERE c.deleted_at IS NULL${repCond}
         GROUP BY c.id, c.code, c.legal_name, c.industry, c.state, c.tier, r.name, c.primary_rep_name
         HAVING SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2) > 0
         ORDER BY SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2) DESC
         LIMIT 100`,
        [periodStart, periodEnd, prevStart, prevEnd],
      );
      const { rows } = await risansiPool.query<Record<string, string | null>>(sql, params);
      return rows.map(r => ({
        id: r.id as string, code: r.code as string, legal_name: r.legal_name as string,
        industry: r.industry, state: r.state, tier: r.tier, rep_name: (r.rep_name as string) ?? '—',
        pump: Number(r.pump ?? 0), spare: Number(r.spare ?? 0), total: Number(r.total ?? 0), prev_total: Number(r.prev_total ?? 0),
      }));
    }, []),

    // 8. Business category (client_type — no business_category column exists)
    q<ByCat[]>(async () => {
      const [sql, params] = withRep(
        `SELECT COALESCE(NULLIF(TRIM(c.client_type),''),'Unclassified') AS category,
                COUNT(DISTINCT crm.client_id)::text AS clients,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL AND crm.month >= $1 AND crm.month < $2${repCond}
         GROUP BY category HAVING SUM(crm.total_value) > 0 ORDER BY SUM(crm.total_value) DESC`,
        [periodStart, periodEnd],
      );
      const { rows } = await risansiPool.query<{ category: string; clients: string; total: string }>(sql, params);
      return rows.map(r => ({ category: r.category, clients: Number(r.clients), total: Number(r.total) }));
    }, []),

    // 9. Month tiles — distinct months present in the current FY
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ ym: string }>(
        `SELECT DISTINCT to_char(month,'YYYY-MM-01') AS ym FROM client_revenue_monthly
         WHERE month >= $1 AND month < $2 ORDER BY ym`,
        [CUR_FY_START, CUR_FY_END],
      );
      return rows.map(r => r.ym);
    }, []),
  ]);

  // ── Derived ─────────────────────────────────────────────────
  const delta      = summary.prevTotal > 0 ? ((summary.total - summary.prevTotal) / summary.prevTotal) * 100 : null;
  const pumpPct    = summary.total > 0 ? (summary.pump / summary.total) * 100 : 0;
  const sparePct   = summary.total > 0 ? (summary.spare / summary.total) * 100 : 0;
  const maxIndustry = Math.max(...byIndustry.map(r => r.total), 1);
  const maxRep      = Math.max(...byRep.map(r => r.total), 1);
  const catTotal    = byCat.reduce((s, r) => s + r.total, 0);
  const hasAnyData  = summary.total > 0 || byIndustry.length > 0 || topClients.length > 0 || yoy.some(y => y.total > 0);

  const subtitle = monthSel ? `Showing ${monthLabelLong(monthSel)}` : 'FY 25-26 · All months';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Revenue']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Revenue</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {subtitle}{personal ? ' · your clients' : ''}
          </div>
        </div>

        {/* Section 0 — rep toggle */}
        {isRep && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <a href={buildUrl({ view: null })} style={toggle(personal)}>My Revenue</a>
            <a href={buildUrl({ view: 'full' })} style={toggle(!personal)}>All Revenue</a>
          </div>
        )}

        {!hasAnyData ? (
          <div style={{ ...PANEL, padding: '48px 24px', textAlign: 'center', color: 'var(--fg-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💹</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>No revenue recorded yet</div>
            <div style={{ fontSize: 13 }}>
              Upload monthly revenue data from{' '}
              <Link href="/risansi/admin/revenue" style={{ color: 'var(--accent)' }}>Admin → Revenue Upload</Link>
            </div>
          </div>
        ) : (
          <>
            {/* Section 1 — month tiles */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              <a href={buildUrl({ month: null })} style={tile(!monthSel)}>All</a>
              {monthTiles.map(m => (
                <a key={m} href={buildUrl({ month: m })} style={tile(monthSel === m)}>{monthLabel(m)}</a>
              ))}
            </div>

            {/* Section 2 — KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
              <Kpi label={monthSel ? 'Period Total' : 'FY 25-26 Total'} value={formatRev(summary.total)}
                sub={delta != null ? `${delta >= 0 ? '▲' : '▼'} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs ${monthSel ? 'LY' : 'FY 24-25'}` : 'no prior-period data'}
                subColor={delta == null ? 'var(--fg-3)' : delta >= 0 ? 'var(--pos)' : 'var(--neg)'} />
              <Kpi label="Pump Revenue" value={formatRev(summary.pump)} sub={`${pumpPct.toFixed(0)}% of total`} />
              <Kpi label="Spare Revenue" value={formatRev(summary.spare)} sub={`${sparePct.toFixed(0)}% of total`} />
              <Kpi label="Clients Billed" value={summary.billed.toLocaleString('en-IN')} sub={`of ${activeClients.toLocaleString('en-IN')} active clients`} />
            </div>

            {/* Section 3 — YoY + pump/spare donut */}
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 14 }}>
              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Year-on-Year Revenue</span><span style={META}>Pump vs Spare · ₹ Lakhs</span></div>
                <div style={{ padding: '16px 18px' }}>
                  {yoy.some(y => y.total > 0) ? <YoYChart rows={yoy} curFyStart={2025} /> : <Empty>No historical data</Empty>}
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#0A3D8F', borderRadius: 2, marginRight: 5 }} />Pump</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#00A3C4', borderRadius: 2, marginRight: 5 }} />Spare</span>
                  </div>
                </div>
              </div>

              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Pump vs Spare</span></div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  {summary.total > 0 ? (
                    <>
                      <Donut
                        data={[{ pct: pumpPct, color: '#0A3D8F', name: 'Pump' }, { pct: sparePct, color: '#00A3C4', name: 'Spare' }]}
                        size={150} thick={22}
                        center={<div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>{formatRev(summary.total)}</div>
                          <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Total</div>
                        </div>}
                      />
                      <div style={{ display: 'flex', gap: 18, fontSize: 12 }}>
                        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#0A3D8F', borderRadius: 2, marginRight: 5 }} />Pump {pumpPct.toFixed(0)}%</span>
                        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#00A3C4', borderRadius: 2, marginRight: 5 }} />Spare {sparePct.toFixed(0)}%</span>
                      </div>
                    </>
                  ) : <Empty>No revenue in this period</Empty>}
                </div>
              </div>
            </div>

            {/* Section 4 — industry + rep tables */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
              {/* Industry */}
              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Revenue by Industry</span></div>
                {byIndustry.length === 0 ? <Empty>No data</Empty> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: 'var(--bg-elev)' }}>
                        {['Industry', 'Clients', 'Pump', 'Spare', 'Total', '% Share'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {byIndustry.map(r => {
                          const share = summary.total > 0 ? (r.total / summary.total) * 100 : 0;
                          return (
                            <tr key={r.industry} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ ...TD, fontWeight: 500 }}>{r.industry}</td>
                              <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{r.clients}</td>
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.pump > 0 ? formatRev(r.pump) : '—'}</td>
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.spare > 0 ? formatRev(r.spare) : '—'}</td>
                              <td style={{ ...TD, minWidth: 130 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ flex: 1, height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                                    <div style={{ width: `${(r.total / maxIndustry) * 100}%`, height: '100%', background: '#1A5CB8', borderRadius: 3 }} />
                                  </div>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 56, textAlign: 'right' }}>{formatRev(r.total)}</span>
                                </div>
                              </td>
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{share.toFixed(0)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Rep */}
              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Revenue by Rep</span></div>
                {byRep.length === 0 ? <Empty>No data</Empty> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: 'var(--bg-elev)' }}>
                        {['Rep', 'Zone', 'Clients', 'Total', 'vs Target'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {byRep.map(r => {
                          const targetInr = r.target_cr != null ? r.target_cr * 1_00_00_000 : null; // Cr → INR
                          const pct = targetInr && targetInr > 0 ? (r.total / targetInr) * 100 : null;
                          return (
                            <tr key={r.rep} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ ...TD, fontWeight: 500 }}>{r.rep}</td>
                              <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{r.zone ?? '—'}</td>
                              <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{r.clients}</td>
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatRev(r.total)}</td>
                              <td style={{ ...TD, minWidth: 110 }}>
                                {pct == null ? <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>—</span> : (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <div style={{ flex: 1, height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
                                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 100 ? 'var(--pos)' : pct >= 60 ? 'var(--accent)' : 'var(--warn)', borderRadius: 3 }} />
                                    </div>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: pct >= 100 ? 'var(--pos)' : 'var(--fg-3)', minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Section 5 — monthly trend */}
            <div style={{ ...PANEL, marginBottom: 14 }}>
              <div style={PANEL_H}><span style={PANEL_TITLE}>Revenue Trend</span><span style={META}>per recorded period · ₹ Lakhs</span></div>
              <div style={{ padding: '16px 18px' }}>
                {monthly.some(m => m.total > 0) ? <MonthlyTrend rows={monthly} selected={monthSel} /> : <Empty>No trend data</Empty>}
              </div>
            </div>

            {/* Section 6 — top clients (interactive) */}
            <div style={{ marginBottom: 14 }}>
              <RevenueTopClients clients={topClients} />
            </div>

            {/* Section 7 — business category */}
            <div style={PANEL}>
              <div style={PANEL_H}><span style={PANEL_TITLE}>Business Category</span><span style={META}>by client type</span></div>
              {byCat.length === 0 ? <Empty>No data</Empty> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: 'var(--bg-elev)' }}>
                    {['Category', 'Clients', 'Revenue', '% of Total'].map(h => <th key={h} style={TH}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {byCat.map((r, i) => {
                      const pct = catTotal > 0 ? (r.total / catTotal) * 100 : 0;
                      return (
                        <tr key={r.category} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ ...TD }}><span style={catPill(i)}>{r.category}</span></td>
                          <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{r.clients}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatRev(r.total)}</td>
                          <td style={{ ...TD, minWidth: 120 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: CAT_COLORS[i % CAT_COLORS.length], borderRadius: 3 }} />
                              </div>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', minWidth: 34, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Charts (server-rendered SVG) ───────────────────────────────

function YoYChart({ rows, curFyStart }: { rows: YoY[]; curFyStart: number }) {
  const max = Math.max(...rows.map(r => Math.max(r.pump, r.spare) / INR_TO_L), 1);
  const H = 150, barW = 16, pairGap = 4, groupGap = 38, padL = 38, padB = 24;
  const groupW = barW * 2 + pairGap;
  const totalW = rows.length * (groupW + groupGap) - groupGap;
  return (
    <svg width="100%" height={H + padB} viewBox={`0 0 ${totalW + padL + 10} ${H + padB}`} preserveAspectRatio="xMinYMin meet" style={{ overflow: 'visible' }}>
      {[0.25, 0.5, 0.75, 1].map(p => {
        const y = H - p * H;
        return (
          <g key={p}>
            <line x1={padL} x2={totalW + padL} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">{Math.round(max * p)}</text>
          </g>
        );
      })}
      {rows.map((r, i) => {
        const x = padL + i * (groupW + groupGap);
        const ph = (r.pump / INR_TO_L / max) * H;
        const sh = (r.spare / INR_TO_L / max) * H;
        const cur = r.fyStart === curFyStart;
        return (
          <g key={i}>
            <rect x={x} y={H - ph} width={barW} height={ph} rx={1.5} fill="#0A3D8F" opacity={cur ? 1 : 0.6} />
            <rect x={x + barW + pairGap} y={H - sh} width={barW} height={sh} rx={1.5} fill="#00A3C4" opacity={cur ? 1 : 0.6} />
            <text x={x + groupW / 2} y={H + 14} textAnchor="middle" fontSize="10" fontWeight={cur ? 700 : 400} fill={cur ? '#0A3D8F' : 'var(--fg-3)'} fontFamily="var(--font-mono)">{fyLabel(r.fyStart)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MonthlyTrend({ rows, selected }: { rows: MonthPoint[]; selected: string | null }) {
  const max = Math.max(...rows.map(r => r.total / INR_TO_L), 1);
  const H = 120, padL = 38, padB = 24, gap = 10;
  const bw = Math.max(10, Math.min(40, Math.floor((640 - padL) / rows.length) - gap));
  const totalW = rows.length * (bw + gap) - gap;
  return (
    <svg width="100%" height={H + padB} viewBox={`0 0 ${totalW + padL + 10} ${H + padB}`} preserveAspectRatio="xMinYMin meet" style={{ overflow: 'visible' }}>
      {[0.5, 1].map(p => {
        const y = H - p * H;
        return (
          <g key={p}>
            <line x1={padL} x2={totalW + padL} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">{Math.round(max * p)}</text>
          </g>
        );
      })}
      {rows.map((r, i) => {
        const x = padL + i * (bw + gap);
        const h = (r.total / INR_TO_L / max) * H;
        const sel = selected === r.ym;
        return (
          <g key={r.ym}>
            <title>{`${monthLabel(r.ym)} · Pump ${formatRev(r.pump)} · Spare ${formatRev(r.spare)} · Total ${formatRev(r.total)}`}</title>
            <rect x={x} y={H - h} width={bw} height={h} rx={2} fill={sel ? '#D97706' : '#1A5CB8'} />
            <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize="9" fill={sel ? '#D97706' : 'var(--fg-3)'} fontFamily="var(--font-mono)">{monthLabel(r.ym)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Small sub-components ───────────────────────────────────────

function Kpi({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <div style={{ ...PANEL, borderLeft: '3px solid var(--title)', padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: subColor ?? 'var(--fg-3)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>{children}</div>;
}

const CAT_COLORS = ['#0A3D8F', '#1A5CB8', '#00B4D8', '#059669', '#D97706', '#7C3AED', '#DC2626', '#6B7FA3'];

function toggle(active: boolean): CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
    background: active ? '#0A3D8F' : 'var(--bg-elev)', color: active ? '#fff' : 'var(--fg-3)',
    textDecoration: 'none', border: '1px solid var(--line)',
  };
}
function tile(active: boolean): CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: active ? 600 : 500,
    background: active ? '#0A3D8F' : 'var(--bg-paper)', color: active ? '#fff' : 'var(--fg-2)',
    textDecoration: 'none', border: `1px solid ${active ? '#0A3D8F' : 'var(--line-strong)'}`,
    fontFamily: 'var(--font-mono)',
  };
}
function catPill(i: number): CSSProperties {
  const c = CAT_COLORS[i % CAT_COLORS.length];
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500, background: c + '18', color: c, border: `1px solid ${c}40`, whiteSpace: 'nowrap' };
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
