'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────

type OptionItem = string | { value: string; label: string; count?: number };

interface Props {
  param:    string;        // URL search param key  (e.g. 'industry')
  label:    string;        // Button label
  options:  OptionItem[];  // All available options (string or {value,label,count})
  selected: string[];      // Currently selected (parsed server-side from searchParams)
}

function optValue(o: OptionItem): string { return typeof o === 'string' ? o : o.value; }
function optLabel(o: OptionItem): string { return typeof o === 'string' ? o : o.label; }
function optCount(o: OptionItem): number | undefined { return typeof o === 'string' ? undefined : o.count; }

// ── Component ──────────────────────────────────────────────────

export function MultiSelectFilter({ param, label, options, selected }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const close = () => { setOpen(false); setQuery(''); };

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Longer option lists get a search box to filter down to a match.
  const searchable = options.length > 5;
  const q = query.trim().toLowerCase();
  const shown = searchable && q
    ? options.filter(o => optLabel(o).toLowerCase().includes(q) || optValue(o).toLowerCase().includes(q))
    : options;

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter(v => v !== value)
      : [...selected, value];
    const params = new URLSearchParams(window.location.search);
    if (next.length === 0) {
      params.delete(param);
    } else {
      params.set(param, next.join(','));
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  const count = selected.length;
  const isActive = count > 0;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="r-tap"
        onClick={() => (open ? close() : setOpen(true))}
        style={{
          display:     'inline-flex',
          alignItems:  'center',
          gap:         5,
          padding:     '5px 10px',
          height:      30,
          fontSize:    12,
          fontFamily:  'inherit',
          background:  isActive ? 'var(--accent-soft)' : 'var(--bg-paper)',
          border:      `1px solid ${isActive ? 'var(--brand-blue)' : 'var(--line-strong)'}`,
          color:       isActive ? 'var(--brand-blue)' : 'var(--fg-2)',
          borderRadius: 5,
          cursor:      'pointer',
          whiteSpace:  'nowrap',
        }}
      >
        {label}
        {isActive && (
          <span style={{
            display:        'inline-flex',
            alignItems:     'center',
            justifyContent: 'center',
            minWidth:       16,
            height:         16,
            borderRadius:   8,
            background:     '#0A3D8F',
            color:          '#fff',
            fontSize:       9,
            fontWeight:     700,
            padding:        '0 4px',
          }}>
            {count}
          </span>
        )}
        <span style={{ fontSize: 9, opacity: 0.55 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && options.length > 0 && (
        <div className="r-filter-menu" style={{
          position:  'absolute',
          top:       'calc(100% + 4px)',
          left:      0,
          zIndex:    200,
          background: 'var(--bg-paper)',
          border:    '1px solid var(--line-strong)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth:  180,
          maxHeight: 280,
          overflowY: 'auto',
        }}>
          {searchable && (
            <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-paper)', padding: 8, borderBottom: '1px solid var(--line-strong)' }}>
              <input
                autoFocus
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                style={{
                  width: '100%', padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
                  background: 'var(--bg-sunk)', color: 'var(--fg)', border: '1px solid var(--line-strong)',
                  borderRadius: 4, outline: 'none',
                }}
              />
            </div>
          )}
          {shown.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--fg-3)', textAlign: 'center' }}>No matches</div>
          ) : shown.map(opt => {
            const val     = optValue(opt);
            const lbl     = optLabel(opt);
            const cnt     = optCount(opt);
            const checked = selected.includes(val);
            return (
              <label
                key={val}
                style={{
                  display:    'flex',
                  alignItems: 'center',
                  gap:        8,
                  padding:    '7px 12px',
                  fontSize:   12,
                  cursor:     'pointer',
                  background: checked ? 'var(--accent-soft)' : 'transparent',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(val)}
                  style={{ accentColor: 'var(--brand-blue)', flexShrink: 0 }}
                />
                <span style={{ color: 'var(--fg)', flex: 1 }}>{lbl}</span>
                {cnt != null && (
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{cnt}</span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
