// One definition of what an opportunity asks for, and when. The forms render
// from it and the server validates against it, so the two can never disagree.
//
// THE MODEL, after the Aug 2026 redesign:
//
//   An opportunity starts as a PROSPECT — an enquiry has arrived. That is the
//   only way in. From there it goes one of four ways:
//
//     Prospect ──quotation issued──────────────────────────────► Quoted
//              ──enquiry regretted──────────────────────────────► Dropped
//              ──Against Rate Contract / Repeat Order───────────► Won
//              ──not live yet, park it──────────────────────────► Suspect
//
//   SUSPECT is no longer the first rung of a ladder; it is a siding. Something
//   parked there is budgetary, or an expansion a year or more out, and it says
//   which. It rejoins the line when the enquiry becomes real.
//
//   The direct Prospect → Won jump exists because a rate-contract or repeat
//   order needs no quotation — the price is already agreed. Forcing those
//   through Quoted was making reps invent quote numbers.
//
// Each field declares the stage at which it is FIRST asked. That single fact
// drives the two-section form: everything asked at earlier stages is shown as
// context, and only the fields belonging to the stage being entered are new.

export const PRODUCT_TYPES = ['PCP', 'MMP', 'RBL', 'OLB', 'SPARE', 'SERVICE', 'OTHER'] as const;

/** Pump or Spare — a different axis from PRODUCT_TYPES. A spare for a PCP is still PCP. */
export const OPPORTUNITY_TYPES = ['Pump', 'Spare'] as const;

export const OPPORTUNITY_SOURCES = [
  'By Post', 'Email', 'WhatsApp', 'Tender Portal', 'India MART', 'Verbal',
] as const;

/**
 * Against Rate Contract and Repeat Order both mean the commercial terms already
 * exist, which is why either may go straight to Won without a quotation.
 */
export const OPPORTUNITY_CATEGORIES = [
  'Against Rate Contract', 'New Enquiry', 'Repeat Order',
] as const;

/** Why an enquiry is parked rather than live. Budgetary lives here now, not on category. */
export const SUSPECT_REASONS = [
  'Budgetary', 'Expansion within 1 year', 'Expansion more than 1 year',
] as const;

export const HOLD_REASONS = [
  'Awaiting client budget', 'Awaiting technical clearance', 'Project deferred',
  'Awaiting sample / trial', 'Commercial terms unresolved', 'Other',
] as const;

/** Categories that may close without a quotation ever being issued. */
export const DIRECT_WIN_CATEGORIES: readonly string[] = ['Against Rate Contract', 'Repeat Order'];

export const CREATE_STAGES = ['Prospect', 'Suspect', 'Quoted', 'Negotiating', 'Won', 'Lost'] as const;
export type CreateStage = typeof CREATE_STAGES[number];

/** Every stage an opportunity can hold, including the two it can only be moved into. */
export const ALL_STAGES = [
  'Prospect', 'Suspect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped',
] as const;
export type OppStage = typeof ALL_STAGES[number];

/**
 * How far along the line a stage sits.
 *
 * Suspect shares Prospect's rank rather than sitting below it. A parked enquiry
 * still arrived from somewhere, so it is asked the same questions — type,
 * source, category — plus the one that explains the parking. Ranking it lower
 * would have hidden exactly the fields Source was added to capture.
 */
export const STAGE_RANK: Record<OppStage, number> = {
  Suspect: 1, Prospect: 1, Quoted: 2, Negotiating: 3, 'On Hold': 3,
  Won: 4, Lost: 4, Dropped: 4,
};

export const STAGE_PROB: Record<CreateStage, number> = {
  Suspect: 10, Prospect: 40, Quoted: 60, Negotiating: 75, Won: 100, Lost: 0,
};

export const STAGE_HINT: Record<OppStage, string> = {
  Prospect:    'An enquiry has arrived. Capture where it came from and what it is for.',
  Suspect:     'Parked — budgetary, or an expansion some way off. Say which.',
  Quoted:      'A quotation has gone out. Capture the quote, the offer and its line items.',
  Negotiating: 'The quote is on the table and terms are moving.',
  'On Hold':   'Paused for a reason outside the deal itself.',
  Won:         'Order in hand. Capture the booked value and the PO behind it.',
  Lost:        'Lost to someone or something. Feeds win-rate and competitor analysis.',
  Dropped:     'The requirement went away, or the enquiry was regretted.',
};

/** Where a Prospect can go next, and what each move means. */
export const PROSPECT_EXITS = [
  { to: 'Quoted' as const,      label: 'Quotation issued',   hint: 'Capture the quote and its line items.' },
  { to: 'Won' as const,         label: 'Order received',     hint: 'Rate contract or repeat order — no quotation needed.', onlyCategories: DIRECT_WIN_CATEGORIES },
  { to: 'Suspect' as const,     label: 'Park it',            hint: 'Budgetary, or an expansion further out.' },
  { to: 'Dropped' as const,     label: 'Enquiry regretted',  hint: 'The enquiry will not proceed.' },
];

