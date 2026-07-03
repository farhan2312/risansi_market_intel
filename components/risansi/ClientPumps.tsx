'use client';

import { useState, useMemo, type CSSProperties } from 'react';

export interface PumpRow {
  id: number;
  pump_model_plate: string | null;  // Model
  quantity: number;                 // Qty (always 1 in serial-level data)
  supplier: string | null;          // Supplier (customer of record)
  ec_number: string | null;         // EC No
  so_number: string | null;         // SO No
  pump_sl_no: string | null;        // Serial / SR No
  liquid: string | null;
  capacity: string | null;
  head: string | null;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// RIL pump detail for one client + the installed-base discrepancy.
export function ClientPumps({ pumps, installedRil, clientName }: {
  pumps: PumpRow[]; installedRil: number; clientName: string;
}) {
  const [q, setQ] = useState('');
  const clientKey = norm(clientName);
  const detailPumps = useMemo(() => pumps.reduce((s, p) => s + (p.quantity || 0), 0), [pumps]);

  // Show "Supplier" only when it's a different party (e.g. an EPC), not the
  // client itself — no point repeating the client's own name on every row.
  const showSupplier = (s: string | null) => {
    if (!s) return false;
    const k = norm(s);
    return !(k === clientKey || k.includes(clientKey) || clientKey.includes(k));
  };

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pumps;
    return pumps.filter(p =>
      [p.pump_model_plate, p.pump_sl_no, p.supplier, p.ec_number, p.so_number, p.liquid]
        .some(v => (v ?? '').toLowerCase().includes(s)));
  }, [pumps, q]);

  const gap = installedRil - detailPumps;
  const disc = (() => {
    if (installedRil === 0 && detailPumps === 0) return null;
    if (installedRil === 0) return { tone: 'warn' as const, text: `no installed-base figure on record` };
    if (gap > 0) return { tone: 'neg' as const, text: `${gap} missing detail` };
    if (gap < 0) return { tone: 'warn' as const, text: `${-gap} more in detail than installed base` };
    return { tone: 'pos' as const, text: 'all installed pumps have detail' };
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
          <div style={{ maxHeight: 460, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visible.map(p => (
              <div key={p.id} style={CARD}>
                {/* Tier 1 — year · model · qty */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
                    {p.pump_model_plate ?? '—'}
                  </span>
                  {p.quantity > 1 && <span style={QTY}>×{p.quantity}</span>}
                </div>
                {/* Tier 2 — labelled detail */}
                <div style={KV_GRID}>
                  <KV k="Liquid" v={p.liquid} />
                  <KV k="Capacity" v={p.capacity} />
                  <KV k="Head" v={p.head} />
                  <KV k="SR No" v={p.pump_sl_no} mono />
                  <KV k="EC No" v={p.ec_number} mono />
                  <KV k="SO No" v={p.so_number} mono />
                  {showSupplier(p.supplier) && <KV k="Supplier" v={p.supplier} span={3} />}
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

function KV({ k, v, mono, span }: { k: string; v: string | null; mono?: boolean; span?: number }) {
  // minWidth:0 lets the grid cell shrink to its track; overflowWrap breaks long
  // mono tokens (EC/SR/SO numbers) so they wrap inside the cell instead of
  // overflowing into — and overlapping — the next column.
  return (
    <div style={{ minWidth: 0, ...(span ? { gridColumn: `span ${span}` } : {}) }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
      <div style={{ fontSize: 12, color: v ? 'var(--fg)' : 'var(--fg-3)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', overflowWrap: 'anywhere' }}>{v || '—'}</div>
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
const CARD: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-elev)' };
const QTY: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: '#0A3D8F', background: 'var(--accent-soft, #EBF1FB)', padding: '1px 7px', borderRadius: 999 };
const KV_GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: '8px 14px' };
