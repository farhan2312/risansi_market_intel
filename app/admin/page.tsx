import type { CSSProperties } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { revokeUser, reapproveUser } from '@/app/actions/admin';
import { hasRole } from '@/lib/risansi-auth';
import { ApprovalRow, type RepOption, type TourOption } from '@/components/risansi/ApprovalRow';
import { Topbar } from '@/components/risansi';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface PendingRow {
  id: number; email: string; display_name: string;
  requested_role: string; requested_at: string;
}
interface UserRow {
  id: number; email: string; display_name: string; role: string;
  status: string; requested_at: string; reviewed_at: string | null;
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';

  // Access Approval is sysadmin-only (mirrors the /admin proxy guard).
  if (!session?.user?.email || !hasRole(role, 'sysadmin')) {
    redirect('/risansi');
  }

  const [pending, users, reps, tours] = await Promise.all([
    q<PendingRow[]>(async () => {
      const { rows } = await risansiPool.query<PendingRow>(
        `SELECT id, email AS email, name AS display_name,
                COALESCE(role,'rep') AS requested_role,
                created_at::text AS requested_at
         FROM users
         WHERE status = 'Pending'
         ORDER BY created_at ASC`,
      );
      return rows;
    }, []),
    q<UserRow[]>(async () => {
      const { rows } = await risansiPool.query<UserRow>(
        `SELECT id, email AS email, name AS display_name,
                COALESCE(role,'rep') AS role,
                status, created_at::text AS requested_at,
                updated_at::text AS reviewed_at
         FROM users
         WHERE status != 'Pending'
         ORDER BY COALESCE(updated_at, created_at) DESC`,
      );
      return rows;
    }, []),
    q<RepOption[]>(async () => {
      const { rows } = await risansiPool.query<RepOption>(
        `SELECT r.id, r.name, r.zone, r.route,
                r.email AS rep_email, r.is_active,
                (r.email IS NULL) AS is_unlinked
         FROM users r
         WHERE r.is_active = TRUE
         ORDER BY r.zone ASC, r.name ASC`,
      );
      return rows;
    }, []),
    q<TourOption[]>(async () => {
      const { rows } = await risansiPool.query<TourOption>(
        `SELECT id, name, COALESCE(zone, 'Unzoned') AS zone
           FROM tour_routes
          ORDER BY zone ASC, name ASC`,
      );
      return rows;
    }, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'System Administration']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

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
                  {['Name & Email', 'Requested', 'Assign Role', 'Link to Rep', 'Assign Tours', 'Actions'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.map(req => (
                  <ApprovalRow key={req.id} request={req} reps={reps} tours={tours} />
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
                            <option value="rep"     title="Can view clients, log visits, manage own pipeline">Field Rep</option>
                            <option value="manager" title="Can assign visits to team, view all reps">Sales Manager</option>
                            <option value="admin"   title="Full access + revenue upload + client master">Admin (Full Access)</option>
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
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  rep:      'Field Rep',
  manager:  'Sales Manager',
  admin:    'Admin',
  sysadmin: 'Sysadmin',
};

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
    }}>
      {ROLE_LABELS[role] ?? role}
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
  width: 130, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
  border: '1px solid #CBD5E1', borderRadius: 6,
  background: '#F4F6FB', color: '#0D1B2E', cursor: 'pointer',
};
