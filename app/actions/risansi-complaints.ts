'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole, canViewClient, type CurrentUser } from '@/lib/risansi-auth';
import { notifyComplaintRaised } from '@/lib/risansi-email';
import { pushInApp } from '@/lib/risansi-inapp';
import { notifyComplaintClosed, notifyComplaintUpdate } from '@/lib/risansi-notify';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Email whoever a complaint was escalated to — the in-system user (looked up by
// id) or an external person at the address captured with them. Best-effort: any
// failure is logged and swallowed so it can never break the complaint action.
async function notifyComplaintRecipient(opts: {
  creatorEmail: string; complaintNo: string; clientName?: string | null;
  details: string; priority?: string | null; dueDate?: string | null; channel?: string | null;
  assignedUser?: number | null; assignedExt?: string | null; assignedExtEmail?: string | null;
}) {
  try {
    let to: string | null = null;
    let toName: string | null = null;
    if (opts.assignedUser) {
      const u = (await risansiPool.query<{ name: string | null; email: string | null }>(
        'SELECT name, email FROM users WHERE id = $1', [opts.assignedUser])).rows[0];
      if (!u?.email) return;
      if (u.email.toLowerCase() === opts.creatorEmail.toLowerCase()) return;  // don't self-notify
      to = u.email; toName = u.name;
    } else if (opts.assignedExt && opts.assignedExtEmail) {
      to = opts.assignedExtEmail; toName = opts.assignedExt;
    }
    if (!to) return;
    const creator = (await risansiPool.query<{ name: string | null }>(
      'SELECT name FROM users WHERE email = $1', [opts.creatorEmail])).rows[0];
    await notifyComplaintRaised({
      to, toName,
      raisedBy: creator?.name || opts.creatorEmail,
      complaintNo: opts.complaintNo,
      clientName: opts.clientName,
      details: opts.details,
      priority: opts.priority,
      dueDate: opts.dueDate,
      channel: opts.channel,
    });
    if (opts.assignedUser) {
      await pushInApp([opts.assignedUser], {
        kind: 'complaint_raised', section: 'Complaints', actor: opts.creatorEmail,
        title: `Complaint escalated to you: ${opts.complaintNo}`, body: opts.details,
        link: '/risansi/complaints', entityType: 'complaint',
      });
    }
  } catch (e) {
    console.error('[complaint] recipient notification failed', e);
  }
}

// NOTE: a 'use server' module may only export async functions, so these stay
// as local (non-exported) constants — exporting them breaks the production build.
const COMPLAINT_STATUSES = ['Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed'] as const;
const COMPLAINT_PRIORITIES = ['High', 'Medium', 'Low'] as const;

function str(fd: FormData, k: string): string | null {
  const v = (fd.get(k) as string | null)?.trim();
  return v ? v : null;
}
function intField(fd: FormData, k: string): number | null {
  const v = (fd.get(k) as string | null)?.trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Assignment grants complaint visibility, so the target must be a real, active
// user. Returns the validated id or throws.
async function validateAssignee(id: number | null): Promise<number | null> {
  if (id == null) return null;
  const { rows } = await risansiPool.query('SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE', [id]);
  if (rows.length === 0) throw new Error('That person is not a valid active user');
  return id;
}

interface ComplaintRow {
  id: number; client_id: number | null; assigned_to_user: number | null;
  created_by: string | null; reported_by_user: number | null; status: string;
}

// A user may access a complaint when: admin/sysadmin, OR they raised it, OR it
// is assigned to them, OR its client is on one of their tours.
async function loadForUser(id: number): Promise<{ user: CurrentUser; row: ComplaintRow; canAccess: boolean }> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<ComplaintRow>(
    `SELECT id, client_id, assigned_to_user, created_by, reported_by_user, status FROM complaints WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('Complaint not found');

  let canAccess = hasRole(user.role, 'admin');
  if (!canAccess && user.id != null) {
    if (row.assigned_to_user === user.id) canAccess = true;
    else if (user.email && row.created_by && row.created_by.toLowerCase() === user.email.toLowerCase()) canAccess = true;
    else if (row.client_id != null) canAccess = await canViewClient(user, row.client_id);
  }
  return { user, row, canAccess };
}

// Next CMP-#### number (continues the real series, ignoring 10000+ fallback ids).
async function nextComplaintNo(): Promise<string> {
  const { rows } = await risansiPool.query<{ next: number }>(
    `SELECT COALESCE(MAX(n), 165) + 1 AS next
       FROM (SELECT NULLIF(regexp_replace(complaint_no, '[^0-9]', '', 'g'), '')::int AS n FROM complaints) t
      WHERE n < 10000`,
  );
  return `CMP-${String(rows[0]?.next ?? 166).padStart(4, '0')}`;
}

// ── Create ─────────────────────────────────────────────────────
export async function createComplaint(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');

  const clientId = intField(fd, 'client_id');
  if (clientId == null) throw new Error('Pick a client');
  if (!(await canViewClient(user, clientId))) throw new Error('You can only raise complaints for your own clients');

  const details = str(fd, 'details');
  if (!details) throw new Error('Complaint details are required');

  const assignedUser = await validateAssignee(intField(fd, 'assigned_to_user'));
  const assignedExt  = str(fd, 'assigned_to_external');
  const assignedExtEmail = str(fd, 'assigned_to_external_email');
  if (assignedUser == null && !assignedExt) throw new Error('Assign the complaint to someone');
  // An external handler (not in the system) must come with a valid email so they
  // can be notified — mirrors the Action Registry.
  if (assignedUser == null && assignedExt) {
    if (!assignedExtEmail) throw new Error('An email is required for a person outside the system.');
    if (!EMAIL_RE.test(assignedExtEmail)) throw new Error('Please enter a valid email for the external person.');
  }

  const priority = str(fd, 'priority') ?? 'Medium';
  const channel  = str(fd, 'channel');
  const dueDate  = str(fd, 'due_date');

  const { rows: c } = await risansiPool.query<{ code: string; legal_name: string | null }>(
    'SELECT code, legal_name FROM clients WHERE id = $1', [clientId]);

  // Retry on the (rare) unique-number race.
  let savedNo = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const no = await nextComplaintNo();
    try {
      await risansiPool.query(
        `INSERT INTO complaints (
           complaint_no, client_id, client_code, channel, complaint_date, details,
           part_name, quantity, pump_model, invoice_no, invoice_date, client_po_no, client_po_date,
           priority, status, due_date, assigned_to_user, assigned_to_external, reported_by_user,
           source, created_by, assigned_to_external_email, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Open',$15,$16,$17,$18,'app',$19,$20,now(),now())`,
        [
          no, clientId, c[0]?.code ?? null, channel, str(fd, 'complaint_date'), details,
          str(fd, 'part_name'), intField(fd, 'quantity'), str(fd, 'pump_model'),
          str(fd, 'invoice_no'), str(fd, 'invoice_date'), str(fd, 'client_po_no'), str(fd, 'client_po_date'),
          COMPLAINT_PRIORITIES.includes(priority as never) ? priority : 'Medium',
          dueDate, assignedUser, assignedExt, user.id,
          user.email, assignedExt ? assignedExtEmail : null,
        ],
      );
      savedNo = no;
      break;
    } catch (e) {
      if (attempt === 3 || !(e instanceof Error) || !/complaints_complaint_no_key|duplicate key/i.test(e.message)) throw e;
    }
  }

  revalidatePath('/risansi/complaints');
  if (clientId) revalidatePath(`/risansi/clients/${clientId}`);

  // Notify the responsible person by email — in-system user or external handler.
  if (savedNo) {
    await notifyComplaintRecipient({
      creatorEmail: user.email,
      complaintNo: savedNo,
      clientName: c[0]?.legal_name ?? null,
      details, priority, dueDate, channel,
      assignedUser, assignedExt, assignedExtEmail: assignedExt ? assignedExtEmail : null,
    });
  }
}

