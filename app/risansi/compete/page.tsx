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
  RIL:     'oklch(0.62 0.13 50)',
  Roto:    'oklch(0.50 0.11 155)',
  Rotomac: 'oklch(0.50 0.10 235)',
  Gita:    'oklch(0.55 0.11 50)',
  Sintech: 'oklch(0.55 0.12 20)',
  PSP:     'oklch(0.55 0.10 280)',
  Netzsch: 'oklch(0.50 0.09 120)',
  Tushaco: 'oklch(0.50 0.10 60)',
  Others:  'var(--fg-3)',
};
function compColor(name: string) { return COMP_COLORS[name] ?? COMP_COLORS.Others; }

// ── Data shapes ────────────────────────────────────────────────

interface SupplierRow {
  supplier: string;
  units: number;
  industries: string[];
}
interface DisplacementOpp {
  client_name: string;
  station: string | null;
  supplier: string;
  model: string | null;
  condition: string;
  quantity: number;
  rep_name: string | null;
}
interface SightingRow {
  client_name: string;
  station: string | null;
  supplier: string;
  model: string | null;
  equipment_type: string;
  quantity: number;
  created_at: Date;
}
interface IndustryShare {
  industry: string;
  ril_units: number;
  total_units: number;
}

// ── Page ───────────────────────────────────────────────────────

