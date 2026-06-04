import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Donut, Tag, KpiCard, MultiSelectFilter, ActiveFilterBar, SortableTH } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { fmtCr } from '@/lib/risansi-utils';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

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

function fmtD(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

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
  industry:  string;
  ril_pcp:   number;
  total_pcp: number;
}

// ── Visit-sourced intelligence ─────────────────────────────────

interface FieldSighting {
  supplier: string; pump_type: string | null; application: string | null;
  condition: string | null; client_name: string; client_code: string;
  visit_date: string | null; rep_name: string;
}
interface CompActivity {
  visit_date: string | null; competitors_observed: string | null;
  pcp_competitor: string | null; client_name: string; client_code: string; rep_name: string;
}
interface LostTo { competitor: string; losses: number; value_cr: number; }
interface PriceIntel {
  visit_date: string | null; pics: number; client_name: string; client_code: string; rep_name: string;
}

// Sort map for displacement table
const SORT_MAP: Record<string, string> = {
  client:         'c.legal_name',
  zone:           'c.zone',
  ril_pcp:        'cib.ril_pcp',
  competitor_pcp: '(cib.total_pcp - COALESCE(cib.ril_pcp, 0))',
  total_pcp:      'cib.total_pcp',
  share:          '(COALESCE(cib.ril_pcp,0)::float / NULLIF(cib.total_pcp,0))',
  rep:            'r.name',
};

