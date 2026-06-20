import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { type RepData } from '@/components/risansi/RepRow';
import { RepsZoneFilter } from '@/components/risansi/RepsZoneFilter';
import { AddRepButton } from '@/components/risansi/AddRepButton';
import { AddTourButton } from '@/components/risansi/AddTourButton';
import { RepsToursTabs } from '@/components/risansi/RepsToursTabs';
import { ToursClient, type TourMappingRow, type AssignableUser } from '../tours/ToursClient';
import { UnassignedClient, type UnassignedRow, type OwnerOption, type TourOption } from '../unassigned/UnassignedClient';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/system]', err); return fallback; }
}

// Single System Admin hub: create/manage reps & managers, tours, tour membership,
// and which clients belong to a tour. All four capabilities on one page, in tabs.
export default async function SystemAdminPage() {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'Tours & Reps']} />;
  }

  const [reps, toursMapping, assignableUsers, unassignedClients, owners, tourOpts, counts] = await Promise.all([
    // Reps & managers (with tour-based client counts) for the Reps tab + Add Tour primary-rep picker.
    q<RepData[]>(async () => (await risansiPool.query<RepData>(`
      SELECT r.*,
        (SELECT COUNT(DISTINCT c2.id) FROM clients c2
          WHERE c2.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = r.id)
            AND c2.deleted_at IS NULL AND c2.status = 'ACTIVE')::text AS client_count,
        COUNT(DISTINCT v.id) FILTER (WHERE v.visit_date >= CURRENT_DATE - INTERVAL '30 days')::text AS visits_last_30d,
        MAX(v.visit_date)::text AS last_visit_date
      FROM users r
      LEFT JOIN visits v ON v.rep_id = r.id
      GROUP BY r.id
      ORDER BY r.zone ASC, r.name ASC`)).rows, []),

    // Tours with their members (for the Tours tab — assign/remove reps & managers, set primary).
    q<TourMappingRow[]>(async () => (await risansiPool.query<TourMappingRow>(`
      SELECT tr.id::int AS id, tr.name, tr.zone,
        (SELECT COUNT(*) FROM clients c WHERE c.tour_id = tr.id AND c.deleted_at IS NULL)::int AS client_count,
        COALESCE(json_agg(json_build_object('user_id', u.id, 'name', u.name, 'role', ta.role) ORDER BY u.name)
          FILTER (WHERE u.id IS NOT NULL), '[]') AS members
      FROM tour_routes tr
      LEFT JOIN tour_assignments ta ON ta.tour_id = tr.id
      LEFT JOIN users u ON u.id = ta.rep_id
      GROUP BY tr.id, tr.name, tr.zone
      ORDER BY tr.zone ASC NULLS LAST, tr.name ASC`)).rows, []),

    q<AssignableUser[]>(async () => (await risansiPool.query<AssignableUser>(`
      SELECT id::int AS id, name, zone, role FROM users
      WHERE is_active = TRUE AND role IN ('rep','manager','admin','sysadmin') ORDER BY name ASC`)).rows, []),

    // Clients needing a tour (for the Clients tab).
    q<UnassignedRow[]>(async () => (await risansiPool.query<UnassignedRow>(`
      SELECT c.id::int AS id, c.code, c.legal_name, c.industry, c.zone, c.tour_id::int AS tour_id,
        (NOT EXISTS (SELECT 1 FROM tour_assignments ta WHERE ta.tour_id = c.tour_id AND ta.role = 'rep')) AS no_owner,
        (c.tour_id IS NULL) AS no_tour
      FROM clients c
      WHERE c.deleted_at IS NULL
        AND (NOT EXISTS (SELECT 1 FROM tour_assignments ta WHERE ta.tour_id = c.tour_id AND ta.role = 'rep') OR c.tour_id IS NULL)
      ORDER BY c.legal_name ASC LIMIT 2000`)).rows, []),

    q<OwnerOption[]>(async () => (await risansiPool.query<OwnerOption>(`
      SELECT id::int AS id, name, zone FROM users
      WHERE is_active = TRUE AND role IN ('rep','manager','admin','sysadmin') ORDER BY name ASC`)).rows, []),

    q<TourOption[]>(async () => (await risansiPool.query<TourOption>(`
      SELECT id::int AS id, name, zone FROM tour_routes ORDER BY name ASC`)).rows, []),

    q<{ no_owner: number; no_tour: number; both: number; needing: number }>(async () => {
      const { rows } = await risansiPool.query<{ no_owner: string; no_tour: string; both: string; needing: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE no_owner)::text             AS no_owner,
          COUNT(*) FILTER (WHERE no_tour)::text              AS no_tour,
          COUNT(*) FILTER (WHERE no_owner AND no_tour)::text AS both,
          COUNT(*) FILTER (WHERE no_owner OR  no_tour)::text AS needing
        FROM (
          SELECT
            (NOT EXISTS (SELECT 1 FROM tour_assignments ta WHERE ta.tour_id = c.tour_id AND ta.role = 'rep')) AS no_owner,
            (c.tour_id IS NULL) AS no_tour
          FROM clients c WHERE c.deleted_at IS NULL
        ) s`);
      return {
        no_owner: Number(rows[0]?.no_owner ?? 0), no_tour: Number(rows[0]?.no_tour ?? 0),
        both: Number(rows[0]?.both ?? 0), needing: Number(rows[0]?.needing ?? 0),
      };
    }, { no_owner: 0, no_tour: 0, both: 0, needing: 0 }),
  ]);

  const repCount = reps.filter(r => r.role === 'rep' || r.role === 'manager').length;

  const actionBar = (button: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>{button}</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Tours & Reps']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Tours &amp; Reps
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {repCount} rep{repCount !== 1 ? 's' : ''}/manager{repCount !== 1 ? 's' : ''} · {tourOpts.length} tour{tourOpts.length !== 1 ? 's' : ''} · {counts.needing} client{counts.needing !== 1 ? 's' : ''} need a tour
          </div>
        </div>

        <RepsToursTabs tabs={[
          {
            value: 'reps',
            label: `Reps & Managers (${repCount})`,
            content: <>{actionBar(<AddRepButton />)}<RepsZoneFilter reps={reps} /></>,
          },
          {
            value: 'tours',
            label: `Tours (${tourOpts.length})`,
            content: <>{actionBar(<AddTourButton />)}<ToursClient tours={toursMapping} users={assignableUsers} /></>,
          },
          {
            value: 'clients',
            label: `Clients → Tours (${counts.needing})`,
            content: <UnassignedClient clients={unassignedClients} users={owners} tours={tourOpts} counts={counts} />,
          },
        ]} />
      </div>
    </div>
  );
}
