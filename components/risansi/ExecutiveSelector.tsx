'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { MultiSelectFilter } from './MultiSelectFilter';

export interface SelRep { id: string; name: string }
export interface MonthOpt { value: string; label: string }

// TSM + month picker for the Executive Review page. The TSM select writes to
// the URL directly; the month picker is a multi-select (month + year) so the
// report can scope to one or several specific months at once.
export function ExecutiveSelector({ reps, tsm, monthOptions, selectedMonths }: {
  reps: SelRep[]; tsm: string; monthOptions: MonthOpt[]; selectedMonths: string[];
}) {
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
      <div>
        <span style={LBL}>Month(s)</span>
        <div style={{ marginTop: 4 }}>
          <MultiSelectFilter param="months" label="Months" options={monthOptions} selected={selectedMonths} />
        </div>
      </div>
    </div>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
