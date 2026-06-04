import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, MultiSelectFilter, ActiveFilterBar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentFY, fmtCr } from '@/lib/risansi-utils';
import { NewOpportunityButton } from '@/components/risansi/NewOpportunityButton';
import { OpportunityKanban } from '@/components/risansi/OpportunityKanban';
import { ActiveOppsTable } from '@/components/risansi/ActiveOppsTable';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface OppRow {
  id:                  string;
  product:             string;
  product_type:        string | null;
  stage:               string;
  value_cr:            number;
  probability:         number | null;
  eta_text:            string | null;
  quote_ref:           string | null;
  notes:               string | null;
  auto_created:        boolean | null;
  auto_source:         string | null;
  client_id:           string;
  client_name:         string;
  client_code:         string;
  industry:            string;
  rep_id:              number | null;
  rep_name:            string | null;
  // Optional edit fields — may not exist on the table
  secondary_rep_id?:   number | null;
  quote_date?:         string | null;
  negotiation_notes?:  string | null;
  po_number?:          string | null;
  final_value_cr?:     string | number | null;
  lost_to_competitor?: string | null;
  lost_reason?:        string | null;
}

interface WinRateRow {
  industry: string;
  won:      string;
  lost:     string;
}

interface LostToRow {
  competitor: string;
  opp_count:  string;
  value:      number;
}

