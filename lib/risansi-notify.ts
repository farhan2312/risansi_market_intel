// Notification senders — business logic (who gets told what) on top of the
// generic card renderer in risansi-email.ts. Two kinds live here:
//   • Scheduled sweeps (run from the Vercel cron routes): overdue reminders,
//     the >5-day admin escalation, and the weekly manager digest.
//   • Event notifications: called best-effort from server actions when something
//     happens (check-in, complaint resolved, opp won, …).
// Every function is best-effort: it swallows its own errors so a failed send can
// never break a cron run or the action that triggered it.

import risansiPool from '@/lib/db-risansi';
import { sendNotification } from '@/lib/risansi-email';

const BRAND = '#0A3D8F';
const RED   = '#B91C1C';
const GREEN = '#0E7C57';

// ── shared lookups ──────────────────────────────────────────────

async function sysadmins(): Promise<{ name: string | null; email: string }[]> {
  const { rows } = await risansiPool.query<{ name: string | null; email: string }>(
    `SELECT name, email FROM users WHERE role = 'sysadmin' AND is_active = TRUE AND email IS NOT NULL AND email <> ''`);
  return rows;
}

/** Manager(s) on a client's tour, with email. */
async function tourManagers(clientId: number): Promise<{ name: string | null; email: string }[]> {
  const { rows } = await risansiPool.query<{ name: string | null; email: string }>(
    `SELECT u.name, u.email FROM tour_assignments ta
       JOIN users u ON u.id = ta.rep_id
      WHERE ta.role = 'manager' AND u.is_active = TRUE AND u.email IS NOT NULL AND u.email <> ''
        AND ta.tour_id = (SELECT tour_id FROM clients WHERE id = $1)`, [clientId]);
  return rows;
}

