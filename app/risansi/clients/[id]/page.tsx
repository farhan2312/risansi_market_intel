import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { Topbar, Tag, StatusDot } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { fyShortLabel, fmtCr, fmtL } from '@/lib/risansi-utils';
import { addContact, planVisit, createOpportunity } from '@/app/actions/risansi';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Data shapes ────────────────────────────────────────────────

interface Client {
  id: string; code: string; legal_name: string; trade_name: string | null;
  industry: string; zone: string; tour_name: string | null; status: string; tier: string | null;
  market_type: string | null; client_type: string | null;
  since_year: number | null; address: string | null; city: string | null;
  state: string | null; lat: string | null; lng: string | null;
  tcd: number | null; klpd: number | null;
  primary_rep_id: string | null; primary_rep_name: string | null; rep_name: string | null;
  // Revenue columns (INR — divide by 1L for Lakhs)
  rev_2122_pump: number | null; rev_2122_spare: number | null;
  rev_2223_pump: number | null; rev_2223_spare: number | null;
  rev_2324_pump: number | null; rev_2324_spare: number | null;
  rev_2425_pump: number | null; rev_2425_spare: number | null;
  rev_2526_pump: number | null; rev_2526_spare: number | null;
  rev_2627_pump: number | null; rev_2627_spare: number | null;
  // Plan of Action
  action_points:      string | null;
  pcp_competitor:     string | null;
  mgmt_intervention:  boolean | string | null;
  constraints_notes:  string | null;
  expected_to_pump:   number | null;
  expected_to_spare:  number | null;
  // Field intelligence
  performance_feedback: string | null;
  last_visit_summary:   string | null;
  open_remarks:         string | null;
  complaint_notes:      string | null;
  last_visit_fy:        string | null;
  ril_pcp_count:        number | null;
  total_others_pcp:     number | null;
}

interface Contact {
  id: string; name: string; designation: string | null;
  phone: string | null; email: string | null; is_primary: boolean;
}

interface RevRow {
  financial_year: string; product_category: string; total: string; order_count: string;
}

interface Equipment {
  id: string; station: string | null; equipment_type: string;
  supplier: string; model: string | null; quantity: number;
  condition: string; opportunity: boolean;
}

interface Visit {
  id: string; rep_name: string; visit_date: Date;
  purpose: string | null; outcome: string | null;
  summary: string | null; status: string; synced: boolean;
}

interface Opportunity {
  id: string; product: string; stage: string;
  value_cr: string; probability: number | null;
  expected_close_date: string | null;
}

interface ActivityEntry {
  id: string; email: string | null; action: string; created_at: Date;
}

