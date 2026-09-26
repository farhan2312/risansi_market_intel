'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole, canViewClient, type CurrentUser } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import { pushInApp } from '@/lib/risansi-inapp';
import { sendNotification } from '@/lib/risansi-email';
import {
  pageById, STATUSES, NEXT, canEditPage, canMove, gateFor, severityOf, holderFor, isFieldShown,
  type ComplaintStatus, type ComplaintValues, type ComplaintField,
} from '@/lib/risansi-complaint-flow';

// The complaint workflow's writes. Every refusal is returned, never thrown —
// a thrown message is redacted in production and the form would show nothing
// useful. The rules live in lib/risansi-complaint-flow; this file applies them
// to rows.

export type SaveResult = { ok: true } | { ok: false; error: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

// ── Loading with access ────────────────────────────────────────────────────

interface AccessRow {
  id: number; complaint_no: string; status: string; schema_version: number; client_id: number | null;
  complaint_type: string | null; investigation_assigned_to: number | null; action_assigned_to: number | null;
  returnable_owner: number | null; rep_user_id: number | null; reported_by_user: number | null; created_by: string | null;
  assigned_to_user: number | null;
}

async function loadAccess(id: number): Promise<{ user: CurrentUser; row: AccessRow; worksClient: boolean; canSee: boolean } | null> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<AccessRow>(
    `SELECT id, complaint_no, status, schema_version, client_id, complaint_type, investigation_assigned_to,
            action_assigned_to, returnable_owner, rep_user_id, reported_by_user, created_by, assigned_to_user
       FROM complaints WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  // Ownership only — owner, cover, or a manager of either — which is what
  // canViewClient answers for a non-admin.
  const worksClient = row.client_id != null && !hasRole(user.role, 'admin') && !user.departments.length
    ? await canViewClient(user, row.client_id) : false;
  const canSee = hasRole(user.role, 'admin') || user.role === 'staff' || user.departments.length > 0
    || worksClient || (user.id != null && [row.assigned_to_user, row.investigation_assigned_to, row.action_assigned_to, row.returnable_owner, row.reported_by_user].includes(user.id))
    || (!!user.email && !!row.created_by && row.created_by.toLowerCase() === user.email.toLowerCase());
  return { user, row, worksClient, canSee };
}

const editor = (u: CurrentUser) => ({ id: u.id, role: u.role, departments: u.departments });

// ── Value coercion ─────────────────────────────────────────────────────────

function coerce(f: ComplaintField, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  switch (f.type) {
    case 'bool': return raw === true || raw === 'true' || raw === 'yes' ? true : raw === false || raw === 'false' || raw === 'no' ? false : null;
    case 'number': { const n = Number(raw); return Number.isFinite(n) ? Math.round(n) : null; }
    case 'money': { const n = Number(String(raw).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : null; }
    case 'user':
    case 'oem': { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; }
    case 'date': { const s = String(raw).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
    default: return String(raw).trim().slice(0, f.type === 'long' ? 8000 : 500) || null;
  }
}

async function lookupValues(kind: string): Promise<Set<string>> {
  const { rows } = await risansiPool.query<{ value: string }>(
    'SELECT value FROM complaint_lookups WHERE kind = $1 AND is_active', [kind]);
  return new Set(rows.map(r => r.value));
}

// ── Create ─────────────────────────────────────────────────────────────────

async function nextComplaintNo(): Promise<string> {
  const { rows } = await risansiPool.query<{ next: number }>(
    `SELECT COALESCE(MAX(n), 165) + 1 AS next
       FROM (SELECT NULLIF(regexp_replace(complaint_no, '[^0-9]', '', 'g'), '')::int AS n FROM complaints) t
      WHERE n < 10000`);
  return `CMP-${String(rows[0]?.next ?? 166).padStart(4, '0')}`;
}

/**
 * Register a complaint — page 1, plus whatever of page 2 is already known.
 * Anyone who works the client (rep, manager), the Complaint Team, or an admin.
 * It opens at Open, held by the Complaint Team, and the team is told.
 */
export async function createComplaintV2(input: { client_id: number; values: Record<string, unknown> }): Promise<Result<{ id: number; complaint_no: string }>> {
  const user = await getCurrentUser();
  if (!user.email) return fail('Sign in again.');
  const clientId = Number(input.client_id);
  if (!Number.isInteger(clientId)) return fail('Pick a client.');
  const mayRaise = hasRole(user.role, 'admin') || user.departments.includes('Complaint Team') || await canViewClient(user, clientId);
  if (!mayRaise) return fail('You can raise a complaint only for a client you work. Ask the Complaint Team to register this one.');

  const page1 = pageById(1)!, page2 = pageById(2)!;
  const values: ComplaintValues = {};
  for (const f of [...page1.fields, ...page2.fields]) {
    const v = coerce(f, input.values[f.name]);
    if (v !== undefined) values[f.name] = v;
  }
  const missing = page1.fields.filter(f => f.required && (values[f.name] == null || values[f.name] === '')).map(f => f.label);
  if (missing.length) return fail(`Fill in: ${missing.join(', ')}.`);
  for (const f of page1.fields) {
    if (f.type === 'select' && f.lookup && values[f.name] != null && !(await lookupValues(f.lookup)).has(String(values[f.name]))) {
      return fail(`${f.label}: "${values[f.name]}" is not on the list.`);
    }
  }

  const { rows: [c] } = await risansiPool.query<{ code: string; legal_name: string; primary_rep_id: number | null }>(
    'SELECT code, legal_name, primary_rep_id FROM clients WHERE id = $1 AND deleted_at IS NULL', [clientId]);
  if (!c) return fail('That client no longer exists, or has been archived.');

  const cols = Object.keys(values);
  let savedId = 0, savedNo = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const no = await nextComplaintNo();
    try {
      const { rows } = await risansiPool.query<{ id: number }>(
        `INSERT INTO complaints (complaint_no, client_id, client_code, status, schema_version, priority, source,
                                 rep_user_id, reported_by_user, created_by, created_at, updated_at
                                 ${cols.length ? ', ' + cols.join(', ') : ''})
         VALUES ($1, $2, $3, 'Open', 2, 'Medium', 'app', $4, $5, $6, now(), now()
                 ${cols.length ? ', ' + cols.map((_, i) => `$${7 + i}`).join(', ') : ''})
         RETURNING id`,
        [no, clientId, c.code, c.primary_rep_id ?? (user.role === 'rep' ? user.id : null), user.id, user.email, ...cols.map(k => values[k])]);
      savedId = rows[0].id; savedNo = no;
      break;
    } catch (e) {
      if (attempt === 3 || !(e instanceof Error) || !/complaints_complaint_no_key|duplicate key/i.test(e.message)) {
        console.error('[createComplaintV2]', e);
        return fail('The complaint could not be saved — please try again.');
      }
    }
  }

  await risansiPool.query(
    `INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, actor_email) VALUES ($1, NULL, 'Open', 'Complaint Team', $2)`,
    [savedId, user.email]);
  await recordAudit({ action: 'create', entityType: 'complaint', entityId: savedId, entityLabel: `${savedNo} · ${c.legal_name}`,
    summary: `Complaint registered: ${String(values.defect_category ?? '')} — ${String(values.details ?? '').slice(0, 80)}`, actorEmail: user.email });
  await notifyDepartment('Complaint Team', user.email ?? '', {
    kind: 'complaint_raised', title: `New complaint ${savedNo} · ${c.legal_name}`,
    body: `${values.complaint_type ?? ''} · ${values.defect_category ?? ''}\n${String(values.details ?? '').slice(0, 200)}`,
    link: `/risansi/complaints/${savedId}`, subject: `New complaint ${savedNo}: ${c.legal_name}`,
  });

  revalidatePath('/risansi/complaints'); revalidatePath(`/risansi/clients/${clientId}`);
  return { ok: true, data: { id: savedId, complaint_no: savedNo } };
}

// ── Save one page ──────────────────────────────────────────────────────────

export async function saveComplaintPage(id: number, pageId: number, input: Record<string, unknown>): Promise<SaveResult> {
  const page = pageById(pageId);
  if (!page) return fail('No such page.');
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const { user, row } = a;
  if (!canEditPage(editor(user), { ...row, worksClient: a.worksClient }, page)) {
    return fail(row.schema_version < 2
      ? 'This is a legacy complaint, shown as it was recorded. It cannot be edited.'
      : row.status === 'Closed'
        ? 'This complaint is closed. Reopen it from Closure & Review if there is more to do.'
        : `${page.title} is edited by ${page.owner}${page.id === 4 || page.id === 5 || page.id === 7 ? ', or whoever it is assigned to' : ''}. Ask the Complaint Team.`);
  }

  // The full current record, so showWhen and the severity can be judged.
  const { rows: [cur] } = await risansiPool.query<ComplaintValues>('SELECT * FROM complaints WHERE id = $1', [id]);
  const values: ComplaintValues = { ...cur };
  const changed: Record<string, unknown> = {};
  for (const f of page.fields) {
    if (!(f.name in input)) continue;
    const v = coerce(f, input[f.name]);
    if (v === undefined) continue;
    if (f.type === 'select' && v != null) {
      const allowed = f.options ? new Set(f.options) : f.lookup ? await lookupValues(f.lookup) : null;
      if (allowed && !allowed.has(String(v))) return fail(`${f.label}: "${v}" is not on the list.`);
    }
    if (f.type === 'oem' && v != null) {
      const { rows } = await risansiPool.query(
        `SELECT 1 FROM clients WHERE id = $1 AND client_type = 'OEM' AND deleted_at IS NULL`, [v]);
      if (!rows.length) return fail(`${f.label}: that is not an OEM on the client master.`);
    }
    if (f.type === 'user' && v != null) {
      const { rows } = await risansiPool.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [v]);
      if (!rows.length) return fail(`${f.label}: that person is not an active user.`);
    }
    values[f.name] = v; changed[f.name] = v;
  }
  // A conditional field whose condition no longer holds is cleared, not kept.
  for (const f of page.fields) if (f.showWhen && !isFieldShown(f, values) && values[f.name] != null) { values[f.name] = null; changed[f.name] = null; }
  if (!Object.keys(changed).length) return { ok: true };

  if (page.id === 3) {
    changed.severity = severityOf(values as Parameters<typeof severityOf>[0]);
  }
  if (page.id === 8 && changed.repeat_complaint === undefined && cur.repeat_complaint == null) {
    changed.repeat_complaint = await isRepeat(id);
  }

  const keys = Object.keys(changed);
  await risansiPool.query(
    `UPDATE complaints SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
    [id, ...keys.map(k => changed[k])]);

  // Assigning a page's owner puts the complaint in their inbox.
  for (const k of ['investigation_assigned_to', 'action_assigned_to', 'returnable_owner'] as const) {
    if (changed[k] && changed[k] !== cur[k]) {
      await pushInApp([changed[k] as number], {
        kind: 'complaint_assigned', section: 'Complaints', actor: user.email,
        title: `${row.complaint_no}: ${k === 'investigation_assigned_to' ? 'investigation' : k === 'action_assigned_to' ? 'corrective action' : 'returnable material'} assigned to you`,
        link: `/risansi/complaints/${id}`, entityType: 'complaint', entityId: String(id),
      });
    }
  }
  await recordAudit({ action: 'update', entityType: 'complaint', entityId: id, entityLabel: row.complaint_no,
    summary: `${page.title}: ${keys.filter(k => k !== 'severity').join(', ')}${changed.severity ? ` · severity ${changed.severity}` : ''}`,
    metadata: changed, actorEmail: user.email });
  revalidatePath(`/risansi/complaints/${id}`); revalidatePath('/risansi/complaints');
  return { ok: true };
}

