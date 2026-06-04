// ── FY helpers ─────────────────────────────────────────────────

export interface FYInfo {
  label:     string;  // 'FY 25-26'
  code:      string;  // '25-26'
  startDate: string;  // '2025-04-01'
  endDate:   string;  // '2026-03-31'
}

/** Current operational FY — April 2025 → March 2026 */
export function getCurrentFY(): FYInfo {
  return {
    label:     'FY 25-26',
    code:      '25-26',
    startDate: '2025-04-01',
    endDate:   '2026-03-31',
  };
}

/** Previous N completed FYs, oldest first. E.g. n=5 → ['20-21'…'24-25'] */
export function getPreviousFYCodes(n: number): string[] {
  const startYear = 25; // current FY start year (2025)
  const codes: string[] = [];
  for (let i = n; i >= 1; i--) {
    const s = startYear - i;
    const e = s + 1;
    codes.push(`${String(s).padStart(2, '0')}-${String(e).padStart(2, '0')}`);
  }
  return codes;
}

/** Short label for a FY code: '21-22' → 'FY22' (uses end-year) */
export function fyShortLabel(code: string): string {
  const end = code.split('-')[1];
  return `FY${end}`;
}

/** How far through the FY we are, 0–100 */
export function fyYtdPct(fy: FYInfo): number {
  const start = new Date(fy.startDate).getTime();
  const end   = new Date(fy.endDate).getTime();
  const now   = Date.now();
  if (now >= end)   return 100;
  if (now <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 100);
}

/** Calendar days remaining in FY (0 if ended) */
export function fyDaysLeft(fy: FYInfo): number {
  const end = new Date(fy.endDate).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

// ── Date / time formatting ─────────────────────────────────────

/** "Friday, 30 May 2026" */
export function formatIndianDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  });
}

/** "14:32" from a Date */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
}

/** Full days elapsed since a date string ('YYYY-MM-DD' or ISO). Returns 0 for future dates. */
export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

// ── Last-visit display ─────────────────────────────────────────
// Single source of truth for rendering clients.last_visit_date.
// A future date means a *planned* visit leaked into last_visit_date —
// it is never a real "last visit", so we treat it as "never visited".

/** Whole days from `dateStr` (midnight) to today (midnight). Negative = future. */
function daysBetweenTodayAnd(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - date.getTime()) / 86_400_000);
}

/** Rich last-visit label for KPI cards / detail views. */
export function formatLastVisit(
  dateStr: string | null | undefined,
): { label: string; color: string; isOverdue: boolean } {
  const never = { label: 'Never visited', color: 'var(--neg)', isOverdue: true };
  if (!dateStr) return never;

  const diffDays = daysBetweenTodayAnd(dateStr);
  if (diffDays == null) return never;

  // Future date (planned visit showing as last visit) → treat as never
  if (diffDays < 0)   return never;
  if (diffDays === 0) return { label: 'Today',     color: 'var(--pos)',  isOverdue: false };
  if (diffDays === 1) return { label: '1 day ago', color: 'var(--pos)',  isOverdue: false };
  if (diffDays <= 30) return { label: `${diffDays} days ago`, color: 'var(--pos)',  isOverdue: false };
  if (diffDays <= 90) return { label: `${diffDays} days ago`, color: 'var(--warn)', isOverdue: false };
  if (diffDays <= 365) return { label: `${diffDays} days ago`, color: 'var(--neg)', isOverdue: true };

  const years = Math.floor(diffDays / 365);
  return {
    label: years === 1 ? '1 year ago' : `${years} years ago`,
    color: 'var(--neg)',
    isOverdue: true,
  };
}

/** Short last-visit label for dense tables. */
export function formatLastVisitShort(
  dateStr: string | null | undefined,
): { label: string; color: string } {
  if (!dateStr) return { label: 'Never', color: 'var(--neg)' };

  const days = daysBetweenTodayAnd(dateStr);
  if (days == null || days < 0) return { label: 'Never', color: 'var(--neg)' };
  if (days === 0) return { label: 'Today',     color: 'var(--pos)' };
  if (days <= 30) return { label: `${days}d`,  color: 'var(--pos)' };
  if (days <= 90) return { label: `${days}d`,  color: 'var(--warn)' };
  if (days <= 365) return { label: `${days}d`, color: 'var(--neg)' };
  return { label: `${Math.floor(days / 365)}yr`, color: 'var(--neg)' };
}

// ── Currency formatting ────────────────────────────────────────

/** ₹12.4 Cr — null-safe. For values already in Crores (orders.order_value_cr, sales_targets). */
export function fmtCr(val: number | null | undefined, decimals = 1): string {
  if (val == null || isNaN(val)) return '—';
  return `₹${val.toFixed(decimals)} Cr`;
}

/** ₹X.XX L — for values already divided by 100_000 (in Lakhs). */
export function fmtL(val: number | null | undefined, decimals = 2): string {
  if (val == null || isNaN(val) || val === 0) return '—';
  return `₹${val.toFixed(decimals)} L`;
}