// ── Page ───────────────────────────────────────────────────────

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params;

  // ── Dual-key client fetch (numeric id OR code string) ─────
  const isNumeric = /^\d+$/.test(id);
  const whereClause = isNumeric ? 'c.id = $1::bigint' : 'c.code = $1';

  const client = await q<Client | null>(async () => {
    const { rows } = await risansiPool.query<Client>(
      `SELECT c.*, COALESCE(r.name, c.primary_rep_name, '—') AS rep_name
       FROM clients c
       LEFT JOIN reps r ON c.primary_rep_id = r.id
       WHERE ${whereClause} AND c.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }, null);

  if (!client) notFound();

  // ── Fetch supporting data in parallel ─────────────────────

  const [contacts, revRows, equipment, visits, openOpps, activityLog] = await Promise.all([

    // 2. Contacts — try contacts_raw first (Excel-imported), fall back to contacts
    (async (): Promise<Contact[]> => {
      try {
        const { rows } = await risansiPool.query<Contact>(
          `SELECT id, name, designation, phone, email, is_primary
           FROM contacts_raw WHERE client_code = $1
           ORDER BY is_primary DESC, name`,
          [client.code],
        );
        if (rows.length > 0) return rows;
      } catch { /* table may not exist yet */ }
      return q<Contact[]>(async () => {
        const { rows } = await risansiPool.query<Contact>(
          `SELECT id, name, designation, phone, email, is_primary
           FROM contacts WHERE client_code = $1
           ORDER BY is_primary DESC, name`,
          [client.code],
        );
        return rows;
      }, []);
    })(),

    // 3. Revenue by FY / category (order_value_cr is already in Crores)
    q<RevRow[]>(async () => {
      const { rows } = await risansiPool.query<RevRow>(
        `SELECT financial_year, product_category,
                COALESCE(SUM(order_value_cr),0)::text AS total,
                COUNT(*)::text AS order_count
         FROM orders WHERE client_id = $1
         GROUP BY financial_year, product_category
         ORDER BY financial_year`,
        [client.id],
      );
      return rows;
    }, []),

    // 4. Competitor installed base
    q<Equipment[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; station: string | null; equipment_type: string;
        supplier: string; model: string | null; quantity: string;
        condition: string; opportunity: boolean;
      }>(
        `SELECT id, station, equipment_type, supplier, model,
                COALESCE(quantity, 1)::int AS quantity,
                COALESCE(condition, 'Unknown') AS condition,
                COALESCE(opportunity, false) AS opportunity
         FROM competitor_installed_base
         WHERE client_code = $1`,
        [client.code],
      );
      return rows.map(r => ({ ...r, quantity: Number(r.quantity) }));
    }, []),

    // 5. Visit timeline (last 20)
    q<Visit[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; rep_name: string; visit_date: Date;
        purpose: string | null; outcome: string | null;
        summary: string | null; status: string;
      }>(
        `SELECT v.id, COALESCE(r.name, '—') AS rep_name, v.visit_date,
                v.purpose, v.outcome, v.summary, v.status
         FROM visits v
         LEFT JOIN reps r ON r.id = v.rep_id
         WHERE v.client_id = $1
         ORDER BY v.visit_date DESC
         LIMIT 20`,
        [client.id],
      );
      return rows.map(r => ({ ...r, synced: false }));
    }, []),

    // 6. Open pipeline opportunities
    q<Opportunity[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; product: string; stage: string;
        value_cr: string; probability: number | null;
        expected_close_date: string | null;
      }>(
        `SELECT id, product, stage, value_cr::text, probability, expected_close_date
         FROM opportunities
         WHERE client_id = $1 AND stage NOT IN ('Won','Lost')
         ORDER BY value_cr DESC`,
        [client.id],
      );
      return rows;
    }, []),

    // 7. Activity log (last 20)
    q<ActivityEntry[]>(async () => {
      const { rows } = await risansiPool.query<ActivityEntry>(
        `SELECT id, email, action, created_at
         FROM risansi_activity_log
         WHERE entity_type = 'client' AND entity_id::text = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [String(client.id)],
      );
      return rows;
    }, []),
  ]);

  // ── Derived values ────────────────────────────────────────

  // Revenue chart data — from rev_* columns on clients (INR ÷ 1L = Lakhs)
  const INR_TO_L = 100_000;

  const REV_COLS: [string, keyof typeof client, keyof typeof client][] = [
    ['21-22', 'rev_2122_pump', 'rev_2122_spare'],
    ['22-23', 'rev_2223_pump', 'rev_2223_spare'],
    ['23-24', 'rev_2324_pump', 'rev_2324_spare'],
    ['24-25', 'rev_2425_pump', 'rev_2425_spare'],
    ['25-26', 'rev_2526_pump', 'rev_2526_spare'],
    ['26-27', 'rev_2627_pump', 'rev_2627_spare'],
  ];

  const revByFY: Record<string, { pump: number; spare: number; orders: number }> = {};
  // Initialise from client rev_ columns
  for (const [fyCode, pumpCol, spareCol] of REV_COLS) {
    const pumpInr  = Number((client[pumpCol as keyof typeof client])  ?? 0);
    const spareInr = Number((client[spareCol as keyof typeof client]) ?? 0);
    revByFY[fyCode] = {
      pump:   pumpInr  / INR_TO_L,
      spare:  spareInr / INR_TO_L,
      orders: 0,
    };
  }

  // Merge orders table rows (already in Crores — no conversion needed)
  for (const r of revRows) {
    const total = Number(r.total);
    if (!revByFY[r.financial_year]) {
      revByFY[r.financial_year] = { pump: 0, spare: 0, orders: 0 };
    }
    if (r.product_category === 'Pump') {
      if (revByFY[r.financial_year].pump === 0) revByFY[r.financial_year].pump = total;
    } else {
      if (revByFY[r.financial_year].spare === 0) revByFY[r.financial_year].spare = total;
    }
    revByFY[r.financial_year].orders += Number(r.order_count);
  }

  // Chart FYs: all 6 from the master data columns
  const chartFYs = REV_COLS.map(([code]) => code);

  let lifetimePump = 0, lifetimeSpare = 0, lifetimeOrders = 0;
  for (const { pump, spare, orders } of Object.values(revByFY)) {
    lifetimePump   += pump;
    lifetimeSpare  += spare;
    lifetimeOrders += orders;
  }
  const lifetimeTotal = lifetimePump + lifetimeSpare;

  // PCP summary from client master columns
  const rilPcp   = Number(client.ril_pcp_count    ?? 0);
  const compPcp  = Number(client.total_others_pcp ?? 0);
  const totalPcp = rilPcp + compPcp;

  // 5yr CAGR (from master data columns)
  const chartTotals = chartFYs.map(f => (revByFY[f]?.pump ?? 0) + (revByFY[f]?.spare ?? 0));
  const cagr5yr = (() => {
    const nonZero = chartTotals.filter(v => v > 0);
    if (nonZero.length < 2) return null;
    const first = nonZero[0], last = nonZero[nonZero.length - 1];
    const years = nonZero.length - 1;
    return ((last / first) ** (1 / years) - 1) * 100;
  })();

  // Equipment KPIs — prefer master data columns; fall back to field assessments
  const rilUnits   = rilPcp   > 0 ? rilPcp   : equipment.filter(e => e.supplier === 'RIL').reduce((s, e) => s + e.quantity, 0);
  const totalUnits = totalPcp > 0 ? totalPcp : equipment.reduce((s, e) => s + e.quantity, 0);

  // Last visit
  const lastVisit = visits[0] ?? null;
  const daysAgo   = lastVisit
    ? Math.floor((Date.now() - new Date(lastVisit.visit_date).getTime()) / 86_400_000)
    : null;

  // Pipeline total (value_cr already in Crores)
  const pipelineTotal = openOpps.reduce((s, o) => s + Number(o.value_cr), 0);

  // ── Outcome color ─────────────────────────────────────────

  function outcomeKind(outcome: string | null): 'pos' | 'warn' | 'neg' | undefined {
    if (!outcome) return undefined;
    const l = outcome.toLowerCase();
    if (l.includes('very positive') || l.includes('positive')) return 'pos';
    if (l.includes('needs attention') || l.includes('neutral')) return 'warn';
    if (l.includes('escalation'))  return 'neg';
    return undefined;
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Clients', client.zone ?? '', client.trade_name ?? client.legal_name]} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ─────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                {client.legal_name}
              </span>
              <StatusDot s={client.status === 'ACTIVE' ? 'active' : client.status === 'INACTIVE' ? 'inactive' : 'prospect'} />
              <span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: -4 }}>{client.status}</span>
              {client.tier === 'Key' && <Tag kind="accent">Key Account</Tag>}
              {client.tier && client.tier !== 'Key' && <Tag>{client.tier}</Tag>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{client.code}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              {client.industry}
              {client.tcd ? ` · ${client.tcd} TCD` : ''}
              {client.klpd ? ` · ${client.klpd} KLPD` : ''}
              {client.address && <><span style={{ margin: '0 8px' }}>·</span>{client.address}</>}
              {client.since_year && <><span style={{ margin: '0 8px' }}>·</span>Customer since {client.since_year}</>}
              {client.rep_name && <><span style={{ margin: '0 8px' }}>·</span>{client.rep_name}{client.tour_name ? ` on ${client.tour_name}` : ''}</>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <form action={planVisit.bind(null, client.id)}>
              <button type="submit" style={BTN}>Plan Visit</button>
            </form>
            <form action={createOpportunity.bind(null, client.id)}>
              <button type="submit" style={BTN}>New Opportunity</button>
            </form>
          </div>
        </div>

        {/* ── KPI cards ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <MiniKpi label="Lifetime Revenue"
            value={fmtL(lifetimeTotal)}
            sub={`${client.since_year ?? '—'} – present · ${lifetimeOrders} orders`} />
          <MiniKpi label="Last Visit"
            value={daysAgo == null ? 'Never' : daysAgo === 0 ? 'Today' : `${daysAgo} days`}
            sub={daysAgo != null && daysAgo > 90 ? `overdue · ${lastVisit?.rep_name ?? ''}` : lastVisit?.rep_name ?? 'No visits logged'}
            neg={daysAgo != null && daysAgo > 90} />
          <MiniKpi label="Installed Base · PCP"
            value={totalUnits > 0 ? `${rilUnits} / ${totalUnits}` : '—'}
            sub={totalUnits > 0 ? `${Math.round((rilUnits / totalUnits) * 100)}% RIL share` : 'No PCP data'} />
          <MiniKpi label="Open Pipeline"
            value={fmtCr(pipelineTotal)}
            sub={openOpps.length > 0 ? `${openOpps.length} opportunit${openOpps.length === 1 ? 'y' : 'ies'}` : 'No open opportunities'} />
        </div>

        {/* ── Main 2-col layout ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 14 }}>

          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Revenue YoY chart */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Year-on-Year Revenue · Pump vs Spare</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {cagr5yr != null && (
                    <Tag>{cagr5yr >= 0 ? '+' : ''}{cagr5yr.toFixed(0)}% 5-yr CAGR</Tag>
                  )}
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <RevenueChart fyKeys={chartFYs} revByFY={revByFY} />
                {/* Data table */}
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)' }}>
                        <th style={{ ...REV_TH, textAlign: 'left' }}></th>
                        {chartFYs.map(f => (
                          <th key={f} style={REV_TH}>FY {f}</th>
                        ))}
                        <th style={REV_TH}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px dashed var(--line)' }}>
                        <td style={{ padding: '6px 8px', fontSize: 11 }}>Pump (₹ L)</td>
                        {chartFYs.map(f => (
                          <td key={f} style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {revByFY[f].pump > 0 ? revByFY[f].pump.toFixed(1) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                          </td>
                        ))}
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 11 }}>
                          {lifetimePump.toFixed(1)}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px dashed var(--line)' }}>
                        <td style={{ padding: '6px 8px', fontSize: 11 }}>Spare (₹ L)</td>
                        {chartFYs.map(f => (
                          <td key={f} style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {revByFY[f].spare > 0 ? revByFY[f].spare.toFixed(1) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                          </td>
                        ))}
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 11 }}>
                          {lifetimeSpare.toFixed(1)}
                        </td>
                      </tr>
                      <tr style={{ background: 'var(--bg-elev)' }}>
                        <td style={{ padding: '6px 8px', fontSize: 11, fontWeight: 500 }}>Total</td>
                        {chartFYs.map(f => {
                          const t = (revByFY[f].pump + revByFY[f].spare);
                          return (
                            <td key={f} style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 11 }}>
                              {t > 0 ? t.toFixed(1) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                            </td>
                          );
                        })}
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11 }}>
                          {lifetimeTotal.toFixed(1)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Installed Base · PCP Summary */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>PCP Installed Base · {totalUnits} pump{totalUnits !== 1 ? 's' : ''}</span>
                {compPcp > 0 && (
                  <div style={{ marginLeft: 'auto' }}>
                    <Tag kind="warn">{compPcp} competitor unit{compPcp !== 1 ? 's' : ''}</Tag>
                  </div>
                )}
              </div>
              {totalPcp > 0 ? (
                <div style={{ padding: '12px 14px' }}>
                  {/* RIL vs competitor bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ flex: 1, height: 10, background: 'var(--bg-sunk)', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${(rilPcp / totalPcp) * 100}%`, background: 'var(--accent)', height: '100%', borderRadius: '5px 0 0 5px', transition: 'width 0.3s' }} />
                      <div style={{ flex: 1, background: 'var(--neg)', height: '100%', opacity: 0.35 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', minWidth: 40, textAlign: 'right' }}>
                      {((rilPcp / totalPcp) * 100).toFixed(0)}% RIL
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>RIL</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--accent)', fontWeight: 500 }}>{rilPcp}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Competitors</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--neg)', fontWeight: 500 }}>{compPcp}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Total</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500 }}>{totalPcp}</div>
                    </div>
                    {client.pcp_competitor && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Main Competitor</div>
                        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, color: 'var(--neg)' }}>{client.pcp_competitor}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : equipment.length > 0 ? (
                // Fall back to field assessment detail table
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elev)' }}>
                        {['Station', 'Type', 'Supplier', 'Model', 'Qty', 'Condition', ''].map(h => (
                          <th key={h} style={TH}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map((e, i) => (
                        <tr key={e.id} style={{ borderBottom: i < equipment.length - 1 ? '1px solid var(--line)' : 'none', background: e.opportunity ? 'rgba(26,92,184,0.05)' : 'transparent' }}>
                          <td style={{ ...TD, fontSize: 11, color: 'var(--fg-2)' }}>{e.station ?? '—'}</td>
                          <td style={TD}><Tag>{e.equipment_type}</Tag></td>
                          <td style={{ ...TD, fontWeight: e.supplier === 'RIL' ? 500 : 400, color: e.supplier === 'RIL' ? 'var(--accent)' : 'inherit' }}>{e.supplier}</td>
                          <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{e.model ?? '—'}</td>
                          <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.quantity}</td>
                          <td style={TD}><Tag kind={e.condition === 'Good' ? 'pos' : e.condition === 'End of Life' ? 'neg' : 'warn'} dot>{e.condition}</Tag></td>
                          <td style={TD}>{e.opportunity && <Tag kind="accent">REPLACE</Tag>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No PCP data recorded
                </div>
              )}
            </div>

            {/* Plan of Action */}
            {(client.action_points || client.expected_to_pump || client.expected_to_spare || client.mgmt_intervention) && (
              <div style={PANEL}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>Plan of Action</span>
                  {client.mgmt_intervention && (
                    <div style={{ marginLeft: 'auto' }}>
                      <Tag kind="warn">Mgmt Intervention</Tag>
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px' }}>
                  {client.action_points && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Action Points</div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.6 }}>{client.action_points}</div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {client.expected_to_pump != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Expected Pump</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--pos)' }}>
                          ₹{(client.expected_to_pump / 100_000).toFixed(1)} L
                        </div>
                      </div>
                    )}
                    {client.expected_to_spare != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Expected Spare</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--pos)' }}>
                          ₹{(client.expected_to_spare / 100_000).toFixed(1)} L
                        </div>
                      </div>
                    )}
                    {client.mgmt_intervention && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Mgmt Intervention</div>
                        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3, color: 'var(--warn)' }}>YES</div>
                      </div>
                    )}
                  </div>
                  {client.constraints_notes && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Constraints</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>{client.constraints_notes}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Field Intelligence */}
            {(client.performance_feedback || client.last_visit_summary || client.open_remarks || client.complaint_notes) && (
              <div style={PANEL}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>Field Intelligence</span>
                  {client.performance_feedback && (
                    <Tag kind={
                      client.performance_feedback.toLowerCase().includes('good') ? 'pos'
                      : client.performance_feedback.toLowerCase().includes('poor') ? 'neg'
                      : 'warn'
                    }>{client.performance_feedback}</Tag>
                  )}
                  {client.last_visit_fy && (
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                      Last: FY {client.last_visit_fy}
                    </span>
                  )}
                </div>
                <div style={{ padding: '14px' }}>
                  {client.last_visit_summary && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Last Visit Summary</div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.6 }}>{client.last_visit_summary}</div>
                    </div>
                  )}
                  {client.open_remarks && (
                    <div style={{ marginBottom: 14, paddingTop: client.last_visit_summary ? 12 : 0, borderTop: client.last_visit_summary ? '1px solid var(--line)' : 'none' }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Open Remarks</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>{client.open_remarks}</div>
                    </div>
                  )}
                  {client.complaint_notes && (
                    <div style={{ paddingTop: (client.last_visit_summary || client.open_remarks) ? 12 : 0, borderTop: (client.last_visit_summary || client.open_remarks) ? '1px solid var(--line)' : 'none' }}>
                      <div style={{ fontSize: 10, color: 'var(--neg)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Open Complaints</div>
                      <div style={{ fontSize: 12, color: 'var(--neg)', lineHeight: 1.6 }}>{client.complaint_notes}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Visit Timeline */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Visit Timeline · {visits.length > 0 ? `${visits.length} visits` : 'No visits'}</span>
              </div>
              {visits.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No visit history
                </div>
              ) : (
                <div>
                  {visits.map((v, i) => {
                    const d = new Date(v.visit_date);
                    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                    return (
                      <div
                        key={v.id}
                        style={{
                          display: 'flex', gap: 14, padding: '14px',
                          borderBottom: i < visits.length - 1 ? '1px solid var(--line)' : 'none',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ width: 110, flexShrink: 0 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>{dateStr}</div>
                          <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
                            {v.rep_name?.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 3)}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: v.summary ? 6 : 0 }}>
                            <span style={{ fontWeight: 500, fontSize: 12 }}>{v.purpose ?? 'Visit'}</span>
                            {v.outcome && <Tag kind={outcomeKind(v.outcome)} dot>{v.outcome}</Tag>}
                            {v.synced && (
                              <span style={{ fontSize: 10, color: 'var(--pos)', fontFamily: 'var(--font-mono)' }}>✓ GPS verified</span>
                            )}
                          </div>
                          {v.summary && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{v.summary}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Contacts */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Contacts</span>
                <div style={{ marginLeft: 'auto' }}>
                  <form action={addContact.bind(null, client.id)}>
                    <button type="submit" style={{ ...BTN, padding: '3px 8px', fontSize: 11 }}>+ Add</button>
                  </form>
                </div>
              </div>
              {contacts.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No contacts on record
                </div>
              ) : (
                <div>
                  {contacts.map((c, i) => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        padding: '10px 14px',
                        borderBottom: i < contacts.length - 1 ? '1px solid var(--line)' : 'none',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 500, fontSize: 12 }}>{c.name}</span>
                          {c.is_primary && <Tag kind="accent">PRIMARY</Tag>}
                        </div>
                        {c.designation && (
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>{c.designation}</div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                          {[c.phone, c.email].filter(Boolean).join('  ·  ')}
                        </div>
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                        {c.phone && (
                          <a href={`tel:${c.phone}`} style={ICON_BTN} title="Call">
                            <PhoneIcon />
                          </a>
                        )}
                        {c.phone && (
                          <a href={`https://wa.me/${c.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" style={ICON_BTN} title="WhatsApp">
                            <WaIcon />
                          </a>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} style={ICON_BTN} title="Email">
                            <MailIcon />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Plant location */}
            {(client.lat && client.lng) ? (
              <div style={PANEL}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>Plant Location</span>
                  <div style={{ marginLeft: 'auto' }}>
                    <a
                      href={`https://maps.google.com/?q=${client.lat},${client.lng}`}
                      target="_blank" rel="noreferrer"
                      style={{ ...BTN, textDecoration: 'none', fontSize: 11, padding: '3px 8px', display: 'inline-flex', alignItems: 'center' }}
                    >
                      Open Maps
                    </a>
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <div style={{ height: 150, background: 'var(--bg-elev)', overflow: 'hidden', position: 'relative' }}>
                    <svg width="100%" height="150" viewBox="0 0 300 150" style={{ position: 'absolute', inset: 0 }}>
                      {[30, 60, 90, 120].map(y => (
                        <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 4" />
                      ))}
                      {[75, 150, 225].map(x => (
                        <line key={x} x1={x} x2={x} y1="0" y2="150" stroke="var(--line)" strokeDasharray="3 4" />
                      ))}
                      <circle cx="150" cy="75" r="28" fill="var(--accent)" opacity="0.12" />
                      <circle cx="150" cy="75" r="14" fill="var(--accent)" opacity="0.25" />
                      <circle cx="150" cy="75" r="5" fill="var(--accent)" />
                    </svg>
                  </div>
                  <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--fg-3)', borderTop: '1px solid var(--line)', fontFamily: 'var(--font-mono)' }}>
                    {client.lat}° N, {client.lng}° E
                    {client.city ? ` · ${client.city}` : ''}
                    {client.state ? `, ${client.state}` : ''}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Open pipeline */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Open Pipeline</span>
                {pipelineTotal > 0 && (
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                    {fmtCr(pipelineTotal)} total
                  </span>
                )}
              </div>
              {openOpps.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No open opportunities
                </div>
              ) : (
                <div>
                  {openOpps.map((o, i) => (
                    <div
                      key={o.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        padding: '10px 14px',
                        borderBottom: i < openOpps.length - 1 ? '1px solid var(--line)' : 'none',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                          {o.id.slice(0, 8).toUpperCase()}
                        </div>
                        <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 4 }}>{o.product}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Tag dot>{o.stage}</Tag>
                          {o.probability != null && (
                            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{o.probability}%</span>
                          )}
                          {o.expected_close_date && (
                            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>· {o.expected_close_date}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, flexShrink: 0, marginLeft: 8 }}>
                        {fmtCr(Number(o.value_cr))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity log */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Activity Log</span>
              </div>
              {activityLog.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No activity logged
                </div>
              ) : (
                <div>
                  {activityLog.map((entry, i) => {
                    const d = new Date(entry.created_at);
                    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const actor = entry.email
                      ? entry.email.split('@')[0].split('.').map((p: string) => p[0]?.toUpperCase()).join('').slice(0, 2)
                      : '—';
                    return (
                      <div
                        key={entry.id}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                          padding: '8px 14px',
                          borderBottom: i < activityLog.length - 1 ? '1px solid var(--line)' : 'none',
                        }}
                      >
                        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', width: 50, flexShrink: 0 }}>
                          {dateStr}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fg-3)', width: 28, flexShrink: 0, fontWeight: 500 }}>
                          {actor}
                        </span>
                        <span style={{ fontSize: 11, flex: 1 }}>{entry.action}</span>
                      </div>
                    );
                  })}
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

function MiniKpi({ label, value, sub, neg = false }: { label: string; value: string; sub?: string; neg?: boolean }) {
  return (
    <div style={PANEL}>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500 }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, marginTop: 4, color: neg ? 'var(--neg)' : 'var(--fg)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: neg ? 'var(--neg)' : 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function RevenueChart({
  fyKeys,
  revByFY,
}: {
  fyKeys: string[];
  revByFY: Record<string, { pump: number; spare: number }>;
}) {
  const height = 140;
  const bw     = 32;
  const gap    = 14;
  const maxVal = Math.max(...fyKeys.map(f => revByFY[f].pump + revByFY[f].spare), 1);
  const totalW = fyKeys.length * (bw + gap) - gap;
  const padL   = 30;

  return (
    <svg width="100%" viewBox={`0 0 ${totalW + padL + 20} ${height + 32}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map(p => {
        const y = height - p * height;
        const label = (maxVal * p).toFixed(1);
        return (
          <g key={p}>
            <line x1={padL} x2={totalW + padL} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {label}
            </text>
          </g>
        );
      })}

      {fyKeys.map((fyKey, i) => {
        const pump  = revByFY[fyKey].pump;
        const spare = revByFY[fyKey].spare;
        const ph    = (pump / maxVal) * height;
        const sh    = (spare / maxVal) * height;
        const x     = padL + i * (bw + gap);
        const total = pump + spare;
        return (
          <g key={fyKey}>
            {sh > 0 && <rect x={x} y={height - ph - sh} width={bw} height={sh} rx={1.5} fill="#00A3C4" />}
            {ph > 0 && <rect x={x} y={height - ph} width={bw} height={ph} rx={1.5} fill="var(--accent)" />}
            {total > 0 && (
              <text x={x + bw / 2} y={height - ph - sh - 4} textAnchor="middle" fontSize="9" fill="var(--fg-2)" fontFamily="var(--font-mono)">
                {total.toFixed(1)}
              </text>
            )}
            <text x={x + bw / 2} y={height + 13} textAnchor="middle" fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {fyShortLabel(fyKey)}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${padL}, ${height + 24})`}>
        <rect width="8" height="8" rx="1" fill="var(--accent)" />
        <text x="12" y="8" fontSize="10" fill="var(--fg-2)" fontFamily="var(--font-mono)">Pump</text>
        <rect x="50" width="8" height="8" rx="1" fill="#00A3C4" />
        <text x="62" y="8" fontSize="10" fill="var(--fg-2)" fontFamily="var(--font-mono)">Spare</text>
      </g>
    </svg>
  );
}

// ── Icon SVGs (inline) ─────────────────────────────────────────

function PhoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5h3l1 3-2 1c.5 1.5 2 3 3.5 3.5l1-2 3 1V12c0 .8-.7 1.5-1.5 1.5C7 13.5 2.5 9 2.5 4 2.5 3.2 3.2 2.5 4 2.5z"/>
    </svg>
  );
}

function WaIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6"/>
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1"/>
      <path d="M2 4l6 5 6-5"/>
    </svg>
  );
}

// ── Style constants ────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};

const PANEL_H: CSSProperties = {
  padding: '12px 14px', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', gap: 10,
};

const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
  color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };

const REV_TH: CSSProperties = {
  padding: '6px 8px', textAlign: 'right', fontSize: 10,
  fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', fontWeight: 400,
};

const BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 11px', fontSize: 12, fontFamily: 'inherit',
  fontWeight: 500, background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', color: 'var(--fg)',
  borderRadius: 5, cursor: 'pointer',
};

const ICON_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28,
  background: 'transparent', border: '1px solid var(--line)',
  color: 'var(--fg-3)', borderRadius: 5, cursor: 'pointer',
  textDecoration: 'none',
};
