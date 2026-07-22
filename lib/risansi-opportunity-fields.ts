// One definition of what an opportunity form asks for, per stage. The create
// modal renders from it and the server validates against it, so the two can
// never disagree about which fields show or which are required.
//
// Two ideas drive it:
//   • visibility is CUMULATIVE up the linear pipeline — pick Quoted and you see
//     everything a Suspect and Prospect show, plus the quote block.
//   • Won and Lost branch off the end. Both see the whole linear form, but they
//     require different things: a Won needs the quote it was won on plus a final
//     value; a Lost only needs the outcome (competitor + reason), because a deal
//     can be lost before it was ever quoted.

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
  Quoted:      'A quotation has been issued — capture the quote, offer and any line items.',
  Negotiating: 'In active negotiation — the quote is on the table and terms are moving.',
  Won:         'Order in hand. Everything the quote carried, plus the final booked value.',
  Lost:        'Deal lost — record who to and why. Feeds win-rate and competitor analysis.',
};

export type FieldKind = 'text' | 'inr' | 'usd' | 'number' | 'date' | 'select' | 'prob_code' | 'textarea';

export interface OppFieldDef {
  name: string;                 // form field name === db column (or *_inr rupee input)
  label: string;
  kind: FieldKind;
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

// Field catalogue, in render order. `product`/`product_type` are the identity
// block shown before any stage-specific section.
export const OPP_FIELDS: OppFieldDef[] = [
  // ── Identity (always) ─────────────────────────────────────────
  { name: 'product',      label: 'Product / Description', kind: 'text',   visibleFrom: 0, requiredAt: ALL_LINEAR, placeholder: 'e.g. PCP × 3 MX-80 · Spent Wash', full: true },
  { name: 'product_type', label: 'Product Type',          kind: 'select', visibleFrom: 0, requiredAt: ALL_LINEAR, options: ['PCP', 'MMP', 'Spares', 'Service', 'Other'] },
  { name: 'value_inr',    label: 'Value (₹)',             kind: 'inr',    visibleFrom: 0, requiredAt: FROM_PROSPECT, placeholder: 'e.g. 2500000', help: 'Full amount in rupees' },
  { name: 'probability',  label: 'Probability %',         kind: 'number', visibleFrom: 0 },

  // ── Prospect ──────────────────────────────────────────────────
  { name: 'eta_text',     label: 'Expected Close',        kind: 'text',   visibleFrom: 1, placeholder: 'e.g. Jun 2026 or Q3 FY27' },

  // ── Quoted (the quote block) ──────────────────────────────────
  { name: 'quote_ref',    label: 'Quote No.',             kind: 'text',   visibleFrom: 2, requiredAt: QUOTE_REQ, placeholder: 'RIL/QT/…' },
  { name: 'quote_date',   label: 'Quote Date',            kind: 'date',   visibleFrom: 2, requiredAt: QUOTE_REQ },
  { name: 'enquiry_no',   label: 'Enquiry No.',           kind: 'text',   visibleFrom: 2, requiredAt: QUOTE_REQ, placeholder: 'RIL/EN/…' },
  { name: 'enquiry_date', label: 'Enquiry Date',          kind: 'date',   visibleFrom: 2 },
  { name: 'market',       label: 'Market',                kind: 'select', visibleFrom: 2, requiredAt: QUOTE_REQ, options: ['DOMESTIC', 'EXPORT'] },
  { name: 'offer_value_inr', label: 'Total Offer (₹)',    kind: 'number', visibleFrom: 2, requiredAt: QUOTE_REQ, help: 'Auto-sums line items if left blank' },
  { name: 'offer_value_usd', label: 'Total Offer (USD)',  kind: 'number', visibleFrom: 2 },
  { name: 'probability_code', label: 'Probability Code',  kind: 'prob_code', visibleFrom: 2 },
  { name: 'ril_rep',      label: 'RIL Rep',               kind: 'text',   visibleFrom: 2, placeholder: 'e.g. NI' },
  { name: 'qtn_prepared_by', label: 'Qtn. Prepared By',   kind: 'text',   visibleFrom: 2 },
  { name: 'client_status_at_quote', label: 'Client Status', kind: 'select', visibleFrom: 2, options: ['NEW', 'EXISTING'] },
  { name: 'qtr',          label: 'Quarter',               kind: 'select', visibleFrom: 2, options: ['Q1', 'Q2', 'Q3', 'Q4'] },
  { name: 'unit_project', label: 'Project Name / Unit',   kind: 'text',   visibleFrom: 2 },
  { name: 'location',     label: 'Location',              kind: 'text',   visibleFrom: 2 },
  { name: 'revised_offer_value_inr', label: 'Revised Offer (₹)',  kind: 'number', visibleFrom: 2 },
  { name: 'revised_offer_value_usd', label: 'Revised Offer (USD)', kind: 'number', visibleFrom: 2 },
  { name: 'revised_offer_date', label: 'Revised Offer Date', kind: 'date', visibleFrom: 2 },

  // ── Negotiating ───────────────────────────────────────────────
  { name: 'negotiation_notes', label: 'Negotiation Notes', kind: 'textarea', visibleFrom: 3, full: true },

  // ── Won (only) ────────────────────────────────────────────────
  { name: 'final_value_inr', label: 'Final Value (₹)',    kind: 'inr',    visibleFrom: 4, onlyStages: ['Won'], requiredAt: ['Won'], placeholder: 'e.g. 2500000', help: 'Full booked amount in rupees' },
  { name: 'po_number',    label: 'PO Number',             kind: 'text',   visibleFrom: 4, onlyStages: ['Won'], placeholder: 'e.g. PO-2024-0182' },

  // ── Lost (only) ───────────────────────────────────────────────
  { name: 'lost_to_competitor', label: 'Lost To Competitor', kind: 'select', visibleFrom: 4, onlyStages: ['Lost'], requiredAt: ['Lost'], options: [] /* filled from the competitors API + fixed tail */ },
  { name: 'lost_reason',  label: 'Lost Reason',           kind: 'select', visibleFrom: 4, onlyStages: ['Lost'], requiredAt: ['Lost'], options: [
    'Price — Too expensive', 'Technical — Spec mismatch', 'OEM Tied — Forced preference',
    'Relationship — Existing supplier', 'Budget — Project cancelled', 'Delivery — Timeline mismatch',
    'No decision — Deferred', 'Other',
  ] },

  // ── Notes (always, rendered last) ─────────────────────────────
  { name: 'notes',        label: 'Notes', kind: 'textarea', visibleFrom: 0, full: true, placeholder: 'Key context, contacts involved, next steps…' },
];

/** Fixed competitor fallbacks appended after the live competitors list. */
export const LOST_COMPETITOR_TAIL = ['Price — No specific competitor', 'OEM Tied', 'Budget Cancelled', 'Other'];

export function isFieldVisible(f: OppFieldDef, stage: CreateStage): boolean {
  if (f.onlyStages) return f.onlyStages.includes(stage);
  return STAGE_RANK[stage] >= f.visibleFrom;
}

export function isFieldRequired(f: OppFieldDef, stage: CreateStage): boolean {
  return !!f.requiredAt?.includes(stage) && isFieldVisible(f, stage);
}

/** Names of the fields the server must see filled for a given stage. */
export function requiredFieldNames(stage: CreateStage): string[] {
  return OPP_FIELDS.filter(f => isFieldRequired(f, stage)).map(f => f.name);
}

/** Human labels for a set of field names, for error messages. */
export function labelsFor(names: string[]): string[] {
  return names.map(n => OPP_FIELDS.find(f => f.name === n)?.label ?? n);
}