/** Same client, same pump model or serial, same defect category, within twelve months. */
async function isRepeat(id: number): Promise<boolean> {
  const { rows } = await risansiPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM complaints o, complaints c
      WHERE c.id = $1 AND o.id <> c.id AND o.client_id = c.client_id
        AND o.defect_category IS NOT DISTINCT FROM c.defect_category
        AND (o.pump_model IS NOT DISTINCT FROM c.pump_model OR (o.pump_serial_no IS NOT NULL AND o.pump_serial_no = c.pump_serial_no))
        AND COALESCE(o.complaint_date, o.created_at::date) >= COALESCE(c.complaint_date, c.created_at::date) - INTERVAL '12 months'
        AND COALESCE(o.complaint_date, o.created_at::date) <= COALESCE(c.complaint_date, c.created_at::date)`, [id]);
  return (rows[0]?.n ?? 0) > 0;
}

// ── Move ───────────────────────────────────────────────────────────────────

export async function moveComplaint(id: number, to: ComplaintStatus, note?: string): Promise<SaveResult> {
  if (!(STATUSES as readonly string[]).includes(to)) return fail('No such status.');
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const { user, row } = a;
  if (!canMove(editor(user), { ...row, worksClient: a.worksClient })) {
    return fail(row.schema_version < 2 ? 'Legacy complaints do not move; they are shown as they were recorded.'
      : 'Only the Complaint Team, QC, or the person a stage is assigned to can move a complaint.');
  }
  const from = row.status as ComplaintStatus;
  if (!(NEXT[from] ?? []).includes(to)) return fail(`A complaint at ${from} cannot go straight to ${to}.`);
  const reopening = (from === 'Resolved' || from === 'Closed') && to === 'Under Investigation';
  if (reopening && !note?.trim()) return fail('Say why it is being reopened.');

  const { rows: [cur] } = await risansiPool.query<ComplaintValues>('SELECT * FROM complaints WHERE id = $1', [id]);
  const { rows: [capa] } = await risansiPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM complaint_attachments WHERE complaint_id = $1 AND category = 'capa'`, [id]);
  const need = gateFor(from, to, { values: cur, severity: (cur.severity as never) ?? null, hasCapaDocument: capa.n > 0 });
  if (need.length && !reopening) return fail(`Before ${to}: ${need.join(' · ')}.`);

  const holder = holderFor(to, cur);
  const sets: string[] = ['status = $2', 'updated_at = now()'];
  const vals: unknown[] = [id, to];
  if (to === 'Resolved') { sets.push(`resolved_at = now()`, `resolved_by = $${vals.push(user.email)}`); }
  if (to === 'Closed')   { sets.push(`closed_at = now()`,   `closed_by = $${vals.push(user.email)}`); }
  if (reopening) {
    sets.push('resolved_at = NULL', 'resolved_by = NULL', 'closed_at = NULL', 'closed_by = NULL',
      'reopen_count = reopen_count + 1', `reopen_reason = $${vals.push(note!.trim())}`, 'customer_confirmed = NULL');
  }
  const c = await risansiPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE complaints SET ${sets.join(', ')} WHERE id = $1`, vals);
    await c.query(
      `INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, holder_user_id, note, actor_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, from, to, holder.department, holder.userId, note?.trim() || null, user.email]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('[moveComplaint]', e); return fail('The move could not be saved — please try again.'); }
  finally { c.release(); }

  await recordAudit({ action: reopening ? 'reopen' : 'status', entityType: 'complaint', entityId: id, entityLabel: row.complaint_no,
    summary: `${from} → ${to}${note ? ` — ${note.trim().slice(0, 120)}` : ''}`, actorEmail: user.email });

  // Whoever holds it next is told; the raiser hears about resolution and closure.
  const label = `${row.complaint_no} is now ${to}`;
  if (holder.userId) {
    await pushInApp([holder.userId], { kind: 'complaint_moved', section: 'Complaints', actor: user.email, title: label,
      body: note?.trim() || null, link: `/risansi/complaints/${id}`, entityType: 'complaint', entityId: String(id) });
  } else if (holder.department !== 'Customer') {
    await notifyDepartment(holder.department, user.email ?? '', { kind: 'complaint_moved', title: label, body: note?.trim() || null,
      link: `/risansi/complaints/${id}`, subject: label });
  }
  if ((to === 'Resolved' || to === 'Closed' || reopening) && row.reported_by_user && row.reported_by_user !== user.id) {
    await pushInApp([row.reported_by_user], { kind: 'complaint_moved', section: 'Complaints', actor: user.email, title: label,
      body: note?.trim() || null, link: `/risansi/complaints/${id}`, entityType: 'complaint', entityId: String(id) });
  }

  revalidatePath(`/risansi/complaints/${id}`); revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);
  return { ok: true };
}