// Sortable columns for Active Opportunities table
const SORT_MAP: Record<string, string> = {
  client:      'c.legal_name',
  product:     'o.product',
  stage:       'o.stage',
  value:       'o.value_cr',
  probability: 'o.probability',
  eta:         'o.eta_text',
  rep:         'r.name',
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const fy = getCurrentFY();

  // ── Role / rep scoping ──────────────────────────────────────
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';

  // Prefer the session's linked rep_id; fall back to email lookup.
  let currentRepId: number | null = session?.user?.repId ?? null;
  if (role === 'rep' && currentRepId == null && session?.user?.email) {
    const repRes = await risansiPool.query<{ id: number }>(
      'SELECT id FROM reps WHERE email = $1 LIMIT 1',
      [session.user.email],
    );
    currentRepId = repRes.rows[0]?.id ?? null;
  }
  // Rep sees own by default; manager/admin sees all; ?rep=all overrides for reps
  const showAll = sp.rep === 'all' || role !== 'rep';

  // Multi-select filters
  const stageFilts    = typeof sp.stage        === 'string' && sp.stage        ? sp.stage.split(',').filter(Boolean)        : [];
  const prodTypeFilts = typeof sp.product_type === 'string' && sp.product_type ? sp.product_type.split(',').filter(Boolean) : [];
  const repFilts      = typeof sp.rep          === 'string' && sp.rep          ? sp.rep.split(',').filter(Boolean)          : [];
  const indFilts      = typeof sp.industry     === 'string' && sp.industry     ? sp.industry.split(',').filter(Boolean)     : [];

  // Sort
  const sortKey  = typeof sp.sort  === 'string' ? sp.sort            : 'value';
  const orderDir = sp.dir === 'desc'            ? 'DESC'             : 'DESC'; // default value DESC
  const sortCol  = SORT_MAP[sortKey] ?? 'o.value_cr';

  // Build shared filter conditions (rep scope + multi-select filters).
  // The stage split (open vs Won/Lost) is applied per-query below.
  const conds: string[] = [];
  const vals: (string | number | string[])[] = [];
  let idx = 1;

  // Rep scoping — limit to own opportunities unless showing all
  if (!showAll && currentRepId != null) {
    conds.push(`o.rep_id = $${idx}`);
    vals.push(currentRepId); idx++;
  }

  if (stageFilts.length > 0) {
    conds.push(`o.stage = ANY($${idx}::text[])`);
    vals.push(stageFilts); idx++;
  }
  if (prodTypeFilts.length > 0) {
    conds.push(`o.product_type = ANY($${idx}::text[])`);
    vals.push(prodTypeFilts); idx++;
  }
  if (repFilts.length > 0) {
    conds.push(`r.name = ANY($${idx}::text[])`);
    vals.push(repFilts); idx++;
  }
  if (indFilts.length > 0) {
    conds.push(`c.industry = ANY($${idx}::text[])`);
    vals.push(indFilts); idx++;
  }

  const filterClause = conds.length ? ` AND ${conds.join(' AND ')}` : '';
  const openWhere   = `WHERE o.stage NOT IN ('Won', 'Lost')${filterClause}`;
  const closedWhere = `WHERE o.stage IN ('Won', 'Lost') AND o.updated_at >= NOW() - INTERVAL '12 months'${filterClause}`;

  const [openOpps, closedOpps, bookedYTD, annualTarget, winLossRows, lostToRows, stageOptions, productTypeOptions, repOptions, industryOptions] = await Promise.all([

    // 1. Open opportunities with filters + sort (feeds KPIs + Active Opportunities table).
    //    SELECT o.* keeps this resilient to which optional columns exist.
    q<OppRow[]>(async () => {
      const { rows } = await risansiPool.query(`
        SELECT o.*,
               c.legal_name AS client_name, c.code AS client_code, c.industry,
               COALESCE(r.name, '—') AS rep_name
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN reps r ON r.id = o.rep_id
        ${openWhere}
        ORDER BY ${sortCol} ${orderDir} NULLS LAST
        LIMIT 200
      `, vals as (string | number)[]
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, value_cr: Number(row.value_cr ?? 0) };
      }) as unknown as OppRow[];
    }, []),

    // 1b. Recently closed opportunities (Won/Lost, last 12 months) — feeds the kanban's Won/Lost columns.
    q<OppRow[]>(async () => {
      const { rows } = await risansiPool.query(`
        SELECT o.*,
               c.legal_name AS client_name, c.code AS client_code, c.industry,
               COALESCE(r.name, '—') AS rep_name
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN reps r ON r.id = o.rep_id
        ${closedWhere}
        ORDER BY o.updated_at DESC NULLS LAST
        LIMIT 200
      `, vals as (string | number)[]
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, value_cr: Number(row.value_cr ?? 0) };
      }) as unknown as OppRow[];
    }, []),

    // 2. Booked YTD — from client_revenue_monthly (FY 25-26), returned in Cr
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ booked_inr: string }>(
        `SELECT COALESCE(SUM(total_value), 0)::text AS booked_inr
         FROM client_revenue_monthly
         WHERE month >= '2025-04-01' AND month < '2026-04-01'`,
      );
      return Number(rows[0]?.booked_inr ?? 0) / 10_000_000;
    }, 0),

    // 3. Annual target — sum of rep targets (Cr), fallback 32 Cr
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ total_target_cr: string }>(
        `SELECT COALESCE(SUM(target_cr), 32)::text AS total_target_cr
         FROM reps WHERE is_active = TRUE`,
      );
      return Number(rows[0]?.total_target_cr ?? 32);
    }, 32),

    // 4. Win / loss by industry
    q<WinRateRow[]>(async () => {
      const { rows } = await risansiPool.query<WinRateRow>(`
        SELECT c.industry,
               COUNT(*) FILTER (WHERE po.stage = 'Won')::text  AS won,
               COUNT(*) FILTER (WHERE po.stage = 'Lost')::text AS lost
        FROM opportunities po
        JOIN clients c ON c.id = po.client_id
        WHERE po.stage IN ('Won', 'Lost')
          AND po.updated_at >= NOW() - INTERVAL '12 months'
        GROUP BY c.industry
        ORDER BY (COUNT(*) FILTER (WHERE po.stage = 'Won') +
                  COUNT(*) FILTER (WHERE po.stage = 'Lost')) DESC
        LIMIT 6
      `);
      return rows;
    }, []),

    // 5. Lost-to competitors
    q<LostToRow[]>(async () => {
      const { rows } = await risansiPool.query<{ competitor: string; opp_count: string; value: string }>(`
        SELECT COALESCE(lost_to_competitor, 'Others') AS competitor,
               COUNT(*)::text AS opp_count,
               COALESCE(SUM(value_cr), 0)::text AS value
        FROM opportunities
        WHERE stage = 'Lost'
          AND updated_at >= NOW() - INTERVAL '12 months'
        GROUP BY COALESCE(lost_to_competitor, 'Others')
        ORDER BY SUM(value_cr) DESC NULLS LAST
        LIMIT 5
      `);
      return rows.map(r => ({ ...r, value: Number(r.value) }));
    }, []),

    // 6. Filter options
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ stage: string }>(
        `SELECT DISTINCT stage FROM opportunities WHERE stage NOT IN ('Won','Lost') ORDER BY stage`,
      );
      return rows.map(r => r.stage);
    }, ['Suspect', 'Prospect', 'Quoted', 'Negotiating']),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ product_type: string }>(
        `SELECT DISTINCT product_type FROM opportunities WHERE product_type IS NOT NULL ORDER BY product_type`,
      );
      return rows.map(r => r.product_type);
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ name: string }>(
        `SELECT DISTINCT r.name FROM reps r WHERE r.deleted_at IS NULL ORDER BY r.name`,
      );
      return rows.map(r => r.name);
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string }>(
        `SELECT DISTINCT c.industry FROM clients c WHERE c.industry IS NOT NULL ORDER BY c.industry`,
      );
      return rows.map(r => r.industry);
    }, []),
  ]);

  // ── Derived values ─────────────────────────────────────────

  const openTotal    = openOpps.reduce((s, o) => s + o.value_cr, 0);
  const weightedOpen = openOpps.reduce((s, o) => s + o.value_cr * ((o.probability ?? 50) / 100), 0);
  const bestCase     = bookedYTD + openTotal;
  const probabilityWeighted = bookedYTD + weightedOpen;
  const target       = annualTarget > 0 ? annualTarget : 32;
  const toGo         = Math.max(0, target - bookedYTD);

  const totalWon   = winLossRows.reduce((s, r) => s + Number(r.won), 0);
  const totalLost  = winLossRows.reduce((s, r) => s + Number(r.lost), 0);
  const winRatePct = totalWon + totalLost > 0
    ? Math.round((totalWon / (totalWon + totalLost)) * 100)
    : 0;

  const anyFilter = stageFilts.length > 0 || prodTypeFilts.length > 0 || repFilts.length > 0 || indFilts.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Opportunities']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page head */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Opportunities
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {openOpps.length} open opportunit{openOpps.length !== 1 ? 'ies' : ''}
              {' · '}{fmtCr(openTotal)} open value
              {' · '}weighted forecast {fmtCr(probabilityWeighted)}
              {winRatePct > 0 && ` · win rate FY ${winRatePct}%`}
            </div>
          </div>
          <NewOpportunityButton
            currentUserName={session?.user?.name ?? ''}
            currentUserRepId={currentRepId}
            currentUserRole={role}
          />
        </div>

        {/* Rep scope toggle (rep role only) */}
        {role === 'rep' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <a href="/risansi/pipeline" style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: !showAll ? '#0A3D8F' : 'var(--bg-elev)',
              color: !showAll ? 'white' : 'var(--fg-3)',
              textDecoration: 'none', border: '1px solid var(--line)',
            }}>
              My Opportunities
            </a>
            <a href="/risansi/pipeline?rep=all" style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: showAll ? '#0A3D8F' : 'var(--bg-elev)',
              color: showAll ? 'white' : 'var(--fg-3)',
              textDecoration: 'none', border: '1px solid var(--line)',
            }}>
              All Opportunities
            </a>
          </div>
        )}

        {/* Forecast strip */}
        <div style={{ ...PANEL, marginBottom: 14 }}>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 2fr', gap: 24, alignItems: 'center' }}>
              <ForecastBlock label="Booked (Won YTD)" value={bookedYTD} sub={fy.label} color="var(--pos)" />
              <ForecastBlock label="Best-case (100% pipe)" value={bestCase}
                sub={`${fmtCr(bookedYTD)} + ${fmtCr(openTotal)} open`} color="var(--fg)" />
              <ForecastBlock label="Probability-weighted" value={probabilityWeighted}
                sub={`${fmtCr(weightedOpen)} weighted pipe + booked`} color="var(--accent)" highlight />
              <ForecastBlock label="Annual Target" value={target}
                sub={`${fmtCr(toGo)} to go`} color="var(--fg-2)" />
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
                  <span>Target {fmtCr(target)}</span>
                  {target > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                      Weighted {Math.round((probabilityWeighted / target) * 100)}%
                    </span>
                  )}
                </div>
                <ForecastBar booked={bookedYTD} weightedOpen={weightedOpen} target={target} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                  <span>● booked</span>
                  <span style={{ color: 'var(--accent)' }}>● weighted pipe</span>
                  <span>target line</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Kanban — open + recently-closed opps. Drag to change stage, or click to edit. */}
        <div style={{ marginBottom: 14 }}>
          <OpportunityKanban initialOpps={[...openOpps, ...closedOpps]} />
        </div>

        {/* Bottom: opps table + win/loss panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>

          {/* Active opportunities table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Active Opportunities</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>
                {Math.min(openOpps.length, 50)} of {openOpps.length}
              </span>
            </div>

            {/* Filter row */}
            <div style={{ padding: '10px 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <MultiSelectFilter param="stage"        label="Stage"        options={stageOptions}       selected={stageFilts}    />
              <MultiSelectFilter param="product_type" label="Product Type" options={productTypeOptions}  selected={prodTypeFilts} />
              <MultiSelectFilter param="rep"          label="Rep"          options={repOptions}          selected={repFilts}      />
              <MultiSelectFilter param="industry"     label="Industry"     options={industryOptions}     selected={indFilts}      />
            </div>

            {/* Active filter pills */}
            {anyFilter && (
              <div style={{ padding: '4px 14px 0' }}>
                <ActiveFilterBar filters={[
                  { param: 'stage',        label: 'Stage',    values: stageFilts    },
                  { param: 'product_type', label: 'Type',     values: prodTypeFilts },
                  { param: 'rep',          label: 'Rep',      values: repFilts      },
                  { param: 'industry',     label: 'Industry', values: indFilts      },
                ]} />
              </div>
            )}

            <ActiveOppsTable opps={openOpps} />
          </div>

          {/* Win Rate + Lost To */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Win Rate · last 12 months</span>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32 }}>
                    {winRatePct > 0 ? `${winRatePct}%` : '—'}
                  </div>
                  {totalWon + totalLost > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                      {totalWon}W · {totalLost}L
                    </div>
                  )}
                </div>
                {winLossRows.length > 0 ? (
                  <div>
                    {winLossRows.map(row => {
                      const won   = Number(row.won);
                      const lost  = Number(row.lost);
                      const total = won + lost;
                      const rate  = total > 0 ? Math.round((won / total) * 100) : 0;
                      return (
                        <div key={row.industry} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                            <span>{row.industry}</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{rate}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--bg-sunk)', borderRadius: 2 }}>
                            <div style={{ height: '100%', width: `${rate}%`, background: 'var(--accent)', borderRadius: 2 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No win/loss data in last 12 months</div>
                )}
              </div>
            </div>

            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Lost To · top competitors</span>
              </div>
              {lostToRows.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No lost data in last 12 months
                </div>
              ) : (
                <div>
                  {lostToRows.map((row, i) => (
                    <div key={row.competitor} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px',
                      borderBottom: i < lostToRows.length - 1 ? '1px solid var(--line)' : 'none',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{row.competitor}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', textAlign: 'right' }}>
                        {row.opp_count} opp{Number(row.opp_count) !== 1 ? 's' : ''} · {fmtCr(row.value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function ForecastBlock({
  label, value, sub, color, highlight = false,
}: {
  label: string; value: number; sub: string; color: string; highlight?: boolean;
}) {
  return (
    <div style={highlight ? {
      padding: 12, background: 'var(--accent-soft)', borderRadius: 6,
      border: '1px solid var(--accent-line)',
    } : {}}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, marginTop: 2, color, lineHeight: 1.1 }}>
        ₹{value.toFixed(1)}<span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: 4 }}>Cr</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function ForecastBar({ booked, weightedOpen, target }: {
  booked: number; weightedOpen: number; target: number;
}) {
  const tot = Math.max(target, booked + weightedOpen) * 1.05 || 1;
  const bookedPct = Math.min((booked / tot) * 100, 100);
  const pipePct   = Math.min((weightedOpen / tot) * 100, Math.max(0, 100 - bookedPct));
  const targetPct = Math.min((target / tot) * 100, 99);
  return (
    <div style={{ height: 22, background: 'var(--bg-sunk)', borderRadius: 3, position: 'relative', overflow: 'visible' }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 3 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bookedPct}%`, background: 'var(--pos)' }} />
        <div style={{ position: 'absolute', left: `${bookedPct}%`, top: 0, bottom: 0, width: `${pipePct}%`, background: 'var(--accent)', opacity: 0.85 }} />
      </div>
      <div style={{ position: 'absolute', left: `${targetPct}%`, top: -3, bottom: -3, width: 2, background: 'var(--bg-ink)', zIndex: 1 }} />
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};

const PANEL_H: CSSProperties = {
  padding: '12px 14px', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', gap: 8,
};

const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };

