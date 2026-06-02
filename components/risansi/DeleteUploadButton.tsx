'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteUpload } from '@/app/actions/risansi-revenue';

export function DeleteUploadButton({ logId, month }: { logId: number; month: string }) {
  const router    = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading,    setLoading]    = useState(false);

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              await deleteUpload(logId, month);
              router.refresh();
            } catch {
              setConfirming(false);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          style={{
            padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit',
            background: '#E02424', color: 'white',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 11,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '…' : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          style={{
            padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit',
            background: 'var(--bg-elev)', border: '1px solid var(--line-strong, #CBD5E1)',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit',
        background: 'transparent', border: '1px solid #F87171',
        color: '#E02424', cursor: 'pointer', fontSize: 11,
      }}
    >
      Delete
    </button>
  );
}
