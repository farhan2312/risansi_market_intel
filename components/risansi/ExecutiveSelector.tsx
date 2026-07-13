'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface SelRep { id: string; name: string }

// TSM + month picker for the Executive Review page. Writes to the URL so the
// server component re-queries for the chosen TSM / month.
export function ExecutiveSelector({ reps, tsm, month }: { reps: SelRep[]; tsm: string; month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const update = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <label>
        <span style={LBL}>TSM</span>
        <select value={tsm} onChange={e => update('tsm', e.target.value)} style={{ ...SEL, minWidth: 180 }}>
          {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label>
        <span style={LBL}>Month</span>
        <input type="month" value={month} onChange={e => update('month', e.target.value)} style={SEL} />
      </label>
    </div>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
