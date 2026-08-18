'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import {
  isExhibitionStatus, isDecision,
  type Decision, type ExhibitionStatus,
} from '@/lib/risansi-exhibition-fields';

/**
 * Exhibition module server actions.
 *
 * Self-contained: these only ever touch exhibition_* tables. The one exception is
 * a READ of `clients` to resolve a lookup id, and a read of `users` to name people.
 * Nothing here creates or edits a client, a task or an opportunity.
 */

type Me = { id: number | null; email: string | null; role: string };

async function requireUser(): Promise<Me & { email: string }> {
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');
  return { ...user, email: user.email };
}

const str = (fd: FormData, k: string): string | null => {
  const v = fd.get(k);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/** Rupee amount from a form field. Uses the comma-safe parser, never parseFloat —
 *  parseFloat('12,50,000') is 12, which is how five offers were once saved at ₹1. */
function inr(fd: FormData, k: string): number | null {
  const raw = str(fd, k);
  if (raw == null) return null;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** May this user act on this exhibition? Creator, team member, or admin+.
 *  Kept separate from the approval gate below — attending is not deciding. */
export async function canManageExhibition(exhibitionId: number): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user.email) return false;
  if (hasRole(user.role, 'admin')) return true;
  if (user.id == null) return false;
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM exhibitions e WHERE e.id = $1 AND e.created_by = $2)
          OR EXISTS (SELECT 1 FROM exhibition_team t WHERE t.exhibition_id = $1 AND t.user_id = $2)) AS ok`,
    [exhibitionId, user.id],
  );
  return rows[0]?.ok ?? false;
}

async function assertCanManage(exhibitionId: number): Promise<void> {
  if (!(await canManageExhibition(exhibitionId))) {
    throw new Error('You are not on this exhibition’s team.');
  }
}

/** Who may decide: the named approver for this exhibition, or a sysadmin as the
 *  standing fallback so an event is never stuck behind one absent person. */
async function assertCanApprove(exhibitionId: number, user: Me): Promise<void> {
  if (hasRole(user.role, 'sysadmin')) return;
  const { rows } = await risansiPool.query<{ approver_id: number | null }>(
    'SELECT approver_id FROM exhibitions WHERE id = $1', [exhibitionId],
  );
  if (!rows[0]) throw new Error('Exhibition not found.');
  if (rows[0].approver_id != null && user.id != null && Number(rows[0].approver_id) === Number(user.id)) return;
  throw new Error('Only the nominated approver can decide on this exhibition.');
}

function touch(id: number) {
  revalidatePath('/risansi/exhibitions');
  revalidatePath(`/risansi/exhibitions/${id}`);
}

// ── Exhibition ───────────────────────────────────────────────────

export async function createExhibition(fd: FormData) {
  const user = await requireUser();
  const name = str(fd, 'name');
  if (!name) throw new Error('Exhibition name is required.');

  const start = str(fd, 'start_date');
  const end   = str(fd, 'end_date');
  if (start && end && end < start) throw new Error('End date cannot be before the start date.');

  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO exhibitions
       (name, organizer, website, venue, city, state, country, industry, source,
        start_date, end_date, suggested, estimated_cost_inr, recommendation,
        approver_id, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'India'),$8,$9,$10,$11,$12,$13,$14,$15,$16,
             (SELECT name FROM users WHERE id = $16))
     RETURNING id`,
    [
      name, str(fd, 'organizer'), str(fd, 'website'), str(fd, 'venue'),
      str(fd, 'city'), str(fd, 'state'), str(fd, 'country'), str(fd, 'industry'),
      str(fd, 'source'), start, end, str(fd, 'suggested'),
      inr(fd, 'estimated_cost_inr'), str(fd, 'recommendation'),
      fd.get('approver_id') ? Number(fd.get('approver_id')) : null,
      user.id,
    ],
  );
  const id = rows[0].id;
  await recordAudit({
    action: 'exhibition_created', entityType: 'exhibition', entityId: String(id),
    entityLabel: name, summary: `created exhibition ${name}`, actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  return id;
}

export async function updateExhibition(id: number, fd: FormData) {
  const user = await requireUser();
  await assertCanManage(id);

  const start = str(fd, 'start_date');
  const end   = str(fd, 'end_date');
  if (start && end && end < start) throw new Error('End date cannot be before the start date.');

  const status = str(fd, 'status');
  if (status != null && !isExhibitionStatus(status)) throw new Error('Unknown status.');
  // Submitted / Approved / Rejected are owned by the approval flow. Letting the
  // edit form set them would let a submitter approve their own exhibition.
  if (status && ['Submitted', 'Approved', 'Rejected'].includes(status)) {
    throw new Error('Use Submit or the approval decision to move to that status.');
  }

  await risansiPool.query(
    `UPDATE exhibitions SET
       name = COALESCE($2, name), organizer = $3, website = $4, venue = $5,
       city = $6, state = $7, country = $8, industry = $9, source = $10,
       start_date = $11, end_date = $12, suggested = $13,
       estimated_cost_inr = $14, recommendation = $15,
       status = COALESCE($16, status),
       approver_id = COALESCE($17, approver_id),
       updated_at = NOW()
     WHERE id = $1`,
    [
      id, str(fd, 'name'), str(fd, 'organizer'), str(fd, 'website'), str(fd, 'venue'),
      str(fd, 'city'), str(fd, 'state'), str(fd, 'country'), str(fd, 'industry'),
      str(fd, 'source'), start, end, str(fd, 'suggested'),
      inr(fd, 'estimated_cost_inr'), str(fd, 'recommendation'),
      status as ExhibitionStatus | null,
      fd.get('approver_id') ? Number(fd.get('approver_id')) : null,
    ],
  );
  await recordAudit({
    action: 'exhibition_updated', entityType: 'exhibition', entityId: String(id),
    summary: 'updated exhibition details', actorEmail: user.email,
  }).catch(() => {});
  touch(id);
}

export async function deleteExhibition(id: number) {
  const user = await requireUser();
  if (!hasRole(user.role, 'admin')) throw new Error('Only an admin can delete an exhibition.');
  await risansiPool.query('DELETE FROM exhibitions WHERE id = $1', [id]);
  await recordAudit({
    action: 'exhibition_deleted', entityType: 'exhibition', entityId: String(id),
    summary: 'deleted exhibition', actorEmail: user.email,
  }).catch(() => {});
  revalidatePath('/risansi/exhibitions');
}

// ── Approval ─────────────────────────────────────────────────────

export async function submitForApproval(id: number, note?: string) {
  const user = await requireUser();
  await assertCanManage(id);

  const { rows } = await risansiPool.query<{ status: string; approver_id: number | null }>(
    'SELECT status, approver_id FROM exhibitions WHERE id = $1', [id],
  );
  const ex = rows[0];
  if (!ex) throw new Error('Exhibition not found.');
  if (ex.status === 'Submitted') throw new Error('This exhibition is already awaiting a decision.');
  if (!ex.approver_id) throw new Error('Nominate an approver before submitting.');

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exhibitions SET status='Submitted', submitted_by=$2, submitted_at=NOW(), updated_at=NOW()
        WHERE id=$1`, [id, user.id],
    );
    await client.query(
      `INSERT INTO exhibition_approvals (exhibition_id, decision, actor_id, actor_name, comments)
       VALUES ($1,'Submitted',$2,(SELECT name FROM users WHERE id=$2),$3)`,
      [id, user.id, note ?? null],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_submitted', entityType: 'exhibition', entityId: String(id),
    summary: 'submitted exhibition for approval', actorEmail: user.email,
  }).catch(() => {});
  touch(id);
}

export async function decideExhibition(id: number, decision: Decision, comments?: string) {
  const user = await requireUser();
  if (!isDecision(decision)) throw new Error('Unknown decision.');
  await assertCanApprove(id, user);

  // 'More Info' returns it to the submitter rather than closing it out, so the
  // earlier approval rows stay as history and a resubmission appends to them.
  const nextStatus: ExhibitionStatus =
    decision === 'Reject' ? 'Rejected' : decision === 'More Info' ? 'Shortlisted' : 'Approved';
  const participation = decision === 'Exhibit' || decision === 'Visit' ? decision : null;

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exhibitions
          SET status=$2, participation=COALESCE($3, participation),
              decided_by=$4, decided_at=NOW(), decision_notes=$5, updated_at=NOW()
        WHERE id=$1`,
      [id, nextStatus, participation, user.id, comments ?? null],
    );
    await client.query(
      `INSERT INTO exhibition_approvals (exhibition_id, decision, actor_id, actor_name, comments)
       VALUES ($1,$2,$3,(SELECT name FROM users WHERE id=$3),$4)`,
      [id, decision, user.id, comments ?? null],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_decision', entityType: 'exhibition', entityId: String(id),
    summary: `decision: ${decision}`, actorEmail: user.email,
  }).catch(() => {});
  touch(id);
}

