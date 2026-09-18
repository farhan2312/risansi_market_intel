'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { STATUSES, DEPARTMENTS_LIST, SEVERITY_LABEL } from '@/lib/risansi-complaint-flow';

// The filters over the complaints list. Every control writes the URL, so the
// analytics, the table and the export all read the same state, and a clicked
// bar (which is also just a URL) shows up here as a chosen value.

export interface FilterOptions {
  types: string[]; categories: string[]; responsibles: string[];
  rootCauses: string[]; partTypes: string[]; partNames: string[];
  reps: { id: number; name: string }[]; holders: { id: number; name: string }[];
}

export function ComplaintFilterBar({ value, options, basePath }: {
  value: Record<string, string | undefined>;
  options: FilterOptions;
  basePath: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(value.q ?? '');
  useEffect(() => { setQ(value.q ?? ''); }, [value.q]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = { ...value, ...patch };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) usp.set(k, v);
    const s = usp.toString();
    router.push(s ? `${basePath}?${s}` : basePath);
  };
  // `sort` rides along in value so a filter change keeps the column order, but it is not a filter.
  const active = Object.entries(value).filter(([k, v]) => v && k !== 'sort').length;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <form onSubmit={e => { e.preventDefault(); set({ q: q.trim() || undefined }); }} style={{ display: 'flex' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search no., client, serial, EC, text…"
          style={{ ...INPUT, width: 240 }} />
      </form>
      <Sel label="Status" v={value.status} onChange={v => set({ status: v })}
        opts={[['open', 'All open'], ['closed', 'Resolved & closed'], ...STATUSES.map(s => [s, s] as [string, string])]} />
      <Sel label="Severity" v={value.sev} onChange={v => set({ sev: v })}
        opts={[...(['S1', 'S2', 'S3', 'S4'] as const).map(s => [s, SEVERITY_LABEL[s]] as [string, string]), ['none', 'Not yet rated']]} />
      <Sel label="Sitting with" v={value.dept} onChange={v => set({ dept: v })} opts={DEPARTMENTS_LIST.map(d => [d, d])} />
      {options.holders.length > 0 && (
        <Sel label="Holder" v={value.holder} onChange={v => set({ holder: v })} opts={options.holders.map(h => [String(h.id), h.name])} />
      )}
      <Sel label="Type" v={value.type} onChange={v => set({ type: v })} opts={options.types.map(t => [t, t])} />
      <Sel label="Category" v={value.cat} onChange={v => set({ cat: v })} opts={options.categories.map(t => [t, t])} />
      <Sel label="Responsible" v={value.resp} onChange={v => set({ resp: v })} opts={options.responsibles.map(t => [t, t])} />
      <Sel label="Root cause" v={value.rcc} onChange={v => set({ rcc: v })} opts={options.rootCauses.map(t => [t, t])} />
      <Sel label="Part type" v={value.ptype} onChange={v => set({ ptype: v })} opts={options.partTypes.map(t => [t, t])} />
      <Sel label="Part name" v={value.pname} onChange={v => set({ pname: v })} opts={options.partNames.map(t => [t, t])} />
      {options.reps.length > 1 && (
        <Sel label="Rep" v={value.rep} onChange={v => set({ rep: v })} opts={options.reps.map(r => [String(r.id), r.name])} />
      )}
      <Sel label="Records" v={value.era} onChange={v => set({ era: v })} opts={[['workflow', 'Workflow only'], ['legacy', 'Legacy only']]} />
      <label style={CHK}>
        <input type="checkbox" checked={value.overdue === '1'} onChange={e => set({ overdue: e.target.checked ? '1' : undefined })} /> Overdue only
      </label>
      <input type="date" value={value.from ?? ''} onChange={e => set({ from: e.target.value || undefined })} style={{ ...INPUT, width: 130 }} title="Raised from" />
      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>to</span>
      <input type="date" value={value.to ?? ''} onChange={e => set({ to: e.target.value || undefined })} style={{ ...INPUT, width: 130 }} title="Raised to" />
      {active > 0 && (
        <button type="button" onClick={() => router.push(value.sort ? `${basePath}?sort=${value.sort}` : basePath)} style={CLEAR}>Clear {active} filter{active === 1 ? '' : 's'}</button>
      )}
    </div>
  );
}

function Sel({ label, v, onChange, opts }: { label: string; v?: string; onChange: (v: string | undefined) => void; opts: [string, string][] }) {
  const known = !v || opts.some(([k]) => k === v);
  return (
    <select value={v ?? ''} onChange={e => onChange(e.target.value || undefined)}
      style={{ ...INPUT, width: 'auto', minWidth: 120, color: v ? 'var(--fg)' : 'var(--fg-3)', borderColor: v ? 'var(--accent)' : 'var(--line-strong)' }}>
      <option value="">{label}</option>
      {!known && <option value={v}>{v}</option>}
      {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

const INPUT: CSSProperties = {
  height: 32, padding: '0 10px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const CHK: CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', whiteSpace: 'nowrap' };
const CLEAR: CSSProperties = { height: 32, padding: '0 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--accent)', cursor: 'pointer' };
