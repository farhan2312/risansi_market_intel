'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface SelRep { id: string; name: string }

// TSM picker for the Executive Review page. The review is scoped to the current
// fiscal year to date and turnover spans full FYs, so there is no month picker.
export function ExecutiveSelector({ reps, tsm }: {
  reps: SelRep[]; tsm: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const update = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  };

  // A rep may only review themselves, so there is nothing to pick — show the
  // name as static text rather than a one-option dropdown. (The server scopes
  // the roster and validates the tsm param; this is presentation only.)
  if (reps.length <= 1) {
    const only = reps[0];
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div>
          <span style={LBL}>TSM</span>
          <div style={{ ...SEL, minWidth: 180, cursor: 'default', background: 'var(--bg-sunk)', color: 'var(--fg-2)' }}>
            {only?.name ?? '—'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <label>
        <span style={LBL}>TSM</span>
        <select value={tsm} onChange={e => update('tsm', e.target.value)} style={{ ...SEL, minWidth: 180 }}>
          {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
    </div>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
