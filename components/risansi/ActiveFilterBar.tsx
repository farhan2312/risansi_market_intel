'use client';

import { useRouter, usePathname } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────

export interface FilterDef {
  param:    string;   // URL search param key
  label:    string;   // Human-readable label for the pill prefix
  values:   string[]; // Currently selected values (server-parsed)
}

interface Props {
  filters: FilterDef[];
}

// ── Component ──────────────────────────────────────────────────

export function ActiveFilterBar({ filters }: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  // Flatten all active (param, value) pairs into pills
  const pills: { param: string; filterLabel: string; value: string }[] = [];
  for (const { param, label, values } of filters) {
    for (const value of values) {
      pills.push({ param, filterLabel: label, value });
    }
  }

  if (pills.length === 0) return null;

  function removePill(param: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    const current = (params.get(param) ?? '').split(',').filter(Boolean);
    const next    = current.filter(v => v !== value);
    if (next.length === 0) {
      params.delete(param);
    } else {
      params.set(param, next.join(','));
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams(window.location.search);
    for (const { param } of filters) params.delete(param);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={{
      display:    'flex',
      flexWrap:   'wrap',
      gap:        6,
      alignItems: 'center',
      marginTop:  6,
      marginBottom: 4,
    }}>
      <span style={{
        fontSize:       10,
        color:          'var(--fg-3)',
        fontWeight:     700,
        textTransform:  'uppercase',
        letterSpacing:  '0.08em',
        marginRight:    2,
      }}>
        Filters:
      </span>

      {pills.map(({ param, filterLabel, value }) => (
        <span
          key={`${param}:${value}`}
          style={{
            display:    'inline-flex',
            alignItems: 'center',
            gap:        4,
            padding:    '2px 8px',
            borderRadius: 12,
            fontSize:   11,
            background: '#EBF1FB',
            color:      '#0A3D8F',
            border:     '1px solid #BFDBFE',
          }}
        >
          <span style={{ fontSize: 10, opacity: 0.7 }}>{filterLabel}:</span>
          {value}
          <button
            type="button"
            onClick={() => removePill(param, value)}
            style={{
              background:  'none',
              border:      'none',
              cursor:      'pointer',
              color:       '#0A3D8F',
              padding:     0,
              marginLeft:  2,
              fontSize:    13,
              lineHeight:  1,
              display:     'flex',
              alignItems:  'center',
            }}
          >
            ×
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={clearAll}
        style={{
          padding:      '2px 8px',
          fontSize:     11,
          cursor:       'pointer',
          background:   'none',
          border:       '1px solid var(--line-strong)',
          color:        'var(--fg-3)',
          borderRadius: 12,
          fontFamily:   'inherit',
        }}
      >
        Clear all
      </button>
    </div>
  );
}