export type FieldKind =
  | 'text' | 'inr' | 'number' | 'date' | 'month' | 'select' | 'prob_code' | 'textarea';

export interface OppFieldDef {
  /** Form field name === db column (money fields take rupees and end _inr). */
  name: string;
  label: string;
  kind: FieldKind;
  /** The stage at which this is FIRST asked. Drives the two-section form. */
  asked: OppStage;
  /** Stages on which it must be filled. */
  requiredAt?: OppStage[];
  /** Shown ONLY on these stages, rather than from `asked` onward. */
  onlyStages?: OppStage[];
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  full?: boolean;
  /** A date that cannot be in the future. Bounds the input and the server check. */
  noFuture?: boolean;
}

const QUOTE_STAGES: OppStage[] = ['Quoted', 'Negotiating', 'On Hold'];

/**
 * The catalogue, in the order a form should render it.
 *
 * `product` (Product / Description) is gone. It duplicated Project Name / Unit
 * and Product Type between them, and reps were typing the same thing three times.
 */
export const OPP_FIELDS: OppFieldDef[] = [
  // ── Prospect · the enquiry ──────────────────────────────────
  { name: 'opportunity_type',     label: 'Type',              kind: 'select', asked: 'Prospect', requiredAt: [...ALL_STAGES], options: OPPORTUNITY_TYPES },
  { name: 'opportunity_source',   label: 'Source',            kind: 'select', asked: 'Prospect', requiredAt: [...ALL_STAGES], options: OPPORTUNITY_SOURCES },
  { name: 'opportunity_category', label: 'Category',          kind: 'select', asked: 'Prospect', requiredAt: [...ALL_STAGES], options: OPPORTUNITY_CATEGORIES, help: 'Rate contract and repeat orders can close without a quotation' },
  { name: 'client_reference',     label: 'Client Reference',  kind: 'text',   asked: 'Prospect', placeholder: 'Their PO, tender or email subject' },
  { name: 'enquiry_no',           label: 'Enquiry No.',       kind: 'text',   asked: 'Prospect', placeholder: 'RIL/EN/…' },
  { name: 'enquiry_date',         label: 'Enquiry Date',      kind: 'date',   asked: 'Prospect' },
  { name: 'unit_project',         label: 'Project Name / Unit', kind: 'text', asked: 'Prospect', full: true, placeholder: 'e.g. Balrampur Chini — Unit 2, Spent Wash' },
  { name: 'notes',                label: 'Notes',             kind: 'textarea', asked: 'Prospect', full: true },

  // ── Suspect · the siding ────────────────────────────────────
  { name: 'suspect_reason', label: 'Why parked', kind: 'select', asked: 'Suspect', onlyStages: ['Suspect'], requiredAt: ['Suspect'], options: SUSPECT_REASONS },

  // ── Quoted · the quotation ──────────────────────────────────
  { name: 'product_type',    label: 'Product Type',   kind: 'select', asked: 'Quoted', requiredAt: [...QUOTE_STAGES, 'Won', 'Lost'], options: PRODUCT_TYPES },
  { name: 'quote_ref',       label: 'Quote No.',      kind: 'text',   asked: 'Quoted', requiredAt: [...QUOTE_STAGES], placeholder: 'RIL/QT/…' },
  { name: 'quote_date',      label: 'Quote Date',     kind: 'date',   asked: 'Quoted', requiredAt: [...QUOTE_STAGES] },
  { name: 'market',          label: 'Market',         kind: 'select', asked: 'Quoted', requiredAt: [...QUOTE_STAGES], options: ['DOMESTIC', 'EXPORT'] },
  { name: 'offer_value_inr', label: 'Total Offer (₹)', kind: 'inr',   asked: 'Quoted', requiredAt: [...QUOTE_STAGES], help: 'Auto-sums the line items if left blank' },
  { name: 'probability_code', label: 'Probability',   kind: 'prob_code', asked: 'Quoted' },
  { name: 'eta_text',        label: 'Expected Close', kind: 'month',  asked: 'Quoted' },

  // ── On Hold ─────────────────────────────────────────────────
  { name: 'hold_reason', label: 'Hold Reason', kind: 'select', asked: 'On Hold', onlyStages: ['On Hold'], requiredAt: ['On Hold'], options: HOLD_REASONS },

  // ── Won ─────────────────────────────────────────────────────
  // The PO is what makes a deal Won, so its number and date are required. The
  // Sale Order is a later step and often days or weeks behind the PO — demanding
  // it at the same moment either blocked a real win or invited a placeholder
  // number that then had to be corrected. Left blank, every figure that reads it
  // falls back to the quoted value via COALESCE(final_value_cr, value_cr).
  { name: 'final_value_inr', label: 'Sale Order Value (₹)', kind: 'inr',  asked: 'Won', onlyStages: ['Won'],
    help: 'Optional — add it when the Sale Order comes through. Until then, Order in Hand uses the quoted value.' },
  { name: 'po_number',       label: 'PO Number',            kind: 'text', asked: 'Won', onlyStages: ['Won'], requiredAt: ['Won'], placeholder: 'e.g. PO-2024-0182' },
  // A PO that has not been raised yet cannot have a number, so a future PO date
  // is always either a typo or a placeholder. Only this date is bounded: a quote
  // date can legitimately be forward-dated, and an expected close is meant to be.
  { name: 'po_date',         label: 'PO Date',              kind: 'date', asked: 'Won', onlyStages: ['Won'], requiredAt: ['Won'], noFuture: true },

  // ── Lost ────────────────────────────────────────────────────
  { name: 'lost_to_competitor', label: 'Lost To Competitor', kind: 'select', asked: 'Lost', onlyStages: ['Lost'], requiredAt: ['Lost'], options: [] },
  { name: 'lost_reason',        label: 'Lost Reason',        kind: 'select', asked: 'Lost', onlyStages: ['Lost'], requiredAt: ['Lost'], options: [
    'Price — Too expensive', 'Technical — Spec mismatch', 'OEM Tied — Forced preference',
    'Relationship — Existing supplier', 'Budget — Project cancelled', 'Delivery — Timeline mismatch',
    'No decision — Deferred', 'Other',
  ] },

  // ── Dropped ─────────────────────────────────────────────────
  { name: 'drop_reason', label: 'Drop Reason', kind: 'select', asked: 'Dropped', onlyStages: ['Dropped'], requiredAt: ['Dropped'], options: [] },
];

