import type { CSSProperties } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Topbar, Sparkline, MiniBars, Donut, Tag } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import {
  getCurrentFY, getPreviousFYCodes, fyShortLabel,
  fyYtdPct, fyDaysLeft, formatIndianDate, formatTime, fmtCr, initials,
} from '@/lib/risansi-utils';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Competitor colour palette ──────────────────────────────────

const COMP_COLORS: Record<string, string> = {
  RIL:      '#1A5CB8',
  Roto:     '#059669',
  Rotomac:  '#0891B2',
  Gita:     '#D97706',
  Sintech:  '#DC2626',
  PSP:      '#7C3AED',
  Netzsch:  '#6366F1',
  Tushaco:  '#B45309',
  Others:   'var(--fg-3)',
};

function compColor(name: string): string {
  return COMP_COLORS[name] ?? COMP_COLORS.Others;
}

// ── Funnel stage colours ───────────────────────────────────────

const FUNNEL_COLORS: Record<string, string> = {
  Suspect:     'var(--fg-3)',
  Prospect:    'var(--info)',
  Quoted:      'var(--warn)',
  Negotiating: 'var(--accent)',
};

// ── Data shapes ────────────────────────────────────────────────

interface RevenueSplit { pump: number; spare: number; }
interface HistoricalFY { code: string; label: string; total: number; }
interface SegmentRow   { industry: string; total: number; }
interface FunnelRow    { stage: string; count: number; value: number; }
interface MarketEntry  { supplier: string; units: number; pct: number; color: string; }
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

