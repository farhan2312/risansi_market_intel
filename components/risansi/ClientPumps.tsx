'use client';

import { useState, useMemo, type CSSProperties } from 'react';

export interface PumpRow {
  id: number;
  pump_sl_no: string | null;        // SR No.
  pump_model_plate: string | null;  // Model
  model_no_internal: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: number;
  liquid: string | null;
  capacity: string | null;
  head: string | null;
  pump_speed: string | null;
  drive_rating: string | null;
  so_number: string | null;
  so_date: string | null;
  so_val: number | null;
  cust_po_number: string | null;
  ec_number: string | null;
  ec_date: string | null;
  consignee_name: string | null;
  consignee_city: string | null;
}

// RIL pump detail for one client + the installed-base discrepancy.
export function ClientPumps({ pumps, installedRil }: { pumps: PumpRow[]; installedRil: number }) {
  const [q, setQ] = useState('');
  const detailPumps = useMemo(() => pumps.reduce((s, p) => s + (p.quantity || 0), 0), [pumps]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pumps;
    return pumps.filter(p =>
      [p.pump_sl_no, p.pump_model_plate, p.product_name, p.so_number, p.ec_number, p.consignee_name]
        .some(v => (v ?? '').toLowerCase().includes(s)));
  }, [pumps, q]);

  const gap = installedRil - detailPumps;
  const disc = (() => {
    if (installedRil === 0 && detailPumps === 0) return null;
    if (installedRil === 0) return { tone: 'warn', text: `${detailPumps} pumps in detail records · no installed-base figure on record` };
    if (gap > 0)  return { tone: 'neg',  text: `Detail for ${detailPumps} of ${installedRil} installed pumps · ${gap} missing detail` };
    if (gap < 0)  return { tone: 'warn', text: `${detailPumps} pumps in detail records · installed base shows ${installedRil} (${-gap} more in detail)` };
    return { tone: 'pos', text: `All ${installedRil} installed pumps have detail records` };
  })();

  return (
    <div data-tabgroup="overview" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>RIL Pumps · Detail</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          {pumps.length} record{pumps.length !== 1 ? 's' : ''} · {detailPumps} pump{detailPumps !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Discrepancy callout */}
      {disc && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <Stat label="Installed base (RIL)" value={installedRil || '—'} />
          <span style={{ color: 'var(--fg-3)' }}>vs</span>
          <Stat label="Detail records" value={detailPumps} />
          <span style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: disc.tone === 'pos' ? 'var(--pos-soft, #D1FAE5)' : disc.tone === 'neg' ? '#FEE2E2' : '#FEF3C7',
            color: disc.tone === 'pos' ? '#065F46' : disc.tone === 'neg' ? '#9B1C1C' : '#92400E',
          }}>{disc.text}</span>
        </div>
      )}

      {pumps.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
          No pump detail records for this client.
        </div>
      ) : (
        <>
          {pumps.length > 6 && (
            <div style={{ padding: '10px 14px 0' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SR no, model, product, SO…" style={SEARCH} />
            </div>
          )}
          <div style={{ maxHeight: 420, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map(p => (
              <div key={p.id} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{p.pump_model_plate ?? '—'}</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>SR: <span style={{ fontFamily: 'var(--font-mono)' }}>{p.pump_sl_no ?? '—'}</span></span>
                  {p.quantity > 1 && <span style={QTY}>×{p.quantity}</span>}
                </div>
                {p.product_name && <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginBottom: 6 }}>{p.product_name}</div>}
                <div style={KV_GRID}>
                  <KV k="Liquid" v={p.liquid} />
                  <KV k="Capacity" v={p.capacity} />
                  <KV k="Head" v={p.head} />
                  <KV k="Speed" v={p.pump_speed} />
                  <KV k="Drive" v={p.drive_rating} />
                  <KV k="Internal model" v={p.model_no_internal} />
                  <KV k="SO" v={joinDate(p.so_number, p.so_date)} />
                  <KV k="SO value" v={p.so_val != null ? `₹${p.so_val.toLocaleString('en-IN')}` : null} />
                  <KV k="Cust PO" v={p.cust_po_number} />
                  <KV k="EC" v={joinDate(p.ec_number, p.ec_date)} />
                  <KV k="Consignee" v={p.consignee_name} />
                  <KV k="City" v={p.consignee_city} />
                </div>
              </div>
            ))}
            {visible.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: 12 }}>No pumps match.</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--fg)', lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}
function KV({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (<div><span style={{ fontSize: 9.5, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span><div style={{ fontSize: 12, color: 'var(--fg)' }}>{v}</div></div>);
}
function joinDate(a: string | null, d: string | null): string | null {
  if (!a && !d) return null;
  const dt = d ? new Date(d) : null;
  const ds = dt && !isNaN(dt.getTime()) ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  return [a, ds].filter(Boolean).join(' · ');
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500 };
const SEARCH: CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const CARD: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-elev)' };
const KV_GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '6px 14px' };
const QTY: CSSProperties = { fontSize: 11, fontWeight: 700, color: '#0A3D8F', background: 'var(--accent-soft, #EBF1FB)', padding: '1px 7px', borderRadius: 999 };
