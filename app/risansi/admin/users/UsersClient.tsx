'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@/components/risansi';
import { createRep, updateRep } from '@/app/actions/risansi-reps';
import { approveUser, rejectUser, reapproveUser } from '@/app/actions/admin';
import { deleteUser } from '@/app/actions/sysadmin';

export interface UserRow {
  id:             number;
  name:           string;
  email:          string;
  role:           string;
  status:         string;
  is_active:      boolean;
  zone:           string | null;
  route:          string | null;
  rep_code:       string | null;
  target_cr:      number | null;
  tours_count:    number;
  clients_count:  number;
}

const ROLES = ['rep', 'manager', 'admin', 'sysadmin'];

export function UsersClient({ users, isSysadmin }: { users: UserRow[]; isSysadmin: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');

  const filtered = query.trim()
    ? users.filter(u =>
        u.name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase()) ||
        (u.zone ?? '').toLowerCase().includes(query.toLowerCase()),
      )
    : users;

  function refresh() { router.refresh(); }

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder="Search name, email, zone…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ ...INP, maxWidth: 320 }}
        />
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => { setCreating(true); setErr(''); }} style={PRIMARY_BTN}>
          + Add User
        </button>
      </div>

      {err && (
        <div style={ERR_BOX}>{err}</div>
      )}

      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                {['User', 'Role', 'Status', 'Active', 'Zone / Route', 'Tours', 'Clients', ''].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>No users found</td></tr>
              ) : filtered.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500, color: 'var(--fg)' }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{u.email}</div>
                  </td>
                  <td style={TD}><Tag kind={u.role === 'sysadmin' || u.role === 'admin' ? 'accent' : undefined}>{u.role}</Tag></td>
                  <td style={TD}>
                    <Tag kind={u.status === 'Approved' ? 'pos' : u.status === 'Pending' ? 'warn' : 'neg'} dot>{u.status}</Tag>
                  </td>
                  <td style={TD}>
                    <span style={{ color: u.is_active ? 'var(--pos)' : 'var(--fg-3)', fontWeight: 500 }}>
                      {u.is_active ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                    <div>{u.zone ?? '—'}</div>
                    {u.route && <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{u.route}</div>}
                  </td>
                  <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{u.tours_count || '—'}</td>
                  <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{u.clients_count || '—'}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <RowActions
                      user={u}
                      isSysadmin={isSysadmin}
                      onEdit={() => { setEditing(u); setErr(''); }}
                      onError={setErr}
                      onDone={refresh}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <UserDrawer
          mode={creating ? 'create' : 'edit'}
          user={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refresh(); }}
        />
      )}
    </>
  );
}

// ── Row inline actions ─────────────────────────────────────────

function RowActions({ user, isSysadmin, onEdit, onError, onDone }: {
  user: UserRow;
  isSysadmin: boolean;
  onEdit: () => void;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);

  function run(fn: () => Promise<void>) {
    onError('');
    start(async () => {
      try { await fn(); onDone(); }
      catch (e) { onError(e instanceof Error ? e.message : 'Action failed'); }
    });
  }

  function fd(extra: Record<string, string> = {}): FormData {
    const f = new FormData();
    f.set('id', String(user.id));
    f.set('role', user.role);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {user.status === 'Pending' && (
        <button type="button" disabled={pending} onClick={() => run(() => approveUser(fd()))} style={{ ...MINI_BTN, ...POS_BTN }}>
          Approve
        </button>
      )}
      {user.status === 'Pending' && (
        <button type="button" disabled={pending} onClick={() => run(() => rejectUser(fd()))} style={{ ...MINI_BTN, ...NEG_OUTLINE }}>
          Reject
        </button>
      )}
      {user.status === 'Rejected' && (
        <button type="button" disabled={pending} onClick={() => run(() => reapproveUser(fd()))} style={{ ...MINI_BTN, ...POS_BTN }}>
          Re-approve
        </button>
      )}
      <button type="button" disabled={pending} onClick={onEdit} style={MINI_BTN}>Edit</button>
      <button
        type="button" disabled={pending}
        onClick={() => run(() => updateRep(user.id, fd({
          name: user.name, email: user.email, zone: user.zone ?? '',
          route: user.route ?? '', target_cr: user.target_cr != null ? String(user.target_cr) : '',
          role: user.role, is_active: user.is_active ? 'false' : 'true',
        })))}
        style={MINI_BTN}
      >
        {user.is_active ? 'Deactivate' : 'Reactivate'}
      </button>
      {isSysadmin && (
        confirmDel ? (
          <>
            <span style={{ fontSize: 11, color: 'var(--neg)' }}>Delete?</span>
            <button type="button" disabled={pending} onClick={() => run(() => deleteUser(fd()))} style={{ ...MINI_BTN, ...NEG_SOLID }}>Yes</button>
            <button type="button" onClick={() => setConfirmDel(false)} style={MINI_BTN}>No</button>
          </>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirmDel(true)} style={{ ...MINI_BTN, ...NEG_OUTLINE }}>Delete</button>
        )
      )}
    </div>
  );
}

