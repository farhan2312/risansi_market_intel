import 'server-only';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql, OWN_OPEN } from '@/lib/risansi-auth';
import { parseOppFilters, buildOppFilter } from '@/lib/risansi-opp-filters';
import {
  ageBasisSql, applySelection, parseSelection, todayMonthIdx,
  type DashStage, type Selection, type StageRow,
} from '@/lib/risansi-stage-dashboard';

// The rows behind a stage dashboard — one query, one place.
//
// The page and the table's Excel export must agree to the row, so they share
// this. Scope is exactly the board's: the URL filters, the viewer's ownership,
// the in-flight rule. On top of that sits the bar selection (`sel=dim:value`),
// which is applied here too, so an export taken with three bars clicked holds
// the same rows the table showed under them.

export interface StageDashRow extends StageRow {
  product: string; stage: string;
  quote_ref: string | null; client_code: string; tour_name: string | null;
  revised_on: string | null; so_numbers: string | null; po_number: string | null;
  quotation_link: string | null; doc_count: number;
  eta_text: string | null;
  enquiry_date: string | null;
}

export type SearchParams = Record<string, string | string[] | undefined>;

export interface StageRows {
  /** Every row in the stage under the board filters and the viewer's scope. */
  all: StageDashRow[];
  /** `all` narrowed by the bar selection. */
  rows: StageDashRow[];
  sel: Selection;
  todayIdx: number;
  role: string;
}

export async function loadStageRows(stage: DashStage, sp: SearchParams): Promise<StageRows> {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  let currentRepId: number | null = session?.user?.repId ?? null;
  if (role === 'rep' && currentRepId == null && session?.user?.email) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [session.user.email]);
    currentRepId = r.rows[0]?.id ?? null;
  }

  // The board's filters ride in on the URL, minus `stage` — this page IS the
  // stage, so a stage param from the board would fight it.
  const filters = parseOppFilters({ ...sp, stage: undefined });
  const showAll = filters.showAllReps || role !== 'rep';
  const scopedRepId = !showAll && filters.rep.length === 0 ? currentRepId : null;
  const built = buildOppFilter(filters, scopedRepId);

  const visUser = await getCurrentUser();
  const ownerVis = clientScopeSql(visUser, 'o.client_id', OWN_OPEN.opportunity('o'));
  const where = [`o.stage = $${built.nextIdx}`, ...built.conds, ...(ownerVis ? [ownerVis] : [])].join(' AND ');
  const vals: (string | number | string[])[] = [...built.vals, stage];

  const all = await risansiPool.query<StageDashRow>(`
      SELECT o.id, o.product, o.product_type, o.stage,
             COALESCE(o.value_cr, 0)::float8       AS value_cr,
             o.final_value_cr::float8              AS final_cr,
             o.quote_ref, o.quote_date::text       AS quote_date, o.market,
             o.client_id, c.legal_name AS client_name, c.code AS client_code,
             c.industry, c.client_type,
             COALESCE(r.name, 'Unassigned') AS rep_name,
             (SELECT tr.name FROM tour_routes tr WHERE tr.id = c.tour_id) AS tour_name,
             o.offer_value_inr::float8             AS offer_inr,
             o.revised_offer_value_inr::float8     AS revised_inr,
             o.revised_offer_date::text            AS revised_on,
             (SELECT count(*) FROM opportunity_offer_revisions v WHERE v.opportunity_id = o.id)::int AS rev_count,
             (SELECT COALESCE(SUM(s.so_value_cr), 0) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id)::float8 AS so_sum_cr,
             (SELECT string_agg(s.so_number, ', ' ORDER BY s.so_date, s.id) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id) AS so_numbers,
             o.po_number, o.lost_to_competitor, o.lost_reason, o.drop_reason, o.quotation_link,
             o.eta_text, o.enquiry_date::text AS enquiry_date,
             (SELECT count(*) FROM opportunity_quotation_files qf WHERE qf.opportunity_id = o.id)::int AS doc_count,
             -- Age from the stage's own reference date. opportunity_stage_log is
             -- empty today (migration 0042 created it after years of swallowed
             -- writes), so 'entered' degrades to created_at rather than to null.
             CASE WHEN ${ageBasisSql(stage)} IS NULL THEN NULL
                  ELSE (CURRENT_DATE - ${ageBasisSql(stage)})::int END AS age_days
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN users r ON r.id = o.rep_id
       WHERE ${where}
       ORDER BY o.value_cr DESC NULLS LAST, o.id`,
    vals as (string | number)[],
  ).then(r => r.rows.map(x => ({ ...x, value_cr: Number(x.value_cr ?? 0) }))).catch(() => [] as StageDashRow[]);

  const sel = parseSelection(sp.sel);
  const todayIdx = todayMonthIdx();
  return { all, rows: applySelection(all, sel, todayIdx), sel, todayIdx, role };
}
