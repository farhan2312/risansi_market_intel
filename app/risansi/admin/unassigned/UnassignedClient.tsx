'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@/components/risansi';
import { mapClients } from '@/app/actions/sysadmin';

export interface UnassignedRow {
  id:         number;
  code:       string;
  legal_name: string;
  industry:   string | null;
  zone:       string | null;
  tour_id:    number | null;
  no_owner:   boolean;
  no_tour:    boolean;
}
export interface OwnerOption { id: number; name: string; zone: string | null; }
export interface TourOption  { id: number; name: string; zone: string | null; }

export function UnassignedClient({ clients, users, tours }: {
  clients: UnassignedRow[];
  users: OwnerOption[];
  tours: TourOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [tourId, setTourId] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const allSelected = clients.length > 0 && selected.size === clients.length;

  function toggle(id: number) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(clients.map(c => c.id)));
  }

  function toggleOwner(id: string) {
    setOwnerIds(o => o.includes(id) ? o.filter(x => x !== id) : [...o, id]);
  }

  function apply() {
    setErr(''); setOk('');
    if (selected.size === 0) { setErr('Select at least one client'); return; }
    if (ownerIds.length === 0 && !tourId) { setErr('Pick at least one owner or a tour'); return; }
    const f = new FormData();
    f.set('client_ids', JSON.stringify([...selected]));
    f.set('owner_ids', JSON.stringify(ownerIds.map(n => parseInt(n, 10))));
    f.set('tour_id', tourId);
    start(async () => {
      try {
        await mapClients(f);
        setOk(`Mapped ${selected.size} client${selected.size !== 1 ? 's' : ''}.`);
        setSelected(new Set());
        setOwnerIds([]);
        setTourId('');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to map clients');
      }
    });
  }

  return (
    <>
      {/* Bulk action bar */}
      <div style={BAR}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
          {selected.size} selected
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {/* Owner multi-select */}
          <details style={{ position: 'relative' }}>
            <summary style={DROPDOWN_SUMMARY}>
              Owners{ownerIds.length ? ` (${ownerIds.length})` : ''} ▾
            </summary>
            <div style={DROPDOWN_PANEL}>
              {users.map(u => (
                <label key={u.id} style={CHECK_ROW}>
                  <input type="checkbox" checked={ownerIds.includes(String(u.id))}
                    onChange={() => toggleOwner(String(u.id))}
                    style={{ accentColor: '#1A5CB8' }} />
                  <span>{u.name}{u.zone ? ` · ${u.zone}` : ''}</span>
                </label>
              ))}
              {users.length === 0 && <div style={{ padding: 8, fontSize: 12, color: 'var(--fg-3)' }}>No users</div>}
            </div>
          </details>

          <select value={tourId} onChange={e => setTourId(e.target.value)} style={{ ...INP, maxWidth: 220 }}>
            <option value="">— No tour change —</option>
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
                {['Code', 'Client', 'Industry', 'Zone', 'Missing'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
                  All clients have an owner and a tour. 🎉
                </td></tr>
              ) : clients.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none', background: selected.has(c.id) ? 'rgba(26,92,184,0.05)' : undefined }}>
                  <td style={TD}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} style={{ accentColor: '#1A5CB8' }} />
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{c.code}</td>
                  <td style={{ ...TD, fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</td>
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

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const BAR: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 12, background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const INP: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6, color: '#0D1B2A', outline: 'none', boxSizing: 'border-box' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
const DROPDOWN_SUMMARY: CSSProperties = { listStyle: 'none', cursor: 'pointer', padding: '7px 12px', fontSize: 13, background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6, color: '#0D1B2A', userSelect: 'none' };
const DROPDOWN_PANEL: CSSProperties = { position: 'absolute', top: '100%', right: 0, zIndex: 60, marginTop: 4, minWidth: 220, maxHeight: 260, overflowY: 'auto', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, boxShadow: '0 4px 20px rgba(10,22,40,0.13)', padding: 6 };
const CHECK_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 4 };
const ERR_BOX: CSSProperties = { padding: '9px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5, fontSize: 12, color: '#9B1C1C', marginBottom: 12 };
const OK_BOX: CSSProperties = { padding: '9px 12px', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 5, fontSize: 12, color: '#065F46', marginBottom: 12 };
