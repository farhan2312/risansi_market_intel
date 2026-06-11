'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateRouteRep } from '@/app/actions/risansi-reps';
import { type RepData } from './RepRow';

export interface TourData {
  id: number;
  name: string;
  zone: string;
  primary_rep_id: number | null;
  visit_freq_key_days: number | null;
  visit_freq_std_days: number | null;
  alert_key_days: number | null;
  alert_std_days: number | null;
  rep_name: string | null;
  client_count: string;
}

export function TourRow({ route, reps }: { route: TourData; reps: RepData[] }) {
  const [editing, setEditing]         = useState(false);
  const [selectedRep, setSelectedRep] = useState(route.primary_rep_id ? String(route.primary_rep_id) : '');
  const [loading, setLoading]         = useState(false);
  const router = useRouter();

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateRouteRep(route.id, selectedRep ? parseInt(selectedRep, 10) : null);
      setEditing(false);
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--line)' }}>
      <td style={TD}>
        <div style={{ fontWeight: 500, color: 'var(--fg)' }}>{route.name}</div>
      </td>
      <td style={TD}>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={selectedRep}
              onChange={e => setSelectedRep(e.target.value)}
              style={{ flex: 1, padding: '5px 8px', border: '1px solid #1A5CB8', borderRadius: 5, fontSize: 12, background: 'white', fontFamily: 'inherit' }}
            >
              <option value="">— Unassigned —</option>
              {reps.filter(r => r.is_active).map(r => (
                <option key={r.id} value={String(r.id)}>{r.name}{r.zone ? ` · ${r.zone}` : ''}</option>
              ))}
            </select>
            <button onClick={handleSave} disabled={loading} style={{ padding: '5px 10px', borderRadius: 5, background: '#0A3D8F', color: 'white', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              {loading ? '…' : '✓'}
            </button>
            <button onClick={() => setEditing(false)} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              ×
            </button>
          </div>
        ) : (
          <div
            onClick={() => setEditing(true)}
            title="Click to change rep"
            style={{ cursor: 'pointer', fontSize: 12, color: route.rep_name ? 'var(--fg)' : 'var(--neg)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {route.rep_name ?? '⚠ Unassigned'}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4 }}>
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
        )}
      </td>
      <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
        {route.client_count}
      </td>
      <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
        {route.visit_freq_key_days ?? '—'}
      </td>
      <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
        {route.visit_freq_std_days ?? '—'}
      </td>
    </tr>
  );
}

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
