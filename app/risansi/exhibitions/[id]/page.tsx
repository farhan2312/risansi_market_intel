import { notFound } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { canManageExhibition, closeReadiness } from '@/app/actions/risansi-exhibitions';
import { ExhibitionDetail } from '@/components/risansi/ExhibitionDetail';
import type {
  ExhibitionFull, TeamMember, MeetingRow, ExpenseRow, ReviewRow,
} from '@/components/risansi/ExhibitionDetail';
import type { ReviewMeeting } from '@/components/risansi/ExhibitionReview';
import type { UserOpt } from '@/components/risansi/ExhibitionsClient';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[exhibition/detail]', err); return fallback; }
}

export default async function ExhibitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const me = await getCurrentUser();

  const [exhibition, team, meetings, expenses, review, users, canManage, blockers] = await Promise.all([
    q<ExhibitionFull | null>(async () => {
      const { rows } = await risansiPool.query<ExhibitionFull>(`
        SELECT e.id, e.name, e.organizer, e.website, e.venue, e.city, e.state, e.country,
               e.industry, e.source,
               e.start_date::text AS start_date, e.end_date::text AS end_date,
               e.status, e.participation, e.suggested,
               e.estimated_cost_inr::float8 AS estimated_cost_inr, e.recommendation,
               e.approver_id, ap.name AS approver_name,
               e.submitted_by, sb.name AS submitted_by_name, e.submitted_at::text AS submitted_at,
               e.decided_by, db.name AS decided_by_name, e.decided_at::text AS decided_at,
               e.decision_notes, e.created_by, e.created_by_name,
               e.expenses_reviewed_at::text AS expenses_reviewed_at,
               e.closed_at::text AS closed_at, cb.name AS closed_by_name,
               e.created_at::text AS created_at
          FROM exhibitions e
          LEFT JOIN users ap ON ap.id = e.approver_id
          LEFT JOIN users sb ON sb.id = e.submitted_by
          LEFT JOIN users db ON db.id = e.decided_by
          LEFT JOIN users cb ON cb.id = e.closed_by
         WHERE e.id = $1`, [id]);
      return rows[0] ?? null;
    }, null),

    q<TeamMember[]>(async () => {
      const { rows } = await risansiPool.query<TeamMember>(
        `SELECT t.id, t.user_id, u.name, u.role AS user_role, t.team_role
           FROM exhibition_team t JOIN users u ON u.id = t.user_id
          WHERE t.exhibition_id = $1
          ORDER BY (t.team_role <> 'Team Lead'), u.name`, [id]);
      return rows;
    }, []),

    // The lookup surfaces here: client_id != NULL means the company was matched
    // to an existing client, and we join through for its code so the badge can
    // show which record it is. LEFT JOIN — an unmatched meeting is normal.
    q<ReviewMeeting[]>(async () => {
      const { rows } = await risansiPool.query<ReviewMeeting>(
        `SELECT m.id, m.client_id, m.company_name, m.contact_person, m.designation,
                m.phone, m.email, m.city, m.discussion, m.requirement, m.outcome,
                m.next_action, m.follow_up_date::text AS follow_up_date, m.interest,
                m.potential_value_inr::float8 AS potential_value_inr,
                m.met_by, m.met_by_name, m.met_on::text AS met_on,
                c.code AS client_code, c.legal_name AS client_legal_name, c.status AS client_status,
                m.follow_up_type, m.follow_up_owner_id, fo.name AS follow_up_owner_name,
                m.follow_up_note, m.linked_visit_id, m.linked_task_id, m.linked_opportunity_id
           FROM exhibition_meetings m
           LEFT JOIN clients c ON c.id = m.client_id
           LEFT JOIN users fo ON fo.id = m.follow_up_owner_id
          WHERE m.exhibition_id = $1
          ORDER BY m.met_on DESC NULLS LAST, m.id DESC`, [id]);
      return rows;
    }, []),

    q<ExpenseRow[]>(async () => {
      const { rows } = await risansiPool.query<ExpenseRow>(
        `SELECT x.id, x.category, x.description, x.vendor,
                x.estimated_inr::float8 AS estimated_inr,
                x.actual_inr::float8 AS actual_inr,
                x.paid_inr::float8 AS paid_inr,
                x.paid_on::text AS paid_on,
                (f.expense_id IS NOT NULL) AS has_invoice, f.file_name
           FROM exhibition_expenses x
           LEFT JOIN exhibition_expense_files f ON f.expense_id = x.id
          WHERE x.exhibition_id = $1
          ORDER BY x.category, x.id`, [id]);
      return rows;
    }, []),

    q<ReviewRow | null>(async () => {
      const { rows } = await risansiPool.query<ReviewRow>(
        `SELECT exhibition_id, new_leads, opportunities,
                potential_value_inr::float8 AS potential_value_inr,
                business_won_inr::float8 AS business_won_inr, footfall,
                what_worked, what_did_not, key_learnings, competitor_notes,
                attend_next_year, next_year_notes, reviewed_by_name,
                reviewed_at::text AS reviewed_at
           FROM exhibition_reviews WHERE exhibition_id = $1`, [id]);
      return rows[0] ?? null;
    }, null),

    q<UserOpt[]>(async () => {
      const { rows } = await risansiPool.query<UserOpt>(
        `SELECT id, name, role FROM users
          WHERE is_active = TRUE AND status = 'Approved' ORDER BY name`);
      return rows;
    }, []),

    canManageExhibition(id).catch(() => false),

    closeReadiness(id).catch(() => ['Could not check readiness']),
  ]);

  if (!exhibition) notFound();

  const isOwner = me.role === 'sysadmin' ||
    (exhibition.created_by != null && me.id != null && Number(exhibition.created_by) === Number(me.id));

  const isApprover =
    me.role === 'sysadmin' ||
    (exhibition.approver_id != null && me.id != null && Number(exhibition.approver_id) === Number(me.id));

  return (
    <>
      <Topbar crumbs={[{ label: 'Exhibitions', href: '/risansi/exhibitions' }, exhibition.name]} />
      <ExhibitionDetail
        exhibition={exhibition}
        team={team}
        meetings={meetings}
        expenses={expenses}
        review={review}
        users={users}
        canManage={canManage}
        isApprover={isApprover}
        isOwner={isOwner}
        isSysadmin={me.role === 'sysadmin'}
        blockers={blockers}
      />
    </>
  );
}
