/**
 * Exhibition module — shared vocabulary and money helpers.
 *
 * Single source of truth for the module's enums, mirroring how
 * lib/risansi-opportunity-fields.ts serves the pipeline. Every dropdown, badge,
 * filter and validation reads from here so the UI and the server cannot drift.
 *
 * Money note: exhibition figures are RUPEES throughout — never crores. The
 * pipeline stores value_cr / final_value_cr in crores; mixing the two units is
 * the failure mode that has already cost this codebase real data, so nothing in
 * this module converts to crores except at a display boundary.
 */

export const EXHIBITION_STATUSES = [
  'Draft',
  'Shortlisted',
  'Submitted',
  'Approved',
  'Rejected',
  'Ongoing',
  'Completed',
  'Closed',
] as const;
export type ExhibitionStatus = typeof EXHIBITION_STATUSES[number];

/** Statuses a user may pick directly. Submitted/Approved/Rejected are reached
 *  only through the approval actions, never by editing a dropdown. */
export const EDITABLE_STATUSES: readonly ExhibitionStatus[] = [
  'Draft', 'Shortlisted', 'Ongoing', 'Completed', 'Closed',
];

/** Still in the running — used for the "active" KPI and the default board. */
export const OPEN_STATUSES: readonly ExhibitionStatus[] = [
  'Draft', 'Shortlisted', 'Submitted', 'Approved', 'Ongoing',
];

export const PARTICIPATION = ['Exhibit', 'Visit'] as const;
export type Participation = typeof PARTICIPATION[number];

/** What the approver may decide. 'More Info' bounces it back to the submitter
 *  without losing the earlier trail. */
export const DECISIONS = ['Exhibit', 'Visit', 'Reject', 'More Info'] as const;
export type Decision = typeof DECISIONS[number];

export const TEAM_ROLES = ['Team Lead', 'Member'] as const;
export type TeamRole = typeof TEAM_ROLES[number];

export const EXPENSE_CATEGORIES = [
  'Stall / Booth',
  'Registration',
  'Travel',
  'Hotel',
  'Branding & Printing',
  'Delegate Fees',
  'Logistics',
  'Miscellaneous',
] as const;

export const INTEREST_LEVELS = ['Hot', 'Warm', 'Cold'] as const;
export type Interest = typeof INTEREST_LEVELS[number];

export const DISCOVERY_SOURCES = [
  'Website', 'LinkedIn', 'Email', 'Organizer', 'Referral', 'Other',
] as const;

// ── Status presentation ──────────────────────────────────────────
// Tokens only — never raw hex, so both themes stay correct.
export const STATUS_TONE: Record<ExhibitionStatus, { bg: string; fg: string }> = {
  'Draft':       { bg: 'var(--bg-elev)',    fg: 'var(--fg-2)' },
  'Shortlisted': { bg: 'var(--accent-soft)', fg: 'var(--title)' },
  'Submitted':   { bg: 'var(--warn-soft, var(--accent-soft))', fg: 'var(--title)' },
  'Approved':    { bg: 'var(--pos-soft)',   fg: 'var(--pos-strong)' },
  'Rejected':    { bg: 'var(--neg-soft)',   fg: 'var(--neg-strong)' },
  'Ongoing':     { bg: 'var(--accent-soft)', fg: 'var(--title)' },
  'Completed':   { bg: 'var(--pos-soft)',   fg: 'var(--pos-strong)' },
  'Closed':      { bg: 'var(--bg-elev)',    fg: 'var(--fg-3)' },
};

export const isExhibitionStatus = (v: unknown): v is ExhibitionStatus =>
  typeof v === 'string' && (EXHIBITION_STATUSES as readonly string[]).includes(v);

export const isDecision = (v: unknown): v is Decision =>
  typeof v === 'string' && (DECISIONS as readonly string[]).includes(v);

// ── Money (rupees) ───────────────────────────────────────────────

/** Compact rupee label: 12,50,000 → "₹12.5 L", 1,20,00,000 → "₹1.2 Cr". */
export function fmtInr(v: number | string | null | undefined): string {
  const n = v == null ? NaN : Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Full rupee figure with Indian grouping, for tables and totals. */
export function fmtInrFull(v: number | string | null | undefined): string {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—';
}

export interface ExpenseTotals {
  estimated: number;
  actual: number;
  paid: number;
  pending: number;   // actual not yet paid
  variance: number;  // actual vs estimated; positive = over budget
}

/** Roll a set of expense lines into the figures the UI shows. Kept pure so the
 *  detail page, the board and any export all agree by construction. */
export function sumExpenses(
  rows: { estimated_inr?: number | string | null; actual_inr?: number | string | null; paid_inr?: number | string | null }[],
): ExpenseTotals {
  const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
  const estimated = rows.reduce((s, r) => s + num(r.estimated_inr), 0);
  const actual    = rows.reduce((s, r) => s + num(r.actual_inr), 0);
  const paid      = rows.reduce((s, r) => s + num(r.paid_inr), 0);
  return { estimated, actual, paid, pending: Math.max(0, actual - paid), variance: actual - estimated };
}

/** Inclusive day count for an event, used on cards and the detail header. */
export function eventDays(start?: string | null, end?: string | null): number | null {
  if (!start) return null;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${(end || start)}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}
