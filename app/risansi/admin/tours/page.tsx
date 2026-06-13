import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { ToursClient, type TourMappingRow, type AssignableUser } from './ToursClient';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/tours]', err); return fallback; }
}

export default async function ToursAdminPage() {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'Tour Mapping']} />;
  }

  const [tours, users] = await Promise.all([
    q<TourMappingRow[]>(async () => {
      const { rows } = await risansiPool.query<TourMappingRow>(`
        SELECT
          tr.id::int                AS id,
          tr.name,
          tr.zone,
          tr.primary_rep_id::int    AS primary_rep_id,
          COUNT(DISTINCT c.id)::int AS client_count,
          COALESCE(
            json_agg(
              json_build_object('user_id', u.id, 'name', u.name, 'role', ta.role)
              ORDER BY u.name
            ) FILTER (WHERE u.id IS NOT NULL),
            '[]'
          )                         AS members
        FROM tour_routes tr
        LEFT JOIN tour_assignments ta ON ta.tour_id = tr.id
        LEFT JOIN users u             ON u.id = ta.rep_id
        LEFT JOIN clients c           ON c.tour_id = tr.id AND c.deleted_at IS NULL
        GROUP BY tr.id, tr.name, tr.zone, tr.primary_rep_id
        ORDER BY tr.zone ASC NULLS LAST, tr.name ASC
      `);
      return rows;
    }, []),

    q<AssignableUser[]>(async () => {
      const { rows } = await risansiPool.query<AssignableUser>(`
        SELECT id::int AS id, name, zone, role
        FROM users
        WHERE is_active = TRUE AND role IN ('rep', 'manager', 'admin', 'sysadmin')
        ORDER BY name ASC
      `);
      return rows;
    }, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Tour Mapping']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Tour Mapping
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {tours.length} tour{tours.length !== 1 ? 's' : ''} · assign reps and managers, set a primary user
          </div>
        </div>

        <ToursClient tours={tours} users={users} />
      </div>
    </div>
  );
}
