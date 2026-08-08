// What each pipeline stage's dashboard is for.
//
// A stage answers a different question depending on where it sits. Suspect and
// Prospect are "who owns this and has it gone cold". Quoted is "which of these
// 746 quotes is going stale". Negotiating is "how far has the price moved". Won
// is "what have we won and what still needs an SO raised". Lost and Dropped are
// post-mortems. So the tiles, the charts and even the table columns differ per
// stage rather than being one generic list rendered eight times.

export const DASH_STAGES = [
  'Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped',
] as const;
export type DashStage = typeof DASH_STAGES[number];

/** URL slug ⇄ stage name. 'On Hold' is the only one that isn't just lowercase. */
export const STAGE_SLUG: Record<DashStage, string> = {
  Suspect: 'suspect', Prospect: 'prospect', Quoted: 'quoted', Negotiating: 'negotiating',
  'On Hold': 'on-hold', Won: 'won', Lost: 'lost', Dropped: 'dropped',
};

const SLUG_STAGE: Record<string, DashStage> =
  Object.fromEntries(Object.entries(STAGE_SLUG).map(([s, g]) => [g, s])) as Record<string, DashStage>;

export const stageFromSlug = (slug: string): DashStage | null =>
  SLUG_STAGE[slug.toLowerCase()] ?? null;

export const stageHref = (stage: string, query?: URLSearchParams): string => {
  const slug = STAGE_SLUG[stage as DashStage];
  if (!slug) return '/risansi/pipeline';
  const qs = query?.toString();
  return `/risansi/pipeline/stage/${slug}${qs ? `?${qs}` : ''}`;
};

/** Column hue, matching the kanban board so the pages feel like the same object. */
export const STAGE_COLOR: Record<DashStage, string> = {
  Suspect:     'var(--info)',
  Prospect:    '#5a86c2',
  Quoted:      '#c69347',
  Negotiating: 'var(--accent)',
  'On Hold':   '#7C3AED',
  Won:         'var(--pos)',
  Lost:        'var(--neg)',
  Dropped:     '#64748B',
};

/** One line under the page title saying what this stage means. */
export const STAGE_BLURB: Record<DashStage, string> = {
  Suspect:     'Early leads, roughly 1–2 years out. The question here is who owns them and whether they have gone cold.',
  Prospect:    'Active interest with a value estimate, roughly 6 months out.',
  Quoted:      'A quotation is out and the outcome is undecided. The question is which of these are going stale.',
  Negotiating: 'The quote is on the table and the price is moving. Every re-price is recorded against its date.',
  'On Hold':   'Parked, not lost. Worth a periodic sweep so nothing sits here by accident.',
  Won:         'Order in hand. The open question on most of these is whether a Sales Order has been raised yet.',
  Lost:        'We competed and did not win. Reason and competitor feed win-rate and competitive analysis.',
  Dropped:     'The requirement went away — cancelled, deferred or duplicated. Distinct from Lost.',
};

/**
 * Ageing buckets, in days. Shared by every stage's ageing chart so "61–90d"
 * means the same span everywhere. The clock runs from the stage's own reference
 * date — see AGE_BASIS.
 */
export const AGE_BUCKETS = [
  { label: '0–30d',  min: 0,  max: 30 },
  { label: '31–60d', min: 30, max: 60 },
  { label: '61–90d', min: 60, max: 90 },
  { label: '90d+',   min: 90, max: null as number | null },
];

/**
 * What "age" counts from, per stage.
 *
 * `quote` — days since quote_date. Right for Quoted / Negotiating / On Hold,
 * where the meaningful clock started when the quotation went out.
 * `entered` — days since the opportunity last entered its current stage, from
 * opportunity_stage_log, falling back to created_at. Right for Suspect and
 * Prospect, which have no quote.
 *
 * The fallback matters: opportunity_stage_log was only created in migration
 * 0042 (it had never existed, and every write to it was being swallowed), so it
 * is empty today and fills going forward. Ageing degrades to created_at rather
 * than showing nothing.
 */
export const AGE_BASIS: Record<DashStage, 'quote' | 'entered'> = {
  Suspect: 'entered', Prospect: 'entered', Quoted: 'quote', Negotiating: 'quote',
  'On Hold': 'quote', Won: 'entered', Lost: 'entered', Dropped: 'entered',
};

/** SQL expression for the stage's age reference date. */
export function ageBasisSql(stage: DashStage): string {
  if (AGE_BASIS[stage] === 'quote') return 'o.quote_date';
  return `COALESCE(
    (SELECT max(l.changed_at)::date FROM opportunity_stage_log l
      WHERE l.opportunity_id = o.id AND l.to_stage = o.stage),
    o.created_at::date)`;
}

