import Link from 'next/link';
import type { CSSProperties } from 'react';
import { SEVERITY_TONE, STATUS_TONE, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintListRow } from '@/lib/risansi-complaint-rows';

// The complaints list as a table: one row per complaint, open first, each
// saying where it is, who is holding it and for how long. Server-rendered.

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const fmtDays = (d: number) => (d < 1 ? '<1d' : `${Math.round(d)}d`);

export function ComplaintTable({ rows }: { rows: ComplaintListRow[] }) {
  if (!rows.length) return <div style={{ ...PANEL, padding: 32, textAlign: 'center', fontSize: 12.5, color: 'var(--fg-3)' }}>No complaints match. Clear a filter, or raise one.</div>;
  return (
    <div style={{ ...PANEL, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['No.', 'Client', 'Status', 'Sev', 'Type · category', 'Sitting with', 'Since', 'Age', 'Target', 'Rep', 'Raised', ''].map((h, i) => (
              <th key={i} style={{ ...TH, textAlign: ['Since', 'Age'].includes(h) ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const open = r.status !== 'Resolved' && r.status !== 'Closed';
            const legacy = r.schema_version < 2;
            return (
              <tr key={r.id} style={{ opacity: open ? 1 : 0.7 }}>
                <td style={TD}>
                  <Link href={`/risansi/complaints/${r.id}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', fontWeight: 600 }}>{r.complaint_no}</Link>
                  {legacy && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--fg-4)', fontWeight: 700 }}>LEGACY</span>}
                  {r.reopen_count > 0 && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--warn, #B45309)', fontWeight: 700 }}>↩{r.reopen_count}</span>}
                </td>
                <td style={{ ...TD, maxWidth: 240 }}>
                  {r.client_id ? <Link href={`/risansi/clients/${r.client_id}`} style={{ color: 'var(--fg)', textDecoration: 'none', fontWeight: 500 }}>{r.client_name}</Link> : <span style={{ color: 'var(--fg-3)' }}>—</span>}
                  <div style={{ fontSize: 10.5, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.details ?? ''}>{r.details}</div>
                </td>
                <td style={TD}><span style={{ ...PILL, background: STATUS_TONE[r.status] ?? 'var(--fg-3)' }}>{r.status}</span></td>
                <td style={TD}>{r.severity ? <span style={{ ...PILL, background: SEVERITY_TONE[r.severity as Severity] }} title={r.severity}>{r.severity}</span> : <span style={{ color: 'var(--fg-4)' }}>·</span>}</td>
                <td style={{ ...TD, fontSize: 11.5 }}>{r.complaint_type ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}{r.defect_category ? <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.defect_category}</div> : null}</td>
                <td style={{ ...TD, fontSize: 11.5 }}>
                  {open && !legacy ? <>
                    <div>{r.holder_name ?? r.holder_department ?? 'Complaint Team'}</div>
                    {r.holder_name && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.holder_department}</div>}
                  </> : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: open && r.days_in_status > 7 ? 'var(--neg)' : 'var(--fg)' }} title={r.since ? `In ${r.status} since ${day(r.since)}` : ''}>
                  {open && !legacy ? fmtDays(r.days_in_status) : '—'}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }} title={open ? 'Days since raised' : 'Days from raised to closed'}>{fmtDays(r.age_days)}</td>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: r.overdue ? 'var(--neg)' : 'var(--fg-2)', fontWeight: r.overdue ? 700 : 400 }}>{r.target_completion_date ? day(r.target_completion_date) : '—'}{r.overdue ? ' !' : ''}</td>
                <td style={{ ...TD, fontSize: 11.5 }}>{r.rep_name ?? <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>{day(r.complaint_date ?? r.created_at)}</td>
                <td style={TD}><Link href={`/risansi/complaints/${r.id}`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Open →</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const TH: CSSProperties = { padding: '9px 10px', fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--line)', background: 'var(--bg-sunk)', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const TD: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--line-2)', verticalAlign: 'top' };
const PILL: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' };
