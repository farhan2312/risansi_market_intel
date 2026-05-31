import type { CSSProperties } from 'react';
import { Topbar, Donut, Tag, KpiCard } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { fmtCr } from '@/lib/risansi-utils';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Competitor colour palette ──────────────────────────────────

const COMP_COLORS: Record<string, string> = {
  RIL:           '#1A5CB8',
  'Roto+Rotomac': '#059669',
  Netzsch:       '#7C3AED',
  Gita:          '#D97706',
  PSP:           '#0891B2',
  Tushaco:       '#DC2626',
  Others:        'var(--fg-3)',
};
function compColor(name: string) { return COMP_COLORS[name] ?? COMP_COLORS.Others; }

// ── Data shapes ────────────────────────────────────────────────

interface MarketTotals {
  ril_pcp:     number;
  roto_pcp:    number;
  rotomac_pcp: number;
  netzsch_pcp: number;
  gita_pcp:    number;
  psp_pcp:     number;
  tushaco_pcp: number;
  total_pcp:   number;
}

interface DisplacementAccount {
  client_name:    string;
  zone:           string | null;
  ril_pcp:        number;
  total_pcp:      number;
  competitor_pcp: number;
  rep_name:       string | null;
}

interface IndustryShare {
  industry:    string;
  ril_pcp:     number;
  total_pcp:   number;
}

// ── Page ───────────────────────────────────────────────────────