export default async function CompetePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ── Role / rep scoping (rep sees only their own visit data) ──
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  const isRep   = role === 'rep';
  let repId: number | null = session?.user?.repId ?? null;
  if (isRep && repId == null && session?.user?.email) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM reps WHERE email = $1 LIMIT 1', [session.user.email],
    );
    repId = r.rows[0]?.id ?? null;
  }

  // Multi-select filters for displacement table
  const zoneFilts = typeof sp.zone === 'string' && sp.zone ? sp.zone.split(',').filter(Boolean) : [];
  const repFilts  = typeof sp.rep  === 'string' && sp.rep  ? sp.rep.split(',').filter(Boolean)  : [];

  // Sort
  const sortKey  = typeof sp.sort === 'string' ? sp.sort : 'competitor_pcp';
  const orderDir = sp.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol  = SORT_MAP[sortKey] ?? '(cib.total_pcp - COALESCE(cib.ril_pcp, 0))';

  // Build WHERE for displacement query
  const dispConds: string[] = [
    `(cib.total_pcp - COALESCE(cib.ril_pcp, 0)) > 0`,
    `c.status = 'ACTIVE'`,
  ];
  const dispVals: (string | string[])[] = [];
  let idx = 1;

  if (zoneFilts.length > 0) {
    dispConds.push(`c.zone = ANY($${idx}::text[])`);
    dispVals.push(zoneFilts); idx++;
  }
  if (repFilts.length > 0) {
    dispConds.push(`r.name = ANY($${idx}::text[])`);
    dispVals.push(repFilts); idx++;
  }

  const dispWhere = `WHERE ${dispConds.join(' AND ')}`;

  // Rep scope fragment for visit-sourced queries (parameterised as $1)
  const repScope = (isRep && repId) ? true : false;

  const [
    totals, displacementAccounts, industryShare, zoneOptions, repOptions,
    fieldSightings, competitorActivity, lostToRows, priceIntel,
  ] = await Promise.all([

    // 1. Aggregate totals
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

    // 2. Displacement accounts (with filters + sort)
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
                r.name AS rep_name
         FROM competitor_installed_base cib
         JOIN clients c ON c.code = cib.client_code
         LEFT JOIN reps r ON r.id = c.primary_rep_id
         ${dispWhere}
         ORDER BY ${sortCol} ${orderDir} NULLS LAST
         LIMIT 50`,
        dispVals as string[],
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
         JOIN clients c ON c.code = cib.client_code
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

    // 4. Zone options for filter
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ zone: string }>(
        `SELECT DISTINCT c.zone FROM clients c
         JOIN competitor_installed_base cib ON c.code = cib.client_code
         WHERE c.zone IS NOT NULL AND c.status = 'ACTIVE'
         ORDER BY c.zone`,
      );
      return rows.map(r => r.zone);
    }, []),

    // 5. Rep options for filter
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ name: string }>(
        `SELECT DISTINCT name FROM reps WHERE deleted_at IS NULL ORDER BY name`,
      );
      return rows.map(r => r.name);
    }, []),

    // A. Field Sightings — competitor equipment logged on visits
    q<FieldSighting[]>(async () => {
      const { rows } = await risansiPool.query<{
        supplier: string; pump_type: string | null; application: string | null;
        condition: string | null; client_name: string; client_code: string;
        visit_date: string | null; rep_name: string;
      }>(
        `SELECT COALESCE(e.supplier, 'Unknown') AS supplier,
                e.pump_type, e.application, e.condition,
                c.legal_name AS client_name, c.code AS client_code,
                v.visit_date::text AS visit_date,
                COALESCE(r.name, '—') AS rep_name
         FROM equipment e
         JOIN visits  v ON v.id = e.visit_id
         JOIN clients c ON c.id = e.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE e.is_ril = FALSE
           ${repScope ? 'AND v.rep_id = $1' : ''}
         ORDER BY v.visit_date DESC NULLS LAST
         LIMIT 100`,
        repScope ? [repId] : [],
      );
      return rows;
    }, []),

    // B. Competitor Activity Feed — visits flagged with competitor activity
    q<CompActivity[]>(async () => {
      const { rows } = await risansiPool.query<CompActivity>(
        `SELECT v.visit_date::text AS visit_date,
                v.competitors_observed, v.pcp_competitor,
                c.legal_name AS client_name, c.code AS client_code,
                COALESCE(r.name, '—') AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE v.competitor_activity_observed = TRUE
           ${repScope ? 'AND v.rep_id = $1' : ''}
         ORDER BY v.visit_date DESC NULLS LAST
         LIMIT 20`,
        repScope ? [repId] : [],
      );
      return rows;
    }, []),

    // C. Lost To Analysis — opportunities lost to named competitors
    q<LostTo[]>(async () => {
      const { rows } = await risansiPool.query<{ competitor: string; losses: string; value_cr: string }>(
        `SELECT o.lost_to_competitor AS competitor,
                COUNT(*)::text AS losses,
                COALESCE(SUM(o.value_cr), 0)::text AS value_cr
         FROM opportunities o
         WHERE o.lost_to_competitor IS NOT NULL AND TRIM(o.lost_to_competitor) <> ''
           ${repScope ? 'AND o.rep_id = $1' : ''}
         GROUP BY o.lost_to_competitor
         ORDER BY COUNT(*) DESC, SUM(o.value_cr) DESC NULLS LAST
         LIMIT 10`,
        repScope ? [repId] : [],
      );
      return rows.map(r => ({ competitor: r.competitor, losses: Number(r.losses), value_cr: Number(r.value_cr) }));
    }, []),

    // D. Price Intelligence — where competitor prices were captured
    q<PriceIntel[]>(async () => {
      const { rows } = await risansiPool.query<{
        visit_date: string | null; pics: string | null;
        client_name: string; client_code: string; rep_name: string;
      }>(
        `SELECT v.visit_date::text AS visit_date,
                vsr.competitor_pics_count::text AS pics,
                c.legal_name AS client_name, c.code AS client_code,
                COALESCE(r.name, '—') AS rep_name
         FROM visit_sugar_report vsr
         JOIN visits  v ON v.id = vsr.visit_id
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE vsr.competitor_prices_captured = TRUE
           ${repScope ? 'AND v.rep_id = $1' : ''}
         ORDER BY v.visit_date DESC NULLS LAST
         LIMIT 20`,
        repScope ? [repId] : [],
      );
      return rows.map(r => ({ ...r, pics: Number(r.pics ?? 0) }));
    }, []),
  ]);

  // ── Field-sightings supplier rollup (which competitors we meet most) ──
  const sightingCounts = (() => {
    const m = new Map<string, number>();
    for (const s of fieldSightings) m.set(s.supplier, (m.get(s.supplier) ?? 0) + 1);
    return [...m.entries()].map(([supplier, count]) => ({ supplier, count })).sort((a, b) => b.count - a.count);
  })();
  const maxSighting = sightingCounts.length ? Math.max(...sightingCounts.map(s => s.count)) : 1;
  const maxLosses   = lostToRows.length ? Math.max(...lostToRows.map(l => l.losses)) : 1;

  // ── Derived values ─────────────────────────────────────────────
  const safeTotal = Math.max(totals.total_pcp, 1);
  const rilShare  = (totals.ril_pcp / safeTotal) * 100;

  const rotoTotal  = totals.roto_pcp + totals.rotomac_pcp;
  const namedTotal = totals.ril_pcp + rotoTotal + totals.netzsch_pcp + totals.gita_pcp + totals.psp_pcp + totals.tushaco_pcp;
  const othersUnits = Math.max(0, totals.total_pcp - namedTotal);

  const donutSlices = [
    { name: 'RIL',          units: totals.ril_pcp,    color: compColor('RIL') },
    { name: 'Roto+Rotomac', units: rotoTotal,          color: compColor('Roto+Rotomac') },
    { name: 'Netzsch',      units: totals.netzsch_pcp, color: compColor('Netzsch') },
    { name: 'Gita',         units: totals.gita_pcp,    color: compColor('Gita') },
    { name: 'PSP',          units: totals.psp_pcp,     color: compColor('PSP') },
    { name: 'Tushaco',      units: totals.tushaco_pcp, color: compColor('Tushaco') },
    ...(othersUnits > 0 ? [{ name: 'Others', units: othersUnits, color: compColor('Others') }] : []),
  ].filter(d => d.units > 0).map(d => ({ ...d, pct: (d.units / safeTotal) * 100 }));

  const competitors = donutSlices.filter(d => d.name !== 'RIL');
  const maxCompPct  = competitors.length > 0 ? Math.max(...competitors.map(c => c.pct)) : 1;
  const totalCompetitorUnits = displacementAccounts.reduce((s, r) => s + r.competitor_pcp, 0);

  const curSort  = sortKey;
  const curDir   = orderDir === 'DESC' ? 'desc' : 'asc';
  const anyFilter = zoneFilts.length > 0 || repFilts.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Competition Intelligence']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Competition Intelligence
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

        {/* ── Donut + Competitor breakdown ──────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14, marginBottom: 14 }}>

          <div style={PANEL}>
            <div style={PANEL_H}><span style={PANEL_TITLE}>PCP Market Share</span></div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              {totals.total_pcp > 0 ? (
                <>
                  <Donut
                    data={donutSlices.map(d => ({ pct: d.pct, color: d.color, name: d.name }))}
                    size={160} thick={22}
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
                    const vsRil  = totals.ril_pcp > 0 ? ((comp.units - totals.ril_pcp) / totals.ril_pcp) * 100 : 0;
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

        {/* ── Displacement accounts ────────────────────────────── */}
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

          {/* Filter row */}
          <div style={{ padding: '10px 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <MultiSelectFilter param="zone" label="Zone" options={zoneOptions} selected={zoneFilts} />
            <MultiSelectFilter param="rep"  label="Rep"  options={repOptions}  selected={repFilts}  />
          </div>

          {/* Active filter pills */}
          {anyFilter && (
            <div style={{ padding: '4px 14px 0' }}>
              <ActiveFilterBar filters={[
                { param: 'zone', label: 'Zone', values: zoneFilts },
                { param: 'rep',  label: 'Rep',  values: repFilts  },
              ]} />
            </div>
          )}

          {displacementAccounts.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '40px 0' }}>
              No displacement data available
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <SortableTH col="client"         label="Client"          currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="zone"           label="Zone"            currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="ril_pcp"        label="RIL PCP"         currentSort={curSort} currentDir={curDir} align="right" />
                    <SortableTH col="competitor_pcp" label="Competitor PCP"  currentSort={curSort} currentDir={curDir} align="right" />
                    <SortableTH col="total_pcp"      label="Total PCP"       currentSort={curSort} currentDir={curDir} align="right" />
                    <SortableTH col="share"          label="RIL Share"       currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="rep"            label="Rep"             currentSort={curSort} currentDir={curDir} />
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

        {/* ═══ VISIT INTELLIGENCE — sourced from field visit forms ═══ */}
        <div style={{ margin: '26px 0 12px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Visit Intelligence</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
            Live competitor signals captured by reps in the field
            {isRep && ' · your visits only'}
          </div>
        </div>

        {/* Section A — Field Sightings */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Field Sightings · Competitor Equipment</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
              {fieldSightings.length} logged on visits
            </span>
          </div>
          {fieldSightings.length === 0 ? (
            <div style={EMPTY}>No competitor equipment logged on visits yet</div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px 20px', borderBottom: '1px solid var(--line)' }}>
                {sightingCounts.map(s => (
                  <div key={s.supplier}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: 'var(--fg-2)' }}>{s.supplier}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{s.count}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(s.count / maxSighting) * 100}%`, height: '100%', background: 'var(--neg)', borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      {['Competitor', 'Pump Type', 'Application', 'Client', 'Logged', 'Condition'].map(h => <th key={h} style={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {fieldSightings.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ ...TD, fontWeight: 500 }}>{s.supplier}</td>
                        <td style={TD}>{s.pump_type ?? '—'}</td>
                        <td style={{ ...TD, color: 'var(--fg-3)' }}>{s.application ?? '—'}</td>
                        <td style={TD}>
                          {s.client_name}
                          <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{s.client_code}</span>
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{fmtD(s.visit_date)}</td>
                        <td style={TD}>
                          {s.condition
                            ? <Tag kind={/eol|end of life/i.test(s.condition) ? 'neg' : undefined}>{s.condition}</Tag>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Section B — Competitor Activity Feed */}
        <div style={{ ...PANEL, marginTop: 14 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Competitor Activity Feed</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>most recent {competitorActivity.length}</span>
          </div>
          {competitorActivity.length === 0 ? (
            <div style={EMPTY}>No competitor activity observed on visits yet</div>
          ) : (
            <div>
              {competitorActivity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: i < competitorActivity.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ width: 90, flexShrink: 0, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{fmtD(a.visit_date)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>
                      {a.client_name}
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--fg-3)' }}>{a.client_code} · {a.rep_name}</span>
                    </div>
                    {a.competitors_observed && <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 2, lineHeight: 1.4 }}>{a.competitors_observed}</div>}
                    {a.pcp_competitor && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>PCP competitor: {a.pcp_competitor}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section C — Lost To Analysis */}
        <div style={{ ...PANEL, marginTop: 14 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Lost To · Opportunities</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>who we lose deals to · last submitted</span>
          </div>
          {lostToRows.length === 0 ? (
            <div style={EMPTY}>No opportunities marked lost to a competitor{isRep ? ' for you' : ''}</div>
          ) : (
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lostToRows.map(l => (
                <div key={l.competitor}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{l.competitor}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
                      {l.losses} loss{l.losses !== 1 ? 'es' : ''}{l.value_cr > 0 ? ` · ${fmtCr(l.value_cr)}` : ''}
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(l.losses / maxLosses) * 100}%`, height: '100%', background: 'var(--neg)', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section D — Price Intelligence */}
        <div style={{ ...PANEL, marginTop: 14 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Price Intelligence · Captures</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>where competitor prices were captured</span>
          </div>
          {priceIntel.length === 0 ? (
            <div style={EMPTY}>No competitor price captures recorded yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Client', 'Date', 'Rep', 'Price Photos'].map(h => <th key={h} style={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {priceIntel.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...TD, fontWeight: 500 }}>
                        {p.client_name}
                        <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{p.client_code}</span>
                      </td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{fmtD(p.visit_date)}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{p.rep_name}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{p.pics > 0 ? `📷 ${p.pics}` : '—'}</td>
                    </tr>
                  ))}
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
  background:    'var(--bg-elev)',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

const EMPTY: CSSProperties = {
  padding:    '32px 0',
  textAlign:  'center',
  fontSize:   12,
  color:      'var(--fg-3)',
};
