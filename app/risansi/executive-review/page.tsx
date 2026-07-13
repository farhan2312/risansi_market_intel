import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { ExecutiveViews, type ExecData, type Row } from '@/components/risansi/ExecutiveViews';
import { ExecutiveSelector, type SelRep } from '@/components/risansi/ExecutiveSelector';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fb: T): Promise<T> { try { return await fn(); } catch (e) { console.error('[exec-review]', e); return fb; } }
const n = (v: unknown) => Math.round(Number(v ?? 0));
const yy = (y: number) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
function fmtMoney(v: number): string {
  if (!v) return '₹0';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// Canonical client-type bucket (Mona's five categories).
const CANON = `CASE
  WHEN upper(c.client_type) IN ('DIRECT MILL','END USER') THEN 'Direct Mill'
  WHEN upper(c.client_type) IN ('GROUP (MILLS)','GROUP')  THEN 'Group Mills'
  WHEN upper(c.client_type) IN ('TRADER','MERCHANT EXPORTER') THEN 'Trader'
  WHEN upper(c.client_type) = 'OEM' THEN 'OEM'
  WHEN upper(c.client_type) = 'CHANNEL PARTNER' THEN 'Channel Partner'
  ELSE 'Other' END`;
const CATS = ['Direct Mill', 'Group Mills', 'Trader', 'OEM', 'Channel Partner'];
const TURN_ORDER = ['15 Lac & above (Super Critical)', '5-15 Lacs p.a.', '3-5 Lacs p.a.', '1-3 Lacs p.a.', 'Less than 1 Lac p.a.', 'New Business', 'Business Regained', 'End Client', 'No Business'];

export default async function ExecutiveReviewPage({ searchParams }: {
  searchParams: Promise<{ tsm?: string; month?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? '';
  if (!hasRole(role, 'admin')) redirect('/risansi');
  const sp = await searchParams;

  // TSM roster = users with tours.
  const reps = await q<SelRep[]>(async () => (await risansiPool.query<SelRep>(
    `SELECT DISTINCT u.id::text AS id, u.name FROM users u
       JOIN tour_assignments ta ON ta.rep_id = u.id
      WHERE u.role IN ('rep','manager') ORDER BY u.name`)).rows, []);

  const tsm = (sp.tsm && reps.some(r => r.id === sp.tsm)) ? sp.tsm : (reps[0]?.id ?? '');
  const tsmName = reps.find(r => r.id === tsm)?.name ?? '—';

  // Month → fiscal year (Apr–Mar).
  const now = new Date();
  const mMatch = /^(\d{4})-(\d{2})$/.exec(sp.month ?? '');
  const selY = mMatch ? Number(mMatch[1]) : now.getFullYear();
  const selM = mMatch ? Number(mMatch[2]) : now.getMonth() + 1;
  const month = `${selY}-${String(selM).padStart(2, '0')}`;
  const fy = selM >= 4 ? selY : selY - 1;            // FY start year
  const d = (y: number, m = 4) => `${y}-${String(m).padStart(2, '0')}-01`;
  const curTo = selM === 12 ? d(selY + 1, 1) : d(selY, selM + 1);   // end of selected month (exclusive)
  const w5from = d(fy - 5), w5to = d(fy);                            // 5 completed FYs before current

  const tourF = tsm ? `c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${Number(tsm)})` : 'FALSE';

  const [clients, turnover, quotation, offers, attendance, kpiRow] = await Promise.all([
    // 1. Clients Summary
    q(async () => (await risansiPool.query<{ cat: string; nn: string }>(
      `SELECT ${CANON} cat, count(*)::text nn FROM clients c
        WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL GROUP BY 1`)).rows, []),

    // 2. Turnover Summary — classify each ACTIVE client, aggregate per FY
    q(async () => (await risansiPool.query<{ bucket: string; clients: string; fyc: string; f1: string; f2: string; f3: string }>(
      `WITH rev AS (
         SELECT c.id, c.is_end_client,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w5from}' AND r.month < '${w5to}'),0) rev5,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w5to}'),0) rev_cur,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month <  '${w5from}'),0) rev_before,
           min(r.month) FILTER (WHERE r.total_value > 0) first_rev,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy)}'    AND r.month < '${curTo}'),0)      fyc,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy - 1)}' AND r.month < '${d(fy)}'),0)     f1,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy - 2)}' AND r.month < '${d(fy - 1)}'),0) f2,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy - 3)}' AND r.month < '${d(fy - 2)}'),0) f3
         FROM clients c LEFT JOIN client_revenue_monthly r ON r.client_id = c.id
        WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL GROUP BY c.id, c.is_end_client),
       band AS (SELECT *, CASE
         WHEN is_end_client THEN 'End Client'
         WHEN rev_cur>0 AND rev5=0 AND rev_before>0 THEN 'Business Regained'
         WHEN first_rev IS NOT NULL AND first_rev >= '${d(fy)}' THEN 'New Business'
         WHEN rev5=0 AND rev_cur=0 THEN 'No Business'
         WHEN rev5/5.0 >= 1500000 THEN '15 Lac & above (Super Critical)'
         WHEN rev5/5.0 >= 500000  THEN '5-15 Lacs p.a.'
         WHEN rev5/5.0 >= 300000  THEN '3-5 Lacs p.a.'
         WHEN rev5/5.0 >= 100000  THEN '1-3 Lacs p.a.'
         ELSE 'Less than 1 Lac p.a.' END bucket FROM rev)
       SELECT bucket, count(*)::text clients, round(sum(fyc))::text fyc, round(sum(f1))::text f1, round(sum(f2))::text f2, round(sum(f3))::text f3
       FROM band GROUP BY bucket`)).rows, []),

    // 3. Quotation Summary — channel x Active/Won
    q(async () => (await risansiPool.query<{ channel: string; active: string; won: string }>(
      `SELECT ${CANON} channel,
              round(sum(o.offer_value_inr) FILTER (WHERE o.stage IN ('Quoted','Negotiating')))::text active,
              round(sum(o.offer_value_inr) FILTER (WHERE o.stage='Won'))::text won
         FROM opportunities o JOIN clients c ON c.id=o.client_id WHERE ${tourF} GROUP BY 1`)).rows, []),

    // 4. Offer Status — mapped from stage
    q(async () => (await risansiPool.query<{ stage: string; val: string }>(
      `SELECT o.stage, round(sum(o.offer_value_inr))::text val
         FROM opportunities o JOIN clients c ON c.id=o.client_id WHERE ${tourF} GROUP BY 1`)).rows, []),

    // 5. Attendance — the rep's field visits by month within the current FY, up to the selected month
    q(async () => (await risansiPool.query<{ mon: string; days: string; clients: string }>(
      `SELECT to_char(visit_date,'YYYY-MM') mon, count(distinct visit_date)::text days, count(distinct client_id)::text clients
         FROM visits WHERE rep_id = ${Number(tsm) || 0} AND visit_date >= '${d(fy)}' AND visit_date < '${curTo}'
        GROUP BY 1 ORDER BY 1`)).rows, []),

    // 6. KPIs
    q(async () => (await risansiPool.query<{ total_business: string; leads: string; visited: string; active_clients: string }>(
      `SELECT
         (SELECT COALESCE(round(sum(o.offer_value_inr)),0) FROM opportunities o JOIN clients c ON c.id=o.client_id
           WHERE ${tourF} AND o.stage='Won')::text AS total_business,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE' AND c.deleted_at IS NULL)::text AS leads,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE' AND c.deleted_at IS NULL AND c.last_visit_date IS NOT NULL)::text AS visited,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL)::text AS active_clients`)).rows[0], null),
  ]);

  // ── shape into ExecData ──
  const cmMap = Object.fromEntries(clients.map(r => [r.cat, Number(r.nn)]));
  const clientRows: Row[] = CATS.map(cat => ({ label: cat, vals: [cmMap[cat] ?? 0] }));
  const cmTotal = clients.reduce((s, r) => s + Number(r.nn), 0);
  clientRows.push({ label: 'Grand Total', vals: [cmTotal], strong: true });

  const tMap = Object.fromEntries(turnover.map(r => [r.bucket, r]));
  const turnRows: Row[] = TURN_ORDER.filter(b => tMap[b]).map(b => {
    const r = tMap[b];
    return { label: b, vals: [Number(r.clients), n(r.fyc), n(r.f1), n(r.f2), n(r.f3)] };
  });
  const tt = turnover.reduce((a, r) => { a.c += +r.clients; a.fyc += n(r.fyc); a.f1 += n(r.f1); a.f2 += n(r.f2); a.f3 += n(r.f3); return a; }, { c: 0, fyc: 0, f1: 0, f2: 0, f3: 0 });
  turnRows.push({ label: 'Grand Total', vals: [tt.c, tt.fyc, tt.f1, tt.f2, tt.f3], strong: true });

  const qMap = Object.fromEntries(quotation.map(r => [r.channel, r]));
  const quoteRows: Row[] = CATS.filter(cat => qMap[cat]).map(cat => ({ label: cat, vals: [n(qMap[cat].active), n(qMap[cat].won), n(qMap[cat].active) + n(qMap[cat].won)] }));
  const qt = quotation.reduce((a, r) => { a.a += n(r.active); a.w += n(r.won); return a; }, { a: 0, w: 0 });
  quoteRows.push({ label: 'Grand Total', vals: [qt.a, qt.w, qt.a + qt.w], strong: true });

  // Offer Status (stage → Mona's labels). Hold-Active has no stage yet.
  const STAGE_TO_OFFER: Record<string, string> = { Quoted: 'Active', Negotiating: 'Active', 'On Hold': 'Hold-Active', Won: 'Order Received', Lost: 'Order Lost by RIL', Dropped: 'Requirement Closed' };
  const offerAgg: Record<string, number> = { Active: 0, 'Hold-Active': 0, 'Order Lost by RIL': 0, 'Order Received': 0, 'Requirement Closed': 0 };
  for (const r of offers) { const lbl = STAGE_TO_OFFER[r.stage]; if (lbl) offerAgg[lbl] += n(r.val); }
  const offerRows: Row[] = ['Active', 'Hold-Active', 'Order Lost by RIL', 'Order Received', 'Requirement Closed'].map(l => ({ label: l, vals: [offerAgg[l]] }));
  offerRows.push({ label: 'Grand Total', vals: [Object.values(offerAgg).reduce((a, b) => a + b, 0)], strong: true });

  const MON = (m: string) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const attRows: Row[] = attendance.map(r => ({ label: MON(r.mon), vals: [Number(r.days), Number(r.clients)] }));
  const at = attendance.reduce((a, r) => { a.d += +r.days; return a; }, { d: 0 });
  attRows.push({ label: 'Total', vals: [at.d, null], strong: true });

  const data: ExecData = {
    clientsSummary:  { headers: ['Client type', 'Clients'], rows: clientRows, moneyFrom: 99 },
    turnoverSummary: { headers: ['Turnover band', 'Clients', `TO ${yy(fy)}`, `TO ${yy(fy - 1)}`, `TO ${yy(fy - 2)}`, `TO ${yy(fy - 3)}`], rows: turnRows, moneyFrom: 1 },
    quotationSummary:{ headers: ['Channel', 'Active', 'Order Received', 'Total'], rows: quoteRows, moneyFrom: 0 },
    offerStatus:     { headers: ['Offer status', 'Total Offer Value (INR)'], rows: offerRows, moneyFrom: 0 },
    attendance:      { headers: ['Month', 'Visit days', 'Clients'], rows: attRows, moneyFrom: 99 },
    kpis: [
      { label: 'Total Business', value: fmtMoney(n(kpiRow?.total_business)), sub: `orders won · FY ${yy(fy)}`, accent: true },
      { label: 'Active Clients', value: (kpiRow ? Number(kpiRow.active_clients) : 0).toLocaleString('en-IN') },
      { label: 'Total Leads', value: (kpiRow ? Number(kpiRow.leads) : 0).toLocaleString('en-IN'), sub: 'prospective on tour' },
      { label: 'Leads Visited', value: (kpiRow ? Number(kpiRow.visited) : 0).toLocaleString('en-IN') },
    ],
  };

  const periodLabel = `${tsmName} · FY ${yy(fy)} to ${new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`;
  const note = 'Live data. Order Received / Total Business come from Won opportunities (₹0 until deals are marked Won); leads attribute by tour; "Hold-Active" and lead conversions (Converted to Enquiry/Client) are pending — the former needs a stage, the latter the lead-management build.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <ExecutiveViews
          data={data}
          periodLabel={periodLabel}
          note={note}
          selector={<ExecutiveSelector reps={reps} tsm={tsm} month={month} />}
        />
      </div>
    </div>
  );
}
