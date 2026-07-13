'use client';

import { useState, useTransition } from 'react';
import { setEndClient } from '@/app/actions/risansi';

// Inline per-row "End Client" toggle for the Client Master list. Persists
// immediately (optimistic; reverts on failure).
export function EndClientToggle({ clientId, value }: { clientId: string; value: boolean }) {
  const [on, setOn] = useState(value);
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      checked={on}
      disabled={pending}
      title="End Client — supplied indirectly (via OEM / trader)"
      onChange={e => {
        const next = e.target.checked;
        setOn(next);
        start(async () => {
          try { await setEndClient([Number(clientId)], next); }
          catch { setOn(!next); }
        });
      }}
      style={{ width: 15, height: 15, accentColor: 'var(--brand-blue)', cursor: pending ? 'wait' : 'pointer' }}
    />
  );
}
