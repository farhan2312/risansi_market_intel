'use client';

import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { assignClientTour } from '@/app/actions/risansi';

interface Tour { id: string; name: string; zone: string | null; reps: string; managers: string }

// Searchable tour picker used inline in the New Opportunity form when a client
// isn't on a tour yet. Shows each tour's reps and manager so the assigner can
// see who the work will go to. On pick it maps the client and reports back the
// resolved owner so the form can drop its "no tour" block without a reload.
export function TourAssignPicker({ clientId, onAssigned }: {
  clientId: string;
  onAssigned: (ownerName: string | null, tourName: string | null) => void;
}) {
  const [tours, setTours]   = useState<Tour[]>([]);
  const [q, setQ]           = useState('');
  const [open, setOpen]     = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr]       = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/risansi/tours')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (active) setTours(Array.isArray(d) ? d : []); })
      .catch(() => { if (active) setTours([]); });
    return () => { active = false; };
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tours;
    return tours.filter(t => [t.name, t.zone, t.reps, t.managers].some(v => (v ?? '').toLowerCase().includes(s)));
  }, [tours, q]);

  const pick = async (t: Tour) => {
    setBusyId(t.id); setErr('');
    try {
      const res = await assignClientTour(Number(clientId), Number(t.id));
      onAssigned(res.ownerName, res.tourName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not assign the tour.');
      setBusyId(null);
    }
  };

  return (
    <div>
      <label style={LBL}>Map this client to a tour</label>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search tour, rep, or zone…"
        style={INP}
      />
      {err && <div style={ERR}>{err}</div>}
      {open && (
        <div style={LIST}>
          {shown.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 12, color: 'var(--fg-3)', textAlign: 'center' }}>No matching tours</div>
          ) : shown.map(t => (
            <button key={t.id} type="button" onClick={() => pick(t)} disabled={busyId != null} style={ROW}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)' }}>{t.name}</span>
                {t.zone && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>· {t.zone}</span>}
                {busyId === t.id && <span style={{ fontSize: 11, color: '#0A3D8F', marginLeft: 'auto' }}>Assigning…</span>}
              </div>
              <div style={META}>
                <span style={{ minWidth: 0 }}><span style={BLABEL}>Reps</span> {t.reps || '— none —'}</span>
                <span style={{ minWidth: 0 }}><span style={BLABEL}>Manager</span> {t.managers || '— none —'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INP: CSSProperties = { display: 'block', width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-elev)', color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const LIST: CSSProperties = { marginTop: 6, border: '1px solid var(--line-strong)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-paper)' };
const ROW: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' };
const META: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginTop: 4, fontSize: 11, color: 'var(--fg-2)' };
const BLABEL: CSSProperties = { fontSize: 9, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 5 };
const ERR: CSSProperties = { marginTop: 6, padding: '7px 10px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 12, color: '#9B1C1C' };
