'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

// A server-side text search: a debounced input that writes `param` into the URL
// (preserving every other param), so the query itself is scoped rather than just
// the already-loaded page. Used on Opportunities to find a quote by number/name.

export function TextSearchFilter({ param, placeholder = 'Search…', width = 180 }: {
  param: string; placeholder?: string; width?: number;
}) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const current      = searchParams.get(param) ?? '';

  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep in sync if the URL changes elsewhere (e.g. a "clear all").
  useEffect(() => { setValue(current); }, [current]);

  const push = (val: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (val.trim()) p.set(param, val.trim()); else p.delete(param);
    p.delete('page');
    router.push(`${pathname}?${p.toString()}`);
  };

  const onChange = (v: string) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => push(v), 350);   // debounce the navigation
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <input
        type="search" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { clearTimeout(timer.current); push(value); } }}
        style={{ ...INP, width }}
      />
      {value && (
        <button type="button" aria-label="Clear search"
          onClick={() => { setValue(''); clearTimeout(timer.current); push(''); }}
          style={CLEAR}>×</button>
      )}
    </div>
  );
}

const INP: CSSProperties = {
  height: 30, padding: '5px 26px 5px 10px', fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--fg)',
  border: '1px solid var(--line-strong)', borderRadius: 5, outline: 'none', boxSizing: 'border-box',
};
const CLEAR: CSSProperties = {
  position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--fg-3)', fontSize: 15, lineHeight: 1, padding: 0,
};
