'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { EditOppDrawer, type EditableOpp } from './EditOppDrawer';
import { fmtUsdFromCr } from '@/lib/risansi-utils';

const STAGE_COLORS: Record<string, string> = {
  Suspect:     '#6B7FA3',
  Prospect:    '#1A5CB8',
  Quoted:      '#D97706',
  Negotiating: '#F97316',
  Won:         '#0E9F6E',
  Lost:        '#9CA3AF',
};

const STAGE_RANK: Record<string, number> = {
  Suspect: 0, Prospect: 1, Quoted: 2, Negotiating: 3, 'On Hold': 4, Won: 5, Lost: 6, Dropped: 7,
};

const PAGE_SIZE = 50;

type SortKey = 'quote_date' | 'client' | 'stage' | 'value' | 'eta';
const SORT_ACCESSOR: Record<SortKey, (o: EditableOpp) => string | number> = {
  quote_date: o => o.quote_date || '',
  client:     o => (o.client_name || '').toLowerCase(),
  stage:      o => STAGE_RANK[o.stage] ?? 99,
  value:      o => o.value_cr ?? 0,
  eta:        o => o.eta_text || '',
};
// Columns that default to descending on first click (most-useful-first).
const DESC_FIRST: Partial<Record<SortKey, boolean>> = { quote_date: true, value: true };

function compare(a: string | number, b: string | number, dir: 'asc' | 'desc'): number {
  const ea = a === '' || a == null;
  const eb = b === '' || b == null;
  if (ea && eb) return 0;
  if (ea) return 1;   // empties always sort last, regardless of direction
  if (eb) return -1;
  const r = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b));
  return dir === 'asc' ? r : -r;
}

export function ActiveOppsTable({ opps, usdRate }: { opps: EditableOpp[]; usdRate?: number }) {
  const router = useRouter();
  const [selectedOpp, setSelectedOpp] = useState<EditableOpp | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  if (opps.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
        No open opportunities
      </div>
    );
  }

  const sorted = sortKey
    ? [...opps].sort((a, b) => compare(SORT_ACCESSOR[sortKey](a), SORT_ACCESSOR[sortKey](b), sortDir))
    : opps;

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount - 1);
  const start     = safePage * PAGE_SIZE;
  const rows      = sorted.slice(start, start + PAGE_SIZE);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(DESC_FIRST[key] ? 'desc' : 'asc');
    }
    setPage(0);
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elev)' }}>
              <SortableTH label="Quote Date" onClick={() => onSort('quote_date')} indicator={arrow('quote_date')} />
              <SortableTH label="Client" onClick={() => onSort('client')} indicator={arrow('client')} />
              <SortableTH label="Stage" onClick={() => onSort('stage')} indicator={arrow('stage')} />
              <SortableTH label="Value" onClick={() => onSort('value')} indicator={arrow('value')} align="right" />
              <th style={TH}>Product &amp; Notes</th>
              <SortableTH label="Expected Close" onClick={() => onSort('eta')} indicator={arrow('eta')} />
            </tr>
          </thead>
          <tbody>
            {rows.map(opp => {
              const stageColor = STAGE_COLORS[opp.stage] ?? '#6B7FA3';
              return (
                <tr
                  key={opp.id}
                  onClick={() => setSelectedOpp(opp)}
                  style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td data-label="Quote Date" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                    {opp.quote_date || '—'}
                  </td>
                  <td data-label="Client" style={TD}>
                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 12 }}>{opp.client_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{opp.client_code}</div>
                  </td>
                  <td data-label="Stage" style={TD}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}40`,
                    }}>
                      {opp.stage}
                    </span>
                  </td>
                  <td data-label="Value" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#0A3D8F', whiteSpace: 'nowrap' }}>
                    {opp.value_cr ? `₹${(opp.value_cr * 100).toFixed(1)}L` : '—'}
                    {opp.value_cr && usdRate ? (
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--fg-3)', marginTop: 1 }}>
                        ≈ {fmtUsdFromCr(opp.value_cr, usdRate)}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Product & Notes" style={{ ...TD, maxWidth: 340 }}>
                    <div style={{ color: 'var(--fg)' }}>
                      {opp.product}{opp.product_type ? ` · ${opp.product_type}` : ''}
                      {opp.auto_created && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, marginLeft: 6,
                          background: '#EBF1FB', color: '#1A5CB8', textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>⚡ Auto</span>
                      )}
                    </div>
                    {opp.notes && (
                      <div style={{
                        fontSize: 10, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {opp.notes}
                      </div>
                    )}
                  </td>
                  <td data-label="Expected Close" style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {opp.eta_text || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 12px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--fg-3)',
      }}>
        <span>
          {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} of {sorted.length}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PageBtn label="‹ Prev" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
          <span style={{ fontFamily: 'var(--font-mono)', minWidth: 70, textAlign: 'center' }}>
            Page {safePage + 1} / {pageCount}
          </span>
          <PageBtn label="Next ›" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} />
        </div>
      </div>

      {selectedOpp && (
        <EditOppDrawer
          opp={selectedOpp}
          onClose={() => { setSelectedOpp(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function SortableTH({ label, onClick, indicator, align = 'left' }: {
  label: string; onClick: () => void; indicator: string; align?: 'left' | 'right';
}) {
  return (
    <th
      onClick={onClick}
      style={{ ...TH, textAlign: align, cursor: 'pointer', userSelect: 'none' }}
      title="Sort"
    >
      {label}<span style={{ color: 'var(--accent)' }}>{indicator}</span>
    </th>
  );
}

function PageBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: '5px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
        border: '1px solid var(--line-strong)',
        background: disabled ? 'var(--bg-elev)' : 'var(--bg-paper)',
        color: disabled ? 'var(--fg-3)' : 'var(--fg-2)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
