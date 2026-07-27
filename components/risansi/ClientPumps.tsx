'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveClientPump, deleteClientPump } from '@/app/actions/risansi-pumps';

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

// Add/edit draft — the exact fields the visit-form pump editor captures, so a
// pump can be recorded straight from Client 360 without opening a visit.
type Draft = { id: number | null; model: string; sr_no: string; ec_no: string; so_no: string; liquid: string; capacity: string; head: string };
const blankDraft = (): Draft => ({ id: null, model: '', sr_no: '', ec_no: '', so_no: '', liquid: '', capacity: '', head: '' });
const toDraft = (p: PumpRow): Draft => ({
  id: p.id, model: p.pump_model_plate ?? '', sr_no: p.pump_sl_no ?? '', ec_no: p.ec_number ?? '',
  so_no: p.so_number ?? '', liquid: p.liquid ?? '', capacity: p.capacity ?? '', head: p.head ?? '',
});

// RIL pump detail for one client + the installed-base discrepancy. Editable in
// place — the "+ Add Pump" button and per-row Edit/Delete write straight to
// client_pumps via the same actions the visit report uses.
export function ClientPumps({ pumps, installedRil, clientName, clientId }: {
  pumps: PumpRow[]; installedRil: number; clientName: string; clientId: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
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

  const save = async () => {
    if (!draft) return;
    if (!draft.model.trim() && !draft.sr_no.trim()) { setErr('Enter at least a model or serial number.'); return; }
    // Warn before adding a second serial-less pump of the same model (a plant
    // may genuinely have two identical pumps, so confirm rather than block).
    if (draft.id === null && !draft.sr_no.trim()) {
      const m = draft.model.trim().toLowerCase();
      const dup = pumps.some(p => !(p.pump_sl_no ?? '').trim() && (p.pump_model_plate ?? '').trim().toLowerCase() === m);
      if (dup && !window.confirm(`A "${draft.model.trim()}" with no serial number is already on record for this client. Add another anyway?`)) return;
    }
    setBusy(true); setErr('');
    try {
      await saveClientPump({
        id: draft.id, clientId,
        model: draft.model, sr_no: draft.sr_no, ec_no: draft.ec_no, so_no: draft.so_no,
        liquid: draft.liquid, capacity: draft.capacity, head: draft.head,
      });
      setDraft(null);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Delete this pump record?')) return;
    setBusy(true); setErr('');
    try { await deleteClientPump(id, clientId); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  };

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
        {draft === null && (
          <button type="button" onClick={() => { setErr(''); setDraft(blankDraft()); }} style={BTN_ADD}>+ Add Pump</button>
        )}
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

      {err && <div style={ERR}>{err}</div>}

      {/* Add / edit form — same fields as the visit report's pump editor. */}
      {draft !== null && (
        <div style={EDIT_CARD}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            {draft.id ? 'Edit pump' : 'Add pump'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            <PumpField label="Model (as per plate)" value={draft.model} onChange={v => setDraft({ ...draft, model: v })} />
            <PumpField label="Serial (SR No)" value={draft.sr_no} onChange={v => setDraft({ ...draft, sr_no: v })} />
            <PumpField label="EC No" value={draft.ec_no} onChange={v => setDraft({ ...draft, ec_no: v })} />
            <PumpField label="SO No" value={draft.so_no} onChange={v => setDraft({ ...draft, so_no: v })} />
            <PumpField label="Liquid" value={draft.liquid} onChange={v => setDraft({ ...draft, liquid: v })} />
            <PumpField label="Capacity" value={draft.capacity} onChange={v => setDraft({ ...draft, capacity: v })} />
            <PumpField label="Head" value={draft.head} onChange={v => setDraft({ ...draft, head: v })} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setDraft(null); setErr(''); }} disabled={busy} style={BTN_GHOST}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={BTN_PRIMARY}>
              {busy ? 'Saving…' : draft.id ? 'Update Pump' : 'Add Pump'}
            </button>
          </div>
        </div>
      )}

      {pumps.length === 0 ? (
        draft === null && (
          <div style={{ padding: '22px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
            No pump records for this client.
          </div>
        )
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
                {/* Tier 1 — model · qty · row actions */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
                    {p.pump_model_plate ?? '—'}
                  </span>
                  {p.quantity > 1 && <span style={QTY}>×{p.quantity}</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => { setErr(''); setDraft(toDraft(p)); }} disabled={busy} style={MINI}>Edit</button>
                    <button type="button" onClick={() => remove(p.id)} disabled={busy} style={{ ...MINI, color: '#DC2626', borderColor: 'rgba(220,38,38,0.4)' }}>Delete</button>
                  </div>
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

function PumpField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} style={INP} />
    </label>
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
const KV_GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: '8px 14px' };
const INP: CSSProperties = { width: '100%', marginTop: 3, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const EDIT_CARD: CSSProperties = { border: '1px solid var(--accent-line, #BBD)', background: 'var(--bg-elev)', borderRadius: 8, padding: 12, margin: '12px 14px 0' };
const MINI: CSSProperties = { padding: '4px 9px', fontSize: 11, fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_ADD: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--accent-soft, #EBF1FB)', color: '#0A3D8F', border: '1px solid var(--accent-line, #BBD)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const BTN_PRIMARY: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_GHOST: CSSProperties = { padding: '7px 13px', fontSize: 12, fontWeight: 500, background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const ERR: CSSProperties = { padding: '7px 11px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 12, color: '#9B1C1C', margin: '10px 14px 0' };
