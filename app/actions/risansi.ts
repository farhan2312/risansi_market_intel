'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getManagerAssignableReps, hasRole, getCurrentUser, canViewClient, hasSpecialClientAccess, type RisansiRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';
import { normalizeClientName, uniqueLeadCode } from '@/lib/risansi-lead-code';
import {
  isProspectiveStatus, isLeadCode, CLIENT_STATUSES,
  allowedStatusesForCode, clientStatusLabel,
} from '@/lib/risansi-client-status';
import { resolveClientPrimaryRep } from '@/lib/risansi-client-rep';
import { parseSalesOrdersJson, inrToCr, type SoInput, type SalesOrder } from '@/lib/risansi-sales-orders';
import { poInrToCr, type PurchaseOrder } from '@/lib/risansi-purchase-orders';
import { notifyVisitPlanned } from '@/lib/risansi-email';
import { notifyCheckIn, notifyOppClosed, notifySalesOrder, notifyNewLead, notifyQuotationIssued } from '@/lib/risansi-notify';
import { requiredFieldNames, labelsFor, CREATE_STAGES, STAGE_PROB, type CreateStage } from '@/lib/risansi-opportunity-fields';
import { pctForProbabilityCode } from '@/lib/risansi-probability-codes';
import { normaliseIndustry } from '@/lib/risansi-utils';

// ── Helper ─────────────────────────────────────────────────────

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  return session.user;
}

// Resolve which user a visit/opportunity is owned by, enforcing role rules:
//   rep      → ALWAYS themselves (session id, email fallback); errors if the
//              account isn't linked — the form's rep_id is ignored.
//   manager  → the submitted rep_id, REQUIRED and validated to fall within
//              their tours. No client-primary fallback (flat owner model).
//   admin/+  → the submitted rep_id, REQUIRED.
async function resolveAssignableRepId(
  user: { role?: string; repId?: number | null; email?: string | null },
  formRepId: string | null,
): Promise<number> {
  const role = user.role ?? 'rep';

  if (role === 'rep') {
    let repId = typeof user.repId === 'number' ? user.repId : null;
    if (!repId && user.email) {
      const { rows } = await risansiPool.query<{ id: number }>(
        'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
        [user.email],
      );
      repId = rows[0]?.id ?? null;
    }
    if (!repId) {
      throw new Error('Your account is not linked to a user record. Please contact the system administrator.');
    }
    return repId;
  }

  const parsed = formRepId ? parseInt(formRepId, 10) : NaN;
  const repId: number | null = Number.isInteger(parsed) ? parsed : null;
  if (!repId) {
    throw new Error('Please select an owner for this visit/opportunity.');
  }

  if (role === 'manager' && typeof user.repId === 'number') {
    const allowed = await getManagerAssignableReps(user.repId);
    if (!allowed.includes(repId)) {
      throw new Error('You can only assign to people in your assigned tours.');
    }
  }

  return repId;
}

// Responsible reps/managers now derive from the client's tour (tour_assignments);
// there is no direct client→rep assignment table any more. A client is put on a
// tour via clients.tour_id (set in add/updateClient and the Tour Mapping admin).

// Can this user move / edit an opportunity owned by `oppRepId`?
//   admin/sysadmin → always · assigned rep → own · manager → reps sharing a tour.
// An opportunity belongs to the client's TOUR, not one owner: anyone who can SEE
// the client (a rep/manager on its tour, a special-access grantee, or admin) may
// edit it. `clientId` is what makes this tour-based — pass it wherever possible.
// The oppRepId fast-path and the manager fallback remain for callers that don't.
async function userCanEditOpp(
  user: { role?: string; repId?: number | null; email?: string | null },
  oppRepId: number | null,
  clientId?: number | null,
): Promise<boolean> {
  const role = user.role ?? 'rep';
  if (hasRole(role, 'admin')) return true;
  if (user.repId != null && oppRepId != null && Number(oppRepId) === Number(user.repId)) return true;
  if (clientId != null) {
    return canViewClient({ id: user.repId ?? null, email: user.email ?? null, role: role as RisansiRole }, Number(clientId));
  }
  if (role === 'manager' && user.repId != null && oppRepId != null) {
    const assignable = await getManagerAssignableReps(user.repId);
    return assignable.includes(Number(oppRepId));
  }
  return false;
}

