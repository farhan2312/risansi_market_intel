import type { CSSProperties } from 'react';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { RevenueUploadClient } from './RevenueUploadClient';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

interface HistoryRow {
  code:        string;
  legal_name:  string;
  industry:    string | null;
  state:       string | null;
  month:       string;
  pump_value:  number;
  spare_value: number;
  total_value: number;
  entered_by:  string | null;
  entered_at:  string | null;
}

function fmtInr(n: number) {
  if (n === 0) return '—';
  if (n >= 1e7) return `₹${(n/1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n/1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default async function RevenueAdminPage() {
  const [history, clientCodes] = await Promise.all([
    q<HistoryRow[]>(async () => {
      const { rows } = await risansiPool.query<HistoryRow>(
        `SELECT
           c.code, c.legal_name, c.industry, c.state,
           to_char(crm.month, 'Mon-YYYY') AS month,
           crm.pump_value::float  AS pump_value,
           crm.spare_value::float AS spare_value,
           crm.total_value::float AS total_value,
           crm.entered_by,
           crm.entered_at::text   AS entered_at
         FROM client_revenue_monthly crm
         JOIN clients c ON crm.client_id = c.id
         ORDER BY crm.month DESC, crm.total_value DESC
         LIMIT 200`,
      );
      return rows;
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ code: string }>(
        `SELECT UPPER(code) AS code FROM clients WHERE deleted_at IS NULL`,
      );
      return rows.map(r => r.code);
    }, []),
  ]);

  const existingCodes = new Set(clientCodes);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Revenue Upload']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Revenue Upload
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Upload monthly revenue data from Excel · {history.length} entries in history
          </div>
        </div>

        {/* ── Upload section ────────────────────────────────────── */}
        <div style={{ ...PANEL, marginBottom: 24 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Upload Revenue Data</span>
          </div>
          <div style={{ padding: 20 }}>
            <RevenueUploadClient existingCodes={existingCodes} />
          </div>
        </div>

        {/* ── History section ───────────────────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Upload History</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              last 200 entries
            </span>
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
              No revenue data uploaded yet
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Month', 'Client', 'Industry', 'State', 'Pump ₹', 'Spare ₹', 'Total ₹', 'Entered By'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {row.month}
                      </td>
                      <td style={{ ...TD, minWidth: 160 }}>
                        <div style={{ fontWeight: 500 }}>{row.legal_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                          {row.code}
                        </div>
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.industry ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.state ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtInr(row.pump_value)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtInr(row.spare_value)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtInr(row.total_value)}</td>
                      <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                        {row.entered_by ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};
const PANEL_H: CSSProperties = {
  padding: '12px 16px', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', gap: 10,
};
const PANEL_TITLE: CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#0A3D8F',
};
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  background: 'var(--bg-elev)',
};
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
