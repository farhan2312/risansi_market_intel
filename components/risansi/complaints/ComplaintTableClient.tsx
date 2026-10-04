'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SEVERITY_TONE, SEVERITIES, STATUS_TONE, STATUSES, LEGACY_STATUSES, statusStep,
  type Severity,
} from '@/lib/risansi-complaint-flow';
import type { ComplaintListRow, ComplaintSort, ComplaintSortKey } from '@/lib/risansi-complaint-rows';
import { useTableSort, SortTH } from '../SortTH';
import type { SortKind, SortableColumn } from '@/lib/risansi-table-sort';

// The complaints list as a table. The rows are decided on the server; this
// half exists because two things about the table are the reader's to choose
// and have to survive a page navigation: which columns they care about, and
// where the table has been scrolled to sideways.
//
// Eighteen columns do not fit a phone, or a laptop for that matter, so the
// table scrolls inside a box about a screen tall instead of being as tall as
// its 200-odd rows. That is the whole point: the horizontal scrollbar is at
// the bottom of what you can see rather than below the last row, and the
// header and the two identifying columns stay put while you scroll.
//
// Sorting is the third thing the reader decides, and it is deliberately NOT
// kept: it lives in component state, so a filter change or a fresh visit puts
// the table back in the order the query chose. The column choice and the
// sort are independent — hiding a column leaves the rows exactly where the
// sort put them, including when the hidden column is the sorted one.

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const fmtDays = (d: number) => (d < 1 ? '<1d' : `${Math.round(d)}d`);

type ColId =
  | 'no' | 'client' | 'status' | 'sev' | 'type' | 'model' | 'qty' | 'freeRepl'
  | 'frEc' | 'frDispatch' | 'holder' | 'since' | 'age' | 'target' | 'rep'
  | 'raised' | 'docs' | 'open';

interface Col {
  id: ColId;
  /** The header label. Empty for the trailing "Open →" column. */
  head: string;
  /** What the column picker calls it, where the header is blank or cryptic. */
  pick?: string;
  right?: boolean;
  /** The complaint number is what makes a row a row, so it is never hideable. */
  locked?: boolean;
  /** How this column sorts. Omitted only where there is nothing to order by. */
  kind?: SortKind;
  /** What to sort on, where the cell prints something other than the raw value. */
  value?: (r: ComplaintListRow) => unknown;
  /** For kind 'status': the sequence that defines the order. */
  order?: readonly string[];
}

// A complaint's statuses in workflow order, the legacy five folded in at the
// step each one stands for. Built from the module's own lists rather than
// retyped, so a status added there cannot drift out of this order.
const STATUS_ORDER: readonly string[] = [...new Set<string>([...STATUSES, ...LEGACY_STATUSES])]
  .sort((a, b) => statusStep(a) - statusStep(b));

// Worst first, from the declared sequence rather than from the key order of a
// colour map, so recolouring the badges cannot reorder the column.
const SEVERITY_ORDER = SEVERITIES;

/** Whether the complaint is still somebody's to move. */
const isOpenRow = (r: ComplaintListRow) => r.status !== 'Resolved' && r.status !== 'Closed';
/** Pre-workflow rows carry no holder and no dwell, and the cells print "—". */
const isLegacyRow = (r: ComplaintListRow) => r.schema_version < 2;

/** Who the "Sitting with" cell names — nobody, on a closed or legacy row. */
const holderLabel = (r: ComplaintListRow): string | null =>
  isOpenRow(r) && !isLegacyRow(r)
    ? (r.holder_name ?? r.holder_department ?? 'Complaint Team')
    : null;

/** What the "Free repl." cell says: Free, Paid, No, or nothing decided yet. */
const freeReplLabel = (r: ComplaintListRow): string | null =>
  r.free_replacement ? 'Free'
    : r.action_category ? (r.action_category === 'Paid Replacement' ? 'Paid' : 'No')
    : null;