// Cached set of columns that actually exist on the opportunities table.
// Lets writes degrade gracefully when optional columns aren't present.
let _oppColumns: Set<string> | null = null;
async function opportunityColumns(): Promise<Set<string>> {
  if (_oppColumns) return _oppColumns;
  try {
    const { rows } = await risansiPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'opportunities'`,
    );
    _oppColumns = new Set(rows.map(r => r.column_name));
  } catch {
    _oppColumns = new Set();
  }
  return _oppColumns;
}

async function opportunitiesHasSecondaryRep(): Promise<boolean> {
  return (await opportunityColumns()).has('secondary_rep_id');
}

function auditVerb(action: string): string {
  if (/add|creat/i.test(action))        return 'create';
  if (/updat|edit|chang|rename/i.test(action)) return 'update';
  if (/delet|remov/i.test(action))      return 'delete';
  if (/assign/i.test(action))           return 'assign';
  if (/submit|close/i.test(action))     return 'submit';
  return 'activity';
}

async function logActivity(entityType: string, entityId: string, action: string, email: string) {
  // Persist into the unified audit_log (captures actor IP/UA via recordAudit).
  await recordAudit({ action: auditVerb(action), entityType, entityId, summary: action, actorEmail: email });
}

// ── Access request ─────────────────────────────────────────────

export async function requestAccess(_formData: FormData) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  const email = session.user.email.toLowerCase().trim();
  const displayName = session.user.name ?? email;

  // Self-service access requests land as Pending users for a sysadmin to approve.
  await risansiPool.query(
    `INSERT INTO users (email, name, status, role)
     VALUES ($1, $2, 'Pending', 'rep')
     ON CONFLICT (lower(email)) DO NOTHING`,
    [email, displayName],
  );

  await recordAudit({ action: 'create', entityType: 'access_request', entityId: email, summary: 'access_requested', actorEmail: email });

  redirect('/risansi');
}

// ── Client: add contact ────────────────────────────────────────

export async function addContact(formData: FormData): Promise<void> {
  const user = await requireSession();

  const clientId  = parseInt(formData.get('client_id') as string);
  const name      = (formData.get('name') as string | null)?.trim() ?? '';
  const isPrimary = formData.get('is_primary') === 'true';

  if (isNaN(clientId) || clientId <= 0) throw new Error('Invalid client ID');
  if (!name || name.length < 2) throw new Error('Contact name is required (min 2 characters)');

  const designation = (formData.get('designation') as string | null)?.trim() || null;
  const phone       = (formData.get('phone')       as string | null)?.trim() || null;
  const email       = (formData.get('email')       as string | null)?.trim() || null;
  const whatsapp    = (formData.get('whatsapp')    as string | null)?.trim() || null;
  const notes       = (formData.get('notes')       as string | null)?.trim() || null;

  // Clear existing primary first
  if (isPrimary) {
    await risansiPool.query(
      `UPDATE contacts SET is_primary = FALSE WHERE client_id = $1`,
      [clientId],
    );
  }

  await risansiPool.query(
    `INSERT INTO contacts
       (client_id, name, designation, is_primary,
        phone, email, whatsapp, notes,
        added_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
    [clientId, name, designation, isPrimary, phone, email, whatsapp, notes, user.email ?? 'system'],
  );

  await logActivity('client', String(clientId), `Contact Added: ${name}${designation ? ` (${designation})` : ''}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
}

// ── Client: update an existing contact ─────────────────────────

export async function updateContact(contactId: number, clientId: number, formData: FormData): Promise<void> {
  const user = await requireSession();

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name || name.length < 2) throw new Error('Contact name is required (min 2 characters)');

  const designation = (formData.get('designation') as string | null)?.trim() || null;
  const phone       = (formData.get('phone')       as string | null)?.trim() || null;
  const email       = (formData.get('email')       as string | null)?.trim() || null;
  const whatsapp    = (formData.get('whatsapp')    as string | null)?.trim() || null;
  const notes       = (formData.get('notes')       as string | null)?.trim() || null;
  const isPrimary   = formData.get('is_primary') === 'true';

  // Only one primary per client — clear others first
  if (isPrimary) {
    await risansiPool.query(
      `UPDATE contacts SET is_primary = FALSE WHERE client_id = $1 AND id != $2`,
      [clientId, contactId],
    );
  }

  await risansiPool.query(
    `UPDATE contacts SET
       name = $1, designation = $2, is_primary = $3,
       phone = $4, email = $5, whatsapp = $6, notes = $7,
       updated_at = NOW()
     WHERE id = $8`,
    [name, designation, isPrimary, phone, email, whatsapp, notes, contactId],
  );

  await logActivity('client', String(clientId), `Contact Updated: ${name}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
}

// ── Client: delete a contact ───────────────────────────────────

export async function deleteContact(contactId: number, clientId: number): Promise<void> {
  const user = await requireSession();
  await risansiPool.query('DELETE FROM contacts WHERE id = $1', [contactId]);
  await logActivity('client', String(clientId), 'Contact Deleted', user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
}

// ── Client: shared contact processing ──────────────────────────
// Used by both addClient and updateClient. Takes the full contact list
// (existing + new) plus the ids the user removed, and reconciles the
// contacts table: delete removed, update existing (id && !isNew),
// insert new. Only one primary is allowed per client.

interface ContactPayload {
  id?: number;
  name?: string;
  designation?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  is_primary?: boolean;
  isNew?: boolean;
}

async function saveContacts(
  clientId: number,
  contactsJson: string,
  deletedIds: number[],
  userEmail: string,
): Promise<void> {
  let contacts: ContactPayload[] = [];
  try {
    const parsed = JSON.parse(contactsJson || '[]');
    if (Array.isArray(parsed)) contacts = parsed;
  } catch { contacts = []; }

  // Delete removed contacts
  if (deletedIds.length > 0) {
    await risansiPool.query(
      `DELETE FROM contacts WHERE id = ANY($1::int[]) AND client_id = $2`,
      [deletedIds, clientId],
    );
  }

  // If any contact is set as primary, clear existing primary first
  const hasPrimary = contacts.some(c => c.is_primary);
  if (hasPrimary) {
    await risansiPool.query(
      `UPDATE contacts SET is_primary = FALSE WHERE client_id = $1`,
      [clientId],
    );
  }

  for (const ct of contacts) {
    if (!ct.name?.trim()) continue;

    if (ct.id && !ct.isNew) {
      // Update existing contact
      await risansiPool.query(
        `UPDATE contacts SET
           name        = $1, designation = $2,
           phone       = $3, email       = $4,
           whatsapp    = $5, is_primary  = $6,
           updated_at  = NOW()
         WHERE id = $7 AND client_id = $8`,
        [
          ct.name.trim(),
          ct.designation?.trim() || null,
          ct.phone?.trim() || null,
          ct.email?.trim() || null,
          ct.whatsapp?.trim() || null,
          ct.is_primary ?? false,
          ct.id, clientId,
        ],
      );
    } else {
      // Insert new contact
      await risansiPool.query(
        `INSERT INTO contacts
           (client_id, name, designation, phone, email, whatsapp, is_primary,
            added_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
        [
          clientId,
          ct.name.trim(),
          ct.designation?.trim() || null,
          ct.phone?.trim() || null,
          ct.email?.trim() || null,
          ct.whatsapp?.trim() || null,
          ct.is_primary ?? false,
          userEmail,
        ],
      );
    }
  }
}

function parseDeletedIds(raw: FormDataEntryValue | null): number[] {
  try {
    const parsed = JSON.parse((raw as string) || '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch { return []; }
}

// ── Client: update client details ─────────────────────────────

export async function updateClient(clientId: number, formData: FormData): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }
  const email = session!.user.email ?? 'system';

  // Fetch the current row for change logging (status + all editable fields).
  let currentStatus: string | null = null;
  let currentCode:   string | null = null;
  let oldRow: Record<string, unknown> | null = null;
  try {
    const { rows } = await risansiPool.query(
      `SELECT code, status, legal_name, trade_name, group_name, country, state, city, address,
              google_maps_url, market_type, industry, is_sugar, client_type, is_tender,
              capacity_bracket, tcd, klpd, tier, since_year, tour_id, is_end_client
         FROM clients WHERE id = $1`, [clientId],
    );
    oldRow = rows[0] ?? null;
    currentStatus = (rows[0]?.status as string | undefined) ?? null;
    currentCode   = (rows[0]?.code   as string | undefined) ?? null;
  } catch { /* ignore */ }

  const newStatus = (formData.get('status') as string | null)?.trim() || 'ACTIVE';

  // Client code — editable only from the Client Master page (the form there sends a
  // changed value; elsewhere it re-sends the current code, so nothing changes here).
  // Keep the current code if none submitted; never null it. Enforce the UNIQUE.
  const submittedCode = (formData.get('code') as string | null)?.trim().toUpperCase() || null;
  const newCode = submittedCode || currentCode;
  if (newCode && currentCode && newCode !== currentCode) {
    const dup = await risansiPool.query('SELECT 1 FROM clients WHERE UPPER(code) = $1 AND id <> $2', [newCode, clientId]);
    if (dup.rows.length > 0) throw new Error(`Client code "${newCode}" is already in use.`);
  }

  // Coupling: the status must be valid for the (final) code type — a LEAD_ code can
  // only be Prospective-Lead/Duplicate; a real code can't be Prospective-Lead. Enforced
  // on every save so a raw code edit (LEAD_ → real) can't leave a lead status behind.
  // The guided path for that transition is convertLeadToClient.
  if (!allowedStatusesForCode(newCode).includes(newStatus as never)) {
    throw new Error(`"${clientStatusLabel(newStatus)}" isn't a valid status for ${isLeadCode(newCode) ? 'a lead (LEAD_) code — use “Convert to Client” to assign an ERP code first' : 'a real client code'}.`);
  }

  // Update the client, and when the code changes cascade it to the denormalised
  // client_code snapshots — atomically, so the code and its copies never diverge.
  const clientTx = await risansiPool.connect();
  try {
    await clientTx.query('BEGIN');
    await clientTx.query(
    `UPDATE clients SET
       code               = $24,
       legal_name         = $1,
       trade_name         = $2,
       group_name         = $3,
       country            = $4,
       state              = $5,
       city               = $6,
       address            = $7,
       google_maps_url    = $8,
       market_type        = $9,
       industry           = $10,
       is_sugar           = $11,
       client_type        = $12,
       is_tender          = $13,
       capacity_bracket   = $14,
       tcd                = $15,
       klpd               = $16,
       status             = $17,
       tier               = $18,
       since_year         = $19,
       tour_id            = $20,
       is_end_client      = $23,
       updated_by         = $21,
       updated_at         = NOW()
     WHERE id = $22`,
    [
      (formData.get('legal_name')        as string | null)?.trim() || null,
      (formData.get('trade_name')        as string | null)?.trim() || null,
      (formData.get('group_name')        as string | null)?.trim() || null,
      (formData.get('country')           as string | null)?.trim() || 'India',
      (formData.get('state')             as string | null)?.trim() || null,
      (formData.get('city')              as string | null)?.trim() || null,
      (formData.get('address')           as string | null)?.trim() || null,
      (formData.get('google_maps_url')   as string | null)?.trim() || null,
      (formData.get('market_type')       as string | null)?.trim() || 'Domestic',
      normaliseIndustry((formData.get('industry') as string | null)?.trim() || null),
      formData.get('is_sugar') === 'true',
      (formData.get('client_type')       as string | null)?.trim() || null,
      formData.get('is_tender') === 'true',
      (formData.get('capacity_bracket')  as string | null)?.trim() || null,
      formData.get('tcd')  ? parseInt(formData.get('tcd')  as string) : null,
      formData.get('klpd') ? parseInt(formData.get('klpd') as string) : null,
      newStatus,
      (formData.get('tier')              as string | null)?.trim() || 'Standard',
      (formData.get('since_year')        as string | null)?.trim() || null,
      formData.get('tour_id') ? parseInt(formData.get('tour_id') as string, 10) : null,
      email,
      clientId,
      formData.get('is_end_client') === 'true',
      newCode,
    ],
    );

    if (newCode && currentCode && newCode !== currentCode) {
      // client_code is a plain text copy (no FK) in these tables. Update every row
      // for this client, plus orphaned rows still carrying the old code with no id.
      for (const tbl of ['client_pumps', 'competitor_installed_base', 'complaints']) {
        await clientTx.query(
          `UPDATE ${tbl} SET client_code = $1 WHERE client_id = $2 OR (client_code = $3 AND client_id IS NULL)`,
          [newCode, clientId, currentCode],
        );
      }
    }

    await clientTx.query('COMMIT');
  } catch (e) {
    await clientTx.query('ROLLBACK');
    throw e;
  } finally {
    clientTx.release();
  }

  // Owners (flat multi-owner model) + legacy shim + audit.
  // Owners derive from the client's tour (set via tour_id above); no direct sync.

  // Save contacts
  await saveContacts(
    clientId,
    (formData.get('contacts_json') as string) ?? '[]',
    parseDeletedIds(formData.get('deleted_contact_ids')),
    email,
  );

  // Log status change
  if (currentStatus && newStatus !== currentStatus) {
    try {
      await risansiPool.query(
        `INSERT INTO client_status_log
           (client_id, from_status, to_status, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, currentStatus, newStatus, 'Updated via edit form', email],
      );
    } catch { /* table may not exist */ }
  }

  // Describe what actually changed, so the activity feed is informative. This
  // diff is purely for logging — it never affects the UPDATE above.
  const gv = (k: string) => (formData.get(k) as string | null)?.trim() || null;
  const gi = (k: string) => (formData.get(k) ? parseInt(formData.get(k) as string, 10) : null);
  const specs: [string, string, unknown][] = [
    ['code', 'Client code', newCode],
    ['legal_name', 'Name', gv('legal_name')],
    ['trade_name', 'Trade name', gv('trade_name')],
    ['group_name', 'Group', gv('group_name')],
    ['country', 'Country', gv('country') || 'India'],
    ['state', 'State', gv('state')],
    ['city', 'City', gv('city')],
    ['address', 'Address', gv('address')],
    ['google_maps_url', 'Maps link', gv('google_maps_url')],
    ['market_type', 'Market', gv('market_type') || 'Domestic'],
    ['industry', 'Industry', gv('industry')],
    ['is_sugar', 'Sugar flag', formData.get('is_sugar') === 'true'],
    ['client_type', 'Client type', gv('client_type')],
    ['is_tender', 'Tender flag', formData.get('is_tender') === 'true'],
    ['capacity_bracket', 'Capacity', gv('capacity_bracket')],
    ['tcd', 'TCD', gi('tcd')],
    ['klpd', 'KLPD', gi('klpd')],
    ['status', 'Status', newStatus],
    ['tier', 'Tier', gv('tier') || 'Standard'],
    ['since_year', 'Since year', gv('since_year')],
    ['tour_id', 'Tour', gi('tour_id')],
    ['is_end_client', 'End-client flag', formData.get('is_end_client') === 'true'],
  ];
  const norm = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v).trim());
  const changed = oldRow ? specs.filter(([col, , nv]) => norm(oldRow![col]) !== norm(nv)).map(([, label]) => label) : [];
  const summary = changed.length
    ? `Client details updated: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` +${changed.length - 6} more` : ''}`
    : 'Client details updated';

  await logActivity('client', String(clientId), summary, email);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/admin/clients');
}

// ── Client comments (free-form notes on the Client 360) ────────
// Anyone who can SEE the client may add a comment; only the original author may
// edit or delete their own. All three events are logged to the activity feed.

// Short single-line preview of a comment for the activity feed.
function commentPreview(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

export async function addClientComment(clientId: number, body: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  if (!Number.isInteger(clientId)) throw new Error('Invalid client.');
  if (!(await canViewClient(user, clientId))) throw new Error('You do not have access to this client.');

  const text = (body ?? '').trim();
  if (!text) throw new Error('Comment cannot be empty.');
  if (text.length > 5000) throw new Error('Comment is too long (max 5000 characters).');

  const session = await getServerSession(authOptions);
  const authorName = session?.user?.name ?? user.email;

  await risansiPool.query(
    `INSERT INTO client_comments (client_id, author_email, author_name, body)
     VALUES ($1, $2, $3, $4)`,
    [clientId, user.email, authorName, text],
  );

  await logActivity('client', String(clientId), `Comment added: "${commentPreview(text)}"`, user.email);
  revalidatePath(`/risansi/clients/${clientId}`);
}

export async function updateClientComment(commentId: number, body: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  if (!Number.isInteger(commentId)) throw new Error('Invalid comment.');

  const text = (body ?? '').trim();
  if (!text) throw new Error('Comment cannot be empty.');
  if (text.length > 5000) throw new Error('Comment is too long (max 5000 characters).');

  const { rows } = await risansiPool.query<{ client_id: number; author_email: string }>(
    'SELECT client_id, author_email FROM client_comments WHERE id = $1', [commentId],
  );
  const row = rows[0];
  if (!row) throw new Error('Comment not found.');
  // Author-only — enforced here and in the WHERE clause below.
  if (row.author_email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error('You can only edit your own comment.');
  }

  const res = await risansiPool.query(
    'UPDATE client_comments SET body = $1, updated_at = now() WHERE id = $2 AND lower(author_email) = lower($3)',
    [text, commentId, user.email],
  );
  if (res.rowCount === 0) throw new Error('Comment not found.');

  await logActivity('client', String(row.client_id), `Comment edited: "${commentPreview(text)}"`, user.email);
  revalidatePath(`/risansi/clients/${row.client_id}`);
}

export async function deleteClientComment(commentId: number): Promise<void> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  if (!Number.isInteger(commentId)) throw new Error('Invalid comment.');

  const { rows } = await risansiPool.query<{ client_id: number; author_email: string }>(
    'SELECT client_id, author_email FROM client_comments WHERE id = $1', [commentId],
  );
  const row = rows[0];
  if (!row) return; // already gone — treat as success
  if (row.author_email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error('You can only delete your own comment.');
  }

  await risansiPool.query(
    'DELETE FROM client_comments WHERE id = $1 AND lower(author_email) = lower($2)',
    [commentId, user.email],
  );

  await logActivity('client', String(row.client_id), 'Comment deleted', user.email);
  revalidatePath(`/risansi/clients/${row.client_id}`);
}

// ── Client: plan visit ─────────────────────────────────────────

// Tag/untag clients as "End Client" (supplied indirectly via OEM/trader). Takes
// an array so it serves both the per-row toggle and any future bulk action.
export async function setEndClient(clientIds: number[], value: boolean): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) throw new Error('Unauthorized');
  const ids = (clientIds ?? []).filter(n => Number.isInteger(n));
  if (!ids.length) return;
  await risansiPool.query(
    `UPDATE clients SET is_end_client = $1, updated_at = NOW() WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [value, ids],
  );
  revalidatePath('/risansi/admin/clients');
}

// Email about a newly planned visit (best-effort). If the planner is the rep the
// visit is for, the tour's manager(s) are told; if a manager/admin planned it for
// someone else, that rep is told. Any failure is logged and swallowed.
async function notifyVisitPlan(opts: {
  plannerEmail: string; clientId: number; repId: number | null; visitDate: string; purpose: string;
}) {
  try {
    const { plannerEmail, clientId, repId, visitDate, purpose } = opts;
    const planner = (await risansiPool.query<{ id: number; name: string | null }>(
      'SELECT id, name FROM users WHERE lower(email) = lower($1)', [plannerEmail])).rows[0];
    const client = (await risansiPool.query<{ legal_name: string | null; tour_id: number | null }>(
      'SELECT legal_name, tour_id FROM clients WHERE id = $1', [clientId])).rows[0];
    if (!client) return;
    const rep = repId != null ? (await risansiPool.query<{ name: string | null; email: string | null }>(
      'SELECT name, email FROM users WHERE id = $1', [repId])).rows[0] : null;
    const plannedBy = planner?.name || plannerEmail;
    const plannerIsRep = planner?.id != null && repId != null && planner.id === repId;

    if (plannerIsRep) {
      if (client.tour_id == null) return;
      const mgrs = (await risansiPool.query<{ name: string | null; email: string | null }>(
        `SELECT u.name, u.email FROM tour_assignments ta JOIN users u ON u.id = ta.rep_id
          WHERE ta.tour_id = $1 AND ta.role = 'manager'`, [client.tour_id])).rows;
      for (const m of mgrs) {
        if (!m.email || m.email.toLowerCase() === plannerEmail.toLowerCase()) continue;
        await notifyVisitPlanned({
          to: m.email, toName: m.name, plannedBy,
          clientName: client.legal_name, visitDate, purpose,
          repName: rep?.name || plannedBy, audience: 'manager',
        });
      }
    } else {
      if (!rep?.email || rep.email.toLowerCase() === plannerEmail.toLowerCase()) return;
      await notifyVisitPlanned({
        to: rep.email, toName: rep.name, plannedBy,
        clientName: client.legal_name, visitDate, purpose,
        repName: rep.name, audience: 'rep',
      });
    }
  } catch (e) {
    console.error('[visit-plan] notification failed', e);
  }
}

export async function planVisit(clientId: string, formData: FormData) {
  const user = await requireSession();

  // Only for a client you can see (own tour or a special-access grant).
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) throw new Error('You do not have access to this client.');

  const visitDate = (formData.get('visit_date') as string | null)?.trim();
  const purpose   = (formData.get('purpose')    as string | null)?.trim() ?? 'Routine';

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  // Rep → locked to self; manager → validated within tours; admin → form value.
  // Owner is required (no client-primary fallback). See resolveAssignableRepId.
  const resolvedRepId = await resolveAssignableRepId(
    user,
    (formData.get('rep_id') as string | null)?.trim() ?? null,
  );

  await risansiPool.query(
    `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
     VALUES ($1, $2, $3, $4, 'planned', NOW())`,
    [clientId, resolvedRepId, date, purpose],
  );

  await logActivity('client', clientId, `planned visit on ${date} · ${purpose}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);

  await notifyVisitPlan({ plannerEmail: user.email!, clientId: Number(clientId), repId: resolvedRepId, visitDate: date, purpose });
}

// ── Client: create opportunity ─────────────────────────────────

export async function createOpportunity(clientId: string, formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  // Only for a client you can see (own tour or a special-access grant).
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) throw new Error('You do not have access to this client.');

  const product  = (formData.get('product')  as string | null)?.trim() ?? 'New Opportunity';
  const stage    = (formData.get('stage')    as string | null)?.trim() ?? 'Suspect';
  // Won requires a Sales Order — only the pipeline create/complete flow captures
  // it, so this legacy quick-create can't mint a Won directly.
  if (stage === 'Won') throw new Error('Mark an opportunity Won from the Opportunities pipeline (a Sales Order is required).');
  const valueCr  = parseFloat((formData.get('estimated_value') as string | null) ?? '') || null;
  const prob     = formData.get('probability') ? parseInt(formData.get('probability') as string) : null;
  const eta      = (formData.get('eta_text') as string | null)?.trim() ||
                   (formData.get('expected_close') as string | null)?.trim() || null;

  // Rep → locked to self; manager → validated within tours; admin → form value.
  // Owner is required (no client-primary fallback). See resolveAssignableRepId.
  const resolvedRepId = await resolveAssignableRepId(
    session.user,
    (formData.get('rep_id') as string | null)?.trim() ?? null,
  );

  const { rows } = await risansiPool.query<{ id: string }>(
    `INSERT INTO opportunities (
      client_id, rep_id,
      product, product_type, stage,
      value_cr, probability,
      eta_text, quote_ref, notes,
      auto_created, created_by,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      FALSE, $11, NOW(), NOW()
    ) RETURNING id`,
    [
      clientId,
      resolvedRepId,
      product,
      formData.get('product_type') || 'PCP',
      stage,
      valueCr,
      prob,
      eta,
      formData.get('quote_ref') || null,
      formData.get('notes') || null,
      session.user.email,
    ],
  );

  const newId = rows[0]?.id ?? null;

  // Log stage creation
  if (newId) {
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log
           (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, NULL, $2, 'Created via client page', $3)`,
        [newId, stage, session.user.email],
      );
    } catch { /* table may not exist */ }
  }

  await logActivity('client', clientId, `created opportunity: ${product} · ${stage}${valueCr ? ` · ₹${valueCr} Cr` : ''}`, session.user.email);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi');
}

// ── Client: update tier ────────────────────────────────────────

export async function updateClientTier(clientId: string, formData: FormData) {
  const user = await requireSession();

  const newTier = (formData.get('tier') as string | null)?.trim() ?? null;

  // Fetch current tier for the log message
  let oldTier: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ tier: string | null }>(
      `SELECT tier FROM clients WHERE id = $1`,
      [clientId],
    );
    oldTier = rows[0]?.tier ?? null;
  } catch { /* ignore */ }

  await risansiPool.query(
    `UPDATE clients SET tier = $1, updated_at = NOW() WHERE id = $2`,
    [newTier || null, clientId],
  );

  const change = `changed tier: ${oldTier ?? 'none'} → ${newTier ?? 'none'}`;
  await logActivity('client', clientId, change, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/clients');
}

// Map a client to a tour inline (from the New Opportunity form, when the client
// isn't on one yet). Ownership then derives from the tour — returns the resolved
// owner so the caller can clear the "no tour" block without a full reload.
export async function assignClientTour(clientId: number, tourId: number): Promise<{ ownerName: string | null; tourName: string | null }> {
  const user = await getCurrentUser();
  if (!(await canViewClient(user, clientId))) throw new Error('You do not have access to this client.');
  const { rows: tr } = await risansiPool.query<{ name: string }>('SELECT name FROM tour_routes WHERE id = $1', [tourId]);
  if (!tr[0]) throw new Error('Tour not found.');
  await risansiPool.query(
    'UPDATE clients SET tour_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3',
    [tourId, user.email ?? null, clientId],
  );
  const resolved = await resolveClientPrimaryRep(clientId, null);
  let ownerName: string | null = null;
  if (resolved.repId != null) {
    const { rows } = await risansiPool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [resolved.repId]);
    ownerName = rows[0]?.name ?? null;
  }
  await logActivity('client', String(clientId), `mapped to tour "${tr[0].name}"${ownerName ? ` · owner ${ownerName}` : ''}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/pipeline');
  return { ownerName, tourName: tr[0].name };
}

// ── Pipeline: create opportunity (client_id from form) ─────────

export async function createPipelineOpportunity(formData: FormData) {
  const user = await requireSession();

  const clientId = (formData.get('client_id') as string | null)?.trim() ?? '';
  const rawStage = (formData.get('stage')     as string | null)?.trim() ?? 'Suspect';
  const stage: CreateStage = (CREATE_STAGES as readonly string[]).includes(rawStage)
    ? rawStage as CreateStage : 'Suspect';
  const product  = (formData.get('product')      as string | null)?.trim() || 'New Opportunity';
  const prodType = (formData.get('product_type') as string | null)?.trim() || 'PCP';

  if (!clientId) throw new Error('Client is required.');

  // You can only file an opportunity for a client you can see — a client on one
  // of your tours or one you've been granted direct special access to. Admin/
  // sysadmin always pass. getCurrentUser maps the session's repId to id.
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) {
    throw new Error('You do not have access to this client.');
  }

  // Field readers. `s` → trimmed string or null; `nRaw` → any finite number;
  // `nInr`/`crOf` turn a rupee input into Crores (₹1,00,00,000 = 1 Cr).
  const s    = (k: string) => { const v = (formData.get(k) as string | null)?.trim(); return v ? v : null; };
  const nRaw = (k: string) => { const f = parseFloat((formData.get(k) as string | null) ?? ''); return Number.isFinite(f) ? f : null; };
  const crOf = (k: string) => { const f = parseFloat((formData.get(k) as string | null) ?? ''); return Number.isFinite(f) && f > 0 ? f / 10_000_000 : null; };
  // Item helpers (values arrive inside items_json, mirroring saveQuotedDetails).
  const iStr = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };
  const iNum = (v: unknown) => { const f = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(f) ? f : null; };
  const iInt = (v: unknown) => { const p = parseInt(String(v ?? '').replace(/[^0-9\-]/g, ''), 10); return Number.isFinite(p) ? p : null; };

  interface ItemInput { pump_model?: unknown; pump_qty?: unknown; pump_speed?: unknown; geared_motor_detail?: unknown; motor_price?: unknown; gearbox_vbelt_price?: unknown; offer_value_inr?: unknown; offer_value_usd?: unknown; detailed_specifications?: unknown; }
  let items: ItemInput[] = [];
  try { const parsed = JSON.parse((formData.get('items_json') as string) || '[]'); if (Array.isArray(parsed)) items = parsed; } catch { /* ignore */ }
  items = items.filter(it => iStr(it.pump_model) || iNum(it.offer_value_inr) != null || iInt(it.pump_qty) != null || iStr(it.detailed_specifications));
  const itemsSum = items.reduce((a, it) => a + (iNum(it.offer_value_inr) ?? 0), 0);
  // A blank OR zero Total Offer falls back to the line-item sum. (`?? ` alone
  // would keep a literal 0, since 0 isn't nullish, and silently ignore items.)
  const offerDirect = nRaw('offer_value_inr');
  const offerInr = offerDirect != null && offerDirect > 0 ? offerDirect : (itemsSum || null);

  // Cumulative required-field gate — the exact rule the form renders, enforced
  // here so a hand-built request can't skip a stage's requirements. The offer
  // counts as filled when line items sum to a value, matching the form.
  const filled = (name: string): boolean => {
    if (name === 'offer_value_inr') return offerInr != null && offerInr > 0;
    const v = formData.get(name);
    if (v == null || String(v).trim() === '') return false;
    if (name === 'value_inr' || name === 'final_value_inr') return parseFloat(String(v)) > 0;
    return true;
  };
  const missing = requiredFieldNames(stage).filter(n => !filled(n));
  if (missing.length) {
    throw new Error(`Fill the required field${missing.length > 1 ? 's' : ''} for the ${stage} stage: ${labelsFor(missing).join(', ')}.`);
  }

  // A Won created directly needs at least one Sales Order (number + date + value).
  let soRows: SoInput[] = [];
  if (stage === 'Won') {
    const parsed = parseSalesOrdersJson(formData.get('sales_orders_json'));
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.rows.length === 0) {
      throw new Error('Add at least one Sales Order (SO Number, Date and Value) to create a Won opportunity.');
    }
    soRows = parsed.rows;
  }

  const value = crOf('value_inr') ?? (offerInr ? offerInr / 10_000_000 : null);
  // Probability is entered as the RIL code (1–4); the stored numeric % is
  // derived from the code so the weighted forecast + % displays keep working.
  const prob  = pctForProbabilityCode(s('probability_code')) ?? STAGE_PROB[stage];
  const first = items[0] ?? {};

  // Ownership is derived, not asked for. The client is already on a tour and
  // the tour names its owner, so a rep picker on this form could only ever
  // disagree with that. A rep filing their own opportunity still gets it;
  // otherwise the tour decides. A rep's session may carry no numeric repId, so
  // fall back to a lookup by login email — without it a rep would silently have
  // their own work handed to a colleague off the tour roster.
  let creatorRepId = typeof user.repId === 'number' ? user.repId : null;
  if (creatorRepId == null && user.email) {
    const { rows } = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
      [user.email],
    );
    creatorRepId = rows[0]?.id ?? null;
  }
  if (user.role === 'rep' && creatorRepId == null) {
    throw new Error('Your account is not linked to a user record. Please contact the system administrator.');
  }

  const derived = await resolveClientPrimaryRep(clientId, creatorRepId);
  // A special-access grantee (rep OR manager) owns what they file for a granted
  // client, exactly like a rep filing their own — independent of the tour. This
  // stops a manager grantee's opportunity from being handed to a stranger's tour
  // rep (or blocked outright on a tour-less client).
  const special = creatorRepId != null && await hasSpecialClientAccess(creatorRepId, Number(clientId));
  const primaryRepId = (user.role === 'rep' || special) ? creatorRepId : derived.repId;

  if (!primaryRepId) {
    throw new Error(
      'This client is not on a tour with an assigned rep, so the opportunity would have no owner. Put the client on a tour first, then create the opportunity.',
    );
  }

  // Column → value. Only columns that actually exist on the table are written
  // (mirrors updateOpportunity), so an environment missing an optional column
  // still inserts cleanly.
  const candidates: Record<string, unknown> = {
    client_id: clientId, rep_id: primaryRepId, secondary_rep_id: null,
    product, product_type: prodType, stage, value_cr: value, probability: prob,
    eta_text: s('eta_text'),
    quote_ref: s('quote_ref'), quote_date: s('quote_date'),
    enquiry_no: s('enquiry_no'), enquiry_date: s('enquiry_date'),
    market: s('market'), offer_value_inr: offerInr, offer_value_usd: nRaw('offer_value_usd'),
    probability_code: s('probability_code'), ril_rep: s('ril_rep'),
    qtn_prepared_by: s('qtn_prepared_by'), client_status_at_quote: s('client_status_at_quote'),
    qtr: s('qtr'), unit_project: s('unit_project'), location: s('location'),
    revised_offer_value_inr: nRaw('revised_offer_value_inr'),
    revised_offer_value_usd: nRaw('revised_offer_value_usd'),
    revised_offer_date: s('revised_offer_date'),
    negotiation_notes: s('negotiation_notes'),
    po_number: s('po_number'), final_value_cr: crOf('final_value_inr'),
    lost_to_competitor: s('lost_to_competitor'), lost_reason: s('lost_reason'),
    quotation_link: s('quotation_link'),
    pump_model: iStr(first.pump_model) ?? s('pump_model'), pump_qty: iInt(first.pump_qty),
    notes: s('notes'), auto_created: false, created_by: user.email,
  };

  const existing = await opportunityColumns();
  const cols = Object.keys(candidates).filter(c => existing.size === 0 || existing.has(c));
  const insertSql = `INSERT INTO opportunities (${cols.join(', ')}, created_at, updated_at)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, NOW(), NOW())
     RETURNING id`;
  const insertVals = cols.map(c => candidates[c]);

  let newOppId: string | null = null;
  if (soRows.length) {
    // Won-on-create: the opportunity row and its Sales Orders commit together,
    // so a Won can never be created without its required SOs.
    const client = await risansiPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(insertSql, insertVals);
      newOppId = rows[0]?.id ?? null;
      if (newOppId) {
        for (const r of soRows) {
          await client.query(
            `INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [Number(newOppId), r.so_number, r.so_date, r.so_value_cr, user.email ?? null],
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } else {
    const { rows: oppRows } = await risansiPool.query<{ id: string }>(insertSql, insertVals);
    newOppId = oppRows[0]?.id ?? null;
  }

  // Quoted line items, if any were entered.
  if (newOppId && items.length) {
    let so = 0;
    for (const it of items) {
      await risansiPool.query(
        `INSERT INTO opportunity_items (opportunity_id, sort_order, pump_model, pump_qty, pump_speed,
           geared_motor_detail, motor_price, gearbox_vbelt_price, offer_value_inr, offer_value_usd, detailed_specifications)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [newOppId, so++, iStr(it.pump_model), iInt(it.pump_qty), iStr(it.pump_speed),
         iStr(it.geared_motor_detail), iNum(it.motor_price), iNum(it.gearbox_vbelt_price),
         iNum(it.offer_value_inr), iNum(it.offer_value_usd), iStr(it.detailed_specifications)],
      );
    }
  }

  if (newOppId) {
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, NULL, $2, 'Created via pipeline', $3)`,
        [newOppId, stage, user.email],
      );
    } catch { /* table may not exist */ }

    // Notify on a create that lands straight in a notable stage.
    if (stage === 'Won' || stage === 'Lost') {
      await notifyOppClosed(Number(newOppId), user.email ?? '', stage);
    } else if (stage === 'Quoted') {
      await notifyQuotationIssued(Number(newOppId), user.email ?? '');
    }
  }

  // Flag a guessed owner in the log. When the tour has several reps and none is
  // designated, the pick is roster order — recording that is the difference
  // between a decision and an artefact nobody can later tell apart.
  const ownerNote = user.role !== 'rep' && derived.ambiguous && derived.basis === 'roster-order'
    ? ' · owner inferred from tour roster order (tour has no designated rep)'
    : '';
  await logActivity('pipeline', clientId, `created opportunity: ${product} · ${stage} · ₹${value ?? 0} Cr${ownerNote}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  // The new id lets the caller attach a quotation PDF to the record it just
  // created — the whole reason the create form has a second step.
  return { id: newOppId };
}

// ── Pipeline: move to Quoted + capture the quotation details ───
// Dedicated to the "move to Quoted" flow so unrelated columns are never wiped
// (unlike updateOpportunity, which nulls any candidate field the form omits).
export async function saveQuotedDetails(oppId: number, formData: FormData) {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) throw new Error('Opportunity not found');
  if (rows[0].stage === 'Won' || rows[0].stage === 'Lost') {
    throw new Error('This opportunity is locked and cannot be edited.');
  }
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) {
    throw new Error('You do not have permission to edit this opportunity.');
  }

  const s = (k: string) => { const v = (formData.get(k) as string | null)?.trim(); return v ? v : null; };
  const n = (k: string) => { const v = formData.get(k) as string | null; const f = v ? parseFloat(v) : NaN; return Number.isFinite(f) ? f : null; };
  const i = (k: string) => { const v = formData.get(k) as string | null; const p = v ? parseInt(v, 10) : NaN; return Number.isFinite(p) ? p : null; };
  // Item helpers (values arrive inside items_json).
  const iStr = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };
  const iNum = (v: unknown) => { const f = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(f) ? f : null; };
  const iInt = (v: unknown) => { const p = parseInt(String(v ?? '').replace(/[^0-9\-]/g, ''), 10); return Number.isFinite(p) ? p : null; };

  interface ItemInput { pump_model?: unknown; pump_qty?: unknown; pump_speed?: unknown; geared_motor_detail?: unknown; motor_price?: unknown; gearbox_vbelt_price?: unknown; offer_value_inr?: unknown; offer_value_usd?: unknown; detailed_specifications?: unknown; }
  let items: ItemInput[] = [];
  try { const parsed = JSON.parse((formData.get('items_json') as string) || '[]'); if (Array.isArray(parsed)) items = parsed; } catch { /* ignore */ }
  items = items.filter(it => iStr(it.pump_model) || iNum(it.offer_value_inr) != null || iInt(it.pump_qty) != null || iStr(it.detailed_specifications));

  const itemsSum = items.reduce((a, it) => a + (iNum(it.offer_value_inr) ?? 0), 0);
  const offerInr = n('offer_value_inr') ?? (itemsSum || null);
  const valueCr  = offerInr != null ? offerInr / 10_000_000 : null;
  const first    = items[0] ?? {};
  // Keep the numeric probability derived from the code (COALESCE so a blank code
  // leaves the existing % intact — same rule as create/update).
  const probPct  = pctForProbabilityCode(s('probability_code'));

  await risansiPool.query(
    `UPDATE opportunities SET
       stage = 'Quoted',
       quote_ref = $1, quote_date = $2, enquiry_no = $3, enquiry_date = $4,
       revised_offer_date = $5, quotation_link = $6,
       offer_value_inr = $7, offer_value_usd = $8,
       revised_offer_value_inr = $9, revised_offer_value_usd = $10,
       market = $11, ril_rep = COALESCE($12, ril_rep), qtn_prepared_by = $13, client_status_at_quote = $14,
       unit_project = $15, location = $16, qtr = $17, probability_code = $18,
       product_type    = COALESCE($19, product_type),
       value_cr        = COALESCE($20, value_cr),
       notes           = COALESCE($21, notes),
       pump_model = $22, pump_qty = $23,
       probability = COALESCE($24, probability),
       updated_at = NOW()
     WHERE id = $25`,
    [s('quote_ref'), s('quote_date'), s('enquiry_no'), s('enquiry_date'),
     s('revised_offer_date'), s('quotation_link'),
     offerInr, n('offer_value_usd'), n('revised_offer_value_inr'), n('revised_offer_value_usd'),
     s('market'), s('ril_rep'), s('qtn_prepared_by'), s('client_status_at_quote'),
     s('unit_project'), s('location'), s('qtr'), s('probability_code'),
     s('product_type'), valueCr, s('notes'),
     iStr(first.pump_model) ?? s('pump_model'), iInt(first.pump_qty) ?? i('pump_qty'), probPct, oppId],
  );

  // Replace the opportunity's quoted items.
  await risansiPool.query('DELETE FROM opportunity_items WHERE opportunity_id = $1', [oppId]);
  let so = 0;
  for (const it of items) {
    await risansiPool.query(
      `INSERT INTO opportunity_items (opportunity_id, sort_order, pump_model, pump_qty, pump_speed,
         geared_motor_detail, motor_price, gearbox_vbelt_price, offer_value_inr, offer_value_usd, detailed_specifications)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [oppId, so++, iStr(it.pump_model), iInt(it.pump_qty), iStr(it.pump_speed),
       iStr(it.geared_motor_detail), iNum(it.motor_price), iNum(it.gearbox_vbelt_price),
       iNum(it.offer_value_inr), iNum(it.offer_value_usd), iStr(it.detailed_specifications)],
    );
  }

  try {
    await risansiPool.query(
      `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
       VALUES ($1, $2, 'Quoted', 'Quoted via board', $3)`,
      [oppId, rows[0].stage, user.email],
    );
  } catch { /* log table optional */ }

  await logActivity('opportunity', String(oppId), `moved to Quoted${s('quote_ref') ? ` · ${s('quote_ref')}` : ''}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');

  // Notify only the FIRST time an opp reaches Quoted — Negotiating / On Hold
  // already imply it passed through Quoted, so re-entering must not re-fire.
  if (!['Quoted', 'Negotiating', 'On Hold'].includes(rows[0].stage)) {
    await notifyQuotationIssued(Number(oppId), user.email ?? '');
  }
}

// ── Pipeline: full opportunity edit ────────────────────────────

export async function updateOpportunity(oppId: number, formData: FormData) {
  const user = await requireSession();

  // Lock guard — a Won/Lost opp can't be edited unless it's being moved out of that stage
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) throw new Error('Opportunity not found');

  // Tour-based edit rights — anyone who can see the client (its tour) or admin.
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) {
    throw new Error('You do not have permission to edit this opportunity.');
  }

  const currentStage = cur[0]?.stage;
  const newStage     = (formData.get('stage') as string | null) ?? currentStage;
  if ((currentStage === 'Won' || currentStage === 'Lost') && newStage === currentStage) {
    throw new Error('This opportunity is locked and cannot be edited.');
  }
  // Gate: Quoted is a mandatory gateway. A deal that's been Quoted can be put
  // On Hold and still advance to Won/Lost, so On Hold counts as "past Quoted".
  if (['Negotiating', 'Won', 'Lost'].includes(newStage ?? '')
      && !['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost'].includes(currentStage ?? '')) {
    throw new Error('Move this opportunity through Quoted first.');
  }

  // Marking Won requires at least one Sales Order (each with a number, date and
  // value). Only enforced on the transition INTO Won — SOs are added afterwards
  // through addSalesOrder, which bypasses the Won edit lock.
  const isWonTransition = newStage === 'Won' && currentStage !== 'Won';
  let soRows: SoInput[] = [];
  if (isWonTransition) {
    const parsed = parseSalesOrdersJson(formData.get('sales_orders_json'));
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.rows.length === 0) {
      throw new Error('Add at least one Sales Order (SO Number, Date and Value) to mark this opportunity Won.');
    }
    soRows = parsed.rows;
  }

  const valueInr = parseFloat((formData.get('value_inr')       as string | null) ?? '0');
  const finalInr = parseFloat((formData.get('final_value_inr') as string | null) ?? '0');
  // Probability is entered as the RIL code (1–4); the numeric % is derived from
  // it. When the form omits the field entirely (e.g. OppCompletionModal marking
  // Won), both are left untouched — see the preserve guard below.
  const probCodeRaw = formData.get('probability_code');
  const probCode = typeof probCodeRaw === 'string' ? (probCodeRaw.trim() || null) : null;

  // For rep_id: if the form omits it, preserve the opportunity's EXISTING
  // rep_id before falling back to the client's primary rep. (Marking Won via
  // OppCompletionModal sends no rep_id, so without this the existing owner
  // would be overwritten — and wiped to null if the client has no primary.)
  const rawRepId = formData.get('rep_id');
  let repId = rawRepId && rawRepId !== '' ? parseInt(rawRepId as string, 10) : null;
  if (!repId) {
    const { rows } = await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
      `SELECT rep_id, client_id FROM opportunities WHERE id = $1`,
      [oppId],
    );
    repId = rows[0]?.rep_id ?? null;
    if (!repId && rows[0]?.client_id) {
      const { rows: cRows } = await risansiPool.query<{ primary_rep_id: number | null }>(
        `SELECT (SELECT ta.rep_id FROM tour_assignments ta
                  WHERE ta.tour_id = (SELECT tour_id FROM clients WHERE id = $1) AND ta.role = 'rep'
                  ORDER BY ta.assigned_at, ta.rep_id LIMIT 1) AS primary_rep_id`,
        [rows[0].client_id],
      );
      repId = cRows[0]?.primary_rep_id ?? null;
    }
  }
  // secondary_rep_id can be null
  const rawSecRepId = formData.get('secondary_rep_id');
  const secRepId = rawSecRepId && rawSecRepId !== '' ? parseInt(rawSecRepId as string, 10) : null;

  // Candidate columns → values. Only those present on the table are written.
  const candidates: Record<string, unknown> = {
    product:            (formData.get('product') as string | null)?.trim() || null,
    product_type:       (formData.get('product_type') as string | null) || 'PCP',
    stage:              (formData.get('stage') as string | null) || 'Suspect',
    value_cr:           valueInr > 0 ? valueInr / 10_000_000 : null,
    probability:        pctForProbabilityCode(probCode),
    probability_code:   probCode,
    eta_text:           (formData.get('eta_text') as string | null) || null,
    quote_ref:          (formData.get('quote_ref') as string | null) || null,
    quote_date:         (formData.get('quote_date') as string | null) || null,
    unit_project:       (formData.get('unit_project') as string | null) || null,
    negotiation_notes:  (formData.get('negotiation_notes') as string | null) || null,
    notes:              (formData.get('notes') as string | null) || null,
    rep_id:             repId,
    secondary_rep_id:   secRepId,
    po_number:          (formData.get('po_number') as string | null) || null,
    final_value_cr:     finalInr > 0 ? finalInr / 10_000_000 : null,
    lost_to_competitor: (formData.get('lost_to_competitor') as string | null) || null,
    lost_reason:        (formData.get('lost_reason') as string | null) || null,
  };

  // Ownership is no longer set from the Edit drawer — it's derived from the
  // client's tour and shown read-only. When the form doesn't submit these
  // fields at all, leave the stored values untouched (don't wipe the secondary
  // owner or re-derive the primary). OppCompletionModal still sends rep_id
  // explicitly, so its Won transition keeps carrying the owner through.
  if (formData.get('rep_id') === null)           delete candidates.rep_id;
  if (formData.get('secondary_rep_id') === null) delete candidates.secondary_rep_id;
  // Probability: only write when a code is actually chosen. A blank/absent code
  // leaves the stored code AND the numeric % untouched — so editing one of the
  // many legacy opps (which have a numeric probability but no code yet) for an
  // unrelated reason never silently wipes its probability, and marking Won via
  // OppCompletionModal (which sends no code) preserves it too.
  if (!probCode) { delete candidates.probability; delete candidates.probability_code; }

  const existing = await opportunityColumns();
  const cols = Object.keys(candidates).filter(c => existing.size === 0 || existing.has(c));
  if (cols.length === 0) return;

  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const vals = cols.map(c => candidates[c]);
  const updateSql = `UPDATE opportunities SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`;
  if (isWonTransition) {
    // Atomic: the Won stage flip and its Sales Orders commit together, so a
    // failed SO insert can never leave a Won with zero SOs (and then locked).
    const client = await risansiPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(updateSql, [...vals, oppId]);
      for (const r of soRows) {
        await client.query(
          `INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [oppId, r.so_number, r.so_date, r.so_value_cr, user.email ?? null],
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } else {
    await risansiPool.query(updateSql, [...vals, oppId]);
  }

  await logActivity('opportunity', String(oppId), `updated opportunity · ${candidates.stage}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');

  // Only on a genuine transition into Won/Lost — not every edit of a closed opp.
  if (newStage !== currentStage && (newStage === 'Won' || newStage === 'Lost')) {
    await notifyOppClosed(Number(oppId), user.email ?? '', newStage);
  }
  // First-time transition into Quoted via the Edit drawer → quotation issued.
  if (newStage === 'Quoted' && !['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost'].includes(currentStage ?? '')) {
    await notifyQuotationIssued(Number(oppId), user.email ?? '');
  }
}

// ── Sales Orders (against a Won opportunity) ───────────────────
// SOs fulfil a Won opp over time. They deliberately bypass the Won "edit lock":
// the deal itself is frozen once Won, but SO progress keeps moving until the SO
// values cover the final value (Won · Open → Won · Closed).

async function insertSalesOrders(oppId: number, rows: SoInput[], email: string | null): Promise<void> {
  for (const r of rows) {
    await risansiPool.query(
      `INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [oppId, r.so_number, r.so_date, r.so_value_cr, email],
    );
  }
}

