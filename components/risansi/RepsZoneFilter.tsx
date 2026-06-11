'use client';

import { useState, type CSSProperties } from 'react';
import { RepRow, type RepData, ZONE_BG, ZONE_COLOR } from './RepRow';

const ZONES = ['North', 'Central', 'West', 'South', 'Export'];

const ZONE_LABELS: Record<string, string> = {
  North: 'N', Central: 'C', West: 'W', South: 'S', Export: 'E',
};

export function RepsZoneFilter({ reps }: { reps: RepData[] }) {
  const [activeZone, setActiveZone] = useState<string | null>(null);

  const filtered = activeZone ? reps.filter(r => r.zone === activeZone) : reps;

  return (
    <>
      {/* Zone filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
        <button
          onClick={() => setActiveZone(null)}
          style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            background: !activeZone ? '#0A3D8F' : 'var(--bg-elev)',
            color: !activeZone ? 'white' : 'var(--fg-3)',
          }}
        >
          All ({reps.length})
        </button>
        {ZONES.map(zone => {
          const count = reps.filter(r => r.zone === zone).length;
          const isActive = activeZone === zone;
          const bg = ZONE_BG[zone] ?? 'var(--bg-sunk)';
          const color = ZONE_COLOR[zone] ?? 'var(--fg-3)';
          return (
            <button
              key={zone}
              onClick={() => setActiveZone(isActive ? null : zone)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: isActive ? color : bg,
                color: isActive ? 'white' : color,
              }}
            >
              {ZONE_LABELS[zone]}: {count}
            </button>
          );
        })}
      </div>

      {/* Reps table */}
      <div style={PANEL}>
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                    {activeZone ? `No reps in ${activeZone} zone` : 'No reps yet'}
                  </td>
                </tr>
              ) : filtered.map(rep => <RepRow key={rep.id} rep={rep} />)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden',
};
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  background: 'var(--bg-elev)', whiteSpace: 'nowrap',
};
