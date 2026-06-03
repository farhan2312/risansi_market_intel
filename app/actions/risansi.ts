'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// ── Helper ─────────────────────────────────────────────────────

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  return session.user;
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

async function logActivity(entityType: string, entityId: string, action: string, email: string) {
  try {
    await risansiPool.query(
      `INSERT INTO risansi_activity_log (entity_type, entity_id, action, email, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [entityType, entityId, action, email],
    );
  } catch {
    // activity log is non-critical — never let it break the action
  }
}

// ── Access request ─────────────────────────────────────────────

export async function requestAccess(_formData: FormData) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  const email = session.user.email;
  const displayName = session.user.name ?? email;

  await risansiPool.query(
    `INSERT INTO access_requests (email, display_name, status, created_at)
     VALUES ($1, $2, 'Pending', NOW())
     ON CONFLICT (email) DO NOTHING`,
    [email, displayName],
  );

  await risansiPool.query(
    `INSERT INTO risansi_activity_log (email, action, created_at)
     VALUES ($1, 'access_requested', NOW())`,
    [email],
  );

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

// ── Client: update client details ─────────────────────────────

export async function updateClient(clientId: number, formData: FormData): Promise<void> {
  const user = await requireSession();

  // Fetch current status for change logging
  let currentStatus: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ status: string }>(
      `SELECT status FROM clients WHERE id = $1`, [clientId],
    );
    currentStatus = rows[0]?.status ?? null;
  } catch { /* ignore */ }

  const newStatus = (formData.get('status') as string | null)?.trim() ?? currentStatus ?? 'ACTIVE';

  const core = [
    (formData.get('legal_name')        as string)?.trim() ?? '',      // $1
    (formData.get('trade_name')        as string | null)?.trim() || null, // $2
    (formData.get('industry')          as string)?.trim() ?? '',      // $3
    formData.get('is_sugar') === 'true',                              // $4
    (formData.get('client_type')       as string)?.trim() ?? '',      // $5
    (formData.get('market_type')       as string | null)?.trim() || 'Domestic', // $6
    (formData.get('state')             as string | null)?.trim() || null,  // $7
    (formData.get('city')              as string | null)?.trim() || null,  // $8
    (formData.get('address')           as string | null)?.trim() || null,  // $9
    formData.get('tcd')  ? parseInt(formData.get('tcd')  as string) : null, // $10
    formData.get('klpd') ? parseFloat(formData.get('klpd') as string) : null, // $11
    formData.get('primary_rep_id')   ? parseInt(formData.get('primary_rep_id')   as string) : null, // $12
    (formData.get('primary_rep_name')  as string | null)?.trim() || null, // $13
    (formData.get('tour_name')         as string | null)?.trim() || null, // $14
    (formData.get('since_year')        as string | null)?.trim() || null, // $15
    newStatus,                                                         // $16
    (formData.get('tier')              as string | null)?.trim() || 'Standard', // $17
    (formData.get('performance_feedback') as string | null)?.trim() || null, // $18
    (formData.get('action_points')     as string | null)?.trim() || null, // $19
    (formData.get('pcp_competitor')    as string | null)?.trim() || null, // $20
    (formData.get('mgmt_intervention') as string | null)?.trim() || null, // $21
    (formData.get('constraints_notes') as string | null)?.trim() || null, // $22
    clientId,                                                          // $23
  ];

  // Try full UPDATE with all columns; fall back to core-only if schema differs
  try {
    await risansiPool.query(
      `UPDATE clients SET
        legal_name           = $1,
        trade_name           = $2,
        group_name           = $3,
        industry             = $4,
        is_sugar             = $5,
        client_type          = $6,
        market_type          = $7,
        country              = $8,
        state                = $9,
        city                 = $10,
        address              = $11,
        google_maps_url      = $12,
        capacity_bracket     = $13,
        tcd                  = $14,
        klpd                 = $15,
        primary_rep_id       = $16,
        primary_rep_name     = $17,
        secondary_rep_id     = $18,
        secondary_rep_name   = $19,
        tour_name            = $20,
        since_year           = $21,
        status               = $22,
        tier                 = $23,
        performance_feedback = $24,
        action_points        = $25,
        pcp_competitor       = $26,
        mgmt_intervention    = $27,
        constraints_notes    = $28,
        action_target_date_raw = $29,
        mgmt_intervention2     = $30,
        total_outstanding      = $31,
        expected_to_spare      = $32,
        expected_to_pump       = $33,
        weightage_score        = $34,
        competitors_observed   = $35,
        open_remarks           = $36,
        major_remarks          = $37,
        ice_dispersal_by       = $38,
        negotiation_by         = $39,
        updated_by             = $40,
        updated_at           = NOW()
      WHERE id = $41`,
      [
        (formData.get('legal_name')          as string)?.trim() ?? '',
        (formData.get('trade_name')          as string | null)?.trim() || null,
        (formData.get('group_name')          as string | null)?.trim() || null,
        (formData.get('industry')            as string)?.trim() ?? '',
        formData.get('is_sugar') === 'true',
        (formData.get('client_type')         as string)?.trim() ?? '',
        (formData.get('market_type')         as string | null)?.trim() || 'Domestic',
        (formData.get('country')             as string | null)?.trim() || 'India',
        (formData.get('state')               as string | null)?.trim() || null,
        (formData.get('city')                as string | null)?.trim() || null,
        (formData.get('address')             as string | null)?.trim() || null,
        (formData.get('google_maps_url')     as string | null)?.trim() || null,
        (formData.get('capacity_bracket')    as string | null)?.trim() || null,
        formData.get('tcd')  ? parseInt(formData.get('tcd')  as string) : null,
        formData.get('klpd') ? parseFloat(formData.get('klpd') as string) : null,
        formData.get('primary_rep_id')   ? parseInt(formData.get('primary_rep_id')   as string) : null,
        (formData.get('primary_rep_name')    as string | null)?.trim() || null,
        formData.get('secondary_rep_id') ? parseInt(formData.get('secondary_rep_id') as string) : null,
        (formData.get('secondary_rep_name')  as string | null)?.trim() || null,
        (formData.get('tour_name')           as string | null)?.trim() || null,
        (formData.get('since_year')          as string | null)?.trim() || null,
        newStatus,
        (formData.get('tier')                as string | null)?.trim() || 'Standard',
        (formData.get('performance_feedback') as string | null)?.trim() || null,
        (formData.get('action_points')       as string | null)?.trim() || null,
        (formData.get('pcp_competitor')      as string | null)?.trim() || null,
        (formData.get('mgmt_intervention')   as string | null)?.trim() || null,
        (formData.get('constraints_notes')   as string | null)?.trim() || null,
        (formData.get('action_target_date_raw') as string | null)?.trim() || null,
        (formData.get('mgmt_intervention2')     as string | null)?.trim() || null,
        formData.get('total_outstanding') ? parseFloat(formData.get('total_outstanding') as string) : null,
        formData.get('expected_to_spare')   ? parseFloat(formData.get('expected_to_spare') as string) : null,
        formData.get('expected_to_pump')    ? parseFloat(formData.get('expected_to_pump') as string) : null,
        formData.get('weightage_score')     ? parseFloat(formData.get('weightage_score') as string) : null,
        (formData.get('competitors_observed') as string | null)?.trim() || null,
        (formData.get('open_remarks')       as string | null)?.trim() || null,
        (formData.get('major_remarks')      as string | null)?.trim() || null,
        (formData.get('ice_dispersal_by')   as string | null)?.trim() || null,
        (formData.get('negotiation_by')     as string | null)?.trim() || null,
        user.email ?? 'system',
        clientId,
      ],
    );
  } catch {
    // Fallback: core columns only
    await risansiPool.query(
      `UPDATE clients SET
        legal_name           = $1,
        trade_name           = $2,
        industry             = $3,
        is_sugar             = $4,
        client_type          = $5,
        market_type          = $6,
        state                = $7,
        city                 = $8,
        address              = $9,
        tcd                  = $10,
        klpd                 = $11,
        primary_rep_id       = $12,
        primary_rep_name     = $13,
        tour_name            = $14,
        since_year           = $15,
        status               = $16,
        tier                 = $17,
        performance_feedback = $18,
        action_points        = $19,
        pcp_competitor       = $20,
        mgmt_intervention    = $21,
        constraints_notes    = $22,
        updated_at           = NOW()
      WHERE id = $23`,
      core,
    );
  }

  // Log status change
  if (currentStatus && newStatus !== currentStatus) {
    try {
      await risansiPool.query(
        `INSERT INTO client_status_log
           (client_id, from_status, to_status, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, currentStatus, newStatus, 'Updated via edit form', user.email],
      );
    } catch { /* table may not exist */ }
  }

  await logActivity('client', String(clientId), 'Client Updated', user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/clients');
}