export async function listSalesOrders(oppId: number): Promise<SalesOrder[]> {
  const { rows } = await risansiPool.query<SalesOrder>(
    `SELECT id, opportunity_id, so_number, so_date::text AS so_date,
            so_value_cr::float8 AS so_value_cr, created_by
       FROM opportunity_sales_orders WHERE opportunity_id = $1 ORDER BY so_date, id`,
    [oppId],
  );
  return rows;
}

export async function addSalesOrder(oppId: number, formData: FormData): Promise<SalesOrder[]> {
  const user = await requireSession();
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) throw new Error('Opportunity not found.');
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) throw new Error('You do not have permission to edit this opportunity.');
  if (cur[0].stage !== 'Won') throw new Error('Sales Orders can only be recorded against a Won opportunity.');

  const num  = (formData.get('so_number') as string | null)?.trim() ?? '';
  const date = (formData.get('so_date')   as string | null)?.trim() ?? '';
  const inr  = parseFloat(((formData.get('so_value_inr') as string | null) ?? '').replace(/[^0-9.\-]/g, ''));
  if (!num || !date || !Number.isFinite(inr) || inr <= 0) {
    throw new Error('An SO Number, SO Date and SO Value greater than zero are all required.');
  }
  await insertSalesOrders(oppId, [{ so_number: num, so_date: date, so_value_cr: inrToCr(inr) }], user.email ?? null);
  await logActivity('opportunity', String(oppId), `added sales order ${num}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  await notifySalesOrder(oppId, user.email ?? '', num);
  return listSalesOrders(oppId);
}

export async function deleteSalesOrder(soId: number): Promise<SalesOrder[]> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ opportunity_id: number; rep_id: number | null; client_id: number | null; so_number: string }>(
    `SELECT so.opportunity_id, o.rep_id, o.client_id, so.so_number
       FROM opportunity_sales_orders so JOIN opportunities o ON o.id = so.opportunity_id
      WHERE so.id = $1`,
    [soId],
  );
  if (!rows[0]) throw new Error('Sales order not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) throw new Error('You do not have permission to edit this opportunity.');
  await risansiPool.query('DELETE FROM opportunity_sales_orders WHERE id = $1', [soId]);
  await logActivity('opportunity', String(rows[0].opportunity_id), `removed sales order ${rows[0].so_number}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return listSalesOrders(rows[0].opportunity_id);
}

