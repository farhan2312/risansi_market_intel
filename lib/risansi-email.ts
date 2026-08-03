import { Resend } from 'resend';

// Transactional email via Resend. Everything here is best-effort: a failed or
// unconfigured send must never break the action that triggered it.
//
// Setup: set RESEND_API_KEY (from resend.com) and verify the sending domain.
// The From domain must be a VERIFIED Resend domain. We verified the subdomain
// digital.risansi.com, so the address lives on it (sales-portal@digital.risansi.com)
// — NOT digital@risansi.com, whose domain (risansi.com) is a different,
// unverified domain and gets a 403. Override with RESEND_FROM if needed.

let _client: Resend | null | undefined;
function client(): Resend | null {
  if (_client !== undefined) return _client;
  const key = process.env.RESEND_API_KEY;
  _client = key ? new Resend(key) : null;
  if (!key) console.warn('[email] RESEND_API_KEY not set — email notifications are disabled.');
  return _client;
}

const FROM     = process.env.RESEND_FROM || 'Risansi <sales-portal@digital.risansi.com>';
// Public site URL used for links in emails — the hosted domain, deliberately
// NOT NEXTAUTH_URL (which is the internal Vercel URL). Override with APP_URL.
const APP_URL  = (process.env.APP_URL || 'https://sales.risansi.com').replace(/\/+$/, '');
const REPLY_TO = process.env.RESEND_REPLY_TO || undefined;

export interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

