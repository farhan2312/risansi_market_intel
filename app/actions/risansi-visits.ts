'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Cached check: does opportunities.secondary_rep_id exist?
let _oppHasSecondaryRep: boolean | null = null;
async function opportunitiesHasSecondaryRep(): Promise<boolean> {
  if (_oppHasSecondaryRep !== null) return _oppHasSecondaryRep;
  try {
    const { rows } = await risansiPool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'opportunities' AND column_name = 'secondary_rep_id' LIMIT 1`,
    );
    _oppHasSecondaryRep = rows.length > 0;
  } catch {
    _oppHasSecondaryRep = false;
  }
  return _oppHasSecondaryRep;
}

// Insert an auto-created opportunity, including secondary_rep_id only if the column exists.
async function insertAutoOpp(fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  const ph   = cols.map((_, i) => `$${i + 1}`);
  await risansiPool.query(
    `INSERT INTO opportunities (${cols.join(', ')}, auto_created, created_at, updated_at)
     VALUES (${ph.join(', ')}, TRUE, NOW(), NOW())`,
    Object.values(fields),
  );
}

// ── Expansion opportunity (visit form "Expansion / New Business") ──
// Upserts a single auto_source='expansion_plan' opportunity for the visit as
// the form is filled (debounced from the client); deletes it when toggled off.
export async function saveExpansionOpportunity(input: {
  visitId: number;
  clientId: number;
  repId: number | null;
  hasExpansion: boolean;
  product: string;
  productType: string;
  stage: string;
  valueLakh: number | null;
  probability: number;
  etaText: string | null;
  quoteRef: string | null;
  notes: string | null;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const existing = await risansiPool.query<{ id: number }>(
    `SELECT id FROM opportunities
     WHERE visit_id = $1 AND auto_source = 'expansion_plan'
     ORDER BY created_at DESC LIMIT 1`,
    [input.visitId],
  );
  const existingId = existing.rows[0]?.id ?? null;

  // Toggled "No" → drop the draft expansion opp if one exists.
  if (!input.hasExpansion) {
    if (existingId) {
      await risansiPool.query('DELETE FROM opportunities WHERE id = $1', [existingId]);
      revalidatePath(`/risansi/visits/${input.visitId}`);
      revalidatePath('/risansi/pipeline');
    }
    return;
  }

  // Resolve the owning rep so it's never null: passed-in → reps-by-email →
  // session.repId → client's primary rep.
  let repId = input.repId;
  if (!repId) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM reps WHERE email = $1 AND is_active = TRUE LIMIT 1',
      [session.user.email],
    );
    repId = r.rows[0]?.id ?? session.user.repId ?? null;
  }
  if (!repId) {
    const c = await risansiPool.query<{ primary_rep_id: number | null }>(
      'SELECT primary_rep_id FROM clients WHERE id = $1',
      [input.clientId],
    );
    repId = c.rows[0]?.primary_rep_id ?? null;
  }

  const product = input.product.trim() || 'Expansion';
  const valueCr = input.valueLakh && input.valueLakh > 0 ? input.valueLakh / 100 : null;

  if (existingId) {
    await risansiPool.query(
      `UPDATE opportunities SET
         rep_id = COALESCE($2, rep_id),
         product = $3, product_type = $4, stage = $5,
         value_cr = $6, probability = $7, eta_text = $8,
         quote_ref = $9, notes = $10, updated_at = NOW()
       WHERE id = $1`,
      [existingId, repId, product, input.productType, input.stage,
       valueCr, input.probability, input.etaText, input.quoteRef, input.notes],
    );
  } else {
    await risansiPool.query(
      `INSERT INTO opportunities (
         client_id, rep_id, visit_id, product, product_type, stage,
         value_cr, probability, eta_text, quote_ref, notes,
         auto_created, auto_source, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,'expansion_plan',$12,NOW(),NOW())`,
      [input.clientId, repId, input.visitId, product, input.productType, input.stage,
       valueCr, input.probability, input.etaText, input.quoteRef, input.notes, session.user.email],
    );
  }

  revalidatePath(`/risansi/visits/${input.visitId}`);
  revalidatePath('/risansi/pipeline');
}

// ── Check In ───────────────────────────────────────────────────

export async function checkInVisit({
  visitId, lat, lng, accuracy, manual = false, manualNote,
}: {
  visitId: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  manual?: boolean;
  manualNote?: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new Error('Not authenticated');

    await risansiPool.query(
      `UPDATE visits SET
         check_in_time       = NOW(),
         check_in_lat        = $1,
         check_in_lng        = $2,
         check_in_accuracy_m = $3,
         manual_checkin      = $4,
         manual_checkin_note = $5,
         gps_within_radius   = NULL,
         status              = CASE WHEN status = 'planned' THEN 'checked-in' ELSE status END,
         updated_at          = NOW()
       WHERE id = $6 AND submitted_at IS NULL`,
      [lat, lng, accuracy, manual, manualNote ?? null, visitId],
    );

    revalidatePath(`/risansi/visits/${visitId}`);
  } catch (err) {
    console.error('checkInVisit error:', err);
    throw err;
  }
}

// ── Auto-save visit fields ─────────────────────────────────────

const SAFE_VISIT_COLS = new Set([
  'purpose', 'outcome', 'summary', 'industry_format',
  'competitor_activity_observed', 'sample_or_gift_given',
  'sample_gift_detail', 'sample_gift_value',
  'follow_up_required', 'follow_up_text', 'follow_up_due_date',
  'next_visit_recommendation', 'performance_feedback',
  'pcp_competitor', 'mgmt_intervention', 'action_points',
  'complaint_notes', 'competitors_observed',
  'open_remarks', 'major_remarks',
  'ice_dispersal_by', 'negotiation_by',
  'is_unplanned', 'unplanned_reason',
]);

const SAFE_SUGAR_COLS = new Set([
  'ril_screw_molasses', 'ril_screw_magma', 'ril_screw_syrup',
  'ril_screw_massecuite', 'ril_screw_melt', 'ril_screw_dosing',
  'ril_screw_other', 'ril_rota_magma', 'ril_rota_massecuite',
  'ril_spares_feedback', 'ril_spares_notes',
  'other_screw_molasses', 'other_screw_magma', 'other_screw_syrup',
  'other_screw_massecuite', 'other_screw_melt', 'other_screw_dosing',
  'other_screw_other', 'other_rota_magma', 'other_rota_massecuite',
  'purchasing_route', 'purchasing_route_detail',
  'has_expansion', 'expansion_detail',
  'has_pending_offers', 'pending_offers_detail',
  'has_complaints', 'complaints_detail',
  'has_returnable_material', 'returnable_detail',
  'has_outstanding_issues', 'outstanding_detail',
  'perf_cert_required', 'perf_cert_detail',
  'last_pump_order', 'last_spares_order',
  'competitor_prices_captured', 'competitor_pics_count', 'checked_by',
]);

const SAFE_NONSUGAR_COLS = new Set([
  'deal_in', 'valves_observed_notes', 'checked_by',
]);

export async function saveVisitField(
  visitId: string,
  fields: Record<string, unknown>,
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const { rows } = await risansiPool.query(
    'SELECT submitted_at FROM visits WHERE id = $1',
    [visitId],
  );
  if (rows[0]?.submitted_at) throw new Error('Visit is already closed');

  const visitFields:   Record<string, unknown> = {};
  const sugarFields:   Record<string, unknown> = {};
  const nonsugFields:  Record<string, unknown> = {};

  for (const [key, val] of Object.entries(fields)) {
    if (SAFE_VISIT_COLS.has(key))    visitFields[key]   = val;
    if (SAFE_SUGAR_COLS.has(key))    sugarFields[key]   = val;
    if (SAFE_NONSUGAR_COLS.has(key)) nonsugFields[key]  = val;
  }

  if (Object.keys(visitFields).length > 0) {
    const cols = Object.keys(visitFields);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    await risansiPool.query(
      `UPDATE visits SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [visitId, ...Object.values(visitFields)],
    );
  }

  if (Object.keys(sugarFields).length > 0) {
    const cols = Object.keys(sugarFields);
    const vals = Object.values(sugarFields);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    await risansiPool.query(
      `INSERT INTO visit_sugar_report (visit_id, ${cols.join(', ')})
       VALUES ($1, ${placeholders})
       ON CONFLICT (visit_id) DO UPDATE SET ${sets.join(', ')}`,
      [visitId, ...vals],
    );
  }

  if (Object.keys(nonsugFields).length > 0) {
    const cols = Object.keys(nonsugFields);
    const vals = Object.values(nonsugFields);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    await risansiPool.query(
      `INSERT INTO visit_nonsugar_report (visit_id, ${cols.join(', ')})
       VALUES ($1, ${placeholders})
       ON CONFLICT (visit_id) DO UPDATE SET ${sets.join(', ')}`,
      [visitId, ...vals],
    );
  }
}

