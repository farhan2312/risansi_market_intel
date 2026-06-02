import type { CSSProperties } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { approveUser, rejectUser, revokeUser, reapproveUser } from '@/app/actions/admin';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface PendingRow {
  id: number; email: string; display_name: string; role: string; requested_at: string;
}
interface UserRow {
  id: number; email: string; display_name: string; role: string;
  status: string; requested_at: string; reviewed_at: string | null;
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const adminEmails = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? 'admin@risansi.com')
    .split(',').map(e => e.trim().toLowerCase());

  if (!session?.user?.email || !adminEmails.includes(session.user.email.toLowerCase())) {
    redirect('/api/auth/signin');
  }

  const [pending, users] = await Promise.all([
    q<PendingRow[]>(async () => {
      const { rows } = await risansiPool.query<PendingRow>(
        `SELECT id, email, display_name, COALESCE(role,'rep') AS role,
                requested_at::text AS requested_at
         FROM access_requests
         WHERE status = 'Pending'
         ORDER BY requested_at ASC`,
      );
      return rows;
    }, []),
    q<UserRow[]>(async () => {
      const { rows } = await risansiPool.query<UserRow>(
        `SELECT id, email, display_name, COALESCE(role,'rep') AS role,
                status, requested_at::text AS requested_at,
                reviewed_at::text AS reviewed_at
         FROM access_requests
         WHERE status != 'Pending'
         ORDER BY COALESCE(reviewed_at, requested_at) DESC`,
      );
      return rows;
    }, []),
  ]);

  return (
    <div style={{
      minHeight: '100vh', background: '#F4F6FB',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
      fontSize: 13, color: '#0D1B2E',
    }}>
      {/* Header */}
      <div style={{
        background: '#0A1628', color: '#fff',
        padding: '0 32px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Risansi</span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>·</span>
          <span style={{ fontSize: 13, color: '#B8C9E8' }}>System Administration</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, color: '#6B7FA3' }}>
            {session.user.email}
          </span>
          <a href="/api/auth/signout" style={{ fontSize: 12, color: '#B8C9E8', textDecoration: 'none' }}>
            Sign out
          </a>
        </div>
      </div>

      <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>

        {/* Pending banner */}
        {pending.length > 0 && (
          <div style={{
            padding: '10px 16px', marginBottom: 24,
            background: '#FEF3C7', border: '1px solid rgba(217,119,6,0.25)',
            borderRadius: 6, fontSize: 13, color: '#92400E', fontWeight: 500,
          }}>
            {pending.length} access request{pending.length !== 1 ? 's' : ''} pending approval
          </div>
        )}

        {/* Section 1 — Pending */}
        <div style={{ ...PANEL, marginBottom: 24 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Pending Requests</span>
            {pending.length > 0 && (
              <span style={{
                padding: '2px 8px', background: '#FEF3C7',
                border: '1px solid rgba(217,119,6,0.3)',
                borderRadius: 10, fontSize: 11, color: '#92400E', fontWeight: 500,
              }}>{pending.length}</span>
            )}
          </div>
          {pending.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#6B7F96', fontSize: 13 }}>
              No pending requests
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F4F6FB' }}>
                  {['Name', 'Email', 'Requested Role', 'Requested At', 'Actions'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.map(req => (
                  <tr key={req.id} style={{ borderBottom: '1px solid #EBF1FB' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 500 }}>{req.display_name}</td>
                    <td style={{ padding: '12px 14px', color: '#6B7F96', fontFamily: 'monospace', fontSize: 12 }}>
                      {req.email}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <RoleBadge role={req.role} />
                    </td>
                    <td style={{ padding: '12px 14px', color: '#6B7F96', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {req.requested_at
                        ? new Date(req.requested_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <form action={approveUser} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="hidden" name="id" value={req.id} />
                          <select name="role" defaultValue={req.role} style={ROLE_SELECT}>
                            <option value="rep">Rep</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button type="submit" style={{ ...BTN, background: '#059669', color: '#fff' }}>
                            Approve
                          </button>
                        </form>
                        <form action={rejectUser}>
                          <input type="hidden" name="id" value={req.id} />
                          <button type="submit" style={{ ...BTN, background: 'transparent', color: '#DC2626', border: '1px solid rgba(220,38,38,0.3)' }}>
                            Reject
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Section 2 — All Users */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>All Users</span>
            <span style={{ fontSize: 12, color: '#6B7F96', fontFamily: 'monospace' }}>
              {users.filter(u => u.status === 'Approved').length} active
            </span>
          </div>
          {users.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#6B7F96', fontSize: 13 }}>
              No users yet
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F4F6FB' }}>
                  {['Name', 'Email', 'Role', 'Status', 'Approved At', 'Actions'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #EBF1FB' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 500 }}>{u.display_name}</td>
                    <td style={{ padding: '12px 14px', color: '#6B7F96', fontFamily: 'monospace', fontSize: 12 }}>
                      {u.email}
                    </td>
                    <td style={{ padding: '12px 14px' }}><RoleBadge role={u.role} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      <StatusBadge status={u.status} />
                    </td>
                    <td style={{ padding: '12px 14px', color: '#6B7F96', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {u.reviewed_at
                        ? new Date(u.reviewed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {u.status === 'Approved' ? (
                        <form action={revokeUser}>
                          <input type="hidden" name="id" value={u.id} />
                          <button type="submit" style={{ ...BTN, color: '#DC2626', border: '1px solid rgba(220,38,38,0.3)', background: 'transparent' }}>
                            Revoke
                          </button>
                        </form>
                      ) : (
                        <form action={reapproveUser} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="hidden" name="id" value={u.id} />
                          <select name="role" defaultValue={u.role} style={ROLE_SELECT}>
                            <option value="rep">Rep</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button type="submit" style={{ ...BTN, background: '#1A5CB8', color: '#fff' }}>
                            Re-approve
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    sysadmin: { bg: '#EDE9FE', color: '#5B21B6' },
    admin:    { bg: '#DBEAFE', color: '#1D4ED8' },
    manager:  { bg: '#D1FAE5', color: '#065F46' },
    rep:      { bg: '#F3F4F6', color: '#374151' },
  };
  const c = colors[role] ?? colors.rep;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 500,
      background: c.bg, color: c.color,
      textTransform: 'capitalize',
    }}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    Approved: { bg: '#D1FAE5', color: '#065F46' },
    Rejected: { bg: '#FEE2E2', color: '#991B1B' },
    Revoked:  { bg: '#FEF3C7', color: '#92400E' },
  };
  const c = colors[status] ?? { bg: '#F3F4F6', color: '#374151' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 500,
      background: c.bg, color: c.color,
    }}>
      {status}
    </span>
  );
}

const PANEL: CSSProperties = {
  background: '#fff', border: '1px solid #DDE6F5', borderRadius: 8,
};
const PANEL_H: CSSProperties = {
  padding: '14px 18px', borderBottom: '1px solid #EBF1FB',
  display: 'flex', alignItems: 'center', gap: 10,
};
const PANEL_TITLE: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#0A1628',
};
const TH: CSSProperties = {
  padding: '9px 14px', textAlign: 'left',
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em',
  fontWeight: 600, color: '#6B7F96',
  borderBottom: '1px solid #DDE6F5',
};
const BTN: CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontFamily: 'inherit',
  fontWeight: 500, border: 'none', borderRadius: 5,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const ROLE_SELECT: CSSProperties = {
  padding: '4px 8px', fontSize: 12, fontFamily: 'inherit',
  border: '1px solid #DDE6F5', borderRadius: 5,
  background: '#F4F6FB', color: '#0D1B2E', cursor: 'pointer',
};