export default async function CompetePage() {

  // ── All queries in parallel ───────────────────────────────────
  const [totals, displacementAccounts, industryShare] = await Promise.all([

    // 1. Aggregate totals across all clients
    q<MarketTotals>(async () => {
      const { rows } = await risansiPool.query<{
        ril_pcp: string; roto_pcp: string; rotomac_pcp: string;
        netzsch_pcp: string; gita_pcp: string; psp_pcp: string;
        tushaco_pcp: string; total_pcp: string;
      }>(
        `SELECT
           COALESCE(SUM(ril_pcp),0)::text     AS ril_pcp,
           COALESCE(SUM(roto_pcp),0)::text    AS roto_pcp,
           COALESCE(SUM(rotomac_pcp),0)::text AS rotomac_pcp,
           COALESCE(SUM(netzsch_pcp),0)::text AS netzsch_pcp,
           COALESCE(SUM(gita_pcp),0)::text    AS gita_pcp,
           COALESCE(SUM(psp_pcp),0)::text     AS psp_pcp,
           COALESCE(SUM(tushaco_pcp),0)::text AS tushaco_pcp,
           COALESCE(SUM(total_pcp),0)::text   AS total_pcp
         FROM competitor_installed_base`,
      );
      const r = rows[0];
      return {
        ril_pcp:     Number(r?.ril_pcp     ?? 0),
        roto_pcp:    Number(r?.roto_pcp    ?? 0),
        rotomac_pcp: Number(r?.rotomac_pcp ?? 0),
        netzsch_pcp: Number(r?.netzsch_pcp ?? 0),
        gita_pcp:    Number(r?.gita_pcp    ?? 0),
        psp_pcp:     Number(r?.psp_pcp     ?? 0),
        tushaco_pcp: Number(r?.tushaco_pcp ?? 0),
        total_pcp:   Number(r?.total_pcp   ?? 0),
      };
    }, { ril_pcp: 0, roto_pcp: 0, rotomac_pcp: 0, netzsch_pcp: 0, gita_pcp: 0, psp_pcp: 0, tushaco_pcp: 0, total_pcp: 0 }),

    // 2. Displacement accounts
    q<DisplacementAccount[]>(async () => {
      const { rows } = await risansiPool.query<{
        client_name: string; zone: string | null;
        ril_pcp: string; total_pcp: string;
        competitor_pcp: string; rep_name: string | null;
      }>(
        `SELECT c.legal_name AS client_name, c.zone,
                cib.ril_pcp::text,
                cib.total_pcp::text,
                (cib.total_pcp - COALESCE(cib.ril_pcp, 0))::text AS competitor_pcp,
                u.name AS rep_name
         FROM competitor_installed_base cib
         JOIN clients c ON c.client_code = cib.client_code
         LEFT JOIN users u ON u.id = c.rep_id
         WHERE (cib.total_pcp - COALESCE(cib.ril_pcp, 0)) > 0
           AND c.status = 'Active'
         ORDER BY competitor_pcp DESC
         LIMIT 30`,
      );
      return rows.map(r => ({
        client_name:    r.client_name,
        zone:           r.zone,
        ril_pcp:        Number(r.ril_pcp ?? 0),
        total_pcp:      Number(r.total_pcp ?? 0),
        competitor_pcp: Number(r.competitor_pcp ?? 0),
        rep_name:       r.rep_name,
      }));
    }, []),

    // 3. RIL share by industry
    q<IndustryShare[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string; ril: string; total: string }>(
        `SELECT c.industry,
                COALESCE(SUM(cib.ril_pcp),0)::text   AS ril,
                COALESCE(SUM(cib.total_pcp),0)::text AS total
         FROM competitor_installed_base cib
         JOIN clients c ON c.client_code = cib.client_code
         WHERE c.industry IS NOT NULL
         GROUP BY c.industry
         ORDER BY SUM(cib.total_pcp) DESC
         LIMIT 8`,
      );
      return rows.map(r => ({
        industry:  r.industry,
        ril_pcp:   Number(r.ril),
        total_pcp: Number(r.total),
      }));
    }, []),
  ]);

  // ── Derived values ────────────────────────────────────────────
  const safeTotal = Math.max(totals.total_pcp, 1);
  const rilShare  = (totals.ril_pcp / safeTotal) * 100;

  // Build donut slices: RIL + competitor groupings + Others
  const rotoTotal  = totals.roto_pcp + totals.rotomac_pcp;
  const namedTotal = totals.ril_pcp + rotoTotal + totals.netzsch_pcp + totals.gita_pcp + totals.psp_pcp + totals.tushaco_pcp;
  const othersUnits = Math.max(0, totals.total_pcp - namedTotal);

  const donutSlices = [
    { name: 'RIL',            units: totals.ril_pcp,     color: compColor('RIL') },
    { name: 'Roto+Rotomac',   units: rotoTotal,           color: compColor('Roto+Rotomac') },
    { name: 'Netzsch',        units: totals.netzsch_pcp,  color: compColor('Netzsch') },
    { name: 'Gita',           units: totals.gita_pcp,     color: compColor('Gita') },
    { name: 'PSP',            units: totals.psp_pcp,      color: compColor('PSP') },
    { name: 'Tushaco',        units: totals.tushaco_pcp,  color: compColor('Tushaco') },
    ...(othersUnits > 0 ? [{ name: 'Others', units: othersUnits, color: compColor('Others') }] : []),
  ].filter(d => d.units > 0).map(d => ({ ...d, pct: (d.units / safeTotal) * 100 }));

  const competitors = donutSlices.filter(d => d.name !== 'RIL');

  const totalCompetitorUnits = displacementAccounts.reduce((s, r) => s + r.competitor_pcp, 0);

  const maxCompPct = competitors.length > 0
    ? Math.max(...competitors.map(c => c.pct))
    : 1;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Competitive Intelligence']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Competitive Intelligence
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            PCP installed base · master data from client files
            {totals.total_pcp > 0 && ` · ${totals.total_pcp.toLocaleString()} total units tracked`}
          </div>
        </div>

        {/* ── KPI row ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          <KpiCard
            label="Total PCP Market"
            value={totals.total_pcp > 0 ? totals.total_pcp.toLocaleString() : '—'}
            sub="units in installed base"
          />
          <KpiCard
            label="RIL PCP Units"
            value={totals.ril_pcp > 0 ? totals.ril_pcp.toLocaleString() : '—'}
            sub="our installed pumps"
            pos
          />
          <KpiCard
            label="RIL Market Share"
            value={totals.total_pcp > 0 ? `${rilShare.toFixed(1)}%` : '—'}
            sub="PCP installed base"
          />
          <KpiCard
            label="Displacement Targets"
            value={displacementAccounts.length > 0 ? String(displacementAccounts.length) : '—'}
            sub={`${totalCompetitorUnits} competitor pumps in play`}
          />
        </div>

        {/* ── Donut + Competitor table ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14, marginBottom: 14 }}>

          {/* Market share donut */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>PCP Market Share</span>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              {totals.total_pcp > 0 ? (
                <>
                  <Donut
                    data={donutSlices.map(d => ({ pct: d.pct, color: d.color, name: d.name }))}
                    size={160}
                    thick={22}
                    center={
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 500, color: 'var(--fg)' }}>
                          {rilShare.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                          RIL Share
                        </div>
                      </div>
                    }
                  />
                  <div style={{ width: '100%' }}>
                    {donutSlices.map((d, i) => (
                      <div key={d.name} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 0',
                        borderBottom: i < donutSlices.length - 1 ? '1px solid var(--line)' : 'none',
                        fontSize: 12,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: d.name === 'RIL' ? 600 : 400 }}>{d.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)' }}>
                          {d.units.toLocaleString()}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', minWidth: 42, textAlign: 'right' }}>
                          {d.pct.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '48px 0' }}>
                  No installed base data yet.
                </div>
              )}
            </div>
          </div>

          {/* Competitor breakdown table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Competitor Breakdown · PCP</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} tracked
              </span>
            </div>
            {competitors.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '48px 0' }}>
                No competitor data
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Make', 'PCP Units', 'Share', '', 'vs RIL'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {competitors.map(comp => {
                    const barPct = maxCompPct > 0 ? (comp.pct / maxCompPct) * 100 : 0;
                    const vsRil = totals.ril_pcp > 0
                      ? ((comp.units - totals.ril_pcp) / totals.ril_pcp) * 100
                      : 0;
                    return (
                      <tr key={comp.name} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: comp.color, display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ fontWeight: 500 }}>{comp.name}</span>
                          </div>
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {comp.units.toLocaleString()}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {comp.pct.toFixed(1)}%
                        </td>
                        <td style={{ ...TD, width: 100, paddingLeft: 6, paddingRight: 12 }}>
                          <div style={{ height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${barPct}%`, height: '100%', background: comp.color, borderRadius: 3 }} />
                          </div>
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: vsRil > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                          {totals.ril_pcp > 0 ? `${vsRil > 0 ? '+' : ''}${vsRil.toFixed(0)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── RIL share by industry ────────────────────────────── */}
        {industryShare.length > 0 && (
          <div style={{ ...PANEL, marginBottom: 14 }}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>RIL Share by Industry Segment</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                {industryShare.length} segment{industryShare.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px 28px' }}>
              {industryShare.map(seg => {
                const pct = seg.total_pcp > 0 ? (seg.ril_pcp / seg.total_pcp) * 100 : 0;
                return (
                  <div key={seg.industry}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, fontSize: 11 }}>
                      <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {seg.industry}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)', marginLeft: 8, flexShrink: 0,
                        color: pct >= 50 ? 'var(--pos)' : pct >= 25 ? 'var(--fg-2)' : 'var(--neg)',
                      }}>
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct >= 50 ? 'var(--pos)' : 'var(--accent)' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                      {seg.ril_pcp}/{seg.total_pcp} units
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Displacement opportunities ───────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Accounts with Competitor Presence</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              active clients · competitor PCP units installed
            </span>
            {totalCompetitorUnits > 0 && (
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind="warn">{totalCompetitorUnits} competitor units</Tag>
              </div>
            )}
          </div>
          {displacementAccounts.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '40px 0' }}>
              No displacement data available
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Client', 'Zone', 'RIL PCP', 'Competitor PCP', 'Total PCP', 'RIL Share', 'Rep'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displacementAccounts.map((acc, i) => {
                    const share = acc.total_pcp > 0 ? (acc.ril_pcp / acc.total_pcp) * 100 : 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500, verticalAlign: 'middle' }}>
                          {acc.client_name}
                        </td>
                        <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>
                          {acc.zone ?? '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: acc.ril_pcp > 0 ? 'var(--pos)' : 'var(--fg-3)' }}>
                          {acc.ril_pcp}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--neg)' }}>
                          {acc.competitor_pcp}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {acc.total_pcp}
                        </td>
                        <td style={TD}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 4, background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
                              <div style={{ width: `${share}%`, height: '100%', background: share >= 50 ? 'var(--pos)' : share >= 25 ? 'var(--accent)' : 'var(--neg)', borderRadius: 2 }} />
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: share >= 50 ? 'var(--pos)' : 'var(--neg)', minWidth: 34 }}>
                              {share.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>
                          {acc.rep_name ?? '—'}
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
    </div>
  );
}

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
