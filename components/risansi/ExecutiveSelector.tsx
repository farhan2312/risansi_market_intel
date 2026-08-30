'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface SelRep { id: string; name: string }

// TSM picker for the Executive Review page. The review is scoped to the current
// fiscal year to date and turnover spans full FYs, so there is no month picker.
//
// The Accounts control decides which of a TSM's clients the whole review counts.
// It defaults to the ones they OWN, because that is the book they are answerable
// for — folding in accounts they merely cover would credit them with revenue and
// visits belonging to a colleague's client, and on a rep who covers a lot it
// moves every number on the page at once. Covering work is real work, so it can
// be added back; it is a deliberate choice rather than the default.
export function ExecutiveSelector({ reps, tsm, scope }: {
  reps: SelRep[]; tsm: string; scope: 'own' | 'all';
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
  const accounts = (
    <label>
      <span style={LBL}>Accounts</span>
      <select
        value={scope}
        onChange={e => update('scope', e.target.value === 'all' ? 'all' : '')}
        style={{ ...SEL, minWidth: 200 }}
      >
        <option value="own">Primary only</option>
        <option value="all">Primary + secondary</option>
      </select>
    </label>
  );

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
        {accounts}
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
      {accounts}
    </div>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
