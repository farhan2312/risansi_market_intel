'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';

interface Rep {
  id:       string;
  name:     string;
  zone:     string | null;
  route:    string | null;
  rep_code?: string | null;
}

interface Props {
  label:        string;
  paramName:    string;   // hidden input name for id  e.g. 'primary_rep_id'
  nameName:     string;   // hidden input name for rep name
  defaultId?:   number | string | null;
  defaultName?: string | null;
  required?:    boolean;
}

export function RepSelector({ label, paramName, nameName, defaultId, defaultName, required }: Props) {
  const [reps, setReps]             = useState<Rep[]>([]);
  const [query, setQuery]           = useState('');
  const [open, setOpen]             = useState(false);
  const [selId, setSelId]           = useState<string>(defaultId != null ? String(defaultId) : '');
  const [selName, setSelName]       = useState<string>(defaultName ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/risansi/reps').then(r => r.json()).then(setReps).catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query.trim()
    ? reps.filter(r =>
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        (r.zone  ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (r.route ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : reps;

  function select(rep: Rep | null) {
    setSelId(rep?.id ?? '');
    setSelName(rep?.name ?? '');
    setQuery('');
    setOpen(false);
  }

  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>}
      </label>

      {/* Hidden fields that get submitted with the form */}
      <input type="hidden" name={paramName} value={selId} />
      <input type="hidden" name={nameName}  value={selName} />

      {selId ? (
        // Selected chip
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1, padding: '7px 10px',
            background: '#EFF6FF', border: '1px solid #93C5FD',
            borderRadius: 6, fontSize: 13, color: '#1D4ED8', fontWeight: 500,
          }}>
            {selName}
          </div>
          <button type="button" onClick={() => select(null)} style={CLEAR_BTN} title="Clear">×</button>
        </div>
      ) : (
        <div ref={ref} style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder={`Search ${label.toLowerCase()}…`}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            style={INP}
          />
          {open && (
            <div style={DROPDOWN}>
              {/* No-rep option */}
              <div
                onClick={() => select(null)}
                style={OPTION_STYLE}
                onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <span style={{ color: '#94A3B8', fontStyle: 'italic', fontSize: 12 }}>— No rep assigned</span>
              </div>

              {filtered.slice(0, 40).map(r => (
                <div
                  key={r.id}
                  onClick={() => select(r)}
                  style={OPTION_STYLE}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{r.name}</span>
                  {(r.zone || r.route) && (
                    <span style={{ fontSize: 11, color: '#6B7FA3', marginLeft: 6 }}>
                      {[r.zone, r.route].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              ))}

              {filtered.length === 0 && (
                <div style={{ padding: '10px 12px', fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>
                  No reps found
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1',
  borderRadius: 6, color: '#0D1B2A', outline: 'none',
  boxSizing: 'border-box',
};

const DROPDOWN: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
  background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6,
  boxShadow: '0 4px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto',
  marginTop: 2,
};

const OPTION_STYLE: CSSProperties = {
  padding: '9px 12px', cursor: 'pointer',
  borderBottom: '1px solid #F1F5F9',
  display: 'flex', alignItems: 'center',
  transition: 'background 0.1s',
};

const CLEAR_BTN: CSSProperties = {
  width: 30, height: 34, display: 'grid', placeItems: 'center',
  background: 'transparent', border: '1px solid #CBD5E1',
  color: '#94A3B8', borderRadius: 6, cursor: 'pointer',
  fontSize: 16, flexShrink: 0,
};
