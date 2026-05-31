'use client';

import { useState } from 'react';

// ── Types ──────────────────────────────────────────────────────

export interface ClientPin {
  id:               string;
  code:             string;
  legal_name:       string;
  industry:         string | null;
  city:             string | null;
  state:            string | null;
  lat:              number | null;
  lng:              number | null;
  tier:             string | null;
  last_visit_date:  string | null;   // ISO date string
  days_since:       number | null;
  ril_pcp_count:    number | null;
  rep_name:         string;
}

interface TooltipState {
  client: ClientPin;
  x: number;
  y: number;
}

// ── State → SVG coordinate mapping ────────────────────────────

const STATE_POS: Record<string, [number, number]> = {
  'Maharashtra':      [220, 280],
  'Karnataka':        [200, 340],
  'Uttar Pradesh':    [320, 180],
  'Madhya Pradesh':   [290, 230],
  'Gujarat':          [160, 240],
  'Tamil Nadu':       [230, 390],
  'Punjab':           [270, 130],
  'Haryana':          [280, 150],
  'Andhra Pradesh':   [280, 340],
  'Telangana':        [270, 320],
  'Rajasthan':        [210, 190],
  'Bihar':            [370, 190],
  'West Bengal':      [420, 220],
  'Odisha':           [380, 260],
  'Chhattisgarh':     [340, 260],
};

/** Deterministic ±15px jitter so dots don't all stack on the same point */
function jitter(seed: number): number {
  return (seed % 30) - 15;
}

function getPos(client: ClientPin, index: number): [number, number] {
  if (client.lat != null && client.lng != null) {
    // Real coordinates — India bounds: lat 8–37°N, lng 68–97°E → SVG 700×580
    const x = ((client.lng - 68) / (97 - 68)) * 560 + 70;
    const y = ((37 - client.lat) / (37 - 8)) * 460 + 60;
    return [x, y];
  }
  const base = STATE_POS[client.state ?? ''] ?? [300, 250];
  return [
    base[0] + jitter(index * 7 + 3),
    base[1] + jitter(index * 13 + 5),
  ];
}

function dotColor(client: ClientPin): string {
  if (client.days_since == null) return '#E02424';           // never visited
  if (client.days_since <= 100)  return '#0E9F6E';           // compliant
  if (client.days_since <= 180)  return '#D97706';           // due soon
  return '#E02424';                                          // overdue
}

function complianceLabel(client: ClientPin): { text: string; color: string } {
  if (client.days_since == null) return { text: '● Never',    color: '#E02424' };
  if (client.days_since <= 100)  return { text: '● Compliant', color: '#0E9F6E' };
  if (client.days_since <= 180)  return { text: '● Due Soon',  color: '#D97706' };
  return { text: '● Overdue',   color: '#E02424' };
}

// ── Component ──────────────────────────────────────────────────

export function CoverageMapSvg({ clients }: { clients: ClientPin[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
      <svg
        width="100%"
        viewBox="0 0 700 580"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        {/* India outline — abstract path from design reference */}
        <path
          d="M120 80 L180 60 L250 50 L320 60 L380 80 L440 110 L480 160 L500 220 L470 280 L420 320 L360 340 L290 350 L220 340 L160 310 L110 270 L80 220 L70 160 Z"
          fill="rgba(10,61,143,0.04)"
          stroke="rgba(10,61,143,0.15)"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />

        {/* Zone labels */}
        <text x="310" y="118" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">NORTH</text>
        <text x="128" y="262" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">WEST</text>
        <text x="285" y="208" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">CENTRAL</text>
        <text x="218" y="412" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">SOUTH</text>
        <text x="422" y="242" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">EAST</text>

        {/* Client dots */}
        {clients.map((client, i) => {
          const [cx, cy] = getPos(client, i);
          const color    = dotColor(client);
          // Key / A-tier → r=6, otherwise r=4
          const r = (client.tier === 'Key' || client.tier === 'A') ? 6 : 4;
          return (
            <circle
              key={client.id}
              cx={cx} cy={cy} r={r}
              fill={color}
              opacity={0.85}
              style={{ cursor: 'pointer', transition: 'r 0.1s' }}
              onMouseEnter={e => {
                const svg = e.currentTarget.closest('svg') as SVGSVGElement | null;
                const rect = svg?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({ client, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}

        {/* Legend — bottom-left */}
        <g transform="translate(24, 536)">
          <circle cx="5"   cy="5" r="4.5" fill="#0E9F6E" opacity="0.85"/>
          <text x="14"  y="9" fontSize="9" fill="#6B7FA3" fontFamily="var(--font-mono)">Compliant (&lt;100d)</text>
          <circle cx="115"  cy="5" r="4.5" fill="#D97706" opacity="0.85"/>
          <text x="124" y="9" fontSize="9" fill="#6B7FA3" fontFamily="var(--font-mono)">Due Soon (100–180d)</text>
          <circle cx="238"  cy="5" r="4.5" fill="#E02424" opacity="0.85"/>
          <text x="247" y="9" fontSize="9" fill="#6B7FA3" fontFamily="var(--font-mono)">Overdue / Never</text>
        </g>
      </svg>

      {/* Tooltip — positioned relative to SVG container */}
      {tooltip && (
        <div
          style={{
            position:     'absolute',
            left:         tooltip.x + 14,
            top:          tooltip.y - 10,
            background:   '#ffffff',
            border:       '1px solid #DDE6F5',
            borderRadius: 6,
            padding:      '10px 12px',
            fontSize:     11,
            boxShadow:    '0 4px 20px rgba(10,22,40,0.13)',
            minWidth:     180,
            maxWidth:     240,
            zIndex:       20,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 12, color: '#0D1B2A' }}>
            {tooltip.client.legal_name}
          </div>
          <div style={{ color: '#6B7FA3', fontSize: 10, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            {tooltip.client.code}
            {tooltip.client.industry ? ` · ${tooltip.client.industry}` : ''}
          </div>
          {(tooltip.client.city || tooltip.client.state) && (
            <div style={{ color: '#6B7FA3', fontSize: 10, marginTop: 1 }}>
              {[tooltip.client.city, tooltip.client.state].filter(Boolean).join(', ')}
            </div>
          )}
          <div style={{ marginTop: 7, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <span style={{ color: '#2D3E55' }}>
              Last:{' '}
              {tooltip.client.days_since != null
                ? `${tooltip.client.days_since}d ago`
                : 'Never'}
            </span>
            <span style={{ color: complianceLabel(tooltip.client).color, fontWeight: 500 }}>
              {complianceLabel(tooltip.client).text}
            </span>
          </div>
          {tooltip.client.rep_name && tooltip.client.rep_name !== '—' && (
            <div style={{ marginTop: 4, fontSize: 10, color: '#6B7FA3' }}>
              Rep: {tooltip.client.rep_name}
            </div>
          )}
          {(tooltip.client.ril_pcp_count ?? 0) > 0 && (
            <div style={{ marginTop: 2, fontSize: 10, color: '#6B7FA3' }}>
              RIL PCP: {tooltip.client.ril_pcp_count}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
