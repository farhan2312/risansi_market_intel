import type { CSSProperties } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Sparkline, MiniBars, Donut, Tag } from '@/components/risansi';
import { ExportPdfButton } from '@/components/risansi/ExportPdfButton';
import { RefreshButton } from '@/components/risansi/RefreshButton';
import risansiPool from '@/lib/db-risansi';
import {
  getCurrentFY, getPreviousFYCodes, fyShortLabel,
  fyYtdPct, fyDaysLeft, formatIndianDate, formatTime, fmtCr, fmtL, initials,
  getGreeting, formatRev,
} from '@/lib/risansi-utils';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Competitor colour palette ──────────────────────────────────

const COMP_COLORS: Record<string, string> = {
  RIL:      '#0A3D8F',
  Roto:     '#1A5CB8',
  Rotomac:  '#1A5CB8',
  Gita:     '#00B4D8',
  Sintech:  '#DC2626',
  PSP:      '#D97706',
  Netzsch:  '#2E7DD1',
  Tushaco:  '#B45309',
  Others:   '#DDE6F5',
};

function compColor(name: string): string {
  return COMP_COLORS[name] ?? COMP_COLORS.Others;
}

// ── Funnel stage colours ───────────────────────────────────────

const FUNNEL_COLORS: Record<string, string> = {
  Suspect:     '#93C5FD',
  Prospect:    '#3B82F6',
  Quoted:      '#1D4ED8',
  Negotiating: '#D97706',
};

// ── Data shapes ────────────────────────────────────────────────

interface RevenueSplit { pump: number; spare: number; }
interface HistoricalFY { code: string; label: string; total: number; }
interface SegmentRow   { segment: string; ytd_inr: number; }
interface FunnelRow    { stage: string; count: number; value: number; }
interface MarketEntry  { supplier: string; units: number; pct: number; color: string; }
interface CIBTotals    { ril: number; roto: number; rotomac: number; netzsch: number; gita: number; psp: number; tushaco: number; total: number; }
interface TopAccount {
  client_code: string; legal_name: string; industry: string; zone: string; status: string;
  ytd: number; py: number;
  fy20: number; fy21: number; fy22: number; fy23: number; fy24: number; fy25: number;
}
interface VisitEntry {
  id: string; rep_name: string; rep_initials: string; client_name: string;
  visit_date: Date; outcome: string | null; purpose: string; status: string; synced: boolean;
}
interface AtRisk { count: number; exposure: number; }

// ── Page ───────────────────────────────────────────────────────

