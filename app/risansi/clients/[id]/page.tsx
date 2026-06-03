import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Tag, StatusDot } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { fyShortLabel, fmtCr, formatRev } from '@/lib/risansi-utils';
import { ClientActionButtons, PipelineOppBtn, EditDrawerTrigger } from '@/components/risansi/ClientActionButtons';
import { AddContactButton } from '@/components/risansi/AddContactButton';
import { EditContactButton } from '@/components/risansi/EditContactButton';
import { BackButton } from '@/components/risansi/BackButton';
import type { DrawerRep } from '@/components/risansi/AssignVisitDrawer';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Data shapes ────────────────────────────────────────────────

interface Client {
  // Core identity
  id: string; code: string; legal_name: string; trade_name: string | null;
  group_name: string | null; business_category: string | null;
  industry: string | null; zone: string; tour_name: string | null;
  status: string; tier: string | null;
  market_type: string | null; client_type: string | null;
  is_sugar: boolean; is_tender: boolean;
  // Location
  since_year: string | number | null; address: string | null; city: string | null;
  state: string | null; country: string | null;
  capacity_bracket: string | null; google_maps_url: string | null;
  tcd: number | null; klpd: number | null;
  // Reps (DB columns + joined)
  primary_rep_id: string | null; primary_rep_name: string | null;
  secondary_rep_id: string | null; secondary_rep_name: string | null;
  rep_name: string | null;
  rep_zone: string | null; rep_route: string | null; rep_email: string | null;
  secondary_rep_joined: string | null; secondary_rep_zone: string | null; secondary_rep_route: string | null;
  sec_rep_name: string | null; sec_rep_zone: string | null;
  // Visit tracking
  last_visit_fy: string | null; last_visit_month: string | null;
  last_visit_date: string | null; planned_visit_2627: string | null;
  visit_count: number | null;
  // Sales intelligence / plan of action
  action_points:          string | null;
  action_target_date_raw: string | null;
  pcp_competitor:         string | null;
  mgmt_intervention:      string | boolean | null;
  mgmt_intervention2:     string | null;
  constraints_notes:      string | null;
  expected_to_pump:       number | null;
  expected_to_spare:      number | null;
  total_outstanding:      number | null;
  weightage_score:        number | null;
  competitors_observed:   string | null;
  ice_dispersal_by:       string | null;
  negotiation_by:         string | null;
  // Field intelligence
  performance_feedback: string | null;
  last_visit_summary:   string | null;
  open_remarks:         string | null;
  major_remarks:        string | null;
  complaint_notes:      string | null;
  // System
  created_by: string | null; created_at: string | null;
  updated_at: string | null; deleted_at: string | null;
}

interface Contact {
  id: number;
  name: string;
  designation: string | null;
  is_primary: boolean;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  notes: string | null;
  added_by: string | null;
  created_at: Date;
}

interface RevRow {
  financial_year: string; product_category: string; total: string; order_count: string;
}

interface ClientRevFY {
  fy: string; pump_inr: string; spare_inr: string; total_inr: string;
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

  const session  = await getServerSession(authOptions);
  const role     = session?.user?.role ?? '';
  const canEdit  = ['admin', 'sysadmin'].includes(role);

  // ── Dual-key client fetch (numeric id OR code string) ─────
  const isNumeric = /^\d+$/.test(id);
  const whereClause = isNumeric ? 'c.id = $1::bigint' : 'c.code = $1';

