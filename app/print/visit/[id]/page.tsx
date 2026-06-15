import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, ownerVisibilitySql } from '@/lib/risansi-auth';
import { AutoPrint } from '@/components/risansi/AutoPrint';
import {
  PRINT_CSS, ROOT, C, Section, Facts, TextBlock, TH, TD, DocHeader, RowFacts,
} from '@/components/risansi/print-shared';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

function fmtDate(v: string | Date | null | undefined, withTime = false): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

const yn = (v: boolean | null | undefined) => (v ? 'Yes' : 'No');

export default async function VisitPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const visitRes = await risansiPool.query<Record<string, unknown>>(
    `SELECT v.*,
       c.legal_name, c.code, c.industry, c.is_sugar, c.city, c.state, c.tier,
       COALESCE(r.name, '—') AS rep_name, r.email AS rep_email
     FROM visits v
     JOIN clients c ON v.client_id = c.id
     LEFT JOIN users r ON v.rep_id = r.id
     WHERE v.id = $1`,
    [id],
  );
  const visit = visitRes.rows[0];
  if (!visit) notFound();

  // Visibility guard — viewer must be able to SEE this visit.
  const viewer  = await getCurrentUser();
  const ownPred = ownerVisibilitySql(viewer, 'v.rep_id');
  if (ownPred) {
    const { rows } = await risansiPool.query<{ ok: boolean }>(
      `SELECT (${ownPred}) AS ok FROM visits v WHERE v.id = $1`, [id],
    );
    if (!rows[0]?.ok) notFound();
  }

  // Only a closed (submitted) visit may be exported. Otherwise bounce back.
  if (!visit.submitted_at) redirect(`/risansi/visits/${id}`);

  const cid = String(visit.client_id);
  const [contacts, equipment, sugar, nonsugar, opps, tasks] = await Promise.all([
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT name, designation, phone, email, is_primary FROM contacts WHERE client_id = $1 ORDER BY is_primary DESC, name ASC`, [cid],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT * FROM equipment WHERE visit_id = $1 ORDER BY is_ril DESC, created_at ASC`, [id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT * FROM visit_sugar_report WHERE visit_id = $1 LIMIT 1`, [id],
    )).rows[0] ?? null, null as Record<string, unknown> | null),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT * FROM visit_nonsugar_report WHERE visit_id = $1 LIMIT 1`, [id],
    )).rows[0] ?? null, null as Record<string, unknown> | null),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT id, product, stage, value_cr::text AS value_cr, probability FROM opportunities WHERE visit_id = $1 ORDER BY created_at ASC`, [id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT t.title, t.status, t.due_date, t.priority, r.name AS assigned_rep_name
         FROM tasks t LEFT JOIN users r ON t.assigned_to_rep = r.id
         WHERE t.visit_id = $1
         ORDER BY CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END, t.due_date ASC NULLS LAST`, [id],
    )).rows, [] as Record<string, unknown>[]),
  ]);

  const isSugar = visit.industry_format === 'sugar' || (!visit.industry_format && !!visit.is_sugar);
  const rilEq  = equipment.filter(e => e.is_ril);
  const compEq = equipment.filter(e => !e.is_ril);
  const s = visit as Record<string, unknown>;
  const str = (k: string) => (s[k] == null ? null : String(s[k]));

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="print-root" style={{ background: '#fff', minHeight: '100vh', padding: '16px' }}>
        <AutoPrint label="Save Visit Report as PDF" />
        <div style={ROOT}>
          <DocHeader
            kind="Visit Report"
            title={String(visit.legal_name)}
            subtitle={<>
              {String(visit.rep_name)} · {fmtDate(visit.visit_date as string)}
              {visit.purpose ? ` · ${String(visit.purpose)}` : ''}
            </>}
            meta={<>
              <div style={{ fontFamily: 'monospace' }}>{String(visit.code)}</div>
              <div style={{ marginTop: 2, color: C.pos, fontWeight: 700 }}>● CLOSED</div>
              <div style={{ marginTop: 2 }}>Submitted {fmtDate(visit.submitted_at as string)}</div>
            </>}
          />

          <Section title="Visit Details">
            <Facts rows={[
              ['Client Code', String(visit.code)],
              ['Industry', `${str('industry') ?? '—'}${isSugar ? ' · Sugar' : ''}`],
              ['Location', [str('city'), str('state')].filter(Boolean).join(', ') || null],
              ['Tier', str('tier')],
              ['Representative', `${str('rep_name')}${str('rep_email') ? ` (${str('rep_email')})` : ''}`],
              ['Visit Date', fmtDate(visit.visit_date as string)],
              ['Purpose', str('purpose')],
              ['Outcome', str('outcome')],
              ['Status', String(visit.status)],
              ['Visit Type', visit.is_unplanned ? `Unplanned${str('unplanned_reason') ? ` — ${str('unplanned_reason')}` : ''}` : 'Planned'],
              ['Checked In', fmtDate(visit.check_in_time as string, true)],
              ['Checked Out', fmtDate(visit.check_out_time as string, true)],
              ['GPS Within Radius', visit.check_in_time ? yn(visit.gps_within_radius as boolean) : null],
            ]} />
          </Section>

          {isSugar && sugar && (
            <Section title="Sugar Industry Report"><RowFacts row={sugar} /></Section>
          )}
          {!isSugar && nonsugar && (
            <Section title="Industry Report"><RowFacts row={nonsugar} /></Section>
          )}

          {equipment.length > 0 && (
            <Section title="Equipment Assessment" right={`${equipment.length} item${equipment.length !== 1 ? 's' : ''}`}>
              {[['RIL Equipment', rilEq], ['Competitor Equipment', compEq]].map(([label, list]) => {
                const items = list as Record<string, unknown>[];
                if (items.length === 0) return null;
                const isComp = label === 'Competitor Equipment';
                return (
                  <div key={label as string} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.fg2, marginBottom: 4 }}>{label as string}</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        {['Type', isComp ? 'Make / Model' : 'Model', 'Application', 'Qty', 'Condition', isComp ? 'Reason' : 'Feedback'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {items.map((e, i) => (
                          <tr key={i}>
                            <td style={TD}>{String(e.pump_type ?? '—')}</td>
                            <td style={TD}>{`${String(e.supplier ?? '')} ${String(e.model ?? '')}`.trim() || '—'}</td>
                            <td style={TD}>{String(e.application ?? '—')}</td>
                            <td style={{ ...TD, textAlign: 'center' }}>{String(e.qty ?? 1)}</td>
                            <td style={TD}>{String(e.condition ?? '—')}{e.is_opportunity ? ' ⚡' : ''}</td>
                            <td style={TD}>{String((isComp ? e.reason_for_competitor : e.performance_feedback) ?? '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </Section>
          )}

          <Section title="Visit Summary">
            <Facts rows={[
              ['Performance Feedback', str('performance_feedback')],
              ['Mgmt Intervention', str('mgmt_intervention')],
              ['Competitor Activity Observed', yn(visit.competitor_activity_observed as boolean)],
              ['Sample / Gift Given', visit.sample_or_gift_given ? `Yes${str('sample_gift_detail') ? ` — ${str('sample_gift_detail')}` : ''}` : 'No'],
              ['Follow-up Required', visit.follow_up_required ? `Yes${str('follow_up_due_date') ? ` (due ${fmtDate(visit.follow_up_due_date as string)})` : ''}` : 'No'],
              ['Next Visit Recommendation', fmtDate(visit.next_visit_recommendation as string)],
            ]} />
            <div style={{ marginTop: 12 }}>
              <TextBlock label="Visit Summary" value={str('summary')} />
              <TextBlock label="Open Remarks" value={str('open_remarks')} />
              <TextBlock label="Major Remarks" value={str('major_remarks')} />
              <TextBlock label="Follow-up Notes" value={str('follow_up_text')} />
              <TextBlock label="Complaint Notes" value={str('complaint_notes')} />
            </div>
          </Section>

          {tasks.length > 0 && (
            <Section title="Action Register" right={`${tasks.length} item${tasks.length !== 1 ? 's' : ''}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Action', 'Owner', 'Due', 'Priority', 'Status'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {tasks.map((t, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(t.title ?? '—')}</td>
                      <td style={TD}>{String(t.assigned_rep_name ?? '—')}</td>
                      <td style={TD}>{fmtDate(t.due_date as string)}</td>
                      <td style={TD}>{String(t.priority ?? '—')}</td>
                      <td style={TD}>{String(t.status ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {opps.length > 0 && (
            <Section title="Opportunities" right={`${opps.length}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Product', 'Stage', 'Value (Cr)', 'Probability'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {opps.map((o, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(o.product ?? '—')}</td>
                      <td style={TD}>{String(o.stage ?? '—')}</td>
                      <td style={TD}>₹{Number(o.value_cr ?? 0).toFixed(2)}</td>
                      <td style={TD}>{o.probability != null ? `${o.probability}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {contacts.length > 0 && (
            <Section title="Contacts" right={`${contacts.length}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Name', 'Designation', 'Phone', 'Email'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(c.name ?? '—')}{c.is_primary ? ' ★' : ''}</td>
                      <td style={TD}>{String(c.designation ?? '—')}</td>
                      <td style={TD}>{String(c.phone ?? '—')}</td>
                      <td style={TD}>{String(c.email ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <div style={{ marginTop: 16, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 9, color: C.fg3, display: 'flex', justifyContent: 'space-between' }}>
            <span>Risansi Intelligence Platform — Visit Report</span>
            <span>Generated {fmtDate(new Date(), true)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
