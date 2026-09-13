import Link from 'next/link';
import type { CSSProperties } from 'react';
import { STATUS_TONE, SEVERITY_TONE, isOpenStatus, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintListRow } from '@/lib/risansi-complaint-rows';

// The complaints panel on Client 360: every complaint on the client, open
// first, with where it is and who is holding it, each a link into the
// complaint itself. Server-rendered from the same loader as the Complaints
// page, so the two never disagree.

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const fmtDays = (d: number) => (d < 1 ? '<1d' : `${Math.round(d)}d`);

export function ClientComplaints({ complaints, clientId }: { complaints: ComplaintListRow[]; clientId: number }) {
  const open = complaints.filter(c => isOpenStatus(c.status));
  const overdue = open.filter(c => c.overdue).length;
  const s1s2 = open.filter(c => c.severity === 'S1' || c.severity === 'S2').length;
  return (
    <div data-tabgroup="activity" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>Complaints</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {complaints.length} total{open.length ? ` · ${open.length} open` : ''}{overdue ? ` · ${overdue} overdue` : ''}{s1s2 ? ` · ${s1s2} S1/S2` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {complaints.length > 0 && <Link href={`/risansi/complaints?q=${encodeURIComponent(complaints[0].client_code ?? '')}`} style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', alignSelf: 'center' }}>All in module →</Link>}
          <Link href={`/risansi/complaints/new?client=${clientId}`} style={RAISE_BTN}>⚠ Raise</Link>
        </div>
      </div>
      {complaints.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>No complaints for this client.</div>
      ) : (
        <div>
          {complaints.map((c, i) => {
            const isOpen = isOpenStatus(c.status);
            const legacy = c.schema_version < 2;
            return (
              <Link key={c.id} href={`/risansi/complaints/${c.id}`}
                style={{ ...ROW, borderBottom: i < complaints.length - 1 ? '1px solid var(--line)' : 'none', opacity: isOpen ? 1 : 0.7 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)', flexShrink: 0, width: 92 }}>{c.complaint_no}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.complaint_type ? <b style={{ fontWeight: 600 }}>{c.complaint_type}{c.defect_category ? ` · ${c.defect_category}` : ''} — </b> : null}{c.details}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2 }}>
                    raised {day(c.complaint_date ?? c.created_at)}
                    {isOpen && !legacy && <> · with <b style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{c.holder_name ?? c.holder_department ?? 'Complaint Team'}</b> for <b style={{ color: c.days_in_status > 7 ? 'var(--neg)' : 'var(--fg-2)', fontWeight: 600 }}>{fmtDays(c.days_in_status)}</b></>}
                    {!isOpen && <> · {c.status.toLowerCase()} after {fmtDays(c.age_days)}</>}
                    {c.overdue && <span style={{ color: 'var(--neg)', fontWeight: 700 }}> · target {day(c.target_completion_date)} missed</span>}
                    {legacy && <span style={{ color: 'var(--fg-4)' }}> · legacy</span>}
                  </span>
                </span>
                {c.severity && <span style={{ ...PILL, background: SEVERITY_TONE[c.severity as Severity] }}>{c.severity}</span>}
                <span style={{ ...PILL, background: STATUS_TONE[c.status] ?? 'var(--fg-3)' }}>{c.status}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', textDecoration: 'none', color: 'inherit', boxSizing: 'border-box' };
const PILL: CSSProperties = { padding: '2px 7px', borderRadius: 10, fontSize: 9.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', flexShrink: 0 };
const RAISE_BTN: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--bg-paper)', color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 6, textDecoration: 'none' };