const COLUMNS: Col[] = [
  { id: 'no',         head: 'No.', locked: true, kind: 'text', value: r => r.complaint_no },
  { id: 'client',     head: 'Client', kind: 'text', value: r => r.client_name },
  { id: 'status',     head: 'Status', kind: 'status', order: STATUS_ORDER, value: r => r.status },
  { id: 'sev',        head: 'Sev', pick: 'Severity', kind: 'status', order: SEVERITY_ORDER, value: r => r.severity },
  { id: 'type',       head: 'Type · category', kind: 'text', value: r => r.complaint_type },
  { id: 'model',      head: 'Pump model', kind: 'text', value: r => r.pump_model },
  { id: 'qty',        head: 'Qty', pick: 'Quantity', right: true, kind: 'number', value: r => r.quantity },
  { id: 'freeRepl',   head: 'Free repl.', pick: 'Free replacement', kind: 'text', value: freeReplLabel },
  { id: 'frEc',       head: 'FR EC no.', kind: 'text', value: r => r.fr_ec_no },
  { id: 'frDispatch', head: 'FR dispatch', kind: 'date', value: r => r.target_dispatch_date },
  { id: 'holder',     head: 'Sitting with', kind: 'text', value: holderLabel },
  // Days in the current status, which is what the cell prints — longest-sitting
  // first on the first click. Blank on the rows that show "—".
  { id: 'since',      head: 'Since', right: true, kind: 'number',
    value: r => (isOpenRow(r) && !isLegacyRow(r) ? r.days_in_status : null) },
  { id: 'age',        head: 'Age', right: true, kind: 'number', value: r => r.age_days },
  { id: 'target',     head: 'Target', kind: 'date', value: r => r.target_completion_date },
  { id: 'rep',        head: 'Rep', kind: 'text', value: r => r.rep_name },
  { id: 'raised',     head: 'Raised', kind: 'date', value: r => r.complaint_date ?? r.created_at },
  // How many customer letters are attached — the question this column answers.
  { id: 'docs',       head: 'Customer docs', kind: 'number', value: r => r.customer_files.length },
  // The trailing "Open →" link. An action, so there is nothing to sort.
  { id: 'open',       head: '', pick: 'Open link' },
];

const ALL_IDS = COLUMNS.map(c => c.id);

// Every column, not only the showing ones: hiding a column must not disturb the
// order the table is in, and a sorted column that is then hidden keeps its sort.
const SORT_COLS: SortableColumn<ComplaintListRow>[] = COLUMNS
  .filter((c): c is Col & { kind: SortKind } => c.kind != null)
  .map(c => ({ key: c.id, kind: c.kind, value: c.value, order: c.order }));

// Remembers which columns the reader chose, so the choice survives the server
// navigations that remount this table (sorting, filtering, paging back in).
// Keyed to this table alone — the kanban board has its own.
const COLS_KEY = 'risansi.complaints.cols';

// The two identifying columns stay put while the other sixteen scroll past.
// The number column's width has to be a known constant, because it is the
// client column's `left` offset, so its contents sit in a box of that width
// rather than being allowed to widen the cell and break the alignment.
const NO_W = 124;
const NO_INNER = NO_W - 20;   // less the cell's 10px of padding on each side