// ── Attachments ────────────────────────────────────────────────────────────

export async function deleteComplaintAttachment(attachmentId: number): Promise<SaveResult> {
  const { rows: [att] } = await risansiPool.query<{ id: number; complaint_id: number; category: string; file_name: string }>(
    'SELECT id, complaint_id, category, file_name FROM complaint_attachments WHERE id = $1', [attachmentId]);
  if (!att) return fail('That file is already gone.');
  const a = await loadAccess(att.complaint_id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const page = pageById(att.category === 'capa' ? 6 : 1)!;
  if (!canEditPage(editor(a.user), { ...a.row, worksClient: a.worksClient }, page) && !canEditPage(editor(a.user), { ...a.row, worksClient: a.worksClient }, pageById(6)!)) {
    return fail('Only somebody who can edit this complaint can remove its files.');
  }
  await risansiPool.query('DELETE FROM complaint_attachments WHERE id = $1', [attachmentId]);
  await recordAudit({ action: 'delete', entityType: 'complaint', entityId: att.complaint_id, entityLabel: a.row.complaint_no,
    summary: `Removed ${att.category} file ${att.file_name}`, actorEmail: a.user.email });
  revalidatePath(`/risansi/complaints/${att.complaint_id}`);
  return { ok: true };
}

// ── Notes ──────────────────────────────────────────────────────────────────

/** A note on the complaint, from anyone who can see it. Goes to whoever holds it now, and the raiser. */
export async function addComplaintNote(id: number, body: string): Promise<SaveResult> {
  const text = String(body ?? '').trim();
  if (!text) return fail('Write something first.');
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  await risansiPool.query('INSERT INTO complaint_updates (complaint_id, body, created_by) VALUES ($1, $2, $3)', [id, text, a.user.email ?? 'system']);
  await risansiPool.query('UPDATE complaints SET updated_at = now() WHERE id = $1', [id]);
  const { rows: [h] } = await risansiPool.query<{ holder_user_id: number | null; holder_department: string | null }>(
    'SELECT holder_user_id, holder_department FROM complaint_stage_log WHERE complaint_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  const me = a.user.id;
  const card = { kind: 'complaint_update', title: `Note on ${a.row.complaint_no}`, body: text.slice(0, 300), link: `/risansi/complaints/${id}`, subject: `Note on complaint ${a.row.complaint_no}` };
  const people = [h?.holder_user_id, a.row.reported_by_user, a.row.rep_user_id].filter((x): x is number => x != null && x !== me);
  if (people.length) await pushInApp([...new Set(people)], { ...card, section: 'Complaints', actor: a.user.email ?? '', entityType: 'complaint' }).catch(() => {});
  if (h?.holder_department && h.holder_user_id == null && h.holder_department !== 'Customer') await notifyDepartment(h.holder_department, a.user.email ?? '', card);
  revalidatePath(`/risansi/complaints/${id}`);
  return { ok: true };
}

/** Admin only. Gone for good — the stage log and files go with it. */
export async function deleteComplaint(id: number): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!hasRole(user.role, 'admin')) return fail('Only an admin can delete a complaint.');
  const { rows: [c] } = await risansiPool.query<{ complaint_no: string; client_id: number | null }>('SELECT complaint_no, client_id FROM complaints WHERE id = $1', [id]);
  if (!c) return fail('Already gone.');
  await risansiPool.query('DELETE FROM complaints WHERE id = $1', [id]);
  await recordAudit({ action: 'delete', entityType: 'complaint', entityId: id, entityLabel: c.complaint_no, summary: `Complaint ${c.complaint_no} deleted`, actorEmail: user.email });
  revalidatePath('/risansi/complaints'); if (c.client_id) revalidatePath(`/risansi/clients/${c.client_id}`);
  return { ok: true };
}