// Adjust a Won opportunity's final value. The rest of a Won is frozen, but the
// final value (with the SOs) decides Open vs Closed, so it stays editable —
// same permission, bypassing the Won edit lock like the SO actions do.
export async function updateWonFinalValue(oppId: number, formData: FormData): Promise<void> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) throw new Error('Opportunity not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) throw new Error('You do not have permission to edit this opportunity.');
  if (rows[0].stage !== 'Won') throw new Error('Only a Won opportunity’s final value can be adjusted here.');

  const inr = parseFloat(((formData.get('final_value_inr') as string | null) ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(inr) || inr <= 0) throw new Error('Enter a final value greater than zero.');

  await risansiPool.query('UPDATE opportunities SET final_value_cr = $1, updated_at = NOW() WHERE id = $2', [inr / 10_000_000, oppId]);
  await logActivity('opportunity', String(oppId), `final value updated to ₹${Math.round(inr)}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Purchase Orders (customer POs against a Won opportunity) ────
// A free-standing record of the customer's POs, independent of the SO coverage
// maths. Same Won-only gate and permission as the SO actions.

export async function listPurchaseOrders(oppId: number): Promise<PurchaseOrder[]> {
  const { rows } = await risansiPool.query<PurchaseOrder>(
    `SELECT id, opportunity_id, po_number, po_date::text AS po_date,
            po_value_cr::float8 AS po_value_cr, created_by
       FROM opportunity_purchase_orders WHERE opportunity_id = $1 ORDER BY po_date, id`,
    [oppId],
  );
  return rows;
}

export async function addPurchaseOrder(oppId: number, formData: FormData): Promise<PurchaseOrder[]> {
  const user = await requireSession();
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) throw new Error('Opportunity not found.');
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) throw new Error('You do not have permission to edit this opportunity.');
  if (cur[0].stage !== 'Won') throw new Error('Purchase Orders can only be recorded against a Won opportunity.');

  const num  = (formData.get('po_number') as string | null)?.trim() ?? '';
  const date = (formData.get('po_date')   as string | null)?.trim() ?? '';
  const inr  = parseFloat(((formData.get('po_value_inr') as string | null) ?? '').replace(/[^0-9.\-]/g, ''));
  if (!num || !date || !Number.isFinite(inr) || inr <= 0) {
    throw new Error('A PO Number, PO Date and PO Value greater than zero are all required.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
    throw new Error('Enter a valid PO Date (YYYY-MM-DD).');
  }
  const cr = poInrToCr(inr);
  if (cr >= 9_999_999) throw new Error('That PO value is unrealistically large — please check it.');

  await risansiPool.query(
    `INSERT INTO opportunity_purchase_orders (opportunity_id, po_number, po_date, po_value_cr, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [oppId, num, date, cr, user.email ?? null],
  );
  await logActivity('opportunity', String(oppId), `added purchase order ${num}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return listPurchaseOrders(oppId);
}

export async function deletePurchaseOrder(poId: number): Promise<PurchaseOrder[]> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ opportunity_id: number; rep_id: number | null; client_id: number | null; po_number: string }>(
    `SELECT po.opportunity_id, o.rep_id, o.client_id, po.po_number
       FROM opportunity_purchase_orders po JOIN opportunities o ON o.id = po.opportunity_id
      WHERE po.id = $1`,
    [poId],
  );
  if (!rows[0]) throw new Error('Purchase order not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) throw new Error('You do not have permission to edit this opportunity.');
  await risansiPool.query('DELETE FROM opportunity_purchase_orders WHERE id = $1', [poId]);
  await logActivity('opportunity', String(rows[0].opportunity_id), `removed purchase order ${rows[0].po_number}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return listPurchaseOrders(rows[0].opportunity_id);
}

// ── Pipeline: delete opportunity ───────────────────────────────

export async function deleteOpportunity(oppId: number) {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
    'SELECT rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) throw new Error('Opportunity not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) {
    throw new Error('You do not have permission to delete this opportunity.');
  }
  await risansiPool.query('DELETE FROM opportunities WHERE id = $1', [oppId]);
  await logActivity('opportunity', String(oppId), 'deleted opportunity', user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Visit plan: edit / delete (planned, not-yet-submitted visits) ──

// Permission for both: admin/sysadmin · the assigned rep · the rep's tour manager.
// Edits are refused once the visit report has been submitted.
export async function updateVisitPlan(visitId: string, formData: FormData) {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number }>(
    'SELECT rep_id, submitted_at, client_id FROM visits WHERE id = $1', [visitId],
  );
  const visit = rows[0];
  if (!visit) throw new Error('Visit not found.');
  if (visit.submitted_at) throw new Error('A submitted visit can no longer be edited.');
  if (!(await userCanEditOpp(user, visit.rep_id))) {
    throw new Error('You do not have permission to edit this visit.');
  }

  const visitDate = (formData.get('visit_date') as string | null)?.trim();
  if (!visitDate) throw new Error('Visit date is required.');
  const purpose = (formData.get('purpose') as string | null)?.trim() || 'Routine';

  // Owner: reps stay locked to themselves; managers/admins may reassign within
  // their allowed set. Blank → keep the current owner.
  let repId = visit.rep_id;
  const role = user.role ?? 'rep';
  if (role !== 'rep') {
    const raw = (formData.get('rep_id') as string | null)?.trim();
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isInteger(parsed)) {
      if (role === 'manager' && typeof user.repId === 'number') {
        const allowed = await getManagerAssignableReps(user.repId);
        if (!allowed.includes(parsed)) {
          throw new Error('You can only assign to people in your assigned tours.');
        }
      }
      repId = parsed;
    }
  }

  await risansiPool.query(
    `UPDATE visits SET visit_date = $1, purpose = $2, rep_id = $3, updated_at = NOW()
     WHERE id = $4 AND submitted_at IS NULL`,
    [visitDate, purpose, repId, visitId],
  );

  await logActivity('client', String(visit.client_id), `visit plan updated · ${visitDate} · ${purpose}`, user.email!);
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/visits');
  revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath(`/risansi/clients/${visit.client_id}`);
}

export async function deleteVisitPlan(visitId: string) {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number }>(
    'SELECT rep_id, submitted_at, client_id FROM visits WHERE id = $1', [visitId],
  );
  const visit = rows[0];
  if (!visit) throw new Error('Visit not found.');
  if (visit.submitted_at) throw new Error('A submitted visit cannot be deleted.');
  if (!(await userCanEditOpp(user, visit.rep_id))) {
    throw new Error('You do not have permission to delete this visit.');
  }

  // The visit's own reports and photos cascade automatically, but equipment,
  // competitor sightings and tasks are FK-restricted — a bare DELETE throws once
  // any of them exist (which surfaces as the generic "Server Components render"
  // error). Clear those visit-scoped rows first, and DETACH opportunities rather
  // than delete them, so pipeline records raised off the visit survive. All in
  // one transaction so a failure leaves nothing half-removed.
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM equipment            WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM competitor_sightings WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM tasks                WHERE visit_id = $1', [visitId]);
    await client.query('UPDATE opportunities SET visit_id = NULL WHERE visit_id = $1', [visitId]);
    // Guard again in SQL so a concurrent submit can't be deleted out from under.
    const res = await client.query('DELETE FROM visits WHERE id = $1 AND submitted_at IS NULL', [visitId]);
    if (res.rowCount === 0) throw new Error('Visit could not be deleted (it may have been submitted).');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await logActivity('client', String(visit.client_id), 'visit plan deleted', user.email!);
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/visits');
  revalidatePath(`/risansi/clients/${visit.client_id}`);
}

// ── Pipeline: update value / probability ──────────────────────

// ── Visits: assign visit ───────────────────────────────────────

export async function assignVisit(formData: FormData) {
  const user = await requireSession();

  const clientId  = (formData.get('client_id')  as string | null)?.trim() ?? '';
  const visitDate = (formData.get('visit_date')  as string | null)?.trim();
  const purpose   = (formData.get('purpose')     as string | null)?.trim() ?? 'Routine';
  const notes     = (formData.get('notes')       as string | null)?.trim() || null;

  // A missing client must surface as an error — never report a fake success.
  if (!clientId) throw new Error('Please select a client before scheduling a visit.');

  // Only schedule for a client you can see (own tour or a special-access grant).
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) throw new Error('You do not have access to this client.');

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  // Rep assignment rule (enforced server-side regardless of the form):
  //   rep role          → ALWAYS themselves; resolved fresh by login email
  //                       (session.user.repId can't be trusted — see note below),
  //                       never the submitted rep_id.
  //   admin/manager/...  → the submitted dropdown selection, falling back to the
  //                       client's primary rep when left blank.
  // Single explicit owner (flat model): rep → self; manager → required & within
  // tours; admin → required. No client-primary fallback.
  const repId = await resolveAssignableRepId(
    user,
    (formData.get('rep_id') as string | null)?.trim() ?? null,
  );

  // Try full insert with optional columns; fall back to minimal ONLY if the
  // full insert fails (e.g. a column is missing). Errors propagate to the UI.
  let insertedId: number | null = null;
  try {
    const { rows } = await risansiPool.query<{ id: number }>(
      `INSERT INTO visits
         (client_id, rep_id, visit_date, purpose, status, is_planned, summary, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'planned', TRUE, $5, NOW(), NOW())
       RETURNING id`,
      [clientId, repId, date, purpose, notes],
    );
    insertedId = rows[0]?.id ?? null;
  } catch (err) {
    console.error('assignVisit: full insert failed, retrying minimal —', err);
    const { rows } = await risansiPool.query<{ id: number }>(
      `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
       VALUES ($1, $2, $3, $4, 'planned', NOW())
       RETURNING id`,
      [clientId, repId, date, purpose],
    );
    insertedId = rows[0]?.id ?? null;
  }

  if (!insertedId) throw new Error('Visit could not be saved — please try again.');

  await logActivity('client', clientId, `visit assigned for ${date} · ${purpose}`, user.email!);
  revalidatePath('/risansi/field');   // calendar lives here now
  revalidatePath('/risansi/visits');  // legacy redirect
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi');

  await notifyVisitPlan({ plannerEmail: user.email!, clientId: Number(clientId), repId, visitDate: date, purpose });
}

