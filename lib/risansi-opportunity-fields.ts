// One definition of what an opportunity form asks for, per stage. The create
// modal renders from it and the server validates against it, so the two can
// never disagree about which fields show or which are required.
//
// Three ideas drive it:
//   • visibility is CUMULATIVE up the linear pipeline — pick Quoted and you see
//     everything a Suspect and Prospect show, plus the quote block.
//   • Won and Lost branch off the end. Both see the whole linear form, but they
//     require different things: a Won needs the quote it was won on plus a final
//     value; a Lost only needs the outcome (competitor + reason), because a deal
//     can be lost before it was ever quoted.
//   • the form is a two-STEP wizard. Step 1 is the deal itself; step 2 is the
//     quotation (its attributes, line items and PDF). A stage with no quote
//     block — Suspect, Prospect — has no step 2 and submits from step 1.

export const CREATE_STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'] as const;
export type CreateStage = typeof CREATE_STAGES[number];

// Rank on the linear pipeline. Won and Lost sit at the end (rank 4) so a field
// that appears "from Quoted" (rank 2) is visible on them too.
export const STAGE_RANK: Record<CreateStage, number> = {
  Suspect: 0, Prospect: 1, Quoted: 2, Negotiating: 3, Won: 4, Lost: 4,
};

// Default probability the form pre-fills when a stage is picked.
export const STAGE_PROB: Record<CreateStage, number> = {
  Suspect: 20, Prospect: 40, Quoted: 60, Negotiating: 75, Won: 100, Lost: 0,
};

export const STAGE_HINT: Record<CreateStage, string> = {
  Suspect:     'Early-stage lead, roughly 1–2 years out. Just the basics for now.',
  Prospect:    'Active interest, roughly 6 months out. Add a value estimate.',
  Quoted:      'A quotation has been issued. The next step captures the quote, offer, line items and PDF.',
  Negotiating: 'In active negotiation — the quote is on the table and terms are moving.',
  Won:         'Order in hand. The next step captures the quote it was won on; here, the final booked value.',
  Lost:        'Deal lost — record who to and why. Feeds win-rate and competitor analysis.',
};

export type FieldKind = 'text' | 'inr' | 'usd' | 'number' | 'date' | 'month' | 'select' | 'prob_code' | 'textarea';

export interface OppFieldDef {
  name: string;                 // form field name === db column (or *_inr rupee input)
  label: string;
  kind: FieldKind;
  /** Which wizard step the field lives on. 1 = the deal, 2 = the quotation. */
  step: 1 | 2;
  /** Lowest linear rank at which the field appears. */
  visibleFrom: number;
  /** If set, the field shows ONLY on these stages (overrides visibleFrom). */
  onlyStages?: CreateStage[];
  /** Stages on which the field is mandatory. */
  requiredAt?: CreateStage[];
  options?: string[];
  placeholder?: string;
  help?: string;
  full?: boolean;               // span both columns
}

const ALL_LINEAR: CreateStage[] = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'];
const FROM_PROSPECT: CreateStage[] = ['Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'];
// Quote fields are required once quoted, and for a Won (won on a quote) — but
// NOT for a Lost, which may have been lost before any quote went out.
const QUOTE_REQ: CreateStage[] = ['Quoted', 'Negotiating', 'Won'];

