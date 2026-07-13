'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';

export interface ExportRep { id: string; name: string }

// Opens the print-friendly planned-visits page (/print/planned-visits) for a
// chosen date range + optional rep, which the browser saves as PDF.
export function PlannedVisitsExport({ reps }: { reps: ExportRep[] }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');
  const [rep, setRep]   = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Default to the current calendar month (set client-side to avoid a hydration mismatch).
  useEffect(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // Local date components (NOT toISOString — that converts to UTC and shifts
    // the day back in +TZ regions like IST/GST).
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrom(iso(first)); setTo(iso(last));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const invalid = !from || !to || from > to;

  function generate() {
    if (invalid) return;
    const qs = new URLSearchParams({ from, to });
    if (rep) qs.set('rep', rep);
    window.open(`/print/planned-visits?${qs.toString()}`, '_blank');
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={BTN}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        Export Visits (PDF)
      </button>

      {open && (
        <div style={POP}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Export planned visits</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <label style={{ flex: 1 }}>
              <span style={LBL}>From</span>
              <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={INP} />
            </label>
            <label style={{ flex: 1 }}>
              <span style={LBL}>To</span>
              <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={INP} />
            </label>
          </div>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={LBL}>Rep</span>
            <select value={rep} onChange={e => setRep(e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              <option value="">All reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {invalid && <div style={{ fontSize: 11, color: 'var(--neg)', marginBottom: 8 }}>Pick a valid date range (From ≤ To).</div>}
          <button onClick={generate} disabled={invalid} style={{ ...GEN, opacity: invalid ? 0.5 : 1, cursor: invalid ? 'not-allowed' : 'pointer' }}>
            Generate PDF
          </button>
        </div>
      )}
    </div>
  );
}

const BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg)', borderRadius: 5, cursor: 'pointer' };
const POP: CSSProperties = { position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, width: 280, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8, boxShadow: '0 8px 28px rgba(10,22,40,0.16)', padding: 14 };
const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const INP: CSSProperties = { width: '100%', padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const GEN: CSSProperties = { width: '100%', padding: '8px 0', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6 };