export default async function ExecDashboardPage() {
  // ── Mobile redirect (must live here, not in layout) ────────
  // The parent layout wraps all /risansi/* including /risansi/mobile,
  // so a UA redirect there would loop. This page only renders for
  // the exact /risansi path.
  const headersList = await headers();
  const ua = headersList.get('user-agent') ?? '';
  if (/Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua)) {
    redirect('/risansi/mobile');
  }

  const fy       = getCurrentFY();
  const prevCodes = getPreviousFYCodes(5);           // ['20-21'..'24-25']
  const ytdPct   = fyYtdPct(fy);
  const daysLeft  = fyDaysLeft(fy);
  const today     = new Date();

  // ── 1. Booked revenue this FY from clients.rev_2526_* (INR ÷ 10M = Cr) ──
  const INR_TO_CR = 10_000_000;
  const revSplit = await q<RevenueSplit>(async () => {
    const { rows } = await risansiPool.query<{ pump: string; spare: string }>(
      `SELECT COALESCE(SUM(rev_2526_pump),0)::text AS pump,
              COALESCE(SUM(rev_2526_spare),0)::text AS spare
       FROM clients`,
      [],
    );
    return {
      pump:  Number(rows[0]?.pump  ?? 0) / INR_TO_CR,
      spare: Number(rows[0]?.spare ?? 0) / INR_TO_CR,
    };
  }, { pump: 0, spare: 0 });

  const totalBooked = revSplit.pump + revSplit.spare;

  // ── 2. Previous-year total from clients.rev_2425_* ──────────
  const pyTotal = await q<number>(async () => {
    const { rows } = await risansiPool.query<{ total: string }>(
      `SELECT (COALESCE(SUM(rev_2425_pump),0) + COALESCE(SUM(rev_2425_spare),0))::text AS total
       FROM clients`,
      [],
    );
    return Number(rows[0]?.total ?? 0) / INR_TO_CR;
  }, 0);

  // ── 3. Annual target ─────────────────────────────────────────
  const annTarget = await q<number>(async () => {
    const { rows } = await risansiPool.query<{ target_value: string }>(
      `SELECT target_value::text FROM sales_targets
       WHERE financial_year = $1 AND target_type = 'national' LIMIT 1`,
      [fy.code],
    );
    return rows[0] ? Number(rows[0].target_value) : 320;
  }, 320);

  // ── 4. Historical revenue (5 previous FYs for MiniBars from clients table) ─
  // Map FY code to the corresponding column names on clients table.
  const FY_COL_MAP: Record<string, [string, string]> = {
    '20-21': ['rev_2021_pump', 'rev_2021_spare'],
    '21-22': ['rev_2122_pump', 'rev_2122_spare'],
    '22-23': ['rev_2223_pump', 'rev_2223_spare'],
    '23-24': ['rev_2324_pump', 'rev_2324_spare'],
    '24-25': ['rev_2425_pump', 'rev_2425_spare'],
  };
  const historical = await q<HistoricalFY[]>(async () => {
    const results: HistoricalFY[] = [];
    for (const code of prevCodes) {
      const cols = FY_COL_MAP[code];
      if (!cols) { results.push({ code, label: fyShortLabel(code), total: 0 }); continue; }
      try {
        const { rows } = await risansiPool.query<{ total: string }>(
          `SELECT (COALESCE(SUM(${cols[0]}),0) + COALESCE(SUM(${cols[1]}),0))::text AS total FROM clients`,
          [],
        );
        results.push({ code, label: fyShortLabel(code), total: Number(rows[0]?.total ?? 0) / INR_TO_CR });
      } catch {
        results.push({ code, label: fyShortLabel(code), total: 0 });
      }
    }
    return results;
  }, prevCodes.map(code => ({ code, label: fyShortLabel(code), total: 0 })));

  // ── 5. Revenue by industry segment ──────────────────────────
  const segments = await q<SegmentRow[]>(async () => {
    const { rows } = await risansiPool.query<{ industry: string; total: string }>(
      `SELECT c.industry, COALESCE(SUM(o.order_value),0)::text AS total
       FROM orders o JOIN clients c ON c.id = o.client_id
       WHERE o.financial_year = $1
       GROUP BY c.industry ORDER BY SUM(o.order_value) DESC LIMIT 8`,
      [fy.code],
    );
    return rows.map(r => ({ industry: r.industry, total: Number(r.total) }));
  }, []);

  // Domestic / Export split
  const domExp = await q<{ domestic: number; export: number; pump_pct: number }>(async () => {
    const { rows } = await risansiPool.query<{ market_type: string; cat: string; total: string }>(
      `SELECT c.market_type, o.product_category AS cat,
              COALESCE(SUM(o.order_value),0)::text AS total
       FROM orders o JOIN clients c ON c.id = o.client_id
       WHERE o.financial_year = $1
       GROUP BY c.market_type, o.product_category`,
      [fy.code],
    );
    const domestic = rows.filter(r => r.market_type === 'Domestic').reduce((s, r) => s + Number(r.total), 0);
    const exportV  = rows.filter(r => r.market_type === 'Export').reduce((s, r) => s + Number(r.total), 0);
    const pump     = rows.filter(r => r.cat === 'Pump').reduce((s, r) => s + Number(r.total), 0);
    const total    = rows.reduce((s, r) => s + Number(r.total), 0) || 1;
    return { domestic, export: exportV, pump_pct: Math.round((pump / total) * 100) };
  }, { domestic: 0, export: 0, pump_pct: 0 });

  // ── 6. Pipeline funnel ───────────────────────────────────────
  const funnel = await q<FunnelRow[]>(async () => {
    const { rows } = await risansiPool.query<{ stage: string; cnt: string; val: string }>(
      `SELECT stage,
              COUNT(*)::text                            AS cnt,
              COALESCE(SUM(estimated_value),0)::text   AS val
       FROM pipeline_opportunities
       WHERE stage IN ('Suspect','Prospect','Quoted','Negotiating')
       GROUP BY stage`,
      [],
    );
    return ['Suspect','Prospect','Quoted','Negotiating'].map(stage => {
      const row = rows.find(r => r.stage === stage);
      return { stage, count: Number(row?.cnt ?? 0), value: Number(row?.val ?? 0) };
    });
  }, ['Suspect','Prospect','Quoted','Negotiating'].map(stage => ({ stage, count: 0, value: 0 })));

  const pipelineTotal = funnel.reduce((s, r) => s + r.value, 0);
  const negotiatingCount = funnel.find(r => r.stage === 'Negotiating')?.count ?? 0;

  // ── 7. Market share from competitor_installed_base ───────────
  interface CIBTotals { ril: number; roto: number; rotomac: number; netzsch: number; gita: number; psp: number; tushaco: number; total: number; }
  const cibTotals = await q<CIBTotals>(async () => {
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
      [],
    );
    const r = rows[0];
    return {
      ril:     Number(r?.ril     ?? 0), roto:    Number(r?.roto    ?? 0),
      rotomac: Number(r?.rotomac ?? 0), netzsch: Number(r?.netzsch ?? 0),
      gita:    Number(r?.gita    ?? 0), psp:     Number(r?.psp     ?? 0),
      tushaco: Number(r?.tushaco ?? 0), total:   Number(r?.total   ?? 0),
    };
  }, { ril: 0, roto: 0, rotomac: 0, netzsch: 0, gita: 0, psp: 0, tushaco: 0, total: 0 });

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

  // ── 8. At-risk accounts (last_visit_date > 18 months ago or null) ──────────
  const atRisk = await q<AtRisk>(async () => {
    const { rows } = await risansiPool.query<{ cnt: string; exposure: string }>(
      `SELECT COUNT(*)::text AS cnt,
              COALESCE(SUM(COALESCE(rev_2425_pump,0) + COALESCE(rev_2425_spare,0)),0)::text AS exposure
       FROM clients
       WHERE status = 'Active'
         AND (last_visit_date < NOW() - INTERVAL '18 months'
              OR last_visit_date IS NULL)`,
      [],
    );
    return {
      count:    Number(rows[0]?.cnt      ?? 0),
      exposure: Number(rows[0]?.exposure ?? 0) / INR_TO_CR,
    };
  }, { count: 0, exposure: 0 });

  // ── 9. Top 7 accounts by YTD revenue (from clients rev_ columns) ───────────
  const topAccounts = await q<TopAccount[]>(async () => {
    const { rows } = await risansiPool.query<{
      client_code: string; legal_name: string; industry: string; zone: string; status: string;
      ytd: string; py: string; fy20: string; fy21: string; fy22: string; fy23: string; fy24: string; fy25: string;
    }>(
      `SELECT
         client_code, legal_name, industry, zone, status,
         (COALESCE(rev_2526_pump,0) + COALESCE(rev_2526_spare,0))::text AS ytd,
         (COALESCE(rev_2425_pump,0) + COALESCE(rev_2425_spare,0))::text AS py,
         (COALESCE(rev_2021_pump,0) + COALESCE(rev_2021_spare,0))::text AS fy20,
         (COALESCE(rev_2122_pump,0) + COALESCE(rev_2122_spare,0))::text AS fy21,
         (COALESCE(rev_2223_pump,0) + COALESCE(rev_2223_spare,0))::text AS fy22,
         (COALESCE(rev_2324_pump,0) + COALESCE(rev_2324_spare,0))::text AS fy23,
         (COALESCE(rev_2425_pump,0) + COALESCE(rev_2425_spare,0))::text AS fy24,
         (COALESCE(rev_2526_pump,0) + COALESCE(rev_2526_spare,0))::text AS fy25
       FROM clients
       WHERE (COALESCE(rev_2526_pump,0) + COALESCE(rev_2526_spare,0)) > 0
          OR (COALESCE(rev_2425_pump,0) + COALESCE(rev_2425_spare,0)) > 0
       ORDER BY ytd DESC LIMIT 7`,
      [],
    );
    return rows.map(r => ({
      client_code: r.client_code,
      legal_name:  r.legal_name,
      industry:    r.industry,
      zone:        r.zone,
      status:      r.status,
      ytd:  Number(r.ytd)  / INR_TO_CR,
      py:   Number(r.py)   / INR_TO_CR,
      fy20: Number(r.fy20) / INR_TO_CR,
      fy21: Number(r.fy21) / INR_TO_CR,
      fy22: Number(r.fy22) / INR_TO_CR,
      fy23: Number(r.fy23) / INR_TO_CR,
      fy24: Number(r.fy24) / INR_TO_CR,
      fy25: Number(r.fy25) / INR_TO_CR,
    }));
  }, []);

  // ── 10. Recent visit feed (last 10) ──────────────────────────
  const visits = await q<VisitEntry[]>(async () => {
    const { rows } = await risansiPool.query<{
      id: string; rep_name: string; client_name: string;
      visit_date: Date; outcome: string | null; purpose: string;
      status: string; synced_at: Date | null;
    }>(
      `SELECT v.id,
              u.name                AS rep_name,
              c.legal_name          AS client_name,
              v.visit_date,
              v.outcome,
              v.purpose,
              v.status,
              v.synced_at
       FROM visits v
       JOIN clients c ON c.id = v.client_id
       JOIN users   u ON u.id = v.rep_id
       WHERE v.status IN ('completed','checked-in')
       ORDER BY COALESCE(v.checkin_time, v.visit_date::timestamp) DESC
       LIMIT 10`,
      [],
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
      synced:       r.synced_at != null,
    }));
  }, []);

  // ── Derived display values ────────────────────────────────────
  const bookedDelta   = pyTotal > 0 ? ((totalBooked - pyTotal) / pyTotal) * 100 : 0;
  const achievedPct   = annTarget > 0 ? (totalBooked / annTarget) * 100 : 0;
  const isOnTrack     = totalBooked >= (annTarget * ytdPct / 100 * 0.9);
  const histValues    = historical.map(h => h.total);
  const histLabels    = historical.map(h => h.label);
  const funnelMax     = Math.max(...funnel.map(f => f.value), 1);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Executive Dashboard']} primaryAction="New Report" />
      </div>

      {/* Scrollable page body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ─────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Good morning, Anjali.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {formatIndianDate(today)}
              {daysLeft > 0
                ? ` · ${fy.label} closes in ${daysLeft} days`
                : ` · ${fy.label} completed`}
              {visits.length > 0 && ` · ${visits.filter(v => v.status === 'checked-in').length} reps active today`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ExportBtn label="Export PDF" />
            <ExportBtn label="Refresh" />
          </div>
        </div>

        {/* ── Hero metrics row ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>

          {/* Booked Revenue hero panel */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>FY 25–26 Booked Revenue</span>
              <span style={META}>Updated {formatTime(today)} IST</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind={isOnTrack ? 'pos' : 'warn'} dot>{isOnTrack ? 'On Track' : 'Behind'}</Tag>
              </div>
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
                {/* Total booked metric */}
                <div style={{ flexShrink: 0 }}>
                  <div style={METRIC_LABEL}>Total Booked</div>
                  <div style={METRIC_VAL}>
                    {fmtCr(totalBooked)}
                  </div>
                  {pyTotal > 0 && (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: bookedDelta >= 0 ? 'var(--pos)' : 'var(--neg)', marginTop: 4 }}>
                      {bookedDelta >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(totalBooked - pyTotal))} vs PY · {bookedDelta >= 0 ? '+' : ''}{bookedDelta.toFixed(1)}%
                    </div>
                  )}
                </div>
                {/* Target metric */}
                <div style={{ flexShrink: 0 }}>
                  <div style={METRIC_LABEL}>Annual Target</div>
                  <div style={METRIC_VAL}>{fmtCr(annTarget)}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                    {achievedPct.toFixed(1)}% achieved · {ytdPct}% YTD
                  </div>
                </div>
                {/* Mini bars */}
                <div style={{ flex: 1 }}>
                  <MiniBars values={histValues.length ? histValues : [0]} labels={histLabels} width={280} height={70} />
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ marginTop: 14, height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(achievedPct, 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                <span>₹0</span>
                <span style={{ color: 'var(--accent)' }}>↑ {fmtCr(totalBooked)}</span>
                <span>{fmtCr(annTarget)}</span>
              </div>
            </div>
          </div>

          {/* Pipeline small metric */}
          <SmallMetric
            label="Pipeline"
            value={`${(pipelineTotal / 1).toFixed(0)}`}
            unit="Cr"
            delta={`${negotiatingCount} in negotiation`}
            deltaPos
            sub="Open opportunities"
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
            delta={atRisk.exposure > 0 ? `${fmtCr(atRisk.exposure)} exposure` : 'No order > 18 mo'}
            deltaPos={false}
            sub="No order > 18 months"
            spark={[]}
          />
        </div>

        {/* ── Mid row ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.5fr', gap: 14, marginBottom: 14 }}>

          {/* Revenue mix */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Revenue Mix · {fy.label}</span>
            </div>
            <div style={{ padding: 14 }}>
              {segments.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '24px 0' }}>No revenue data</div>
              )}
              {segments.slice(0, 6).map((seg, i) => (
                <SegmentBar
                  key={seg.industry}
                  label={seg.industry}
                  value={seg.total}
                  total={totalBooked || 1}
                  color={SEGMENT_COLORS[i] ?? 'var(--fg-3)'}
                />
              ))}
              {segments.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <StatBlock label="Domestic" value={fmtCr(domExp.domestic)} />
                  <StatBlock label="Export"   value={fmtCr(domExp.export)} />
                  <StatBlock label="Pump : Spare" value={`${domExp.pump_pct} : ${100 - domExp.pump_pct}`} />
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
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500 }}>
                          {rilShare.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
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
              <span style={PANEL_TITLE}>Pipeline Funnel · {fy.label}</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag>{fmtCr(pipelineTotal)} open</Tag>
              </div>
            </div>
            <div style={{ padding: '8px 14px' }}>
              {funnel.every(f => f.count === 0) && (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '24px 0' }}>No pipeline data</div>
              )}
              {funnel.map(row => (
                <FunnelBarRow
                  key={row.stage}
                  stage={row.stage}
                  count={row.count}
                  value={row.value}
                  max={funnelMax}
                  color={FUNNEL_COLORS[row.stage] ?? 'var(--fg-3)'}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom row ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>

          {/* Top accounts table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Top Accounts · YTD Revenue</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <GhostBtn>All zones</GhostBtn>
                <GhostBtn>Sort: Revenue ▾</GhostBtn>
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
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtCr(acc.ytd)}</td>
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
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pos)', display: 'inline-block', boxShadow: '0 0 0 3px rgba(5,150,105,0.20)' }} />
                <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>real-time</span>
              </div>
            </div>
            <div style={{ padding: 0 }}>
              {visits.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>
                  No visit activity today
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

const PANEL_H: CSSProperties = {
  padding:      '12px 14px',
  borderBottom: '1px solid var(--line)',
  display:      'flex',
  alignItems:   'center',
  gap:          10,
};

const PANEL_TITLE: CSSProperties = {
  fontSize:      12,
  fontWeight:    500,
  letterSpacing: '-0.005em',
};

const META: CSSProperties = {
  fontSize:    11,
  color:       'var(--fg-3)',
  fontFamily:  'var(--font-mono)',
};

const METRIC_LABEL: CSSProperties = {
  fontSize:       10,
  textTransform:  'uppercase',
  letterSpacing:  '0.10em',
  color:          'var(--fg-3)',
  fontWeight:     500,
};

const METRIC_VAL: CSSProperties = {
  fontFamily:         'var(--font-mono)',
  fontSize:           28,
  fontWeight:         400,
  letterSpacing:      '-0.02em',
  fontVariantNumeric: 'tabular-nums',
  lineHeight:         1.05,
  color:              'var(--fg)',
};

const TH: CSSProperties = {
  padding:       '9px 12px',
  textAlign:     'left',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    500,
  color:         'var(--fg-3)',
  borderBottom:  '1px solid var(--line)',
  whiteSpace:    'nowrap',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

// ── Small server-side sub-components ──────────────────────────

function SmallMetric({ label, value, unit, delta, deltaPos, sub, spark }: {
  label: string; value: string; unit?: string;
  delta?: string; deltaPos?: boolean; sub?: string; spark: number[];
}) {
  return (
    <div style={PANEL}>
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
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{sub}</div>
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
        <span>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
          {fmtCr(value)} <span style={{ color: 'var(--fg-3)' }}>({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden' }}>
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
      <div style={{ width: 110, fontSize: 11, color, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, flexShrink: 0 }}>
        {stage}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ height: 18, background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            {count > 0 ? `${count} opps` : ''}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 90, textAlign: 'right' }}>
        {fmtCr(value)}
      </div>
    </div>
  );
}

function ExportBtn({ label }: { label: string }) {
  return (
    <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg)', borderRadius: 5, cursor: 'pointer' }}>
      {label}
    </button>
  );
}

function GhostBtn({ children }: { children: React.ReactNode }) {
  return (
    <button style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11, fontFamily: 'inherit', background: 'transparent', border: '1px solid transparent', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer' }}>
      {children}
    </button>
  );
}
