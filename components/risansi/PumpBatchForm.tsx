'use client';

import { useState, type CSSProperties } from 'react';
import { saveClientPumpBatch } from '@/app/actions/risansi-pumps';

// Entering an order of pumps.
//
// The old form asked for all seven fields once — model, serial, EC, SO, liquid,
// capacity, head — so a rep taking delivery of six identical pumps filled it in
// six times, re-typing the same model, liquid, capacity and head on every round.
//
// Those four describe the ORDER. Serial, SO and EC describe the individual pump:
// in the 5,985 rows on file, serials are distinct on every pump of a batch, and
// SO numbers are shared in fewer than a third of them. So the form asks for the
// shared four, then a quantity, then three boxes per pump — pick 6 and you get
// 18 boxes.
//
// Used by both entry points (the visit report's RIL section and Client 360), for
// both new records and edits, so the four places behave identically.

export interface PumpRowValue {
  id: number | null;
  sr_no: string;
  so_no: string;
  ec_no: string;
}

export interface PumpBatchValue {
  batchId: string | null;
  model: string;
  liquid: string;
  capacity: string;
  head: string;
  pumps: PumpRowValue[];
}

export const blankPumpRow = (): PumpRowValue => ({ id: null, sr_no: '', so_no: '', ec_no: '' });

export const blankPumpBatch = (): PumpBatchValue => ({
  batchId: null, model: '', liquid: '', capacity: '', head: '', pumps: [blankPumpRow()],
});

const rowFilled = (r: PumpRowValue) => !!(r.sr_no.trim() || r.so_no.trim() || r.ec_no.trim());

