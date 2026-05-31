'use client';

import { type CSSProperties } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────

interface Props {
  col:         string;               // Sort key sent as ?sort=col
  label:       string;               // Display label
  currentSort: string;               // Active sort key (from server searchParams)
  currentDir:  'asc' | 'desc';      // Active direction (from server searchParams)
  style?:      CSSProperties;
  align?:      'left' | 'right' | 'center';
}

// ── Component ──────────────────────────────────────────────────

export function SortableTH({
  col, label, currentSort, currentDir,
  style, align = 'left',
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const isActive = currentSort === col;

  function handleClick() {
    // Read current params at click-time to preserve all other filters
    const params = new URLSearchParams(window.location.search);
    if (isActive) {
      params.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort', col);
      params.set('dir', 'asc');
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <th
      onClick={handleClick}
      title={`Sort by ${label}`}
      style={{
        cursor:       'pointer',
        userSelect:   'none',
        textAlign:    align,
        ...TH_BASE,
        ...(isActive ? { color: '#0A3D8F' } : {}),
        ...style,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        {isActive
          ? <span style={{ fontSize: 8 }}>{currentDir === 'asc' ? '▲' : '▼'}</span>
          : <span style={{ fontSize: 8, opacity: 0.22 }}>↕</span>
        }
      </span>
    </th>
  );
}

// ── Base TH styles (override per-page via style prop) ──────────

const TH_BASE: CSSProperties = {
  padding:       '9px 12px',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    500,
  color:         'var(--fg-3)',
  borderBottom:  '1px solid var(--line)',
  whiteSpace:    'nowrap',
  background:    'var(--bg-elev)',
};