// Field catalogue, in render order, grouped by step. Step 1 first (the deal),
// then step 2 (the quotation). The two full-width identifiers — product and
// project — lead step 1.
export const OPP_FIELDS: OppFieldDef[] = [
  // ── Step 1 · the deal ─────────────────────────────────────────
  { name: 'product',      label: 'Product / Description', kind: 'text',   step: 1, visibleFrom: 0, requiredAt: ALL_LINEAR, placeholder: 'e.g. PCP × 3 MX-80 · Spent Wash', full: true },
  { name: 'unit_project', label: 'Project Name / Unit',   kind: 'text',   step: 1, visibleFrom: 0, placeholder: 'e.g. Balrampur Chini — Unit 2, Spent Wash', full: true },
  { name: 'product_type', label: 'Product Type',          kind: 'select', step: 1, visibleFrom: 0, requiredAt: ALL_LINEAR, options: ['PCP', 'MMP', 'Spares', 'Service', 'Other'] },
  { name: 'value_inr',    label: 'Value (₹)',             kind: 'inr',    step: 1, visibleFrom: 0, requiredAt: FROM_PROSPECT, placeholder: 'e.g. 2500000', help: 'Full amount in rupees' },
  { name: 'probability_code', label: 'Probability',       kind: 'prob_code', step: 1, visibleFrom: 0, help: 'RIL likelihood code' },
  { name: 'eta_text',     label: 'Expected Close',        kind: 'month',  step: 1, visibleFrom: 1 },

  // Outcome fields — deal-level, not quote-level, so they stay on step 1.
  { name: 'final_value_inr', label: 'Final Value (₹)',    kind: 'inr',    step: 1, visibleFrom: 4, onlyStages: ['Won'], requiredAt: ['Won'], placeholder: 'e.g. 2500000', help: 'Full booked amount in rupees' },
  { name: 'po_number',    label: 'PO Number',             kind: 'text',   step: 1, visibleFrom: 4, onlyStages: ['Won'], placeholder: 'e.g. PO-2024-0182' },
  { name: 'lost_to_competitor', label: 'Lost To Competitor', kind: 'select', step: 1, visibleFrom: 4, onlyStages: ['Lost'], requiredAt: ['Lost'], options: [] /* competitors API + fixed tail */ },
  { name: 'lost_reason',  label: 'Lost Reason',           kind: 'select', step: 1, visibleFrom: 4, onlyStages: ['Lost'], requiredAt: ['Lost'], options: [
    'Price — Too expensive', 'Technical — Spec mismatch', 'OEM Tied — Forced preference',
    'Relationship — Existing supplier', 'Budget — Project cancelled', 'Delivery — Timeline mismatch',
    'No decision — Deferred', 'Other',
  ] },

  // Retired from the forms 2026-08 (negotiation_notes, client_status_at_quote,
  // qtn_prepared_by, qtr, location). The COLUMNS stay — historic values are still
  // read by the Excel export and shown read-only on the quotation summary — they
  // are simply no longer asked for on any form.
  { name: 'notes',        label: 'Notes', kind: 'textarea', step: 1, visibleFrom: 0, full: true, placeholder: 'Key context, contacts involved, next steps…' },

  // ── Step 2 · the quotation ────────────────────────────────────
  { name: 'quote_ref',    label: 'Quote No.',             kind: 'text',   step: 2, visibleFrom: 2, requiredAt: QUOTE_REQ, placeholder: 'RIL/QT/…' },
  { name: 'quote_date',   label: 'Quote Date',            kind: 'date',   step: 2, visibleFrom: 2, requiredAt: QUOTE_REQ },
  { name: 'enquiry_no',   label: 'Enquiry No.',           kind: 'text',   step: 2, visibleFrom: 2, requiredAt: QUOTE_REQ, placeholder: 'RIL/EN/…' },
  { name: 'enquiry_date', label: 'Enquiry Date',          kind: 'date',   step: 2, visibleFrom: 2 },
  { name: 'market',       label: 'Market',                kind: 'select', step: 2, visibleFrom: 2, requiredAt: QUOTE_REQ, options: ['DOMESTIC', 'EXPORT'] },
  // USD is never typed — it's derived from the settings rate and rendered as
  // sub-text under the rupee figure, so there is only one number to keep right.
  // The single Revised Offer / Revised Offer Date pair is gone too: a quote gets
  // re-priced more than once, so revisions are their own timestamped list
  // (OfferRevisionsField → opportunity_offer_revisions, migration 0041).
  { name: 'offer_value_inr', label: 'Total Offer (₹)',    kind: 'number', step: 2, visibleFrom: 2, requiredAt: QUOTE_REQ, help: 'Auto-sums line items if left blank' },
];

/** Fixed competitor fallbacks appended after the live competitors list. */
export const LOST_COMPETITOR_TAIL = ['Price — No specific competitor', 'OEM Tied', 'Budget Cancelled', 'Other'];

/**
 * Why an opportunity was Dropped, asked whenever the stage moves to Dropped
 * (the kanban completion modal and the Edit drawer both use this list, and
 * updateOpportunity validates against it). Distinct from lost_reason: Lost is
 * "we competed and didn't win", Dropped is "the requirement went away".
 * Dropped is not in CREATE_STAGES — an opportunity is only ever moved to it —
 * so this lives outside OPP_FIELDS rather than in the create wizard's catalogue.
 */
export const DROP_REASONS = [
  'Closed deferred to next season',
  'Repeat or duplicate offer',
  'Requirement closed',
  'Technically disqualified',
  'Closed no response from client',
] as const;
export type DropReason = typeof DROP_REASONS[number];

export const isDropReason = (v: unknown): v is DropReason =>
  typeof v === 'string' && (DROP_REASONS as readonly string[]).includes(v);

export function isFieldVisible(f: OppFieldDef, stage: CreateStage): boolean {
  if (f.onlyStages) return f.onlyStages.includes(stage);
  return STAGE_RANK[stage] >= f.visibleFrom;
}

export function isFieldRequired(f: OppFieldDef, stage: CreateStage): boolean {
  return !!f.requiredAt?.includes(stage) && isFieldVisible(f, stage);
}

/** Visible fields for one wizard step, in catalogue order. */
export function fieldsForStep(stage: CreateStage, step: 1 | 2): OppFieldDef[] {
  return OPP_FIELDS.filter(f => f.step === step && isFieldVisible(f, stage));
}

/** Does this stage have a quotation step at all? (Quoted and beyond.) */
export function stageHasQuoteStep(stage: CreateStage): boolean {
  return fieldsForStep(stage, 2).length > 0;
}

/** Names of the fields the server must see filled for a given stage. */
export function requiredFieldNames(stage: CreateStage): string[] {
  return OPP_FIELDS.filter(f => isFieldRequired(f, stage)).map(f => f.name);
}

/** Required field names on a given wizard step — for per-step gating. */
export function requiredFieldNamesForStep(stage: CreateStage, step: 1 | 2): string[] {
  return OPP_FIELDS.filter(f => f.step === step && isFieldRequired(f, stage)).map(f => f.name);
}

/** Human labels for a set of field names, for error messages. */
export function labelsFor(names: string[]): string[] {
  return names.map(n => OPP_FIELDS.find(f => f.name === n)?.label ?? n);
}
