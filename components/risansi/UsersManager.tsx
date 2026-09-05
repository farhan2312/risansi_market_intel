'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from '@/components/risansi';
import { createRep, updateRep } from '@/app/actions/risansi-reps';
import { approveUser, rejectUser, reapproveUser, revokeUser, resetUserPassword } from '@/app/actions/admin';
import { deleteUser } from '@/app/actions/sysadmin';

export interface UserRow {
  id:             number;
  name:           string;
  email:          string;
  role:           string;
  department:     string | null;
  status:         string;
  is_active:      boolean;
  zone:           string | null;
  route:          string | null;
  rep_code:       string | null;
  target_cr:      number | null;
  team_count:     number;
  clients_count:  number;
}

// 'staff' first, because it is the one that needs explaining: it is not the
// bottom of the ladder, it is off it. A staff user reaches Client 360 and
// Complaints and nothing else, whatever their department.
const ROLES = ['staff', 'rep', 'manager', 'admin', 'sysadmin'];
const DEPARTMENTS = ['Quality', 'Service', 'Production', 'Stores', 'Accounts', 'Purchase', 'Dispatch'];

// Account + access management for every user. Lives on /admin (sysadmin only).
// Ownership and teams are handled separately on Reps & Managers.
export function UsersManager({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [statusF, setStatusF] = useState('all'); // all | pending | approved | rejected
  const [err, setErr] = useState('');

  const filtered = users.filter(u => {
    if (statusF !== 'all') {
      if (statusF === 'pending'  && u.status !== 'Pending')  return false;
      if (statusF === 'approved' && u.status !== 'Approved') return false;
      if (statusF === 'rejected' && u.status !== 'Rejected') return false;
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      return u.name.toLowerCase().includes(q)
        || u.email.toLowerCase().includes(q)
        || (u.zone ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const pendingCount = users.filter(u => u.status === 'Pending').length;

  function refresh() { router.refresh(); }

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          placeholder="Search name, email, zone…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ ...INP, maxWidth: 280, width: 280 }}
        />
        <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ ...INP, width: 'auto', cursor: 'pointer' }}>
          <option value="all">All statuses</option>
          <option value="pending">Pending{pendingCount ? ` (${pendingCount})` : ''}</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => { setCreating(true); setErr(''); }} style={PRIMARY_BTN}>
          + Add User
        </button>
      </div>

      {err && <div style={ERR_BOX}>{err}</div>}

      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                {['User', 'Role', 'Status', 'Active', 'Zone / Route', 'Team', 'Clients', ''].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>No users found</td></tr>
              ) : filtered.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <td data-label="" style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500, color: 'var(--fg)' }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{u.email}</div>
                  </td>
                  <td data-label="Role" style={TD}>
                    <Tag kind={u.role === 'sysadmin' || u.role === 'admin' ? 'accent' : undefined}>{u.role}</Tag>
                    {u.department && (
                      <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 6 }}>{u.department}</span>
                    )}
                  </td>
                  <td data-label="Status" style={TD}>
                    <Tag kind={u.status === 'Approved' ? 'pos' : u.status === 'Pending' ? 'warn' : 'neg'} dot>{u.status}</Tag>
                  </td>
                  <td data-label="Active" style={TD}>
                    <span style={{ color: u.is_active ? 'var(--pos)' : 'var(--fg-3)', fontWeight: 500 }}>
                      {u.is_active ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td data-label="Zone / Route" style={{ ...TD, whiteSpace: 'nowrap' }}>
                    <div>{u.zone ?? '—'}</div>
                    {u.route && <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{u.route}</div>}
                  </td>
                  <td data-label="Team" style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{u.team_count || '—'}</td>
                  <td data-label="Clients" style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{u.clients_count || '—'}</td>
                  <td data-label="" style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <RowActions
                      user={u}
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

function RowActions({ user, onEdit, onError, onDone }: {
  user: UserRow;
  onEdit: () => void;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);
  const [approveRole, setApproveRole] = useState(user.role || 'rep');

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
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {user.status === 'Pending' && (
        <>
          {/* Pick the role to grant at approval (defaults to the requested role). */}
          <select value={approveRole} onChange={e => setApproveRole(e.target.value)} disabled={pending}
            style={{ ...MINI_SELECT }} title="Role to grant">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="button" disabled={pending} onClick={() => run(() => approveUser(fd({ role: approveRole })))} style={{ ...MINI_BTN, ...POS_BTN }}>
            Approve
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => rejectUser(fd()))} style={{ ...MINI_BTN, ...NEG_OUTLINE }}>
            Reject
          </button>
        </>
      )}
      {user.status === 'Rejected' && (
        <button type="button" disabled={pending} onClick={() => run(() => reapproveUser(fd()))} style={{ ...MINI_BTN, ...POS_BTN }}>
          Re-approve
        </button>
      )}
      {user.status === 'Approved' && (
        <button type="button" disabled={pending} onClick={() => run(() => revokeUser(fd()))} style={{ ...MINI_BTN, ...NEG_OUTLINE }} title="Revoke access (sets status to Rejected)">
          Revoke
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
      {confirmDel ? (
        <>
          <span style={{ fontSize: 11, color: 'var(--neg)' }}>Delete?</span>
          <button type="button" disabled={pending} onClick={() => run(() => deleteUser(fd()))} style={{ ...MINI_BTN, ...NEG_SOLID }}>Yes</button>
          <button type="button" onClick={() => setConfirmDel(false)} style={MINI_BTN}>No</button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => setConfirmDel(true)} style={{ ...MINI_BTN, ...NEG_OUTLINE }}>Delete</button>
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
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--title)' }}>
            {mode === 'create' ? 'New User' : 'Edit User'}
          </div>
          <button type="button" onClick={onClose} style={CLOSE_BTN}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              <Field label="Department">
                <select name="department" defaultValue={user?.department ?? ''} style={INP}>
                  <option value="">— none —</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
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
                  style={{ width: 15, height: 15, accentColor: 'var(--brand-blue)', cursor: 'pointer' }} />
                <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>Active</span>
              </label>
            )}

            {error && <div style={ERR_BOX}>{error}</div>}

            <button type="submit" disabled={pending} style={{ ...SUBMIT_BTN, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Saving…' : mode === 'create' ? 'Create User' : 'Save Changes'}
            </button>
          </form>

          {mode === 'edit' && user && (
            <ResetPasswordPanel user={user} />
          )}
          {mode === 'create' && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              After creating the user, reopen them here to set a temporary password they can sign in with.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Password reset (account-level) ─────────────────────────────

function ResetPasswordPanel({ user }: { user: UserRow }) {
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  function submit() {
    setMsg(''); setError('');
    if (temp.length < 8) { setError('Temporary password must be at least 8 characters'); return; }
    const f = new FormData();
    f.set('id', String(user.id));
    f.set('temp_password', temp);
    start(async () => {
      try {
        await resetUserPassword(f);
        setTemp('');
        setMsg('Temporary password set. The user must change it at next sign-in — share it with them securely.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to reset password');
      }
    });
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={LBL}>Reset Password</div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', margin: '0 0 8px' }}>
        Set a temporary password for {user.name}. They&apos;ll be forced to choose a new one at next sign-in.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text" value={temp} onChange={e => setTemp(e.target.value)}
          placeholder="Temporary password (min 8 chars)"
          style={{ ...INP, flex: 1, minWidth: 200 }}
        />
        <button type="button" disabled={pending || temp.length < 8} onClick={submit}
          style={{ ...PRIMARY_BTN, opacity: pending || temp.length < 8 ? 0.5 : 1 }}>
          {pending ? 'Setting…' : 'Set temporary password'}
        </button>
      </div>
      {msg && <div style={{ ...OK_BOX, marginTop: 8 }}>{msg}</div>}
      {error && <div style={{ ...ERR_BOX, marginTop: 8, marginBottom: 0 }}>{error}</div>}
    </div>
  );
}

// ── Small layout helpers ───────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>{label}{required && <span style={{ color: 'var(--neg)', marginLeft: 2 }}>*</span>}</label>
      {children}
    </div>
  );
}
// Columns follow the width. A fixed '1fr 1fr' ignores the container entirely,
// so widening the shell produced wider fields and exactly the same number of
// rows — which is not what "less scrolling" means. With auto-fit a row given
// three fields lays them out three-across when there is room, and a narrow
// container gets one clean column instead of two cramped ones.
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>{children}</div>;
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const LBL: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 };
const INP: CSSProperties = { display: 'block', width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const PRIMARY_BTN: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 };
const MINI_BTN: CSSProperties = { padding: '4px 9px', fontSize: 11, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' };
const MINI_SELECT: CSSProperties = { padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer' };
const POS_BTN: CSSProperties = { background: 'var(--pos)', color: '#fff', border: '1px solid var(--pos)' };
const NEG_OUTLINE: CSSProperties = { color: 'var(--neg)', border: '1px solid var(--neg)', background: 'transparent' };
const NEG_SOLID: CSSProperties = { background: '#E02424', color: '#fff', border: '1px solid #E02424' };
const ERR_BOX: CSSProperties = { padding: '9px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 5, fontSize: 12, color: 'var(--neg-strong)', marginBottom: 12 };
const OK_BOX: CSSProperties = { padding: '9px 12px', background: 'var(--pos-soft)', border: '1px solid var(--pos)', borderRadius: 5, fontSize: 12, color: 'var(--pos-strong)' };
const DRAWER: CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 600, maxWidth: '100vw', zIndex: 301, background: 'var(--bg-paper)', boxShadow: '-8px 0 40px rgba(10,22,40,0.14)', display: 'flex', flexDirection: 'column' };
const DRAWER_H: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 };
const CLOSE_BTN: CSSProperties = { width: 28, height: 28, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--fg-3)', borderRadius: 4 };
const SUBMIT_BTN: CSSProperties = { width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 600, background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 };
