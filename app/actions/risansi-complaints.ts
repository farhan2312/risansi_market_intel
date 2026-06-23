'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole, canViewClient, type CurrentUser } from '@/lib/risansi-auth';

export const COMPLAINT_STATUSES = ['Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed'] as const;
export const COMPLAINT_PRIORITIES = ['High', 'Medium', 'Low'] as const;

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
  if (assignedUser == null && !assignedExt) throw new Error('Assign the complaint to someone');

  const priority = str(fd, 'priority') ?? 'Medium';
  const channel  = str(fd, 'channel');

  const { rows: c } = await risansiPool.query<{ code: string }>('SELECT code FROM clients WHERE id = $1', [clientId]);

  // Retry on the (rare) unique-number race.
  for (let attempt = 0; attempt < 4; attempt++) {
    const no = await nextComplaintNo();
    try {
      await risansiPool.query(
        `INSERT INTO complaints (
           complaint_no, client_id, client_code, channel, complaint_date, details,
           part_name, quantity, pump_model, invoice_no, invoice_date, client_po_no, client_po_date,
           priority, status, due_date, assigned_to_user, assigned_to_external, reported_by_user,
           source, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Open',$15,$16,$17,$18,'app',$19,now(),now())`,
        [
          no, clientId, c[0]?.code ?? null, channel, str(fd, 'complaint_date'), details,
          str(fd, 'part_name'), intField(fd, 'quantity'), str(fd, 'pump_model'),
          str(fd, 'invoice_no'), str(fd, 'invoice_date'), str(fd, 'client_po_no'), str(fd, 'client_po_date'),
          COMPLAINT_PRIORITIES.includes(priority as never) ? priority : 'Medium',
          str(fd, 'due_date'), assignedUser, assignedExt, user.id,
          user.email,
        ],
      );
      break;
    } catch (e) {
      if (attempt === 3 || !(e instanceof Error) || !/complaints_complaint_no_key|duplicate key/i.test(e.message)) throw e;
    }
  }

  revalidatePath('/risansi/complaints');
  if (clientId) revalidatePath(`/risansi/clients/${clientId}`);
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
}

// ── Reassign (creator, assignee, manager/rep on the tour, or admin) ──
export async function reassignComplaint(fd: FormData): Promise<void> {
  const id = intField(fd, 'id');
  if (id == null) throw new Error('Invalid complaint');
  const { user, row, canAccess } = await loadForUser(id);
  if (!canAccess) throw new Error('Not allowed');

  const assignedUser = await validateAssignee(intField(fd, 'assigned_to_user'));
  const assignedExt  = str(fd, 'assigned_to_external');
  if (assignedUser == null && !assignedExt) throw new Error('Pick who to assign it to');

  await risansiPool.query(
    `UPDATE complaints SET assigned_to_user = $1, assigned_to_external = $2, updated_at = now() WHERE id = $3`,
    [assignedUser, assignedExt, id],
  );
  const label = assignedExt ?? (await risansiPool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [assignedUser])).rows[0]?.name ?? 'someone';
  await risansiPool.query(
    `INSERT INTO complaint_updates (complaint_id, body, created_by) VALUES ($1, $2, $3)`,
    [id, `Reassigned to ${label}`, user.email ?? 'system'],
  );
  revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);
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
