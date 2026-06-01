'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

const FY_OPTIONS = [
  { label: 'FY 25–26', value: '25-26' },
  { label: 'FY 24–25', value: '24-25' },
  { label: 'FY 23–24', value: '23-24' },
  { label: 'FY 22–23', value: '22-23' },
];

export function FYSelector() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentFY = searchParams.get('fy') ?? '25-26';
  const selected  = FY_OPTIONS.find(f => f.value === currentFY) ?? FY_OPTIONS[0];

  function selectFY(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('fy', value);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: 'var(--bg-paper)',
          border: '1px solid var(--line-strong)',
          borderRadius: 6, fontSize: 12, fontWeight: 500,
          fontFamily: 'inherit',
          color: 'var(--fg-2)', cursor: 'pointer',
        }}
      >
        📅 {selected.label}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '150ms' }}
        >
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: 'white',
          border: '1px solid var(--line)',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(10,61,143,0.12)',
          zIndex: 100, minWidth: 140, padding: 4,
        }}>
          {FY_OPTIONS.map(fy => (
            <div
              key={fy.value}
              onClick={() => selectFY(fy.value)}
              style={{
                padding: '8px 12px', borderRadius: 5,
                fontSize: 13, cursor: 'pointer',
                fontWeight: fy.value === currentFY ? 600 : 400,
                color: fy.value === currentFY ? '#0A3D8F' : 'var(--fg)',
                background: fy.value === currentFY ? 'rgba(26,92,184,0.08)' : 'transparent',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elev)'; }}
              onMouseLeave={e => {
                e.currentTarget.style.background = fy.value === currentFY
                  ? 'rgba(26,92,184,0.08)' : 'transparent';
              }}
            >
              {fy.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