// ── Create / Edit drawer ───────────────────────────────────────

function UserDrawer({ mode, user, onClose, onSaved }: {
  mode: 'create' | 'edit';
  user: UserRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    start(async () => {
      try {
        if (mode === 'create') await createRep(f);
        else await updateRep(user!.id, f);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save user');
      }
    });
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 }} />
      <div style={DRAWER}>
        <div style={DRAWER_H}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F' }}>
            {mode === 'create' ? 'New User' : 'Edit User'}
          </div>
          <button type="button" onClick={onClose} style={CLOSE_BTN}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Name" required>
            <input name="name" required defaultValue={user?.name ?? ''} style={INP} />
          </Field>
          <Field label="Email" required>
            <input name="email" type="email" required defaultValue={user?.email ?? ''} style={INP} />
          </Field>
          <Row>
            <Field label="Role">
              <select name="role" defaultValue={user?.role ?? 'rep'} style={INP}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Rep Code">
              <input name="rep_code" defaultValue={user?.rep_code ?? ''} style={INP} />
            </Field>
          </Row>
          <Row>
            <Field label="Zone">
              <input name="zone" defaultValue={user?.zone ?? ''} style={INP} />
            </Field>
            <Field label="Route">
              <input name="route" defaultValue={user?.route ?? ''} style={INP} />
            </Field>
          </Row>
          <Field label="Target (₹ Cr)">
            <input name="target_cr" type="number" step="0.01" min="0"
              defaultValue={user?.target_cr != null ? String(user.target_cr) : ''} style={INP} />
          </Field>
          {mode === 'edit' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              {/* updateRep reads is_active === 'true'. A hidden 'false' before the
                  checkbox guarantees a value when unchecked. */}
              <input type="hidden" name="is_active" value="false" />
              <input type="checkbox" name="is_active" value="true" defaultChecked={user?.is_active ?? true}
                style={{ width: 15, height: 15, accentColor: '#1A5CB8', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: '#2C3E5A' }}>Active</span>
            </label>
          )}

          {error && <div style={ERR_BOX}>{error}</div>}

          <button type="submit" disabled={pending} style={{ ...SUBMIT_BTN, opacity: pending ? 0.6 : 1 }}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create User' : 'Save Changes'}
          </button>
        </form>
      </div>
    </>
  );
}

// ── Small layout helpers ───────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>{label}{required && <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>}</label>
      {children}
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const LBL: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 };
const INP: CSSProperties = { display: 'block', width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6, color: '#0D1B2A', outline: 'none', boxSizing: 'border-box' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
const MINI_BTN: CSSProperties = { padding: '4px 9px', fontSize: 11, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' };
const POS_BTN: CSSProperties = { background: 'var(--pos)', color: '#fff', border: '1px solid var(--pos)' };
const NEG_OUTLINE: CSSProperties = { color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.30)', background: 'transparent' };
const NEG_SOLID: CSSProperties = { background: '#E02424', color: '#fff', border: '1px solid #E02424' };
const ERR_BOX: CSSProperties = { padding: '9px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5, fontSize: 12, color: '#9B1C1C', marginBottom: 12 };
const DRAWER: CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '100vw', zIndex: 301, background: '#fff', boxShadow: '-8px 0 40px rgba(10,22,40,0.14)', display: 'flex', flexDirection: 'column' };
const DRAWER_H: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0 };
const CLOSE_BTN: CSSProperties = { width: 28, height: 28, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: '#6B7FA3', borderRadius: 4 };
const SUBMIT_BTN: CSSProperties = { width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 };
