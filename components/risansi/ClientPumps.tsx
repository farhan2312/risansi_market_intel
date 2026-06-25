'use client';

import { useState, useMemo, type CSSProperties } from 'react';

export interface PumpRow {
  id: number;
  year: number | null;
  pump_model_plate: string | null;  // Model
  quantity: number;                 // Qty
  supplier: string | null;          // Supplier (customer of record)
  ec_number: string | null;         // EC No
  pump_sl_no: string | null;        // SR Number
  liquid: string | null;
  capacity: string | null;
  head: string | null;
}

// RIL pump detail for one client + the installed-base discrepancy.
export function ClientPumps({ pumps, installedRil }: { pumps: PumpRow[]; installedRil: number }) {
  const [q, setQ] = useState('');
  const detailPumps = useMemo(() => pumps.reduce((s, p) => s + (p.quantity || 0), 0), [pumps]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pumps;
    return pumps.filter(p =>
      [p.pump_model_plate, p.pump_sl_no, p.supplier, p.ec_number, p.liquid, String(p.year ?? '')]
        .some(v => (v ?? '').toLowerCase().includes(s)));
  }, [pumps, q]);

  const gap = installedRil - detailPumps;
  const disc = (() => {
    if (installedRil === 0 && detailPumps === 0) return null;
    if (installedRil === 0) return { tone: 'warn' as const, text: `${detailPumps} pumps on record · no installed-base figure` };
    if (gap > 0) return { tone: 'neg' as const, text: `${gap} missing detail` };
    if (gap < 0) return { tone: 'warn' as const, text: `${-gap} more in detail than installed base` };
    return { tone: 'pos' as const, text: 'All installed pumps have detail' };
  })();

  return (
    <div data-tabgroup="overview" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>RIL Pumps</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          {detailPumps} pump{detailPumps !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Discrepancy: installed-base count vs how many we hold detail for */}
      {disc && (
        <div style={DISC}>
          <span><b style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--fg)' }}>{detailPumps}</b>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}> of </span>
            <b style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--fg)' }}>{installedRil || '—'}</b>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}> installed pumps have detail records</span>
          </span>
          <span style={{ ...PILL, ...TONE[disc.tone] }}>{disc.text}</span>
        </div>
      )}

      {pumps.length === 0 ? (
        <div style={{ padding: '22px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
          No pump records for this client.
        </div>
      ) : (
        <>
          {pumps.length > 6 && (
            <div style={{ padding: '10px 14px 0' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search model, SR no, year…" style={SEARCH} />
            </div>
          )}
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {visible.map((p, i) => (
              <div key={p.id} style={{ ...ROW, borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                {/* Year gutter */}
                <span style={YEAR}>{p.year ?? '—'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Tier 1: model + qty */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
                      {p.pump_model_plate ?? '—'}
                    </span>
                    {p.quantity > 1 && <span style={QTY}>×{p.quantity}</span>}
                  </div>
                  {/* Tier 2: specs (muted) */}
                  {(p.liquid || p.capacity || p.head) && (
                    <div style={SPECS}>{[p.liquid, p.capacity, p.head].filter(Boolean).join('  ·  ')}</div>
                  )}
                  {/* Tier 3: refs (tiny) */}
                  <div style={REFS}>
                    {p.pump_sl_no && <span>SR <span style={{ fontFamily: 'var(--font-mono)' }}>{p.pump_sl_no}</span></span>}
                    {p.ec_number && <span>EC <span style={{ fontFamily: 'var(--font-mono)' }}>{p.ec_number}</span></span>}
                    {p.supplier && <span>{p.supplier}</span>}
                  </div>
                </div>
              </div>
            ))}
            {visible.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: 16 }}>No pumps match.</div>}
          </div>
        </>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500 };
const DISC: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', flexWrap: 'wrap' };
const PILL: CSSProperties = { marginLeft: 'auto', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' };
const TONE: Record<string, CSSProperties> = {
  pos:  { background: '#D1FAE5', color: '#065F46' },
  neg:  { background: '#FEE2E2', color: '#9B1C1C' },
  warn: { background: '#FEF3C7', color: '#92400E' },
};
const SEARCH: CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const ROW: CSSProperties = { display: 'flex', gap: 12, padding: '10px 14px', alignItems: 'flex-start' };
const YEAR: CSSProperties = { flexShrink: 0, width: 38, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--accent)', paddingTop: 1 };
const QTY: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: '#0A3D8F', background: 'var(--accent-soft, #EBF1FB)', padding: '1px 6px', borderRadius: 999 };
const SPECS: CSSProperties = { fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2 };
const REFS: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, color: 'var(--fg-3)', marginTop: 3 };
