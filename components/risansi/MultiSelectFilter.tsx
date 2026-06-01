'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
        onClick={() => setOpen(o => !o)}
        style={{
          display:     'inline-flex',
          alignItems:  'center',
          gap:         5,
          padding:     '5px 10px',
          height:      30,
          fontSize:    12,
          fontFamily:  'inherit',
          background:  isActive ? '#EBF1FB' : 'var(--bg-paper)',
          border:      `1px solid ${isActive ? '#1A5CB8' : 'var(--line-strong)'}`,
          color:       isActive ? '#0A3D8F' : 'var(--fg-2)',
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
        <div style={{
          position:  'absolute',
          top:       'calc(100% + 4px)',
          left:      0,
          zIndex:    200,
          background: '#fff',
          border:    '1px solid #CBD5E1',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth:  180,
          maxHeight: 260,
          overflowY: 'auto',
        }}>
          {options.map(opt => {
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
                  background: checked ? '#F0F5FF' : 'transparent',
                  borderBottom: '1px solid #F1F5F9',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(val)}
                  style={{ accentColor: '#0A3D8F', flexShrink: 0 }}
                />
                <span style={{ color: '#0D1B2A', flex: 1 }}>{lbl}</span>
                {cnt != null && (
                  <span style={{ fontSize: 10, color: '#6B7FA3', fontFamily: 'var(--font-mono)' }}>{cnt}</span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
