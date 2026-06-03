'use client';

import { useRouter } from 'next/navigation';

export function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', background: 'none',
        border: '1px solid var(--line-strong)', borderRadius: 6,
        fontSize: 12, color: 'var(--fg-3)', cursor: 'pointer',
        marginBottom: 16, transition: 'all 150ms', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elev)'; e.currentTarget.style.color = 'var(--fg)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--fg-3)'; }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back
    </button>
  );
}
