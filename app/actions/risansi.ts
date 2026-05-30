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

export async function addContact(clientId: string, formData: FormData) {
  const user = await requireSession();

  const name        = (formData.get('name')        as string | null)?.trim() ?? '';
  const designation = (formData.get('designation') as string | null)?.trim() ?? null;
  const phone       = (formData.get('phone')       as string | null)?.trim() ?? null;
  const email       = (formData.get('email')       as string | null)?.trim() ?? null;
  const isPrimary   = formData.get('is_primary') === 'on';

  if (!name) return; // minimal validation — no UI error needed server-side

  await risansiPool.query(
    `INSERT INTO contacts (client_id, name, designation, phone, email, is_primary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [clientId, name, designation, phone, email, isPrimary],
  );

  await logActivity('client', clientId, `added contact: ${name}${designation ? ` (${designation})` : ''}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
}

// ── Client: plan visit ─────────────────────────────────────────

export async function planVisit(clientId: string, formData: FormData) {
  const user = await requireSession();

  const visitDate = (formData.get('visit_date') as string | null)?.trim();
  const purpose   = (formData.get('purpose')    as string | null)?.trim() ?? 'Routine';
  const repId     = (formData.get('rep_id')     as string | null)?.trim() ?? null;

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  await risansiPool.query(
    `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
     VALUES ($1, $2, $3, $4, 'planned', NOW())`,
    [clientId, repId, date, purpose],
  );

  await logActivity('client', clientId, `planned visit on ${date} · ${purpose}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
}

// ── Client: create opportunity ─────────────────────────────────

export async function createOpportunity(clientId: string, formData: FormData) {
  const user = await requireSession();

  const product  = (formData.get('product')  as string | null)?.trim() ?? 'New Opportunity';
  const stage    = (formData.get('stage')    as string | null)?.trim() ?? 'Suspect';
  const value    = parseFloat((formData.get('estimated_value') as string | null) ?? '0') || 0;
  const prob     = parseInt((formData.get('probability') as string | null) ?? '25', 10) || 25;
  const eta      = (formData.get('expected_close') as string | null)?.trim() ?? null;

  await risansiPool.query(
    `INSERT INTO pipeline_opportunities
       (client_id, product, stage, estimated_value, probability, expected_close, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [clientId, product, stage, value, prob, eta],
  );

  await logActivity('client', clientId, `created opportunity: ${product} · ${stage} · ₹${value} Cr`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi'); // refresh exec dashboard pipeline
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
  const stage    = (formData.get('stage')            as string | null)?.trim() ?? 'Suspect';
  const value    = parseFloat((formData.get('estimated_value') as string | null) ?? '0') || 0;
  const prob     = parseInt((formData.get('probability')       as string | null) ?? '25', 10) || 25;
  const eta      = (formData.get('expected_close')   as string | null)?.trim() ?? null;

  if (!clientId) return;

  await risansiPool.query(
    `INSERT INTO pipeline_opportunities
       (client_id, product, stage, estimated_value, probability, expected_close, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [clientId, product, stage, value, prob, eta],
  );

  await logActivity('pipeline', clientId, `created opportunity: ${product} · ${stage} · ₹${value} Cr`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Pipeline: update stage ─────────────────────────────────────

export async function updateOpportunityStage(id: string, formData: FormData) {
  const user = await requireSession();

  const stage = (formData.get('stage') as string | null)?.trim() ?? 'Suspect';

  await risansiPool.query(
    `UPDATE pipeline_opportunities SET stage = $1, updated_at = NOW() WHERE id = $2`,
    [stage, id],
  );

  await logActivity('opportunity', id, `stage updated to ${stage}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
}

// ── Pipeline: update value / probability ──────────────────────

export async function updateOpportunityValue(id: string, formData: FormData) {
  const user = await requireSession();

  const value = parseFloat((formData.get('estimated_value') as string | null) ?? '0') || 0;
  const prob  = parseInt((formData.get('probability')       as string | null) ?? '25', 10) || 25;

  await risansiPool.query(
    `UPDATE pipeline_opportunities
     SET estimated_value = $1, probability = $2, updated_at = NOW()
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

  if (!clientId) return;

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  await risansiPool.query(
    `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
     VALUES ($1, $2, $3, $4, 'planned', NOW())`,
    [clientId, repId, date, purpose],
  );

  await logActivity('client', clientId, `visit assigned for ${date} · ${purpose}`, user.email!);
  revalidatePath('/risansi/visits');
  revalidatePath(`/risansi/clients/${clientId}`);
}