// ── Mobile: GPS check-in ───────────────────────────────────────

export async function checkInVisit(data: {
  clientId: string;
  repId: string;
  visitDate: string;
  purpose: string;
  gpsLat: number | null;
  gpsLng: number | null;
}): Promise<string | null> {
  const user = await requireSession();

  const { clientId, repId, visitDate, purpose, gpsLat, gpsLng } = data;
  if (!clientId) return null;

  // Only check into a client you can see (own tour or a special-access grant).
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) return null;

  // Insert core visit row
  let visitId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ id: string }>(
      `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
       VALUES ($1, $2, $3::date, $4, 'checked-in', NOW())
       RETURNING id`,
      [clientId, repId || null, visitDate, purpose],
    );
    visitId = rows[0]?.id ?? null;
  } catch {
    return null;
  }

  // Optionally record GPS (columns may not exist — non-fatal)
  if (visitId && (gpsLat != null || gpsLng != null)) {
    try {
      await risansiPool.query(
        `UPDATE visits SET gps_lat = $1, gps_lng = $2, check_in_time = NOW() WHERE id = $3`,
        [gpsLat, gpsLng, visitId],
      );
    } catch { /* column not yet added */ }
  }

  if (visitId) {
    await logActivity('client', clientId, `checked in: ${purpose}`, user.email!);
    revalidatePath('/risansi/mobile');
    await notifyCheckIn(Number(clientId), repId ? Number(repId) : null, user.email!);
  }
  return visitId;
}

