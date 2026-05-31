import type { CSSProperties } from 'react';
import { Topbar, Tag } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentFY, fmtCr, initials } from '@/lib/risansi-utils';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Data shapes ────────────────────────────────────────────────

interface OppRow {
  id: string;
  product: string;
  stage: string;
  value_cr: number;
  probability: number | null;
  expected_close_date: string | null;
  client_name: string;
  client_code: string;
  industry: string;
  rep_name: string | null;
}

interface WinRateRow {
  industry: string;
  won: string;
  lost: string;
}

interface LostToRow {
  competitor: string;
  opp_count: string;
  value: number;
}

// ── Constants ──────────────────────────────────────────────────

const STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'] as const;

const STAGE_COLOR: Record<string, string> = {
  Suspect:     'var(--info)',
  Prospect:    '#5a86c2',
  Quoted:      '#c69347',
  Negotiating: 'var(--accent)',
  Won:         'var(--pos)',
  Lost:        'var(--neg)',
};

// ── Page ───────────────────────────────────────────────────────

export default async function PipelinePage() {
  const fy = getCurrentFY();

  const [openOpps, bookedYTD, annualTarget, winLossRows, lostToRows] = await Promise.all([

    // 1. Open opportunities + client/rep info
    q<OppRow[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; product: string; stage: string;
        value_cr: string; probability: number | null;
        expected_close_date: string | null;
        client_name: string; client_code: string; industry: string;
        rep_name: string | null;
      }>(`
        SELECT po.id, po.product, po.stage,
               po.value_cr::text AS value_cr,
               po.probability,
               po.expected_close_date::text AS expected_close_date,
               c.legal_name AS client_name, c.code AS client_code, c.industry,
               r.name AS rep_name
        FROM opportunities po
        JOIN clients c ON c.id = po.client_id
        LEFT JOIN reps r ON r.id = c.primary_rep_id
        WHERE po.stage NOT IN ('Won', 'Lost')
        ORDER BY po.value_cr DESC NULLS LAST
        LIMIT 200
      `);
      return rows.map(r => ({ ...r, value_cr: Number(r.value_cr) }));
    }, []),

    // 2. Booked YTD — actual orders in current FY
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ booked: string }>(
        `SELECT COALESCE(SUM(order_value_cr), 0)::text AS booked
         FROM orders WHERE financial_year = $1`,
        [fy.code],
      );
      return Number(rows[0]?.booked ?? 0);
    }, 0),

    // 3. Annual target (safe: table may not exist)
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ target: string }>(
        `SELECT COALESCE(target_amount, 0)::text AS target
         FROM annual_targets WHERE financial_year = $1 LIMIT 1`,
        [fy.code],
      );
      return Number(rows[0]?.target ?? 0);
    }, 0),

    // 4. Win / loss by industry — last 12 months
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

    // 5. Lost-to competitors — last 12 months (safe: lost_to column may not exist)
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
  ]);

  // ── Derived values ─────────────────────────────────────────

  const openTotal    = openOpps.reduce((s, o) => s + o.value_cr, 0);
  const weightedOpen = openOpps.reduce((s, o) => s + o.value_cr * ((o.probability ?? 50) / 100), 0);
  const bestCase     = bookedYTD + openTotal;
  const probabilityWeighted = bookedYTD + weightedOpen;
  const target       = annualTarget > 0 ? annualTarget : 320;
  const toGo         = Math.max(0, target - bookedYTD);

  const totalWon   = winLossRows.reduce((s, r) => s + Number(r.won), 0);
  const totalLost  = winLossRows.reduce((s, r) => s + Number(r.lost), 0);
  const winRatePct = totalWon + totalLost > 0
    ? Math.round((totalWon / (totalWon + totalLost)) * 100)
    : 0;

  // Kanban columns — only active stages show open opps
  const byStage: Record<string, OppRow[]> = {};
  for (const s of STAGES) byStage[s] = openOpps.filter(o => o.stage === s);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Pipeline & Revenue']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page head */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Pipeline & Revenue
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            {openOpps.length} open opportunit{openOpps.length !== 1 ? 'ies' : 'y'}
            {' · '}{fmtCr(openTotal)} open value
            {' · '}weighted forecast {fmtCr(probabilityWeighted)}
            {winRatePct > 0 && ` · win rate FY ${winRatePct}%`}
          </div>
        </div>

        {/* Forecast strip */}
        <div style={{ ...PANEL, marginBottom: 14 }}>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 2fr', gap: 24, alignItems: 'center' }}>
              <ForecastBlock
                label="Booked (Won YTD)"
                value={bookedYTD}
                sub={fy.label}
                color="var(--pos)"
              />
              <ForecastBlock
                label="Best-case (100% pipe)"
                value={bestCase}
                sub={`${fmtCr(bookedYTD)} + ${fmtCr(openTotal)} open`}
                color="var(--fg)"
              />
              <ForecastBlock
                label="Probability-weighted"
                value={probabilityWeighted}
                sub={`${fmtCr(weightedOpen)} weighted pipe + booked`}
                color="var(--accent)"
                highlight
              />
              <ForecastBlock
                label="Annual Target"
                value={target}
                sub={annualTarget > 0 ? `${fmtCr(toGo)} to go` : 'Target not configured'}
                color="var(--fg-2)"
              />
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

        {/* Kanban */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
          {STAGES.map(stage => {
            const items = byStage[stage] ?? [];
            const stageTotal = items.reduce((s, o) => s + o.value_cr, 0);
            const color = STAGE_COLOR[stage];
            return (
              <div key={stage} style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 6, display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {stage}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                      {items.length}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg)', marginTop: 4 }}>
                    {stageTotal > 0 ? fmtCr(stageTotal) : '—'}
                  </div>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {items.map(opp => <OppCard key={opp.id} opp={opp} />)}
                  {items.length === 0 && (
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', textAlign: 'center', padding: 20 }}>
                      No opps
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom: opps table + win/loss panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>

          {/* Active opportunities table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Active Opportunities</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>sorted by value</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {Math.min(openOpps.length, 50)} of {openOpps.length}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Client', 'Product', 'Stage', 'Value', 'Prob', 'ETA', 'Rep'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openOpps.slice(0, 50).map((o, i) => (
                    <tr key={o.id} style={{ borderBottom: i < Math.min(openOpps.length, 50) - 1 ? '1px solid var(--line)' : 'none' }}>
                      <td style={TD}>
                        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3 }}>{o.client_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{o.client_code}</div>
                      </td>
                      <td style={{ ...TD, fontSize: 11 }}>{o.product}</td>
                      <td style={TD}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: STAGE_COLOR[o.stage] ?? 'var(--fg)' }}>
                          {o.stage}
                        </span>
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {fmtCr(o.value_cr)}
                      </td>
                      <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {o.probability != null ? `${o.probability}%` : '—'}
                      </td>
                      <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                        {o.expected_close_date ?? '—'}
                      </td>
                      <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>
                        {o.rep_name ? initials(o.rep_name) : '—'}
                      </td>
                    </tr>
                  ))}
                  {openOpps.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: '24px', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                        No open opportunities
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Win Rate + Lost To */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Win Rate */}
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

            {/* Lost To */}
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
  const bookedPct   = Math.min((booked / tot) * 100, 100);
  const pipePct     = Math.min((weightedOpen / tot) * 100, Math.max(0, 100 - bookedPct));
  const targetPct   = Math.min((target / tot) * 100, 99);
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

function OppCard({ opp }: { opp: OppRow }) {
  const borderColor = STAGE_COLOR[opp.stage] ?? 'var(--line)';
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
      borderLeft: `2px solid ${borderColor}`, borderRadius: 4, padding: 10,
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span>{opp.client_code}</span>
        <span>{opp.rep_name ? initials(opp.rep_name) : '—'}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3, marginBottom: 4 }}>{opp.client_name}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 6 }}>{opp.product}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>
          {fmtCr(opp.value_cr)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
          {opp.probability != null ? `${opp.probability}%` : ''}
          {opp.expected_close_date ? ` · ${opp.expected_close_date}` : ''}
        </span>
      </div>
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

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
  color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
