import type { CSSProperties } from 'react';
import { Topbar } from '@/components/risansi';
import { CoverageMapSvg, type ClientPin } from '@/components/risansi/CoverageMapSvg';
import risansiPool from '@/lib/db-risansi';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Types ──────────────────────────────────────────────────────

interface TourRow {
  tour:         string;
  client_count: number;
  compliant:    number;
  overdue:      number;
}

// ── Page ───────────────────────────────────────────────────────

export default async function CoverageMapPage() {
  const [clients, tours] = await Promise.all([

    // All active clients with location + visit data
    q<ClientPin[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; code: string; legal_name: string; industry: string | null;
        state: string | null; city: string | null;
        status: string; tier: string | null;
        last_visit_date: string | null;
        days_since: string | null;
        rep_name: string;
      }>(
        `SELECT
           c.id, c.code, c.legal_name, c.industry,
           c.state, c.city,
           c.status, c.tier, c.last_visit_date::text,
           (CURRENT_DATE - c.last_visit_date::date)::text AS days_since,
           COALESCE(r.name, c.primary_rep_name, '—') AS rep_name
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'
         ORDER BY c.last_visit_date ASC NULLS FIRST`,
      );
      return rows.map(r => ({
        id:              r.id,
        code:            r.code,
        legal_name:      r.legal_name,
        industry:        r.industry,
        state:           r.state,
        city:            r.city,
        tier:            r.tier,
        last_visit_date: r.last_visit_date,
        days_since:      r.days_since != null ? Number(r.days_since) : null,
        rep_name:        r.rep_name,
      }));
    }, []),

    // Tour route summary
    q<TourRow[]>(async () => {
      const { rows } = await risansiPool.query<{
        tour: string; client_count: string; compliant: string; overdue: string;
      }>(
        `SELECT
           COALESCE(tour_name, 'Unassigned') AS tour,
           COUNT(*)::text AS client_count,
           COUNT(*) FILTER (WHERE last_visit_date >= NOW() - INTERVAL '100 days')::text AS compliant,
           COUNT(*) FILTER (
             WHERE last_visit_date < NOW() - INTERVAL '100 days'
               OR last_visit_date IS NULL
           )::text AS overdue
         FROM clients
         WHERE deleted_at IS NULL AND status = 'ACTIVE'
         GROUP BY tour_name
         ORDER BY COUNT(*) DESC`,
      );
      return rows.map(r => ({
        tour:         r.tour,
        client_count: Number(r.client_count),
        compliant:    Number(r.compliant),
        overdue:      Number(r.overdue),
      }));
    }, []),
  ]);

  // ── Derived stats ─────────────────────────────────────────────

  const total     = clients.length;
  const compliant = clients.filter(c => c.days_since != null && c.days_since <= 100).length;
  const dueSoon   = clients.filter(c => c.days_since != null && c.days_since > 100 && c.days_since <= 150).length;
  const overdue   = clients.filter(c => c.days_since == null || c.days_since > 150).length;

  const unassigned = tours.find(t => t.tour === 'Unassigned')?.client_count ?? 0;
  const sortedTours = [...tours].sort((a, b) => b.overdue - a.overdue);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Visit Plan', 'Coverage Map']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Coverage Map
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {total} active clients · Field visit compliance overview
          </div>
        </div>

        {/* ── A. Stats strip ─────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <StatChip label="Total Active"      value={total}     />
          <StatChip label="Compliant"         value={compliant} sublabel="< 100 days"        color="#0E9F6E" />
          <StatChip label="Due Soon"          value={dueSoon}   sublabel="100 – 150 days"    color="#D97706" />
          <StatChip label="Overdue / Never"   value={overdue}   sublabel="> 150 days or null" color="#E02424" />
        </div>

        {/* ── B. Map ─────────────────────────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>India · Client Coverage</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {total} active accounts · hover for details
            </span>
          </div>
          <div style={{ padding: '16px 24px 8px' }}>
            <CoverageMapSvg clients={clients} />
          </div>
        </div>

        {/* ── C. Route summary table ──────────────────────────── */}
        <div style={{ ...PANEL, marginTop: 14 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Route Summary</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {tours.length} tour routes · sorted by overdue
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {sortedTours.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                No tour route data
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Tour Route', 'Clients', 'Compliant', 'Overdue', 'Coverage %'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTours.map((t, i) => {
                    const pct = t.client_count > 0 ? (t.compliant / t.client_count) * 100 : 0;
                    const barColor = pct >= 80 ? '#0E9F6E' : pct >= 50 ? '#D97706' : '#E02424';
                    return (
                      <tr key={t.tour} style={{ borderBottom: i < sortedTours.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td style={{ ...TD, fontWeight: t.tour === 'Unassigned' ? 400 : 500, color: t.tour === 'Unassigned' ? 'var(--fg-3)' : 'var(--fg)' }}>
                          {t.tour}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                          {t.client_count}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#0E9F6E', fontWeight: 500 }}>
                          {t.compliant}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: t.overdue > 0 ? '#E02424' : 'var(--fg-3)', fontWeight: t.overdue > 0 ? 600 : 400 }}>
                          {t.overdue}
                        </td>
                        <td style={{ ...TD, minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 5, background: '#DDE6F5', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', minWidth: 34, textAlign: 'right' }}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {unassigned > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-3)' }}>
              {unassigned} client{unassigned !== 1 ? 's have' : ' has'} no tour route assigned.{' '}
              <a href="/risansi/clients?status=ACTIVE" style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>
                View in Clients →
              </a>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function StatChip({
  label, value, sublabel, color = '#0A3D8F',
}: {
  label: string; value: number; sublabel?: string; color?: string;
}) {
  return (
    <div style={{
      background:   '#fff',
      border:       '1px solid var(--line)',
      borderLeft:   `3px solid ${color}`,
      borderRadius: 6,
      padding:      '10px 16px',
      minWidth:     120,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7FA3', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
        {value.toLocaleString('en-IN')}
      </div>
      {sublabel && (
        <div style={{ fontSize: 10, color: '#8BA3C7', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background:   'var(--bg-paper)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  overflow:     'hidden',
};

const PANEL_H: CSSProperties = {
  padding:      '12px 16px',
  borderBottom: '1px solid var(--line)',
  display:      'flex',
  alignItems:   'center',
  gap:          10,
};

const PANEL_TITLE: CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         '#0A3D8F',
};

const TH: CSSProperties = {
  padding:       '9px 12px',
  textAlign:     'left',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    600,
  color:         '#6B7FA3',
  background:    '#EBF1FB',
  borderBottom:  '2px solid #DDE6F5',
  whiteSpace:    'nowrap',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};