// ── Client: submit new opportunity (from NewOpportunityDrawer) ─

export async function submitOpportunity(formData: FormData) {
  const user = await requireSession();

  const clientId    = (formData.get('client_id')    as string | null)?.trim() ?? '';
  const product     = (formData.get('product')       as string | null)?.trim() ?? 'New Opportunity';
  const productType = (formData.get('product_type')  as string | null)?.trim() ?? 'PCP';
  const stage       = (formData.get('stage')         as string | null)?.trim() ?? 'Suspect';
  // Won requires a Sales Order (captured only by the pipeline create/complete flow).
  if (stage === 'Won') throw new Error('Mark an opportunity Won from the Opportunities pipeline (a Sales Order is required).');
  const valueInr    = parseFloat((formData.get('value_inr') as string | null) ?? '0') || 0;
  const valueCr     = valueInr > 0 ? valueInr / 10_000_000 : null;  // Rupees → Crores
  const probability = parseInt((formData.get('probability') as string | null) ?? '0', 10) || null;
  const etaText     = (formData.get('eta_text')      as string | null)?.trim() || null;
  const quoteRef    = (formData.get('quote_ref')     as string | null)?.trim() || null;
  const notes       = (formData.get('notes')         as string | null)?.trim() || null;

  if (!clientId) throw new Error('Client ID required');

  // Single explicit owner: rep → self; manager → required & within tours;
  // admin → required. (No client-primary fallback.)
  const repId = await resolveAssignableRepId(
    user,
    (formData.get('rep_id') as string | null)?.trim() ?? null,
  );

  // Try full insert into opportunities table (with all spec columns)
  let newId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ id: string }>(
      `INSERT INTO opportunities
         (client_id, rep_id, product, product_type, stage,
          value_cr, probability, eta_text, quote_ref, notes,
          auto_created, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, NOW(), NOW())
       RETURNING id`,
      [clientId, repId, product, productType, stage,
       valueCr, probability, etaText, quoteRef, notes,
       user.email],
    );
    newId = rows[0]?.id ?? null;
  } catch {
    // Fallback: minimal insert matching query in client profile page
    try {
      const { rows } = await risansiPool.query<{ id: string }>(
        `INSERT INTO opportunities
           (client_id, product, stage, value_cr, probability, expected_close_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id`,
        [clientId, product, stage, valueCr, probability, etaText],
      );
      newId = rows[0]?.id ?? null;
    } catch (err) {
      throw new Error('Failed to create opportunity: ' + (err instanceof Error ? err.message : 'database error'));
    }
  }

  // Log stage creation (non-fatal)
  if (newId) {
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log
           (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, NULL, $2, 'Opportunity created', $3)`,
        [newId, stage, user.email],
      );
    } catch { /* table may not exist */ }
  }

  const desc = `${product} · ${stage}${valueInr > 0 ? ` · ₹${valueInr.toLocaleString('en-IN')}` : ''}`;
  await logActivity('client', clientId, `opportunity created: ${desc}`, user.email!);

  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Client: add new client ─────────────────────────────────────

export async function addClient(formData: FormData): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }
  const email = session!.user.email ?? 'system';

  // Client names are always stored uppercase, regardless of what was typed.
  const legalName = normalizeClientName((formData.get('legal_name') as string | null) ?? '');
  if (!legalName) throw new Error('Legal name is required.');

  const isLead    = formData.get('is_lead') === 'true';
  const rawStatus = (formData.get('status') as string | null)?.trim() || 'ACTIVE';

  let code: string;
  let status: string;
  if (isLead) {
    // Prospective-Lead: auto-generate a unique LEAD_ code from the company name.
    // Check against ALL codes (incl. soft-deleted) since the unique index isn't
    // partial. The status is locked to match the code type.
    const { rows } = await risansiPool.query<{ code: string }>('SELECT code FROM clients');
    const taken = new Set(rows.map(r => String(r.code).toUpperCase()));
    code   = uniqueLeadCode(legalName, c => taken.has(c));
    status = 'PROSPECTIVE_LEAD';
  } else {
    // Real client (Prospective-Client or Active): the admin supplies the code,
    // which must NOT be a LEAD_ code — those are reserved for auto-coded leads.
    code = (formData.get('code') as string | null)?.toUpperCase().trim() ?? '';
    if (!code) throw new Error('Client code is required.');
    if (isLeadCode(code)) throw new Error('A LEAD_ code is reserved for leads — choose "Prospective-Lead" to auto-generate one, or enter a real ERP client code.');
    // Check ALL codes (incl. soft-deleted): the clients.code unique index is not
    // partial, so a soft-deleted code would still collide on INSERT — surface the
    // friendly message rather than a raw constraint violation.
    const existing = await risansiPool.query<{ id: number }>(
      'SELECT id FROM clients WHERE UPPER(code) = $1', [code],
    );
    if (existing.rows.length > 0) {
      throw new Error(`Code ${code} already exists`);
    }
    // A real code can't hold a lead status; anything unknown falls back to ACTIVE.
    status = (rawStatus !== 'PROSPECTIVE_LEAD' && (CLIENT_STATUSES as readonly string[]).includes(rawStatus))
      ? rawStatus : 'ACTIVE';
  }

  const result = await risansiPool.query<{ id: number }>(
    `INSERT INTO clients (
       code, legal_name, trade_name, group_name,
       country, state, city, address, google_maps_url,
       market_type, industry, is_sugar, client_type,
       is_tender, capacity_bracket, tcd, klpd,
       status, tier, since_year, tour_id,
       created_by, created_at, updated_at, is_end_client
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,
       $20,$21,$22,NOW(),NOW(),$23
     ) RETURNING id`,
    [
      code,
      legalName,
      (formData.get('trade_name')        as string | null)?.trim() || null,
      (formData.get('group_name')        as string | null)?.trim() || null,
      (formData.get('country')           as string | null)?.trim() || 'India',
      (formData.get('state')             as string | null)?.trim() || null,
      (formData.get('city')              as string | null)?.trim() || null,
      (formData.get('address')           as string | null)?.trim() || null,
      (formData.get('google_maps_url')   as string | null)?.trim() || null,
      (formData.get('market_type')       as string | null)?.trim() || 'Domestic',
      normaliseIndustry((formData.get('industry') as string | null)?.trim() || null),
      formData.get('is_sugar') === 'true',
      (formData.get('client_type')       as string | null)?.trim() || null,
      formData.get('is_tender') === 'true',
      (formData.get('capacity_bracket')  as string | null)?.trim() || null,
      formData.get('tcd')  ? parseInt(formData.get('tcd')  as string) : null,
      formData.get('klpd') ? parseInt(formData.get('klpd') as string) : null,
      status,
      (formData.get('tier')              as string | null)?.trim() || 'Standard',
      (formData.get('since_year')        as string | null)?.trim() || null,
      formData.get('tour_id') ? parseInt(formData.get('tour_id') as string, 10) : null,
      email,
      formData.get('is_end_client') === 'true',
    ],
  );

  const clientId = result.rows[0].id;

  // Owners (flat multi-owner model) + legacy shim + audit.
  // Owners derive from the client's tour (set via tour_id above); no direct sync.

  // Save contacts
  await saveContacts(
    clientId,
    (formData.get('contacts_json') as string) ?? '[]',
    parseDeletedIds(formData.get('deleted_contact_ids')),
    email,
  );

  await logActivity('client', String(clientId), `created: ${code} · ${legalName}`, email);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/admin/clients');
  revalidatePath('/risansi');

  // Any new prospect (Prospective-Lead or Prospective-Client) → tell the tour manager.
  if (isProspectiveStatus(status)) {
    await notifyNewLead(Number(clientId), email);
  }
}

/**
 * Convert a Prospective-Lead into a Prospective-Client: swap its auto LEAD_ code
 * for the real ERP client code and flip the status. Reuses updateClient's code
 * cascade so the denormalised client_code snapshots stay in sync. Returns the new
 * code so the caller can navigate to the client's new URL.
 */
export async function convertLeadToClient(clientId: number, erpCode: string): Promise<{ newCode: string }> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) throw new Error('Unauthorized');
  const email = session!.user.email ?? 'system';

  if (!Number.isInteger(clientId)) throw new Error('Invalid client.');
  const newCode = (erpCode ?? '').toUpperCase().trim();
  if (!newCode) throw new Error('Enter the ERP client code.');
  if (isLeadCode(newCode)) throw new Error('The new code must be a real ERP client code, not a LEAD_ code.');

  const cur = (await risansiPool.query<{ code: string; status: string; legal_name: string }>(
    'SELECT code, status, legal_name FROM clients WHERE id = $1', [clientId],
  )).rows[0];
  if (!cur) throw new Error('Client not found.');
  if (!isLeadCode(cur.code)) throw new Error('This client already has a real client code — nothing to convert.');

  const dup = await risansiPool.query('SELECT 1 FROM clients WHERE UPPER(code) = $1 AND id <> $2', [newCode, clientId]);
  if (dup.rows.length > 0) throw new Error(`Client code "${newCode}" is already in use.`);

  const oldCode = cur.code;
  const tx = await risansiPool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(
      `UPDATE clients SET code = $1, status = 'PROSPECTIVE_CLIENT', updated_by = $2, updated_at = NOW() WHERE id = $3`,
      [newCode, email, clientId],
    );
    // client_code is a plain text copy (no FK) in these tables — keep it in sync.
    for (const tbl of ['client_pumps', 'competitor_installed_base', 'complaints']) {
      await tx.query(
        `UPDATE ${tbl} SET client_code = $1 WHERE client_id = $2 OR (client_code = $3 AND client_id IS NULL)`,
        [newCode, clientId, oldCode],
      );
    }
    await tx.query('COMMIT');
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }

  try {
    await risansiPool.query(
      `INSERT INTO client_status_log (client_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, cur.status, 'PROSPECTIVE_CLIENT', `Converted lead to client (${oldCode} → ${newCode})`, email],
    );
  } catch { /* table may not exist */ }

  await logActivity('client', String(clientId), `converted lead ${oldCode} → client ${newCode} · ${cur.legal_name}`, email);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/admin/clients');
  revalidatePath(`/risansi/clients/${oldCode}`);
  revalidatePath(`/risansi/clients/${newCode}`);
  revalidatePath('/risansi');
  return { newCode };
}
