import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { PumpUploadBox } from '@/components/risansi/PumpUploadBox';
import { DeletePumpUploadButton } from '@/components/risansi/DeletePumpUploadButton';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    console.error('[admin/pumps] query error:', err);
    return fallback;
  }
}

// ── Types ──────────────────────────────────────────────────────

interface PumpRow {
  id:               string;
  year:             number | null;
  pump_model_plate: string | null;
  quantity:         number;
  pump_sl_no:       string | null;
  ec_number:        string | null;
  liquid:           string | null;
  capacity:         string | null;
  head:             string | null;
  supplier:         string | null;
  code:             string;
  legal_name:       string;
  entered_by:       string | null;
}

interface LogRow {
  id:            number;
  uploaded_by:   string;
  filename:      string;
  rows_total:    number;
  rows_inserted: number;
  rows_updated:  number;
  rows_skipped:  number;
  skipped_codes: string[] | null;
  status:        string;
  uploaded_at:   string;
}

// ── Page ──────────────────────────────────────────────────────

export default async function PumpAdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/risansi');

  const [pumpHistory, uploadLog] = await Promise.all([

    q<PumpRow[]>(async () => {
      const { rows } = await risansiPool.query<PumpRow>(
        `SELECT
           cp.id::text,
           COALESCE(EXTRACT(YEAR FROM cp.so_date), EXTRACT(YEAR FROM cp.ec_date))::int AS year,
           cp.pump_model_plate,
           cp.quantity,
           cp.pump_sl_no,
           cp.ec_number,
           cp.liquid,
           cp.capacity,
           cp.head,
           cp.customer_name AS supplier,
           c.code,
           c.legal_name,
           cp.entered_by
         FROM client_pumps cp
         JOIN clients c ON cp.client_id = c.id
         WHERE cp.source = 'upload'
         ORDER BY cp.entered_at DESC NULLS LAST, cp.id DESC
         LIMIT 100`,
      );
      return rows;
    }, []),

    q<LogRow[]>(async () => {
      const { rows } = await risansiPool.query<LogRow>(
        `SELECT * FROM pump_upload_log ORDER BY uploaded_at DESC LIMIT 20`,
      );
      return rows;
    }, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Pump Ingestion']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Pump Ingestion
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Upload newly installed pumps per client from Excel — appears in each client&apos;s Client 360 pump list
          </div>
        </div>

        {/* ── Section 1: Template Download ─────────────────────── */}
        <div style={{ ...PANEL, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>
                Pump Upload Template
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                Download the template, add the month&apos;s newly installed pumps (one row per pump), then upload below.
              </div>
              <div style={{
                marginTop: 10, fontSize: 12, color: 'var(--fg-3)',
                fontFamily: 'var(--font-mono)', background: 'var(--bg-elev)',
                padding: '8px 12px', borderRadius: 6, display: 'inline-block', lineHeight: 1.8,
              }}>
                Columns: Client Code | Client Name | Model | Quantity | SR No | EC No | EC Date | SO Date | Liquid | Capacity | Head | Supplier
                <br />
                Dates: YYYY-MM-DD (used for the install Year) · Re-uploading the same SR No updates that pump
              </div>
            </div>
            <a
              href="/pump_upload_template.xlsx"
              download
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', background: '#0A3D8F', color: 'white',
                borderRadius: 7, textDecoration: 'none', fontSize: 13, fontWeight: 500,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ⬇ Download Template
            </a>
          </div>
        </div>

        {/* ── Section 2: Upload Box (client island) ────────────── */}
        <PumpUploadBox />

        {/* ── Section 3: Upload History Log ────────────────────── */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
            Upload History
          </div>

          {uploadLog.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>No uploads yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <th style={TH}>Date &amp; Time</th>
                    <th style={TH}>File</th>
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
                    <tr key={log.id} style={{ borderBottom: i < uploadLog.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(log.uploaded_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.filename}
                      </td>
                      <td style={{ ...TD, textAlign: 'center' }}>{log.rows_total}</td>
                      <td style={{ ...TD, textAlign: 'center', color: '#065F46', fontWeight: 600 }}>{log.rows_inserted}</td>
                      <td style={{ ...TD, textAlign: 'center', color: '#1E40AF' }}>{log.rows_updated}</td>
                      <td style={{ ...TD, textAlign: 'center', color: log.rows_skipped > 0 ? '#9B1C1C' : 'var(--fg-3)' }}>
                        {log.rows_skipped}
                        {(log.skipped_codes?.length ?? 0) > 0 && (
                          <span title={(log.skipped_codes ?? []).join(', ')} style={{ cursor: 'help' }}> ⓘ</span>
                        )}
                      </td>
                      <td style={TD}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: log.status === 'success' ? '#D1FAE5' : log.status === 'partial' ? '#FEF3C7' : '#FDE8E8',
                          color: log.status === 'success' ? '#065F46' : log.status === 'partial' ? '#92400E' : '#9B1C1C',
                        }}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{log.uploaded_by}</td>
                      <td style={TD}><DeletePumpUploadButton logId={log.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 4: Recent Pump Entries ───────────────────── */}
        <div style={PANEL}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
            Recently Uploaded Pumps
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)', fontWeight: 400 }}>Latest 100 entries</span>
          </div>

          {pumpHistory.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>No pumps uploaded yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <th style={TH}>Client Code</th>
                    <th style={TH}>Client Name</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Year</th>
                    <th style={TH}>Model</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Qty</th>
                    <th style={TH}>SR No</th>
                    <th style={TH}>EC No</th>
                    <th style={TH}>Liquid</th>
                    <th style={TH}>Capacity</th>
                    <th style={TH}>Head</th>
                    <th style={TH}>Supplier</th>
                    <th style={TH}>Entered By</th>
                  </tr>
                </thead>
                <tbody>
                  {pumpHistory.map((row, i) => (
                    <tr key={row.id} style={{ borderBottom: i < pumpHistory.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{row.code}</td>
                      <td style={{ ...TD, minWidth: 160 }}>
                        <a href={`/risansi/clients/${row.code}`} style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>
                          {row.legal_name}
                        </a>
                      </td>
                      <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.year ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{row.pump_model_plate ?? '—'}</td>
                      <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{row.quantity}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.pump_sl_no ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.ec_number ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.liquid ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.capacity ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.head ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.supplier ?? '—'}</td>
                      <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>{row.entered_by ?? '—'}</td>
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
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '9px 12px', verticalAlign: 'middle' };
