'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { SEVERITY_TONE, STATUS_TONE, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintListRow, ComplaintSort, ComplaintSortKey } from '@/lib/risansi-complaint-rows';

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
  /** Clicking this header sorts; the page decides the cycle and hands us the href. */
  sort?: ComplaintSortKey;
  right?: boolean;
  /** The complaint number is what makes a row a row, so it is never hideable. */
  locked?: boolean;
}

const COLUMNS: Col[] = [
  { id: 'no',         head: 'No.', locked: true },
  { id: 'client',     head: 'Client' },
  { id: 'status',     head: 'Status' },
  { id: 'sev',        head: 'Sev', pick: 'Severity' },
  { id: 'type',       head: 'Type · category' },
  { id: 'model',      head: 'Pump model' },
  { id: 'qty',        head: 'Qty', pick: 'Quantity', right: true },
  { id: 'freeRepl',   head: 'Free repl.', pick: 'Free replacement' },
  { id: 'frEc',       head: 'FR EC no.' },
  { id: 'frDispatch', head: 'FR dispatch' },
  { id: 'holder',     head: 'Sitting with' },
  { id: 'since',      head: 'Since', sort: 'since', right: true },
  { id: 'age',        head: 'Age', sort: 'age', right: true },
  { id: 'target',     head: 'Target', sort: 'target' },
  { id: 'rep',        head: 'Rep' },
  { id: 'raised',     head: 'Raised', sort: 'raised' },
  { id: 'docs',       head: 'Customer docs' },
  { id: 'open',       head: '', pick: 'Open link' },
];

const ALL_IDS = COLUMNS.map(c => c.id);

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

export function ComplaintTableClient({ rows, sort, sortHrefs }: {
  rows: ComplaintListRow[];
  sort: ComplaintSort | null;
  sortHrefs: Partial<Record<ComplaintSortKey, string>> | null;
}) {
  const [visible, setVisible] = useState<ColId[]>(ALL_IDS);
  const [pickerOpen, setPickerOpen] = useState(false);

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
              {shown.map(col => {
                const href = col.sort ? sortHrefs?.[col.sort] : undefined;
                const on = col.sort && sort?.key === col.sort;
                return (
                  <th key={col.id}
                    className={col.id === 'no' ? 'cmp-fz-no' : col.id === 'client' ? 'cmp-fz-client' : undefined}
                    style={{
                      ...TH,
                      textAlign: col.right ? 'right' : 'left',
                      ...(col.id === 'no' ? { ...freezeNo(!clientFrozen), ...TH_FREEZE }
                        : col.id === 'client' ? { ...FREEZE_CLIENT, ...TH_FREEZE, boxShadow: SEAM }
                        : null),
                    }}>
                    {col.id === 'no' ? <div style={NO_BOX}>{col.head}</div> : href ? (
                      <a href={href} title={on ? (sort!.dir === 'desc' ? 'Sorted newest / largest first — click for oldest first' : 'Sorted oldest / smallest first — click to clear') : `Sort by ${col.head.toLowerCase()}`}
                        style={{ color: on ? 'var(--accent)' : 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        {col.head}{on ? (sort!.dir === 'desc' ? ' ↓' : ' ↑') : <span style={{ opacity: 0.35 }}> ↕</span>}
                      </a>
                    ) : col.head}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const open = r.status !== 'Resolved' && r.status !== 'Closed';
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
  const open = r.status !== 'Resolved' && r.status !== 'Closed';
  const legacy = r.schema_version < 2;

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
            : r.action_category
              ? <span style={{ color: 'var(--fg-3)' }}>{r.action_category === 'Paid Replacement' ? 'Paid' : 'No'}</span>
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
            <div>{r.holder_name ?? r.holder_department ?? 'Complaint Team'}</div>
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