export const LOST_COMPETITOR_TAIL = ['Price — No specific competitor', 'OEM Tied', 'Budget Cancelled', 'Other'];

/**
 * Why an opportunity was Dropped. Distinct from lost_reason: Lost is "we
 * competed and did not win", Dropped is "the requirement went away".
 */
export const DROP_REASONS = [
  'Closed deferred to next season',
  'Repeat or duplicate offer',
  'Requirement closed',
  'Technically disqualified',
  'Closed no response from client',
  // The enquiry itself was declined — we chose not to pursue or quote it. The
  // Prospect → Dropped exit writes this one.
  'Inquiry Regret',
  // Housekeeping rather than a commercial outcome: the record should never have
  // existed (mis-keyed) or duplicates one that already does.
  'Incorrect entry / Duplicate',
] as const;
export type DropReason = typeof DROP_REASONS[number];
export const isDropReason = (v: unknown): v is DropReason =>
  typeof v === 'string' && (DROP_REASONS as readonly string[]).includes(v);

/** Stages that keep a free-text remark each time they are entered. */
export const REMARK_STAGES: OppStage[] = ['Suspect', 'Negotiating', 'On Hold', 'Lost', 'Dropped'];
export const REMARK_LABEL: Partial<Record<OppStage, string>> = {
  Negotiating: 'Follow-up Remarks',
  Suspect: 'Remarks', 'On Hold': 'Remarks', Lost: 'Remarks', Dropped: 'Remarks',
};

// ── Queries over the catalogue ────────────────────────────────

export function isFieldVisible(f: OppFieldDef, stage: OppStage): boolean {
  if (f.onlyStages) return f.onlyStages.includes(stage);
  return STAGE_RANK[stage] >= STAGE_RANK[f.asked];
}

export function isFieldRequired(f: OppFieldDef, stage: OppStage): boolean {
  return isFieldVisible(f, stage) && (f.requiredAt ?? []).includes(stage);
}

/** Fields first asked AT this stage — the "fill this in now" section. */
export function fieldsNewAt(stage: OppStage): OppFieldDef[] {
  return OPP_FIELDS.filter(f => isFieldVisible(f, stage) && f.asked === stage);
}

/** Fields carried in from earlier stages — the "already recorded" section. */
export function fieldsCarriedInto(stage: OppStage): OppFieldDef[] {
  return OPP_FIELDS.filter(f => isFieldVisible(f, stage) && f.asked !== stage);
}

export function requiredFieldNames(stage: OppStage): string[] {
  return OPP_FIELDS.filter(f => isFieldRequired(f, stage)).map(f => f.name);
}

export function labelsFor(names: string[]): string[] {
  return names.map(n => OPP_FIELDS.find(f => f.name === n)?.label ?? n);
}

/** Does this stage carry a quotation block (line items, revisions, documents)? */
export function stageHasQuote(stage: OppStage): boolean {
  return STAGE_RANK[stage] >= STAGE_RANK.Quoted && stage !== 'Suspect';
}

/** The moves available from a Prospect, given its category. */
export function prospectExits(category: string | null | undefined) {
  return PROSPECT_EXITS.filter(e => !e.onlyCategories || e.onlyCategories.includes(category ?? ''));
}
