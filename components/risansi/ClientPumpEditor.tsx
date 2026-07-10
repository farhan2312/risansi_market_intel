'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { saveClientPump, deleteClientPump } from '@/app/actions/risansi-pumps';

interface Pump {
  id: number;
  pump_model_plate: string | null;
  pump_sl_no: string | null;
  ec_number: string | null;
  so_number: string | null;
  liquid: string | null;
  capacity: string | null;
  head: string | null;
}

type Draft = {
  id: number | null;
  model: string; sr_no: string; ec_no: string; so_no: string;
  liquid: string; capacity: string; head: string;
};

const blank = (): Draft => ({ id: null, model: '', sr_no: '', ec_no: '', so_no: '', liquid: '', capacity: '', head: '' });
const toDraft = (p: Pump): Draft => ({
  id: p.id, model: p.pump_model_plate ?? '', sr_no: p.pump_sl_no ?? '', ec_no: p.ec_number ?? '',
  so_no: p.so_number ?? '', liquid: p.liquid ?? '', capacity: p.capacity ?? '', head: p.head ?? '',
});

// Editable list of a client's installed pumps. Writes straight to client_pumps,
// so edits show up immediately in Client 360. Used in the visit report's RIL section.
export function ClientPumpEditor({ clientId, compact = false, onCount }: { clientId: number | string; compact?: boolean; onCount?: (n: number) => void }) {
  const cid = Number(clientId);
  const [pumps, setPumps]   = useState<Pump[]>([]);
  const [loading, setLoad]  = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft]   = useState<Draft | null>(null);   // open editor (add or edit)
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  // Re-fetch on mount and whenever load() bumps reloadKey. All setState happens
  // inside async callbacks (not synchronously in the effect body).
  const load = useCallback(() => setReloadKey(k => k + 1), []);
  useEffect(() => {
    let active = true;
    fetch(`/api/risansi/client-pumps?clientId=${cid}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { pumps: [] })
      .then(d => { if (active) { const list: Pump[] = d.pumps ?? []; setPumps(list); onCount?.(list.length); } })
      .catch(() => { if (active) { setPumps([]); onCount?.(0); } })
      .finally(() => { if (active) setLoad(false); });
    return () => { active = false; };
  }, [cid, reloadKey, onCount]);

  const save = async () => {
    if (!draft) return;
    if (!draft.model.trim() && !draft.sr_no.trim()) { setErr('Enter at least a model or serial number.'); return; }
    // Duplicate guard: serialed pumps upsert on (client_id, serial), but a
    // blank-serial pump bypasses that index, so identical models can pile up.
    // Warn before adding a second serial-less match (a plant may genuinely have
    // two identical pumps, so allow it on confirm rather than hard-blocking).
    if (draft.id === null && !draft.sr_no.trim()) {
      const m = draft.model.trim().toLowerCase();
      const dup = pumps.some(p => !(p.pump_sl_no ?? '').trim() && (p.pump_model_plate ?? '').trim().toLowerCase() === m);
      if (dup && !window.confirm(`A "${draft.model.trim()}" with no serial number is already on record for this client. Add another anyway?`)) return;
    }
    setBusy(true); setErr('');
    try {
      await saveClientPump({
        id: draft.id, clientId: cid,
        model: draft.model, sr_no: draft.sr_no, ec_no: draft.ec_no, so_no: draft.so_no,
        liquid: draft.liquid, capacity: draft.capacity, head: draft.head,
      });
      setDraft(null);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Delete this pump record?')) return;
    setBusy(true); setErr('');
    try { await deleteClientPump(id, cid); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  };

  const fs = compact ? 13 : 12;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
          RIL Pumps {loading ? '' : `(${pumps.length})`}
        </span>
        {draft === null && (
          <button type="button" onClick={() => setDraft(blank())} style={{ ...BTN_ADD, marginLeft: 'auto' }}>
            + Add Pump
          </button>
        )}
      </div>

      {err && <div style={ERR}>{err}</div>}

      {/* Add / edit form */}
      {draft !== null && (
        <div style={EDIT_CARD}>
          <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 8 }}>
            <Field label="Model (as per plate)" value={draft.model} onChange={v => setDraft({ ...draft, model: v })} />
            <Field label="Serial (SR No)" value={draft.sr_no} onChange={v => setDraft({ ...draft, sr_no: v })} />
            <Field label="EC No" value={draft.ec_no} onChange={v => setDraft({ ...draft, ec_no: v })} />
            <Field label="SO No" value={draft.so_no} onChange={v => setDraft({ ...draft, so_no: v })} />
            <Field label="Liquid" value={draft.liquid} onChange={v => setDraft({ ...draft, liquid: v })} />
            <Field label="Capacity" value={draft.capacity} onChange={v => setDraft({ ...draft, capacity: v })} />
            <Field label="Head" value={draft.head} onChange={v => setDraft({ ...draft, head: v })} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setDraft(null); setErr(''); }} disabled={busy} style={BTN_GHOST}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={BTN_PRIMARY}>
              {busy ? 'Saving…' : draft.id ? 'Update Pump' : 'Add Pump'}
            </button>
          </div>
        </div>
      )}

      {/* Existing pumps */}
      {loading ? (
        <div style={{ fontSize: fs, color: 'var(--fg-3)', padding: '10px 0' }}>Loading pumps…</div>
      ) : pumps.length === 0 ? (
        draft === null && <div style={{ fontSize: fs, color: 'var(--fg-3)', padding: '10px 0' }}>No pumps on record for this client yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: compact ? undefined : 360, overflowY: compact ? undefined : 'auto' }}>
          {pumps.map(p => (
            <div key={p.id} style={ROW}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: fs, fontWeight: 700, color: 'var(--fg)' }}>
                  {p.pump_model_plate || '— no model —'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {p.pump_sl_no && <span>SR {p.pump_sl_no}</span>}
                  {p.ec_number && <span>EC {p.ec_number}</span>}
                  {p.so_number && <span>SO {p.so_number}</span>}
                  {p.liquid && <span>{p.liquid}</span>}
                  {p.capacity && <span>{p.capacity}</span>}
                  {p.head && <span>{p.head}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={() => setDraft(toDraft(p))} disabled={busy} style={MINI}>Edit</button>
                <button type="button" onClick={() => remove(p.id)} disabled={busy} style={{ ...MINI, color: '#DC2626', borderColor: 'rgba(220,38,38,0.4)' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} style={INP} />
    </label>
  );
}

const INP: CSSProperties = { width: '100%', marginTop: 3, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const EDIT_CARD: CSSProperties = { border: '1px solid var(--accent-line, #BBD)', background: 'var(--bg-elev)', borderRadius: 8, padding: 12, marginBottom: 10 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-paper)' };
const MINI: CSSProperties = { padding: '4px 9px', fontSize: 11, fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_ADD: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--accent-soft, #EBF1FB)', color: '#0A3D8F', border: '1px solid var(--accent-line, #BBD)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_PRIMARY: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_GHOST: CSSProperties = { padding: '7px 13px', fontSize: 12, fontWeight: 500, background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const ERR: CSSProperties = { padding: '7px 11px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 12, color: '#9B1C1C', marginBottom: 10 };