/** Send an email. Never throws — returns a result flag instead. */
export async function sendEmail({ to, subject, html, replyTo }: SendArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const resend = client();
  if (!resend) return { ok: false, error: 'not-configured' };
  try {
    const { data, error } = await resend.emails.send({
      from: FROM, to, subject, html, replyTo: replyTo ?? REPLY_TO,
    });
    if (error) { console.error('[email] send failed:', error); return { ok: false, error: String((error as { message?: string }).message ?? error) }; }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error('[email] send threw:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ── Action-registry notification ────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Format a yyyy-mm-dd (or ISO) date as e.g. "25 Jul 2026"; passthrough otherwise. */
function prettyDate(d?: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Build an absolute portal link from a path (uses the public APP_URL). */
export const appLink = (path: string) => `${APP_URL}${path.startsWith('/') ? path : '/' + path}`;

// Generic notification card — one consistent layout for every portal email, so
// the many event/scheduled notifications stay on-brand without duplicating HTML.
// Everything is escaped; the caller supplies plain-text strings that already name
// the people/clients involved.
export interface NotifCard {
  to: string | string[];
  subject: string;
  section: string;              // header label after "Risansi · "
  accent?: string;              // hex; defaults to brand blue
  greetingName?: string | null; // recipient's first-person greeting
  intro: string;                // 1–2 sentences
  title?: string | null;        // bold box heading
  body?: string | null;         // box body text
  meta?: [string, string][];    // label/value rows
  ctaLabel?: string;
  ctaPath?: string;             // path joined to APP_URL
  footer?: string | null;
}

export async function sendNotification(c: NotifCard) {
  const accent = c.accent || '#0A3D8F';
  const rows = (c.meta ?? [])
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([l, v]) => `<tr><td style="padding:4px 0;color:#6B7280;font-size:13px;width:122px;vertical-align:top;">${escapeHtml(l)}</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${escapeHtml(String(v))}</td></tr>`)
    .join('');
  const hasBox = !!(c.title || c.body || rows);
  const box = hasBox ? `
    <div style="border:1px solid #E5E7EB;border-left:3px solid ${accent};border-radius:6px;padding:14px 16px;margin-bottom:18px;">
      ${c.title ? `<div style="color:${accent};font-size:15px;font-weight:600;margin-bottom:${c.body || rows ? '6px' : '0'};">${escapeHtml(c.title)}</div>` : ''}
      ${c.body ? `<div style="color:#374151;font-size:13px;line-height:1.5;margin-bottom:${rows ? '10px' : '0'};white-space:pre-wrap;">${escapeHtml(c.body)}</div>` : ''}
      ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>` : ''}
    </div>` : '';
  const cta = c.ctaLabel && c.ctaPath ? `
    <a href="${appLink(c.ctaPath)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;">${escapeHtml(c.ctaLabel)}</a>` : '';
  const html = `
  <div style="background:#F3F4F6;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
        <tr><td style="background:${accent};padding:16px 24px;">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Risansi &middot; ${escapeHtml(c.section)}</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 4px;color:#111827;font-size:15px;">Hi ${escapeHtml(c.greetingName || 'there')},</p>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(c.intro)}</p>
          ${box}${cta}
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #F3F4F6;">
          <span style="color:#9CA3AF;font-size:11px;">${escapeHtml(c.footer || "You're receiving this from the Risansi sales portal.")}</span>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;
  return sendEmail({ to: c.to, subject: c.subject, html });
}

/**
 * Email the person a new action was assigned to. Caller decides whether the
 * assignee is "in the system" (has an email) and isn't the creator.
 */
export async function notifyActionAssigned(a: {
  to: string;
  toName?: string | null;
  assignedBy?: string | null;
  title: string;
  description?: string | null;
  clientName?: string | null;
  dueDate?: string | null;
  priority?: string | null;
}) {
  const link = `${APP_URL}/risansi/registry`;
  const due  = prettyDate(a.dueDate);

  const metaRow = (label: string, value: string) => `
    <tr>
      <td style="padding:4px 0;color:#6B7280;font-size:13px;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${escapeHtml(value)}</td>
    </tr>`;

  const meta = [
    a.clientName ? metaRow('Client', a.clientName) : '',
    due          ? metaRow('Due date', due) : '',
    a.priority   ? metaRow('Priority', a.priority) : '',
    a.assignedBy ? metaRow('Assigned by', a.assignedBy) : '',
  ].join('');

  const html = `
  <div style="background:#F3F4F6;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
        <tr><td style="background:#0A3D8F;padding:16px 24px;">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Risansi &middot; Action Registry</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 4px;color:#111827;font-size:15px;">Hi ${escapeHtml(a.toName || 'there')},</p>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">
            A new action has been assigned to you${a.assignedBy ? ` by ${escapeHtml(a.assignedBy)}` : ''}.
          </p>
          <div style="border:1px solid #E5E7EB;border-left:3px solid #0A3D8F;border-radius:6px;padding:14px 16px;margin-bottom:18px;">
            <div style="color:#0A3D8F;font-size:15px;font-weight:600;margin-bottom:${a.description ? '6px' : '10px'};">${escapeHtml(a.title)}</div>
            ${a.description ? `<div style="color:#374151;font-size:13px;line-height:1.5;margin-bottom:10px;white-space:pre-wrap;">${escapeHtml(a.description)}</div>` : ''}
            <table role="presentation" cellpadding="0" cellspacing="0">${meta}</table>
          </div>
          <a href="${link}" style="display:inline-block;background:#0A3D8F;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;">
            Open the Action Registry
          </a>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #F3F4F6;">
          <span style="color:#9CA3AF;font-size:11px;">You're receiving this because you were assigned an action in the Risansi portal.</span>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;

  return sendEmail({ to: a.to, subject: `New action assigned: ${a.title}`, html });
}

// ── Complaint notification ──────────────────────────────────────

/**
 * Email the person a complaint has been escalated to. Caller decides the
 * recipient (in-system user's email or an external address) and skips self-sends.
 */
export async function notifyComplaintRaised(a: {
  to: string;
  toName?: string | null;
  raisedBy?: string | null;
  complaintNo: string;
  clientName?: string | null;
  details: string;
  priority?: string | null;
  dueDate?: string | null;
  channel?: string | null;
}) {
  const link = `${APP_URL}/risansi/complaints`;
  const due  = prettyDate(a.dueDate);

  const metaRow = (label: string, value: string) => `
    <tr>
      <td style="padding:4px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${escapeHtml(value)}</td>
    </tr>`;

  const meta = [
    metaRow('Complaint', a.complaintNo),
    a.clientName ? metaRow('Client', a.clientName) : '',
    a.channel    ? metaRow('Channel', a.channel) : '',
    a.priority   ? metaRow('Priority', a.priority) : '',
    due          ? metaRow('Target date', due) : '',
    a.raisedBy   ? metaRow('Raised by', a.raisedBy) : '',
  ].join('');

  const html = `
  <div style="background:#F3F4F6;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
        <tr><td style="background:#B91C1C;padding:16px 24px;">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Risansi &middot; Complaints</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 4px;color:#111827;font-size:15px;">Hi ${escapeHtml(a.toName || 'there')},</p>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">
            A complaint has been escalated to you${a.raisedBy ? ` by ${escapeHtml(a.raisedBy)}` : ''} and needs your attention.
          </p>
          <div style="border:1px solid #E5E7EB;border-left:3px solid #B91C1C;border-radius:6px;padding:14px 16px;margin-bottom:18px;">
            <div style="color:#374151;font-size:13px;line-height:1.5;margin-bottom:10px;white-space:pre-wrap;">${escapeHtml(a.details)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0">${meta}</table>
          </div>
          <a href="${link}" style="display:inline-block;background:#B91C1C;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;">
            Open the Complaints board
          </a>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #F3F4F6;">
          <span style="color:#9CA3AF;font-size:11px;">You're receiving this because a complaint was escalated to you in the Risansi portal.</span>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;

  return sendEmail({ to: a.to, subject: `Complaint escalated to you: ${a.complaintNo}`, html });
}

// ── Planned-visit notification ──────────────────────────────────

/**
 * Email about a newly planned visit. `audience` tailors the wording: a manager
 * being told their rep planned a visit, or a rep being told a visit was planned
 * for them.
 */
export async function notifyVisitPlanned(a: {
  to: string;
  toName?: string | null;
  plannedBy?: string | null;
  clientName?: string | null;
  visitDate?: string | null;
  purpose?: string | null;
  repName?: string | null;
  audience: 'manager' | 'rep';
}) {
  const link = `${APP_URL}/risansi/field`;
  const when = prettyDate(a.visitDate);

  const intro = a.audience === 'manager'
    ? `${escapeHtml(a.repName || 'A rep on your tour')} has planned a visit.`
    : `A visit has been planned for you${a.plannedBy ? ` by ${escapeHtml(a.plannedBy)}` : ''}.`;

  const metaRow = (label: string, value: string) => `
    <tr>
      <td style="padding:4px 0;color:#6B7280;font-size:13px;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${escapeHtml(value)}</td>
    </tr>`;

  const meta = [
    a.clientName ? metaRow('Client', a.clientName) : '',
    when         ? metaRow('Visit date', when) : '',
    a.purpose    ? metaRow('Purpose', a.purpose) : '',
    a.audience === 'manager' && a.repName ? metaRow('Rep', a.repName) : '',
    a.audience === 'rep' && a.plannedBy   ? metaRow('Planned by', a.plannedBy) : '',
  ].join('');

  const subject = a.audience === 'manager'
    ? `Visit planned by ${a.repName || 'your rep'}${a.clientName ? ` · ${a.clientName}` : ''}`
    : `A visit has been planned for you${a.clientName ? ` · ${a.clientName}` : ''}`;

  const html = `
  <div style="background:#F3F4F6;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
        <tr><td style="background:#0A3D8F;padding:16px 24px;">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Risansi &middot; Visit Planner</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 4px;color:#111827;font-size:15px;">Hi ${escapeHtml(a.toName || 'there')},</p>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">${intro}</p>
          <div style="border:1px solid #E5E7EB;border-left:3px solid #0A3D8F;border-radius:6px;padding:14px 16px;margin-bottom:18px;">
            <table role="presentation" cellpadding="0" cellspacing="0">${meta}</table>
          </div>
          <a href="${link}" style="display:inline-block;background:#0A3D8F;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;">
            Open the Visit Planner
          </a>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #F3F4F6;">
          <span style="color:#9CA3AF;font-size:11px;">You're receiving this because of a planned visit in the Risansi portal.</span>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;

  return sendEmail({ to: a.to, subject, html });
}

// ── Expansion-opportunity tag notification ──────────────────────

const fmtInrShort = (n?: number | null) => {
  const v = Number(n ?? 0);
  if (!v) return null;
  return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
};

/** Email a TSM tagged on an expansion opportunity raised from a visit report. */
export async function notifyExpansionTagged(a: {
  to: string;
  toName?: string | null;
  taggedBy?: string | null;
  clientName?: string | null;
  product?: string | null;
  stage?: string | null;
  valueInr?: number | null;
  notes?: string | null;
}) {
  const link = `${APP_URL}/risansi/pipeline`;
  const val  = fmtInrShort(a.valueInr);

  const metaRow = (label: string, value: string) => `
    <tr>
      <td style="padding:4px 0;color:#6B7280;font-size:13px;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${escapeHtml(value)}</td>
    </tr>`;

  const meta = [
    a.clientName ? metaRow('Client', a.clientName) : '',
    a.stage      ? metaRow('Stage', a.stage) : '',
    val          ? metaRow('Value', val) : '',
    a.taggedBy   ? metaRow('Tagged by', a.taggedBy) : '',
  ].join('');

  const html = `
  <div style="background:#F3F4F6;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
        <tr><td style="background:#0A3D8F;padding:16px 24px;">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Risansi &middot; Expansion Opportunity</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 4px;color:#111827;font-size:15px;">Hi ${escapeHtml(a.toName || 'there')},</p>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">
            You've been tagged on an expansion opportunity${a.taggedBy ? ` by ${escapeHtml(a.taggedBy)}` : ''} for follow-up.
          </p>
          <div style="border:1px solid #E5E7EB;border-left:3px solid #0A3D8F;border-radius:6px;padding:14px 16px;margin-bottom:18px;">
            <div style="color:#0A3D8F;font-size:15px;font-weight:600;margin-bottom:${a.notes ? '6px' : '10px'};">${escapeHtml(a.product || 'Expansion opportunity')}</div>
            ${a.notes ? `<div style="color:#374151;font-size:13px;line-height:1.5;margin-bottom:10px;white-space:pre-wrap;">${escapeHtml(a.notes)}</div>` : ''}
            <table role="presentation" cellpadding="0" cellspacing="0">${meta}</table>
          </div>
          <a href="${link}" style="display:inline-block;background:#0A3D8F;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;">
            Open the Opportunities pipeline
          </a>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #F3F4F6;">
          <span style="color:#9CA3AF;font-size:11px;">You're receiving this because you were tagged on an expansion opportunity in the Risansi portal.</span>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;

  return sendEmail({ to: a.to, subject: `Expansion opportunity tagged to you${a.clientName ? ` · ${a.clientName}` : ''}`, html });
}