// ── Lookups ────────────────────────────────────────────────────────────────

/** The installed base, by EC number or pump serial — fills page 2, every field still editable. */
export async function lookupPump(query: string, clientId?: number | null): Promise<Result<{
  so_no: string | null; ec_no: string | null; pump_serial_no: string | null; pump_model: string | null;
  liquid: string | null; head_pressure: string | null; quantity: number | null; client_name: string | null; matches: number;
} | null>> {
  const q = (query ?? '').trim();
  if (q.length < 3) return { ok: true, data: null };
  const { rows } = await risansiPool.query<{
    so_number: string | null; ec_number: string | null; pump_sl_no: string | null; pump_model_plate: string | null;
    liquid: string | null; head: string | null; quantity: number | null; client_name: string | null;
  }>(
    `SELECT p.so_number, p.ec_number, p.pump_sl_no, p.pump_model_plate, p.liquid, p.head, p.quantity, c.legal_name AS client_name
       FROM client_pumps p LEFT JOIN clients c ON c.id = p.client_id
      WHERE (upper(btrim(p.ec_number)) = upper($1) OR upper(btrim(p.pump_sl_no)) = upper($1))
        ${clientId ? 'AND p.client_id = $2' : ''}
      ORDER BY (p.client_id = $2) DESC NULLS LAST, p.id DESC LIMIT 5`,
    [q, clientId ?? null]);
  if (!rows.length) return { ok: true, data: null };
  const r = rows[0];
  return { ok: true, data: {
    so_no: r.so_number, ec_no: r.ec_number, pump_serial_no: r.pump_sl_no, pump_model: r.pump_model_plate,
    liquid: r.liquid, head_pressure: r.head, quantity: r.quantity, client_name: r.client_name, matches: rows.length,
  } };
}

