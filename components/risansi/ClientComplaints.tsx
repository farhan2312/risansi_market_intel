'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ComplaintDetail, type ComplaintRow, type Me } from './ComplaintDetail';
import { ComplaintFormModal, type UserOpt } from './ComplaintFormModal';

const STATUS_COLOR: Record<string, string> = {
  Open: 'var(--neg)', 'In Progress': 'var(--accent)', 'Awaiting Client': 'var(--warn)',
  Resolved: '#0E9F6E', Closed: 'var(--fg-3)',
};

// Complaints panel for the Client 360 page: list + raise + detail drawer.
export function ClientComplaints({ complaints, users, me, clientId, clientName }: {
  complaints: ComplaintRow[]; users: UserOpt[]; me: Me; clientId: number; clientName: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ComplaintRow | null>(null);
  const open = complaints.filter(c => c.status !== 'Closed' && c.status !== 'Resolved').length;

  return (
    <div data-tabgroup="activity" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>Complaints</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {complaints.length} total{open ? ` · ${open} open` : ''}
        </span>
        <button type="button" onClick={() => setCreating(true)} style={{ ...RAISE_BTN, marginLeft: 'auto' }}>⚠ Raise</button>
      </div>
      {complaints.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>No complaints for this client.</div>
      ) : (
        <div>
          {complaints.map((c, i) => (
            <button key={c.id} type="button" onClick={() => setSelected(c)}
              style={{ ...ROW, borderBottom: i < complaints.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)', flexShrink: 0 }}>{c.complaint_no}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{c.details}</span>
              <span style={{ ...PILL, background: STATUS_COLOR[c.status] ?? 'var(--fg-3)' }}>{c.status}</span>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <ComplaintFormModal fixedClient={{ id: clientId, name: clientName }} users={users}
          onClose={() => setCreating(false)} onSaved={() => { setCreating(false); router.refresh(); }} />
      )}
      {selected && <ComplaintDetail complaint={selected} users={users} me={me} onClose={() => setSelected(null)} />}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' };
const PILL: CSSProperties = { padding: '2px 7px', borderRadius: 10, fontSize: 9.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', flexShrink: 0 };
const RAISE_BTN: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--bg-paper)', color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
