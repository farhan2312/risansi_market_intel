// RIL probability code — the single vocabulary for how likely a quoted
// opportunity is to convert. It is a controlled 1–4 scale, not a free number,
// so it can be filtered and reported on consistently. One definition, shared by
// the entry dropdown (QuotedDetailsModal) and the Opportunities filter, so the
// two can never drift.

export interface ProbabilityCode {
  code: string;         // stored value in opportunities.probability_code
  pct: number;          // the odds it stands for
  /** Short gloss shown next to the code so its meaning is self-evident. */
  gloss: string;
}

export const PROBABILITY_CODES: ProbabilityCode[] = [
  { code: '1', pct: 90, gloss: 'very likely' },
  { code: '2', pct: 40, gloss: 'possible' },
  { code: '3', pct: 20, gloss: 'long shot' },
  { code: '4', pct: 0,  gloss: 'no chance of the order' },
];

/** Dropdown/filter label, e.g. "1 — 90% (very likely)" / "4 — No chance of the order". */
export function probabilityCodeLabel(c: ProbabilityCode): string {
  return c.pct > 0
    ? `${c.code} — ${c.pct}% (${c.gloss})`
    : `${c.code} — No chance of the order`;
}

/** Filter options in the shape MultiSelectFilter expects. */
export const PROBABILITY_CODE_OPTIONS = PROBABILITY_CODES.map(c => ({
  value: c.code,
  label: probabilityCodeLabel(c),
}));
