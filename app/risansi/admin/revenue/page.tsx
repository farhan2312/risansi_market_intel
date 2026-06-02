import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { RevenueUploadBox } from '@/components/risansi/RevenueUploadBox';
import { DeleteUploadButton } from '@/components/risansi/DeleteUploadButton';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    console.error('[revenue/page] query error:', err);
    return fallback;
  }
}

function fmtMonth(raw: unknown): string {
  if (!raw) return '—';
  try {
    return new Date(String(raw)).toLocaleDateString('en-IN', {
      month: 'short', year: 'numeric',
    });
  } catch {
    return String(raw);
  }
}

function fmtInr(n: number) {
  if (!n || n === 0) return '—';
  return n.toLocaleString('en-IN');
}

// ── Types ──────────────────────────────────────────────────────

interface RevenueRow {
  id:          string;
  month:       string;
  pump_value:  number;
  spare_value: number;
  total_value: number;
  entered_by:  string | null;
  entered_at:  string | null;
  code:        string;
  legal_name:  string;
  industry:    string | null;
  state:       string | null;
}

interface LogRow {
  id:            number;
  uploaded_by:   string;
  filename:      string;
  month:         string | null;
  rows_total:    number;
  rows_inserted: number;
  rows_updated:  number;
  rows_skipped:  number;
  skipped_codes: string[] | null;
  status:        string;
  uploaded_at:   string;
}

// ── Page ──────────────────────────────────────────────────────

export default async function RevenueAdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/risansi');

  const [revenueHistory, uploadLog] = await Promise.all([

    q<RevenueRow[]>(async () => {
      const { rows } = await risansiPool.query<RevenueRow>(
        `SELECT
           crm.id::text,
           crm.month::text,
           crm.pump_value::float  AS pump_value,
           crm.spare_value::float AS spare_value,
           crm.total_value::float AS total_value,
           crm.entered_by,
           crm.entered_at::text   AS entered_at,
           c.code,
           c.legal_name,
           c.industry,
           c.state
         FROM client_revenue_monthly crm
         JOIN clients c ON crm.client_id = c.id
         ORDER BY crm.month DESC, crm.total_value DESC
         LIMIT 100`,
      );
      return rows;
    }, []),

    q<LogRow[]>(async () => {
      const { rows } = await risansiPool.query<LogRow>(
        `SELECT *
         FROM revenue_upload_log
         ORDER BY uploaded_at DESC
         LIMIT 20`,
      );
      return rows;
    }, []),
  ]);

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
            Upload monthly revenue data from Excel
          </div>
        </div>

        {/* ── Section 1: Template Download ─────────────────────── */}
        <div style={{ ...PANEL, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>
                Revenue Upload Template
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                Download the template, fill in revenue data, then upload below. One file per month.
              </div>
              <div style={{
                marginTop: 10, fontSize: 12, color: 'var(--fg-3)',
                fontFamily: 'var(--font-mono)',
                background: 'var(--bg-elev)', padding: '8px 12px',
                borderRadius: 6, display: 'inline-block', lineHeight: 1.8,
              }}>
                Columns: Client Code | Client Name | Month | Pump Value | Spare Value
                <br />
                Month format: May-2026 · Values in ₹ INR · No commas or symbols
              </div>
            </div>
            <a
              href="/revenue_upload_template.xlsx"
              download
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', background: '#0A3D8F', color: 'white',
                borderRadius: 7, textDecoration: 'none',
                fontSize: 13, fontWeight: 500,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ⬇ Download Template
            </a>
          </div>
        </div>

        {/* ── Section 2: Upload Box (client island) ────────────── */}
        <RevenueUploadBox />

        {/* ── Section 3: Upload History Log ────────────────────── */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Upload History</span>
          </div>

          {uploadLog.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
              No uploads yet
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <th style={TH}>Date &amp; Time</th>
                    <th style={TH}>File</th>
                    <th style={TH}>Month</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Rows</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Inserted</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Updated</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Skipped</th>
                    <th style={TH}>Status</th>
                    <th style={TH}>Uploaded By</th>
                    <th style={TH}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadLog.map((log, i) => (
                    <tr key={log.id} style={{
                      borderBottom: i < uploadLog.length - 1 ? '1px solid var(--line)' : 'none',
                    }}>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(log.uploaded_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.filename}
                      </td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {fmtMonth(log.month)}
                      </td>
                      <td style={{ ...TD, textAlign: 'center' }}>{log.rows_total}</td>
                      <td style={{ ...TD, textAlign: 'center', color: '#065F46', fontWeight: 600 }}>
                        {log.rows_inserted}
                      </td>
                      <td style={{ ...TD, textAlign: 'center', color: '#1E40AF' }}>
                        {log.rows_updated}
                      </td>
                      <td style={{ ...TD, textAlign: 'center', color: log.rows_skipped > 0 ? '#9B1C1C' : 'var(--fg-3)' }}>
                        {log.rows_skipped}
                        {(log.skipped_codes?.length ?? 0) > 0 && (
                          <span title={(log.skipped_codes ?? []).join(', ')} style={{ cursor: 'help' }}> ⓘ</span>
                        )}
                      </td>
                      <td style={TD}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10,
                          fontSize: 11, fontWeight: 600,
                          background: log.status === 'success' ? '#D1FAE5' :
                                      log.status === 'partial' ? '#FEF3C7' : '#FDE8E8',
                          color: log.status === 'success' ? '#065F46' :
                                 log.status === 'partial' ? '#92400E' : '#9B1C1C',
                        }}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>
                        {log.uploaded_by}
                      </td>
                      <td style={TD}>
                        <DeleteUploadButton logId={log.id} month={log.month ?? ''} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 4: Revenue Data Table ────────────────────── */}
        <div style={PANEL}>
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--line)',
            fontSize: 13, fontWeight: 600,
          }}>
            Recent Revenue Entries
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)', fontWeight: 400 }}>
              Latest 100 entries
            </span>
          </div>

          {revenueHistory.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
              No revenue data uploaded yet
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <th style={TH}>Month</th>
                    <th style={TH}>Client Code</th>
                    <th style={TH}>Client Name</th>
                    <th style={TH}>Industry</th>
                    <th style={TH}>State</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Pump ₹</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Spare ₹</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Total ₹</th>
                    <th style={TH}>Entered By</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueHistory.map((row, i) => (
                    <tr key={row.id} style={{
                      borderBottom: i < revenueHistory.length - 1 ? '1px solid var(--line)' : 'none',
                    }}>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {fmtMonth(row.month)}
                      </td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                        {row.code}
                      </td>
                      <td style={{ ...TD, minWidth: 160 }}>
                        <a
                          href={`/risansi/clients/${row.code}`}
                          style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}
                        >
                          {row.legal_name}
                        </a>
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.industry ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.state ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {fmtInr(row.pump_value)}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {fmtInr(row.spare_value)}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {fmtInr(row.total_value)}
                      </td>
                      <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>
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

// ── Styles ────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '9px 12px', verticalAlign: 'middle' };
