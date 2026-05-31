'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect, useTransition, useRef } from 'react';
import type { CSSProperties } from 'react';

interface FilterBarProps {
  industries: string[];
  zones:      string[];
  tiers:      string[];
  q:          string;
  industry:   string;
  zone:       string;
  tier:       string;
  status:     string;
  sugar:      string;   // '' | 'true' | 'false'
  total:      number;
}

// Status values must match DB storage (uppercase)
const STATUS_OPTIONS = [
  { value: 'ACTIVE',      label: 'Active'      },
  { value: 'INACTIVE',    label: 'Inactive'     },
  { value: 'PROSPECTIVE', label: 'Prospective'  },
  { value: 'BLACKLISTED', label: 'Blacklisted'  },
];

const FIELD: CSSProperties = {
  height: 30, padding: '0 8px',
  fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)',
  borderRadius: 5,
  color: 'var(--fg)',
  outline: 'none',
  cursor: 'pointer',
};

export function FilterBar({
  industries, zones, tiers, q: initQ,
  industry, zone, tier, status, sugar, total,
}: FilterBarProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(initQ);

  // Track whether the component has mounted to prevent debounce from
  // firing on initial render (which would drop ?page=N from the URL).
  const mounted = useRef(false);

  // Sync search field when URL changes (browser back/forward)
  useEffect(() => { setSearch(initQ); }, [initQ]);

  // Debounced search — skip the very first render
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      if (search) p.set('q', search);
      else        p.delete('q');
      p.delete('page');
      startTransition(() => router.replace(`${pathname}?${p.toString()}`));
    }, 280);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(window.location.search);
    if (value) p.set(key, value);
    else       p.delete(key);
    p.delete('page');
    startTransition(() => router.replace(`${pathname}?${p.toString()}`));
  };

  const hasFilters = !!(search || industry || zone || tier || status || sugar);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '10px 0',
      opacity: pending ? 0.6 : 1,
      transition: 'opacity 0.15s',
    }}>

      {/* Search */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <svg style={{ position: 'absolute', left: 8, pointerEvents: 'none', color: 'var(--fg-3)' }}
          width="13" height="13" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Code or client name…"
          style={{ ...FIELD, paddingLeft: 28, width: 200, cursor: 'text' }}
        />
      </div>

      {/* Industry */}
      <select value={industry} onChange={e => updateParam('industry', e.target.value)} style={FIELD}>
        <option value="">All industries</option>
        {industries.map(i => <option key={i} value={i}>{i}</option>)}
      </select>

      {/* Zone */}
      <select value={zone} onChange={e => updateParam('zone', e.target.value)} style={FIELD}>
        <option value="">All zones</option>
        {zones.map(z => <option key={z} value={z}>{z}</option>)}
      </select>

      {/* Tier — populated from DB values */}
      <select value={tier} onChange={e => updateParam('tier', e.target.value)} style={FIELD}>
        <option value="">All tiers</option>
        {tiers.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Status — values must match DB (uppercase) */}
      <select value={status} onChange={e => updateParam('status', e.target.value)} style={FIELD}>
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {/* Sugar toggle — maps to is_sugar boolean column */}
      <div style={{
        display: 'flex', background: 'var(--bg-paper)',
        border: '1px solid var(--line-strong)', borderRadius: 5, overflow: 'hidden',
      }}>
        {([
          { value: '',      label: 'All'       },
          { value: 'true',  label: 'Sugar'     },
          { value: 'false', label: 'Non-Sugar' },
        ] as const).map(opt => (
          <button
            key={opt.value || 'all'}
            onClick={() => updateParam('sugar', opt.value)}
            style={{
              height: 30, padding: '0 10px', fontSize: 11, fontFamily: 'inherit',
              cursor: 'pointer', border: 'none',
              borderRight: opt.value === 'false' ? 'none' : '1px solid var(--line-strong)',
              background: sugar === opt.value ? 'var(--accent)' : 'transparent',
              color:      sugar === opt.value ? '#fff'          : 'var(--fg-2)',
              fontWeight: sugar === opt.value ? 500             : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={() => {
            setSearch('');
            startTransition(() => router.replace(pathname));
          }}
          style={{ ...FIELD, padding: '0 10px', color: 'var(--fg-3)', fontSize: 11 }}
        >
          Clear
        </button>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
        {total.toLocaleString('en-IN')} client{total !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
