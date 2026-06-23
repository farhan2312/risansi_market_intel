'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { ComplaintFormModal, type ClientOpt, type UserOpt } from './ComplaintFormModal';
import { ComplaintDetail, type ComplaintRow, type Me } from './ComplaintDetail';

const STATUS_COLOR: Record<string, string> = {
  Open: 'var(--neg)', 'In Progress': 'var(--accent)', 'Awaiting Client': 'var(--warn)',
  Resolved: '#0E9F6E', Closed: 'var(--fg-3)',
};
const PRIORITY_COLOR: Record<string, string> = { High: 'var(--neg)', Medium: 'var(--warn)', Low: 'var(--pos)' };
const OPEN_SET = new Set(['Open', 'In Progress', 'Awaiting Client']);

export function ComplaintsClient({ complaints, users, clients, me, canCreate }: {
  complaints: ComplaintRow[]; users: UserOpt[]; clients: ClientOpt[]; me: Me; canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ComplaintRow | null>(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('open'); // open | all | <status>
  const [priorityF, setPriorityF] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const kpi = useMemo(() => ({
    open: complaints.filter(c => OPEN_SET.has(c.status)).length,
    resolved: complaints.filter(c => c.status === 'Resolved').length,
    closed: complaints.filter(c => c.status === 'Closed').length,
    overdue: complaints.filter(c => OPEN_SET.has(c.status) && c.due_date && new Date(c.due_date) < new Date()).length,
  }), [complaints]);

  const visible = useMemo(() => complaints.filter(c => {
    if (statusF === 'open' && !OPEN_SET.has(c.status)) return false;
    if (statusF !== 'open' && statusF !== 'all' && c.status !== statusF) return false;
    if (priorityF && c.priority !== priorityF) return false;
    if (mineOnly && !(c.assigned_to_user === me.id || (me.email && c.created_by?.toLowerCase() === me.email.toLowerCase()))) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      return c.complaint_no.toLowerCase().includes(s) || (c.client_name ?? '').toLowerCase().includes(s)
        || c.details.toLowerCase().includes(s) || (c.pump_model ?? '').toLowerCase().includes(s);
    }
    return true;
  }), [complaints, statusF, priorityF, mineOnly, q, me]);

  return (
    <>
      <div style={KPI_ROW}>
        <Kpi label="Open" value={kpi.open} color={kpi.open ? 'var(--neg)' : 'var(--pos)'} />
        <Kpi label="Overdue" value={kpi.overdue} color={kpi.overdue ? 'var(--neg)' : undefined} />
        <Kpi label="Resolved" value={kpi.resolved} />
        <Kpi label="Closed" value={kpi.closed} />
      </div>

      <div style={BAR}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search no, client, model…" style={{ ...INP, flex: '1 1 200px' }} />
        <select value={statusF} onChange={e => setStatusF(e.target.value)} style={INP}>
          <option value="open">Open (active)</option>
          <option value="all">All statuses</option>
          {['Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priorityF} onChange={e => setPriorityF(e.target.value)} style={INP}>
          <option value="">Any priority</option>
          {['High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} style={{ accentColor: '#0A3D8F' }} /> Mine
        </label>
        {canCreate && (
          <button type="button" onClick={() => setCreating(true)} style={PRIMARY_BTN}>+ New Complaint</button>
        )}
      </div>

      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                {['No.', 'Client', 'Complaint', 'Pump / Part', 'Priority', 'Status', 'Responsible', 'Date'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>No complaints match.</td></tr>
              ) : visible.map((c, i) => {
                const overdue = OPEN_SET.has(c.status) && c.due_date && new Date(c.due_date) < new Date();
                return (
                  <tr key={c.id} onClick={() => setSelected(c)}
                    style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--line)' : 'none', cursor: 'pointer' }}>
                    <td data-label="No." style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{c.complaint_no}</td>
                    <td data-label="Client" style={{ ...TD, fontWeight: 500, color: 'var(--fg)' }}>{c.client_name ?? '—'}</td>
                    <td data-label="Complaint" style={{ ...TD, color: 'var(--fg-2)', maxWidth: 280 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.details}</span>
                    </td>
                    <td data-label="Pump / Part" style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>
                      {[c.pump_model, c.part_name].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td data-label="Priority" style={TD}><Dot color={PRIORITY_COLOR[c.priority]} label={c.priority} /></td>
                    <td data-label="Status" style={TD}>
                      <span style={{ ...PILL, background: STATUS_COLOR[c.status] ?? 'var(--fg-3)' }}>{c.status}</span>
                    </td>
                    <td data-label="Responsible" style={{ ...TD, fontSize: 11, color: 'var(--fg-2)' }}>{c.assigned_name || c.assigned_to_external || '—'}</td>
                    <td data-label="Date" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap', color: overdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: overdue ? 600 : 400 }}>
                      {overdue ? '⚠ ' : ''}{fmtDate(c.due_date) || fmtDate(c.complaint_date) || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <ComplaintFormModal clients={clients} users={users}
          onClose={() => setCreating(false)} onSaved={() => { setCreating(false); window.location.reload(); }} />
      )}
      {selected && (
        <ComplaintDetail complaint={selected} users={users} me={me} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={KPI_CARD}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: color ?? 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Dot({ color, label }: { color: string; label: string }) {
  return (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-2)' }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{label}</span>);
}
function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const KPI_ROW: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 };
const KPI_CARD: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px' };
const BAR: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 };
const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const INP: CSSProperties = { padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
const PILL: CSSProperties = { padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' };
const PRIMARY_BTN: CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
