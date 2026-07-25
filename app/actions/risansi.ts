'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getManagerAssignableReps, hasRole, getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';
import { normalizeClientName, uniqueLeadCode } from '@/lib/risansi-lead-code';
import { resolveClientPrimaryRep } from '@/lib/risansi-client-rep';
import { requiredFieldNames, labelsFor, CREATE_STAGES, STAGE_PROB, type CreateStage } from '@/lib/risansi-opportunity-fields';
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
async function userCanEditOpp(
  user: { role?: string; repId?: number | null },
  oppRepId: number | null,
): Promise<boolean> {
  const role = user.role ?? 'rep';
  if (hasRole(role, 'admin')) return true;
  if (user.repId != null && oppRepId != null && Number(oppRepId) === Number(user.repId)) return true;
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

export async function planVisit(clientId: string, formData: FormData) {
  const user = await requireSession();

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
}

// ── Client: create opportunity ─────────────────────────────────

export async function createOpportunity(clientId: string, formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const product  = (formData.get('product')  as string | null)?.trim() ?? 'New Opportunity';
  const stage    = (formData.get('stage')    as string | null)?.trim() ?? 'Suspect';
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

  const value = crOf('value_inr') ?? (offerInr ? offerInr / 10_000_000 : null);
  const prob  = Number.isFinite(parseInt((formData.get('probability') as string | null) ?? '', 10))
    ? parseInt(formData.get('probability') as string, 10) : STAGE_PROB[stage];
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
  const primaryRepId = user.role === 'rep' ? creatorRepId : derived.repId;

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
  const { rows: oppRows } = await risansiPool.query<{ id: string }>(
    `INSERT INTO opportunities (${cols.join(', ')}, created_at, updated_at)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, NOW(), NOW())
     RETURNING id`,
    cols.map(c => candidates[c]),
  );
  const newOppId = oppRows[0]?.id ?? null;

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

// ── Pipeline: update stage ─────────────────────────────────────

export async function updateOpportunityStage(id: string, formData: FormData) {
  const user = await requireSession();

  const stage = (formData.get('stage') as string | null)?.trim() ?? 'Suspect';

  // Ownership — assigned rep, their tour manager, or admin/sysadmin only.
  const { rows: oppRows } = await risansiPool.query<{ rep_id: number | null; stage: string }>(
    'SELECT rep_id, stage FROM opportunities WHERE id = $1', [id],
  );
  if (!oppRows[0]) throw new Error('Opportunity not found');
  if (!(await userCanEditOpp(user, oppRows[0].rep_id))) {
    throw new Error('You do not have permission to edit this opportunity.');
  }
  // Gate: Quoted is a mandatory gateway — Negotiating / Won / Lost are only
  // reachable once a card has been Quoted, so it can never skip straight to Won/Lost.
  if (['Negotiating', 'Won', 'Lost'].includes(stage)
      && !['Quoted', 'Negotiating', 'Won', 'Lost'].includes(oppRows[0].stage)) {
    throw new Error('Move this opportunity through Quoted first.');
  }

  await risansiPool.query(
    `UPDATE opportunities SET stage = $1, updated_at = NOW() WHERE id = $2`,
    [stage, id],
  );

  await logActivity('opportunity', id, `stage updated to ${stage}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Pipeline: move to Quoted + capture the quotation details ───
// Dedicated to the "move to Quoted" flow so unrelated columns are never wiped
// (unlike updateOpportunity, which nulls any candidate field the form omits).
export async function saveQuotedDetails(oppId: number, formData: FormData) {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ stage: string; rep_id: number | null }>(
    'SELECT stage, rep_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) throw new Error('Opportunity not found');
  if (rows[0].stage === 'Won' || rows[0].stage === 'Lost') {
    throw new Error('This opportunity is locked and cannot be edited.');
  }
  if (!(await userCanEditOpp(user, rows[0].rep_id))) {
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

  await risansiPool.query(
    `UPDATE opportunities SET
       stage = 'Quoted',
       quote_ref = $1, quote_date = $2, enquiry_no = $3, enquiry_date = $4,
       revised_offer_date = $5, quotation_link = $6,
       offer_value_inr = $7, offer_value_usd = $8,
       revised_offer_value_inr = $9, revised_offer_value_usd = $10,
       market = $11, ril_rep = $12, qtn_prepared_by = $13, client_status_at_quote = $14,
       unit_project = $15, location = $16, qtr = $17, probability_code = $18,
       product_type    = COALESCE($19, product_type),
       value_cr        = COALESCE($20, value_cr),
       notes           = COALESCE($21, notes),
       pump_model = $22, pump_qty = $23,
       updated_at = NOW()
     WHERE id = $24`,
    [s('quote_ref'), s('quote_date'), s('enquiry_no'), s('enquiry_date'),
     s('revised_offer_date'), s('quotation_link'),
     offerInr, n('offer_value_usd'), n('revised_offer_value_inr'), n('revised_offer_value_usd'),
     s('market'), s('ril_rep'), s('qtn_prepared_by'), s('client_status_at_quote'),
     s('unit_project'), s('location'), s('qtr'), s('probability_code'),
     s('product_type'), valueCr, s('notes'),
     iStr(first.pump_model) ?? s('pump_model'), iInt(first.pump_qty) ?? i('pump_qty'), oppId],
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
}

// ── Pipeline: full opportunity edit ────────────────────────────

export async function updateOpportunity(oppId: number, formData: FormData) {
  const user = await requireSession();

  // Lock guard — a Won/Lost opp can't be edited unless it's being moved out of that stage
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null }>(
    'SELECT stage, rep_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) throw new Error('Opportunity not found');

  // Ownership — assigned rep, their tour manager, or admin/sysadmin only.
  if (!(await userCanEditOpp(user, cur[0].rep_id))) {
    throw new Error('You do not have permission to edit this opportunity.');
  }

  const currentStage = cur[0]?.stage;
  const newStage     = (formData.get('stage') as string | null) ?? currentStage;
  if ((currentStage === 'Won' || currentStage === 'Lost') && newStage === currentStage) {
    throw new Error('This opportunity is locked and cannot be edited.');
  }
  // Gate: Quoted is a mandatory gateway (see updateOpportunityStage).
  if (['Negotiating', 'Won', 'Lost'].includes(newStage ?? '')
      && !['Quoted', 'Negotiating', 'Won', 'Lost'].includes(currentStage ?? '')) {
    throw new Error('Move this opportunity through Quoted first.');
  }

  const valueInr = parseFloat((formData.get('value_inr')       as string | null) ?? '0');
  const finalInr = parseFloat((formData.get('final_value_inr') as string | null) ?? '0');
  const num = (k: string) => (formData.get(k) ? parseInt(formData.get(k) as string, 10) : null);

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
    probability:        num('probability'),
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

  const existing = await opportunityColumns();
  const cols = Object.keys(candidates).filter(c => existing.size === 0 || existing.has(c));
  if (cols.length === 0) return;

  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const vals = cols.map(c => candidates[c]);
  await risansiPool.query(
    `UPDATE opportunities SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
    [...vals, oppId],
  );

  await logActivity('opportunity', String(oppId), `updated opportunity · ${candidates.stage}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Pipeline: delete opportunity ───────────────────────────────

export async function deleteOpportunity(oppId: number) {
  const user = await requireSession();
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

export async function updateOpportunityValue(id: string, formData: FormData) {
  const user = await requireSession();

  const value = parseFloat((formData.get('estimated_value') as string | null) ?? '0') || 0;
  const prob  = parseInt((formData.get('probability')       as string | null) ?? '25', 10) || 25;

  await risansiPool.query(
    `UPDATE opportunities
     SET value_cr = $1, probability = $2, updated_at = NOW()
     WHERE id = $3`,
    [value, prob, id],
  );

  await logActivity('opportunity', id, `value updated: ₹${value} Cr · ${prob}%`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Visits: assign visit ───────────────────────────────────────

export async function assignVisit(formData: FormData) {
  const user = await requireSession();

  const clientId  = (formData.get('client_id')  as string | null)?.trim() ?? '';
  const visitDate = (formData.get('visit_date')  as string | null)?.trim();
  const purpose   = (formData.get('purpose')     as string | null)?.trim() ?? 'Routine';
  const notes     = (formData.get('notes')       as string | null)?.trim() || null;

  // A missing client must surface as an error — never report a fake success.
  if (!clientId) throw new Error('Please select a client before scheduling a visit.');

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
  }
  return visitId;
}

// ── Mobile: save visit identity + contacts ─────────────────────

export async function saveVisitContacts(
  visitId: string,
  visitType: string,
  contactIds: string[],
  newContacts: Array<{ name: string; designation: string; phone: string }>,
): Promise<void> {
  const user = await requireSession();

  // Store visit_type (column may not exist — non-fatal)
  try {
    await risansiPool.query(
      `UPDATE visits SET visit_type = $1 WHERE id = $2`,
      [visitType, visitId],
    );
  } catch { /* column not yet added */ }

  // Delete previous contacts-met for this visit, then re-insert
  try {
    await risansiPool.query(`DELETE FROM visit_contacts WHERE visit_id = $1`, [visitId]);
    for (const contactId of contactIds) {
      await risansiPool.query(
        `INSERT INTO visit_contacts (visit_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [visitId, contactId],
      );
    }
  } catch { /* table may not exist */ }

  // Create new contacts
  // Get client_id from the visit first
  let clientId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ client_id: string }>(
      `SELECT client_id FROM visits WHERE id = $1`,
      [visitId],
    );
    clientId = rows[0]?.client_id ?? null;
  } catch { /* ignore */ }

  if (clientId) {
    for (const c of newContacts) {
      if (!c.name.trim()) continue;
      try {
        await risansiPool.query(
          `INSERT INTO contacts (client_id, name, designation, phone, is_primary, created_at)
           VALUES ($1, $2, $3, $4, false, NOW())`,
          [clientId, c.name.trim(), c.designation?.trim() || null, c.phone?.trim() || null],
        );
      } catch { /* ignore */ }
    }
  }

  await logActivity('visit', visitId, `contacts recorded: ${visitType}`, user.email!);
  revalidatePath('/risansi/mobile');
}

