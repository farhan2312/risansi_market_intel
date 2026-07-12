import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { OutstandingUploadBox } from '@/components/risansi/OutstandingUploadBox';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[outstanding/page]', err); return fallback; }
}
const fmtDate = (raw: unknown) => raw ? new Date(String(raw)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtInr  = (n: number) => (!n || n === 0) ? '—' : `₹${n.toLocaleString('en-IN')}`;

interface Summary { clients: number; total: number; as_of: string | null; }
interface LogRow {
  id: number; uploaded_by: string; filename: string; as_of_date: string | null;
  rows_total: number; rows_matched: number; rows_skipped: number; skipped_codes: string[] | null;
  grand_total: number | null; status: string; uploaded_at: string;
}
interface OutRow { code: string; legal_name: string; amount: number; debtor: string | null; owner: string | null; as_of: string | null; }

export default async function OutstandingAdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/risansi');

  const [summary, log, current] = await Promise.all([
    q<Summary>(async () => (await risansiPool.query<Summary>(
      `SELECT count(*)::int AS clients, COALESCE(sum(total_outstanding),0)::float AS total, max(outstanding_as_of)::text AS as_of
         FROM clients WHERE total_outstanding IS NOT NULL AND deleted_at IS NULL`)).rows[0], { clients: 0, total: 0, as_of: null }),
    q<LogRow[]>(async () => (await risansiPool.query<LogRow>(
      `SELECT id, uploaded_by, filename, as_of_date::text, rows_total, rows_matched, rows_skipped,
              skipped_codes, grand_total::float, status, uploaded_at::text
         FROM outstanding_upload_log ORDER BY uploaded_at DESC LIMIT 20`)).rows, []),
    q<OutRow[]>(async () => (await risansiPool.query<OutRow>(
      `SELECT c.code, c.legal_name, c.total_outstanding::float AS amount,
              c.outstanding_debtor_code AS debtor, u.name AS owner, c.outstanding_as_of::text AS as_of
         FROM clients c LEFT JOIN users u ON u.id = c.outstanding_owner_id
        WHERE c.total_outstanding IS NOT NULL AND c.deleted_at IS NULL
        ORDER BY c.total_outstanding DESC LIMIT 300`)).rows, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Admin', 'Outstanding Upload']} /></div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Outstanding Upload</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Monthly receivables snapshot — each upload replaces the previous one</div>
        </div>

        {/* Current snapshot */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={LBL}>Total Outstanding</div>
            <div style={{ ...VAL, color: 'var(--neg)' }}>{fmtInr(summary.total)}</div>
          </div>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={LBL}>Clients With Outstanding</div>
            <div style={VAL}>{summary.clients.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={LBL}>As Of</div>
            <div style={{ ...VAL, fontSize: 20 }}>{fmtDate(summary.as_of)}</div>
          </div>
        </div>

        {/* Template */}
        <div style={{ ...PANEL, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Outstanding Upload Template</div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Download, fill in this month's figures, then upload below. One file per month — it replaces the last.</div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', background: 'var(--bg-elev)', padding: '8px 12px', borderRadius: 6, display: 'inline-block', lineHeight: 1.8 }}>
              Columns: Subledger Code | Debtor | Name | Total Outstanding<br />Amount in ₹ INR · matched on subledger (client) code
            </div>
          </div>
          <a href="/outstanding_upload_template.xlsx" download
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#0A3D8F', color: '#fff', borderRadius: 7, textDecoration: 'none', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
            ⬇ Download Template
          </a>
        </div>

        {/* Upload box */}
        <OutstandingUploadBox />

        {/* Upload history */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>Upload History</div>
          {log.length === 0 ? <div style={EMPTY}>No uploads yet</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: 'var(--bg-elev)' }}>
                  <th style={TH}>Date</th><th style={TH}>File</th><th style={TH}>As Of</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Rows</th><th style={{ ...TH, textAlign: 'center' }}>Matched</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Skipped</th><th style={{ ...TH, textAlign: 'right' }}>Total ₹</th>
                  <th style={TH}>Status</th><th style={TH}>By</th>
                </tr></thead>
                <tbody>
                  {log.map((l, i) => (
                    <tr key={l.id} style={{ borderBottom: i < log.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <td style={{ ...TD, ...MONO, whiteSpace: 'nowrap' }}>{new Date(l.uploaded_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ ...TD, ...MONO, color: 'var(--fg-3)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.filename}</td>
                      <td style={{ ...TD, ...MONO }}>{fmtDate(l.as_of_date)}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{l.rows_total}</td>
                      <td style={{ ...TD, textAlign: 'center', color: 'var(--pos-strong)', fontWeight: 600 }}>{l.rows_matched}</td>
                      <td style={{ ...TD, textAlign: 'center', color: l.rows_skipped > 0 ? 'var(--neg-strong)' : 'var(--fg-3)' }}>
                        {l.rows_skipped}{(l.skipped_codes?.length ?? 0) > 0 && <span title={(l.skipped_codes ?? []).join(', ')} style={{ cursor: 'help' }}> ⓘ</span>}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: 'right' }}>{fmtInr(l.grand_total ?? 0)}</td>
                      <td style={TD}><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: l.status === 'success' ? 'var(--pos-soft)' : l.status === 'partial' ? 'var(--warn-soft)' : 'var(--neg-soft)',
                        color: l.status === 'success' ? 'var(--pos-strong)' : l.status === 'partial' ? 'var(--warn)' : 'var(--neg-strong)' }}>{l.status}</span></td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{l.uploaded_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Current outstanding data */}
        <div style={PANEL}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
            Current Outstanding <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)', fontWeight: 400 }}>Top 300 by amount</span>
          </div>
          {current.length === 0 ? <div style={EMPTY}>No outstanding data — upload a sheet above.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: 'var(--bg-elev)' }}>
                  <th style={TH}>Code</th><th style={TH}>Client</th><th style={TH}>Debtor</th><th style={TH}>Owner</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Outstanding ₹</th><th style={TH}>As Of</th>
                </tr></thead>
                <tbody>
                  {current.map((r, i) => (
                    <tr key={r.code + i} style={{ borderBottom: i < current.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <td style={{ ...TD, ...MONO, color: 'var(--fg-3)' }}>{r.code}</td>
                      <td style={{ ...TD, minWidth: 180 }}><a href={`/risansi/clients/${r.code}`} style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>{r.legal_name}</a></td>
                      <td style={{ ...TD, ...MONO, color: 'var(--fg-3)' }}>{r.debtor ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--fg-2)' }}>{r.owner ?? '—'}</td>
                      <td style={{ ...TD, ...MONO, textAlign: 'right', fontWeight: 600, color: 'var(--neg)' }}>{fmtInr(r.amount)}</td>
                      <td style={{ ...TD, ...MONO, fontSize: 11 }}>{fmtDate(r.as_of)}</td>
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

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const LBL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
const VAL: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: 'var(--fg)', marginTop: 4, lineHeight: 1.1 };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)' };
const TD: CSSProperties = { padding: '9px 12px', verticalAlign: 'middle' };
const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11 };
const EMPTY: CSSProperties = { padding: 32, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 };
