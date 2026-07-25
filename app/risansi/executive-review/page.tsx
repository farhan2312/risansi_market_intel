import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { ExecutiveViews, type ExecData, type Row } from '@/components/risansi/ExecutiveViews';
import { ExecutiveSelector, type SelRep } from '@/components/risansi/ExecutiveSelector';
import { AccountSelector, ViewSwitch, type NameOpt } from '@/components/risansi/AccountSelector';
import { GroupReview, OemReview, type GroupReviewData, type GroupUnit, type OemReviewData } from '@/components/risansi/AccountReview';

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

// FY label in the app's key format: start year 2025 → '25-26'.
const fyLabel = (startYear: number) => `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
// Bucket a date column into that same FY label (April–March).
const FY_EXPR = (col: string) => `CASE WHEN EXTRACT(MONTH FROM ${col}) >= 4
  THEN LPAD((EXTRACT(YEAR FROM ${col})::int % 100)::text,2,'0')||'-'||LPAD(((EXTRACT(YEAR FROM ${col})::int + 1) % 100)::text,2,'0')
  ELSE LPAD(((EXTRACT(YEAR FROM ${col})::int - 1) % 100)::text,2,'0')||'-'||LPAD((EXTRACT(YEAR FROM ${col})::int % 100)::text,2,'0') END`;

export default async function ExecutiveReviewPage({ searchParams }: {
  searchParams: Promise<{ tsm?: string; month?: string; months?: string; view?: string; ctype?: string; name?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? '';
  if (!hasRole(role, 'admin')) redirect('/risansi');
  const sp = await searchParams;

  // ── Account Review: a group of mills, or a single OEM ──────────
  if (sp.view === 'account') {
    const ctype: 'group' | 'oem' = sp.ctype === 'oem' ? 'oem' : 'group';
    const nowD = new Date();
    const curFy = (nowD.getMonth() + 1) >= 4 ? nowD.getFullYear() : nowD.getFullYear() - 1;
    const FYS = Array.from({ length: 5 }, (_, i) => fyLabel(curFy - 4 + i));

    const options = await q<NameOpt[]>(async () => (await risansiPool.query<NameOpt>(
      ctype === 'group'
        ? `SELECT group_name AS value, group_name || ' (' || count(*) || ' units)' AS label
             FROM clients WHERE group_name IS NOT NULL AND btrim(group_name) <> '' AND deleted_at IS NULL
            GROUP BY group_name ORDER BY group_name`
        : `SELECT code AS value, legal_name AS label FROM clients
            WHERE client_type = 'OEM' AND deleted_at IS NULL ORDER BY legal_name`)).rows, []);
    const picked = options.some(o => o.value === sp.name) ? sp.name! : (options[0]?.value ?? '');

    const shell = (body: React.ReactNode, title: string, sub: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>{title}</h1>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
            </div>
            <AccountSelector ctype={ctype} name={picked} options={options} />
          </div>
          {body}
        </div>
      </div>
    );

    if (!picked) return shell(<div style={{ fontSize: 13, color: 'var(--fg-3)' }}>No {ctype === 'group' ? 'groups' : 'OEM clients'} on record.</div>, 'Account Review', '—');

    // ── Group of mills ──
    if (ctype === 'group') {
      const units = await q<{ id: string; code: string; legal_name: string; tcd: number | null }[]>(async () => (await risansiPool.query(
        `SELECT id::text, code, legal_name, tcd FROM clients
          WHERE group_name = $1 AND deleted_at IS NULL ORDER BY legal_name`, [picked])).rows, []);
      const ids = units.map(u => Number(u.id));

      const [foot, rev, comps] = await Promise.all([
        q<{ client_id: number; ril_pcp: number; roto_pcp: number; total_pcp: number; ril_mmp: number; total_mmp: number; total_pumps: number }[]>(async () => (await risansiPool.query(
          `SELECT DISTINCT ON (client_id) client_id,
                  COALESCE(ril_pcp,0) ril_pcp, COALESCE(roto_pcp,0) roto_pcp, COALESCE(total_pcp,0) total_pcp,
                  COALESCE(ril_mmp,0) ril_mmp, COALESCE(total_mmp,0) total_mmp, COALESCE(total_pumps,0) total_pumps
             FROM competitor_installed_base WHERE client_id = ANY($1::int[])
            ORDER BY client_id, assessed_at DESC NULLS LAST, id DESC`, [ids])).rows, []),
        q<{ client_id: number; fy: string; pump: string; spare: string }[]>(async () => (await risansiPool.query(
          `SELECT client_id, ${FY_EXPR('month')} fy, SUM(pump_value)::text pump, SUM(spare_value)::text spare
             FROM client_revenue_monthly WHERE client_id = ANY($1::int[]) GROUP BY 1,2`, [ids])).rows, []),
        // NB: `year` is reserved in Postgres — alias as yr.
        q<{ yr: number; nature: string; n: string }[]>(async () => (await risansiPool.query(
          `SELECT EXTRACT(YEAR FROM complaint_date)::int AS yr,
                  COALESCE(NULLIF(btrim(root_cause),''), 'Not classified') AS nature, count(*)::text AS n
             FROM complaints WHERE client_id = ANY($1::int[]) AND complaint_date IS NOT NULL
            GROUP BY 1,2 ORDER BY 1 DESC, count(*) DESC`, [ids])).rows, []),
      ]);

      const fMap = new Map(foot.map(f => [f.client_id, f]));
      const rMap = new Map(rev.map(r => [`${r.client_id}|${r.fy}`, r]));
      const gu: GroupUnit[] = units.map(u => {
        const id = Number(u.id); const f = fMap.get(id);
        const totalPcp = f?.total_pcp ?? 0, rilPcp = f?.ril_pcp ?? 0, rotoPcp = f?.roto_pcp ?? 0;
        const totalMmp = f?.total_mmp ?? 0, rilMmp = f?.ril_mmp ?? 0;
        const totalPumps = f?.total_pumps ?? (totalPcp + totalMmp);
        const pumpByFy = FYS.map(fy => { const v = rMap.get(`${id}|${fy}`); return v ? Number(v.pump) || null : null; });
        const spareByFy = FYS.map(fy => { const v = rMap.get(`${id}|${fy}`); return v ? Number(v.spare) || null : null; });
        const spareTotal = spareByFy.reduce<number>((a, b) => a + (b ?? 0), 0);
        const sparesPerPump = totalPumps > 0 && spareTotal > 0 ? (spareTotal / FYS.length) / totalPumps : null;
        return {
          code: u.code, name: u.legal_name, tcd: u.tcd,
          rilPcp, rotoPcp, otherPcp: Math.max(0, totalPcp - rilPcp - rotoPcp), totalPcp,
          rilMmp, otherMmp: Math.max(0, totalMmp - rilMmp), totalPumps,
          sparesPerPump, pumpByFy, spareByFy, actions: [],
        };
      });

      const F = gu.reduce((a, u) => ({
        pcpRil: a.pcpRil + u.rilPcp, pcpRoto: a.pcpRoto + u.rotoPcp, pcpOther: a.pcpOther + u.otherPcp,
        pcpTotal: a.pcpTotal + u.totalPcp, mmpRil: a.mmpRil + u.rilMmp, mmpOther: a.mmpOther + u.otherMmp,
        mmpTotal: a.mmpTotal + u.rilMmp + u.otherMmp,
      }), { pcpRil: 0, pcpRoto: 0, pcpOther: 0, pcpTotal: 0, mmpRil: 0, mmpOther: 0, mmpTotal: 0 });

      const withSpares = gu.filter(u => u.sparesPerPump != null);
      const avgPerPump = withSpares.length ? withSpares.reduce((a, u) => a + (u.sparesPerPump ?? 0), 0) / withSpares.length : null;
      // Derived, from real numbers — never a hardcoded flag.
      for (const u of gu) {
        if (u.totalPumps === 0) u.actions.push('Pump footprint not recorded');
        else if (u.sparesPerPump == null) u.actions.push('No spares recorded');
        else if (avgPerPump != null && u.sparesPerPump < avgPerPump) u.actions.push('Spares below group avg');
      }
      const data: GroupReviewData = {
        group: picked, fys: FYS, units: gu, footprint: F,
        sparesPerPumpAvg: avgPerPump,
        attention: gu.filter(u => u.actions.length).map(u => u.name.replace(/^BALRAMPUR CHINI MILLS.*?[.(]?\s*/i, '').trim() || u.code),
        complaints: comps.map(c => ({ year: c.yr, nature: c.nature, count: Number(c.n) })),
      };
      return shell(<GroupReview d={data} />, picked, `${gu.length} units · FY ${FYS[0]} to ${FYS[FYS.length - 1]} · live data`);
    }

    // ── Single OEM ──
    const cl = await q<{ id: string; code: string; legal_name: string }[]>(async () => (await risansiPool.query(
      `SELECT id::text, code, legal_name FROM clients WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, [picked])).rows, []);
    const c0 = cl[0];
    if (!c0) return shell(<div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Client not found.</div>, 'Account Review', '—');
    const cid = Number(c0.id);

    const [rev, pumps, opps] = await Promise.all([
      q<{ fy: string; total: string }[]>(async () => (await risansiPool.query(
        `SELECT ${FY_EXPR('month')} fy, SUM(total_value)::text total
           FROM client_revenue_monthly WHERE client_id = $1 GROUP BY 1`, [cid])).rows, []),
      q<{ n: string }[]>(async () => (await risansiPool.query(
        `SELECT COALESCE((SELECT total_pumps FROM competitor_installed_base WHERE client_id=$1
                           ORDER BY assessed_at DESC NULLS LAST, id DESC LIMIT 1),
                         (SELECT COALESCE(SUM(quantity),0) FROM client_pumps WHERE client_id=$1))::text n`, [cid])).rows, []),
      q<{ fy: string; stage: string; v: string }[]>(async () => (await risansiPool.query(
        `SELECT ${FY_EXPR('COALESCE(quote_date, created_at::date)')} fy, stage,
                SUM(COALESCE(offer_value_inr, value_cr * 10000000, 0))::text v
           FROM opportunities WHERE client_id = $1 GROUP BY 1,2`, [cid])).rows, []),
    ]);

    const revMap = new Map(rev.map(r => [r.fy, Number(r.total)]));
    const revenueByFy = FYS.map(fy => revMap.get(fy) ?? null);
    const totalRevenue = revenueByFy.reduce<number>((a, b) => a + (b ?? 0), 0);
    const oppFys = [...new Set(opps.map(o => o.fy))].sort();
    const stages = [...new Set(opps.map(o => o.stage))].sort();
    const oMap = new Map(opps.map(o => [`${o.stage}|${o.fy}`, Number(o.v)]));
    const data: OemReviewData = {
      code: c0.code, name: c0.legal_name, fys: FYS, revenueByFy,
      totalRevenue, avgPerYear: totalRevenue / FYS.length,
      totalPumps: Number(pumps[0]?.n ?? 0),
      stages, oppFys, oppMatrix: stages.map(s => oppFys.map(fy => oMap.get(`${s}|${fy}`) ?? null)),
    };
    return shell(<OemReview d={data} />, c0.legal_name, `${c0.code} · OEM · FY ${FYS[0]} to ${FYS[FYS.length - 1]} · live data`);
  }

  // TSM roster = users with tours.
  const reps = await q<SelRep[]>(async () => (await risansiPool.query<SelRep>(
    `SELECT DISTINCT u.id::text AS id, u.name FROM users u
       JOIN tour_assignments ta ON ta.rep_id = u.id
      WHERE u.role IN ('rep','manager') ORDER BY u.name`)).rows, []);

  const tsm = (sp.tsm && reps.some(r => r.id === sp.tsm)) ? sp.tsm : (reps[0]?.id ?? '');
  const tsmName = reps.find(r => r.id === tsm)?.name ?? '—';

  // Month selection → the report scopes to exactly the month(s) chosen (not a
  // cumulative FY-to-date). Accept a multi-value `months` param (comma-joined
  // YYYY-MM); fall back to the legacy single `month`, then the current month.
  // Every value is validated against YYYY-MM so it is safe to inline in SQL.
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rawMonths = (sp.months ?? sp.month ?? '').split(',').map(s => s.trim()).filter(Boolean);
  let selMonths = [...new Set(rawMonths.filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)))].sort();
  if (selMonths.length === 0) selMonths = [curMonth];

  // FY-comparison tables anchor on the latest selected month's fiscal year.
  const latest = selMonths[selMonths.length - 1];
  const selY = Number(latest.slice(0, 4));
  const selM = Number(latest.slice(5, 7));
  const fy = selM >= 4 ? selY : selY - 1;            // FY start year (anchor)
  const d = (y: number, m = 4) => `${y}-${String(m).padStart(2, '0')}-01`;
  const w5from = d(fy - 5), w5to = d(fy);            // 5 completed FYs before the anchor FY
  const monLabel = (m: string) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  // Safe SQL fragments built only from the validated month list.
  const qMonths     = selMonths.map(m => `'${m}'`).join(',');                              // '2026-07','2026-06'
  const monthNumSql = [...new Set(selMonths.map(m => Number(m.slice(5, 7))))].join(',');   // 6,7
  const inMonths    = (col: string) => `to_char(${col},'YYYY-MM') IN (${qMonths})`;

  const tourF = tsm ? `c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${Number(tsm)})` : 'FALSE';

  const [clients, turnover, quotation, offers, attendance, kpiRow, monthRows] = await Promise.all([
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
           COALESCE(sum(r.total_value) FILTER (WHERE EXTRACT(MONTH FROM r.month) IN (${monthNumSql}) AND r.month >= '${d(fy)}'     AND r.month < '${d(fy + 1)}'),0) fyc,
           COALESCE(sum(r.total_value) FILTER (WHERE EXTRACT(MONTH FROM r.month) IN (${monthNumSql}) AND r.month >= '${d(fy - 1)}' AND r.month < '${d(fy)}'),0)     f1,
           COALESCE(sum(r.total_value) FILTER (WHERE EXTRACT(MONTH FROM r.month) IN (${monthNumSql}) AND r.month >= '${d(fy - 2)}' AND r.month < '${d(fy - 1)}'),0) f2,
           COALESCE(sum(r.total_value) FILTER (WHERE EXTRACT(MONTH FROM r.month) IN (${monthNumSql}) AND r.month >= '${d(fy - 3)}' AND r.month < '${d(fy - 2)}'),0) f3
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
         FROM opportunities o JOIN clients c ON c.id=o.client_id
        WHERE ${tourF} AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')} GROUP BY 1`)).rows, []),

    // 4. Offer Status — mapped from stage
    q(async () => (await risansiPool.query<{ stage: string; val: string }>(
      `SELECT o.stage, round(sum(o.offer_value_inr))::text val
         FROM opportunities o JOIN clients c ON c.id=o.client_id
        WHERE ${tourF} AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')} GROUP BY 1`)).rows, []),

    // 5. Attendance — the rep's field visits, per selected month
    q(async () => (await risansiPool.query<{ mon: string; days: string; clients: string }>(
      `SELECT to_char(visit_date,'YYYY-MM') mon, count(distinct visit_date)::text days, count(distinct client_id)::text clients
         FROM visits WHERE rep_id = ${Number(tsm) || 0} AND ${inMonths('visit_date')}
        GROUP BY 1 ORDER BY 1`)).rows, []),

    // 6. KPIs — value metrics scope to the selected month(s); Total Leads and
    //    Active Clients are current-portfolio snapshots (they don't move with
    //    the month). Leads Visited counts leads visited within the period.
    q(async () => (await risansiPool.query<{ total_business: string; revenue: string; leads: string; visited: string; active_clients: string }>(
      `SELECT
         (SELECT COALESCE(round(sum(o.offer_value_inr)),0) FROM opportunities o JOIN clients c ON c.id=o.client_id
           WHERE ${tourF} AND o.stage='Won' AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')})::text AS total_business,
         (SELECT COALESCE(round(sum(r.total_value)),0) FROM client_revenue_monthly r JOIN clients c ON c.id = r.client_id
           WHERE ${tourF} AND ${inMonths('r.month')})::text AS revenue,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE' AND c.deleted_at IS NULL)::text AS leads,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE' AND c.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM visits v WHERE v.client_id = c.id AND ${inMonths('v.visit_date')}))::text AS visited,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL)::text AS active_clients`)).rows[0], null),

    // 7. Month options for the picker — every month that has any data, newest
    //    first; the current + selected months are ensured client-side.
    q(async () => (await risansiPool.query<{ ym: string }>(
      `SELECT to_char(m, 'YYYY-MM') AS ym FROM (
         SELECT month::date AS m FROM client_revenue_monthly
         UNION SELECT visit_date FROM visits
         UNION SELECT COALESCE(quote_date, created_at::date) FROM opportunities
       ) t WHERE m IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 120`)).rows, []),
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
      { label: 'Order in Hand', value: fmtMoney(n(kpiRow?.total_business)), sub: 'won opportunities · not yet invoiced', accent: true },
      { label: 'Revenue', value: fmtMoney(n(kpiRow?.revenue)), sub: 'invoiced · selected month(s)' },
      { label: 'Active Clients', value: (kpiRow ? Number(kpiRow.active_clients) : 0).toLocaleString('en-IN') },
      { label: 'Total Leads', value: (kpiRow ? Number(kpiRow.leads) : 0).toLocaleString('en-IN'), sub: 'prospective on tour' },
      { label: 'Leads Visited', value: (kpiRow ? Number(kpiRow.visited) : 0).toLocaleString('en-IN') },
    ],
  };

  // Picker options: every month with data, plus the current and selected
  // months, newest first — so a chosen month always appears even with no data.
  const monthOptions = [...new Set([curMonth, ...selMonths, ...monthRows.map(r => r.ym)])]
    .sort().reverse()
    .map(ym => ({ value: ym, label: monLabel(ym) }));

  const periodText = selMonths.length === 1
    ? monLabel(selMonths[0])
    : selMonths.length <= 3
      ? selMonths.map(monLabel).join(', ')
      : `${selMonths.length} months (${monLabel(selMonths[0])} – ${monLabel(latest)})`;
  const periodLabel = `${tsmName} · ${periodText}`;
  const note = 'Live data, scoped to the selected month(s). "Order in Hand" / "Order Received" are the value of Won opportunities dated in the period — order booked, not billed (₹0 until deals are marked Won). "Revenue" is invoiced revenue for the period. Turnover columns compare the same month(s) across fiscal years. Clients, Total Leads and Active Clients are current-portfolio counts and don\'t move with the month. "Hold-Active" and lead conversions are pending.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <ExecutiveViews
          data={data}
          periodLabel={periodLabel}
          note={note}
          selector={<div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ViewSwitch />
            <ExecutiveSelector reps={reps} tsm={tsm} monthOptions={monthOptions} selectedMonths={selMonths} />
          </div>}
        />
      </div>
    </div>
  );
}
