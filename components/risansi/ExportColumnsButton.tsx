'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import {
  CLIENT_EXPORT_COLUMNS, CLIENT_EXPORT_GROUPS,
} from '@/lib/risansi-client-export-columns';

/**
 * Export, but choose the columns first.
 *
 * Everything starts ticked, because the export used to be all-or-nothing and the
 * common case is still "give me the lot". Untick what you do not want. The
 * choice rides along as ?cols= on the same href the plain link used, so the
 * active filters still apply and an old bookmark without the parameter still
 * gets every column.
 *
 * The list comes from the same module the route reads, so a ticked column cannot
 * come out holding a different column's values.
 */
export function ExportColumnsButton({ href, count, label }: {
  /** The filtered export URL, without a cols parameter. */
  href: string;
  /** How many clients the current filters match, for the confirm button. */
  count: number;
  /** Trigger text, so the page keeps its own wording about filters and counts. */
  label: string;
}) {
  const allKeys = useMemo(() => CLIENT_EXPORT_COLUMNS.map(c => c.key), []);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(allKeys));

  const toggle = (key: string) => setPicked(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const setGroup = (group: string, on: boolean) => setPicked(s => {
    const n = new Set(s);
    for (const c of CLIENT_EXPORT_COLUMNS) {
      if (c.group !== group) continue;
      if (on) n.add(c.key); else n.delete(c.key);
    }
    return n;
  });

  const download = () => {
    const url = new URL(href, window.location.origin);
    // All ticked is the same request the link always made, so send no parameter
    // at all — the URL stays short and matches what a saved bookmark looks like.
    if (picked.size !== allKeys.length) {
      url.searchParams.set('cols', allKeys.filter(k => picked.has(k)).join(','));
    }
    window.location.href = url.toString();
    setOpen(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={TRIGGER}
        title="Choose which columns to export">
        {label}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={SCRIM} />
          <div className="risansi-modal" style={MODAL} role="dialog" aria-label="Choose export columns">
            <div style={HEAD}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Columns to export</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  {count.toLocaleString('en-IN')} client{count === 1 ? '' : 's'} match your filters.
                  Everything is ticked — untick what you do not need.
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={X} aria-label="Close">×</button>
            </div>

            <div style={BAR}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                <strong>{picked.size}</strong>
                <span style={{ color: 'var(--fg-3)' }}> of {allKeys.length} columns</span>
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setPicked(new Set(allKeys))} style={LINKBTN}>All</button>
                <button type="button" onClick={() => setPicked(new Set())} style={LINKBTN}>None</button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
              {CLIENT_EXPORT_GROUPS.map(group => {
                const cols = CLIENT_EXPORT_COLUMNS.filter(c => c.group === group);
                const on = cols.filter(c => picked.has(c.key)).length;
                return (
                  <div key={group} style={{ padding: '9px 18px 12px', borderBottom: '1px solid var(--line-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                      <span style={GROUP_LBL}>{group}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                        {on}/{cols.length}
                      </span>
                      <button type="button" onClick={() => setGroup(group, on !== cols.length)}
                        style={{ ...LINKBTN, marginLeft: 'auto' }}>
                        {on === cols.length ? 'Clear' : 'All'}
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 12px' }}>
                      {cols.map(c => (
                        <label key={c.key} style={ROW}>
                          <input
                            type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)}
                            style={{ width: 14, height: 14, accentColor: '#0A3D8F', flexShrink: 0 }}
                          />
                          <span style={{ fontSize: 12.5 }}>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={FOOT}>
              <button type="button" onClick={() => setOpen(false)} style={BTN}>Cancel</button>
              <button type="button" onClick={download} disabled={picked.size === 0}
                style={{ ...BTN_PRI, opacity: picked.size === 0 ? 0.45 : 1 }}>
                {picked.size === 0 ? 'Pick at least one column' : `Export ${picked.size} column${picked.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

const TRIGGER: CSSProperties = {
  padding: '7px 13px', borderRadius: 6, border: '1px solid var(--line-strong)',
  background: 'var(--bg-paper)', color: 'var(--fg)', fontSize: 12.5, fontWeight: 500,
  fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
};
const SCRIM: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.4)', zIndex: 400 };
const MODAL: CSSProperties = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  width: 640, maxWidth: 'calc(100vw - 32px)', height: 'min(78vh, 700px)',
  display: 'flex', flexDirection: 'column', background: 'var(--bg-paper)',
  borderRadius: 12, zIndex: 401, boxShadow: '0 24px 70px rgba(10,61,143,0.22)', overflow: 'hidden',
};
const HEAD: CSSProperties = {
  padding: '15px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0,
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
};
const X: CSSProperties = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 };
const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', flexShrink: 0,
  borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)',
};
const GROUP_LBL: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--title)',
};
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '1px 0' };
const LINKBTN: CSSProperties = {
  background: 'none', border: 'none', padding: 0, fontSize: 11,
  fontFamily: 'inherit', color: 'var(--accent)', cursor: 'pointer',
};
const FOOT: CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '11px 18px',
  borderTop: '1px solid var(--line)', background: 'var(--bg-elev)', flexShrink: 0,
};
const BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 13, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_PRI: CSSProperties = { ...BTN, background: '#0A3D8F', color: '#fff', borderColor: '#0A3D8F', fontWeight: 500 };
