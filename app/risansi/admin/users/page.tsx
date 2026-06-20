import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { UsersClient, type UserRow } from './UsersClient';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/users]', err); return fallback; }
}

export default async function UsersAdminPage() {
  const me = await getCurrentUser();
  // System Admin only — admins are scoped to Client Master + Revenue Upload.
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'User Management']} />;
  }
  const isSysadmin = me.role === 'sysadmin';

  const users = await q<UserRow[]>(async () => {
    const { rows } = await risansiPool.query<UserRow>(`
      SELECT
        u.id::int                                   AS id,
        u.name,
        u.email,
        u.role,
        u.status,
        u.is_active,
        u.zone,
        u.route,
        u.rep_code,
        u.target_cr::float                          AS target_cr,
        COUNT(DISTINCT ta.tour_id)::int             AS tours_count,
        COUNT(DISTINCT c.id)::int                   AS clients_count
      FROM users u
      LEFT JOIN tour_assignments ta ON ta.rep_id = u.id
      LEFT JOIN clients c ON c.tour_id = ta.tour_id AND c.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY
        CASE u.status WHEN 'Pending' THEN 0 ELSE 1 END,
        u.is_active DESC,
        u.name ASC
    `);
    return rows;
  }, []);

  const total    = users.length;
  const active   = users.filter(u => u.is_active).length;
  const pending  = users.filter(u => u.status === 'Pending').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'User Management']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            User Management
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {total} user{total !== 1 ? 's' : ''} · {active} active
            {pending > 0 ? ` · ${pending} pending` : ''}
          </div>
        </div>

        <UsersClient users={users} isSysadmin={isSysadmin} />
      </div>
    </div>
  );
}