// ── Mobile: save equipment entries (RIL + competitor) ─────────

export async function saveEquipmentEntries(
  visitId: string,
  clientId: string,
  entries: Array<{
    supplier: string;
    application: string;
    model: string;
    qty: number;
    condition: string;
    isRil: boolean;
    notes: string;
  }>,
): Promise<void> {
  const user = await requireSession();

  for (const e of entries) {
    if (!e.application.trim() && !e.model.trim()) continue;
    const isOpportunity = !e.isRil && e.condition === 'End of Life';
    try {
      await risansiPool.query(
        `INSERT INTO equipment_assessment_entries
           (client_id, station, equipment_type, supplier, model, quantity, condition, opportunity, created_at)
         VALUES ($1, $2, 'Pump', $3, $4, $5, $6, $7, NOW())`,
        [
          clientId,
          e.application.trim() || null,
          e.supplier.trim() || 'Unknown',
          e.model.trim() || null,
          Math.max(1, e.qty),
          e.condition || 'Unknown',
          isOpportunity,
        ],
      );
    } catch { /* ignore individual failures */ }
  }

  await logActivity('visit', visitId, `equipment recorded: ${entries.length} entries`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
}

// ── Mobile: submit completed visit report ─────────────────────

export async function submitVisitReport(
  visitId: string,
  data: {
    outcome: string;
    summary: string;
    commercial: Record<string, boolean | string>;
    createOpportunity: boolean;
    opportunityProduct: string;
    opportunityValue: number;
  },
): Promise<void> {
  const user = await requireSession();

  // Get client_id for opportunity creation + revalidation
  let clientId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ client_id: string }>(
      `SELECT client_id FROM visits WHERE id = $1`,
      [visitId],
    );
    clientId = rows[0]?.client_id ?? null;
  } catch { /* ignore */ }

  // Mark visit completed
  await risansiPool.query(
    `UPDATE visits SET status = 'completed', outcome = $1, notes = $2, updated_at = NOW()
     WHERE id = $3`,
    [data.outcome || null, data.summary || null, visitId],
  );

  // Optionally set submitted_at
  try {
    await risansiPool.query(
      `UPDATE visits SET submitted_at = NOW() WHERE id = $1`,
      [visitId],
    );
  } catch { /* column may not exist */ }

  // Save commercial notes as JSON in visit_commercial_notes (non-fatal)
  try {
    await risansiPool.query(
      `INSERT INTO visit_commercial_notes (visit_id, data, created_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (visit_id) DO UPDATE SET data = EXCLUDED.data`,
      [visitId, JSON.stringify(data.commercial)],
    );
  } catch { /* table may not exist */ }

  // Auto-create opportunity if expansion plans flagged
  if (data.createOpportunity && clientId && data.opportunityProduct) {
    try {
      // opportunityValue arrives as the full rupee amount; value_cr is Crores.
      await risansiPool.query(
        `INSERT INTO opportunities
           (client_id, product, stage, value_cr, probability, auto_created, created_at, updated_at)
         VALUES ($1, $2, 'Suspect', $3, 25, TRUE, NOW(), NOW())`,
        [clientId, data.opportunityProduct, data.opportunityValue ? data.opportunityValue / 10_000_000 : 0],
      );
    } catch { /* ignore */ }
  }

  await logActivity('visit', visitId, `report submitted · ${data.outcome}`, user.email!);
  if (clientId) revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/mobile');
  revalidatePath('/risansi/visits');
}

