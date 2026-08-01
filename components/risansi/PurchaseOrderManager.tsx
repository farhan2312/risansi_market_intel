'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { listPurchaseOrders, addPurchaseOrder, deletePurchaseOrder } from '@/app/actions/risansi';
import type { PurchaseOrder } from '@/lib/risansi-purchase-orders';

// Customer Purchase Orders for a Won opportunity (shown in the Edit drawer's Won
// view, alongside Sales Orders). A free-standing list — no coverage / Open-Closed
// maths — reads/adds/removes POs directly against the server.

const CR = 10_000_000;
const fmtInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export function PurchaseOrderManager({ oppId, canEdit }: {
  oppId: number;
  canEdit: boolean;
}) {
  const [pos, setPos]   = useState<PurchaseOrder[] | null>(null);
  const [num, setNum]   = useState('');
  const [date, setDate] = useState('');
  const [val, setVal]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    let active = true;
    listPurchaseOrders(oppId)
      .then(r => { if (active) setPos(r); })
      .catch(() => { if (active) setPos([]); });
    return () => { active = false; };
  }, [oppId]);

  const totalInr = (pos ?? []).reduce((s, o) => s + Number(o.po_value_cr) * CR, 0);

  const add = async () => {
    if (!num.trim() || !date || !(parseFloat(val) > 0)) { setErr('PO Number, Date and a Value greater than zero are all required.'); return; }
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.set('po_number', num); fd.set('po_date', date); fd.set('po_value_inr', val);
      const rows = await addPurchaseOrder(oppId, fd);
      setPos(rows); setNum(''); setDate(''); setVal('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the purchase order.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    setBusy(true); setErr('');
    try { setPos(await deletePurchaseOrder(id)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the purchase order.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={HEAD}>
        <span>Purchase Orders</span>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--fg-3)', textTransform: 'none', letterSpacing: 0 }}>customer POs</span>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pos === null ? (
          <div style={MUTED}>Loading…</div>
        ) : pos.length === 0 ? (
          <div style={MUTED}>No purchase orders yet.{canEdit ? ' Add the first below.' : ''}</div>
        ) : (
          pos.map(o => (
            <div key={o.id} style={ROW}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{o.po_number}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>{o.po_date}</span>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtInr(Number(o.po_value_cr) * CR)}</span>
                {canEdit && (
                  <button type="button" onClick={() => remove(o.id)} disabled={busy} aria-label="Remove PO"
                    style={{ border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: '#9B1C1C', borderRadius: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
                )}
              </span>
            </div>
          ))
        )}

        {pos !== null && pos.length > 0 && (
          <div style={{ ...ROW, borderTop: '1px solid var(--line)', paddingTop: 8, fontWeight: 600 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>PO total</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{fmtInr(totalInr)}</span>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: '#9B1C1C' }}>{err}</div>}

        {canEdit && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <input value={num} onChange={e => setNum(e.target.value)} placeholder="PO Number" style={INP} />
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INP} />
            <input type="number" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder="Value ₹" style={INP} />
            <button type="button" onClick={add} disabled={busy}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {busy ? '…' : 'Add'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '9px 14px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 };
const MUTED: CSSProperties = { fontSize: 12, color: 'var(--fg-3)', padding: '4px 0' };
const INP: CSSProperties = {
  width: '100%', padding: '7px 9px', border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit',
};
