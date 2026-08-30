import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getCurrentUser, getReviewableRepIds, clientVisibilitySql, clientScopeSql , OWN_OPEN } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { ExecutiveViews, type ExecData, type Row } from '@/components/risansi/ExecutiveViews';
import { ExecutiveSelector, type SelRep } from '@/components/risansi/ExecutiveSelector';
import { AccountSelector, ViewSwitch, type NameOpt } from '@/components/risansi/AccountSelector';
import { GroupReview, OemReview, type GroupReviewData, type GroupUnit, type OemReviewData } from '@/components/risansi/AccountReview';
import { CLIENT_STATUS_COLORS } from '@/lib/risansi-client-status';

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
  searchParams: Promise<{ tsm?: string; month?: string; months?: string; view?: string; ctype?: string; name?: string; tview?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const sp = await searchParams;

  // Open to every signed-in role, scoped server-side. `allowedRepIds` is null
  // for admin/sysadmin (no restriction), otherwise the exact set of TSMs this
  // user may review; `clientVis` is the matching predicate for the Account
  // Review side. Both the tsm and name params are validated against the scoped
  // option lists below, so a hand-typed id can never widen access.
  const me = await getCurrentUser();
  const allowedRepIds = await getReviewableRepIds(me);
  const clientVis = clientVisibilitySql(me, 'c');
  const visAnd = clientVis ? ` AND (${clientVis})` : '';

  // ── Account Review: a group of mills, or a single OEM ──────────
  if (sp.view === 'account') {
    const ctype: 'group' | 'oem' = sp.ctype === 'oem' ? 'oem' : 'group';
    const nowD = new Date();
    const curFy = (nowD.getMonth() + 1) >= 4 ? nowD.getFullYear() : nowD.getFullYear() - 1;
    const FYS = Array.from({ length: 5 }, (_, i) => fyLabel(curFy - 4 + i));

    // Scoped to the accounts this user may see: a rep only gets the groups/OEMs
    // among their own clients, a manager theirs, admins everything. The unit
    // counts in the labels reflect the same scope.
    const options = await q<NameOpt[]>(async () => (await risansiPool.query<NameOpt>(
      ctype === 'group'
        ? `SELECT c.group_name AS value, c.group_name || ' (' || count(*) || ' units)' AS label
             FROM clients c
            WHERE c.group_name IS NOT NULL AND btrim(c.group_name) <> '' AND c.deleted_at IS NULL${visAnd}
            GROUP BY c.group_name ORDER BY c.group_name`
        : `SELECT c.code AS value, c.legal_name AS label FROM clients c
            WHERE c.client_type = 'OEM' AND c.deleted_at IS NULL${visAnd} ORDER BY c.legal_name`)).rows, []);
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

    if (!picked) return shell(
      <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
        No {ctype === 'group' ? 'groups' : 'OEM clients'} {clientVis ? 'among your accounts' : 'on record'}.
      </div>, 'Account Review', '—');

    // ── Group of mills ──
    if (ctype === 'group') {
      // Units are scoped too, so a viewer who can see part of a group sees that
      // part's figures rather than the whole group's.
      const units = await q<{ id: string; code: string; legal_name: string; tcd: number | null }[]>(async () => (await risansiPool.query(
        `SELECT c.id::text, c.code, c.legal_name, c.tcd FROM clients c
          WHERE c.group_name = $1 AND c.deleted_at IS NULL${visAnd} ORDER BY c.legal_name`, [picked])).rows, []);
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
      `SELECT c.id::text, c.code, c.legal_name FROM clients c
        WHERE c.code = $1 AND c.deleted_at IS NULL${visAnd} LIMIT 1`, [picked])).rows, []);
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

  // TSM roster. Admins get every user who has tours; everyone else gets exactly
  // the ids getReviewableRepIds allowed — selected by id rather than through the
  // tour join, so a rep with no tour assignment still lands on their own
  // (empty) review instead of a blank page.
  const reps = await q<SelRep[]>(async () => {
    if (allowedRepIds === null) {
      return (await risansiPool.query<SelRep>(
        `SELECT DISTINCT u.id::text AS id, u.name FROM users u
           JOIN tour_assignments ta ON ta.rep_id = u.id
          WHERE u.role IN ('rep','manager') ORDER BY u.name`)).rows;
    }
    if (allowedRepIds.length === 0) return [];
    return (await risansiPool.query<SelRep>(
      `SELECT u.id::text AS id, u.name FROM users u
        WHERE u.id = ANY($1::int[]) AND u.role IN ('rep','manager') ORDER BY u.name`,
      [allowedRepIds])).rows;
  }, []);

  const tsm = (sp.tsm && reps.some(r => r.id === sp.tsm)) ? sp.tsm : (reps[0]?.id ?? '');
  const tsmName = reps.find(r => r.id === tsm)?.name ?? '—';

  // KPI numbers below link through to the clients list, scoped to this same TSM
  // (via the "rep" filter, which matches tour_assignments the same way `tourF`
  // does) plus whatever status/visit filter the clicked number represents.
  const clientsLink = (params: Record<string, string>): string => {
    const p = tsmName !== '—' ? { ...params, rep: tsmName } : params;
    const qs = new URLSearchParams(p).toString();
    return `/risansi/clients${qs ? `?${qs}` : ''}`;
  };

  // The review is scoped to the current fiscal year to date (Apr→Mar) — there is
  // no month picker any more. selMonths is every month of the current FY up to
  // now, so the month-scoped sections (revenue, quotation, offers, attendance,
  // leads) show the FY so far, while turnover spans full FYs below. Every value
  // is YYYY-MM so it is safe to inline in SQL.
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const selMonths: string[] = [];
  for (
    let dcur = new Date(fyStartYear, 3, 1);
    dcur <= new Date(now.getFullYear(), now.getMonth(), 1);
    dcur = new Date(dcur.getFullYear(), dcur.getMonth() + 1, 1)
  ) {
    selMonths.push(`${dcur.getFullYear()}-${String(dcur.getMonth() + 1).padStart(2, '0')}`);
  }

  // FY-comparison tables anchor on the latest selected month's fiscal year.
  const latest = selMonths[selMonths.length - 1];
  const selY = Number(latest.slice(0, 4));
  const selM = Number(latest.slice(5, 7));
  const fy = selM >= 4 ? selY : selY - 1;            // FY start year (anchor)
  const d = (y: number, m = 4) => `${y}-${String(m).padStart(2, '0')}-01`;
  const w5from = d(fy - 5), w5to = d(fy);            // 5 completed FYs before the anchor FY

  // Safe SQL fragments built only from the validated month list.
  const qMonths     = selMonths.map(m => `'${m}'`).join(',');                              // '2026-07','2026-06'
  const inMonths    = (col: string) => `to_char(${col},'YYYY-MM') IN (${qMonths})`;

  // Turnover always compares each whole fiscal year (Apr–Mar, to-date), so the
  // current FY shows its turnover so far — no month scoping, no toggle.
  const turnMonthFilter = '';

  // Scope every clients-keyed query to the SELECTED TSM's tours INTERSECTED with
  // the viewer's own visibility. The intersection matters: getReviewableRepIds
  // only needs ONE shared tour to make a rep reviewable, and that rep may work
  // other tours the viewer has no access to — without visAnd a manager would
  // read those tours here while seeing nothing of them anywhere else in the app
  // (the Client 360 drill-through links below intersect correctly, so the counts
  // would also disagree). No-op for admins (visAnd = '') and for a rep viewing
  // themselves (their tours are already a subset of their own visibility).
  const tourF = tsm
    ? `(c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${Number(tsm)})${visAnd})`
    : 'FALSE';

  // Attendance counts visits by rep and never touches `clients`, so tourF can't
  // scope it — restrict it by the viewer's client scope on the visit's client.
  // Exempt viewing yourself: your own attendance is your own activity record, and
  // scoping it would silently drop past visits to clients that have since moved
  // off your tour.
  const isSelfReview  = me.id != null && String(me.id) === String(tsm);
  const visitScope    = isSelfReview ? null : clientScopeSql(me, 'v.client_id', OWN_OPEN.visit('v'));
  const visitScopeAnd = visitScope ? ` AND (${visitScope})` : '';

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
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy)}'     AND r.month < '${d(fy + 1)}'),0) fyc,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy - 1)}' AND r.month < '${d(fy)}'),0)     f1,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy - 2)}' AND r.month < '${d(fy - 1)}'),0) f2,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy - 3)}' AND r.month < '${d(fy - 2)}'),0) f3
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
      `SELECT to_char(v.visit_date,'YYYY-MM') mon, count(distinct v.visit_date)::text days, count(distinct v.client_id)::text clients
         FROM visits v WHERE v.rep_id = ${Number(tsm) || 0} AND ${inMonths('v.visit_date')}${visitScopeAnd}
        GROUP BY 1 ORDER BY 1`)).rows, []),

    // 6. KPIs — value metrics scope to the selected month(s); the client-count
    //    metrics are current-portfolio snapshots (they don't move with the
    //    month). "Visited" everywhere below means last_visit_date within the
    //    last 90 days — the same convention as the Field page/dashboard —
    //    rather than the FY-to-date window the value metrics use. Active-client
    //    visited/overdue/never are mutually exclusive (sum to active_clients);
    //    "overdue" here excludes never-visited, unlike the Field page's own
    //    "Overdue" tab which folds them together.
    q(async () => (await risansiPool.query<{
      total_business: string; revenue: string; active_clients: string;
      active_visited: string; active_overdue: string; active_never: string;
      prospective: string; prospective_visited: string;
      prospective_lead: string; prospective_client: string;
    }>(
      `SELECT
         (SELECT COALESCE(round(sum(GREATEST(
                   COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
                   - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so WHERE so.opportunity_id=o.id), 0)
                 , 0))),0) FROM opportunities o JOIN clients c ON c.id=o.client_id
           WHERE ${tourF} AND o.stage='Won' AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')})::text AS total_business,
         (SELECT COALESCE(round(sum(r.total_value)),0) FROM client_revenue_monthly r JOIN clients c ON c.id = r.client_id
           WHERE ${tourF} AND ${inMonths('r.month')})::text AS revenue,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL)::text AS active_clients,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL
            AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS active_visited,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL
            AND c.last_visit_date IS NOT NULL AND c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')::text AS active_overdue,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL
            AND c.last_visit_date IS NULL)::text AS active_never,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT') AND c.deleted_at IS NULL)::text AS prospective,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT') AND c.deleted_at IS NULL
            AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS prospective_visited,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE_LEAD' AND c.deleted_at IS NULL)::text AS prospective_lead,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE_CLIENT' AND c.deleted_at IS NULL)::text AS prospective_client`)).rows[0], null),
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
      { label: 'Order in Hand', value: fmtMoney(n(kpiRow?.total_business)), sub: 'won · not yet in a sales order', accent: true },
      { label: 'Revenue', value: fmtMoney(n(kpiRow?.revenue)), sub: 'invoiced · FY to date' },
      {
        label: 'Active Clients',
        value: (kpiRow ? Number(kpiRow.active_clients) : 0).toLocaleString('en-IN'),
        href: clientsLink({ status: 'ACTIVE' }),
        lines: [
          { label: 'Visited (≤90d)', value: (kpiRow ? Number(kpiRow.active_visited) : 0).toLocaleString('en-IN'),
            color: 'var(--pos)', href: clientsLink({ status: 'ACTIVE', visit: 'visited' }) },
          { label: 'Overdue (90d+)', value: (kpiRow ? Number(kpiRow.active_overdue) : 0).toLocaleString('en-IN'),
            color: 'var(--warn)', href: clientsLink({ status: 'ACTIVE', visit: 'overdue' }) },
          { label: 'Never Visited', value: (kpiRow ? Number(kpiRow.active_never) : 0).toLocaleString('en-IN'),
            color: 'var(--neg)', href: clientsLink({ status: 'ACTIVE', visit: 'never' }) },
        ],
      },
      {
        label: 'Prospective',
        value: (kpiRow ? Number(kpiRow.prospective) : 0).toLocaleString('en-IN'),
        href: clientsLink({ status: 'PROSPECTIVE_LEAD,PROSPECTIVE_CLIENT' }),
        lines: [
          { label: 'Visited (≤90d)', value: (kpiRow ? Number(kpiRow.prospective_visited) : 0).toLocaleString('en-IN'),
            color: 'var(--pos)', href: clientsLink({ status: 'PROSPECTIVE_LEAD,PROSPECTIVE_CLIENT', visit: 'visited' }) },
          { label: 'Prospective-Lead', value: (kpiRow ? Number(kpiRow.prospective_lead) : 0).toLocaleString('en-IN'),
            color: CLIENT_STATUS_COLORS.PROSPECTIVE_LEAD[0], href: clientsLink({ status: 'PROSPECTIVE_LEAD' }) },
          { label: 'Prospective-Client', value: (kpiRow ? Number(kpiRow.prospective_client) : 0).toLocaleString('en-IN'),
            color: CLIENT_STATUS_COLORS.PROSPECTIVE_CLIENT[0], href: clientsLink({ status: 'PROSPECTIVE_CLIENT' }) },
        ],
      },
    ],
  };

  // Reached when the signed-in user has no linked rep profile at all (a manager
  // or rep with no tours still gets their own, empty, review). Say so rather
  // than render an unexplained page of zeros.
  if (reps.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>Executive Review</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 10, maxWidth: 560, lineHeight: 1.6 }}>
            Your account isn&apos;t linked to a rep profile, so there is no review to show.
            Ask a system admin to link it under Users &amp; Access.
          </p>
        </div>
      </div>
    );
  }

  const periodText  = `FY ${yy(fy)} to date`;
  const periodLabel = `${tsmName} · ${periodText}`;

  const note = `Live data for ${tsmName}'s current fiscal year (Apr–Mar) to date. "Order in Hand" is the value of Won opportunities not yet turned into a Sales Order; "Order Received" is the value of Won opportunities dated in the FY. "Revenue" is invoiced revenue for the FY to date. Turnover columns show each whole fiscal year to date, so the current FY reflects its turnover so far. Clients, Prospective and Active Clients are current-portfolio counts; "Visited" on those two cards means a visit logged within the last 90 days, and every number is clickable through to a filtered client list.`;

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
            <ExecutiveSelector reps={reps} tsm={tsm} />
          </div>}
        />
      </div>
    </div>
  );
}
