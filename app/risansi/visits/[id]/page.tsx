import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, ownerVisibilitySql } from '@/lib/risansi-auth';
import { Topbar } from '@/components/risansi';
import Link from 'next/link';
import { VisitReportForm } from '@/components/risansi/VisitReportForm';
import { SubmitVisitButton } from '@/components/risansi/SubmitVisitButton';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export default async function VisitReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const visitRes = await risansiPool.query<{
    id: string; client_id: string; rep_id: string | null;
    visit_date: string; is_planned: boolean | null;
    is_unplanned: boolean | null; unplanned_reason: string | null;
    check_in_time: string | null; check_in_lat: number | null;
    check_in_lng: number | null; check_in_accuracy_m: number | null;
    gps_within_radius: boolean | null;
    manual_checkin: boolean | null; manual_checkin_note: string | null;
    check_out_time: string | null;
    purpose: string | null; outcome: string | null;
    summary: string | null; industry_format: string | null;
    competitor_activity_observed: boolean | null;
    sample_or_gift_given: boolean | null;
    sample_gift_detail: string | null; sample_gift_value: number | null;
    follow_up_required: boolean | null; follow_up_text: string | null;
    follow_up_due_date: string | null;
    next_visit_recommendation: string | null;
    status: string; submitted_at: string | null;
    performance_feedback: string | null; pcp_competitor: string | null;
    mgmt_intervention: string | null; action_points: string | null;
    complaint_notes: string | null; competitors_observed: string | null;
    open_remarks: string | null; major_remarks: string | null;
    ice_dispersal_by: string | null; negotiation_by: string | null;
    // Joined client fields
    legal_name: string; code: string; industry: string | null;
    is_sugar: boolean; city: string | null; state: string | null;
    tier: string | null; rep_name: string; rep_email: string | null;
  }>(
    `SELECT v.*,
       c.legal_name, c.code, c.industry, c.is_sugar,
       c.city, c.state, c.tier,
       COALESCE(r.name, '—') AS rep_name,
       r.email AS rep_email
     FROM visits v
     JOIN clients c ON v.client_id = c.id
     LEFT JOIN users r ON v.rep_id = r.id
     WHERE v.id = $1`,
    [id],
  );

  const visit = visitRes.rows[0];
  if (!visit) notFound();

  // Visibility guard — viewer must be able to SEE this visit (own / shared tour),
  // or be admin/sysadmin. ownerVisibilitySql returns null for admin (no restriction).
  const viewer  = await getCurrentUser();
  const ownPred = ownerVisibilitySql(viewer, 'v.rep_id');
  if (ownPred) {
    const { rows: visRows } = await risansiPool.query<{ ok: boolean }>(
      `SELECT (${ownPred}) AS ok FROM visits v WHERE v.id = $1`,
      [id],
    );
    if (!visRows[0]?.ok) notFound();
  }

  // Ownership: only the assigned rep may fill / edit / submit this visit.
  // Everyone else (other reps, managers, admins) gets read-only VIEW access.
  const isSubmitted = !!visit.submitted_at;
  let myRepId: number | null = session.user.repId ?? null;
  if (myRepId == null && session.user.email) {
    const repRes = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1',
      [session.user.email],
    );
    myRepId = repRes.rows[0]?.id ?? null;
  }
  const isAssignedRep = myRepId != null && visit.rep_id != null && String(visit.rep_id) === String(myRepId);
  const canEdit = !isSubmitted && isAssignedRep;

  const [contacts, equipment, sugarRes, nonsugarRes, oppsRes, tasksRes, reps, expansionOppRow] = await Promise.all([
    q(async () => {
      const { rows } = await risansiPool.query<{
        id: number; name: string; designation: string | null;
        phone: string | null; is_primary: boolean;
      }>(
        `SELECT id, name, designation, phone, is_primary
         FROM contacts WHERE client_id = $1
         ORDER BY is_primary DESC, name ASC`,
        [visit.client_id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT * FROM equipment
         WHERE client_id = $1 AND visit_id = $2
         ORDER BY is_ril DESC, created_at ASC`,
        [visit.client_id, id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        'SELECT * FROM visit_sugar_report WHERE visit_id = $1 LIMIT 1',
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        'SELECT * FROM visit_nonsugar_report WHERE visit_id = $1 LIMIT 1',
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        'SELECT * FROM opportunities WHERE visit_id = $1 ORDER BY created_at ASC',
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT t.*, r.name AS assigned_rep_name
         FROM tasks t
         LEFT JOIN users r ON t.assigned_to_rep = r.id
         WHERE t.visit_id = $1
         ORDER BY
           CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
           t.due_date ASC NULLS LAST`,
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT id, name, zone FROM users WHERE is_active = TRUE ORDER BY name ASC`,
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT id, product, product_type, stage, value_cr, probability, eta_text, quote_ref, notes
         FROM opportunities
         WHERE visit_id = $1 AND auto_source = 'expansion_plan'
         ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    }, null),
  ]);

  // Drives the whole form's read-only state: locked when submitted OR when the
  // viewer isn't the assigned rep. VisitReportForm already disables every field,
  // the auto-save triggers, and inline add-buttons off this single flag.
  const isClosed = isSubmitted || !canEdit;
  const isSugar  = visit.industry_format === 'sugar' || (!visit.industry_format && visit.is_sugar);

  const visitDate = new Date(visit.visit_date).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Field Activity', { label: visit.legal_name, href: `/risansi/clients/${visit.code}` }, 'Visit Report']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 24px 60px' }}>

          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'flex-start', marginBottom: 24,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                <Link
                  href={`/risansi/clients/${visit.code}`}
                  style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', textDecoration: 'none' }}
                >
                  {visit.legal_name}
                </Link>
                <StatusBadge status={visit.status} />
                {isSubmitted && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: '#F3F4F6', color: '#6B7280', fontWeight: 600,
                  }}>
                    🔒 Closed
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                {visit.rep_name} · {visitDate}
                {visit.purpose && ` · ${visit.purpose}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                {visit.code} · {visit.city ?? ''}{visit.city && visit.industry ? ' · ' : ''}{visit.industry ?? ''}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              {canEdit && <SubmitVisitButton visitId={id} />}
            </div>
          </div>

          {/* View-only notice — not submitted, just not the assigned rep */}
          {!isSubmitted && !isAssignedRep && (
            <div style={{
              padding: '10px 16px', marginBottom: 16,
              background: 'var(--warn-soft, #FEF3C7)',
              border: '1px solid var(--warn, rgba(217,119,6,0.35))',
              borderRadius: 8, fontSize: 12, color: 'var(--warn, #92400E)',
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span aria-hidden>👁</span>
              <span>
                View only — this visit is assigned to <strong>{visit.rep_name}</strong>.
                Only they can fill in this form.
              </span>
            </div>
          )}

          {/* Main form */}
          <VisitReportForm
            visit={visit}
            contacts={contacts}
            equipment={equipment}
            sugarReport={sugarRes[0] ?? null}
            nonsugarReport={nonsugarRes[0] ?? null}
            opportunities={oppsRes}
            tasks={tasksRes}
            reps={reps}
            expansionOpp={expansionOppRow}
            isClosed={isClosed}
            isSugar={isSugar}
          />

        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    planned:    { bg: '#E0E7FF', color: '#3730A3' },
    'checked-in': { bg: '#DBEAFE', color: '#1E40AF' },
    completed:  { bg: '#D1FAE5', color: '#065F46' },
    missed:     { bg: '#FEE2E2', color: '#991B1B' },
    cancelled:  { bg: '#F3F4F6', color: '#6B7280' },
  };
  const s = map[status] ?? { bg: '#F3F4F6', color: '#6B7280' };
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10,
      background: s.bg, color: s.color, fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {status.replace('-', ' ')}
    </span>
  );
}
