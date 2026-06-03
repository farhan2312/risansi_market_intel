'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitVisit } from '@/app/actions/risansi-visits';

export function SubmitVisitButton({ visitId }: { visitId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);
  const router = useRouter();

  if (confirming) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', maxWidth: 280, textAlign: 'right' }}>
          This will <strong>close the visit</strong> and create any auto-generated items.
          You cannot edit after submitting.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setConfirming(false)}
            style={{
              padding: '7px 14px', borderRadius: 6,
              border: '1px solid var(--line-strong)',
              background: 'white', cursor: 'pointer', fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setLoading(true);
              try {
                await submitVisit(visitId);
                router.refresh();
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{
              padding: '7px 16px', borderRadius: 6,
              background: '#059669', color: 'white',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Submitting…' : '✓ Confirm Submit'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: '8px 18px', borderRadius: 6,
        background: '#0A3D8F', color: 'white',
        border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
      }}
    >
      Submit Visit Report
    </button>
  );
}
