// Expected closures, rep by rep, month by month and quarter by quarter.
//
// The forecast question: of the pipeline that is still open, how much is each
// rep expecting to close and when. It reads opportunities.eta_text, which the
// Quoted form asks for as a month ("Sep 2026").
//
// READ THE COVERAGE FIGURE BEFORE READING THE TABLE. Only a small share of the
// open pipeline carries an expected-close month at all — the rest cannot be
// placed in any period and lands in "No date". A projection that quietly dropped
// those would show a fraction of the pipeline and be read as the whole forecast,
// so every row carries its undated value beside its dated one and the section
// states the coverage in words.
//
// Nothing here infers a date. Deriving one from the quote date and an average
// cycle would fill the table, and every figure in it would be invented.
import type { Pool } from 'pg';

/** Open = still live. Dropped is dead and has no place in a forecast. */
const OPEN = `o.stage NOT IN ('Won','Lost','Dropped')`;

/** The value of an opportunity, in rupees, by the same rule the rest of the app
 *  uses: the quoted offer where there is one, the estimate otherwise. */
const VALUE = `COALESCE(o.offer_value_inr, o.value_cr * 10000000, 0)`;

// eta_text is free-form varchar. Mapping the month name explicitly rather than
// with to_date, which raises on a month name it does not recognise and would
// take the whole section down over one badly typed row.
const ETA_MONTH = `CASE lower(left(btrim(o.eta_text), 3))
  WHEN 'jan' THEN 1 WHEN 'feb' THEN 2  WHEN 'mar' THEN 3  WHEN 'apr' THEN 4
  WHEN 'may' THEN 5 WHEN 'jun' THEN 6  WHEN 'jul' THEN 7  WHEN 'aug' THEN 8
  WHEN 'sep' THEN 9 WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
  END`;
const ETA_YEAR = `NULLIF(regexp_replace(o.eta_text, '\\D', '', 'g'), '')::int`;

export interface ProjectionCell {
  /** 'YYYY-MM' for a month, 'overdue', 'later', or 'none'. */
  bucket: string;
  gross: number;
  /** Gross × probability, summed only where a probability is recorded. */
  weighted: number;
  /** How much of `gross` had a probability to weight by. */
  weightedBase: number;
  count: number;
}

export interface ProjectionRep {
  repId: number;
  name: string;
  cells: ProjectionCell[];
  /** Every open opportunity of theirs, dated or not. */
  totalGross: number;
  totalCount: number;
}

export interface Projection {
  /** FY start year, e.g. 2026 for FY 26-27. */
  fyStart: number;
  /** The twelve 'YYYY-MM' keys of the fiscal year, April first. */
  months: string[];
  reps: ProjectionRep[];
  coverage: {
    openGross: number; openCount: number;
    datedGross: number; datedCount: number;
    /** Dated share of open value, 0-1. Null when there is no open pipeline. */
    share: number | null;
    /** Open value whose expected month has already passed. */
    overdueGross: number;
    /** How much of the open value carries a probability to weight by. */
    withProbGross: number;
  };
}

/**
 * @param repIds  Visible reps. `null` means every rep — pass the same list the
 *                Executive Review's own selector was built from, so this section
 *                can never show a rep the viewer cannot otherwise see.
 */
