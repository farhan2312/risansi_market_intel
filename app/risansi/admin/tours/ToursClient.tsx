'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@/components/risansi';
import {
  assignUserToTour, removeUserFromTour, setTourPrimaryUser,
} from '@/app/actions/sysadmin';

interface TourMember { user_id: number; name: string; role: string; }

export interface TourMappingRow {
  id:             number;
  name:           string;
  zone:           string | null;
  primary_rep_id: number | null;
  client_count:   number;
  members:        TourMember[];
}

export interface AssignableUser {
  id:   number;
  name: string;
  zone: string | null;
  role: string;
}

export function ToursClient({ tours, users }: { tours: TourMappingRow[]; users: AssignableUser[] }) {
  const router = useRouter();
  const [err, setErr] = useState('');

  return (
    <>
      {err && <div style={ERR_BOX}>{err}</div>}
      {tours.length === 0 ? (
        <div style={{ ...PANEL, padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
          No tours yet. Create tours from the Reps &amp; Tours page.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tours.map(t => (
            <TourCard key={t.id} tour={t} users={users} onError={setErr} onDone={() => router.refresh()} />
          ))}
        </div>
      )}
    </>
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
  const [addRole, setAddRole] = useState<'rep' | 'manager'>('rep');

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
  const available = users.filter(u => !memberIds.has(u.id));

  return (
    <div style={PANEL}>
      <div style={PANEL_H}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{tour.name}</span>
          {tour.zone && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-3)' }}>{tour.zone}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {tour.client_count} client{tour.client_count !== 1 ? 's' : ''}
        </span>
      </div>

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
                  {tour.primary_rep_id === m.user_id && <Tag kind="pos">Primary</Tag>}
                  <div style={{ flex: 1 }} />
                  {tour.primary_rep_id !== m.user_id && (
                    <button type="button" disabled={pending}
                      onClick={() => run(() => setTourPrimaryUser(form({ user_id: String(m.user_id) })))}
                      style={MINI_BTN}>
                      Set primary
                    </button>
                  )}
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
          <select value={addUserId} onChange={e => setAddUserId(e.target.value)} style={{ ...INP, maxWidth: 240 }}>
            <option value="">— Select user —</option>
            {available.map(u => (
              <option key={u.id} value={String(u.id)}>{u.name}{u.zone ? ` · ${u.zone}` : ''}</option>
            ))}
          </select>
          <select value={addRole} onChange={e => setAddRole(e.target.value as 'rep' | 'manager')} style={{ ...INP, maxWidth: 130 }}>
            <option value="rep">rep</option>
            <option value="manager">manager</option>
          </select>
          <button type="button" disabled={pending || !addUserId}
            onClick={() => run(async () => {
              await assignUserToTour(form({ user_id: addUserId, role: addRole }));
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

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const SECTION_LBL: CSSProperties = { fontSize: 10, fontWeight: 700, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 };
const MEMBER_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-elev)', borderRadius: 6 };
const INP: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6, color: '#0D1B2A', outline: 'none', boxSizing: 'border-box', width: '100%' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
const MINI_BTN: CSSProperties = { padding: '4px 9px', fontSize: 11, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' };
const NEG_OUTLINE: CSSProperties = { color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.30)', background: 'transparent' };
const ERR_BOX: CSSProperties = { padding: '9px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5, fontSize: 12, color: '#9B1C1C', marginBottom: 12 };