// ── Team ─────────────────────────────────────────────────────────

export async function setExhibitionTeam(id: number, members: { userId: number; role: string }[]) {
  const user = await requireUser();
  await assertCanManage(id);

  const clean = members
    .filter(m => Number.isInteger(m.userId) && m.userId > 0)
    .map(m => ({ userId: m.userId, role: m.role === 'Team Lead' ? 'Team Lead' : 'Member' }));
  if (clean.length && !clean.some(m => m.role === 'Team Lead')) {
    throw new Error('Nominate one team lead.');
  }
  if (clean.filter(m => m.role === 'Team Lead').length > 1) {
    throw new Error('Only one team lead per exhibition.');
  }

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM exhibition_team WHERE exhibition_id = $1', [id]);
    for (const m of clean) {
      await client.query(
        `INSERT INTO exhibition_team (exhibition_id, user_id, team_role, added_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT (exhibition_id, user_id) DO NOTHING`,
        [id, m.userId, m.role, user.id],
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_team_set', entityType: 'exhibition', entityId: String(id),
    summary: `assigned ${clean.length} team member(s)`, actorEmail: user.email,
  }).catch(() => {});
  touch(id);
}

// ── Meetings (the lookup lives here) ─────────────────────────────

export async function saveExhibitionMeeting(exhibitionId: number, fd: FormData, meetingId?: number) {
  const user = await requireUser();
  await assertCanManage(exhibitionId);

  const company = str(fd, 'company_name');
  if (!company) throw new Error('Company name is required.');

  // The lookup: a client id only counts if the row really exists and is not
  // deleted. A stale or forged id degrades to NULL — an unlinked meeting — rather
  // than pointing at nothing or at a removed client.
  let clientId: number | null = null;
  const rawClientId = fd.get('client_id');
  if (rawClientId && Number.isInteger(Number(rawClientId))) {
    const { rows } = await risansiPool.query<{ id: number }>(
      'SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL', [Number(rawClientId)],
    );
    clientId = rows[0]?.id ?? null;
  }

  const vals = [
    exhibitionId, clientId, company, str(fd, 'contact_person'), str(fd, 'designation'),
    str(fd, 'phone'), str(fd, 'email'), str(fd, 'city'), str(fd, 'discussion'),
    str(fd, 'requirement'), str(fd, 'outcome'), str(fd, 'next_action'),
    str(fd, 'follow_up_date'), str(fd, 'interest'), inr(fd, 'potential_value_inr'),
  ];

  if (meetingId) {
    await risansiPool.query(
      `UPDATE exhibition_meetings SET
         client_id=$2, company_name=$3, contact_person=$4, designation=$5, phone=$6,
         email=$7, city=$8, discussion=$9, requirement=$10, outcome=$11,
         next_action=$12, follow_up_date=$13, interest=$14, potential_value_inr=$15,
         updated_at=NOW()
       WHERE id=$16 AND exhibition_id=$1`,
      [...vals, meetingId],
    );
  } else {
    await risansiPool.query(
      `INSERT INTO exhibition_meetings
         (exhibition_id, client_id, company_name, contact_person, designation, phone,
          email, city, discussion, requirement, outcome, next_action, follow_up_date,
          interest, potential_value_inr, met_by, met_by_name, met_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               (SELECT name FROM users WHERE id=$16), COALESCE($17::date, CURRENT_DATE))`,
      [...vals, user.id, str(fd, 'met_on')],
    );
  }

  await recordAudit({
    action: meetingId ? 'exhibition_meeting_updated' : 'exhibition_meeting_added',
    entityType: 'exhibition', entityId: String(exhibitionId),
    summary: `${meetingId ? 'updated' : 'captured'} meeting with ${company}${clientId ? ' (existing client)' : ''}`,
    actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
}

export async function deleteExhibitionMeeting(exhibitionId: number, meetingId: number) {
  await requireUser();
  await assertCanManage(exhibitionId);
  await risansiPool.query(
    'DELETE FROM exhibition_meetings WHERE id = $1 AND exhibition_id = $2',
    [meetingId, exhibitionId],
  );
  touch(exhibitionId);
}

// ── Expenses ─────────────────────────────────────────────────────

export async function saveExhibitionExpense(exhibitionId: number, fd: FormData, expenseId?: number) {
  const user = await requireUser();
  await assertCanManage(exhibitionId);

  const category = str(fd, 'category');
  if (!category) throw new Error('Pick an expense category.');

  const actual = inr(fd, 'actual_inr');
  const paid   = inr(fd, 'paid_inr') ?? 0;
  // Mirror the DB constraint so the user gets a sentence, not a Postgres error.
  if (actual != null && paid > actual) throw new Error('Paid amount cannot exceed the actual amount.');

  const vals = [
    exhibitionId, category, str(fd, 'description'), str(fd, 'vendor'),
    inr(fd, 'estimated_inr'), actual, paid, str(fd, 'paid_on'),
  ];

  if (expenseId) {
    await risansiPool.query(
      `UPDATE exhibition_expenses SET
         category=$2, description=$3, vendor=$4, estimated_inr=$5, actual_inr=$6,
         paid_inr=$7, paid_on=$8, updated_at=NOW()
       WHERE id=$9 AND exhibition_id=$1`,
      [...vals, expenseId],
    );
  } else {
    await risansiPool.query(
      `INSERT INTO exhibition_expenses
         (exhibition_id, category, description, vendor, estimated_inr, actual_inr,
          paid_inr, paid_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [...vals, user.id],
    );
  }
  touch(exhibitionId);
}

export async function deleteExhibitionExpense(exhibitionId: number, expenseId: number) {
  await requireUser();
  await assertCanManage(exhibitionId);
  await risansiPool.query(
    'DELETE FROM exhibition_expenses WHERE id = $1 AND exhibition_id = $2',
    [expenseId, exhibitionId],
  );
  touch(exhibitionId);
}
