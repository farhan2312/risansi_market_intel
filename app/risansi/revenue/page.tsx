import type { CSSProperties } from 'react';
import { Topbar, Tag, MiniBars, MultiSelectFilter, ActiveFilterBar, SortableTH } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentFY, fmtL } from '@/lib/risansi-utils';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

const INR_TO_L = 100_000;

interface Summary {
  ytd:          number;
  py:           number;
  ppy:          number;
  activeClients: number;
}

interface YoYRow     { label: string; total: number; }
interface IndustryRow { industry: string; ytd: number; py: number; }
interface RepZoneRow  { zone: string; rep: string; ytd: number; py: number; clients: number; }

interface TopClient {
  code: string; name: string; industry: string; zone: string;
  ytd: number; py: number;
}

interface BizCatRow { category: string; client_count: number; ytd: number; }

// Sort map for top clients table
const SORT_MAP: Record<string, string> = {
  name:     'c.legal_name',
  industry: 'c.industry',
  zone:     'c.zone',
  ytd:      'COALESCE(c.rev_2526_total,0)',
  py:       'COALESCE(c.rev_2425_total,0)',
};

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const fy = getCurrentFY();

  // Multi-select filters for top clients table
  const indFilts  = typeof sp.industry === 'string' && sp.industry ? sp.industry.split(',').filter(Boolean) : [];
  const zoneFilts = typeof sp.zone     === 'string' && sp.zone     ? sp.zone.split(',').filter(Boolean)     : [];

  // Sort
  const sortKey  = typeof sp.sort === 'string' ? sp.sort : 'ytd';
  const orderDir = sp.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol  = SORT_MAP[sortKey] ?? 'COALESCE(c.rev_2526_total,0)';

  // Build WHERE for top clients
  const clientConds: string[] = ['c.deleted_at IS NULL', 'COALESCE(c.rev_2526_total,0) > 0'];
  const clientVals: (string | string[])[] = [];
  let idx = 1;

  if (indFilts.length > 0) {
    clientConds.push(`c.industry = ANY($${idx}::text[])`);
    clientVals.push(indFilts); idx++;
  }
  if (zoneFilts.length > 0) {
    clientConds.push(`c.zone = ANY($${idx}::text[])`);
    clientVals.push(zoneFilts); idx++;
  }

  const clientWhere = `WHERE ${clientConds.join(' AND ')}`;

  const [summary, yoy, byIndustry, byRepZone, topClients, byBizCat, industryOptions, zoneOptions] = await Promise.all([

    // 1. Summary totals
    q<Summary>(async () => {
      const { rows } = await risansiPool.query<{
        ytd: string; py: string; ppy: string; active: string;
      }>(
        `SELECT
           COALESCE(SUM(rev_2526_total),0)::text AS ytd,
           COALESCE(SUM(rev_2425_total),0)::text AS py,
           COALESCE(SUM(rev_2324_total),0)::text AS ppy,
           COUNT(*) FILTER (WHERE status = 'ACTIVE' AND deleted_at IS NULL)::text AS active
         FROM clients
         WHERE deleted_at IS NULL`,
      );
      const r = rows[0];
      return {
        ytd:           Number(r?.ytd    ?? 0) / INR_TO_L,
        py:            Number(r?.py     ?? 0) / INR_TO_L,
        ppy:           Number(r?.ppy    ?? 0) / INR_TO_L,
        activeClients: Number(r?.active ?? 0),
      };
    }, { ytd: 0, py: 0, ppy: 0, activeClients: 0 }),

    // 2. YoY trend
    q<YoYRow[]>(async () => {
      const { rows } = await risansiPool.query<{
        h2021: string; h2122: string; h2223: string; h2324: string; h2425: string; h2526: string;
      }>(
        `SELECT
           COALESCE(SUM(rev_2021), 0)::text AS h2021,
           COALESCE(SUM(rev_2122_total),0)::text AS h2122,
           COALESCE(SUM(rev_2223_total),0)::text AS h2223,
           COALESCE(SUM(rev_2324_total),0)::text AS h2324,
           COALESCE(SUM(rev_2425_total),0)::text AS h2425,
           COALESCE(SUM(rev_2526_total),0)::text AS h2526
         FROM clients WHERE deleted_at IS NULL`,
      );
      const r = rows[0] ?? {};
      return [
        { label: 'FY21', total: Number((r as Record<string, string>).h2021 ?? 0) / INR_TO_L },
        { label: 'FY22', total: Number((r as Record<string, string>).h2122 ?? 0) / INR_TO_L },
        { label: 'FY23', total: Number((r as Record<string, string>).h2223 ?? 0) / INR_TO_L },
        { label: 'FY24', total: Number((r as Record<string, string>).h2324 ?? 0) / INR_TO_L },
        { label: 'FY25', total: Number((r as Record<string, string>).h2425 ?? 0) / INR_TO_L },
        { label: 'FY26', total: Number((r as Record<string, string>).h2526 ?? 0) / INR_TO_L },
      ];
    }, []),

    // 3. By industry
    q<IndustryRow[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string; ytd: string; py: string }>(
        `SELECT
           COALESCE(c.industry, 'Unknown') AS industry,
           COALESCE(SUM(c.rev_2526_total),0)::text AS ytd,
           COALESCE(SUM(c.rev_2425_total),0)::text AS py
         FROM clients c
         WHERE c.deleted_at IS NULL
         GROUP BY COALESCE(c.industry, 'Unknown')
         ORDER BY SUM(COALESCE(c.rev_2526_total,0)) DESC
         LIMIT 12`,
      );
      return rows.map(r => ({
        industry: r.industry,
        ytd:      Number(r.ytd) / INR_TO_L,
        py:       Number(r.py)  / INR_TO_L,
      }));
    }, []),

    // 4. By rep / zone
    q<RepZoneRow[]>(async () => {
      const { rows } = await risansiPool.query<{
        zone: string; rep: string; ytd: string; py: string; clients: string;
      }>(
        `SELECT
           COALESCE(c.zone, '—') AS zone,
           COALESCE(r.name, 'Unassigned') AS rep,
           COALESCE(SUM(c.rev_2526_total),0)::text AS ytd,
           COALESCE(SUM(c.rev_2425_total),0)::text AS py,
           COUNT(c.id)::text AS clients
         FROM clients c
         LEFT JOIN reps r ON r.id = c.rep_id
         WHERE c.deleted_at IS NULL
         GROUP BY COALESCE(c.zone, '—'), COALESCE(r.name, 'Unassigned')
         ORDER BY SUM(COALESCE(c.rev_2526_total,0)) DESC
         LIMIT 15`,
      );
      return rows.map(r => ({
        zone:    r.zone,
        rep:     r.rep,
        ytd:     Number(r.ytd)     / INR_TO_L,
        py:      Number(r.py)      / INR_TO_L,
        clients: Number(r.clients),
      }));
    }, []),

    // 5. Top clients (with filters + sort)
    q<TopClient[]>(async () => {
      const { rows } = await risansiPool.query<{
        code: string; name: string; industry: string; zone: string;
        ytd: string; py: string;
      }>(
        `SELECT
           c.code,
           c.legal_name AS name,
           COALESCE(c.industry, '—') AS industry,
           COALESCE(c.zone, '—') AS zone,
           COALESCE(c.rev_2526_total,0)::text AS ytd,
           COALESCE(c.rev_2425_total,0)::text AS py
         FROM clients c
         ${clientWhere}
         ORDER BY ${sortCol} ${orderDir} NULLS LAST
         LIMIT 20`,
        clientVals as string[],
      );
      return rows.map(r => ({
        code:     r.code,
        name:     r.name,
        industry: r.industry,
        zone:     r.zone,
        ytd:      Number(r.ytd) / INR_TO_L,
        py:       Number(r.py)  / INR_TO_L,
      }));
    }, []),

    // 6. By business category
    q<BizCatRow[]>(async () => {
      const { rows } = await risansiPool.query<{ category: string; client_count: string; ytd: string }>(
        `SELECT
           COALESCE(business_category, 'Uncategorised') AS category,
           COUNT(*)::text AS client_count,
           COALESCE(SUM(rev_2526_total),0)::text AS ytd
         FROM clients
         WHERE deleted_at IS NULL AND status = 'ACTIVE'
         GROUP BY business_category
         ORDER BY SUM(COALESCE(rev_2526_total,0)) DESC
         LIMIT 8`,
      );
      return rows.map(r => ({
        category:     r.category,
        client_count: Number(r.client_count),
        ytd:          Number(r.ytd) / INR_TO_L,
      }));
    }, []),

    // 7. Industry options
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string }>(
        `SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL ORDER BY industry`,
      );
      return rows.map(r => r.industry);
    }, []),

    // 8. Zone options
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ zone: string }>(
        `SELECT DISTINCT zone FROM clients WHERE zone IS NOT NULL AND deleted_at IS NULL ORDER BY zone`,
      );
      return rows.map(r => r.zone);
    }, []),
  ]);

  // ── Derived ───────────────────────────────────────────────────

  const yoyGrowth   = summary.py > 0 ? ((summary.ytd - summary.py) / summary.py) * 100 : 0;
  const pyGrowth    = summary.ppy > 0 ? ((summary.py - summary.ppy) / summary.ppy) * 100 : 0;
  const maxIndustry = Math.max(...byIndustry.map(r => r.ytd), 1);
  const maxRepZone  = Math.max(...byRepZone.map(r => r.ytd), 1);
  const yoyValues   = yoy.map(r => r.total);
  const yoyLabels   = yoy.map(r => r.label);

  const curSort  = sortKey;
  const curDir   = orderDir === 'DESC' ? 'desc' : 'asc';
  const anyFilter = indFilts.length > 0 || zoneFilts.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Revenue']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ───────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Revenue Intelligence
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {fy.label} · All figures in ₹ Lakhs · Source: client master
          </div>
        </div>

        {/* ── KPI row ───────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          <KpiCard
            label={`${fy.label} Revenue`}
            value={fmtL(summary.ytd)}
            delta={yoyGrowth !== 0 ? `${yoyGrowth >= 0 ? '+' : ''}${yoyGrowth.toFixed(1)}% vs FY25` : undefined}
            positive={yoyGrowth >= 0}
          />
          <KpiCard
            label="FY 24–25 (PY)"
            value={fmtL(summary.py)}
            delta={pyGrowth !== 0 ? `${pyGrowth >= 0 ? '+' : ''}${pyGrowth.toFixed(1)}% vs FY24` : undefined}
            positive={pyGrowth >= 0}
          />
          <KpiCard
            label="Active Clients"
            value={summary.activeClients.toLocaleString('en-IN')}
            delta={byIndustry.length > 0 ? `${byIndustry.length} industries` : undefined}
            positive
          />
          <KpiCard
            label="Top Industry"
            value={byIndustry[0]?.industry ?? '—'}
            delta={byIndustry[0] ? fmtL(byIndustry[0].ytd) : undefined}
            positive
          />
        </div>

        {/* ── YoY trend + business category ─────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>

          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Year-on-Year Revenue Trend</span>
              <span style={META}>FY21 – FY26 · ₹ Lakhs</span>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {yoyValues.length > 0 ? (
                <>
                  <MiniBars values={yoyValues} labels={yoyLabels} width={520} height={90} color="#1A5CB8" />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                    {yoy.map((row, i) => (
                      <div key={i} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: i === yoy.length - 1 ? 700 : 400, color: i === yoy.length - 1 ? '#0A3D8F' : 'var(--fg-3)' }}>
                          {fmtL(row.total)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>No historical data</div>
              )}
            </div>
          </div>

          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Business Category</span>
              <span style={META}>{fy.label} · active clients</span>
            </div>
            {byBizCat.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>No data</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Category', 'Clients', 'Revenue FY26', '% of Total'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byBizCat.map(row => {
                    const pct = summary.ytd > 0 ? (row.ytd / summary.ytd) * 100 : 0;
                    return (
                      <tr key={row.category} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <BizCatPill category={row.category} />
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          {row.client_count}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#0D1B2A', fontSize: 12 }}>
                          {fmtL(row.ytd)}
                        </td>
                        <td style={{ ...TD, minWidth: 90 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 4, background: '#DDE6F5', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: '#1A5CB8', borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', minWidth: 30, textAlign: 'right' }}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'var(--bg-elev)', fontWeight: 600 }}>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Total
                    </td>
                    <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {byBizCat.reduce((s, r) => s + r.client_count, 0)}
                    </td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0D1B2A' }}>
                      {fmtL(byBizCat.reduce((s, r) => s + r.ytd, 0))}
                    </td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', textAlign: 'right' }}>
                      100%
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Industry breakdown + Top clients ──────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 14, marginBottom: 14 }}>

          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Revenue by Industry</span>
              <span style={META}>{fy.label}</span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              {byIndustry.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '24px 0' }}>No data</div>
              )}
              {byIndustry.map((row, i) => {
                const pct   = (row.ytd / maxIndustry) * 100;
                const delta = row.py > 0 ? ((row.ytd - row.py) / row.py) * 100 : null;
                const colors = ['#0A3D8F','#1A5CB8','#2E7DD1','#00B4D8','#059669','#D97706','#7C3AED','#DC2626','#6B7FA3','#374151','#0891B2','#065F46'];
                return (
                  <div key={row.industry} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                      <span style={{ color: '#2C3E5A', fontWeight: i < 3 ? 600 : 400, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.industry}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1B2A', display: 'flex', gap: 8, alignItems: 'center' }}>
                        {delta != null && (
                          <span style={{ fontSize: 10, color: delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                            {delta >= 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(0)}%
                          </span>
                        )}
                        {fmtL(row.ytd)}
                      </span>
                    </div>
                    <div style={{ height: 5, background: '#DDE6F5', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: colors[i % colors.length], borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top 20 clients */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Top 20 Clients · {fy.label}</span>
              <span style={META}>{topClients.length} accounts</span>
            </div>

            {/* Filter row */}
            <div style={{ padding: '10px 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <MultiSelectFilter param="industry" label="Industry" options={industryOptions} selected={indFilts} />
              <MultiSelectFilter param="zone"     label="Zone"     options={zoneOptions}     selected={zoneFilts} />
            </div>

            {/* Active filter pills */}
            {anyFilter && (
              <div style={{ padding: '4px 14px 0' }}>
                <ActiveFilterBar filters={[
                  { param: 'industry', label: 'Industry', values: indFilts  },
                  { param: 'zone',     label: 'Zone',     values: zoneFilts },
                ]} />
              </div>
            )}

            <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto', marginTop: 4 }}>
              {topClients.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>No revenue data</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      <th style={TH}>#</th>
                      <SortableTH col="name"     label="Account"  currentSort={curSort} currentDir={curDir} />
                      <SortableTH col="industry" label="Industry" currentSort={curSort} currentDir={curDir} />
                      <SortableTH col="zone"     label="Zone"     currentSort={curSort} currentDir={curDir} />
                      <SortableTH col="ytd"      label="YTD"      currentSort={curSort} currentDir={curDir} align="right" />
                      <SortableTH col="py"       label="vs PY"    currentSort={curSort} currentDir={curDir} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {topClients.map((c, i) => {
                      const delta = c.py > 0 ? ((c.ytd - c.py) / c.py) * 100 : null;
                      return (
                        <tr key={c.code} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', width: 28 }}>{i + 1}</td>
                          <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                            <div style={{ fontWeight: 500 }}>{c.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{c.code}</div>
                          </td>
                          <td style={TD}><Tag>{c.industry}</Tag></td>
                          <td style={{ ...TD, color: 'var(--fg-3)' }}>{c.zone}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#0D1B2A' }}>{fmtL(c.ytd)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: delta != null ? (delta >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--fg-3)' }}>
                            {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* ── Rep / Zone table ──────────────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Revenue by Zone / Rep</span>
            <span style={META}>{fy.label}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {byRepZone.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>No data</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Zone', 'Rep', 'Clients', 'YTD Revenue', 'PY Revenue', 'Growth', 'Share'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byRepZone.map((row, i) => {
                    const delta = row.py > 0 ? ((row.ytd - row.py) / row.py) * 100 : null;
                    const share = summary.ytd > 0 ? (row.ytd / summary.ytd) * 100 : 0;
                    return (
                      <tr key={`${row.zone}-${row.rep}`} style={{ borderBottom: i < byRepZone.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td style={{ ...TD, fontWeight: 500, color: '#0A3D8F' }}>{row.zone}</td>
                        <td style={TD}>{row.rep}</td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{row.clients}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#0D1B2A' }}>{fmtL(row.ytd)}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{fmtL(row.py)}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: delta != null ? (delta >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--fg-3)' }}>
                          {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle', minWidth: 100 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 4, background: '#DDE6F5', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${(row.ytd / maxRepZone) * 100}%`, background: '#1A5CB8', borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', minWidth: 32, textAlign: 'right' }}>
                              {share.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

const BIZ_CAT_STYLE: Record<string, { bg: string; color: string }> = {
  '10 Lacs+ per annum':          { bg: '#DBEAFE', color: '#0A3D8F' },
  '5–10 Lacs per annum':         { bg: '#EFF6FF', color: '#1A5CB8' },
  '1–5 Lacs per annum':          { bg: '#ECFEFF', color: '#0891B2' },
  '10K–1 Lac per annum':         { bg: '#FEF3C7', color: '#D97706' },
  'Below 10K per annum':         { bg: '#F1F5F9', color: '#64748B' },
  'Active — No FY26 Revenue':    { bg: '#FEE2E2', color: '#B91C1C' },
  'Prospective':                 { bg: '#D1FAE5', color: '#065F46' },
  'No Activity':                 { bg: '#F8FAFC', color: '#94A3B8' },
  'Uncategorised':               { bg: '#F1F5F9', color: '#64748B' },
};

function BizCatPill({ category }: { category: string }) {
  const style = BIZ_CAT_STYLE[category] ?? { bg: '#F1F5F9', color: '#64748B' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      borderRadius: 12, fontSize: 11, fontWeight: 500,
      background: style.bg, color: style.color, whiteSpace: 'nowrap',
    }}>
      {category}
    </span>
  );
}

function KpiCard({ label, value, delta, positive }: {
  label: string; value: string; delta?: string; positive?: boolean;
}) {
  return (
    <div style={{ ...PANEL, borderLeft: '3px solid #0A3D8F', padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7FA3', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#0D1B2A', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {delta && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: positive ? 'var(--pos)' : 'var(--neg)', marginTop: 4 }}>
          {positive ? '▲' : '▼'} {delta}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background:   'var(--bg-paper)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

const PANEL_H: CSSProperties = {
  padding:      '12px 16px',
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
  fontSize:   11,
  color:      'var(--fg-3)',
  fontFamily: 'var(--font-mono)',
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