// ── Client: submit new opportunity (from NewOpportunityDrawer) ─

export async function submitOpportunity(formData: FormData) {
  const user = await requireSession();

  const clientId    = (formData.get('client_id')    as string | null)?.trim() ?? '';
  const product     = (formData.get('product')       as string | null)?.trim() ?? 'New Opportunity';
  const productType = (formData.get('product_type')  as string | null)?.trim() ?? 'PCP';
  const stage       = (formData.get('stage')         as string | null)?.trim() ?? 'Suspect';
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

  const isLead = formData.get('is_lead') === 'true';

  let code: string;
  if (isLead) {
    // Lead: auto-generate a unique LEAD_ code from the company name. Check against
    // ALL codes (incl. soft-deleted) since the unique index is not partial.
    const { rows } = await risansiPool.query<{ code: string }>('SELECT code FROM clients');
    const taken = new Set(rows.map(r => String(r.code).toUpperCase()));
    code = uniqueLeadCode(legalName, c => taken.has(c));
  } else {
    // Client: the admin supplies the code.
    code = (formData.get('code') as string | null)?.toUpperCase().trim() ?? '';
    if (!code) throw new Error('Client code is required.');
    const existing = await risansiPool.query<{ id: number }>(
      'SELECT id FROM clients WHERE code = $1 AND deleted_at IS NULL', [code],
    );
    if (existing.rows.length > 0) {
      throw new Error(`Code ${code} already exists`);
    }
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
      (formData.get('status')            as string | null)?.trim() || 'ACTIVE',
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
}