export function formatRev(val: number | null | undefined): string {
  const n = Number(val ?? 0)
  if (!n) return '—'
  if (n >= 10_000_000) return '₹' + (n / 10_000_000).toFixed(2) + ' Cr'
  if (n >= 100_000)    return '₹' + (n / 100_000).toFixed(2) + ' L'
  if (n >= 1_000)      return '₹' + (n / 1_000).toFixed(1) + 'K'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

export function revDelta(curr: number | null, prev: number | null): string {
  const c = Number(curr ?? 0)
  const p = Number(prev ?? 0)
  if (!p) return '—'
  const pct = ((c - p) / p) * 100
  const sign = pct >= 0 ? '+' : ''
  return sign + pct.toFixed(1) + '%'
}

export function revDeltaPos(curr: number | null, prev: number | null): boolean {
  return Number(curr ?? 0) >= Number(prev ?? 0)
}

export function formatDate(val: string | Date | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch { return '—'; }
}

export function visitHealthColor(days: number | null, tier: string): string {
  if (days === null) return 'var(--neg)';
  const threshold = tier === 'Key' ? 100 : 200;
  if (days > threshold) return 'var(--neg)';
  if (days > threshold * 0.75) return 'var(--warn)';
  return 'var(--pos)';
}

export function safeNum(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// ── Name helpers ───────────────────────────────────────────────

/** "VB" initials from a display name */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

// ── Visit / alert helpers ──────────────────────────────────────

/**
 * CSS variable string for a visit status badge.
 * Maps to the design token system.
 */
export function getVisitStatusColor(status: string): string {
  const map: Record<string, string> = {
    'planned':    'var(--info)',
    'checked-in': 'var(--accent)',
    'completed':  'var(--pos)',
    'missed':     'var(--neg)',
  };
  return map[status.toLowerCase()] ?? 'var(--fg-3)';
}

/**
 * Alert level based on days since last visit and client tier.
 *
 * Tier A (key account) — visit every 30 days
 * Tier B (regular)     — visit every 60 days
 * Tier C (long-tail)   — visit every 90 days
 */
const TIER_OVERDUE:   Record<string, number> = { A: 30,  B: 60,  C: 90  };
const TIER_DUE_SOON:  Record<string, number> = { A: 21,  B: 45,  C: 70  };

export function getAlertLevel(
  daysSinceVisit: number,
  tier: string,
): 'overdue' | 'due-soon' | 'ok' {
  const t        = tier.toUpperCase();
  const overdue  = TIER_OVERDUE[t]  ?? 90;
  const dueSoon  = TIER_DUE_SOON[t] ?? 70;
  if (daysSinceVisit >= overdue)  return 'overdue';
  if (daysSinceVisit >= dueSoon)  return 'due-soon';
  return 'ok';
}

// ── Greeting ──────────────────────────────────────────────────

/** IST-aware server-side greeting. Runs at render time. */
export function getGreeting(): string {
  const now = new Date();
  // IST = UTC + 5:30
  const ist  = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const hour = ist.getUTCHours();
  if (hour >= 5  && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 21) return 'Good Evening';
  return 'Good Evening';
}

// ── Industry normalisation ─────────────────────────────────────

const INDUSTRY_ALIASES: Record<string, string> = {
  'oil and gas':         'Oil & Gas',
  'oil & gas':           'Oil & Gas',
  'o&g':                 'Oil & Gas',
  'oil/gas':             'Oil & Gas',
  'water treatment':     'Water',
  'water & wastewater':  'Water',
  'water':               'Water',
  'chemical':            'Chemicals',
  'chemicals':           'Chemicals',
  'food and beverage':   'Food & Beverage',
  'food & beverage':     'Food & Beverage',
  'f&b':                 'Food & Beverage',
  'food':                'Food & Beverage',
  'power':               'Power Generation',
  'power generation':    'Power Generation',
  'power & energy':      'Power Generation',
  'mining':              'Mining',
  'mining & minerals':   'Mining',
  'pharmaceuticals':     'Pharma',
  'pharmaceutical':      'Pharma',
  'pharma':              'Pharma',
  'paper':               'Pulp & Paper',
  'pulp and paper':      'Pulp & Paper',
  'pulp & paper':        'Pulp & Paper',
  'cement':              'Cement',
  'steel':               'Steel & Metals',
  'metals':              'Steel & Metals',
  'steel & metals':      'Steel & Metals',
};

/**
 * Normalise a raw industry string from DB or user input
 * to a canonical display name. Falls back to Title Case.
 */
export function normaliseIndustry(name: string): string {
  if (!name) return 'Other';
  const key = name.toLowerCase().trim();
  return (
    INDUSTRY_ALIASES[key] ??
    name
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── UI labels ──────────────────────────────────────────────────
// Single source of truth for the Plan Visit button label across the app.
export const PLAN_VISIT_LABEL = 'Plan Visit';