// Claim a scheduled window so a repeat fire can't re-send. Returns true only the
// first time for that (kind, run_key).
async function claimRun(kind: string, runKeySql: string): Promise<boolean> {
  try {
    const r = await risansiPool.query(
      `INSERT INTO notification_runs (kind, run_key) VALUES ($1, ${runKeySql})
         ON CONFLICT DO NOTHING RETURNING 1`, [kind]);
    return (r.rowCount ?? 0) > 0;
  } catch { return true; }  // marker table missing → don't block the send
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;

// ════════════════════════════════════════════════════════════════
//  SCHEDULED SWEEPS (called from /api/cron/*)
// ════════════════════════════════════════════════════════════════

// 1. Overdue actions → remind the responsible person once per day.
export async function runOverdueActionReminders(): Promise<number> {
  let sent = 0;
  try {
    const { rows } = await risansiPool.query<{
      id: number; title: string; due_date: string; days: number;
      rep_name: string | null; rep_email: string | null;
      ext_name: string | null; ext_email: string | null; client_name: string | null;
    }>(
      `SELECT t.id, t.title, t.due_date::text AS due_date, (CURRENT_DATE - t.due_date) AS days,
              r.name AS rep_name, r.email AS rep_email,
              t.assigned_to_external AS ext_name, t.assigned_to_external_email AS ext_email,
              c.legal_name AS client_name
         FROM tasks t
         LEFT JOIN users r   ON r.id = t.assigned_to_rep
         LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE
          AND (t.last_reminded_at IS NULL OR t.last_reminded_at::date < CURRENT_DATE)
        ORDER BY days DESC LIMIT 300`);
    for (const t of rows) {
      const to = t.rep_email || t.ext_email;
      const toName = t.rep_name || t.ext_name;
      if (!to) continue;   // no recipient yet — leave un-stamped so it re-selects once an email exists
      const res = await sendNotification({
        to, section: 'Action Registry', accent: RED, greetingName: firstName(toName),
        subject: `Overdue action: ${t.title}`,
        intro: `Your action is ${plural(t.days, 'day')} overdue. Please close it out or update its due date.`,
        title: t.title,
        meta: [['Client', t.client_name ?? '—'], ['Was due', prettyDate(t.due_date)], ['Overdue by', plural(t.days, 'day')]],
        ctaLabel: 'Open the Action Registry', ctaPath: '/risansi/registry',
      });
      // Only stamp on a real send, so a transient Resend failure retries next run.
      if (res.ok) { sent++; await risansiPool.query('UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1', [t.id]); }
    }
  } catch (e) { console.error('[cron] overdue action reminders failed', e); }
  return sent;
}

// 2. Overdue complaints → remind the assignee once per day.
export async function runOverdueComplaintReminders(): Promise<number> {
  let sent = 0;
  try {
    const { rows } = await risansiPool.query<{
      id: number; complaint_no: string; details: string; due_date: string; days: number;
      user_name: string | null; user_email: string | null;
      ext_name: string | null; ext_email: string | null; client_name: string | null;
    }>(
      `SELECT co.id, co.complaint_no, co.details, co.due_date::text AS due_date, (CURRENT_DATE - co.due_date) AS days,
              u.name AS user_name, u.email AS user_email,
              co.assigned_to_external AS ext_name, co.assigned_to_external_email AS ext_email,
              cl.legal_name AS client_name
         FROM complaints co
         LEFT JOIN users u    ON u.id = co.assigned_to_user
         LEFT JOIN clients cl ON cl.id = co.client_id
        WHERE co.status NOT IN ('Resolved','Closed') AND co.due_date IS NOT NULL AND co.due_date < CURRENT_DATE
          AND (co.last_reminded_at IS NULL OR co.last_reminded_at::date < CURRENT_DATE)
        ORDER BY days DESC LIMIT 300`);
    for (const co of rows) {
      const to = co.user_email || co.ext_email;
      const toName = co.user_name || co.ext_name;
      if (!to) continue;
      const res = await sendNotification({
        to, section: 'Complaints', accent: RED, greetingName: firstName(toName),
        subject: `Overdue complaint: ${co.complaint_no}`,
        intro: `Complaint ${co.complaint_no} is ${plural(co.days, 'day')} past its target date and still open.`,
        title: co.complaint_no, body: co.details,
        meta: [['Client', co.client_name ?? '—'], ['Target was', prettyDate(co.due_date)], ['Overdue by', plural(co.days, 'day')]],
        ctaLabel: 'Open the Complaints board', ctaPath: '/risansi/complaints',
      });
      if (res.ok) { sent++; await risansiPool.query('UPDATE complaints SET last_reminded_at = NOW() WHERE id = $1', [co.id]); }
    }
  } catch (e) { console.error('[cron] overdue complaint reminders failed', e); }
  return sent;
}

// 3. Anything overdue > 5 days → one digest to every system admin, naming the
//    person responsible. Not deduped: it re-sends daily while items linger.
export async function runAdminOverdueEscalation(): Promise<number> {
  try {
    const admins = await sysadmins();
    if (!admins.length) return 0;

    const acts = (await risansiPool.query<{ title: string; days: number; who: string | null; client_name: string | null }>(
      `SELECT t.title, (CURRENT_DATE - t.due_date) AS days,
              COALESCE(r.name, t.assigned_to_external, 'Unassigned') AS who, c.legal_name AS client_name
         FROM tasks t LEFT JOIN users r ON r.id = t.assigned_to_rep LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE - 5
        ORDER BY days DESC`)).rows;
    const comps = (await risansiPool.query<{ complaint_no: string; days: number; who: string | null; client_name: string | null }>(
      `SELECT co.complaint_no, (CURRENT_DATE - co.due_date) AS days,
              COALESCE(u.name, co.assigned_to_external, 'Unassigned') AS who, cl.legal_name AS client_name
         FROM complaints co LEFT JOIN users u ON u.id = co.assigned_to_user LEFT JOIN clients cl ON cl.id = co.client_id
        WHERE co.status NOT IN ('Resolved','Closed') AND co.due_date IS NOT NULL AND co.due_date < CURRENT_DATE - 5
        ORDER BY days DESC`)).rows;

    if (!acts.length && !comps.length) return 0;
    // Claim today so a repeat fire (retry / double-schedule / unauth hit) can't re-blast admins.
    if (!(await claimRun('admin_escalation', 'CURRENT_DATE'))) return 0;

    const lines: string[] = [];
    for (const a of acts) lines.push(`• ${a.who} — ${a.days}d overdue on action “${a.title}” (${a.client_name ?? 'no client'})`);
    for (const c of comps) lines.push(`• ${c.who} — ${c.days}d overdue on complaint ${c.complaint_no} (${c.client_name ?? 'no client'})`);
    const body = lines.join('\n');

    let sent = 0;
    for (const admin of admins) {
      await sendNotification({
        to: admin.email, section: 'Escalation', accent: RED, greetingName: firstName(admin.name),
        subject: `Escalation: ${acts.length + comps.length} item(s) overdue more than 5 days`,
        intro: `The following items have been overdue for more than 5 days and need attention.`,
        title: `${plural(acts.length, 'action')} · ${plural(comps.length, 'complaint')}`,
        body,
        ctaLabel: 'Open the Action Registry', ctaPath: '/risansi/registry',
        footer: 'You are receiving this as a system administrator.',
      });
      sent++;
    }
    return sent;
  } catch (e) { console.error('[cron] admin escalation failed', e); return 0; }
}

// 4. Weekly digest to each manager — a snapshot of their tours.
export async function runWeeklyManagerDigest(): Promise<number> {
  let sent = 0;
  try {
    // One digest per ISO week, regardless of how many times the route is hit.
    if (!(await claimRun('manager_digest', "date_trunc('week', CURRENT_DATE)::date"))) return 0;
    const mgrs = (await risansiPool.query<{ id: number; name: string | null; email: string }>(
      `SELECT DISTINCT u.id, u.name, u.email FROM tour_assignments ta JOIN users u ON u.id = ta.rep_id
        WHERE ta.role = 'manager' AND u.is_active = TRUE AND u.email IS NOT NULL AND u.email <> ''`)).rows;
    for (const m of mgrs) {
      const s = (await risansiPool.query<{ open_actions: number; overdue_actions: number; open_complaints: number; visits_overdue: number }>(
        `WITH mc AS (
           SELECT c.id, c.last_visit_date FROM clients c
            WHERE c.deleted_at IS NULL
              AND c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $1 AND role = 'manager'))
         SELECT
           (SELECT count(*) FROM tasks t JOIN mc ON mc.id = t.client_id WHERE t.status <> 'completed')::int AS open_actions,
           (SELECT count(*) FROM tasks t JOIN mc ON mc.id = t.client_id WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue_actions,
           (SELECT count(*) FROM complaints co JOIN mc ON mc.id = co.client_id WHERE co.status NOT IN ('Resolved','Closed'))::int AS open_complaints,
           (SELECT count(*) FROM mc WHERE mc.last_visit_date IS NULL OR mc.last_visit_date < CURRENT_DATE - 90)::int AS visits_overdue`,
        [m.id])).rows[0];
      if (!s) continue;
      await sendNotification({
        to: m.email, section: 'Weekly Digest', accent: BRAND, greetingName: firstName(m.name),
        subject: `Your weekly summary — ${s.overdue_actions} overdue, ${s.open_complaints} open complaints`,
        intro: `Here's where your tours stand this week.`,
        title: 'This week at a glance',
        meta: [
          ['Open actions', String(s.open_actions)],
          ['↳ overdue', String(s.overdue_actions)],
          ['Open complaints', String(s.open_complaints)],
          ['Clients overdue for a visit', String(s.visits_overdue)],
        ],
        ctaLabel: 'Open the portal', ctaPath: '/risansi',
      });
      sent++;
    }
  } catch (e) { console.error('[cron] weekly manager digest failed', e); }
  return sent;
}

// ════════════════════════════════════════════════════════════════
//  EVENT NOTIFICATIONS (called best-effort from server actions)
// ════════════════════════════════════════════════════════════════

async function clientName(clientId: number): Promise<string | null> {
  return (await risansiPool.query<{ legal_name: string | null }>('SELECT legal_name FROM clients WHERE id = $1', [clientId])).rows[0]?.legal_name ?? null;
}
async function userById(id: number): Promise<{ name: string | null; email: string | null } | null> {
  return (await risansiPool.query<{ name: string | null; email: string | null }>('SELECT name, email FROM users WHERE id = $1', [id])).rows[0] ?? null;
}
async function nameForEmail(email: string): Promise<string | null> {
  return (await risansiPool.query<{ name: string | null }>('SELECT name FROM users WHERE lower(email) = lower($1)', [email])).rows[0]?.name ?? null;
}

// A rep checked in at a client → tell the tour manager(s), naming the rep.
export async function notifyCheckIn(clientId: number, repId: number | null, actorEmail: string) {
  try {
    const [cn, rep, mgrs] = await Promise.all([clientName(clientId), repId ? userById(repId) : Promise.resolve(null), tourManagers(clientId)]);
    const repName = rep?.name || (await nameForEmail(actorEmail)) || 'A rep';
    for (const m of mgrs) {
      if (m.email.toLowerCase() === actorEmail.toLowerCase()) continue;
      await sendNotification({
        to: m.email, section: 'Field', accent: BRAND, greetingName: firstName(m.name),
        subject: `${repName} checked in at ${cn ?? 'a client'}`,
        intro: `Your rep ${repName} has just checked in for a visit.`,
        meta: [['Rep', repName], ['Client', cn ?? '—']],
        ctaLabel: 'Open Field', ctaPath: '/risansi/field',
      });
    }
  } catch (e) { console.error('[notify] check-in failed', e); }
}

// A rep submitted (closed) a visit report → summarise to the tour manager(s).
export async function notifyVisitSubmitted(clientId: number, repName: string | null, actorEmail: string) {
  try {
    const [cn, mgrs] = await Promise.all([clientName(clientId), tourManagers(clientId)]);
    const who = repName || (await nameForEmail(actorEmail)) || 'A rep';
    for (const m of mgrs) {
      if (m.email.toLowerCase() === actorEmail.toLowerCase()) continue;
      await sendNotification({
        to: m.email, section: 'Visit Reports', accent: GREEN, greetingName: firstName(m.name),
        subject: `${who} submitted a visit report — ${cn ?? 'client'}`,
        intro: `Your rep ${who} has submitted a visit report.`,
        meta: [['Rep', who], ['Client', cn ?? '—']],
        ctaLabel: 'Open Field', ctaPath: '/risansi/field',
      });
    }
  } catch (e) { console.error('[notify] visit submitted failed', e); }
}

// Complaint resolved / closed → raiser + assignee (skipping whoever did it).
export async function notifyComplaintClosed(complaintId: number, actorEmail: string) {
  try {
    const c = (await risansiPool.query<{
      complaint_no: string; status: string; details: string; client_id: number | null;
      assigned_name: string | null; assigned_email: string | null; ext_email: string | null;
      raiser_name: string | null; raiser_email: string | null; client_name: string | null;
    }>(
      `SELECT co.complaint_no, co.status, co.details, co.client_id,
              au.name AS assigned_name, au.email AS assigned_email, co.assigned_to_external_email AS ext_email,
              ru.name AS raiser_name, COALESCE(ru.email, co.created_by) AS raiser_email, cl.legal_name AS client_name
         FROM complaints co
         LEFT JOIN users au ON au.id = co.assigned_to_user
         LEFT JOIN users ru ON ru.id = co.reported_by_user
         LEFT JOIN clients cl ON cl.id = co.client_id
        WHERE co.id = $1`, [complaintId])).rows[0];
    if (!c) return;
    const recips = dedupeRecips([
      { email: c.assigned_email || c.ext_email, name: c.assigned_name },
      { email: c.raiser_email, name: c.raiser_name },
    ], actorEmail);
    for (const r of recips) {
      await sendNotification({
        to: r.email, section: 'Complaints', accent: GREEN, greetingName: firstName(r.name),
        subject: `Complaint ${c.complaint_no} marked ${c.status}`,
        intro: `Complaint ${c.complaint_no} for ${c.client_name ?? 'a client'} has been marked ${c.status}.`,
        title: c.complaint_no, body: c.details,
        meta: [['Client', c.client_name ?? '—'], ['Status', c.status]],
        ctaLabel: 'Open the Complaints board', ctaPath: '/risansi/complaints',
      });
    }
  } catch (e) { console.error('[notify] complaint closed failed', e); }
}

// A new update was logged on a complaint → assignee + raiser (skipping author).
export async function notifyComplaintUpdate(complaintId: number, actorEmail: string, updateBody: string) {
  try {
    const c = (await risansiPool.query<{
      complaint_no: string; client_id: number | null;
      assigned_name: string | null; assigned_email: string | null; ext_email: string | null;
      raiser_name: string | null; raiser_email: string | null; client_name: string | null;
    }>(
      `SELECT co.complaint_no, co.client_id,
              au.name AS assigned_name, au.email AS assigned_email, co.assigned_to_external_email AS ext_email,
              ru.name AS raiser_name, COALESCE(ru.email, co.created_by) AS raiser_email, cl.legal_name AS client_name
         FROM complaints co
         LEFT JOIN users au ON au.id = co.assigned_to_user
         LEFT JOIN users ru ON ru.id = co.reported_by_user
         LEFT JOIN clients cl ON cl.id = co.client_id
        WHERE co.id = $1`, [complaintId])).rows[0];
    if (!c) return;
    const by = (await nameForEmail(actorEmail)) || actorEmail;
    const recips = dedupeRecips([
      { email: c.assigned_email || c.ext_email, name: c.assigned_name },
      { email: c.raiser_email, name: c.raiser_name },
    ], actorEmail);
    for (const r of recips) {
      await sendNotification({
        to: r.email, section: 'Complaints', accent: BRAND, greetingName: firstName(r.name),
        subject: `New update on complaint ${c.complaint_no}`,
        intro: `${by} logged an update on complaint ${c.complaint_no} (${c.client_name ?? 'a client'}).`,
        title: c.complaint_no, body: updateBody,
        ctaLabel: 'Open the Complaints board', ctaPath: '/risansi/complaints',
      });
    }
  } catch (e) { console.error('[notify] complaint update failed', e); }
}

// Opportunity marked Won or Lost → tour manager(s) + the opp's rep (skip actor).
export async function notifyOppClosed(oppId: number, actorEmail: string, stage: 'Won' | 'Lost') {
  try {
    const o = (await risansiPool.query<{ client_id: number | null; rep_id: number | null; product: string | null; value_cr: string | null }>(
      `SELECT client_id, rep_id, product, COALESCE(final_value_cr, value_cr)::text AS value_cr FROM opportunities WHERE id = $1`, [oppId])).rows[0];
    if (!o || o.client_id == null) return;
    const [cn, rep, mgrs] = await Promise.all([clientName(o.client_id), o.rep_id ? userById(o.rep_id) : Promise.resolve(null), tourManagers(o.client_id)]);
    const recips = dedupeRecips([
      ...mgrs.map(m => ({ email: m.email, name: m.name })),
      { email: rep?.email ?? null, name: rep?.name ?? null },
    ], actorEmail);
    const by = (await nameForEmail(actorEmail)) || actorEmail;
    const val = o.value_cr ? fmtCrShort(parseFloat(o.value_cr)) : null;
    for (const r of recips) {
      await sendNotification({
        to: r.email, section: 'Opportunities', accent: stage === 'Won' ? GREEN : '#9CA3AF', greetingName: firstName(r.name),
        subject: `Opportunity ${stage} — ${cn ?? 'client'}`,
        intro: `${by} marked an opportunity ${stage} for ${cn ?? 'a client'}.`,
        title: o.product || 'Opportunity',
        meta: [['Client', cn ?? '—'], ['Outcome', stage], ...(val ? [['Value', val] as [string, string]] : [])],
        ctaLabel: 'Open the pipeline', ctaPath: '/risansi/pipeline',
      });
    }
  } catch (e) { console.error('[notify] opp closed failed', e); }
}

// A Sales Order was recorded against a Won opp → tour manager(s).
export async function notifySalesOrder(oppId: number, actorEmail: string, soNumber: string) {
  try {
    const o = (await risansiPool.query<{ client_id: number | null; product: string | null }>(
      `SELECT client_id, product FROM opportunities WHERE id = $1`, [oppId])).rows[0];
    if (!o || o.client_id == null) return;
    const [cn, mgrs] = await Promise.all([clientName(o.client_id), tourManagers(o.client_id)]);
    const by = (await nameForEmail(actorEmail)) || actorEmail;
    for (const m of mgrs) {
      if (m.email.toLowerCase() === actorEmail.toLowerCase()) continue;
      await sendNotification({
        to: m.email, section: 'Order Booked', accent: GREEN, greetingName: firstName(m.name),
        subject: `Sales order ${soNumber} recorded — ${cn ?? 'client'}`,
        intro: `${by} recorded sales order ${soNumber} against a Won opportunity.`,
        meta: [['Client', cn ?? '—'], ['SO number', soNumber], ['Opportunity', o.product ?? '—']],
        ctaLabel: 'Open the pipeline', ctaPath: '/risansi/pipeline',
      });
    }
  } catch (e) { console.error('[notify] sales order failed', e); }
}

// A quotation was issued for an opp → tour manager(s).
export async function notifyQuotationIssued(oppId: number, actorEmail: string) {
  try {
    const o = (await risansiPool.query<{ client_id: number | null; product: string | null; quote_ref: string | null }>(
      `SELECT client_id, product, quote_ref FROM opportunities WHERE id = $1`, [oppId])).rows[0];
    if (!o || o.client_id == null) return;
    const [cn, mgrs] = await Promise.all([clientName(o.client_id), tourManagers(o.client_id)]);
    const by = (await nameForEmail(actorEmail)) || actorEmail;
    for (const m of mgrs) {
      if (m.email.toLowerCase() === actorEmail.toLowerCase()) continue;
      await sendNotification({
        to: m.email, section: 'Opportunities', accent: '#D97706', greetingName: firstName(m.name),
        subject: `Quotation issued — ${cn ?? 'client'}`,
        intro: `${by} issued a quotation for ${cn ?? 'a client'}.`,
        meta: [['Client', cn ?? '—'], ['Opportunity', o.product ?? '—'], ...(o.quote_ref ? [['Quote ref', o.quote_ref] as [string, string]] : [])],
        ctaLabel: 'Open the pipeline', ctaPath: '/risansi/pipeline',
      });
    }
  } catch (e) { console.error('[notify] quotation issued failed', e); }
}

// A new lead / client was created → tour manager(s), naming the creator.
export async function notifyNewLead(clientId: number, creatorEmail: string) {
  try {
    const [cn, mgrs] = await Promise.all([clientName(clientId), tourManagers(clientId)]);
    const by = (await nameForEmail(creatorEmail)) || creatorEmail;
    for (const m of mgrs) {
      if (m.email.toLowerCase() === creatorEmail.toLowerCase()) continue;
      await sendNotification({
        to: m.email, section: 'Clients', accent: BRAND, greetingName: firstName(m.name),
        subject: `New lead added — ${cn ?? 'client'}`,
        intro: `${by} added a new lead on your tour.`,
        meta: [['Client', cn ?? '—'], ['Added by', by]],
        ctaLabel: 'Open Clients', ctaPath: '/risansi/clients',
      });
    }
  } catch (e) { console.error('[notify] new lead failed', e); }
}

// A rep was granted special access to a client → tell that rep.
export async function notifySpecialAccess(clientId: number, repId: number, grantorEmail: string) {
  try {
    const [cn, rep] = await Promise.all([clientName(clientId), userById(repId)]);
    if (!rep?.email || rep.email.toLowerCase() === grantorEmail.toLowerCase()) return;
    const by = (await nameForEmail(grantorEmail)) || grantorEmail;
    await sendNotification({
      to: rep.email, section: 'Client Access', accent: BRAND, greetingName: firstName(rep.name),
      subject: `You've been given access to ${cn ?? 'a client'}`,
      intro: `${by} granted you direct access to ${cn ?? 'a client'}. You can now log visits and opportunities for them.`,
      meta: [['Client', cn ?? '—'], ['Granted by', by]],
      ctaLabel: 'Open the client', ctaPath: '/risansi/clients',
    });
  } catch (e) { console.error('[notify] special access failed', e); }
}

// A bug was filed → all system admins, naming the reporter.
export async function notifyBugReported(a: { title: string; severity?: string | null; reporterName?: string | null; reporterEmail?: string | null; pageUrl?: string | null }) {
  try {
    const admins = await sysadmins();
    const skip = (a.reporterEmail || '').trim().toLowerCase();
    for (const admin of admins) {
      if (skip && admin.email.toLowerCase() === skip) continue;   // don't email the reporter themselves
      await sendNotification({
        to: admin.email, section: 'Bugs', accent: RED, greetingName: firstName(admin.name),
        subject: `New bug reported: ${a.title}`,
        intro: `${a.reporterName || 'Someone'} filed a bug in the portal.`,
        title: a.title,
        meta: [...(a.severity ? [['Severity', a.severity] as [string, string]] : []), ...(a.pageUrl ? [['Page', a.pageUrl] as [string, string]] : []), ['Reported by', a.reporterName || '—']],
        ctaLabel: 'Open the Bugs board', ctaPath: '/risansi/bugs',
        footer: 'You are receiving this as a system administrator.',
      });
    }
  } catch (e) { console.error('[notify] bug reported failed', e); }
}

// ── small helpers ───────────────────────────────────────────────

// Collapse recipients by email, drop empties and the actor (no self-notify).
function dedupeRecips(list: { email: string | null; name: string | null }[], actorEmail: string): { email: string; name: string | null }[] {
  const seen = new Set<string>();
  const out: { email: string; name: string | null }[] = [];
  for (const r of list) {
    const e = (r.email || '').trim().toLowerCase();
    if (!e || e === actorEmail.trim().toLowerCase() || seen.has(e)) continue;
    seen.add(e);
    out.push({ email: r.email as string, name: r.name });
  }
  return out;
}

const fmtCrShort = (cr: number) => {
  const inr = cr * 10_000_000;
  return inr >= 1e7 ? `₹${(inr / 1e7).toFixed(2)} Cr` : inr >= 1e5 ? `₹${(inr / 1e5).toFixed(2)} L` : `₹${Math.round(inr).toLocaleString('en-IN')}`;
};

function firstName(name?: string | null): string | null {
  if (!name) return null;
  return name.trim().split(/\s+/)[0] || null;
}
function prettyDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export { firstName, tourManagers, sysadmins };