// ── Edit core fields (creator while open, assignee, or admin) ──
export async function updateComplaint(fd: FormData): Promise<void> {
  const id = intField(fd, 'id');
  if (id == null) throw new Error('Invalid complaint');
  const { user, row, canAccess } = await loadForUser(id);
  if (!canAccess) throw new Error('Not allowed');
  // Reps can edit while the complaint is still open/in-progress; admins anytime.
  if (!hasRole(user.role, 'admin') && (row.status === 'Closed')) {
    throw new Error('Closed complaints can only be edited by an admin');
  }

  await risansiPool.query(
    `UPDATE complaints SET
       channel = $1, complaint_date = $2, details = COALESCE($3, details),
       part_name = $4, quantity = $5, pump_model = $6,
       invoice_no = $7, invoice_date = $8, client_po_no = $9, client_po_date = $10,
       priority = $11, due_date = $12, root_cause = $13, resolution = $14, updated_at = now()
     WHERE id = $15`,
    [
      str(fd, 'channel'), str(fd, 'complaint_date'), str(fd, 'details'),
      str(fd, 'part_name'), intField(fd, 'quantity'), str(fd, 'pump_model'),
      str(fd, 'invoice_no'), str(fd, 'invoice_date'), str(fd, 'client_po_no'), str(fd, 'client_po_date'),
      str(fd, 'priority') ?? 'Medium', str(fd, 'due_date'), str(fd, 'root_cause'), str(fd, 'resolution'), id,
    ],
  );
  revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);
}

