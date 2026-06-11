import type { CSSProperties } from 'react';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { RepRow, type RepData } from '@/components/risansi/RepRow';
import { TourRow, type TourData } from '@/components/risansi/TourRow';
import { AddRepButton } from '@/components/risansi/AddRepButton';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface ZoneStat {
  zone: string;
  rep_count: string;
  client_count: string;
  compliant_clients: string;
}

const ZONES = ['North', 'Central', 'West', 'South', 'Export'];

export default async function RepsAdminPage() {
  const [reps, routes, stats] = await Promise.all([
    q<RepData[]>(async () => {
      const { rows } = await risansiPool.query<RepData>(`
        SELECT
          r.*,
          COUNT(DISTINCT c.id)::text AS client_count,
          COUNT(DISTINCT v.id) FILTER (WHERE v.visit_date >= CURRENT_DATE - INTERVAL '30 days')::text AS visits_last_30d,
          MAX(v.visit_date)::text AS last_visit_date
        FROM reps r
        LEFT JOIN clients c ON c.primary_rep_id = r.id AND c.deleted_at IS NULL AND c.status = 'ACTIVE'
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
        LEFT JOIN reps r ON tr.primary_rep_id = r.id
        LEFT JOIN clients c ON c.tour_name = tr.name
          AND c.deleted_at IS NULL
        GROUP BY tr.id, tr.name, tr.zone,
          tr.primary_rep_id, tr.visit_freq_key_days,
          tr.visit_freq_std_days, tr.alert_key_days,
          tr.alert_std_days, r.name
        ORDER BY tr.zone ASC NULLS LAST, tr.name ASC
      `);
      console.log('Tours fetched:', rows.length);
      return rows;
    }, []),

    q<ZoneStat[]>(async () => {
      const { rows } = await risansiPool.query<ZoneStat>(`
        SELECT
          COALESCE(r.zone, 'Unassigned') AS zone,
          COUNT(DISTINCT r.id)::text AS rep_count,
          COUNT(DISTINCT c.id)::text AS client_count,
          COUNT(DISTINCT c.id) FILTER (WHERE c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS compliant_clients
        FROM reps r
        LEFT JOIN clients c ON c.primary_rep_id = r.id AND c.deleted_at IS NULL AND c.status = 'ACTIVE'
        WHERE r.is_active = TRUE
        GROUP BY r.zone
        ORDER BY r.zone ASC
      `);
      return rows;
    }, []),
  ]);

  const activeReps = reps.filter(r => r.is_active).length;

  const toursByZone = ZONES.reduce((acc, zone) => {
    acc[zone] = routes.filter(r => r.zone === zone);
    return acc;
  }, {} as Record<string, TourData[]>);

  const unzoned = routes.filter(r => !r.zone);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Reps & Tours']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Reps &amp; Tours
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {activeReps} active rep{activeReps !== 1 ? 's' : ''} · {routes.length} tour{routes.length !== 1 ? 's' : ''}
            </div>
          </div>
          <AddRepButton />
        </div>

        {/* Zone summary strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
          {ZONES.map(zone => {
            const z = stats.find(s => s.zone === zone);
            const repCount    = Number(z?.rep_count ?? 0);
            const clientCount = Number(z?.client_count ?? 0);
            const compliant   = Number(z?.compliant_clients ?? 0);
            const tourCount   = toursByZone[zone]?.length ?? 0;
            const pct = clientCount > 0 ? Math.round((compliant / clientCount) * 100) : 0;
            return (
              <div key={zone} style={PANEL_PAD}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  {zone}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--fg)', marginBottom: 4 }}>
                  {repCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {tourCount} tour{tourCount !== 1 ? 's' : ''} · {clientCount} clients
                </div>
                <div style={{ marginTop: 8, height: 4, background: 'var(--bg-sunk)', borderRadius: 2 }}>
                  <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: pct >= 70 ? 'var(--pos)' : pct >= 40 ? 'var(--warn)' : 'var(--neg)' }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>{pct}% compliant</div>
              </div>
            );
          })}
        </div>

        {/* Reps table */}
        <div style={{ ...PANEL, marginBottom: 20 }}>
          <div style={{ ...PANEL_H, justifyContent: 'space-between' }}>
            <span style={PANEL_TITLE}>Reps</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  <th style={TH}>Name</th>
                  <th style={TH}>Zone</th>
                  <th style={TH}>Tour</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Clients</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Visits (30d)</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Target</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Status</th>
                  <th style={TH} />
                </tr>
              </thead>
              <tbody>
                {reps.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>No reps yet</td></tr>
                ) : reps.map(rep => <RepRow key={rep.id} rep={rep} />)}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tours grouped by zone */}
        {ZONES.map(zone => {
          const zoneTours = toursByZone[zone] ?? [];
          if (zoneTours.length === 0) return null;
          return (
            <div key={zone} className="panel" style={{ ...PANEL, marginBottom: 16 }}>
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
                    <th style={{ ...TH, textAlign: 'center' }}>Key Visit (days)</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Std Visit (days)</th>
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

        {/* Unzoned tours */}
        {unzoned.length > 0 && (
          <div className="panel" style={{ ...PANEL, marginBottom: 16 }}>
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
                  <th style={{ ...TH, textAlign: 'center' }}>Key Visit (days)</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Std Visit (days)</th>
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
      </div>
    </div>
  );
}

// -- Styles --

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden',
};
const PANEL_PAD: CSSProperties = { ...PANEL, padding: '12px 16px' };
const PANEL_H: CSSProperties = {
  padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10,
};
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0A3D8F' };
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  background: 'var(--bg-elev)', whiteSpace: 'nowrap',
};
