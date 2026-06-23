'use client';

import { useState, useMemo, useRef, useEffect, type CSSProperties } from 'react';
import { createComplaint } from '@/app/actions/risansi-complaints';

export interface ClientOpt { id: number; code: string; name: string }
export interface UserOpt { id: number; name: string; role: string }

const CHANNELS = ['Verbal', 'Email', 'Mail'];
const PRIORITIES = ['High', 'Medium', 'Low'];

// Reusable "raise a complaint" drawer. Either pass a fixed client (from a visit
// or the Client 360 page) or a client list for the rep to pick from.
export function ComplaintFormModal({ clients, fixedClient, users, onClose, onSaved }: {
  clients?: ClientOpt[];
  fixedClient?: { id: number; name: string } | null;
  users: UserOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const [clientId, setClientId] = useState<number | null>(fixedClient?.id ?? null);
  const [clientQuery, setClientQuery] = useState(fixedClient?.name ?? '');
  const [clientOpen, setClientOpen] = useState(false);
  const clientRef = useRef<HTMLDivElement>(null);

  const [assignMode, setAssignMode] = useState<'user' | 'external'>('user');

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (clientRef.current && !clientRef.current.contains(e.target as Node)) setClientOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const clientMatches = useMemo(() => {
    if (!clients) return [];
    const q = clientQuery.trim().toLowerCase();
    const list = q ? clients.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : clients;
    return list.slice(0, 30);
  }, [clients, clientQuery]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (clientId == null) { setError('Pick a client'); return; }
    const fd = new FormData(e.currentTarget);
    fd.set('client_id', String(clientId));
    if (assignMode === 'user') fd.delete('assigned_to_external'); else fd.delete('assigned_to_user');
    setPending(true);
    createComplaint(fd)
      .then(() => onSaved())
      .catch(err => { setError(err instanceof Error ? err.message : 'Failed to raise complaint'); setPending(false); });
  }

  return (
    <>
      <div onClick={onClose} style={BACKDROP} />
      <div style={DRAWER} className="risansi-complaint-drawer">
        <div style={DRAWER_H}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F' }}>Raise a Complaint</div>
          <button type="button" onClick={onClose} style={CLOSE_BTN}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Client */}
          <Field label="Client" req>
            {fixedClient ? (
              <div style={{ ...INP, background: 'var(--bg-elev)', color: 'var(--fg)' }}>{fixedClient.name}</div>
            ) : (
              <div ref={clientRef} style={{ position: 'relative' }}>
                <input
                  value={clientQuery}
                  onChange={e => { setClientQuery(e.target.value); setClientOpen(true); setClientId(null); }}
                  onFocus={() => setClientOpen(true)}
                  placeholder="Search your clients…" style={INP} autoComplete="off"
                />
                {clientOpen && clientMatches.length > 0 && (
                  <div style={DROPDOWN}>
                    {clientMatches.map(c => (
                      <button type="button" key={c.id} onClick={() => { setClientId(c.id); setClientQuery(c.name); setClientOpen(false); }}
                        style={{ ...DROPDOWN_ITEM, background: clientId === c.id ? 'var(--bg-elev)' : 'transparent' }}>
                        <span style={{ fontWeight: 500 }}>{c.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{c.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          <Row>
            <Field label="Channel">
              <select name="channel" defaultValue="Verbal" style={INP}>
                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Complaint Date">
              <input name="complaint_date" type="date" defaultValue={today} style={INP} />
            </Field>
          </Row>

          <Field label="Details" req>
            <textarea name="details" required rows={3} placeholder="What is the complaint?" style={{ ...INP, resize: 'vertical' }} />
          </Field>

          {/* Assignee */}
          <Field label="Escalate to (responsible person)" req>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <Toggle on={assignMode === 'user'} onClick={() => setAssignMode('user')}>Internal user</Toggle>
              <Toggle on={assignMode === 'external'} onClick={() => setAssignMode('external')}>External</Toggle>
            </div>
            {assignMode === 'user' ? (
              <select name="assigned_to_user" style={INP} defaultValue="">
                <option value="">— Select person —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
              </select>
            ) : (
              <input name="assigned_to_external" placeholder="Name of external handler" style={INP} />
            )}
          </Field>

          <Row>
            <Field label="Priority">
              <select name="priority" defaultValue="Medium" style={INP}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Target Date">
              <input name="due_date" type="date" style={INP} />
            </Field>
          </Row>

          <details style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>Part / pump / invoice details (optional)</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              <Row>
                <Field label="Part Name"><input name="part_name" style={INP} /></Field>
                <Field label="Quantity"><input name="quantity" type="number" min="0" style={INP} /></Field>
              </Row>
              <Field label="Pump Model"><input name="pump_model" style={INP} /></Field>
              <Row>
                <Field label="Invoice / Challan No."><input name="invoice_no" style={INP} /></Field>
                <Field label="Invoice Date"><input name="invoice_date" type="date" style={INP} /></Field>
              </Row>
              <Row>
                <Field label="Client PO No."><input name="client_po_no" style={INP} /></Field>
                <Field label="Client PO Date"><input name="client_po_date" type="date" style={INP} /></Field>
              </Row>
            </div>
          </details>

          {error && <div style={ERR}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
            <button type="button" onClick={onClose} style={GHOST_BTN}>Cancel</button>
            <button type="submit" disabled={pending} style={{ ...PRIMARY_BTN, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Raising…' : 'Raise Complaint'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>{label}{req && <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>}</label>
      {children}
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="risansi-complaint-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}
function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
      border: `1px solid ${on ? '#0A3D8F' : 'var(--line-strong)'}`,
      background: on ? '#EBF1FB' : 'var(--bg-paper)', color: on ? '#0A3D8F' : 'var(--fg-3)',
    }}>{children}</button>
  );
}

const BACKDROP: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 };
const DRAWER: CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(520px, 100vw)', zIndex: 301, background: 'var(--bg-paper)', boxShadow: '-8px 0 40px rgba(10,22,40,0.18)', display: 'flex', flexDirection: 'column' };
const DRAWER_H: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 };
const CLOSE_BTN: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--fg-3)', borderRadius: 4 };
const LBL: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
const INP: CSSProperties = { display: 'block', width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const DROPDOWN: CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: 4, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, boxShadow: '0 6px 24px rgba(10,22,40,0.16)' };
const DROPDOWN_ITEM: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--fg)', textAlign: 'left' };
const ERR: CSSProperties = { padding: '8px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 6, fontSize: 12, color: '#9B1C1C' };
const PRIMARY_BTN: CSSProperties = { padding: '9px 16px', fontSize: 13, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const GHOST_BTN: CSSProperties = { padding: '9px 16px', fontSize: 13, fontWeight: 500, background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