export async function loadProjection(
  pool: Pool, fyStart: number, repIds: number[] | null,
): Promise<Projection> {
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;                 // April .. March
    const y = fyStart + (m >= 4 ? 0 : 1);
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  if (repIds !== null && repIds.length === 0) {
    return {
      fyStart, months, reps: [],
      coverage: { openGross: 0, openCount: 0, datedGross: 0, datedCount: 0, share: null, overdueGross: 0, withProbGross: 0 },
    };
  }
  const repFilter = repIds === null ? '' : ` AND o.rep_id = ANY($1::int[])`;
  const params = repIds === null ? [] : [repIds];

  // One row per rep per bucket. The bucket is worked out in SQL so a rep with no
  // opportunity in a month simply has no row, rather than the query returning a
  // dense grid of zeroes.
  const bucket = `
    CASE
      WHEN ${ETA_MONTH} IS NULL OR ${ETA_YEAR} IS NULL THEN 'none'
      WHEN make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) < date_trunc('month', CURRENT_DATE) THEN 'overdue'
      WHEN make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) > make_date(${fyStart + 1}, 3, 1) THEN 'later'
      WHEN make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) < make_date(${fyStart}, 4, 1) THEN 'overdue'
      ELSE to_char(make_date(${ETA_YEAR}, ${ETA_MONTH}, 1), 'YYYY-MM')
    END`;

  const { rows } = await pool.query<{
    rep_id: number; name: string; bucket: string;
    gross: string; weighted: string; weighted_base: string; n: string;
  }>(`
    SELECT o.rep_id, u.name, ${bucket} AS bucket,
           COALESCE(sum(${VALUE}), 0)::text AS gross,
           COALESCE(sum(${VALUE} * o.probability / 100.0)
                      FILTER (WHERE o.probability IS NOT NULL), 0)::text AS weighted,
           COALESCE(sum(${VALUE}) FILTER (WHERE o.probability IS NOT NULL), 0)::text AS weighted_base,
           count(*)::text AS n
      FROM opportunities o
      JOIN users u ON u.id = o.rep_id
     WHERE ${OPEN}${repFilter}
     GROUP BY o.rep_id, u.name, ${bucket}
     ORDER BY u.name`, params);

  const byRep = new Map<number, ProjectionRep>();
  for (const r of rows) {
    let rep = byRep.get(r.rep_id);
    if (!rep) {
      rep = { repId: r.rep_id, name: r.name, cells: [], totalGross: 0, totalCount: 0 };
      byRep.set(r.rep_id, rep);
    }
    const cell: ProjectionCell = {
      bucket: r.bucket,
      gross: Number(r.gross), weighted: Number(r.weighted),
      weightedBase: Number(r.weighted_base), count: Number(r.n),
    };
    rep.cells.push(cell);
    rep.totalGross += cell.gross;
    rep.totalCount += cell.count;
  }

  const reps = [...byRep.values()].sort((a, b) => b.totalGross - a.totalGross);

  // Coverage, over the same population the table is built from. Computed here
  // rather than from the cells so it is a statement about the query, not a
  // restatement of the grid.
  const { rows: [c] } = await pool.query<Record<string, string>>(`
    SELECT COALESCE(sum(${VALUE}), 0)::text AS open_gross,
           count(*)::text AS open_count,
           COALESCE(sum(${VALUE}) FILTER (WHERE ${ETA_MONTH} IS NOT NULL AND ${ETA_YEAR} IS NOT NULL), 0)::text AS dated_gross,
           count(*) FILTER (WHERE ${ETA_MONTH} IS NOT NULL AND ${ETA_YEAR} IS NOT NULL)::text AS dated_count,
           COALESCE(sum(${VALUE}) FILTER (
             WHERE ${ETA_MONTH} IS NOT NULL AND ${ETA_YEAR} IS NOT NULL
               AND make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) < date_trunc('month', CURRENT_DATE)), 0)::text AS overdue_gross,
           COALESCE(sum(${VALUE}) FILTER (WHERE o.probability IS NOT NULL), 0)::text AS with_prob_gross
      FROM opportunities o WHERE ${OPEN}${repFilter}`, params);

  const openGross = Number(c?.open_gross ?? 0);
  const datedGross = Number(c?.dated_gross ?? 0);

  return {
    fyStart, months, reps,
    coverage: {
      openGross, openCount: Number(c?.open_count ?? 0),
      datedGross, datedCount: Number(c?.dated_count ?? 0),
      share: openGross > 0 ? datedGross / openGross : null,
      overdueGross: Number(c?.overdue_gross ?? 0),
      withProbGross: Number(c?.with_prob_gross ?? 0),
    },
  };
}

/** The four fiscal quarters, as the month keys each contains. */
export function quartersOf(months: string[]): { label: string; months: string[] }[] {
  return [0, 1, 2, 3].map(i => ({
    label: `Q${i + 1}`,
    months: months.slice(i * 3, i * 3 + 3),
  }));
}
