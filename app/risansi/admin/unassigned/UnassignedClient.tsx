'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@/components/risansi';
import { mapClients } from '@/app/actions/sysadmin';
import { clientStatusLabel } from '@/lib/risansi-client-status';

export interface UnassignedRow {
  id:         number;
  code:       string;
  legal_name: string;
  industry:   string | null;
  zone:       string | null;
  status:     string | null;
  tour_id:    number | null;
  no_owner:   boolean;
  no_tour:    boolean;
}
export interface OwnerOption { id: number; name: string; zone: string | null; }
export interface TourOption  { id: number; name: string; zone: string | null; }
export interface UnassignedCounts { no_owner: number; no_tour: number; both: number; needing: number; }

export function UnassignedClient({ clients, tours, counts }: {
  clients: UnassignedRow[];
  tours: TourOption[];
  counts: UnassignedCounts;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tourId, setTourId] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // Filters
  const [search, setSearch]   = useState('');
  const [zoneF, setZoneF]     = useState('');
  const [statusF, setStatusF] = useState('');
  const [missing, setMissing] = useState('all'); // all | noowner | notour | both
  const zones    = [...new Set(clients.map(c => c.zone).filter(Boolean) as string[])].sort();
  const statuses = [...new Set(clients.map(c => c.status).filter(Boolean) as string[])].sort();

  const visible = clients.filter(c => {
    if (search) {
      const qq = search.toLowerCase();
      if (!c.legal_name.toLowerCase().includes(qq) && !c.code.toLowerCase().includes(qq)) return false;
    }
    if (zoneF && c.zone !== zoneF) return false;
    if (statusF && c.status !== statusF) return false;
    if (missing === 'noowner' && !c.no_owner) return false;
    if (missing === 'notour'  && !c.no_tour) return false;
    if (missing === 'both'    && !(c.no_owner && c.no_tour)) return false;
    return true;
  });

  const allSelected = visible.length > 0 && visible.every(c => selected.has(c.id));

  function toggle(id: number) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map(c => c.id)));
  }

  function apply() {
    setErr(''); setOk('');
    if (selected.size === 0) { setErr('Select at least one client'); return; }
    if (!tourId) { setErr('Pick a tour to assign these clients to'); return; }
    const f = new FormData();
    f.set('client_ids', JSON.stringify([...selected]));
    f.set('tour_id', tourId);
    start(async () => {
      try {
        await mapClients(f);
        setOk(`Assigned ${selected.size} client${selected.size !== 1 ? 's' : ''} to a tour.`);
        setSelected(new Set());
        setTourId('');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to assign clients');
      }
    });
  }

  return (
    <>
      {/* KPI cards */}
      <div style={KPI_ROW}>
        <Kpi label="To Map" value={counts.needing} color={counts.needing ? 'var(--warn)' : 'var(--pos)'} />
        <Kpi label="No Rep / Manager" value={counts.no_owner} color={counts.no_owner ? 'var(--warn)' : undefined} />
        <Kpi label="No Tour" value={counts.no_tour} color={counts.no_tour ? 'var(--warn)' : undefined} />
        <Kpi label="Missing Both" value={counts.both} color={counts.both ? 'var(--neg)' : undefined} />
      </div>

      {/* Filter bar */}
      <div style={FILTER_BAR}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or code…" style={SEARCH_INP} />
        <select value={zoneF} onChange={e => setZoneF(e.target.value)} style={SEL}>
          <option value="">All zones</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select value={statusF} onChange={e => setStatusF(e.target.value)} style={SEL}>
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{clientStatusLabel(s)}</option>)}
        </select>
        <select value={missing} onChange={e => setMissing(e.target.value)} style={SEL}>
          <option value="all">Missing: any</option>
          <option value="noowner">Missing rep</option>
          <option value="notour">Missing tour</option>
          <option value="both">Missing both</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-3)' }}>
          {visible.length} shown
        </span>
      </div>

      {/* Bulk action bar */}
      <div style={BAR}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
          {selected.size} selected
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select value={tourId} onChange={e => setTourId(e.target.value)} style={CONTROL}>
            <option value="">— Assign to tour —</option>
            {tours.map(t => <option key={t.id} value={String(t.id)}>{t.name}{t.zone ? ` · ${t.zone}` : ''}</option>)}
          </select>

          <button type="button" disabled={pending || selected.size === 0} onClick={apply}
            style={{ ...PRIMARY_BTN, opacity: pending || selected.size === 0 ? 0.5 : 1 }}>
            {pending ? 'Applying…' : 'Apply to selected'}
          </button>
        </div>
      </div>

      {err && <div style={ERR_BOX}>{err}</div>}
      {ok && <div style={OK_BOX}>{ok}</div>}

      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                <th style={{ ...TH, width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: '#1A5CB8' }} />
                </th>
                {['Code', 'Client', 'Status', 'Industry', 'Zone', 'Missing'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
                  {clients.length === 0 ? 'All clients have an owner and a tour. 🎉' : 'No clients match the current filters.'}
                </td></tr>
              ) : visible.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--line)' : 'none', background: selected.has(c.id) ? 'rgba(26,92,184,0.05)' : undefined }}>
                  <td style={TD}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} style={{ accentColor: '#1A5CB8' }} />
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{c.code}</td>
                  <td style={{ ...TD, fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</td>
                  <td style={TD}>{c.status
                    ? <Tag kind={c.status === 'ACTIVE' ? 'pos' : c.status === 'PROSPECTIVE_LEAD' ? 'accent' : c.status === 'CLOSED' ? 'neg' : 'warn'}>{clientStatusLabel(c.status)}</Tag>
                    : '—'}</td>
                  <td style={TD}>{c.industry ? <Tag>{c.industry}</Tag> : '—'}</td>
                  <td style={TD}>{c.zone ?? '—'}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                    {c.no_owner && <Tag kind="warn">No rep</Tag>}
                    {c.no_tour && <span style={{ marginLeft: c.no_owner ? 6 : 0 }}><Tag kind="warn">No tour</Tag></span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={KPI_CARD}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: color ?? 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}

const KPI_ROW: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 };
const KPI_CARD: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px' };
const FILTER_BAR: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 };
const SEARCH_INP: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', minWidth: 200 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const BAR: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 12, background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
// Shared look for the rep/manager dropdown button and the tour <select> so both
// match: same border/height + the same custom chevron (native select chevron
// suppressed via appearance:none).
const CONTROL: CSSProperties = {
  width: 210, textAlign: 'left',
  padding: '7px 28px 7px 10px', fontSize: 13, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6,
  color: '#0D1B2A', outline: 'none', boxSizing: 'border-box', cursor: 'pointer',
  appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%236B7FA3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6.5 8 10.5 12 6.5'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
};
const ERR_BOX: CSSProperties = { padding: '9px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5, fontSize: 12, color: '#9B1C1C', marginBottom: 12 };
const OK_BOX: CSSProperties = { padding: '9px 12px', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 5, fontSize: 12, color: '#065F46', marginBottom: 12 };