export default async function ExecDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  // ── Mobile redirect (must live here, not in layout) ────────
  const headersList = await headers();
  const ua = headersList.get('user-agent') ?? '';
  if (/Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua)) {
    redirect('/risansi/mobile');
  }

  const session     = await getServerSession(authOptions);
  const displayName = session?.user?.name ?? session?.user?.email ?? 'Admin';

  const fy        = getCurrentFY();
  const prevCodes = getPreviousFYCodes(5);   // ['20-21'..'24-25']
  const ytdPct    = fyYtdPct(fy);
  const daysLeft  = fyDaysLeft(fy);
  const today     = new Date();

  const INR_TO_L = 100_000;

  // ── FY selection — validated against allowlist, never raw user input in SQL ──
  const FY_COLS = {
    '25-26': { pump: 'rev_2526_pump', spare: 'rev_2526_spare', total: 'rev_2526_total', prev: 'rev_2425_total' },
    '24-25': { pump: 'rev_2425_pump', spare: 'rev_2425_spare', total: 'rev_2425_total', prev: 'rev_2324_total' },
    '23-24': { pump: 'rev_2324_pump', spare: 'rev_2324_spare', total: 'rev_2324_total', prev: 'rev_2223_total' },
    '22-23': { pump: 'rev_2223_pump', spare: 'rev_2223_spare', total: 'rev_2223_total', prev: 'rev_2122_total' },
  } as const;
  type FYKey = keyof typeof FY_COLS;

  const sp      = await searchParams;
  const rawFy   = sp.fy ?? '25-26';
  const safeFy: FYKey = (rawFy in FY_COLS) ? rawFy as FYKey : '25-26';
  const cols    = FY_COLS[safeFy];
  const fyLabel = `FY ${safeFy.replace('-', '–')}`;

  // ── All queries in parallel — replaces 10 sequential awaits ──
  const [
    revSplit,
    pyTotal,
    annTarget,
    historical,
    segments,
    domExp,
    funnel,
    cibTotals,
    atRisk,
    topAccounts,
    visits,
  ] = await Promise.all([

    // 1. Selected-FY revenue: total + pump/spare breakdown
    q<RevenueSplit>(async () => {
      const { rows } = await risansiPool.query<{ total_inr: string; pump_inr: string; spare_inr: string }>(
        `SELECT
           COALESCE(SUM(${cols.total}),0)::text AS total_inr,
           COALESCE(SUM(${cols.pump}),0)::text  AS pump_inr,
           COALESCE(SUM(${cols.spare}),0)::text AS spare_inr
         FROM clients WHERE deleted_at IS NULL`,
      );
      return {
        pump:  Number(rows[0]?.pump_inr  ?? 0) / INR_TO_L,
        spare: Number(rows[0]?.spare_inr ?? 0) / INR_TO_L,
      };
    }, { pump: 0, spare: 0 }),

    // 2. Previous-year total (the FY before the selected one)
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ total: string }>(
        `SELECT COALESCE(SUM(${cols.prev}),0)::text AS total
         FROM clients WHERE deleted_at IS NULL`,
      );
      return Number(rows[0]?.total ?? 0) / INR_TO_L;
    }, 0),

    // 3. Annual target (Crores) — fallback 32 Cr = ₹32 Cr
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ target_value: string }>(
        `SELECT target_value::text FROM sales_targets
         WHERE financial_year = $1 AND target_type = 'national' LIMIT 1`,
        [safeFy],
      );
      return rows[0] ? Number(rows[0].target_value) : 32;
    }, 32),

    // 4. Historical revenue — all FYs via UNION ALL, zeros filtered out
    q<HistoricalFY[]>(async () => {
      const { rows } = await risansiPool.query<{ fy: string; ord: number; total_inr: string }>(
        `SELECT fy, ord, total_inr FROM (
           SELECT 'FY18' AS fy, 1 AS ord, COALESCE(SUM(rev_1819),0)::text AS total_inr FROM clients
           UNION ALL
           SELECT 'FY19', 2, COALESCE(SUM(rev_1920),0)::text FROM clients
           UNION ALL
           SELECT 'FY20', 3, COALESCE(SUM(rev_2021),0)::text FROM clients
           UNION ALL
           SELECT 'FY21', 4, COALESCE(SUM(rev_2122_total),0)::text FROM clients
           UNION ALL
           SELECT 'FY22', 5, COALESCE(SUM(rev_2223_total),0)::text FROM clients
           UNION ALL
           SELECT 'FY23', 6, COALESCE(SUM(rev_2324_total),0)::text FROM clients
           UNION ALL
           SELECT 'FY24', 7, COALESCE(SUM(rev_2425_total),0)::text FROM clients
           UNION ALL
           SELECT 'FY25', 8, COALESCE(SUM(rev_2526_total),0)::text FROM clients
         ) t
         WHERE total_inr::numeric > 0
         ORDER BY ord`,
      );
      return rows.map(r => ({ code: r.fy, label: r.fy, total: Number(r.total_inr) / INR_TO_L }));
    }, []),

    // 5. Revenue by industry segment
    q<SegmentRow[]>(async () => {
      const { rows } = await risansiPool.query<{ segment: string; ytd_inr: string }>(
        `SELECT
           COALESCE(c.industry, 'Other') AS segment,
           COALESCE(SUM(c.${cols.total}), 0)::text AS ytd_inr
         FROM clients c
         WHERE c.deleted_at IS NULL
           AND c.status = 'ACTIVE'
           AND c.${cols.total} > 0
         GROUP BY COALESCE(c.industry, 'Other')
         ORDER BY 2::numeric DESC
         LIMIT 8`,
      );
      return rows.map(r => ({ segment: r.segment, ytd_inr: Number(r.ytd_inr) / INR_TO_L }));
    }, []),

    // 6. Domestic / Export split
    q<{ domestic: number; export: number }>(async () => {
      const { rows } = await risansiPool.query<{ domestic_inr: string; export_inr: string }>(
        `SELECT
           COALESCE(SUM(CASE WHEN market_type = 'Domestic' THEN ${cols.total} ELSE 0 END),0)::text AS domestic_inr,
           COALESCE(SUM(CASE WHEN market_type = 'Export'   THEN ${cols.total} ELSE 0 END),0)::text AS export_inr
         FROM clients WHERE deleted_at IS NULL`,
      );
      const r = rows[0];
      return {
        domestic: Number(r?.domestic_inr ?? 0) / INR_TO_L,
        export:   Number(r?.export_inr   ?? 0) / INR_TO_L,
      };
    }, { domestic: 0, export: 0 }),

    // 7. Pipeline funnel
    q<FunnelRow[]>(async () => {
      const { rows } = await risansiPool.query<{ stage: string; cnt: string; val: string }>(
        `SELECT stage, COUNT(*)::text AS cnt, COALESCE(SUM(value_cr),0)::text AS val
         FROM opportunities
         WHERE stage IN ('Suspect','Prospect','Quoted','Negotiating')
         GROUP BY stage`,
      );
      return ['Suspect','Prospect','Quoted','Negotiating'].map(stage => {
        const row = rows.find(r => r.stage === stage);
        return { stage, count: Number(row?.cnt ?? 0), value: Number(row?.val ?? 0) };
      });
    }, ['Suspect','Prospect','Quoted','Negotiating'].map(stage => ({ stage, count: 0, value: 0 }))),

    // 8. Market share from competitor_installed_base
    q<CIBTotals>(async () => {
      const { rows } = await risansiPool.query<{
        ril: string; roto: string; rotomac: string; netzsch: string;
        gita: string; psp: string; tushaco: string; total: string;
      }>(
        `SELECT
           COALESCE(SUM(ril_pcp),0)::text     AS ril,
           COALESCE(SUM(roto_pcp),0)::text    AS roto,
           COALESCE(SUM(rotomac_pcp),0)::text AS rotomac,
           COALESCE(SUM(netzsch_pcp),0)::text AS netzsch,
           COALESCE(SUM(gita_pcp),0)::text    AS gita,
           COALESCE(SUM(psp_pcp),0)::text     AS psp,
           COALESCE(SUM(tushaco_pcp),0)::text AS tushaco,
           COALESCE(SUM(total_pcp),0)::text   AS total
         FROM competitor_installed_base`,
      );
      const r = rows[0];
      return {
        ril:     Number(r?.ril     ?? 0), roto:    Number(r?.roto    ?? 0),
        rotomac: Number(r?.rotomac ?? 0), netzsch: Number(r?.netzsch ?? 0),
        gita:    Number(r?.gita    ?? 0), psp:     Number(r?.psp     ?? 0),
        tushaco: Number(r?.tushaco ?? 0), total:   Number(r?.total   ?? 0),
      };
    }, { ril: 0, roto: 0, rotomac: 0, netzsch: 0, gita: 0, psp: 0, tushaco: 0, total: 0 }),

    // 9. At-risk: previously active clients with no visit in 18+ months
    q<AtRisk>(async () => {
      const { rows } = await risansiPool.query<{ cnt: string; exposure: string }>(
        `SELECT COUNT(*)::text AS cnt,
                COALESCE(SUM(
                  COALESCE(${cols.total},0) + COALESCE(${cols.prev},0)
                ), 0)::text AS exposure
         FROM clients
         WHERE status = 'ACTIVE'
           AND deleted_at IS NULL
           AND (
             COALESCE(rev_2425_total,0) > 0 OR
             COALESCE(rev_2324_total,0) > 0 OR
             COALESCE(rev_2223_total,0) > 0
           )
           AND (
             last_visit_date IS NULL OR
             last_visit_date < CURRENT_DATE - INTERVAL '18 months'
           )`,
      );
      return {
        count:    Number(rows[0]?.cnt      ?? 0),
        exposure: Number(rows[0]?.exposure ?? 0) / INR_TO_L,
      };
    }, { count: 0, exposure: 0 }),

    // 10. Top 7 accounts by YTD revenue
    q<TopAccount[]>(async () => {
      const { rows } = await risansiPool.query<{
        client_code: string; legal_name: string; industry: string; zone: string; status: string;
        ytd: string; py: string; fy20: string; fy21: string; fy22: string; fy23: string; fy24: string; fy25: string;
      }>(
        `SELECT
           c.code AS client_code, c.legal_name, c.industry, c.zone, c.status,
           COALESCE(c.${cols.total},0)::text AS ytd,
           COALESCE(c.${cols.prev},0)::text AS py,
           COALESCE(c.rev_2021,0)::text AS fy20,
           COALESCE(c.rev_2122_total,0)::text AS fy21,
           COALESCE(c.rev_2223_total,0)::text AS fy22,
           COALESCE(c.rev_2324_total,0)::text AS fy23,
           COALESCE(c.rev_2425_total,0)::text AS fy24,
           COALESCE(c.rev_2526_total,0)::text AS fy25
         FROM clients c
         WHERE c.deleted_at IS NULL
           AND (COALESCE(c.${cols.total},0) > 0
             OR COALESCE(c.${cols.prev},0) > 0)
         ORDER BY ytd DESC LIMIT 7`,
      );
      return rows.map(r => ({
        client_code: r.client_code,
        legal_name:  r.legal_name,
        industry:    r.industry,
        zone:        r.zone,
        status:      r.status,
        ytd:  Number(r.ytd)  / INR_TO_L,
        py:   Number(r.py)   / INR_TO_L,
        fy20: Number(r.fy20) / INR_TO_L,
        fy21: Number(r.fy21) / INR_TO_L,
        fy22: Number(r.fy22) / INR_TO_L,
        fy23: Number(r.fy23) / INR_TO_L,
        fy24: Number(r.fy24) / INR_TO_L,
        fy25: Number(r.fy25) / INR_TO_L,
      }));
    }, []),

    // 11. Recent visit feed (last 10)
    q<VisitEntry[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; rep_name: string; client_name: string;
        visit_date: Date; outcome: string | null; purpose: string;
        status: string;
      }>(
        `SELECT v.id,
                COALESCE(r.name, '—') AS rep_name,
                c.legal_name          AS client_name,
                v.visit_date,
                v.outcome,
                v.purpose,
                v.status
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE v.status IN ('completed','checked-in')
           AND v.visit_date >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY v.visit_date DESC, v.check_in_time DESC NULLS LAST
         LIMIT 10`,
      );
      return rows.map(r => ({
        id:           r.id,
        rep_name:     r.rep_name,
        rep_initials: initials(r.rep_name),
        client_name:  r.client_name,
        visit_date:   new Date(r.visit_date),
        outcome:      r.outcome,
        purpose:      r.purpose,
        status:       r.status,
        synced:       false,
      }));
    }, []),
  ]);

  // ── Derived values ────────────────────────────────────────────

  const totalBooked = revSplit.pump + revSplit.spare;
  const pumpPct  = totalBooked > 0 ? Math.round((revSplit.pump  / totalBooked) * 100) : 0;
  const sparePct = totalBooked > 0 ? Math.round((revSplit.spare / totalBooked) * 100) : 0;

  // historical is returned directly from query 4 (zeros filtered, all FYs)

  const pipelineTotal    = funnel.reduce((s, r) => s + r.value, 0);
  const negotiatingCount = funnel.find(r => r.stage === 'Negotiating')?.count ?? 0;

  const shareTotal = Math.max(cibTotals.total, 1);
  const rilUnits   = cibTotals.ril;
  const rilShare   = (rilUnits / shareTotal) * 100;

  const rotoTotal  = cibTotals.roto + cibTotals.rotomac;
  const namedTotal = rilUnits + rotoTotal + cibTotals.netzsch + cibTotals.gita + cibTotals.psp + cibTotals.tushaco;
  const othersU    = Math.max(0, cibTotals.total - namedTotal);

  const shareData: MarketEntry[] = [
    { supplier: 'RIL',           units: rilUnits,          pct: (rilUnits / shareTotal) * 100,          color: compColor('RIL') },
    { supplier: 'Roto+Rotomac',  units: rotoTotal,         pct: (rotoTotal / shareTotal) * 100,         color: compColor('Roto') },
    { supplier: 'Netzsch',       units: cibTotals.netzsch, pct: (cibTotals.netzsch / shareTotal) * 100, color: compColor('Netzsch') },
    { supplier: 'Gita',          units: cibTotals.gita,    pct: (cibTotals.gita / shareTotal) * 100,    color: compColor('Gita') },
    { supplier: 'PSP',           units: cibTotals.psp,     pct: (cibTotals.psp / shareTotal) * 100,     color: compColor('PSP') },
    { supplier: 'Tushaco',       units: cibTotals.tushaco, pct: (cibTotals.tushaco / shareTotal) * 100, color: compColor('Tushaco') },
    ...(othersU > 0 ? [{ supplier: 'Others', units: othersU, pct: (othersU / shareTotal) * 100, color: compColor('Others') }] : []),
  ].filter(d => d.units > 0);

  // ── Derived display values ────────────────────────────────────
  // annTarget is in Crores; convert to Lakhs to compare with rev_* totals (in Lakhs)
  const annTargetL  = annTarget * 100;
  // fmtFromL: format a value-in-Lakhs using auto-scaling (same unit as totalBooked)
  const fmtFromL    = (lakhs: number) => formatRev(Math.round(lakhs * INR_TO_L));
  const bookedDelta = pyTotal > 0 ? ((totalBooked - pyTotal) / pyTotal) * 100 : 0;
  const achievedPct = annTargetL > 0 ? (totalBooked / annTargetL) * 100 : 0;
  const isOnTrack   = totalBooked >= (annTargetL * ytdPct / 100 * 0.9);
  const histValues  = historical.map(h => h.total);
  const histLabels  = historical.map(h => h.label);
  const funnelMax   = Math.max(...funnel.map(f => f.value), 1);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Executive Dashboard']} primaryAction="Visit Plan" primaryActionHref="/risansi/visits" />
      </div>

      {/* Scrollable page body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ─────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              {getGreeting()}, {displayName}.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {formatIndianDate(today)}
              {daysLeft > 0
                ? ` · ${fy.label} closes in ${daysLeft} days`
                : ` · ${fy.label} completed`}
              {visits.length > 0 && ` · ${visits.filter(v => v.status === 'checked-in').length} reps active today`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ExportPdfButton />
            <RefreshButton />
          </div>
        </div>

        {/* ── Hero metrics row 1: full-width Revenue card ─────── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...KPI_PANEL }}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>{fyLabel} Booked Revenue</span>
              <span style={META}>Updated {formatTime(today)} IST</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind={isOnTrack ? 'pos' : 'warn'} dot>{isOnTrack ? 'On Track' : 'Behind'}</Tag>
              </div>
            </div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 28, alignItems: 'center' }}>
              {/* Left: KPI numbers + progress bar + dom/exp/pump:spare */}
              <div>
                <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
                  {/* Total booked metric */}
                  <div style={{ flexShrink: 0 }}>
                    <div style={METRIC_LABEL}>Total Booked</div>
                    <div style={METRIC_VAL}>{fmtFromL(totalBooked)}</div>
                    {pyTotal > 0 && (
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: bookedDelta >= 0 ? 'var(--pos)' : 'var(--neg)', marginTop: 4 }}>
                        {bookedDelta >= 0 ? '▲' : '▼'} {fmtFromL(Math.abs(totalBooked - pyTotal))} vs PY · {bookedDelta >= 0 ? '+' : ''}{bookedDelta.toFixed(1)}%
                      </div>
                    )}
                  </div>
                  {/* Target metric */}
                  <div style={{ flexShrink: 0 }}>
                    <div style={METRIC_LABEL}>Annual Target</div>
                    <div style={METRIC_VAL}>{fmtFromL(annTargetL)}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                      {achievedPct.toFixed(1)}% achieved · {ytdPct}% YTD
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginTop: 14, height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(achievedPct, 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  <span>₹0</span>
                  <span style={{ color: 'var(--accent)' }}>↑ {fmtFromL(totalBooked)}</span>
                  <span>{fmtFromL(annTargetL)}</span>
                </div>

                {/* Dom / Exp / Pump:Spare stats */}
                <div style={{ display: 'flex', gap: 28, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <StatBlock label="Domestic" value={fmtL(domExp.domestic)} />
                  <StatBlock label="Export"   value={fmtL(domExp.export)} />
                  <StatBlock label="Pump : Spare" value={`${pumpPct} : ${sparePct}`} />
                </div>
              </div>

              {/* Right: YoY mini bars */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7FA3', fontWeight: 600, marginBottom: 8 }}>
                  Year-on-Year Revenue
                </div>
                <MiniBars
                  values={histValues.length ? histValues : [0]}
                  labels={histLabels}
                  color="#0A3D8F"
                  dimColor="#93C5FD"
                  width={280} height={90}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Hero metrics row 2: Pipeline · Market · At-Risk ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>

          {/* Pipeline small metric */}
          <SmallMetric
            label="Pipeline"
            value={pipelineTotal > 0 ? fmtCr(pipelineTotal) : '—'}
            delta={pipelineTotal > 0 ? `${negotiatingCount} in negotiation` : 'No open opportunities'}
            deltaPos={pipelineTotal > 0}
            sub={pipelineTotal > 0 ? 'Open opportunities' : 'Add via Pipeline →'}
            subHref={pipelineTotal === 0 ? '/risansi/pipeline' : undefined}
            spark={[]}
          />

          {/* Market share small metric */}
          <SmallMetric
            label="Market Share · PCP"
            value={shareTotal > 1 ? rilShare.toFixed(1) : '—'}
            unit={shareTotal > 1 ? '%' : ''}
            delta="National installed base"
            deltaPos
            sub={shareTotal > 1 ? `${shareTotal.toLocaleString()} units tracked` : 'Awaiting assessment data'}
            spark={[]}
          />

          {/* At-risk small metric */}
          <SmallMetric
            label="At-Risk Accounts"
            value={String(atRisk.count)}
            delta={atRisk.exposure > 0 ? `${fmtFromL(atRisk.exposure)} revenue at risk` : 'None — all recently visited'}
            deltaPos={atRisk.count === 0}
            sub="Had revenue · no visit 18 mo+"
            spark={[]}
          />
        </div>

        {/* ── Mid row ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.5fr', gap: 14, marginBottom: 14 }}>

          {/* Revenue mix */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Revenue Mix · {fyLabel}</span>
            </div>
            <div style={{ padding: 14 }}>
              {segments.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '24px 0' }}>No revenue data</div>
              )}
              {segments.slice(0, 6).map((seg, i) => (
                <SegmentBar
                  key={seg.segment}
                  label={seg.segment}
                  value={seg.ytd_inr}
                  total={totalBooked || 1}
                  color={SEGMENT_COLORS[i] ?? 'var(--fg-3)'}
                />
              ))}
              {segments.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <StatBlock label="Domestic" value={fmtL(domExp.domestic)} />
                  <StatBlock label="Export"   value={fmtL(domExp.export)} />
                  <StatBlock label="Pump : Spare" value={`${pumpPct} : ${sparePct}`} />
                </div>
              )}
            </div>
          </div>

          {/* PCP Market share donut */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>PCP Market Share · National</span>
              <span style={META}>{shareTotal > 1 ? `${shareTotal.toLocaleString()} units in installed base` : 'No assessment data yet'}</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind="info">Live from field</Tag>
              </div>
            </div>
            <div style={{ padding: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
              {shareData.length > 0 ? (
                <>
                  <Donut
                    data={shareData.map(d => ({ pct: d.pct, color: d.color, name: d.supplier }))}
                    size={140}
                    thick={20}
                    center={
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#0D1B2A' }}>
                          {rilShare.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 10, color: '#6B7FA3', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          RIL Share
                        </div>
                      </div>
                    }
                  />
                  <div style={{ flex: 1 }}>
                    {shareData.map((d, i) => (
                      <div key={d.supplier} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }}>
                        <span style={{ width: 8, height: 8, background: d.color, borderRadius: 2, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: i === 0 ? 500 : 400 }}>{d.supplier}</span>
                        <span style={{ width: 44, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {d.pct.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '28px 0' }}>
                  Awaiting equipment assessments from field
                </div>
              )}
            </div>
          </div>

          {/* Pipeline funnel */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Pipeline Funnel · {fyLabel}</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag>{fmtCr(pipelineTotal)} open</Tag>
              </div>
            </div>
            <div style={{ padding: '8px 14px' }}>
              {funnel.every(f => f.count === 0) ? (
                <div style={{ textAlign: 'center', padding: '36px 16px' }}>
                  <div style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 12 }}>No pipeline data yet</div>
                  <a
                    href="/risansi/pipeline"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', borderRadius: 6, textDecoration: 'none' }}
                  >
                    + Add Opportunity
                  </a>
                </div>
              ) : (
                funnel.map(row => (
                  <FunnelBarRow
                    key={row.stage}
                    stage={row.stage}
                    count={row.count}
                    value={row.value}
                    max={funnelMax}
                    color={FUNNEL_COLORS[row.stage] ?? 'var(--fg-3)'}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom row ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>

          {/* Top accounts table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Top Accounts · YTD Revenue</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <a href="/risansi/clients" style={{ fontSize: 11, color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>View all →</a>
              </div>
            </div>
            <div style={{ padding: 0, overflowX: 'auto' }}>
              {topAccounts.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>No orders in {fy.label}</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      {['Account', 'Industry', 'Zone', 'YTD Rev', 'vs PY', '5-yr', 'Status'].map(h => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topAccounts.map(acc => {
                      const deltaPct = acc.py > 0 ? ((acc.ytd - acc.py) / acc.py) * 100 : 0;
                      const trend = [acc.fy20, acc.fy21, acc.fy22, acc.fy23, acc.fy24, acc.fy25].filter(v => v > 0);
                      return (
                        <tr key={acc.client_code} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                            <div style={{ fontWeight: 500, fontSize: 12 }}>{acc.legal_name}</div>
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                              {acc.client_code}
                            </div>
                          </td>
                          <td style={TD}><Tag>{acc.industry}</Tag></td>
                          <td style={{ ...TD, color: 'var(--fg-3)' }}>{acc.zone}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtL(acc.ytd)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: deltaPct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                            {acc.py > 0 ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}
                          </td>
                          <td style={TD}>
                            <Sparkline values={trend.length ? trend : [0]} width={70} height={20} color="var(--accent)" />
                          </td>
                          <td style={TD}>
                            <Tag kind="pos" dot>{acc.status}</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Live field activity */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Live Field Activity</span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <a href="/risansi/visits" style={{ fontSize: 11, color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>View all →</a>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pos)', display: 'inline-block', boxShadow: '0 0 0 3px rgba(5,150,105,0.20)' }} />
                <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>real-time</span>
              </div>
            </div>
            <div style={{ padding: 0 }}>
              {visits.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>📅</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>No field activity this week</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 16 }}>Visits will appear here in real-time as reps check in</div>
                  <a href="/risansi/visits" style={{ fontSize: 11, color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>View visit history →</a>
                </div>
              )}
              {visits.map((v, i) => {
                const what = v.status === 'checked-in' ? 'checked in at' : 'completed visit at';
                const outcomeKind = v.outcome?.toLowerCase().includes('positive') ? 'pos' : 'warn';
                return (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 14px', borderBottom: i < visits.length - 1 ? '1px solid var(--line)' : 'none', gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600, color: 'var(--fg-2)', flexShrink: 0 }}>
                      {v.rep_initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>
                        <strong style={{ fontWeight: 500 }}>{v.rep_name.split(' ')[0]}</strong>
                        {' '}<span style={{ color: 'var(--fg-3)' }}>{what}</span>{' '}
                        <span style={{ fontWeight: 500 }}>{v.client_name}</span>
                      </div>
                      {v.outcome && (
                        <div style={{ marginTop: 2 }}>
                          <Tag kind={outcomeKind}>{v.outcome}</Tag>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                        {formatTime(v.visit_date)}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: v.synced ? 'var(--pos)' : 'var(--warn)', marginTop: 1 }}>
                        ● {v.synced ? 'synced' : 'queued'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Segment colours (design system) ───────────────────────────

const SEGMENT_COLORS = [
  'var(--accent)',
  '#D97706',
  '#059669',
  '#0891B2',
  '#7C3AED',
  'var(--fg-3)',
  '#DC2626',
  '#6366F1',
];

// ── Shared style constants ─────────────────────────────────────

const PANEL: CSSProperties = {
  background:   'var(--bg-paper)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

const KPI_PANEL: CSSProperties = {
  ...PANEL,
  borderLeft: '4px solid #0A3D8F',
};

const PANEL_H: CSSProperties = {
  padding:      '12px 14px',
  borderBottom: '1px solid var(--line)',
  display:      'flex',
  alignItems:   'center',
  gap:          10,
};

const PANEL_TITLE: CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         '#0A3D8F',
};

const META: CSSProperties = {
  fontSize:    11,
  color:       'var(--fg-3)',
  fontFamily:  'var(--font-mono)',
};

const METRIC_LABEL: CSSProperties = {
  fontSize:       10,
  textTransform:  'uppercase',
  letterSpacing:  '0.08em',
  color:          '#6B7FA3',
  fontWeight:     600,
};

const METRIC_VAL: CSSProperties = {
  fontFamily:         'var(--font-mono)',
  fontSize:           28,
  fontWeight:         700,
  letterSpacing:      '-0.02em',
  fontVariantNumeric: 'tabular-nums',
  lineHeight:         1.05,
  color:              '#0D1B2A',
};

const TH: CSSProperties = {
  padding:       '9px 12px',
  textAlign:     'left',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    600,
  color:         '#6B7FA3',
  background:    '#EBF1FB',
  borderBottom:  '2px solid #DDE6F5',
  whiteSpace:    'nowrap',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

// ── Small server-side sub-components ──────────────────────────

function SmallMetric({ label, value, unit, delta, deltaPos, sub, subHref, spark }: {
  label: string; value: string; unit?: string;
  delta?: string; deltaPos?: boolean; sub?: string; subHref?: string; spark: number[];
}) {
  return (
    <div style={{ ...KPI_PANEL, minHeight: 140 }}>
      <div style={{ padding: 14 }}>
        <div style={METRIC_LABEL}>{label}</div>
        <div style={METRIC_VAL}>
          {value}
          {unit && <span style={{ fontSize: 14, color: 'var(--fg-3)', marginLeft: 4, fontWeight: 400 }}>{unit}</span>}
        </div>
        {delta && (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: deltaPos ? 'var(--pos)' : 'var(--neg)', marginTop: 4 }}>
            {deltaPos ? '▲' : '▼'} {delta}
          </div>
        )}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {subHref ? (
            <a href={subHref} style={{ fontSize: 11, color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>{sub}</a>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{sub}</div>
          )}
          {spark.length > 0 && (
            <Sparkline values={spark} width={70} height={22} color={deltaPos ? 'var(--pos)' : 'var(--neg)'} />
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.min((value / total) * 100, 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
        <span style={{ color: '#2C3E5A' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1B2A' }}>
          {formatRev(Math.round(value * 100_000))} <span style={{ color: '#6B7FA3' }}>({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div style={{ height: 4, background: '#DDE6F5', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function FunnelBarRow({ stage, count, value, max, color }: {
  stage: string; count: number; value: number; max: number; color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
      <div style={{ width: 110, fontSize: 11, color: '#2C3E5A', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, flexShrink: 0 }}>
        {stage}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ height: 18, background: '#DDE6F5', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            {count > 0 ? `${count} opps` : ''}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 90, textAlign: 'right', color: '#0D1B2A' }}>
        {fmtCr(value)}
      </div>
    </div>
  );
}

function GhostBtn({ children }: { children: React.ReactNode }) {
  return (
    <button style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11, fontFamily: 'inherit', background: 'transparent', border: '1px solid transparent', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer' }}>
      {children}
    </button>
  );
}