// ── Notifying a department ─────────────────────────────────────────────────

async function notifyDepartment(department: string, actorEmail: string, card: { kind: string; title: string; body?: string | null; link: string; subject: string }) {
  try {
    const { rows } = await risansiPool.query<{ id: number; email: string; name: string }>(
      `SELECT u.id, u.email, u.name FROM user_departments d JOIN users u ON u.id = d.user_id AND u.is_active
        WHERE d.department = $1 AND lower(u.email) <> lower($2)`, [department, actorEmail]);
    if (!rows.length) return;
    await pushInApp(rows.map(r => r.id), { kind: card.kind, section: 'Complaints', actor: actorEmail, title: card.title, body: card.body ?? null, link: card.link, entityType: 'complaint' });
    await sendNotification({
      to: rows.map(r => r.email), subject: card.subject, section: 'Complaints',
      intro: `A complaint needs the ${department}.`, title: card.title, body: card.body ?? null,
      ctaLabel: 'Open the complaint', ctaPath: card.link,
    }).catch(() => {});
  } catch (e) { console.error('[complaints] department notification failed', e); }
}

// A plain read for the forms; kept here so the client never queries lookups itself.
export async function listComplaintLookups(): Promise<Record<string, string[]>> {
  const { rows } = await risansiPool.query<{ kind: string; value: string }>(
    'SELECT kind, value FROM complaint_lookups WHERE is_active ORDER BY kind, sort_order, value');
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.kind] ??= []).push(r.value);
  return out;
}

