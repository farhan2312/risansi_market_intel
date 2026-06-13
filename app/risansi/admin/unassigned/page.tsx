import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { UnassignedClient, type UnassignedRow, type OwnerOption, type TourOption } from './UnassignedClient';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/unassigned]', err); return fallback; }
}

export default async function UnassignedAdminPage() {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'Unassigned Clients']} />;
  }

  const [clients, users, tours, counts] = await Promise.all([
    // Clients with NO owner (no client_assignments) OR no tour.
    q<UnassignedRow[]>(async () => {
      const { rows } = await risansiPool.query<UnassignedRow>(`
        SELECT
          c.id::int        AS id,
          c.code,
          c.legal_name,
          c.industry,
          c.zone,
          c.tour_id::int   AS tour_id,
          (NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = c.id)) AS no_owner,
          (c.tour_id IS NULL) AS no_tour
        FROM clients c
        WHERE c.deleted_at IS NULL
          AND (
            NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = c.id)
            OR c.tour_id IS NULL
          )
        ORDER BY c.legal_name ASC
        LIMIT 500
      `);
      return rows;
    }, []),

    q<OwnerOption[]>(async () => {
      const { rows } = await risansiPool.query<OwnerOption>(`
        SELECT id::int AS id, name, zone FROM users
        WHERE is_active = TRUE AND role IN ('rep','manager','admin','sysadmin')
        ORDER BY name ASC
      `);
      return rows;
    }, []),

    q<TourOption[]>(async () => {
      const { rows } = await risansiPool.query<TourOption>(`
        SELECT id::int AS id, name, zone FROM tour_routes ORDER BY name ASC
      `);
      return rows;
    }, []),

    q<{ no_owner: number; no_tour: number }>(async () => {
      const { rows } = await risansiPool.query<{ no_owner: string; no_tour: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = c.id))::text AS no_owner,
          COUNT(*) FILTER (WHERE c.tour_id IS NULL)::text AS no_tour
        FROM clients c
        WHERE c.deleted_at IS NULL
      `);
      return { no_owner: Number(rows[0]?.no_owner ?? 0), no_tour: Number(rows[0]?.no_tour ?? 0) };
    }, { no_owner: 0, no_tour: 0 }),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Unassigned Clients']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Unassigned Clients
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {counts.no_owner} client{counts.no_owner !== 1 ? 's' : ''} with no rep · {counts.no_tour} with no tour
          </div>
        </div>

        <UnassignedClient clients={clients} users={users} tours={tours} />
      </div>
    </div>
  );
}
