'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export function MonthNav({ currentOffset }: { currentOffset: number }) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const go = (offset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'calendar');
    if (offset === 0) params.delete('month');
    else params.set('month', String(offset));
    router.push(`${pathname}?${params.toString()}`);
  };

  const mDate = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + currentOffset,
    1,
  );
  const label = mDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button
        onClick={() => go(currentOffset - 1)}
        style={{
          padding: '6px 10px', borderRadius: 6,
          border: '1px solid var(--line-strong, #CBD5E1)',
          background: '#fff', cursor: 'pointer', fontSize: 13,
          fontFamily: 'inherit', color: 'var(--fg)',
        }}
      >
        ← Prev
      </button>
      <span style={{
        padding: '6px 14px', fontWeight: 600, fontSize: 13,
        color: 'var(--fg)', minWidth: 150, textAlign: 'center',
      }}>
        {label}
      </span>
      {currentOffset !== 0 && (
        <button
          onClick={() => go(0)}
          style={{
            padding: '6px 10px', borderRadius: 6,
            border: '1px solid #1A5CB8', background: '#EBF1FB',
            color: '#1A5CB8', cursor: 'pointer', fontSize: 12,
            fontWeight: 500, fontFamily: 'inherit',
          }}
        >
          Today
        </button>
      )}
      <button
        onClick={() => go(currentOffset + 1)}
        style={{
          padding: '6px 10px', borderRadius: 6,
          border: '1px solid var(--line-strong, #CBD5E1)',
          background: '#fff', cursor: 'pointer', fontSize: 13,
          fontFamily: 'inherit', color: 'var(--fg)',
        }}
      >
        Next →
      </button>
    </div>
  );
}
