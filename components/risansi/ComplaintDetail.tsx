'use client';

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  setComplaintStatus, reassignComplaint, addComplaintUpdate, updateComplaint, deleteComplaint,
} from '@/app/actions/risansi-complaints';
import type { UserOpt } from './ComplaintFormModal';

export interface ComplaintRow {
  id: number; complaint_no: string; legacy_ref: string | null;
  client_id: number | null; client_code: string | null; client_name: string | null;
  channel: string | null; complaint_date: string | null; details: string;
  part_name: string | null; quantity: number | null; pump_model: string | null;
  invoice_no: string | null; invoice_date: string | null; client_po_no: string | null; client_po_date: string | null;
  priority: string; status: string; due_date: string | null;
  assigned_to_user: number | null; assigned_name: string | null; assigned_to_external: string | null;
  reported_by_raw: string | null; reported_name: string | null;
  root_cause: string | null; resolution: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface Me { id: number | null; email: string | null; role: string }

const STATUSES = ['Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed'];
const STATUS_COLOR: Record<string, string> = {
  Open: 'var(--neg)', 'In Progress': 'var(--accent)', 'Awaiting Client': 'var(--warn)',
  Resolved: '#0E9F6E', Closed: 'var(--fg-3)',
};
const PRIORITY_COLOR: Record<string, string> = { High: 'var(--neg)', Medium: 'var(--warn)', Low: 'var(--pos)' };
const MAX_DIM = 1600, JPEG_Q = 0.82;

interface LogUpdate { id: number; body: string; entry_date: string | null; created_by: string | null; created_at: string }
interface PhotoMeta { id: number; mime_type: string; byte_size: number; caption: string; uploaded_by: string | null; uploaded_at: string }

export function ComplaintDetail({ complaint, users, me, onClose }: {
  complaint: ComplaintRow; users: UserOpt[]; me: Me; onClose: () => void;
}) {
  const router = useRouter();
  const c = complaint;
  const isAdmin = me.role === 'admin' || me.role === 'sysadmin';

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [updates, setUpdates] = useState<LogUpdate[]>([]);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [newUpdate, setNewUpdate] = useState('');
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    fetch(`/api/risansi/complaints/${c.id}/log`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { updates: [], photos: [] })
      .then(d => { setUpdates(d.updates ?? []); setPhotos(d.photos ?? []); })
      .catch(() => {});
  }, [c.id]);
  useEffect(reload, [reload]);

  function run(fn: () => Promise<void>, after?: () => void) {
    setErr(''); setBusy(true);
    fn().then(() => { router.refresh(); reload(); after?.(); })
      .catch(e => setErr(e instanceof Error ? e.message : 'Action failed'))
      .finally(() => setBusy(false));
  }

  function form(extra: Record<string, string>): FormData {
    const f = new FormData(); f.set('id', String(c.id));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  // ── Photo upload (client-side downscale, same as visit photos) ──
  const upload = useCallback(async (file: File) => {
    setErr(''); setBusy(true);
    try {
      let blob: Blob = file;
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
        cv.getContext('2d')?.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
        blob = (await new Promise<Blob | null>(r => cv.toBlob(r, 'image/jpeg', JPEG_Q))) ?? file;
      } catch { /* send original */ }
      const fd = new FormData(); fd.append('photo', blob, 'photo.jpg');
      const res = await fetch(`/api/risansi/complaints/${c.id}/photos`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); }
  }, [c.id, reload]);

  return (
    <>
      <div onClick={onClose} style={BACKDROP} />
      <div style={DRAWER} className="risansi-complaint-drawer">
        {/* Header */}
        <div style={DRAWER_H}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>{c.complaint_no}</span>
              <span style={{ ...BADGE, background: STATUS_COLOR[c.status] ?? 'var(--fg-3)' }}>{c.status}</span>
              <span style={{ ...BADGE, background: PRIORITY_COLOR[c.priority] ?? 'var(--warn)' }}>{c.priority}</span>
            </div>
            {c.client_name && (
              <a href={c.client_id ? `/risansi/clients/${c.client_id}` : undefined}
                style={{ fontSize: 12, color: 'var(--brand-blue)', textDecoration: 'none' }}>{c.client_name}</a>
            )}
          </div>
          <button type="button" onClick={onClose} style={CLOSE_BTN}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {err && <div style={ERR}>{err}</div>}

          {/* Status pipeline */}
          <div>
            <div style={SECTION}>Status</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STATUSES.map(s => {
                const active = s === c.status;
                const closedLocked = s === 'Closed' && !isAdmin;
                // Closed is terminal for non-admins — they can't move it elsewhere.
                const reopenLocked = c.status === 'Closed' && s !== 'Closed' && !isAdmin;
                const locked = closedLocked || reopenLocked;
                return (
                  <button key={s} type="button" disabled={busy || active || locked}
                    title={reopenLocked ? 'Only an admin can re-open a closed complaint' : closedLocked ? 'Only an admin can close' : undefined}
                    onClick={() => run(() => setComplaintStatus(form({ status: s })))}
                    style={{
                      ...PILL,
                      background: active ? (STATUS_COLOR[s] ?? 'var(--fg-3)') : 'var(--bg-paper)',
                      color: active ? '#fff' : locked ? 'var(--fg-3)' : 'var(--fg-2)',
                      borderColor: active ? 'transparent' : 'var(--line-strong)',
                      opacity: locked ? 0.5 : 1, cursor: active || locked ? 'default' : 'pointer',
                    }}>{s}</button>
                );
              })}
            </div>
          </div>

          {/* Assignee + reassign */}
          <div>
            <div style={SECTION}>Responsible</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>
                {c.assigned_name || c.assigned_to_external || 'Unassigned'}
              </span>
              <button type="button" onClick={() => setReassigning(r => !r)} style={MINI_BTN}>Reassign</button>
            </div>
            {reassigning && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <select id={`reassign-${c.id}`} defaultValue="" style={{ ...INP, maxWidth: 240 }}>
                  <option value="">— Select person —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                </select>
                <button type="button" disabled={busy} style={PRIMARY_BTN}
                  onClick={() => {
                    const v = (document.getElementById(`reassign-${c.id}`) as HTMLSelectElement)?.value;
                    if (!v) { setErr('Pick a person'); return; }
                    run(() => reassignComplaint(form({ assigned_to_user: v })), () => setReassigning(false));
                  }}>Apply</button>
              </div>
            )}
          </div>

          {/* Core fields / edit */}
          {!editing ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={SECTION}>Complaint</div>
                {(isAdmin || c.status !== 'Closed') && (
                  <button type="button" onClick={() => setEditing(true)} style={MINI_BTN}>Edit</button>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.details}</div>
              <dl style={GRID}>
                <Meta k="Channel" v={c.channel} />
                <Meta k="Date" v={fmtDate(c.complaint_date)} />
                <Meta k="Part" v={c.part_name} />
                <Meta k="Quantity" v={c.quantity != null ? String(c.quantity) : null} />
                <Meta k="Pump Model" v={c.pump_model} />
                <Meta k="Target Date" v={fmtDate(c.due_date)} />
                <Meta k="Invoice / Challan" v={joinDt(c.invoice_no, c.invoice_date)} />
                <Meta k="Client PO" v={joinDt(c.client_po_no, c.client_po_date)} />
                <Meta k="Reported by" v={c.reported_name || c.reported_by_raw} />
              </dl>
              {(c.root_cause || c.resolution) && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {c.root_cause && <Block label="Root cause" body={c.root_cause} />}
                  {c.resolution && <Block label="Resolution" body={c.resolution} />}
                </div>
              )}
            </div>
          ) : (
            <EditForm c={c} busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(fd) => run(() => updateComplaint(fd), () => setEditing(false))} />
          )}

          {/* Photos */}
          <div>
            <div style={SECTION}>Photos ({photos.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {photos.map(p => (
                <div key={p.id} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/risansi/complaint-photo/${p.id}`} alt={p.caption || 'Complaint photo'}
                    style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                  <button type="button" title="Delete" disabled={busy}
                    onClick={() => run(async () => { await fetch(`/api/risansi/complaint-photo/${p.id}`, { method: 'DELETE' }); })}
                    style={PHOTO_DEL}>✕</button>
                </div>
              ))}
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={PHOTO_ADD}>+ Photo</button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            </div>
          </div>

          {/* Updates timeline */}
          <div>
            <div style={SECTION}>Updates ({updates.length})</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input value={newUpdate} onChange={e => setNewUpdate(e.target.value)} placeholder="Add an update…" style={INP} />
              <button type="button" disabled={busy || !newUpdate.trim()} style={PRIMARY_BTN}
                onClick={() => run(() => addComplaintUpdate(form({ body: newUpdate })), () => setNewUpdate(''))}>Post</button>
            </div>
            {updates.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic' }}>No updates yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {updates.map(u => (
                  <div key={u.id} style={{ borderLeft: '2px solid var(--line-strong)', paddingLeft: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{u.body}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                      {fmtDate(u.entry_date) || fmtDate(u.created_at)}{u.created_by && u.created_by !== 'import' ? ` · ${u.created_by}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <button type="button" disabled={busy} style={{ ...MINI_BTN, color: 'var(--neg)', borderColor: 'rgba(220,38,38,0.4)' }}
                onClick={() => { if (window.confirm(`Delete complaint ${c.complaint_no}? This cannot be undone.`)) run(() => deleteComplaint(form({})), onClose); }}>
                Delete complaint
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function EditForm({ c, busy, onCancel, onSave }: { c: ComplaintRow; busy: boolean; onCancel: () => void; onSave: (fd: FormData) => void }) {
  return (
    <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set('id', String(c.id)); onSave(fd); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={SECTION}>Edit complaint</div>
      <textarea name="details" defaultValue={c.details} rows={3} style={{ ...INP, resize: 'vertical' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <select name="priority" defaultValue={c.priority} style={INP}>{['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}</select>
        <select name="channel" defaultValue={c.channel ?? 'Verbal'} style={INP}>{['Verbal', 'Email', 'Mail'].map(p => <option key={p}>{p}</option>)}</select>
        <input name="complaint_date" type="date" defaultValue={c.complaint_date ?? ''} style={INP} />
        <input name="due_date" type="date" defaultValue={c.due_date ?? ''} style={INP} />
        <input name="part_name" defaultValue={c.part_name ?? ''} placeholder="Part name" style={INP} />
        <input name="quantity" type="number" defaultValue={c.quantity ?? ''} placeholder="Quantity" style={INP} />
        <input name="pump_model" defaultValue={c.pump_model ?? ''} placeholder="Pump model" style={INP} />
        <input name="invoice_no" defaultValue={c.invoice_no ?? ''} placeholder="Invoice no." style={INP} />
        <input name="invoice_date" type="date" defaultValue={c.invoice_date ?? ''} style={INP} />
        <input name="client_po_no" defaultValue={c.client_po_no ?? ''} placeholder="Client PO no." style={INP} />
        <input name="client_po_date" type="date" defaultValue={c.client_po_date ?? ''} style={INP} />
      </div>
      <textarea name="root_cause" defaultValue={c.root_cause ?? ''} rows={2} placeholder="Root cause" style={{ ...INP, resize: 'vertical' }} />
      <textarea name="resolution" defaultValue={c.resolution ?? ''} rows={2} placeholder="Resolution" style={{ ...INP, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={GHOST_BTN}>Cancel</button>
        <button type="submit" disabled={busy} style={PRIMARY_BTN}>Save changes</button>
      </div>
    </form>
  );
}

function Meta({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (<><dt style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</dt><dd style={{ margin: 0, fontSize: 12.5, color: 'var(--fg)' }}>{v}</dd></>);
}
function Block({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{body}</div>
    </div>
  );
}
function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function joinDt(no: string | null, dt: string | null): string | null {
  if (!no && !dt) return null;
  return [no, fmtDate(dt)].filter(Boolean).join(' · ');
}

const BACKDROP: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 };
const DRAWER: CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)', zIndex: 301, background: 'var(--bg-paper)', boxShadow: '-8px 0 40px rgba(10,22,40,0.18)', display: 'flex', flexDirection: 'column' };
const DRAWER_H: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 };
const CLOSE_BTN: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--fg-3)', borderRadius: 4, flexShrink: 0 };
const SECTION: CSSProperties = { fontSize: 10, fontWeight: 700, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 };
const BADGE: CSSProperties = { padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, color: '#fff' };
const PILL: CSSProperties = { padding: '5px 11px', fontSize: 11.5, fontWeight: 600, borderRadius: 999, border: '1px solid', fontFamily: 'inherit' };
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 14, rowGap: 5, margin: '10px 0 0', alignItems: 'baseline' };
const INP: CSSProperties = { width: '100%', padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const MINI_BTN: CSSProperties = { padding: '3px 9px', fontSize: 11, fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 13px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
const GHOST_BTN: CSSProperties = { padding: '7px 13px', fontSize: 12, fontWeight: 500, background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const ERR: CSSProperties = { padding: '8px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 6, fontSize: 12, color: '#9B1C1C' };
const PHOTO_DEL: CSSProperties = { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--neg)', color: '#fff', border: '2px solid var(--bg-paper)', fontSize: 10, cursor: 'pointer', display: 'grid', placeItems: 'center' };
const PHOTO_ADD: CSSProperties = { width: 76, height: 76, borderRadius: 6, border: '1px dashed var(--line-strong)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