  const client = await q<Client | null>(async () => {
    const { rows } = await risansiPool.query<Client>(
      `SELECT c.*,
              COALESCE(r.name,  c.primary_rep_name, '—') AS rep_name,
              r.zone  AS rep_zone,
              r.route AS rep_route,
              r2.name  AS secondary_rep_joined,
              r2.zone  AS secondary_rep_zone,
              r2.route AS secondary_rep_route
       FROM clients c
       LEFT JOIN reps r  ON c.primary_rep_id   = r.id
       LEFT JOIN reps r2 ON c.secondary_rep_id  = r2.id
       WHERE ${whereClause} AND c.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }, null);

  if (!client) notFound();

  // ── Fetch supporting data in parallel ─────────────────────

  const [contacts, revRows, clientRevByFY, equipment, visits, openOpps, activityLog, reps] = await Promise.all([

    // 2. Contacts — single source of truth
    q<Contact[]>(async () => {
      const { rows } = await risansiPool.query<Contact>(
        `SELECT id, name, designation, is_primary,
                phone, email, whatsapp, notes,
                added_by, created_at
         FROM contacts
         WHERE client_id = $1
         ORDER BY is_primary DESC, created_at ASC`,
        [client.id],
      );
      return rows;
    }, []),

    // 3. Revenue by FY / category (orders table — for order count)
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

    // 3b. Revenue by FY from client_revenue_monthly (authoritative values)
    q<ClientRevFY[]>(async () => {
      const { rows } = await risansiPool.query<ClientRevFY>(
        `SELECT
           LPAD((EXTRACT(YEAR FROM month)::int % 100)::text, 2, '0') || '-' ||
           LPAD(((EXTRACT(YEAR FROM month)::int + 1) % 100)::text, 2, '0') AS fy,
           COALESCE(SUM(pump_value),  0)::text AS pump_inr,
           COALESCE(SUM(spare_value), 0)::text AS spare_inr,
           COALESCE(SUM(total_value), 0)::text AS total_inr
         FROM client_revenue_monthly
         WHERE client_id = $1
           AND EXTRACT(MONTH FROM month) >= 4
         GROUP BY 1
         UNION ALL
         SELECT
           LPAD(((EXTRACT(YEAR FROM month)::int - 1) % 100)::text, 2, '0') || '-' ||
           LPAD((EXTRACT(YEAR FROM month)::int % 100)::text, 2, '0') AS fy,
           COALESCE(SUM(pump_value),  0)::text AS pump_inr,
           COALESCE(SUM(spare_value), 0)::text AS spare_inr,
           COALESCE(SUM(total_value), 0)::text AS total_inr
         FROM client_revenue_monthly
         WHERE client_id = $1
           AND EXTRACT(MONTH FROM month) < 4
         GROUP BY 1
         ORDER BY fy ASC`,
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

    // 8. Reps for Plan Visit drawer
    q<DrawerRep[]>(async () => {
      const { rows } = await risansiPool.query<{ id: string; name: string; route: string | null }>(
        `SELECT id, name, route FROM reps WHERE deleted_at IS NULL ORDER BY name`,
      );
      return rows;
    }, []),
  ]);

  // ── Derived values ────────────────────────────────────────

  // Revenue chart data — from client_revenue_monthly (INR ÷ 1L = Lakhs)
  const INR_TO_L = 100_000;

  const revByFY: Record<string, { pump: number; spare: number; orders: number }> = {};

  // Build from client_revenue_monthly (authoritative)
  for (const r of clientRevByFY) {
    revByFY[r.fy] = {
      pump:   Number(r.pump_inr)  / INR_TO_L,
      spare:  Number(r.spare_inr) / INR_TO_L,
      orders: 0,
    };
  }

  // Merge order counts from orders table
  for (const r of revRows) {
    if (!revByFY[r.financial_year]) {
      revByFY[r.financial_year] = { pump: 0, spare: 0, orders: 0 };
    }
    revByFY[r.financial_year].orders += Number(r.order_count);
  }

  // Chart FYs: all FYs with data, sorted
  const chartFYs = Object.keys(revByFY).sort();

  let lifetimePump = 0, lifetimeSpare = 0, lifetimeOrders = 0;
  for (const { pump, spare, orders } of Object.values(revByFY)) {
    lifetimePump   += pump;
    lifetimeSpare  += spare;
    lifetimeOrders += orders;
  }
  const lifetimeTotal = lifetimePump + lifetimeSpare;

  // 5yr CAGR (from master data columns)
  const chartTotals = chartFYs.map(f => (revByFY[f]?.pump ?? 0) + (revByFY[f]?.spare ?? 0));
  const cagr5yr = (() => {
    const nonZero = chartTotals.filter(v => v > 0);
    if (nonZero.length < 2) return null;
    const first = nonZero[0], last = nonZero[nonZero.length - 1];
    const years = nonZero.length - 1;
    return ((last / first) ** (1 / years) - 1) * 100;
  })();

  // Equipment KPIs — from field assessments
  const rilUnits   = equipment.filter(e => e.supplier === 'RIL').reduce((s, e) => s + e.quantity, 0);
  const totalUnits = equipment.reduce((s, e) => s + e.quantity, 0);

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
        <Topbar crumbs={[{ label: 'Clients', href: '/risansi/clients' }, client.zone ?? '', client.trade_name ?? client.legal_name]} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Back button */}
        <BackButton />

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
            </div>

            {/* Rep display row */}
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Primary rep */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Primary</span>
                {client.primary_rep_id ? (
                  <span style={{ fontSize: 12, fontWeight: 500 }}>
                    {client.rep_name}
                    {(client.rep_zone || client.rep_route) && (
                      <span style={{ fontWeight: 400, color: 'var(--fg-3)', marginLeft: 4 }}>
                        · {[client.rep_zone, client.rep_route].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                ) : client.primary_rep_name ? (
                  <span style={{ fontSize: 12 }}>
                    {client.primary_rep_name}
                    <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 4 }}>(Excel import)</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--neg)' }}>Unassigned</span>
                )}
                {canEdit && <EditDrawerTrigger />}
              </div>

              {/* Secondary rep (only if set) */}
              {(client.secondary_rep_id || client.secondary_rep_name) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Secondary</span>
                  {client.secondary_rep_id ? (
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      {client.secondary_rep_joined ?? client.secondary_rep_name}
                      {(client.secondary_rep_zone || client.secondary_rep_route) && (
                        <span style={{ fontWeight: 400, color: 'var(--fg-3)', marginLeft: 4 }}>
                          · {[client.secondary_rep_zone, client.secondary_rep_route].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12 }}>
                      {client.secondary_rep_name}
                      <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 4 }}>(Excel import)</span>
                    </span>
                  )}
                </div>
              )}

              {/* Google Maps link */}
              {client.google_maps_url && (
                <a
                  href={client.google_maps_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  📍 View on Maps
                </a>
              )}
            </div>
          </div>
          <ClientActionButtons
            clientId={client.id}
            clientName={client.legal_name}
            clientCode={client.code}
            industry={client.industry ?? ''}
            repId={client.primary_rep_id ?? null}
            repName={client.rep_name ?? client.primary_rep_name ?? ''}
            reps={reps}
            clientData={client}
            canEdit={canEdit}
          />
        </div>

        {/* ── KPI cards ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <MiniKpi label="Lifetime Revenue"
            value={formatRev(lifetimeTotal * 100_000)}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                {/* Left: data table */}
                <div style={{ borderRight: '1px solid var(--line)', display: 'flex', alignItems: 'center', minHeight: 200, padding: '16px 0' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elev)' }}>
                        <th style={{ ...REV_TH, textAlign: 'left', padding: '10px 12px' }}></th>
                        {chartFYs.map(f => (
                          <th key={f} style={{ ...REV_TH, padding: '10px 12px' }}>FY {f}</th>
                        ))}
                        <th style={{ ...REV_TH, padding: '10px 12px', fontWeight: 600, color: 'var(--fg-2)' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>Pump (₹ L)</td>
                        {chartFYs.map(f => (
                          <td key={f} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, borderBottom: '1px solid var(--line)', color: revByFY[f].pump > 0 ? 'var(--fg)' : 'var(--fg-3)' }}>
                            {revByFY[f].pump > 0 ? revByFY[f].pump.toFixed(1) : '—'}
                          </td>
                        ))}
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--line)' }}>
                          {lifetimePump.toFixed(1)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>Spare (₹ L)</td>
                        {chartFYs.map(f => (
                          <td key={f} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, borderBottom: '1px solid var(--line)', color: revByFY[f].spare > 0 ? 'var(--fg)' : 'var(--fg-3)' }}>
                            {revByFY[f].spare > 0 ? revByFY[f].spare.toFixed(1) : '—'}
                          </td>
                        ))}
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--line)' }}>
                          {lifetimeSpare.toFixed(1)}
                        </td>
                      </tr>
                      <tr style={{ background: 'var(--bg-elev)' }}>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--fg-2)', fontWeight: 600 }}>Total</td>
                        {chartFYs.map(f => {
                          const t = revByFY[f].pump + revByFY[f].spare;
                          return (
                            <td key={f} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, color: t > 0 ? 'var(--fg)' : 'var(--fg-3)' }}>
                              {t > 0 ? t.toFixed(1) : '—'}
                            </td>
                          );
                        })}
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11, color: '#0A3D8F' }}>
                          {lifetimeTotal.toFixed(1)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* Right: bar chart */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                  <RevenueChart fyKeys={chartFYs} revByFY={revByFY} />
                </div>
              </div>
            </div>

            {/* Installed Base · PCP Summary */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>PCP Installed Base · {totalUnits} pump{totalUnits !== 1 ? 's' : ''}</span>
                {(totalUnits - rilUnits) > 0 && (
                  <div style={{ marginLeft: 'auto' }}>
                    <Tag kind="warn">{totalUnits - rilUnits} competitor unit{(totalUnits - rilUnits) !== 1 ? 's' : ''}</Tag>
                  </div>
                )}
              </div>
              {equipment.length > 0 ? (
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
                          {formatRev(client.expected_to_pump ?? 0)}
                        </div>
                      </div>
                    )}
                    {client.expected_to_spare != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Expected Spare</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--pos)' }}>
                          {formatRev(client.expected_to_spare ?? 0)}
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
              <div style={{
                ...PANEL_H,
                justifyContent: 'space-between',
                borderBottom: contacts.length > 0 ? '1px solid var(--line)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={PANEL_TITLE}>Contacts</span>
                  {contacts.length > 0 && (
                    <span style={{
                      background: 'var(--bg-sunk)', color: 'var(--fg-3)',
                      borderRadius: 10, padding: '1px 7px',
                      fontSize: 11, fontWeight: 600,
                    }}>
                      {contacts.length}
                    </span>
                  )}
                </div>
                {canEdit && <AddContactButton clientId={Number(client.id)} clientCode={client.code} />}
              </div>

              {contacts.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
                  No contacts recorded yet.
                  <br />
                  <span style={{ fontSize: 12 }}>Click + Add Contact to add the first contact.</span>
                </div>
              ) : (
                <div>
                  {contacts.map((c, i) => (
                    <div
                      key={c.id}
                      style={{
                        padding: '12px 16px',
                        borderBottom: i < contacts.length - 1 ? '1px solid var(--line)' : 'none',
                        display: 'flex', gap: 12, alignItems: 'flex-start',
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                        background: c.is_primary ? '#0A3D8F' : 'var(--bg-sunk)',
                        color: c.is_primary ? '#fff' : 'var(--fg-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      }}>
                        {c.name.split(' ').map((w: string) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?'}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Name row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)' }}>{c.name}</span>
                          {c.is_primary && (
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              background: 'rgba(26,92,184,0.08)',
                              color: '#1A5CB8',
                              border: '1px solid rgba(26,92,184,0.2)',
                              borderRadius: 10, padding: '1px 7px',
                              textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                              Primary
                            </span>
                          )}
                          {c.added_by === 'excel_import' && (
                            <span style={{
                              fontSize: 10, background: 'var(--bg-sunk)',
                              color: 'var(--fg-3)', borderRadius: 4, padding: '1px 5px',
                            }}>
                              Imported
                            </span>
                          )}
                        </div>

                        {/* Designation */}
                        {c.designation && (
                          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                            {c.designation}
                          </div>
                        )}

                        {/* Contact links */}
                        <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {c.phone && (
                            <a href={`tel:${c.phone}`} style={CONTACT_LINK}>
                              📞 {c.phone}
                            </a>
                          )}
                          {c.email && (
                            <a href={`mailto:${c.email}`} style={CONTACT_LINK}>
                              ✉ {c.email}
                            </a>
                          )}
                          {c.whatsapp && (
                            <a
                              href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ ...CONTACT_LINK, color: '#25D366' }}
                            >
                              💬 WhatsApp
                            </a>
                          )}
                        </div>

                        {/* Notes */}
                        {c.notes && (
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 5, fontStyle: 'italic', lineHeight: 1.4 }}>
                            {c.notes}
                          </div>
                        )}

                        {/* Edit — live contacts only (Excel-imported show the Imported badge, no edit) */}
                        {canEdit && c.added_by !== 'excel_import' && (
                          <EditContactButton
                            contact={{
                              id: c.id,
                              name: c.name,
                              designation: c.designation,
                              phone: c.phone,
                              email: c.email,
                              whatsapp: c.whatsapp,
                              notes: c.notes,
                              is_primary: c.is_primary,
                            }}
                            clientId={Number(client.id)}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Open pipeline */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Open Pipeline</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {pipelineTotal > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                      {fmtCr(pipelineTotal)} total
                    </span>
                  )}
                  <PipelineOppBtn />
                </div>
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
                          {`OPP-${String(o.id).padStart(4, '0')}`}
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
  const height = 100;
  const bw     = 28;
  const gap    = 12;
  const maxVal = Math.max(...fyKeys.map(f => revByFY[f].pump + revByFY[f].spare), 1);
  const totalW = fyKeys.length * (bw + gap) - gap;
  const padL   = 28;

  return (
    <svg width="100%" height="160" viewBox={`0 0 ${totalW + padL + 20} ${height + 30}`} preserveAspectRatio="xMinYMin meet" style={{ overflow: 'visible' }}>
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
              <text x={x + bw / 2} y={height - ph - sh - 3} textAnchor="middle" fontSize="9" fill="var(--fg-2)" fontFamily="var(--font-mono)">
                {total.toFixed(1)}
              </text>
            )}
            <text x={x + bw / 2} y={height + 12} textAnchor="middle" fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {fyShortLabel(fyKey)}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${padL}, ${height + 22})`}>
        <rect width="8" height="8" rx="1" fill="var(--accent)" />
        <text x="12" y="8" fontSize="11" fill="var(--fg-2)" fontFamily="var(--font-mono)">Pump</text>
        <rect x="50" width="8" height="8" rx="1" fill="#00A3C4" />
        <text x="62" y="8" fontSize="11" fill="var(--fg-2)" fontFamily="var(--font-mono)">Spare</text>
      </g>
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
  padding: '5px 8px', textAlign: 'right', fontSize: 10,
  fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', fontWeight: 400,
};


const CONTACT_LINK: CSSProperties = {
  fontSize: 12, color: '#1A5CB8',
  textDecoration: 'none', display: 'flex',
  alignItems: 'center', gap: 4,
};
