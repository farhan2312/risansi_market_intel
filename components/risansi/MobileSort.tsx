'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Mirrors the sortable column headers (hidden in mobile card view).
const OPTIONS = [
  { key: 'last_visit', label: 'Last Visit' },
  { key: 'name',       label: 'Client Name' },
  { key: 'code',       label: 'Code' },
  { key: 'industry',   label: 'Industry' },
  { key: 'zone',       label: 'Zone / Route' },
  { key: 'rep',        label: 'Rep' },
  { key: 'status',     label: 'Status' },
  { key: 'tier',       label: 'Tier' },
];

/**
 * Mobile-only sort control for the Client 360 list. On desktop sorting lives in
 * the table headers, which are hidden when the table becomes cards on a phone —
 * this restores it. Tapping the active option flips the direction.
 */
export function MobileSort({ currentSort, currentOrder }: {
  currentSort: string;
  currentOrder: 'asc' | 'desc';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const apply = (key: string) => {
    const p = new URLSearchParams(window.location.search);
    if (key === currentSort) {
      p.set('order', currentOrder === 'asc' ? 'desc' : 'asc');
    } else {
      p.set('sort', key);
      p.set('order', 'asc');
    }
    p.delete('page');
    setOpen(false);
    router.push(`${pathname}?${p.toString()}`);
  };

  const curLabel = OPTIONS.find(o => o.key === currentSort)?.label ?? 'Last Visit';

  return (
    <div ref={ref} className="r-mobile-only" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44,
          padding: '0 12px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
          background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
          borderRadius: 7, color: 'var(--fg-2)', whiteSpace: 'nowrap',
        }}
      >
        ↕ Sort: <strong style={{ fontWeight: 600, color: 'var(--fg)' }}>{curLabel}</strong>
        <span style={{ opacity: 0.6 }}>{currentOrder === 'asc' ? '↑' : '↓'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200,
          background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)', minWidth: 200, overflow: 'hidden',
        }}>
          {OPTIONS.map(o => {
            const active = o.key === currentSort;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => apply(o.key)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  minHeight: 44, padding: '0 14px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                  background: active ? 'var(--accent-soft)' : 'transparent', border: 'none',
                  borderBottom: '1px solid var(--line-2)',
                  color: active ? 'var(--accent)' : 'var(--fg)', fontWeight: active ? 600 : 400,
                }}
              >
                {o.label}
                {active && <span>{currentOrder === 'asc' ? '↑' : '↓'}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