export default async function CompetePage() {

  // 1. All equipment by supplier + which industries they appear in
  const allBySupplier = await q<SupplierRow[]>(async () => {
    const { rows } = await risansiPool.query<{
      supplier: string; units: string; industries: string[];
    }>(
      `SELECT e.supplier,
              SUM(e.quantity)::text                  AS units,
              ARRAY_AGG(DISTINCT c.industry)         AS industries
       FROM equipment_assessment_entries e
       JOIN clients c ON c.id = e.client_id
       GROUP BY e.supplier
       ORDER BY SUM(e.quantity) DESC`,
      [],
    );
    return rows.map(r => ({
      supplier:   r.supplier,
      units:      Number(r.units),
      industries: (r.industries ?? []).filter(Boolean),
    }));
  }, []);

  const totalUnits  = allBySupplier.reduce((s, r) => s + r.units, 0);
  const rilUnits    = allBySupplier.find(r => r.supplier === 'RIL')?.units ?? 0;
  const rilShare    = totalUnits > 0 ? (rilUnits / totalUnits) * 100 : 0;
  const competitors = allBySupplier.filter(r => r.supplier !== 'RIL');

  // Build donut slices: RIL + top competitors + Others
  const TOP_N      = 5;
  const topComps   = competitors.slice(0, TOP_N);
  const otherUnits = competitors.slice(TOP_N).reduce((s, r) => s + r.units, 0);
  const safeTotal  = Math.max(totalUnits, 1);
  const donutSlices = [
    { supplier: 'RIL',   units: rilUnits,   pct: rilShare,                         color: compColor('RIL') },
    ...topComps.map(r => ({ supplier: r.supplier, units: r.units, pct: (r.units / safeTotal) * 100, color: compColor(r.supplier) })),
    ...(otherUnits > 0 ? [{ supplier: 'Others', units: otherUnits, pct: (otherUnits / safeTotal) * 100, color: compColor('Others') }] : []),
  ].filter(d => d.units > 0);

  // 2. pp delta — current 90-day window vs prior 90-day window
  const [shareNow, sharePrev] = await Promise.all([
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ ril: string; total: string }>(
        `SELECT SUM(CASE WHEN supplier = 'RIL' THEN quantity ELSE 0 END)::text AS ril,
                SUM(quantity)::text AS total
         FROM equipment_assessment_entries
         WHERE created_at > NOW() - INTERVAL '90 days'`,
        [],
      );
      const t = Number(rows[0]?.total ?? 0);
      return t > 0 ? (Number(rows[0]?.ril ?? 0) / t) * 100 : 0;
    }, 0),
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ ril: string; total: string }>(
        `SELECT SUM(CASE WHEN supplier = 'RIL' THEN quantity ELSE 0 END)::text AS ril,
                SUM(quantity)::text AS total
         FROM equipment_assessment_entries
         WHERE created_at BETWEEN NOW() - INTERVAL '180 days' AND NOW() - INTERVAL '90 days'`,
        [],
      );
      const t = Number(rows[0]?.total ?? 0);
      return t > 0 ? (Number(rows[0]?.ril ?? 0) / t) * 100 : 0;
    }, 0),
  ]);
  const ppDelta  = shareNow - sharePrev;
  const hasDelta = sharePrev > 0;

  // 3. Displacement opportunities — non-RIL units with opportunity flag set
  const displacementOpps = await q<DisplacementOpp[]>(async () => {
    const { rows } = await risansiPool.query<{
      client_name: string; station: string | null; supplier: string;
      model: string | null; condition: string; quantity: string; rep_name: string | null;
    }>(
      `SELECT c.legal_name   AS client_name,
              e.station,
              e.supplier,
              e.model,
              e.condition,
              e.quantity::text,
              u.name         AS rep_name
       FROM equipment_assessment_entries e
       JOIN clients c ON c.id = e.client_id
       LEFT JOIN users u ON u.id = c.rep_id
       WHERE e.opportunity = true
       ORDER BY e.quantity DESC, c.legal_name
       LIMIT 40`,
      [],
    );
    return rows.map(r => ({
      client_name: r.client_name,
      station:     r.station,
      supplier:    r.supplier,
      model:       r.model,
      condition:   r.condition,
      quantity:    Number(r.quantity),
      rep_name:    r.rep_name,
    }));
  }, []);

  const totalDisplacementUnits = displacementOpps.reduce((s, r) => s + r.quantity, 0);

  // 4. Recent competitor sightings — last 30 days, non-RIL
  const sightings = await q<SightingRow[]>(async () => {
    const { rows } = await risansiPool.query<{
      client_name: string; station: string | null; supplier: string; model: string | null;
      equipment_type: string; quantity: string; created_at: string;
    }>(
      `SELECT c.legal_name  AS client_name,
              e.station,
              e.supplier,
              e.model,
              e.equipment_type,
              e.quantity::text,
              e.created_at::text
       FROM equipment_assessment_entries e
       JOIN clients c ON c.id = e.client_id
       WHERE e.supplier != 'RIL'
         AND e.created_at > NOW() - INTERVAL '30 days'
       ORDER BY e.created_at DESC
       LIMIT 20`,
      [],
    );
    return rows.map(r => ({
      client_name:    r.client_name,
      station:        r.station,
      supplier:       r.supplier,
      model:          r.model,
      equipment_type: r.equipment_type,
      quantity:       Number(r.quantity),
      created_at:     new Date(r.created_at),
    }));
  }, []);

  // 5. RIL share by industry segment
  const industryShare = await q<IndustryShare[]>(async () => {
    const { rows } = await risansiPool.query<{ industry: string; ril: string; total: string }>(
      `SELECT c.industry,
              SUM(CASE WHEN e.supplier = 'RIL' THEN e.quantity ELSE 0 END)::text AS ril,
              SUM(e.quantity)::text AS total
       FROM equipment_assessment_entries e
       JOIN clients c ON c.id = e.client_id
       WHERE c.industry IS NOT NULL
       GROUP BY c.industry
       ORDER BY SUM(e.quantity) DESC
       LIMIT 8`,
      [],
    );
    return rows.map(r => ({
      industry:    r.industry,
      ril_units:   Number(r.ril),
      total_units: Number(r.total),
    }));
  }, []);

  const maxCompPct = competitors.length > 0
    ? Math.max(...competitors.map(c => (c.units / safeTotal) * 100))
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
            PCP installed base · equipment assessments from field
            {totalUnits > 0 && ` · ${totalUnits.toLocaleString()} units across ${allBySupplier.length} supplier${allBySupplier.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* ── KPI row ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          <KpiCard
            label="Total Assessed"
            value={totalUnits > 0 ? totalUnits.toLocaleString() : '—'}
            sub="units in installed base"
          />
          <KpiCard
            label="RIL Units"
            value={rilUnits > 0 ? rilUnits.toLocaleString() : '—'}
            sub="our installed pumps"
            pos
          />
          <KpiCard
            label="RIL Market Share"
            value={totalUnits > 0 ? `${rilShare.toFixed(1)}%` : '—'}
            sub={hasDelta ? `vs prev 90-day window` : 'all assessments'}
            delta={hasDelta ? `${Math.abs(ppDelta).toFixed(1)} pp` : undefined}
            pos={ppDelta >= 0}
          />
          <KpiCard
            label="Displacement Opps"
            value={displacementOpps.length > 0 ? String(displacementOpps.length) : '—'}
            sub={`${totalDisplacementUnits} units · EOL competitor pumps`}
          />
        </div>

        {/* ── Donut + Competitor table ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14, marginBottom: 14 }}>

          {/* Market share donut */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Market Share · PCP</span>
              {hasDelta && (
                <div style={{ marginLeft: 'auto' }}>
                  <Tag kind={ppDelta >= 0 ? 'pos' : 'neg'}>
                    {ppDelta >= 0 ? '+' : ''}{ppDelta.toFixed(1)} pp
                  </Tag>
                </div>
              )}
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              {totalUnits > 0 ? (
                <>
                  <Donut
                    data={donutSlices.map(d => ({ pct: d.pct, color: d.color, name: d.supplier }))}
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
                      <div key={d.supplier} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 0',
                        borderBottom: i < donutSlices.length - 1 ? '1px solid var(--line)' : 'none',
                        fontSize: 12,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: d.supplier === 'RIL' ? 600 : 400 }}>{d.supplier}</span>
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
                  No assessment data yet.<br />
                  <span style={{ fontSize: 11 }}>Record equipment during field visits.</span>
                </div>
              )}
            </div>
          </div>

          {/* Competitor breakdown table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Competitor Breakdown</span>
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
                    {['Make', 'Units', 'Share', '', 'Industries', 'Change'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {competitors.map(comp => {
                    const pct    = (comp.units / safeTotal) * 100;
                    const barPct = maxCompPct > 0 ? (pct / maxCompPct) * 100 : 0;
                    return (
                      <tr key={comp.supplier} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 8, height: 8, borderRadius: 2,
                              background: compColor(comp.supplier),
                              display: 'inline-block', flexShrink: 0,
                            }} />
                            <span style={{ fontWeight: 500 }}>{comp.supplier}</span>
                          </div>
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {comp.units.toLocaleString()}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {pct.toFixed(1)}%
                        </td>
                        <td style={{ ...TD, width: 100, paddingLeft: 6, paddingRight: 12 }}>
                          <div style={{ height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              width: `${barPct}%`, height: '100%',
                              background: compColor(comp.supplier), borderRadius: 3,
                            }} />
                          </div>
                        </td>
                        <td style={{ ...TD, maxWidth: 220 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {comp.industries.slice(0, 3).map(ind => (
                              <Tag key={ind}>{ind}</Tag>
                            ))}
                            {comp.industries.length > 3 && (
                              <Tag>+{comp.industries.length - 3}</Tag>
                            )}
                          </div>
                        </td>
                        <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          —
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
              <span style={PANEL_TITLE}>RIL Share by Industry</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                units assessed · {industryShare.length} segment{industryShare.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px 28px' }}>
              {industryShare.map(seg => {
                const pct = seg.total_units > 0 ? (seg.ril_units / seg.total_units) * 100 : 0;
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
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 3,
                        background: pct >= 50 ? 'var(--pos)' : 'var(--accent)',
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                      {seg.ril_units}/{seg.total_units} units
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Displacement opportunities ───────────────────────── */}
        <div style={{ ...PANEL, marginBottom: 14 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Displacement Opportunities</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              competitor EOL units · opportunity flag set
            </span>
            {totalDisplacementUnits > 0 && (
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind="warn">{totalDisplacementUnits} units ripe</Tag>
              </div>
            )}
          </div>
          {displacementOpps.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '40px 0' }}>
              No displacement opportunities flagged yet
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Client', 'Station', 'Competitor · Model', 'Condition', 'Qty', 'Rep', ''].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displacementOpps.map((opp, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500, verticalAlign: 'middle' }}>
                        {opp.client_name}
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {opp.station ?? '—'}
                      </td>
                      <td style={TD}>
                        <span style={{ fontWeight: 500, color: compColor(opp.supplier) }}>{opp.supplier}</span>
                        {opp.model && <span style={{ color: 'var(--fg-3)' }}> · {opp.model}</span>}
                      </td>
                      <td style={TD}>
                        <Tag kind="neg">{opp.condition}</Tag>
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {opp.quantity}
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>
                        {opp.rep_name ?? '—'}
                      </td>
                      <td style={TD}>
                        <button style={{
                          padding: '4px 10px', fontSize: 11, fontFamily: 'inherit',
                          background: 'oklch(0.62 0.13 50)', color: '#fff',
                          border: 'none', borderRadius: 4, cursor: 'pointer',
                          fontWeight: 500, whiteSpace: 'nowrap',
                        }}>
                          Create opp
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Recent competitor sightings ──────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Recent Competitor Sightings</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>last 30 days</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                background: sightings.length > 0 ? 'var(--warn)' : 'var(--fg-3)',
              }} />
              <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {sightings.length} new entr{sightings.length !== 1 ? 'ies' : 'y'}
              </span>
            </div>
          </div>
          {sightings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '40px 0' }}>
              No competitor equipment recorded in the last 30 days
            </div>
          ) : (
            <div>
              {sightings.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 12,
                  borderBottom: i < sightings.length - 1 ? '1px solid var(--line)' : 'none',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 4,
                    background: 'var(--bg-sunk)', border: '1px solid var(--line)',
                    display: 'grid', placeItems: 'center',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    color: compColor(s.supplier), flexShrink: 0,
                  }}>
                    {s.supplier.slice(0, 3).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ fontWeight: 600, color: compColor(s.supplier) }}>{s.supplier}</strong>
                      {s.model && <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}> {s.model}</span>}
                      <span style={{ color: 'var(--fg-3)' }}> spotted at </span>
                      <strong style={{ fontWeight: 500 }}>{s.client_name}</strong>
                      {s.station && <span style={{ color: 'var(--fg-3)' }}> · {s.station}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                      {s.equipment_type} · {s.quantity} unit{s.quantity !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                      {s.created_at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </div>
                  </div>
                </div>
              ))}
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
