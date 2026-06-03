'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { EditOppDrawer, type EditableOpp } from './EditOppDrawer';

const STAGE_COLORS: Record<string, string> = {
  Suspect:     '#6B7FA3',
  Prospect:    '#1A5CB8',
  Quoted:      '#D97706',
  Negotiating: '#F97316',
  Won:         '#0E9F6E',
  Lost:        '#9CA3AF',
};

export function ActiveOppsTable({ opps }: { opps: EditableOpp[] }) {
  const router = useRouter();
  const [selectedOpp, setSelectedOpp] = useState<EditableOpp | null>(null);

  if (opps.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
        No open opportunities
      </div>
    );
  }

  return (
    <>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elev)' }}>
              <th style={TH}>Client</th>
              <th style={TH}>Product</th>
              <th style={TH}>Stage</th>
              <th style={{ ...TH, textAlign: 'right' }}>Value</th>
              <th style={{ ...TH, textAlign: 'center' }}>Prob</th>
              <th style={TH}>ETA</th>
              <th style={TH}>Rep</th>
            </tr>
          </thead>
          <tbody>
            {opps.map(opp => {
              const stageColor = STAGE_COLORS[opp.stage] ?? '#6B7FA3';
              return (
                <tr
                  key={opp.id}
                  onClick={() => setSelectedOpp(opp)}
                  style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={TD}>
                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 12 }}>{opp.client_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{opp.client_code}</div>
                  </td>
                  <td style={TD}>
                    <div style={{ color: 'var(--fg)' }}>{opp.product}</div>
                    {opp.product_type && (
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{opp.product_type}</div>
                    )}
                    {opp.auto_created && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                        background: '#EBF1FB', color: '#1A5CB8', textTransform: 'uppercase',
                        letterSpacing: '0.05em', display: 'inline-block', marginTop: 2,
                      }}>
                        ⚡ Auto
                      </span>
                    )}
                  </td>
                  <td style={TD}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}40`,
                    }}>
                      {opp.stage}
                    </span>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#0A3D8F', whiteSpace: 'nowrap' }}>
                    {opp.value_cr ? `₹${(opp.value_cr * 100).toFixed(1)}L` : '—'}
                  </td>
                  <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
                    {opp.probability != null ? `${opp.probability}%` : '—'}
                  </td>
                  <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {opp.eta_text || '—'}
                  </td>
                  <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>
                    {opp.rep_name || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