// ── Add equipment ──────────────────────────────────────────────

export async function addEquipment(
  visitId: string,
  clientId: string,
  data: {
    pump_type: string; supplier: string; is_ril: boolean;
    model?: string; qty?: number; application?: string;
    capacity_m3h?: number; head_m?: number; kw?: number;
    drive_system?: string; moc?: string; condition?: string;
    performance_feedback?: string;
    reason_for_competitor?: string;
    competitor_activity_type?: string;
  },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const isOpp = !data.is_ril && data.condition === 'EOL';

  await risansiPool.query(
    `INSERT INTO equipment (
       client_id, visit_id, pump_type, supplier, is_ril,
       model, qty, application, capacity_m3h, head_m, kw,
       drive_system, moc, condition, performance_feedback,
       reason_for_competitor, competitor_activity_type,
       is_opportunity, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()
     )`,
    [
      clientId, visitId,
      data.pump_type, data.supplier, data.is_ril,
      data.model ?? null, data.qty ?? 1, data.application ?? null,
      data.capacity_m3h ?? null, data.head_m ?? null, data.kw ?? null,
      data.drive_system ?? null, data.moc ?? null,
      data.condition ?? null, data.performance_feedback ?? null,
      data.reason_for_competitor ?? null, data.competitor_activity_type ?? null,
      isOpp,
    ],
  );

  revalidatePath(`/risansi/visits/${visitId}`);
}

