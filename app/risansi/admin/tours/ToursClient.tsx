'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@/components/risansi';
import {
  assignUserToTour, removeUserFromTour,
} from '@/app/actions/sysadmin';
import { deleteTour } from '@/app/actions/risansi-reps';

interface TourMember { user_id: number; name: string; role: string; }

export interface TourMappingRow {
  id:           number;
  name:         string;
  zone:         string | null;
  client_count: number;
  members:      TourMember[];
}

export interface AssignableUser {
  id:    number;
  name:  string;
  email: string | null;
  zone:  string | null;
  role:  string;
}

// A client belonging to a tour, loaded on demand when a tour card is expanded.
interface TourClientRow {
  id:         number;
  code:       string;
  legal_name: string;
  industry:   string | null;
  zone:       string | null;
  status:     string;
}

export function ToursClient({ tours, users }: { tours: TourMappingRow[]; users: AssignableUser[] }) {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [status, setStatus] = useState('all'); // all | managed | nomanager | nousers

  const hasMgr = (t: TourMappingRow) => t.members.some(m => m.role === 'manager');
  const zones = [...new Set(tours.map(t => t.zone).filter(Boolean) as string[])].sort();

  const kpi = {
    total:     tours.length,
    managed:   tours.filter(hasMgr).length,
    noManager: tours.filter(t => !hasMgr(t)).length,
    noUsers:   tours.filter(t => t.members.length === 0).length,
    clients:   tours.reduce((s, t) => s + (t.client_count || 0), 0),
  };

  const visible = tours.filter(t => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (zone && t.zone !== zone) return false;
    if (status === 'managed'   && !hasMgr(t)) return false;
    if (status === 'nomanager' &&  hasMgr(t)) return false;
    if (status === 'nousers'   && t.members.length > 0) return false;
    return true;
  });

  return (
    <>
      {/* KPI cards */}
      <div style={KPI_ROW}>
        <Kpi label="Total Tours"        value={kpi.total} />
        <Kpi label="With a Manager"     value={kpi.managed} color="var(--pos)" />
        <Kpi label="Missing a Manager"  value={kpi.noManager} color={kpi.noManager ? 'var(--warn)' : undefined} />
        <Kpi label="No One Assigned"    value={kpi.noUsers} color={kpi.noUsers ? 'var(--neg)' : undefined} />
        <Kpi label="Clients on Tours"   value={kpi.clients} />
      </div>

      {/* Filter bar */}
      <div style={FILTER_BAR}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tour…" style={SEARCH_INP} />
        <select value={zone} onChange={e => setZone(e.target.value)} style={SEL}>
          <option value="">All zones</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={SEL}>
          <option value="all">All statuses</option>
          <option value="managed">Has manager</option>
          <option value="nomanager">No manager</option>
          <option value="nousers">No users at all</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-3)' }}>
          {visible.length} of {tours.length} tours
        </span>
      </div>

      {err && <div style={ERR_BOX}>{err}</div>}
      {tours.length === 0 ? (
        <div style={{ ...PANEL, padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
          No tours yet. Create tours from the Reps &amp; Tours page.
        </div>
      ) : visible.length === 0 ? (
        <div style={{ ...PANEL, padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
          No tours match the current filters.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map(t => (
            <TourCard key={t.id} tour={t} users={users} onError={setErr} onDone={() => router.refresh()} />
          ))}
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={KPI_CARD}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: color ?? 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}

function TourCard({ tour, users, onError, onDone }: {
  tour: TourMappingRow;
  users: AssignableUser[];
  onError: (m: string) => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [addUserId, setAddUserId] = useState('');

  // Clients on this tour, loaded lazily the first time the count is expanded
  // so the hub stays light when there are many tours.
  const [clientsOpen, setClientsOpen] = useState(false);
  const [clients, setClients] = useState<TourClientRow[] | null>(null);
  const [loadingClients, setLoadingClients] = useState(false);
  const [clientsErr, setClientsErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  function toggleClients() {
    const next = !clientsOpen;
    setClientsOpen(next);
    if (next && clients === null && !loadingClients) {
      setLoadingClients(true);
      setClientsErr('');
      fetch(`/api/risansi/tours/${tour.id}/clients`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load clients')))
        .then((rows: TourClientRow[]) => setClients(rows))
        .catch(e => setClientsErr(e instanceof Error ? e.message : 'Failed to load clients'))
        .finally(() => setLoadingClients(false));
    }
  }

  function run(fn: () => Promise<void>) {
    onError('');
    start(async () => {
      try { await fn(); onDone(); }
      catch (e) { onError(e instanceof Error ? e.message : 'Action failed'); }
    });
  }

  function form(extra: Record<string, string>): FormData {
    const f = new FormData();
    f.set('tour_id', String(tour.id));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  const memberIds = new Set(tour.members.map(m => m.user_id));
  // Only reps & managers belong to tours; their tour role follows their account.
  const available = users.filter(u => !memberIds.has(u.id) && (u.role === 'rep' || u.role === 'manager'));

  return (
    <div style={PANEL}>
      <div style={PANEL_H}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{tour.name}</span>
          {tour.zone && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-3)' }}>{tour.zone}</span>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {confirmDel ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--neg)' }}>
              Delete this tour?{tour.client_count > 0 ? ` ${tour.client_count} client${tour.client_count !== 1 ? 's' : ''} will be unassigned.` : ''}
            </span>
            <button type="button" disabled={pending}
              onClick={() => run(() => deleteTour(form({ id: String(tour.id) })))}
              style={{ ...MINI_BTN, ...NEG_SOLID }}>Yes, delete</button>
            <button type="button" onClick={() => setConfirmDel(false)} style={MINI_BTN}>Cancel</button>
          </span>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirmDel(true)}
            title="Delete tour" style={{ ...MINI_BTN, ...NEG_OUTLINE }}>Delete</button>
        )}
        <button type="button" onClick={toggleClients} disabled={tour.client_count === 0}
          aria-expanded={clientsOpen}
          title={tour.client_count === 0 ? 'No clients on this tour' : clientsOpen ? 'Hide clients' : 'Show clients on this tour'}
          style={{ ...COUNT_BTN, cursor: tour.client_count === 0 ? 'default' : 'pointer', color: tour.client_count === 0 ? 'var(--fg-3)' : '#0A3D8F' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{tour.client_count}</span>
          <span>client{tour.client_count !== 1 ? 's' : ''}</span>
          {tour.client_count > 0 && (
            <span style={{ display: 'inline-flex', transform: clientsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} aria-hidden>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5 8 10.5 12 6.5" /></svg>
            </span>
          )}
        </button>
        </div>
      </div>

      {clientsOpen && (
        <div style={CLIENTS_PANEL}>
          {loadingClients ? (
            <div style={CLIENTS_MSG}>Loading clients…</div>
          ) : clientsErr ? (
            <div style={{ ...CLIENTS_MSG, color: 'var(--neg)' }}>{clientsErr}</div>
          ) : clients && clients.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {clients.map((c, i) => (
                <div key={c.id} style={{ ...CLIENT_ROW, borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{c.code}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.legal_name}</span>
                  {c.industry && <Tag>{c.industry}</Tag>}
                  {c.zone && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{c.zone}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div style={CLIENTS_MSG}>No clients on this tour yet.</div>
          )}
        </div>
      )}

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Members */}
        <div>
          <div style={SECTION_LBL}>Assigned Users</div>
          {tour.members.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic' }}>None assigned</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tour.members.map(m => (
                <div key={m.user_id} style={MEMBER_ROW}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{m.name}</span>
                  <Tag kind={m.role === 'manager' ? 'accent' : undefined}>{m.role}</Tag>
                  <div style={{ flex: 1 }} />
                  <button type="button" disabled={pending}
                    onClick={() => run(() => removeUserFromTour(form({ user_id: String(m.user_id) })))}
                    style={{ ...MINI_BTN, ...NEG_OUTLINE }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add user */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <select value={addUserId} onChange={e => setAddUserId(e.target.value)} style={{ ...INP, maxWidth: 320 }}>
            <option value="">— Select user —</option>
            {available.map(u => (
              <option key={u.id} value={String(u.id)}>{u.name}{u.email ? ` · ${u.email}` : ''}</option>
            ))}
          </select>
          <button type="button" disabled={pending || !addUserId}
            onClick={() => run(async () => {
              await assignUserToTour(form({ user_id: addUserId }));
              setAddUserId('');
            })}
            style={{ ...PRIMARY_BTN, opacity: !addUserId ? 0.5 : 1 }}>
            + Assign
          </button>
        </div>
      </div>
    </div>
  );
}

const KPI_ROW: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 };
const KPI_CARD: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px' };
const FILTER_BAR: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 };
const SEARCH_INP: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', minWidth: 200 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const COUNT_BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', fontSize: 11, fontWeight: 600, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 999, fontFamily: 'inherit', lineHeight: 1 };
const CLIENTS_PANEL: CSSProperties = { borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', maxHeight: 280, overflowY: 'auto' };
const CLIENTS_MSG: CSSProperties = { padding: '14px 16px', fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic' };
const CLIENT_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px' };
const SECTION_LBL: CSSProperties = { fontSize: 10, fontWeight: 700, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 };
const MEMBER_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-elev)', borderRadius: 6 };
const INP: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6, color: '#0D1B2A', outline: 'none', boxSizing: 'border-box', width: '100%' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
const MINI_BTN: CSSProperties = { padding: '4px 9px', fontSize: 11, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' };
const NEG_OUTLINE: CSSProperties = { color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.30)', background: 'transparent' };
const NEG_SOLID: CSSProperties = { background: '#E02424', color: '#fff', border: '1px solid #E02424' };
const ERR_BOX: CSSProperties = { padding: '9px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5, fontSize: 12, color: '#9B1C1C', marginBottom: 12 };
