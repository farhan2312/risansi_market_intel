import type { CSSProperties } from 'react';
import { SORT_KEYS, type ComplaintListRow, type ComplaintSort, type ComplaintSortKey } from '@/lib/risansi-complaint-rows';
import { ComplaintTableClient } from './ComplaintTableClient';

// The complaints list as a table: one row per complaint, open first, each
// saying where it is, who is holding it and for how long.
//
// The table itself is a client component, because the column picker and the
// scroll position are the reader's to keep. This half stays on the server so
// the page can keep handing us a `sortHref` function: functions do not cross
// into a client component, so the four sort links are resolved here and go
// over as plain strings.

export function ComplaintTable({ rows, sort, sortHref }: {
  rows: ComplaintListRow[];
  sort?: ComplaintSort | null;
  sortHref?: (key: ComplaintSortKey) => string;
}) {
  if (!rows.length) return <div style={{ ...PANEL, padding: 32, textAlign: 'center', fontSize: 12.5, color: 'var(--fg-3)' }}>No complaints match. Clear a filter, or raise one.</div>;

  const sortHrefs: Partial<Record<ComplaintSortKey, string>> | null = sortHref
    ? Object.fromEntries(SORT_KEYS.map(k => [k, sortHref(k)]))
    : null;

  return <ComplaintTableClient rows={rows} sort={sort ?? null} sortHrefs={sortHrefs} />;
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
