// The SQL the Executive Review is built from, in one place.
//
// The page computes a number; the drill-down lists the rows behind it. If the
// two build their scope, their fiscal-year windows or their turnover bands
// separately, they will agree today and disagree after the next edit — and a
// drill-down that does not add up to the figure above it is worse than none,
// because it looks authoritative while being wrong. So both import from here.

/** Client type, collapsed to the five the review reports on. */
export const CANON = `CASE
  WHEN upper(c.client_type) IN ('DIRECT MILL','END USER') THEN 'Direct Mill'
  WHEN upper(c.client_type) IN ('GROUP (MILLS)','GROUP')  THEN 'Group Mills'
  WHEN upper(c.client_type) IN ('TRADER','MERCHANT EXPORTER') THEN 'Trader'
  WHEN upper(c.client_type) = 'OEM' THEN 'OEM'
  WHEN upper(c.client_type) = 'CHANNEL PARTNER' THEN 'Channel Partner'
  ELSE 'Other' END`;

export const CATS = ['Direct Mill', 'Group Mills', 'Trader', 'OEM', 'Channel Partner'];

export const TURN_ORDER = [
  '15 Lac & above (Super Critical)', '5-15 Lacs p.a.', '3-5 Lacs p.a.', '1-3 Lacs p.a.',
  'Less than 1 Lac p.a.', 'New Business', 'Business Regained', 'End Client', 'No Business',
];

/** Stage → the offer-status wording the review uses. */
export const STAGE_TO_OFFER: Record<string, string> = {
  Quoted: 'Active', Negotiating: 'Active', 'On Hold': 'Hold-Active',
  Won: 'Order Received', Lost: 'Order Lost by RIL', Dropped: 'Requirement Closed',
};

/**
 * Which of a TSM's clients the review counts.
 *
 * `own` is the book they are answerable for and the honest denominator for every
 * ratio on the page. `all` adds the accounts they cover. Either way the result is
 * intersected with the VIEWER's own visibility (`visAnd`): widening which of the
 * subject's accounts to count must never widen what the person looking may see.
 */
export function execScopeSql(
  tsmId: number, accountScope: 'own' | 'all', visAnd: string,
): string {
  if (!tsmId) return 'FALSE';
  const owns = `c.primary_rep_id = ${tsmId}`;
  const covers = `c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = ${tsmId})`;
  return `((${accountScope === 'all' ? `${owns} OR ${covers}` : owns})${visAnd})`;
}

export interface FyWindows {
  /** FY start year the review anchors on, e.g. 2026 for FY 26-27. */
  fy: number;
  /** Every month of the current FY up to now, as 'YYYY-MM'. */
  selMonths: string[];
  /** `col` bucketed into the selected months. */
  inMonths: (col: string) => string;
  /** 'YYYY-MM-01' for an FY start year. */
  d: (y: number, m?: number) => string;
  /** The five completed FYs before the anchor. */
  w5from: string;
  w5to: string;
}

/**
 * The review's fiscal windows. April–March, current FY to date.
 *
 * `now` is a parameter so the page and the drill-down can be handed the same
 * instant; two calls a second apart either side of midnight on 1 April would
 * otherwise anchor on different years.
 */
export function fyWindows(now: Date): FyWindows {
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const selMonths: string[] = [];
  for (
    let cur = new Date(fyStartYear, 3, 1);
    cur <= new Date(now.getFullYear(), now.getMonth(), 1);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  ) {
    selMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
  }
  const latest = selMonths[selMonths.length - 1];
  const selY = Number(latest.slice(0, 4));
  const selM = Number(latest.slice(5, 7));
  const fy = selM >= 4 ? selY : selY - 1;
  const d = (y: number, m = 4) => `${y}-${String(m).padStart(2, '0')}-01`;
  // Values are all YYYY-MM built above, so inlining them is safe.
  const qMonths = selMonths.map(m => `'${m}'`).join(',');
  return {
    fy, selMonths, d,
    inMonths: (col: string) => `to_char(${col},'YYYY-MM') IN (${qMonths})`,
    w5from: d(fy - 5), w5to: d(fy),
  };
}

/**
 * The turnover band each client falls in, as a CASE over a `rev` CTE.
 *
 * Order matters and is not alphabetical: End Client wins outright, then the two
 * movement bands (Regained, New) which describe a change rather than a level,
 * then No Business, and only then the five-year average brackets. A client who
 * started buying this year sits in New Business however much they spent.
 */
export const TURNOVER_BAND_CASE = (fy: number, d: FyWindows['d']) => `CASE
  WHEN is_end_client THEN 'End Client'
  WHEN rev_cur>0 AND rev5=0 AND rev_before>0 THEN 'Business Regained'
  WHEN first_rev IS NOT NULL AND first_rev >= '${d(fy)}' THEN 'New Business'
  WHEN rev5=0 AND rev_cur=0 THEN 'No Business'
  WHEN rev5/5.0 >= 1500000 THEN '15 Lac & above (Super Critical)'
  WHEN rev5/5.0 >= 500000  THEN '5-15 Lacs p.a.'
  WHEN rev5/5.0 >= 300000  THEN '3-5 Lacs p.a.'
  WHEN rev5/5.0 >= 100000  THEN '1-3 Lacs p.a.'
  ELSE 'Less than 1 Lac p.a.' END`;

/** The per-client revenue CTE both the summary and its drill-down sit on. */
export const TURNOVER_REV_CTE = (scope: string, w: FyWindows) => `
  SELECT c.id, c.code, c.legal_name, c.is_end_client,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.w5from}' AND r.month < '${w.w5to}'),0) rev5,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.w5to}'),0) rev_cur,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month <  '${w.w5from}'),0) rev_before,
    min(r.month) FILTER (WHERE r.total_value > 0) first_rev,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy)}'     AND r.month < '${w.d(w.fy + 1)}'),0) fyc,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy - 1)}' AND r.month < '${w.d(w.fy)}'),0)     f1,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy - 2)}' AND r.month < '${w.d(w.fy - 1)}'),0) f2,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy - 3)}' AND r.month < '${w.d(w.fy - 2)}'),0) f3
  FROM clients c LEFT JOIN client_revenue_monthly r ON r.client_id = c.id
  WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL
  GROUP BY c.id, c.code, c.legal_name, c.is_end_client`;