/** Table columns, per stage. `key` matches a field on the row the page selects. */
export interface StageColumn {
  key: string;
  label: string;
  /** right-aligned monospace money/number */
  num?: boolean;
  width?: number;
}

const COMMON_HEAD: StageColumn[] = [
  { key: 'client_name', label: 'Client' },
  { key: 'product',     label: 'Product' },
  { key: 'product_type', label: 'Type', width: 70 },
];
const COMMON_TAIL: StageColumn[] = [
  { key: 'rep_name', label: 'Rep', width: 130 },
];

export const STAGE_COLUMNS: Record<DashStage, StageColumn[]> = {
  Suspect: [
    ...COMMON_HEAD,
    { key: 'value_cr',  label: 'Value', num: true, width: 90 },
    { key: 'tour_name', label: 'Tour', width: 130 },
    ...COMMON_TAIL,
    { key: 'age_days',  label: 'Days in stage', num: true, width: 100 },
  ],
  Prospect: [
    ...COMMON_HEAD,
    { key: 'value_cr',    label: 'Value', num: true, width: 90 },
    { key: 'industry',    label: 'Industry', width: 120 },
    { key: 'client_type', label: 'Client Type', width: 110 },
    ...COMMON_TAIL,
    { key: 'age_days',    label: 'Days in stage', num: true, width: 100 },
  ],
  Quoted: [
    { key: 'quote_ref',  label: 'Quote No.', width: 150 },
    { key: 'quote_date', label: 'Quoted', width: 95 },
    { key: 'age_days',   label: 'Age', num: true, width: 70 },
    ...COMMON_HEAD,
    { key: 'market',     label: 'Market', width: 90 },
    { key: 'offer_inr',  label: 'Offer', num: true, width: 105 },
    { key: 'revised_inr', label: 'Revised', num: true, width: 115 },
    ...COMMON_TAIL,
  ],
  Negotiating: [
    { key: 'quote_ref',   label: 'Quote No.', width: 150 },
    ...COMMON_HEAD,
    { key: 'offer_inr',   label: 'Original', num: true, width: 105 },
    { key: 'revised_inr', label: 'Current', num: true, width: 115 },
    { key: 'rev_count',   label: 'Revisions', num: true, width: 85 },
    { key: 'revised_on',  label: 'Last revised', width: 100 },
    ...COMMON_TAIL,
  ],
  'On Hold': [
    ...COMMON_HEAD,
    { key: 'value_cr',   label: 'Value', num: true, width: 90 },
    { key: 'quote_ref',  label: 'Quote No.', width: 150 },
    { key: 'age_days',   label: 'Days on hold', num: true, width: 105 },
    ...COMMON_TAIL,
  ],
  Won: [
    ...COMMON_HEAD,
    { key: 'value_cr',   label: 'Won Value', num: true, width: 100 },
    { key: 'final_cr',   label: 'Final', num: true, width: 95 },
    { key: 'po_number',  label: 'PO No.', width: 120 },
    { key: 'so_numbers', label: 'SO No.', width: 130 },
    { key: 'so_sum_cr',  label: 'SO Value', num: true, width: 95 },
    { key: 'so_status',  label: 'Coverage', width: 95 },
    ...COMMON_TAIL,
  ],
  Lost: [
    ...COMMON_HEAD,
    { key: 'value_cr',           label: 'Value', num: true, width: 90 },
    { key: 'lost_to_competitor', label: 'Lost To', width: 150 },
    { key: 'lost_reason',        label: 'Reason', width: 200 },
    { key: 'quote_ref',          label: 'Quote No.', width: 150 },
    ...COMMON_TAIL,
  ],
  Dropped: [
    ...COMMON_HEAD,
    { key: 'value_cr',    label: 'Value', num: true, width: 90 },
    { key: 'drop_reason', label: 'Drop Reason', width: 230 },
    { key: 'quote_ref',   label: 'Quote No.', width: 150 },
    ...COMMON_TAIL,
  ],
};

/** Chart palette — enough distinct hues for a product/industry breakdown. */
export const CHART_COLORS = [
  '#0A3D8F', '#c69347', '#2E9E6B', '#7C3AED', '#D9534F',
  '#0EA5E9', '#F59E0B', '#64748B', '#DB2777', '#14B8A6',
];