// ── Status change (Closed = admin only; up to Resolved = anyone with access) ──
export async function setComplaintStatus(fd: FormData): Promise<void> {
  const id = intField(fd, 'id');
  const status = str(fd, 'status') ?? '';
  if (id == null || !COMPLAINT_STATUSES.includes(status as never)) throw new Error('Invalid status change');
  const { user, row, canAccess } = await loadForUser(id);
  if (!canAccess) throw new Error('Not allowed');
  if (status === 'Closed' && !hasRole(user.role, 'admin')) {
    throw new Error('Only an admin can close a complaint — you can mark it Resolved');
  }
  // Closed is terminal for everyone except admins: re-opening (Closed → other)
  // is admin-only, mirroring the admin-only close.
  if (row.status === 'Closed' && status !== 'Closed' && !hasRole(user.role, 'admin')) {
    throw new Error('Only an admin can re-open a closed complaint');
  }
  if (row.status === status) return; // no-op

  const actor = user.email ?? 'system';
  await risansiPool.query(
    `UPDATE complaints SET
       status = $1,
       resolved_at = CASE WHEN $1 IN ('Resolved','Closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
       resolved_by = CASE WHEN $1 IN ('Resolved','Closed') THEN COALESCE(resolved_by, $2) ELSE NULL END,
       closed_at   = CASE WHEN $1 = 'Closed' THEN now()  ELSE NULL END,
       closed_by   = CASE WHEN $1 = 'Closed' THEN $2     ELSE NULL END,
       updated_at  = now()
     WHERE id = $3`,
    [status, actor, id],
  );
  await risansiPool.query(
    `INSERT INTO complaint_updates (complaint_id, body, created_by) VALUES ($1, $2, $3)`,
    [id, `Status changed to ${status}`, actor],
  );
  revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);

  // Tell the raiser + assignee once it's resolved / closed.
  if (status === 'Resolved' || status === 'Closed') await notifyComplaintClosed(id, actor);
}

// ── Reassign (creator, assignee, manager/rep on the tour, or admin) ──
export async function reassignComplaint(fd: FormData): Promise<void> {
  const id = intField(fd, 'id');
  if (id == null) throw new Error('Invalid complaint');
  const { user, row, canAccess } = await loadForUser(id);
  if (!canAccess) throw new Error('Not allowed');

  const assignedUser = await validateAssignee(intField(fd, 'assigned_to_user'));
  const assignedExt  = str(fd, 'assigned_to_external');
  const assignedExtEmail = str(fd, 'assigned_to_external_email');
  if (assignedUser == null && !assignedExt) throw new Error('Pick who to assign it to');
  if (assignedUser == null && assignedExt) {
    if (!assignedExtEmail) throw new Error('An email is required for a person outside the system.');
    if (!EMAIL_RE.test(assignedExtEmail)) throw new Error('Please enter a valid email for the external person.');
  }

  await risansiPool.query(
    `UPDATE complaints SET assigned_to_user = $1, assigned_to_external = $2, assigned_to_external_email = $3, updated_at = now() WHERE id = $4`,
    [assignedUser, assignedExt, assignedExt ? assignedExtEmail : null, id],
  );
  const label = assignedExt ?? (await risansiPool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [assignedUser])).rows[0]?.name ?? 'someone';
  await risansiPool.query(
    `INSERT INTO complaint_updates (complaint_id, body, created_by) VALUES ($1, $2, $3)`,
    [id, `Reassigned to ${label}`, user.email ?? 'system'],
  );
  revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);

  // Notify the new assignee by email (best-effort).
  if (user.email) {
    const info = (await risansiPool.query<{ complaint_no: string; details: string; priority: string | null; due_date: string | null; channel: string | null; legal_name: string | null }>(
      `SELECT co.complaint_no, co.details, co.priority, co.due_date::text AS due_date, co.channel, cl.legal_name
         FROM complaints co LEFT JOIN clients cl ON cl.id = co.client_id WHERE co.id = $1`, [id])).rows[0];
    if (info) {
      await notifyComplaintRecipient({
        creatorEmail: user.email,
        complaintNo: info.complaint_no,
        clientName: info.legal_name,
        details: info.details,
        priority: info.priority,
        dueDate: info.due_date,
        channel: info.channel,
        assignedUser, assignedExt, assignedExtEmail: assignedExt ? assignedExtEmail : null,
      });
    }
  }
}

// ── Add an update-log entry (anyone with access) ──
export async function addComplaintUpdate(fd: FormData): Promise<void> {
  const id = intField(fd, 'id');
  const body = str(fd, 'body');
  if (id == null || !body) throw new Error('Write something to log');
  const { user, row, canAccess } = await loadForUser(id);
  if (!canAccess) throw new Error('Not allowed');

  await risansiPool.query(
    `INSERT INTO complaint_updates (complaint_id, body, created_by) VALUES ($1, $2, $3)`,
    [id, body, user.email ?? 'system'],
  );
  await risansiPool.query('UPDATE complaints SET updated_at = now() WHERE id = $1', [id]);
  revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);

  await notifyComplaintUpdate(id, user.email ?? '', body);
}

// ── Delete (admin only) ──
export async function deleteComplaint(fd: FormData): Promise<void> {
  const id = intField(fd, 'id');
  if (id == null) throw new Error('Invalid complaint');
  const user = await getCurrentUser();
  if (!hasRole(user.role, 'admin')) throw new Error('Only an admin can delete a complaint');
  await risansiPool.query('DELETE FROM complaints WHERE id = $1', [id]);
  revalidatePath('/risansi/complaints');
}
