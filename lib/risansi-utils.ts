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
  // Current FY start year = 2025 (from '25-26')
  const startYear = 25;
  const codes: string[] = [];
  for (let i = n; i >= 1; i--) {
    const s = startYear - i;
    const e = s + 1;
    codes.push(`${String(s).padStart(2, '0')}-${String(e).padStart(2, '0')}`);
  }
  return codes; // ['20-21','21-22','22-23','23-24','24-25']
}

/** Short label for a FY code: '21-22' → 'FY22' (uses end-year) */
export function fyShortLabel(code: string): string {
  const end = code.split('-')[1];
  return `FY${end}`;
}

/** How far through the FY we are, 0-100 */
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
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** ₹12.4 Cr — null safe */
export function fmtCr(val: number | null | undefined, decimals = 1): string {
  if (val == null || isNaN(val)) return '—';
  return `₹${val.toFixed(decimals)} Cr`;
}

/** Initials from a display name */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}
