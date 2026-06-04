'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { formatRev } from '@/lib/risansi-utils';

export interface RevenueClientRow {
  id:         string;
  code:       string;
  legal_name: string;
  industry:   string | null;
  state:      string | null;
  tier:       string | null;
  rep_name:   string;
  pump:       number;
  spare:      number;
  total:      number;
  prev_total: number;
}

type SortKey = 'total' | 'pump' | 'spare' | 'vsly';
const PAGE = 20;

export function RevenueTopClients({ clients }: { clients: RevenueClientRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sort, setSort]     = useState<SortKey>('total');
  const [limit, setLimit]   = useState(PAGE);

  const vsly = (c: RevenueClientRow) => (c.prev_total > 0 ? (c.total - c.prev_total) / c.prev_total : -Infinity);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? clients.filter(c => c.legal_name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q))
      : clients;
    const sorted = [...rows].sort((a, b) => {
      if (sort === 'vsly') return vsly(b) - vsly(a);
      return (b[sort] as number) - (a[sort] as number);
    });
    return sorted;
  }, [clients, search, sort]);

  const shown = filtered.slice(0, limit);

  const th = (key: SortKey, label: string): CSSProperties => ({
    ...TH, cursor: 'pointer', color: sort === key ? 'var(--accent)' : 'var(--fg-3)', textAlign: 'right',
  });

  return (
    <div style={PANEL}>
      <div style={{ ...PANEL_H, justifyContent: 'space-between' }}>
        <span style={PANEL_TITLE}>Top Clients · Revenue</span>
        <input
          type="text"
          placeholder="Search name or code…"
          value={search}
          onChange={e => { setSearch(e.target.value); setLimit(PAGE); }}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line-strong)', fontSize: 12, minWidth: 220, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)', outline: 'none' }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          No clients match {search ? `"${search}"` : 'the current filters'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  <th style={{ ...TH, width: 44 }}>#</th>
                  <th style={TH}>Client</th>
                  <th style={TH}>Industry</th>
                  <th style={TH}>State</th>
                  <th style={TH}>Rep</th>
                  <th style={th('pump', 'Pump')}  onClick={() => setSort('pump')}>Pump{sort === 'pump' ? ' ↓' : ''}</th>
                  <th style={th('spare', 'Spare')} onClick={() => setSort('spare')}>Spare{sort === 'spare' ? ' ↓' : ''}</th>
                  <th style={th('total', 'Total')} onClick={() => setSort('total')}>Total{sort === 'total' ? ' ↓' : ''}</th>
                  <th style={th('vsly', 'vs LY')}  onClick={() => setSort('vsly')}>vs LY{sort === 'vsly' ? ' ↓' : ''}</th>
                  <th style={TH}>Tier</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => {
                  const hasPrev = c.prev_total > 0;
                  const pct = hasPrev ? ((c.total - c.prev_total) / c.prev_total) * 100 : 0;
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/risansi/clients/${c.id}`)}
                      style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{medal ?? i + 1}</td>
                      <td style={{ ...TD, minWidth: 180 }}>
                        <div style={{ fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</div>
                        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', marginTop: 1 }}>{c.code}</div>
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-2)' }}>{c.industry ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{c.state ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{c.rep_name}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.pump > 0 ? formatRev(c.pump) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.spare > 0 ? formatRev(c.spare) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatRev(c.total)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: !hasPrev ? 'var(--fg-3)' : pct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {!hasPrev ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`}
                      </td>
                      <td style={TD}>
                        {c.tier && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                            background: c.tier === 'Key' ? 'rgba(10,61,143,0.10)' : 'var(--bg-sunk)',
                            color: c.tier === 'Key' ? '#0A3D8F' : 'var(--fg-3)',
                          }}>
                            {c.tier}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {shown.length} of {filtered.length}
            </span>
            {limit < filtered.length && (
              <button
                onClick={() => setLimit(l => l + PAGE)}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: 'var(--bg-elev)', color: 'var(--accent)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer' }}
              >
                Load more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
