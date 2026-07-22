// Shared bug-tracker vocabulary — imported by the server actions, the admin page,
// and the client kanban so the status pipeline stays defined in exactly one place.

export const BUG_STATUSES = ['reported', 'recorded', 'in_progress', 'testing', 'fixed'] as const;
export type BugStatus = typeof BUG_STATUSES[number];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  reported:    'Reported',
  recorded:    'Recorded',
  in_progress: 'In Progress',
  testing:     'Testing',
  fixed:       'Fixed / Closed',
};

// One-line hint under each pipeline column header.
export const BUG_STATUS_HINTS: Record<BugStatus, string> = {
  reported:    'User submitted',
  recorded:    'Verified by admin',
  in_progress: 'Being worked on',
  testing:     'Under verification',
  fixed:       'Resolved & closed',
};

// Chosen so white text on the colour meets WCAG AA (≥4.5:1) for the active pills.
export const BUG_STATUS_COLORS: Record<BugStatus, string> = {
  reported:    '#64748B',
  recorded:    '#2563EB',
  in_progress: '#B45309',
  testing:     '#7C3AED',
  fixed:       '#0B7A55',
};

export function isBugStatus(v: unknown): v is BugStatus {
  return typeof v === 'string' && (BUG_STATUSES as readonly string[]).includes(v);
}

export const BUG_SEVERITIES = ['low', 'medium', 'high'] as const;
export type BugSeverity = typeof BUG_SEVERITIES[number];

export const BUG_SEVERITY_LABELS: Record<BugSeverity, string> = {
  low: 'Low', medium: 'Medium', high: 'High',
};

export const BUG_SEVERITY_COLORS: Record<BugSeverity, string> = {
  low: '#64748B', medium: '#B45309', high: '#C81E1E',
};

export function isBugSeverity(v: unknown): v is BugSeverity {
  return typeof v === 'string' && (BUG_SEVERITIES as readonly string[]).includes(v);
}

/** "3h", "2d", "45m" — compact elapsed time between two ISO/Date values. */
export function turnaround(fromISO: string | Date | null, toISO: string | Date | null): string {
  if (!fromISO || !toISO) return '—';
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const mins = Math.round((b - a) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}
