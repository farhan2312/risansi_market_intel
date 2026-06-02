'use client';

// ── Types ──────────────────────────────────────────────────────

export interface ClientPin {
  id:               string;
  code:             string;
  legal_name:       string;
  industry:         string | null;
  city:             string | null;
  state:            string | null;
  tier:             string | null;
  last_visit_date:  string | null;   // ISO date string
  days_since:       number | null;
  rep_name:         string;
}

// ── State → SVG coordinate mapping ────────────────────────────

const STATE_POSITIONS: Record<string, [number, number]> = {
  // North
  'Uttar Pradesh':      [340, 160],
  'Punjab':             [260, 110],
  'Haryana':            [275, 130],
  'Uttarakhand':        [320, 120],
  'Himachal Pradesh':   [295, 100],
  'Delhi':              [290, 145],
  'Rajasthan':          [220, 175],
  'Jammu and Kashmir':  [270, 85],

  // Central
  'Madhya Pradesh':     [300, 235],
  'Chhattisgarh':       [360, 265],
  'Jharkhand':          [400, 225],
  'Bihar':              [390, 185],

  // West
  'Maharashtra':        [250, 295],
  'Gujarat':            [195, 240],
  'Goa':                [215, 345],

  // South
  'Karnataka':          [240, 355],
  'Tamil Nadu':         [285, 415],
  'Kerala':             [250, 415],
  'Andhra Pradesh':     [320, 355],
  'Telangana':          [305, 320],

  // East
  'West Bengal':        [430, 215],
  'Odisha':             [400, 280],
  'Assam':              [470, 170],

  // Default
  'default':            [310, 250],
};

const DENSE_STATES = new Set([
  'Uttar Pradesh', 'Maharashtra', 'Madhya Pradesh',
  'Gujarat', 'Rajasthan', 'Karnataka',
]);

function getDotPosition(client: ClientPin): [number, number] {
  const state   = client.state ?? 'default';
  const base    = STATE_POSITIONS[state] ?? STATE_POSITIONS['default'];
  const spread  = DENSE_STATES.has(state) ? 60 : 40;
  const numId   = parseInt(client.id, 10) || 0;
  const seed_x  = ((numId * 7)  % (spread * 2)) - spread;
  const seed_y  = ((numId * 13) % (spread * 2)) - spread;
  return [
    Math.max(170, Math.min(510, base[0] + seed_x)),
    Math.max(60,  Math.min(460, base[1] + seed_y)),
  ];
}

function dotColor(client: ClientPin): string {
  if (client.days_since == null) return '#E02424';   // never visited
  if (client.days_since <= 100)  return '#0E9F6E';   // compliant
  if (client.days_since <= 180)  return '#D97706';   // due soon
  return '#E02424';                                  // overdue
}

// ── Component ──────────────────────────────────────────────────

const MAX_DOTS = 500;

export function CoverageMapSvg({ clients }: { clients: ClientPin[] }) {
  // Sample evenly when over limit
  const mapClients = clients.length > MAX_DOTS
    ? clients.filter((_: ClientPin, i: number) =>
        i % Math.ceil(clients.length / MAX_DOTS) === 0
      )
    : clients;

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
      {/* Size-capped SVG wrapper */}
      <div style={{ width: '100%', maxHeight: '480px', overflow: 'hidden' }}>
        <svg
          viewBox="0 0 700 520"
          style={{ width: '100%', height: 'auto', maxHeight: '480px', display: 'block' }}
        >
          {/* India outline — abstract shape */}
          <path
            d="
              M 280 60
              L 320 55 L 370 65 L 410 80
              L 450 100 L 480 130 L 500 160
              L 510 190 L 505 220 L 495 250
              L 490 270 L 475 290 L 460 310
              L 440 330 L 420 350 L 400 370
              L 375 390 L 355 410 L 340 430
              L 330 450 L 320 460
              L 310 450 L 300 435
              L 280 410 L 260 385
              L 240 360 L 220 335
              L 200 305 L 185 275
              L 175 245 L 170 215
              L 168 185 L 172 155
              L 182 125 L 200 100
              L 225 78 L 255 65
              Z
            "
            fill="rgba(10,61,143,0.04)"
            stroke="rgba(10,61,143,0.20)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Zone labels */}
          <text x="320" y="100" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">NORTH</text>
          <text x="195" y="255" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">WEST</text>
          <text x="335" y="230" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">CENTRAL</text>
          <text x="295" y="445" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">SOUTH</text>
          <text x="440" y="210" fontSize="9" fill="rgba(107,127,150,0.65)" fontFamily="var(--font-mono)" textAnchor="middle">EAST</text>

          {/* Client dots */}
          {mapClients.map((client) => {
            const [cx, cy] = getDotPosition(client);
            const color    = dotColor(client);
            const r        = (client.tier === 'Key' || client.tier === 'A') ? 4 : 2.5;
            return (
              <circle
                key={client.id}
                cx={cx} cy={cy} r={r}
                fill={color}
                opacity={0.75}
                style={{ cursor: 'default' }}
              >
                <title>{client.legal_name} · {client.state}</title>
              </circle>
            );
          })}

          {/* Legend — bottom-left */}
          <g transform="translate(24, 482)">
            <circle cx="5"   cy="5" r="4" fill="#0E9F6E" opacity="0.85"/>
            <text x="14"  y="9" fontSize="9" fill="#6B7FA3" fontFamily="var(--font-mono)">Compliant (&lt;100d)</text>
            <circle cx="115"  cy="5" r="4" fill="#D97706" opacity="0.85"/>
            <text x="124" y="9" fontSize="9" fill="#6B7FA3" fontFamily="var(--font-mono)">Due Soon (100–180d)</text>
            <circle cx="238"  cy="5" r="4" fill="#E02424" opacity="0.85"/>
            <text x="247" y="9" fontSize="9" fill="#6B7FA3" fontFamily="var(--font-mono)">Overdue / Never</text>
          </g>
        </svg>
      </div>

      {/* Sample note */}
      {clients.length > MAX_DOTS && (
        <div style={{
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--fg-3)',
          marginTop: 4,
        }}>
          Showing {MAX_DOTS} of {clients.length} clients
        </div>
      )}
    </div>
  );
}