export function PumpBatchForm({
  clientId, initial, compact = false, onSaved, onCancel, onDeleteRow,
}: {
  clientId: number;
  /** Existing batch to edit. A record made before batches is simply a batch of one. */
  initial?: PumpBatchValue;
  compact?: boolean;
  onSaved: () => void;
  onCancel: () => void;
  /** Remove a row that already exists in the database (the × on a saved pump). */
  onDeleteRow?: (id: number) => Promise<void>;
}) {
  const [v, setV]       = useState<PumpBatchValue>(() => initial ?? blankPumpBatch());
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [warn, setWarn] = useState('');

  const set = <K extends keyof PumpBatchValue>(k: K, val: PumpBatchValue[K]) =>
    setV(p => ({ ...p, [k]: val }));
  const setRow = (i: number, k: keyof PumpRowValue, val: string) =>
    setV(p => ({ ...p, pumps: p.pumps.map((r, j) => (j === i ? { ...r, [k]: val } : r)) }));

  /**
   * Quantity drives how many pump rows show. Growing just appends blanks.
   * Shrinking only ever drops rows the user hasn't touched — a filled row is
   * something they typed, and silently discarding it is exactly the kind of
   * data loss this form exists to stop. Anything filled stays put, with a
   * warning saying so; the × on the row is the deliberate way to remove it.
   */
  const setQuantity = (raw: string) => {
    const n = Math.max(1, Math.min(200, parseInt(raw.replace(/[^0-9]/g, ''), 10) || 1));
    setV(p => {
      if (n >= p.pumps.length) {
        return { ...p, pumps: [...p.pumps, ...Array.from({ length: n - p.pumps.length }, blankPumpRow)] };
      }
      const keep: PumpRowValue[] = [];
      let dropped = 0;
      p.pumps.forEach((r, i) => {
        if (i < n || rowFilled(r) || r.id != null) keep.push(r);
        else dropped++;
      });
      const heldBack = keep.length - n;
      setWarn(heldBack > 0
        ? `${heldBack} pump${heldBack === 1 ? '' : 's'} below ${n} already ${heldBack === 1 ? 'has' : 'have'} details entered, so ${heldBack === 1 ? 'it was' : 'they were'} kept. Use the × on a row to remove one.`
        : dropped > 0 ? '' : '');
      return { ...p, pumps: keep };
    });
  };

  const removeRow = async (i: number) => {
    const row = v.pumps[i];
    if (row.id != null) {
      if (!onDeleteRow) return;
      if (!window.confirm('Delete this pump record? This removes it from the client’s installed base.')) return;
      setBusy(true); setErr('');
      try { await onDeleteRow(row.id); } catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed'); setBusy(false); return; }
      setBusy(false);
    }
    setWarn('');
    setV(p => ({ ...p, pumps: p.pumps.length > 1 ? p.pumps.filter((_, j) => j !== i) : [blankPumpRow()] }));
  };

  const save = async () => {
    if (!v.model.trim() && !v.pumps.some(r => r.sr_no.trim())) {
      setErr('Enter at least a model or one serial number.'); return;
    }
    setBusy(true); setErr('');
    try {
      await saveClientPumpBatch({
        clientId, batchId: v.batchId, model: v.model, liquid: v.liquid,
        capacity: v.capacity, head: v.head,
        pumps: v.pumps.map(r => ({ id: r.id, sr_no: r.sr_no, so_no: r.so_no, ec_no: r.ec_no })),
      });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  const qty     = v.pumps.length;
  const filled  = v.pumps.filter(rowFilled).length;

  return (
    <div style={EDIT_CARD}>
      {/* Shared across every pump in this order */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>
        The pump
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : '2fr 1fr 1fr 1fr', gap: 8 }}>
        <Field label="Model (as per plate)" value={v.model}    onChange={x => set('model', x)} />
        <Field label="Liquid"               value={v.liquid}   onChange={x => set('liquid', x)} />
        <Field label="Capacity"             value={v.capacity} onChange={x => set('capacity', x)} />
        <Field label="Head"                 value={v.head}     onChange={x => set('head', x)} />
      </div>

      {/* Quantity */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'block', width: 110 }}>
          <span style={LBL}>Quantity</span>
          <input
            type="text" inputMode="numeric" value={String(qty)}
            onChange={e => setQuantity(e.target.value)}
            aria-label="Number of pumps" style={INP}
          />
        </label>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', paddingBottom: 8 }}>
          {qty} pump{qty === 1 ? '' : 's'} · {filled} with details entered
        </div>
      </div>

      {warn && <div style={WARN}>{warn}</div>}

      {/* Per-pump identity: three boxes each */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '13px 0 7px' }}>
        Each pump
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 320, overflowY: 'auto' }}>
        {v.pumps.map((r, i) => (
          <div key={r.id ?? `new-${i}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
            <span style={{
              width: 22, flexShrink: 0, fontSize: 11, color: 'var(--fg-3)',
              fontFamily: 'var(--font-mono)', paddingBottom: 8, textAlign: 'right',
            }}>{i + 1}</span>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
              <Field label={i === 0 ? 'Serial (SR No)' : ''} value={r.sr_no} onChange={x => setRow(i, 'sr_no', x)} />
              <Field label={i === 0 ? 'SO No' : ''}          value={r.so_no} onChange={x => setRow(i, 'so_no', x)} />
              <Field label={i === 0 ? 'EC No' : ''}          value={r.ec_no} onChange={x => setRow(i, 'ec_no', x)} />
            </div>
            <button
              type="button" onClick={() => removeRow(i)} disabled={busy}
              title={r.id != null ? 'Delete this pump record' : 'Remove this row'}
              aria-label={`Remove pump ${i + 1}`}
              style={XBTN}
            >×</button>
          </div>
        ))}
      </div>

      {err && <div style={ERR}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} disabled={busy} style={BTN_GHOST}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={BTN_PRIMARY}>
          {busy ? 'Saving…' : v.batchId ? `Update ${qty} pump${qty === 1 ? '' : 's'}` : `Add ${qty} pump${qty === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      {label && <span style={LBL}>{label}</span>}
      <input value={value} onChange={e => onChange(e.target.value)} style={INP} />
    </label>
  );
}

const LBL: CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' };
const INP: CSSProperties = { width: '100%', marginTop: 3, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const EDIT_CARD: CSSProperties = { border: '1px solid var(--accent-line, #BBD)', background: 'var(--bg-elev)', borderRadius: 8, padding: 12, marginBottom: 10 };
const XBTN: CSSProperties = { flexShrink: 0, width: 26, height: 32, marginBottom: 1, fontSize: 16, lineHeight: 1, background: 'none', border: '1px solid var(--line-strong)', color: 'var(--neg, #DC2626)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_PRIMARY: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_GHOST: CSSProperties = { padding: '7px 13px', fontSize: 12, fontWeight: 500, background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const ERR: CSSProperties = { padding: '7px 11px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 12, color: '#9B1C1C', marginTop: 10 };
const WARN: CSSProperties = { padding: '7px 11px', background: 'var(--warn-soft, #FEF3C7)', border: '1px solid var(--warn, #F59E0B)', borderRadius: 6, fontSize: 11.5, color: 'var(--warn-strong, #92400E)', marginTop: 9 };
