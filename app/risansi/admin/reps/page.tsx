import type { CSSProperties } from 'react';
import { Suspense } from 'react';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { type RepData } from '@/components/risansi/RepRow';
import { TourRow, type TourData } from '@/components/risansi/TourRow';
import { AddRepButton } from '@/components/risansi/AddRepButton';
import { AddTourButton } from '@/components/risansi/AddTourButton';
import { RepsToursTabs } from '@/components/risansi/RepsToursTabs';
import { TabActionButton } from '@/components/risansi/TabActionButton';
import { RepsZoneFilter } from '@/components/risansi/RepsZoneFilter';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface ZoneStat {
  zone: string;
  rep_count: string;
  client_count: string;
  compliant_clients: string;
}

interface RepStats {
  total_reps: string;
  north_reps: string;
  central_reps: string;
  west_reps: string;
  south_reps: string;
  export_reps: string;
}

interface TourStats {
  total_tours: string;
  unassigned_tours: string;
  assigned_tours: string;
}

interface ClientStats {
  total_clients: string;
  clients_with_rep: string;
  clients_without_rep: string;
}

const ZONES = ['North', 'Central', 'West', 'South', 'Export'];

export default async function RepsAdminPage() {
  const [reps, routes, _stats, repStats, tourStats, clientStats] = await Promise.all([
    q<RepData[]>(async () => {
      const { rows } = await risansiPool.query<RepData>(`
        SELECT
          r.*,
          (SELECT COUNT(DISTINCT ca.client_id)
             FROM client_assignments ca
             JOIN clients c2 ON c2.id = ca.client_id
            WHERE ca.user_id = r.id
              AND c2.deleted_at IS NULL
              AND c2.status = 'ACTIVE')::text AS client_count,
          COUNT(DISTINCT v.id) FILTER (WHERE v.visit_date >= CURRENT_DATE - INTERVAL '30 days')::text AS visits_last_30d,
          MAX(v.visit_date)::text AS last_visit_date
        FROM users r
        LEFT JOIN visits v ON v.rep_id = r.id
        GROUP BY r.id
        ORDER BY r.zone ASC, r.name ASC
      `);
      return rows;
    }, []),

    q<TourData[]>(async () => {
      const { rows } = await risansiPool.query<TourData>(`
        SELECT
          tr.id,
          tr.name,
          tr.zone,
          tr.primary_rep_id,
          tr.visit_freq_key_days,
          tr.visit_freq_std_days,
          tr.alert_key_days,
          tr.alert_std_days,
          r.name AS rep_name,
          COUNT(DISTINCT c.id) AS client_count
        FROM tour_routes tr
        LEFT JOIN users r ON tr.primary_rep_id = r.id
        LEFT JOIN clients c ON c.tour_id = tr.id
          AND c.deleted_at IS NULL
        GROUP BY tr.id, tr.name, tr.zone,
          tr.primary_rep_id, tr.visit_freq_key_days,
          tr.visit_freq_std_days, tr.alert_key_days,
          tr.alert_std_days, r.name
        ORDER BY tr.zone ASC NULLS LAST, tr.name ASC
      `);
      return rows;
    }, []),

    q<ZoneStat[]>(async () => {
      const { rows } = await risansiPool.query<ZoneStat>(`
        SELECT
          COALESCE(r.zone, 'Unassigned') AS zone,
          COUNT(DISTINCT r.id)::text AS rep_count,
          COUNT(DISTINCT c.id)::text AS client_count,
          COUNT(DISTINCT c.id) FILTER (WHERE c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS compliant_clients
        FROM users r
        LEFT JOIN client_assignments ca ON ca.user_id = r.id
        LEFT JOIN clients c ON c.id = ca.client_id AND c.deleted_at IS NULL AND c.status = 'ACTIVE'
        WHERE r.is_active = TRUE
        GROUP BY r.zone
        ORDER BY r.zone ASC
      `);
      return rows;
    }, []),

    q<RepStats>(async () => {
      const { rows } = await risansiPool.query<RepStats>(`
        SELECT
          COUNT(*)::text AS total_reps,
          COUNT(*) FILTER (WHERE zone = 'North')::text   AS north_reps,
          COUNT(*) FILTER (WHERE zone = 'Central')::text AS central_reps,
          COUNT(*) FILTER (WHERE zone = 'West')::text    AS west_reps,
          COUNT(*) FILTER (WHERE zone = 'South')::text   AS south_reps,
          COUNT(*) FILTER (WHERE zone = 'Export')::text  AS export_reps
        FROM users
        WHERE is_active = TRUE
      `);
      return rows[0];
    }, { total_reps: '0', north_reps: '0', central_reps: '0', west_reps: '0', south_reps: '0', export_reps: '0' }),

    q<TourStats>(async () => {
      const { rows } = await risansiPool.query<TourStats>(`
        SELECT
          COUNT(*)::text AS total_tours,
          COUNT(*) FILTER (WHERE primary_rep_id IS NULL)::text AS unassigned_tours,
          COUNT(*) FILTER (WHERE primary_rep_id IS NOT NULL)::text AS assigned_tours
        FROM tour_routes
      `);
      return rows[0];
    }, { total_tours: '0', unassigned_tours: '0', assigned_tours: '0' }),

    q<ClientStats>(async () => {
      const { rows } = await risansiPool.query<ClientStats>(`
        SELECT
          COUNT(*)::text AS total_clients,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = clients.id))::text AS clients_with_rep,
          COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = clients.id))::text AS clients_without_rep
        FROM clients
        WHERE deleted_at IS NULL
          AND status = 'ACTIVE'
      `);
      return rows[0];
    }, { total_clients: '0', clients_with_rep: '0', clients_without_rep: '0' }),
  ]);

  const totalReps       = Number(repStats.total_reps);
  const northReps       = Number(repStats.north_reps);
  const centralReps     = Number(repStats.central_reps);
  const westReps        = Number(repStats.west_reps);
  const southReps       = Number(repStats.south_reps);
  const exportReps      = Number(repStats.export_reps);
  const totalTours      = Number(tourStats.total_tours);
  const assignedTours   = Number(tourStats.assigned_tours);
  const unassignedTours = Number(tourStats.unassigned_tours);
  const totalClients    = Number(clientStats.total_clients);
  const clientsWithRep  = Number(clientStats.clients_with_rep);
  const clientsWithoutRep = Number(clientStats.clients_without_rep);

  const toursByZone = ZONES.reduce((acc, zone) => {
    acc[zone] = routes.filter(r => r.zone === zone);
    return acc;
  }, {} as Record<string, TourData[]>);

  const unzoned = routes.filter(r => !r.zone);

  const coveragePct = totalClients > 0 ? Math.round((clientsWithRep / totalClients) * 100) : 0;
  const assignedPct = totalTours > 0 ? Math.round((assignedTours / totalTours) * 100) : 0;
  const avgPerRep   = totalReps > 0 ? Math.round(totalClients / totalReps) : 0;

  /* ── Reps tab content ── */
  const repsContent = <RepsZoneFilter reps={reps} />;

  /* ── Tours tab content ── */
  const toursContent = (
    <>
      {ZONES.map(zone => {
        const zoneTours = toursByZone[zone] ?? [];
        if (zoneTours.length === 0) return null;
        return (
          <div key={zone} style={{ ...PANEL, marginBottom: 16 }}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>{zone}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                {zoneTours.length} tour{zoneTours.length !== 1 ? 's' : ''} · {zoneTours.reduce((s, t) => s + parseInt(String(t.client_count) || '0', 10), 0)} clients
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  <th style={TH}>Tour</th>
                  <th style={TH}>Assigned Rep</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Clients</th>
                  <th style={{ ...TH, textAlign: 'right', width: 80 }}>Key (days)</th>
                  <th style={{ ...TH, textAlign: 'right', width: 80 }}>Std (days)</th>
                </tr>
              </thead>
              <tbody>
                {zoneTours.map(tour => (
                  <TourRow key={tour.id} route={tour} reps={reps} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {unzoned.length > 0 && (
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Unzoned</span>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {unzoned.length} tour{unzoned.length !== 1 ? 's' : ''} · {unzoned.reduce((s, t) => s + parseInt(String(t.client_count) || '0', 10), 0)} clients
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                <th style={TH}>Tour</th>
                <th style={TH}>Assigned Rep</th>
                <th style={{ ...TH, textAlign: 'center' }}>Clients</th>
                <th style={{ ...TH, textAlign: 'right', width: 80 }}>Key (days)</th>
                <th style={{ ...TH, textAlign: 'right', width: 80 }}>Std (days)</th>
              </tr>
            </thead>
            <tbody>
              {unzoned.map(tour => (
                <TourRow key={tour.id} route={tour} reps={reps} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const zonePills: [string, number, string, string][] = [
    ['N', northReps,   '#EFF6FF', '#1D4ED8'],
    ['C', centralReps, '#F5F3FF', '#6D28D9'],
    ['W', westReps,    '#FFF7ED', '#C2410C'],
    ['S', southReps,   '#F0FDF4', '#065F46'],
    ['E', exportReps,  '#FDF4FF', '#7E22CE'],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Reps & Tours']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Reps &amp; Tours
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {totalReps} active rep{totalReps !== 1 ? 's' : ''} · {totalTours} tour{totalTours !== 1 ? 's' : ''}
            </div>
          </div>
          <Suspense fallback={<AddRepButton />}>
            <TabActionButton
              repsButton={<AddRepButton />}
              toursButton={<AddTourButton reps={reps} />}
            />
          </Suspense>
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {/* Card 1: Active Reps */}
          <div style={KPI_CARD}>
            <div style={KPI_LABEL}>Active Reps</div>
            <div style={KPI_NUMBER}>{totalReps}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {zonePills.map(([label, count, bg, color]) => (
                <span
                  key={label}
                  style={{
                    fontSize: 11, fontWeight: 600,
                    padding: '2px 7px', borderRadius: 10,
                    background: bg, color: color,
                  }}
                >
                  {label}: {count}
                </span>
              ))}
            </div>
          </div>

          {/* Card 2: Tours */}
          <div style={KPI_CARD}>
            <div style={KPI_LABEL}>Tours</div>
            <div style={KPI_NUMBER}>{totalTours}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {assignedTours} assigned
            </div>
            <div style={{ marginTop: 8, height: 4, background: 'var(--bg-sunk)', borderRadius: 2 }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${assignedPct}%`,
                background: assignedTours === totalTours ? 'var(--pos)' : 'var(--warn)',
              }} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
              {unassignedTours} tour{unassignedTours !== 1 ? 's' : ''} need a rep
            </div>
          </div>

          {/* Card 3: Client Coverage */}
          <div style={KPI_CARD}>
            <div style={KPI_LABEL}>Client Coverage</div>
            <div style={KPI_NUMBER}>{coveragePct}%</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {clientsWithRep} of {totalClients} clients have a rep
            </div>
            <div style={{ marginTop: 8, height: 4, background: 'var(--bg-sunk)', borderRadius: 2 }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${coveragePct}%`,
                background: '#0A3D8F',
              }} />
            </div>
            <div style={{
              fontSize: 10, marginTop: 3,
              color: clientsWithoutRep > 0 ? 'var(--warn)' : 'var(--fg-3)',
            }}>
              {clientsWithoutRep > 0
                ? `${clientsWithoutRep} clients unassigned`
                : 'All clients assigned'}
            </div>
          </div>

          {/* Card 4: Avg per Rep */}
          <div style={KPI_CARD}>
            <div style={KPI_LABEL}>Avg per Rep</div>
            <div style={KPI_NUMBER}>{avgPerRep}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              clients per active rep
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 8 }}>
              {totalClients} clients / {totalReps} reps
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Suspense fallback={null}>
          <RepsToursTabs
            repsCount={totalReps}
            toursCount={totalTours}
            repsContent={repsContent}
            toursContent={toursContent}
          />
        </Suspense>
      </div>
    </div>
  );
}

// -- Styles --

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden',
};
const PANEL_H: CSSProperties = {
  padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10,
};
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0A3D8F' };
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  background: 'var(--bg-elev)', whiteSpace: 'nowrap',
};

const KPI_CARD: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
  padding: 16, overflow: 'hidden',
};
const KPI_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#0A3D8F', textTransform: 'uppercase',
  letterSpacing: '0.1em',
};
const KPI_NUMBER: CSSProperties = {
  fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)',
  color: 'var(--fg)', margin: '6px 0 4px',
};