// `sort` and `sortHrefs` are still accepted because the page and the server
// half still hand them over, and an old bookmark can still carry ?sort=. They
// are no longer read: the four URL sorts have become eighteen in-memory ones
// (see useTableSort below), and the server's ORDER BY remains what the table
// arrives in.
export function ComplaintTableClient({ rows }: {
  rows: ComplaintListRow[];
  sort: ComplaintSort | null;
  sortHrefs: Partial<Record<ComplaintSortKey, string>> | null;
}) {
  const [visible, setVisible] = useState<ColId[]>(ALL_IDS);
  const [pickerOpen, setPickerOpen] = useState(false);

  // This is not one page of a longer query. loadComplaintRows takes no LIMIT:
  // every complaint matching the filters is here, and all of them render inside
  // the scroll box below — which is why the sort belongs in memory rather than
  // in the URL, and why every column can have one instead of the four a
  // ?sort= param carried.
  //
  // It starts unset, so the table still arrives in the order the query chose:
  // open before closed, overdue first, longest-sitting first.
  const { rows: ordered, sortBy } = useTableSort(rows, SORT_COLS);

  // Read the saved choice after mount rather than during render: the server
  // has no localStorage, and a first paint that disagrees with the server's
  // would be a hydration error.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLS_KEY);
      if (!saved) return;
      const arr: unknown = JSON.parse(saved);
      if (!Array.isArray(arr)) return;
      // Rebuilt from the canonical order, and the locked columns are added back
      // whatever the saved list says, so a hand-edited or stale entry cannot
      // produce a table with no way to identify a row.
      const next = ALL_IDS.filter(id => arr.includes(id) || COLUMNS.find(c => c.id === id)?.locked);
      if (next.length) setVisible(next);
    } catch {
      // Private browsing, or site data blocked. The default set is already on.
    }
  }, []);

  const toggle = (id: ColId) => {
    if (COLUMNS.find(c => c.id === id)?.locked) return;
    setVisible(prev => {
      // Rebuild from the canonical order so a re-shown column lands back where
      // it belongs rather than at the end.
      const next = prev.includes(id) ? prev.filter(c => c !== id) : ALL_IDS.filter(c => c === id || prev.includes(c));
      try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* nothing to persist to; the choice still holds for this page */ }
      return next;
    });
  };

  const showAll = () => {
    setVisible(ALL_IDS);
    // Removing the key rather than storing the full list, so a column added in
    // a later release shows up for people who never narrowed the table.
    try { localStorage.removeItem(COLS_KEY); } catch { /* ignore */ }
  };

  const shown = COLUMNS.filter(c => visible.includes(c.id));
  const allShown = shown.length === COLUMNS.length;
  // Whichever frozen column is last carries the seam that marks where the
  // frozen part ends — the client column usually, the number alone when the
  // reader has hidden the client.
  const clientFrozen = visible.includes('client');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            aria-haspopup="true" aria-expanded={pickerOpen}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 26, padding: '0 10px', fontSize: 11, fontFamily: 'inherit',
              background: 'var(--bg-paper)', color: 'var(--fg-2)',
              border: '1px solid var(--line-strong)', borderRadius: 5, cursor: 'pointer',
            }}
          >
            <span aria-hidden>▤</span> Columns
            {!allShown && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)',
                background: 'var(--accent-soft)', borderRadius: 3, padding: '1px 4px',
              }}>{shown.length}/{COLUMNS.length}</span>
            )}
          </button>

          {pickerOpen && (
            <>
              {/* click-away backdrop */}
              <div onClick={() => setPickerOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div className="r-filter-menu" style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 41,
                minWidth: 210, maxHeight: '60vh', overflowY: 'auto', padding: 6,
                background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
                borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', padding: '4px 8px 6px' }}>
                  Show columns
                </div>
                {COLUMNS.map(col => {
                  const on = visible.includes(col.id);
                  const locked = !!col.locked;
                  return (
                    <label key={col.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      fontSize: 12, borderRadius: 5, color: 'var(--fg)',
                      cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
                    }} title={locked ? 'The complaint number identifies the row, so it always shows' : undefined}>
                      <input type="checkbox" checked={on} disabled={locked}
                        onChange={() => toggle(col.id)}
                        style={{ cursor: locked ? 'not-allowed' : 'pointer' }} />
                      <span>{col.pick ?? col.head}</span>
                    </label>
                  );
                })}
                {!allShown && (
                  <button type="button" onClick={showAll}
                    style={{
                      width: '100%', marginTop: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'inherit',
                      background: 'none', color: 'var(--accent)', border: 'none',
                      borderTop: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left',
                    }}>
                    Show all columns
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* One scroll box, about a screen tall, scrolling both ways. `r-own-scroll`
          keeps app/mobile.css from making the table a second scroll container
          inside this one — two nested scrollers fight over the same swipe. */}
      <div style={{ ...PANEL, maxHeight: '72vh', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="r-own-scroll" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr>
              {shown.map(col => (
                <SortTH key={col.id}
                  {...sortBy(col.id)}
                  // The class stays on the cell: app/mobile.css keys off it to
                  // un-freeze the client column on a phone and move the seam.
                  className={col.id === 'no' ? 'cmp-fz-no' : col.id === 'client' ? 'cmp-fz-client' : undefined}
                  align={col.right ? 'right' : 'left'}
                  title={col.kind ? `Sort by ${(col.pick ?? col.head).toLowerCase()}` : undefined}
                  style={{
                    ...TH,
                    ...(col.id === 'no' ? { ...freezeNo(!clientFrozen), ...TH_FREEZE }
                      : col.id === 'client' ? { ...FREEZE_CLIENT, ...TH_FREEZE, boxShadow: SEAM }
                      : null),
                  }}>
                  {/* The number column's contents are boxed to the cell's fixed
                      width, because that width is the client column's offset. */}
                  {col.id === 'no' ? <div style={NO_BOX}>{col.head}</div> : col.head}
                </SortTH>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map(r => {
              const open = isOpenRow(r);
              return (
                <tr key={r.id} style={{ opacity: open ? 1 : 0.7 }}>
                  {shown.map(col => renderCell(col, r, clientFrozen))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One body cell. Split out so the row can be assembled from whichever columns are showing. */
function renderCell(col: Col, r: ComplaintListRow, clientFrozen: boolean): ReactNode {
  const open = isOpenRow(r);
  const legacy = isLegacyRow(r);

  switch (col.id) {
    case 'no':
      return (
        <td key={col.id} className="cmp-fz-no" style={{ ...TD, ...freezeNo(!clientFrozen) }}>
          <div style={NO_BOX}>
            <Link href={`/risansi/complaints/${r.id}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', fontWeight: 600 }}>{r.complaint_no}</Link>
            {legacy && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--fg-4)', fontWeight: 700 }}>LEGACY</span>}
            {r.reopen_count > 0 && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--warn, #B45309)', fontWeight: 700 }}>↩{r.reopen_count}</span>}
          </div>
        </td>
      );
    case 'client':
      return (
        <td key={col.id} className="cmp-fz-client" style={{ ...TD, ...FREEZE_CLIENT, boxShadow: SEAM }}>
          <div style={ELLIPSIS}>
            {r.client_id ? <Link href={`/risansi/clients/${r.client_id}`} style={{ color: 'var(--fg)', textDecoration: 'none', fontWeight: 500 }}>{r.client_name}</Link> : <span style={{ color: 'var(--fg-3)' }}>—</span>}
          </div>
          <div style={{ ...ELLIPSIS, fontSize: 10.5, color: 'var(--fg-3)' }} title={r.details ?? ''}>{r.details}</div>
        </td>
      );
    case 'status':
      return <td key={col.id} style={TD}><span style={{ ...PILL, background: STATUS_TONE[r.status] ?? 'var(--fg-3)' }}>{r.status}</span></td>;
    case 'sev':
      return <td key={col.id} style={TD}>{r.severity ? <span style={{ ...PILL, background: SEVERITY_TONE[r.severity as Severity] }} title={r.severity}>{r.severity}</span> : <span style={{ color: 'var(--fg-4)' }}>·</span>}</td>;
    case 'type':
      return <td key={col.id} style={{ ...TD, fontSize: 11.5 }}>{r.complaint_type ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}{r.defect_category ? <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.defect_category}</div> : null}</td>;
    case 'model':
      return (
        <td key={col.id} style={{ ...TD, fontSize: 11.5, fontFamily: 'var(--font-mono)' }} title={[r.part_type, r.part_name].filter(Boolean).join(' · ') || undefined}>
          {r.pump_model ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}
          {r.part_name ? <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'inherit' }}>{r.part_name}</div> : null}
        </td>
      );
    case 'qty':
      return <td key={col.id} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.quantity ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>;
    case 'freeRepl':
      // Is the customer getting a replacement free of charge, and where has
      // that got to. Blank rather than "No" where no action has been decided
      // yet — nobody has said no.
      return (
        <td key={col.id} style={{ ...TD, fontSize: 11 }}>
          {r.free_replacement
            ? <span style={{ ...PILL, background: 'var(--warn, #B45309)' }}>Free</span>
            : freeReplLabel(r)
              ? <span style={{ color: 'var(--fg-3)' }}>{freeReplLabel(r)}</span>
              : <span style={{ color: 'var(--fg-4)' }}>—</span>}
        </td>
      );
    case 'frEc':
      return <td key={col.id} style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.fr_ec_no ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>;
    case 'frDispatch':
      return (
        <td key={col.id} style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
          {r.target_dispatch_date ? day(r.target_dispatch_date) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
        </td>
      );
    case 'holder':
      return (
        <td key={col.id} style={{ ...TD, fontSize: 11.5 }}>
          {open && !legacy ? <>
            <div>{holderLabel(r)}</div>
            {r.holder_name && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.holder_department}</div>}
          </> : <span style={{ color: 'var(--fg-4)' }}>—</span>}
        </td>
      );
    case 'since':
      return (
        <td key={col.id} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: open && r.days_in_status > 7 ? 'var(--neg)' : 'var(--fg)' }} title={r.since ? `In ${r.status} since ${day(r.since)}` : ''}>
          {open && !legacy ? fmtDays(r.days_in_status) : '—'}
        </td>
      );
    case 'age':
      return <td key={col.id} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }} title={open ? 'Days since raised' : 'Days from raised to closed'}>{fmtDays(r.age_days)}</td>;
    case 'target':
      return <td key={col.id} style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: r.overdue ? 'var(--neg)' : 'var(--fg-2)', fontWeight: r.overdue ? 700 : 400 }}>{r.target_completion_date ? day(r.target_completion_date) : '—'}{r.overdue ? ' !' : ''}</td>;
    case 'rep':
      return <td key={col.id} style={{ ...TD, fontSize: 11.5 }}>{r.rep_name ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>;
    case 'raised':
      return <td key={col.id} style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>{day(r.complaint_date ?? r.created_at)}</td>;
    case 'docs':
      return (
        <td key={col.id} style={{ ...TD, fontSize: 11, maxWidth: 180 }}>
          {r.customer_files.length ? r.customer_files.map(f => (
            <a key={f.id} href={`/api/risansi/complaint-attachment/${f.id}`} target="_blank" rel="noreferrer" title={f.file_name}
              style={{ display: 'block', color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📎 {f.file_name}
            </a>
          )) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
        </td>
      );
    case 'open':
      return <td key={col.id} style={TD}><Link href={`/risansi/complaints/${r.id}`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Open →</Link></td>;
  }
}


const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const TH: CSSProperties = { padding: '9px 10px', fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--line)', background: 'var(--bg-sunk)', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 };
const TD: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--line-2)', verticalAlign: 'top' };
const PILL: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' };

// A 1px line down the right of the last frozen column, drawn as a shadow so it
// costs no width and cannot push the client column's `left` offset out of true.
const SEAM = '1px 0 0 var(--line)';
// Backgrounds have to be opaque or the rows slide visibly under the frozen
// cells, which is why these are --bg-paper / --bg-sunk and not a tint.
const ELLIPSIS: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NO_BOX: CSSProperties = { maxWidth: NO_INNER, overflow: 'hidden', whiteSpace: 'nowrap' };
const freezeNo = (seam: boolean): CSSProperties => ({
  position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-paper)',
  boxSizing: 'border-box', width: NO_W, minWidth: NO_W, maxWidth: NO_W,
  boxShadow: seam ? SEAM : undefined,
});
const FREEZE_CLIENT: CSSProperties = {
  position: 'sticky', left: NO_W, zIndex: 1, background: 'var(--bg-paper)',
  maxWidth: 240, overflow: 'hidden',
};
// The header cells of the frozen columns are in both sticky directions at
// once, so they have to outrank the row above them and the column beside them.
const TH_FREEZE: CSSProperties = { zIndex: 3, background: 'var(--bg-sunk)' };
