// A submitted field report stays correctable for a short window so a rep can
// fix a genuine mistake without an admin round-trip. After the window it locks
// for good. Every edit made inside the window is written to the client's
// activity log, so a corrected report is always auditable against its original
// submission.

export const VISIT_EDIT_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

const toMs = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Unsubmitted visits are always editable; submitted ones for the window only. */
export function withinVisitEditWindow(submittedAt: string | Date | null | undefined): boolean {
  const t = toMs(submittedAt);
  if (t == null) return true;
  return Date.now() - t < VISIT_EDIT_WINDOW_DAYS * DAY_MS;
}

/** Whole days left to correct a submitted report (0 once the window has closed). */
export function visitEditDaysLeft(submittedAt: string | Date | null | undefined): number {
  const t = toMs(submittedAt);
  if (t == null) return VISIT_EDIT_WINDOW_DAYS;
  return Math.max(0, Math.ceil((VISIT_EDIT_WINDOW_DAYS * DAY_MS - (Date.now() - t)) / DAY_MS));
}

/** SQL predicate form, for guarding an UPDATE directly. */
export const VISIT_EDITABLE_SQL = (col = 'submitted_at') =>
  `(${col} IS NULL OR ${col} > NOW() - INTERVAL '${VISIT_EDIT_WINDOW_DAYS} days')`;