// ── Client: plan visit ─────────────────────────────────────────

export async function planVisit(clientId: string, formData: FormData) {
  const user = await requireSession();

  const visitDate = (formData.get('visit_date') as string | null)?.trim();
  const purpose   = (formData.get('purpose')    as string | null)?.trim() ?? 'Routine';
  const repId     = (formData.get('rep_id')     as string | null)?.trim() ?? null;

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  // Resolve rep_id — use selected rep, fall back to client's primary rep, then any active rep
  let resolvedRepId: number | null = repId ? parseInt(repId) : null;

  if (!resolvedRepId) {
    const clientData = await risansiPool.query<{ primary_rep_id: number | null }>(
      'SELECT primary_rep_id FROM clients WHERE id = $1',
      [clientId],
    );
    resolvedRepId = clientData.rows[0]?.primary_rep_id ?? null;
  }

  if (!resolvedRepId) {
    const anyRep = await risansiPool.query<{ id: number }>(
      'SELECT id FROM reps WHERE is_active = TRUE LIMIT 1',
    );
    resolvedRepId = anyRep.rows[0]?.id ?? null;
  }

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

  // Resolve rep — fall back to client's primary rep
  const clientData = await risansiPool.query<{ primary_rep_id: number | null }>(
    'SELECT primary_rep_id FROM clients WHERE id = $1',
    [clientId],
  );
  const resolvedRepId = clientData.rows[0]?.primary_rep_id ?? null;

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

  const clientId = (formData.get('client_id')       as string | null)?.trim() ?? '';
  const product  = (formData.get('product')          as string | null)?.trim() ?? 'New Opportunity';
  const prodType = (formData.get('product_type')      as string | null)?.trim() || 'PCP';
  const stage    = (formData.get('stage')            as string | null)?.trim() ?? 'Suspect';
  // Accept value in Lakhs (₹12.5L → 0.125 Cr); fall back to legacy estimated_value (Cr)
  const valueLakh = parseFloat((formData.get('value_lakh') as string | null) ?? '');
  const value     = Number.isFinite(valueLakh)
    ? valueLakh / 100
    : (parseFloat((formData.get('estimated_value') as string | null) ?? '0') || 0);
  const prob     = parseInt((formData.get('probability')       as string | null) ?? '25', 10) || 25;
  const eta      = (formData.get('eta_text')         as string | null)?.trim()
                   || (formData.get('expected_close') as string | null)?.trim() || null;
  const quoteRef = (formData.get('quote_ref')        as string | null)?.trim() || null;
  const notes    = (formData.get('notes')            as string | null)?.trim() || null;

  if (!clientId) return;

  // Reps come from the form (pre-filled from the client, editable per opportunity).
  // Changing them here affects only this opportunity, never the client record.
  const selectedRepId = formData.get('rep_id')
    ? parseInt(formData.get('rep_id') as string, 10)
    : null;
  const secondaryRepId = formData.get('secondary_rep_id')
    ? parseInt(formData.get('secondary_rep_id') as string, 10)
    : null;

  // Fallback to client's primary rep if the form somehow omitted it
  let primaryRepId = selectedRepId;
  if (!primaryRepId) {
    const { rows } = await risansiPool.query<{ primary_rep_id: number | null }>(
      'SELECT primary_rep_id FROM clients WHERE id = $1', [clientId],
    );
    primaryRepId = rows[0]?.primary_rep_id ?? null;
  }
  if (!primaryRepId) {
    throw new Error('Please select a Primary Rep for this opportunity.');
  }

  const hasSecondary = await opportunitiesHasSecondaryRep();
  let oppRows: { id: string }[];
  if (hasSecondary) {
    ({ rows: oppRows } = await risansiPool.query<{ id: string }>(
      `INSERT INTO opportunities
         (client_id, rep_id, secondary_rep_id, product, product_type, stage, value_cr, probability, eta_text, quote_ref, notes, auto_created, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE, $12, NOW(), NOW())
       RETURNING id`,
      [clientId, primaryRepId, secondaryRepId, product, prodType, stage, value, prob, eta, quoteRef, notes, user.email],
    ));
  } else {
    ({ rows: oppRows } = await risansiPool.query<{ id: string }>(
      `INSERT INTO opportunities
         (client_id, rep_id, product, product_type, stage, value_cr, probability, eta_text, quote_ref, notes, auto_created, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, NOW(), NOW())
       RETURNING id`,
      [clientId, primaryRepId, product, prodType, stage, value, prob, eta, quoteRef, notes, user.email],
    ));
  }

  // Log stage creation
  const newOppId = oppRows[0]?.id ?? null;
  if (newOppId) {
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, NULL, $2, 'Created via pipeline', $3)`,
        [newOppId, stage, user.email],
      );
    } catch { /* table may not exist */ }
  }

  await logActivity('pipeline', clientId, `created opportunity: ${product} · ${stage} · ₹${value} Cr`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Pipeline: update stage ─────────────────────────────────────

export async function updateOpportunityStage(id: string, formData: FormData) {
  const user = await requireSession();

  const stage = (formData.get('stage') as string | null)?.trim() ?? 'Suspect';

  await risansiPool.query(
    `UPDATE opportunities SET stage = $1, updated_at = NOW() WHERE id = $2`,
    [stage, id],
  );

  await logActivity('opportunity', id, `stage updated to ${stage}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Pipeline: full opportunity edit ────────────────────────────

export async function updateOpportunity(oppId: number, formData: FormData) {
  const user = await requireSession();

  // Lock guard — a Won/Lost opp can't be edited unless it's being moved out of that stage
  const { rows: cur } = await risansiPool.query<{ stage: string }>(
    'SELECT stage FROM opportunities WHERE id = $1', [oppId],
  );
  const currentStage = cur[0]?.stage;
  const newStage     = (formData.get('stage') as string | null) ?? currentStage;
  if ((currentStage === 'Won' || currentStage === 'Lost') && newStage === currentStage) {
    throw new Error('This opportunity is locked and cannot be edited.');
  }

  const valueLakh = parseFloat((formData.get('value_lakh')       as string | null) ?? '0');
  const finalLakh = parseFloat((formData.get('final_value_lakh') as string | null) ?? '0');
  const num = (k: string) => (formData.get(k) ? parseInt(formData.get(k) as string, 10) : null);

  // For rep_id: if empty/null, fall back to the client's primary rep
  const rawRepId = formData.get('rep_id');
  let repId = rawRepId && rawRepId !== '' ? parseInt(rawRepId as string, 10) : null;
  if (!repId) {
    const { rows } = await risansiPool.query<{ primary_rep_id: number | null }>(
      `SELECT primary_rep_id FROM clients
       WHERE id = (SELECT client_id FROM opportunities WHERE id = $1)`,
      [oppId],
    );
    repId = rows[0]?.primary_rep_id ?? null;
  }
  // secondary_rep_id can be null
  const rawSecRepId = formData.get('secondary_rep_id');
  const secRepId = rawSecRepId && rawSecRepId !== '' ? parseInt(rawSecRepId as string, 10) : null;

  // Candidate columns → values. Only those present on the table are written.
  const candidates: Record<string, unknown> = {
    product:            (formData.get('product') as string | null)?.trim() || null,
    product_type:       (formData.get('product_type') as string | null) || 'PCP',
    stage:              (formData.get('stage') as string | null) || 'Suspect',
    value_cr:           valueLakh > 0 ? valueLakh / 100 : null,
    probability:        num('probability'),
    eta_text:           (formData.get('eta_text') as string | null) || null,
    quote_ref:          (formData.get('quote_ref') as string | null) || null,
    quote_date:         (formData.get('quote_date') as string | null) || null,
    negotiation_notes:  (formData.get('negotiation_notes') as string | null) || null,
    notes:              (formData.get('notes') as string | null) || null,
    rep_id:             repId,
    secondary_rep_id:   secRepId,
    po_number:          (formData.get('po_number') as string | null) || null,
    final_value_cr:     finalLakh > 0 ? finalLakh / 100 : null,
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
  const repId     = (formData.get('rep_id')      as string | null)?.trim() || null;
  const visitDate = (formData.get('visit_date')  as string | null)?.trim();
  const purpose   = (formData.get('purpose')     as string | null)?.trim() ?? 'Routine';
  const notes     = (formData.get('notes')       as string | null)?.trim() || null;

  if (!clientId) return;

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  // Try full insert with optional columns; fall back to minimal if schema differs
  try {
    await risansiPool.query(
      `INSERT INTO visits
         (client_id, rep_id, visit_date, purpose, status, is_planned, summary, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'planned', TRUE, $5, NOW(), NOW())`,
      [clientId, repId, date, purpose, notes],
    );
  } catch {
    await risansiPool.query(
      `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
       VALUES ($1, $2, $3, $4, 'planned', NOW())`,
      [clientId, repId, date, purpose],
    );
  }

  await logActivity('client', clientId, `visit assigned for ${date} · ${purpose}`, user.email!);
  revalidatePath('/risansi/visits');
  revalidatePath(`/risansi/clients/${clientId}`);
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
      await risansiPool.query(
        `INSERT INTO opportunities
           (client_id, product, stage, value_cr, probability, auto_created, created_at, updated_at)
         VALUES ($1, $2, 'Suspect', $3, 25, TRUE, NOW(), NOW())`,
        [clientId, data.opportunityProduct, data.opportunityValue || 0],
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
  const valueLakh   = parseFloat((formData.get('value_lakh') as string | null) ?? '0') || 0;
  const valueCr     = valueLakh > 0 ? valueLakh / 100 : null;  // Lakhs → Crores
  const probability = parseInt((formData.get('probability') as string | null) ?? '0', 10) || null;
  const etaText     = (formData.get('eta_text')      as string | null)?.trim() || null;
  const quoteRef    = (formData.get('quote_ref')     as string | null)?.trim() || null;
  const notes       = (formData.get('notes')         as string | null)?.trim() || null;

  if (!clientId) throw new Error('Client ID required');

  // Resolve primary rep for this client (non-fatal)
  let repId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ primary_rep_id: string | null }>(
      'SELECT primary_rep_id FROM clients WHERE id = $1',
      [clientId],
    );
    repId = rows[0]?.primary_rep_id ?? null;
  } catch { /* ignore */ }

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

  const desc = `${product} · ${stage}${valueLakh > 0 ? ` · ₹${valueLakh}L` : ''}`;
  await logActivity('client', clientId, `opportunity created: ${desc}`, user.email!);

  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Client: add new client ─────────────────────────────────────

export async function addClient(formData: FormData): Promise<{ error?: string; id?: string }> {
  const user = await requireSession();

  const code           = (formData.get('code')            as string | null)?.trim().toUpperCase() ?? '';
  const legalName      = (formData.get('legal_name')      as string | null)?.trim() ?? '';
  const industryId     = (formData.get('industry_id')     as string | null)?.trim() || null;
  const industry       = (formData.get('industry')         as string | null)?.trim() || null;
  const clientType     = (formData.get('client_type')     as string | null)?.trim() || null;
  const zone           = (formData.get('zone')             as string | null)?.trim() || null;
  const route          = (formData.get('route')            as string | null)?.trim() || null;
  const repId          = (formData.get('rep_id')           as string | null)?.trim() || null;
  const repName        = (formData.get('rep_name')         as string | null)?.trim() || null;
  const city           = (formData.get('city')             as string | null)?.trim() || null;
  const state          = (formData.get('state')            as string | null)?.trim() || null;
  const pincode        = (formData.get('pincode')          as string | null)?.trim() || null;
  const address        = (formData.get('address')          as string | null)?.trim() || null;
  const googleMapsUrl  = (formData.get('google_maps_url')  as string | null)?.trim() || null;
  const phone          = (formData.get('phone')            as string | null)?.trim() || null;
  const email          = (formData.get('email')            as string | null)?.trim() || null;
  const website        = (formData.get('website')          as string | null)?.trim() || null;
  const gstin          = (formData.get('gstin')            as string | null)?.trim() || null;
  const isSugar        = formData.get('is_sugar') === 'true';
  const tcdKlpd        = parseFloat((formData.get('tcd_klpd') as string | null) ?? '') || null;
  const tier           = (formData.get('tier')             as string | null)?.trim() || null;
  const status         = (formData.get('status')           as string | null)?.trim() || 'ACTIVE';
  const marketType     = (formData.get('market_type')     as string | null)?.trim() || null;
  const businessCat    = (formData.get('business_category') as string | null)?.trim() || null;

  // Validate required fields
  if (!code || !/^[A-Z]{4}\d{2}[A-Z]\d{3}$/.test(code)) {
    return { error: 'Client code must match pattern: 4 letters, 2 digits, 1 letter, 3 digits (e.g. ABCD01E002).' };
  }
  if (!legalName || legalName.length < 3) {
    return { error: 'Legal name must be at least 3 characters.' };
  }
  if (!industry) {
    return { error: 'Industry is required.' };
  }
  if (!clientType) {
    return { error: 'Client type is required.' };
  }

  // Duplicate check
  try {
    const dup = await risansiPool.query<{ id: string }>(
      `SELECT id FROM clients WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
      [code],
    );
    if (dup.rows.length > 0) {
      return { error: `Client code ${code} already exists.` };
    }
  } catch { /* ignore if clients table differs */ }

  // Insert
  let newId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ id: string }>(
      `INSERT INTO clients
         (code, legal_name, industry_id, industry, client_type, zone, route,
          primary_rep_id, primary_rep_name,
          city, state, pincode, address, google_maps_url,
          phone, email, website, gstin,
          is_sugar, tcd_klpd, tier, status, market_type, business_category,
          created_at, updated_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),NOW())
       RETURNING id`,
      [
        code, legalName, industryId, industry, clientType, zone, route,
        repId || null, repName || null,
        city, state, pincode, address, googleMapsUrl,
        phone, email, website, gstin,
        isSugar, tcdKlpd, tier, status, marketType, businessCat,
      ],
    );
    newId = rows[0]?.id ?? null;
  } catch {
    // Fallback: minimal insert (columns may differ)
    try {
      const { rows } = await risansiPool.query<{ id: string }>(
        `INSERT INTO clients (code, legal_name, industry, client_type, zone, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         RETURNING id`,
        [code, legalName, industry, clientType, zone, status],
      );
      newId = rows[0]?.id ?? null;
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : 'Database error';
      return { error: `Failed to create client: ${msg}` };
    }
  }

  if (newId) {
    await logActivity('client', newId, `created: ${code} · ${legalName}`, user.email!);
  }

  revalidatePath('/risansi/clients');
  revalidatePath('/risansi');

  return { id: newId ?? undefined };
}