// ── Submit (close) visit ───────────────────────────────────────

export async function submitVisit(visitId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const [visitRes, sugarRes, dispRes] = await Promise.all([
    risansiPool.query(
      `SELECT v.*, c.legal_name, c.id::text AS cid
       FROM visits v JOIN clients c ON v.client_id = c.id
       WHERE v.id = $1 AND v.submitted_at IS NULL`,
      [visitId],
    ),
    risansiPool.query('SELECT * FROM visit_sugar_report WHERE visit_id = $1', [visitId]).catch(() => ({ rows: [] })),
    risansiPool.query('SELECT * FROM equipment WHERE visit_id = $1 AND is_opportunity = TRUE', [visitId]).catch(() => ({ rows: [] })),
  ]);

  const visit = visitRes.rows[0];
  if (!visit) throw new Error('Visit not found or already closed');

  const sugar     = sugarRes.rows[0];
  const dispOpps  = dispRes.rows;

  const repRes = await risansiPool.query<{ id: number }>(
    'SELECT id FROM reps WHERE email = $1 AND is_active = TRUE LIMIT 1',
    [session.user.email],
  );
  // Resolve the submitting rep from multiple sources so it's never null:
  // reps-by-email → session.repId → visit.rep_id.
  const repId = repRes.rows[0]?.id ?? session.user.repId ?? visit.rep_id ?? null;

  // Assign both reps from the client, falling back to the (now hardened)
  // submitting rep so an auto-created opp always has an owner.
  const clientRepRes = await risansiPool.query<{
    primary_rep_id: number | null; secondary_rep_id: number | null;
  }>(
    'SELECT primary_rep_id, secondary_rep_id FROM clients WHERE id = $1',
    [visit.client_id],
  );
  const primaryRepId   = clientRepRes.rows[0]?.primary_rep_id ?? repId;
  console.log('submitVisit repId resolved:', { repId, primaryRepId });
  const secondaryRepId = clientRepRes.rows[0]?.secondary_rep_id ?? null;
  const hasSecondary   = await opportunitiesHasSecondaryRep();
  const secondaryField = hasSecondary ? { secondary_rep_id: secondaryRepId } : {};

  // 1. Close the visit
  await risansiPool.query(
    `UPDATE visits SET
       status         = 'completed',
       submitted_at   = NOW(),
       check_out_time = COALESCE(check_out_time, NOW()),
       updated_at     = NOW()
     WHERE id = $1`,
    [visitId],
  );

  // 2. Expansion opportunities are now created live from the visit form's
  //    "Expansion / New Business" section (saveExpansionOpportunity), so the
  //    submit no longer creates one from visit_sugar_report.

  // 3. Auto-create displacement opportunities
  for (const equip of dispOpps) {
    await insertAutoOpp({
      client_id:    visit.client_id,
      rep_id:       primaryRepId,
      ...secondaryField,
      visit_id:     visitId,
      equipment_id: equip.id,
      product:      `${equip.supplier} ${equip.model ?? ''} replacement`.trim(),
      product_type: equip.pump_type,
      stage:        'Suspect',
      notes:        `Auto-created: EOL ${equip.supplier} pump (${equip.application ?? 'n/a'}) observed.`,
      auto_source:  'displacement',
      created_by:   session.user.email,
    });
  }

  // 4. Auto-create follow-up task
  if (visit.follow_up_required && visit.follow_up_text) {
    // Owner: submitting rep first, client's primary as last resort — so the
    // follow-up is never left unassigned (primaryRepId = client.primary ?? repId).
    const followUpRepId = repId ?? primaryRepId;
    await risansiPool.query(
      `INSERT INTO tasks
         (visit_id, client_id, assigned_to_rep, title, description,
          due_date, priority, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Medium','open',$7,NOW(),NOW())`,
      [
        visitId, visit.client_id, followUpRepId,
        `Follow up — ${visit.legal_name}`,
        visit.follow_up_text,
        visit.follow_up_due_date ?? null,
        session.user.email,
      ],
    );
  }

  // 5. Update client last_visit_date
  await risansiPool.query(
    `UPDATE clients SET
       last_visit_date = $1, updated_at = NOW()
     WHERE id = $2
       AND (last_visit_date IS NULL OR last_visit_date < $1)`,
    [visit.visit_date, visit.client_id],
  );

  revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath(`/risansi/clients/${visit.cid}`);
  revalidatePath('/risansi/field');
}