// ── Stage summary ──────────────────────────────────────────────
// Every tile and chart on a stage page is derived here, from the rows the page
// already fetched. Pure and exported so it can be driven directly in a test —
// the page is auth-gated, so this is the only way to exercise the maths against
// real rows without standing up a session.

export interface StageRow {
  id: string; product_type: string | null; value_cr: number; final_cr: number | null;
  quote_date: string | null; market: string | null; client_id: string; client_name: string;
  industry: string | null; client_type: string | null; rep_name: string | null;
  offer_inr: number | null; revised_inr: number | null; rev_count: number;
  so_sum_cr: number; lost_to_competitor: string | null; lost_reason: string | null;
  drop_reason: string | null; age_days: number | null;
}

export interface Slice { label: string; count: number; value: number }

/** Won value with no Sales Order against it uses final_value_cr when set, else value_cr. */
export const wonBase = (r: Pick<StageRow, 'final_cr' | 'value_cr'>) =>
  (r.final_cr != null ? Number(r.final_cr) : r.value_cr);

export function summariseStage(rows: StageRow[]) {
  const n       = rows.length;
  const totalCr = rows.reduce((s, r) => s + r.value_cr, 0);
  const withAge = rows.filter(r => r.age_days != null);

  const group = (key: (r: StageRow) => string | null, limit?: number): Slice[] => {
    const m = new Map<string, Slice>();
    for (const r of rows) {
      // An unrecorded value becomes its own bar rather than being dropped: an
      // empty "why we lost" chart reads as "no reason", not "nobody filled it in".
      const k = (key(r) ?? '').trim() || 'Unrecorded';
      const cur = m.get(k) ?? { label: k, count: 0, value: 0 };
      cur.count++; cur.value += r.value_cr; m.set(k, cur);
    }
    const out = [...m.values()].sort((a, b) => b.value - a.value || b.count - a.count);
    return limit ? out.slice(0, limit) : out;
  };

  const ageBuckets: Slice[] = [
    ...AGE_BUCKETS.map(b => {
      const hit = withAge.filter(r => (r.age_days ?? 0) >= b.min && (b.max == null || (r.age_days ?? 0) < b.max));
      return { label: b.label, count: hit.length, value: hit.reduce((s, r) => s + r.value_cr, 0) };
    }),
    ...(n - withAge.length > 0
      ? [{ label: 'No date', count: n - withAge.length, value: rows.filter(r => r.age_days == null).reduce((s, r) => s + r.value_cr, 0) }]
      : []),
  ];

  const stale = withAge.filter(r => (r.age_days ?? 0) > 60);
  const moved = rows.filter(r => r.rev_count > 0 && r.offer_inr && r.revised_inr);

  // Monthly trend by quote date, oldest first, last 12 months present.
  const trend = (() => {
    const m = new Map<string, { key: string; label: string; count: number; value: number }>();
    for (const r of rows) {
      if (!r.quote_date) continue;
      const key = r.quote_date.slice(0, 7);
      const cur = m.get(key) ?? {
        key,
        label: new Date(`${key}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        count: 0, value: 0,
      };
      cur.count++; cur.value += wonBase(r); m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  })();

  return {
    n, totalCr,
    avgCr:   n ? totalCr / n : 0,
    clients: new Set(rows.map(r => r.client_id)).size,
    avgAge:  withAge.length ? Math.round(withAge.reduce((s, r) => s + (r.age_days ?? 0), 0) / withAge.length) : null,
    oldest:  withAge.length ? Math.max(...withAge.map(r => r.age_days ?? 0)) : null,
    ageBuckets,
    stale, staleCr: stale.reduce((s, r) => s + r.value_cr, 0),
    // Un-SO'd won value: Σ max(final − ΣSO, 0), the same definition the flow
    // bracket on the board uses, so the two can never disagree.
    inHandCr: rows.reduce((s, r) => s + Math.max(0, wonBase(r) - r.so_sum_cr), 0),
    soCr:     rows.reduce((s, r) => s + r.so_sum_cr, 0),
    withSo:   rows.filter(r => r.so_sum_cr > 0).length,
    moved,
    avgMove: moved.length
      ? moved.reduce((s, r) => s + (((r.revised_inr as number) - (r.offer_inr as number)) / (r.offer_inr as number)) * 100, 0) / moved.length
      : null,
    totalRevs: rows.reduce((s, r) => s + r.rev_count, 0),
    trend,
    group,
    unrecorded: (key: (r: StageRow) => string | null) => rows.filter(r => !((key(r) ?? '').trim())).length,
  };
}
