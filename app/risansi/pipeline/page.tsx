import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, MultiSelectFilter, ActiveFilterBar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql } from '@/lib/risansi-auth';
import { getCurrentFY, fmtCr, fmtUsdFromCr } from '@/lib/risansi-utils';
import { getUsdRate } from '@/lib/risansi-settings';
import { PROBABILITY_CODE_OPTIONS } from '@/lib/risansi-probability-codes';
import { NewOpportunityButton } from '@/components/risansi/NewOpportunityButton';
import { OpportunityKanban } from '@/components/risansi/OpportunityKanban';
import { ActiveOppsTable } from '@/components/risansi/ActiveOppsTable';
import { OpportunitiesTabs } from '@/components/risansi/OpportunitiesTabs';
import { TextSearchFilter } from '@/components/risansi/TextSearchFilter';
import { DateRangeFilter } from '@/components/risansi/DateRangeFilter';
import { ForecastBar } from '@/components/risansi/ForecastBar';
import { oppFilterQuery } from '@/lib/risansi-opp-filters';
import {
  bracketLink, soCoverageSql, isSoCoverage, SO_COVERAGE_LABELS,
} from '@/lib/risansi-pipeline-brackets';

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
  tour_name:           string | null;
  can_edit:            boolean;
  // Optional edit fields — may not exist on the table
  secondary_rep_id?:   number | null;
  quote_date?:         string | null;
  negotiation_notes?:  string | null;
  po_number?:          string | null;
  final_value_cr?:     string | number | null;
  lost_to_competitor?: string | null;
  lost_reason?:        string | null;
  drop_reason?:        string | null;
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
  const cyStart = fy.startDate;                                 // e.g. 2026-04-01
  const cyEnd   = `${Number(cyStart.slice(0, 4)) + 1}-04-01`;   // 2027-04-01 (exclusive)

  // ── Role / rep scoping ──────────────────────────────────────
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';

  // Prefer the session's linked rep_id; fall back to email lookup.
  let currentRepId: number | null = session?.user?.repId ?? null;
  if (role === 'rep' && currentRepId == null && session?.user?.email) {
    const repRes = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1',
      [session.user.email],
    );
    currentRepId = repRes.rows[0]?.id ?? null;
  }
  // Rep sees own by default; manager/admin sees all; ?rep=all overrides for reps
  const showAll = sp.rep === 'all' || role !== 'rep';

  // Multi-select filters
  const stageFilts    = typeof sp.stage        === 'string' && sp.stage        ? sp.stage.split(',').filter(Boolean)        : [];
  const prodTypeFilts = typeof sp.product_type === 'string' && sp.product_type ? sp.product_type.split(',').filter(Boolean) : [];
  // NOTE: `rep` is also the scope-toggle param (?rep=all). Exclude the 'all'
  // sentinel here so the multi-select rep filter doesn't try to match a rep
  // literally named "all" (which returned zero results for "All Opportunities").
  const repFilts      = typeof sp.rep          === 'string' && sp.rep && sp.rep !== 'all' ? sp.rep.split(',').filter(Boolean)          : [];
  const indFilts      = typeof sp.industry     === 'string' && sp.industry     ? sp.industry.split(',').filter(Boolean)     : [];
  const ctypeFilts    = typeof sp.ctype        === 'string' && sp.ctype        ? sp.ctype.split(',').filter(Boolean)        : [];
  const probFilts     = typeof sp.prob         === 'string' && sp.prob         ? sp.prob.split(',').filter(Boolean)         : [];
  const valFilts      = typeof sp.val          === 'string' && sp.val          ? sp.val.split(',').filter(Boolean)          : [];
  // Sales-Order coverage on a Won opportunity — the slice behind the two Won
  // brackets in the flow strip, set by clicking them. Not a multi-select: the
  // two states overlap (an opp part-covered by an SO is in both), so ORing them
  // would just mean "every Won" and read as a filter that does nothing.
  //   awaiting → some of the won value has no SO against it yet (ΣSO < final)
  //   created  → an SO exists (ΣSO > 0)
  const soFilt = isSoCoverage(sp.so) ? sp.so : '';
  // Quote tracking: free-text (quote no. / client / product) + quote-date range.
  const qname = typeof sp.qname === 'string' ? sp.qname.trim() : '';
  const qfrom = typeof sp.qfrom === 'string' ? sp.qfrom : '';
  const qto   = typeof sp.qto   === 'string' ? sp.qto   : '';

  // Value buckets (on value_cr, in Crores). Boundaries are constants we control,
  // so they inline safely (no params). Selecting several ORs their ranges.
  const VALUE_BUCKETS: { label: string; min: number; max: number | null }[] = [
    { label: '< ₹1L',    min: 0,    max: 0.01 },
    { label: '₹1–5L',    min: 0.01, max: 0.05 },
    { label: '₹5–10L',   min: 0.05, max: 0.10 },
    { label: '₹10–50L',  min: 0.10, max: 0.50 },
    { label: '₹50L–1Cr', min: 0.50, max: 1.0 },
    { label: '≥ ₹1Cr',   min: 1.0,  max: null },
  ];
  const valueRangeSql = (col: string, labels: string[]): string => {
    const parts = labels
      .map(l => VALUE_BUCKETS.find(b => b.label === l))
      .filter((b): b is { label: string; min: number; max: number | null } => !!b)
      .map(b => (b.max == null ? `${col} >= ${b.min}` : `(${col} >= ${b.min} AND ${col} < ${b.max})`));
    return parts.length ? `(${parts.join(' OR ')})` : '';
  };

  // Sort
  const sortKey  = typeof sp.sort  === 'string' ? sp.sort            : 'value';
  const orderDir = sp.dir === 'desc'            ? 'DESC'             : 'DESC'; // default value DESC
  const sortCol  = SORT_MAP[sortKey] ?? 'o.value_cr';

  // Build shared filter conditions (rep scope + multi-select filters).
  // The stage split (open vs Won/Lost) is applied per-query below.
  const conds: string[] = [];
  const vals: (string | number | string[])[] = [];
  let idx = 1;

  // Rep scoping — limit to own opportunities unless showing all. An explicit
  // rep selection overrides this default rather than ANDing with it: a rep who
  // picks a colleague means "show me theirs", and ANDing the two gave an
  // unexplained empty board. Visibility is still bounded by ownerVis below.
  const scopedRepId = !showAll && repFilts.length === 0 ? currentRepId : null;
  if (scopedRepId != null) {
    // Tour-based attribution: a rep owns the opportunities of the clients on
    // their tour(s), not a per-opportunity rep_id — PLUS any client granted to
    // them by special access. (Matches the revenue scope and ownerVis below.)
    conds.push(`(c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $${idx})
                 OR c.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = $${idx}))`);
    vals.push(scopedRepId); idx++;
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
    // Picking a rep shows the opportunities of clients on that rep's tour(s),
    // not opps stored against that rep — a tour can have several reps.
    conds.push(`EXISTS (SELECT 1 FROM tour_assignments ta JOIN users u2 ON u2.id = ta.rep_id
                          WHERE ta.tour_id = c.tour_id AND u2.name = ANY($${idx}::text[]))`);
    vals.push(repFilts); idx++;
  }
  if (indFilts.length > 0) {
    conds.push(`c.industry = ANY($${idx}::text[])`);
    vals.push(indFilts); idx++;
  }
  if (ctypeFilts.length > 0) {
    conds.push(`c.client_type = ANY($${idx}::text[])`);
    vals.push(ctypeFilts); idx++;
  }
  if (probFilts.length > 0) {
    conds.push(`o.probability_code = ANY($${idx}::text[])`);
    vals.push(probFilts); idx++;
  }
  if (valFilts.length > 0) {
    const vsql = valueRangeSql('o.value_cr', valFilts);
    if (vsql) conds.push(vsql);
  }
  // SO coverage. soFilt is a validated enum and the thresholds are constants, so
  // this inlines safely and leaves every $-index untouched.
  if (soCoverageSql(soFilt, 'o')) conds.push(soCoverageSql(soFilt, 'o'));
  // Track a quote by its number/name (also matches client & product), and by
  // when it was quoted.
  if (qname) {
    conds.push(`(o.quote_ref ILIKE $${idx} OR c.legal_name ILIKE $${idx} OR o.product ILIKE $${idx})`);
    vals.push(`%${qname}%`); idx++;
  }
  if (qfrom) { conds.push(`o.quote_date >= $${idx}`); vals.push(qfrom); idx++; }
  if (qto)   { conds.push(`o.quote_date <= $${idx}`); vals.push(qto);   idx++; }

  // Per-user owner visibility — null for admin/sysadmin (no restriction).
  // Appended as raw text (integers inlined, no params) so $-indices are unchanged.
  const visUser     = await getCurrentUser();
  const ownerVis    = clientScopeSql(visUser, 'o.client_id');
  const ownerVisAnd = ownerVis ? ` AND (${ownerVis})` : '';
  const ownerVisPo  = clientScopeSql(visUser, 'po.client_id');
  const ownerVisPoAnd = ownerVisPo ? ` AND (${ownerVisPo})` : '';
  const ownerVisBare  = clientScopeSql(visUser, 'client_id');
  const ownerVisBareAnd = ownerVisBare ? ` AND (${ownerVisBare})` : '';
  const ownerVisCId   = clientScopeSql(visUser, 'c.id');
  const ownerVisCIdAnd = ownerVisCId ? ` AND (${ownerVisCId})` : '';

  const filterClause = (conds.length ? ` AND ${conds.join(' AND ')}` : '') + ownerVisAnd;

  // Booked comes from actual revenue, which is client-scoped — so it needs its
  // own predicate. Only the client-level filters carry over; stage and product
  // type don't exist on a revenue row. Without this the Booked tile ignored
  // every filter while the other tiles responded.
  const revConds: string[] = [];
  const revVals: (string | number | string[])[] = [];
  let rIdx = 1;
  if (scopedRepId != null) {
    revConds.push(`(c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $${rIdx})
                    OR c.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = $${rIdx}))`);
    revVals.push(scopedRepId); rIdx++;
  }
  if (repFilts.length > 0) {
    revConds.push(`EXISTS (SELECT 1 FROM tour_assignments ta JOIN users u2 ON u2.id = ta.rep_id
                            WHERE ta.tour_id = c.tour_id AND u2.name = ANY($${rIdx}::text[]))`);
    revVals.push(repFilts); rIdx++;
  }
  if (indFilts.length > 0) {
    revConds.push(`c.industry = ANY($${rIdx}::text[])`);
    revVals.push(indFilts); rIdx++;
  }
  if (ctypeFilts.length > 0) {
    revConds.push(`c.client_type = ANY($${rIdx}::text[])`);
    revVals.push(ctypeFilts); rIdx++;
  }
  const revFilterClause = (revConds.length ? ` AND ${revConds.join(' AND ')}` : '') + ownerVisCIdAnd;

  // Win Rate and Lost-To used to interpolate only the visibility scope, never
  // the filters — so they sat inert while every other tile responded. Only the
  // Win/Loss query joins clients (for industry); Lost-To joins nothing. Writing
  // these as subqueries against the opportunity row keeps one builder valid for
  // both call sites regardless of what each has in scope.
  //
  // Two deliberate omissions. Stage: both panels are defined over Won/Lost, so
  // a stage selection would empty them rather than narrow them. Self-scope:
  // these are analytics over everything the user can SEE, not over what they
  // personally own — applying it cut one rep's win-rate sample from 165 to 27,
  // because most historic Won rows still sit on the house account.
  const analyticsFilter = (a: string) => {
    const c: string[] = [];
    const v: (string | number | string[])[] = [];
    if (prodTypeFilts.length)   { c.push(`${a}.product_type = ANY($${v.length + 1}::text[])`);                                 v.push(prodTypeFilts); }
    if (repFilts.length)        { c.push(`${a}.client_id IN (SELECT c2.id FROM clients c2 JOIN tour_assignments ta ON ta.tour_id = c2.tour_id JOIN users u2 ON u2.id = ta.rep_id WHERE u2.name = ANY($${v.length + 1}::text[]))`);  v.push(repFilts); }
    if (indFilts.length)        { c.push(`${a}.client_id IN (SELECT id FROM clients WHERE industry = ANY($${v.length + 1}::text[]))`); v.push(indFilts); }
    if (ctypeFilts.length)      { c.push(`${a}.client_id IN (SELECT id FROM clients WHERE client_type = ANY($${v.length + 1}::text[]))`); v.push(ctypeFilts); }
    if (probFilts.length)       { c.push(`${a}.probability_code = ANY($${v.length + 1}::text[])`);                             v.push(probFilts); }
    return { clause: c.length ? ` AND ${c.join(' AND ')}` : '', vals: v as (string | number)[] };
  };
  const wlFilter   = analyticsFilter('po');
  const lostFilter = analyticsFilter('o');
  // Dropped is terminal (client-cancelled) — excluded from open pipeline, shown
  // in the kanban alongside Won/Lost via the closed query.
  const openWhere   = `WHERE o.stage NOT IN ('Won', 'Lost', 'Dropped')${filterClause}`;
  const closedWhere = `WHERE o.stage IN ('Won', 'Lost', 'Dropped') AND o.updated_at >= NOW() - INTERVAL '12 months'${filterClause}`;

  // The closed set is capped so the kanban's Won/Lost columns stay cheap on the
  // default board. But once the user has explicitly asked for a closed stage —
  // by picking it in the Stage filter, or by clicking a Won bracket in the flow
  // strip — the cap turns the answer into a lie: 865 opportunities are awaiting
  // an SO, and a 200-row table under a tile reading 865 is just wrong. Raise it
  // for that case only.
  const CLOSED_STAGES_SEL = ['Won', 'Lost', 'Dropped'];
  const wantsClosed  = soFilt !== '' || stageFilts.some(s => CLOSED_STAGES_SEL.includes(s));
  const closedLimit  = wantsClosed ? 3000 : 200;

  // Snapshot of just the filter params, taken before the CAN_EDIT params are
  // pushed below — reused by the stage-totals query, which has no CAN_EDIT clause.
  const filterVals = [...vals];

  // Won KPI predicate. The Won tile is the true total of Won opportunities in
  // scope, and its own predicate rather than filterClause: a Stage filter must
  // not zero it, and it must be uncapped — the kanban's closed-card query is
  // limited to 200 rows, which is why that column reads far below the truth.
  const wonC: string[] = ["o.stage = 'Won'"];
  const wonV: (string | number | string[])[] = [];
  if (scopedRepId != null)  { wonC.push(`(o.client_id IN (SELECT c2.id FROM clients c2 JOIN tour_assignments ta ON ta.tour_id = c2.tour_id WHERE ta.rep_id = $${wonV.length + 1}) OR o.client_id IN (SELECT client_id FROM client_rep_access WHERE rep_id = $${wonV.length + 1}))`); wonV.push(scopedRepId); }
  if (prodTypeFilts.length) { wonC.push(`o.product_type = ANY($${wonV.length + 1}::text[])`);                                wonV.push(prodTypeFilts); }
  if (repFilts.length)      { wonC.push(`o.client_id IN (SELECT c2.id FROM clients c2 JOIN tour_assignments ta ON ta.tour_id = c2.tour_id JOIN users u2 ON u2.id = ta.rep_id WHERE u2.name = ANY($${wonV.length + 1}::text[]))`); wonV.push(repFilts); }
  if (indFilts.length)      { wonC.push(`o.client_id IN (SELECT id FROM clients WHERE industry = ANY($${wonV.length + 1}::text[]))`); wonV.push(indFilts); }
  if (ctypeFilts.length)    { wonC.push(`o.client_id IN (SELECT id FROM clients WHERE client_type = ANY($${wonV.length + 1}::text[]))`); wonV.push(ctypeFilts); }
  if (probFilts.length)     { wonC.push(`o.probability_code = ANY($${wonV.length + 1}::text[])`);                            wonV.push(probFilts); }
  if (valFilts.length)      { const v = valueRangeSql('o.value_cr', valFilts); if (v) wonC.push(v); }
  if (soCoverageSql(soFilt, 'o')) { wonC.push(soCoverageSql(soFilt, 'o')); }
  const wonWhere = `WHERE ${wonC.join(' AND ')}${ownerVisAnd}`;

  // Per-opportunity edit permission, evaluated in SQL:
  //   admin/sysadmin → all · assigned rep → own · manager → reps sharing a tour.
  // Params are appended AFTER the filter args so the filter $-indices are unchanged.
  const ceRoleIdx = vals.length + 1;
  const ceRepIdx  = vals.length + 2;
  vals.push(role, currentRepId ?? 0);
  // Tour-based: an opportunity belongs to the client's tour, so anyone on that
  // tour (or with special access, or admin) can edit it — matches userCanEditOpp.
  const CAN_EDIT_CASE = `
        CASE
          WHEN $${ceRoleIdx} IN ('admin','sysadmin') THEN TRUE
          WHEN o.rep_id = $${ceRepIdx} THEN TRUE
          WHEN EXISTS (SELECT 1 FROM tour_assignments ta WHERE ta.tour_id = c.tour_id AND ta.rep_id = $${ceRepIdx}) THEN TRUE
          WHEN EXISTS (SELECT 1 FROM client_rep_access cra WHERE cra.client_id = c.id AND cra.rep_id = $${ceRepIdx}) THEN TRUE
          ELSE FALSE
        END AS can_edit`;

  const [openOpps, closedOpps, bookedYTD, annualTarget, winLossRows, lostToRows, stageOptions, productTypeOptions, repOptions, industryOptions, clientTypeOptions, wonTotal, orderInHand, orderBooked, stageTotals, usdRate] = await Promise.all([

    // 1. Open opportunities with filters + sort. Feeds the KPIs, the kanban (every
    //    open card must show), and the Active Opportunities table — so NO row cap
    //    here, or low-value cards drop off the board and the KPI counts undercount.
    //    The table slices to 50 itself. SELECT o.* keeps this resilient to which
    //    optional columns exist.
    q<OppRow[]>(async () => {
      const { rows } = await risansiPool.query(`
        SELECT o.*,
               -- Date columns as YYYY-MM-DD text (override the o.* raw dates,
               -- last-wins): a type="date" input can't read an ISO timestamp, and
               -- JS Date serialisation shifts the day by the server's timezone.
               o.quote_date::text          AS quote_date,
               o.enquiry_date::text        AS enquiry_date,
               o.revised_offer_date::text  AS revised_offer_date,
               o.expected_close_date::text AS expected_close_date,
               (SELECT COALESCE(SUM(so.so_value_cr), 0) FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id)::float8 AS so_sum_cr,
               (SELECT string_agg(u2.name || CASE WHEN ta2.role = 'manager' THEN ' (mgr)' ELSE '' END, ', ' ORDER BY (ta2.role = 'manager'), u2.name)
                  FROM tour_assignments ta2 JOIN users u2 ON u2.id = ta2.rep_id WHERE ta2.tour_id = c.tour_id) AS tour_people,
               c.legal_name AS client_name, c.code AS client_code, c.industry,
               COALESCE(r.name, '—') AS rep_name,
               (SELECT tr.name FROM tour_routes tr WHERE tr.id = c.tour_id) AS tour_name,
               ${CAN_EDIT_CASE}
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN users r ON r.id = o.rep_id
        ${openWhere}
        ORDER BY ${sortCol} ${orderDir} NULLS LAST
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
               -- Date columns as YYYY-MM-DD text (override the o.* raw dates,
               -- last-wins): a type="date" input can't read an ISO timestamp, and
               -- JS Date serialisation shifts the day by the server's timezone.
               o.quote_date::text          AS quote_date,
               o.enquiry_date::text        AS enquiry_date,
               o.revised_offer_date::text  AS revised_offer_date,
               o.expected_close_date::text AS expected_close_date,
               (SELECT COALESCE(SUM(so.so_value_cr), 0) FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id)::float8 AS so_sum_cr,
               (SELECT string_agg(u2.name || CASE WHEN ta2.role = 'manager' THEN ' (mgr)' ELSE '' END, ', ' ORDER BY (ta2.role = 'manager'), u2.name)
                  FROM tour_assignments ta2 JOIN users u2 ON u2.id = ta2.rep_id WHERE ta2.tour_id = c.tour_id) AS tour_people,
               c.legal_name AS client_name, c.code AS client_code, c.industry,
               COALESCE(r.name, '—') AS rep_name,
               (SELECT tr.name FROM tour_routes tr WHERE tr.id = c.tour_id) AS tour_name,
               ${CAN_EDIT_CASE}
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN users r ON r.id = o.rep_id
        ${closedWhere}
        ORDER BY o.updated_at DESC NULLS LAST
        LIMIT ${closedLimit}
      `, vals as (string | number)[]
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, value_cr: Number(row.value_cr ?? 0) };
      }) as unknown as OppRow[];
    }, []),

    // 2. Booked YTD — current FY, returned in Cr
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ booked_inr: string }>(
        `SELECT COALESCE(SUM(m.total_value), 0)::text AS booked_inr
         FROM client_revenue_monthly m
         JOIN clients c ON c.id = m.client_id
         WHERE m.month >= '${cyStart}' AND m.month < '${cyEnd}'${revFilterClause}`,
        revVals as (string | number)[],
      );
      return Number(rows[0]?.booked_inr ?? 0) / 10_000_000;
    }, 0),

    // 3. Annual target — sysadmin-editable app setting (Cr), fallback 32 Cr.
    //    Same source as the dashboard + Settings page (app_settings.annual_target_cr).
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ value: string }>(
        `SELECT value FROM app_settings WHERE key = 'annual_target_cr' LIMIT 1`,
      );
      const v = parseFloat(rows[0]?.value ?? '');
      return Number.isFinite(v) && v > 0 ? v : 32;
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
          AND po.updated_at >= NOW() - INTERVAL '12 months'${ownerVisPoAnd}${wlFilter.clause}
        GROUP BY c.industry
        ORDER BY (COUNT(*) FILTER (WHERE po.stage = 'Won') +
                  COUNT(*) FILTER (WHERE po.stage = 'Lost')) DESC
        LIMIT 6
      `, wlFilter.vals);
      return rows;
    }, []),

    // 5. Lost-to competitors
    q<LostToRow[]>(async () => {
      const { rows } = await risansiPool.query<{ competitor: string; opp_count: string; value: string }>(`
        SELECT COALESCE(o.lost_to_competitor, 'Others') AS competitor,
               COUNT(*)::text AS opp_count,
               COALESCE(SUM(o.value_cr), 0)::text AS value
        FROM opportunities o
        WHERE o.stage = 'Lost'
          AND o.updated_at >= NOW() - INTERVAL '12 months'${ownerVisAnd}${lostFilter.clause}
        GROUP BY COALESCE(o.lost_to_competitor, 'Others')
        ORDER BY SUM(o.value_cr) DESC NULLS LAST
        LIMIT 5
      `, lostFilter.vals);
      return rows.map(r => ({ ...r, value: Number(r.value) }));
    }, []),

    // 6. Filter options. Stage is the full pipeline, every column on the board —
    //    not just the open stages that happen to have data — so a rep can filter
    //    to Won / Lost / Dropped too.
    Promise.resolve(['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped']),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ product_type: string }>(
        `SELECT DISTINCT product_type FROM opportunities WHERE product_type IS NOT NULL${ownerVisBareAnd} ORDER BY product_type`,
      );
      return rows.map(r => r.product_type);
    }, []),

    q<string[]>(async () => {
      // Reps that belong to at least one tour — the rep filter is tour-based, so
      // a rep with no tour would match no clients and never surface anything.
      const { rows } = await risansiPool.query<{ name: string }>(
        `SELECT DISTINCT u.name FROM users u
           JOIN tour_assignments ta ON ta.rep_id = u.id
          WHERE u.is_active = TRUE ORDER BY u.name`,
      );
      return rows.map(r => r.name);
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string }>(
        `SELECT DISTINCT c.industry FROM clients c WHERE c.industry IS NOT NULL${ownerVisCIdAnd} ORDER BY c.industry`,
      );
      return rows.map(r => r.industry);
    }, []),

    // Client-type options, derived from the data (so legacy values like
    // DIRECT MILL / TRADER stay filterable) and scoped to what the user can see.
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ client_type: string }>(
        `SELECT DISTINCT c.client_type FROM clients c
          WHERE c.client_type IS NOT NULL AND btrim(c.client_type) <> ''${ownerVisCIdAnd}
          ORDER BY c.client_type`,
      );
      return rows.map(r => r.client_type);
    }, []),

    // 7. Won total (Cr) — the real sum of Won opportunities in scope. value_cr is
    //    already in Crores, so SUM needs no conversion. Replaces sales-Booked as
    //    the realised base for every forecast figure below.
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ won_cr: string }>(
        `SELECT COALESCE(SUM(COALESCE(o.final_value_cr, o.value_cr, 0)), 0)::text AS won_cr FROM opportunities o ${wonWhere}`,
        wonV as (string | number)[],
      );
      return Number(rows[0]?.won_cr ?? 0);
    }, 0),

    // 7b. Order in Hand (Cr) — Won value not yet turned into a Sales Order:
    //     SUM over Won opps of max(final_value − Σ SO values, 0). Same scope as
    //     the Won total; uncapped for an honest figure.
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ oih_cr: string }>(
        `SELECT COALESCE(SUM(GREATEST(
                  COALESCE(o.final_value_cr, o.value_cr, 0)
                  - COALESCE((SELECT SUM(so.so_value_cr) FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id), 0)
                , 0)), 0)::text AS oih_cr
           FROM opportunities o ${wonWhere}`,
        wonV as (string | number)[],
      );
      return Number(rows[0]?.oih_cr ?? 0);
    }, 0),

    // 7c. Order Booked (Cr) — Won value already turned into Sales Orders: SUM of
    //     so_value_cr across the Won opps in scope. The filter-responsive companion
    //     to Order in Hand (booked + in-hand ≈ Won total, allowing over-delivery).
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ booked_cr: string }>(
        `SELECT COALESCE(SUM(
                  (SELECT COALESCE(SUM(so.so_value_cr), 0) FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id)
                ), 0)::text AS booked_cr
           FROM opportunities o ${wonWhere}`,
        wonV as (string | number)[],
      );
      return Number(rows[0]?.booked_cr ?? 0);
    }, 0),

    // 8. True per-stage totals + counts for the kanban headers, uncapped. The
    //    board caps closed cards at 200, so its columns undercount; these give
    //    the honest figure while the cards themselves stay capped for rendering.
    q<Record<string, { count: number; valueCr: number }>>(async () => {
      const { rows } = await risansiPool.query<{ stage: string; n: string; v: string }>(
        `SELECT o.stage, count(*)::text AS n, COALESCE(SUM(o.value_cr), 0)::text AS v
           FROM opportunities o
           JOIN clients c ON c.id = o.client_id
           LEFT JOIN users r ON r.id = o.rep_id
          WHERE (o.stage NOT IN ('Won','Lost','Dropped') OR o.updated_at >= NOW() - INTERVAL '12 months')${filterClause}
          GROUP BY o.stage`,
        filterVals as (string | number)[],
      );
      const m: Record<string, { count: number; valueCr: number }> = {};
      for (const r of rows) m[r.stage] = { count: Number(r.n), valueCr: Number(r.v) };
      return m;
    }, {}),

    // 9. USD→INR rate (company setting) for the ≈ $ figures on the tiles/table.
    getUsdRate(),
  ]);

  // ── Derived values ─────────────────────────────────────────

  const openTotal    = openOpps.reduce((s, o) => s + o.value_cr, 0);
  // The table shows the open pipeline by default. When the Stage filter selects a
  // closed stage (Won/Lost/Dropped) — which the open query structurally excludes —
  // fold in the matching closed opps so the filter actually returns rows.
  // ...and for an SO-coverage pick, which is Won-only by definition.
  const tableOpps = wantsClosed
    ? [...openOpps, ...closedOpps]
    : openOpps;
  // Spares are recurring, near-certain business, so they're weighted at a fixed
  // 90% of quoted value regardless of an explicit probability. Everything else
  // uses its own probability, defaulting to 50%. product_type is spelt both
  // "SPARE" and "Spares" in the data, so match case-insensitively.
  const SPARES_WIN_PROBABILITY = 90;
  const oppWeight = (o: OppRow) =>
    /spare/i.test(o.product_type ?? '') ? SPARES_WIN_PROBABILITY : (o.probability ?? 50);
  const weightedOpen = openOpps.reduce((s, o) => s + o.value_cr * (oppWeight(o) / 100), 0);
  // Won opportunities are the realised base for every forecast figure — the
  // sales-Booked tile stays for reference but no longer drives the maths.
  const wonCount     = stageTotals.Won?.count ?? 0;
  // Flow brackets — a snapshot of what sits at each stage right now, taken from
  // the same per-stage totals the kanban headers use (filter-responsive, and
  // uncapped for open stages).
  const quotedCr        = stageTotals.Quoted?.valueCr ?? 0;
  const quotedCount     = stageTotals.Quoted?.count ?? 0;
  const negotiatingCr    = stageTotals.Negotiating?.valueCr ?? 0;
  const negotiatingCount = stageTotals.Negotiating?.count ?? 0;
  const bestCase     = wonTotal + openTotal;
  const probabilityWeighted = wonTotal + weightedOpen;
  const target       = annualTarget > 0 ? annualTarget : 32;
  const toGo         = Math.max(0, target - wonTotal);

  const totalWon   = winLossRows.reduce((s, r) => s + Number(r.won), 0);
  const totalLost  = winLossRows.reduce((s, r) => s + Number(r.lost), 0);
  const winRatePct = totalWon + totalLost > 0
    ? Math.round((totalWon / (totalWon + totalLost)) * 100)
    : 0;

  const anyFilter = stageFilts.length > 0 || prodTypeFilts.length > 0 || repFilts.length > 0 || indFilts.length > 0 || ctypeFilts.length > 0 || probFilts.length > 0 || valFilts.length > 0 || !!soFilt || !!qname || !!qfrom || !!qto;

  // ── Clickable flow brackets ────────────────────────────────
  // See lib/risansi-pipeline-brackets.ts for what each one selects and why the
  // other three blocks in the strip stay inert.
  const bracket = (k: Parameters<typeof bracketLink>[0]) => bracketLink(k, sp, stageFilts, soFilt);

  // Carry the active filters onto the Excel export so it matches what's on screen.
  const exportParams = new URLSearchParams();
  for (const k of ['stage', 'product_type', 'rep', 'industry', 'ctype', 'so', 'prob', 'val', 'qname', 'qfrom', 'qto']) {
    const v = sp[k];
    if (typeof v === 'string' && v) exportParams.set(k, v);
  }
  const exportHref = `/api/risansi/opportunities/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`;

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a
              href={exportHref}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, background: 'var(--bg-elev)', color: 'var(--fg-2)',
                border: '1px solid var(--line-strong)', borderRadius: 6, textDecoration: 'none',
              }}
            >
              ⇩ Export Excel
            </a>
            <NewOpportunityButton usdRate={usdRate} />
          </div>
        </div>

        {/* Rep scope toggle (rep role only) */}
        {role === 'rep' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {/* Lit from scopedRepId, not showAll: picking a colleague in the
                Rep filter suspends the self-scope, so keying off showAll left
                "My Opportunities" highlighted over somebody else's board. */}
            <a href="/risansi/pipeline" style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: scopedRepId != null ? '#0A3D8F' : 'var(--bg-elev)',
              color: scopedRepId != null ? 'white' : 'var(--fg-3)',
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
            {/* Row 1 — the flow. Each bracket is a SNAPSHOT of what sits there
                right now, so value leaves a bracket as an opportunity moves on
                and no two brackets double-count. Quoted/Negotiating come from
                the same per-stage totals the kanban headers use.
                NB: Revenue (Invoiced) is client-level monthly revenue, which
                carries no opportunity link — it's the actuals that land after a
                win, not literally the same rupees moving out of the Won card. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr auto 1fr auto 1fr', gap: 10, alignItems: 'center' }}>
              <ForecastBlock label="Quoted" value={quotedCr}
                sub={quotedCount > 0 ? `${quotedCount} awaiting outcome` : 'nothing quoted'} color="var(--fg)" rate={usdRate}
                {...bracket('quoted')} />
              <FlowArrow />
              <ForecastBlock label="In Negotiation" value={negotiatingCr}
                sub={negotiatingCount > 0 ? `${negotiatingCount} in active talks` : 'none in negotiation'} color="var(--accent)" rate={usdRate}
                {...bracket('negotiating')} />
              <FlowArrow />
              {/* Amber: won business still waiting on an SO is a to-do, not a
                  resting state — raising the SO is the next action. */}
              <ForecastBlock label="Won (awaiting SO)" value={orderInHand}
                sub="won · not yet in an SO" color="var(--warn)" rate={usdRate}
                {...bracket('awaitingSo')} />
              <FlowArrow />
              <ForecastBlock label="Won (SO created)" value={orderBooked}
                sub="SO value" color="var(--pos)" rate={usdRate}
                {...bracket('createdSo')} />
              <FlowArrow />
              {/* Not clickable: this is client_revenue_monthly, which carries no
                  opportunity link — there is no set of cards to filter to. */}
              <ForecastBlock label="Revenue (Invoiced)" value={bookedYTD}
                sub={`sales · ${fy.label}`} color="var(--fg-2)" rate={usdRate} />
            </div>

            {/* Row 2 — forecast, unchanged. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 16, alignItems: 'center', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <ForecastBlock label="Best-case (100% pipe)" value={bestCase}
                sub={`${fmtCr(wonTotal)} won + ${fmtCr(openTotal)} open`} color="var(--fg)" rate={usdRate} />
              <ForecastBlock label="Probability-weighted" value={probabilityWeighted}
                sub={`${fmtCr(weightedOpen)} weighted pipe + won`} color="var(--accent)" highlight rate={usdRate} />
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
                <ForecastBar booked={wonTotal} weightedOpen={weightedOpen} target={target} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                  <span>● won</span>
                  <span style={{ color: 'var(--accent)' }}>● weighted pipe</span>
                  <span>target line</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pipeline filters — scope the kanban AND the table below (server-side). */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: anyFilter ? 8 : 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>Filter</span>
          <MultiSelectFilter param="stage"        label="Stage"        options={stageOptions}       selected={stageFilts}    />
          <MultiSelectFilter param="product_type" label="Product Type" options={productTypeOptions}  selected={prodTypeFilts} />
          <MultiSelectFilter param="rep"          label="Rep"          options={repOptions}          selected={repFilts}      />
          <MultiSelectFilter param="industry"     label="Industry"     options={industryOptions}     selected={indFilts}      />
          <MultiSelectFilter param="ctype"        label="Client Type"  options={clientTypeOptions}   selected={ctypeFilts}    />
          <MultiSelectFilter param="prob"         label="Probability"  options={PROBABILITY_CODE_OPTIONS} selected={probFilts} />
          <MultiSelectFilter param="val"          label="Value"        options={VALUE_BUCKETS.map(b => b.label)} selected={valFilts} />
          <TextSearchFilter param="qname" placeholder="Quote no. / name…" />
          <DateRangeFilter fromParam="qfrom" toParam="qto" from={qfrom} to={qto} label="Quote Date" />
        </div>
        {anyFilter && (
          <div style={{ marginBottom: 12 }}>
            <ActiveFilterBar filters={[
              { param: 'stage',        label: 'Stage',    values: stageFilts    },
              { param: 'product_type', label: 'Type',     values: prodTypeFilts },
              { param: 'rep',          label: 'Rep',      values: repFilts      },
              { param: 'industry',     label: 'Industry', values: indFilts      },
              { param: 'ctype',        label: 'Client Type', values: ctypeFilts },
              { param: 'prob',         label: 'Prob',     values: probFilts     },
              { param: 'so',           label: 'Sales Order', values: soFilt ? [soFilt] : [],
                valueLabels: SO_COVERAGE_LABELS },
            ]} />
          </div>
        )}

        {/* Table + Kanban as tabs. The filters above scope both views (server-side);
            the Win Rate + Lost To panels ride under the Kanban tab, side by side.
            The four slots need `key`s: they're element props handed from this Server
            Component to a Client Component, and React validates them as a sibling set —
            without keys it warns "unique key prop" even though they aren't a list. */}
        <div id="opps" style={{ scrollMarginTop: 16 }} />
        <OpportunitiesTabs
          table={
            <div key="table" style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>{tableOpps === openOpps ? 'Active Opportunities' : 'Opportunities'}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>
                  {tableOpps.length} total
                </span>
              </div>
              <ActiveOppsTable opps={tableOpps} usdRate={usdRate} />
            </div>
          }
          kanban={<OpportunityKanban key="kanban" initialOpps={[...openOpps, ...closedOpps]} stageTotals={stageTotals} usdRate={usdRate} filterQuery={oppFilterQuery(sp, ["stage"]).toString()} />}
          winRate={
            <div key="winRate" style={PANEL}>
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
                    {winLossRows.map((row, i) => {
                      const won   = Number(row.won);
                      const lost  = Number(row.lost);
                      const total = won + lost;
                      const rate  = total > 0 ? Math.round((won / total) * 100) : 0;
                      return (
                        <div key={row.industry ?? `row-${i}`} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                            <span>{row.industry ?? 'Unclassified'}</span>
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
          }
          lostTo={
            <div key="lostTo" style={PANEL}>
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
                    <div key={row.competitor ?? `row-${i}`} style={{
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
          }
        />

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

// Separator between the flow brackets — signals that value MOVES from one
// bracket to the next rather than the cards being independent totals.
function FlowArrow() {
  return (
    <div aria-hidden style={{
      fontSize: 15, color: 'var(--fg-4, var(--fg-3))', lineHeight: 1,
      padding: '0 2px', userSelect: 'none',
    }}>
      →
    </div>
  );
}

function ForecastBlock({
  label, value, sub, color, highlight = false, rate, href, active = false,
}: {
  label: string; value: number; sub: string; color: string; highlight?: boolean; rate?: number;
  /** Set when this bracket maps to a real set of opportunities — clicking it filters the board. */
  href?: string;
  /** True when the board is already showing exactly this bracket; the link then clears it. */
  active?: boolean;
}) {
  const body = (
    <>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
        {active && <span style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: 0 }}>● filtered · click to clear</span>}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, marginTop: 2, color, lineHeight: 1.1 }}>
        ₹{value.toFixed(1)}<span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: 4 }}>Cr</span>
      </div>
      {rate != null && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>
          ≈ {fmtUsdFromCr(value, rate)}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>
    </>
  );

  const boxed: CSSProperties = highlight ? {
    padding: 12, background: 'var(--accent-soft)', borderRadius: 6,
    border: '1px solid var(--accent-line)',
  } : {};

  if (!href) return <div style={boxed}>{body}</div>;

  return (
    <a
      href={href}
      title={active ? `Showing only ${label} — click to clear` : `Show only ${label} in the table and on the board`}
      className="risansi-bracket-link"
      style={{
        ...boxed,
        display: 'block', textDecoration: 'none', color: 'inherit', cursor: 'pointer',
        padding: highlight ? 12 : '8px 10px',
        margin: highlight ? 0 : -2,
        borderRadius: 6,
        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
        background: active ? 'var(--accent-soft)' : (boxed.background as string | undefined),
      }}
    >
      {body}
    </a>
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

