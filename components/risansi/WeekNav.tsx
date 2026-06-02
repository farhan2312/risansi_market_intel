'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export function WeekNav({ currentOffset }: { currentOffset: number }) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const go = (offset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (offset === 0) params.delete('week');
    else params.set('week', String(offset));
    router.push(`${pathname}?${params.toString()}`);
  };

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
      {currentOffset !== 0 && (
        <button
          onClick={() => go(0)}
          style={{
            padding: '6px 10px', borderRadius: 6,
            border: '1px solid #1A5CB8',
            background: '#EBF1FB', color: '#1A5CB8',
            cursor: 'pointer', fontSize: 12, fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          This Week
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
