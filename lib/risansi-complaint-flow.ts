// The complaint workflow, as rules.
//
// Everything a page or an action needs to decide — which fields a page asks,
// who may edit it, what the risk answers make the severity, what a status may
// move to and what it needs first, who is holding the complaint while it sits
// in a status — lives here, pure and importable from both server and client.
// The pages render it; the actions enforce it; scripts test it. Nothing in
// here touches the database.
//
// Source: Complaint_Module_Final_Form_Structure.xlsx (11 Sep 2026) and the
// decisions of 12–13 Sep, all recorded in the plan.

import type { Department, RisansiRole } from '@/lib/risansi-auth';

// Not hasRole from risansi-auth: that module pulls in next-auth and the pool,
// and this file is imported by client components. Admin and sysadmin are the
// only ranks that matter here.
const isAdminRole = (role: string) => role === 'admin' || role === 'sysadmin';

// ── Status ─────────────────────────────────────────────────────────────────

export const STATUSES = [
  'Open', 'Under Investigation', 'Action Pending', 'Replacement Pending',
  'Customer Confirmation Pending', 'Resolved', 'Closed',
] as const;
export type ComplaintStatus = typeof STATUSES[number];

/** The legacy five, still legal on schema_version 1 rows. */
export const LEGACY_STATUSES = ['Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed'] as const;

export const isOpenStatus = (s: string) => s !== 'Resolved' && s !== 'Closed';

/**
 * How far along a complaint is, in three answers rather than two.
 *
 * - `open`    — untouched. Nobody has started on it.
 * - `partial` — started but not finished: under investigation, waiting on an
 *               action, a replacement or the customer. Work is happening.
 * - `closed`  — resolved or closed.
 * - `live`    — open plus partial. Not offered as a choice; it is what the old
 *               single `status=open` roll-up meant, so a link written before
 *               the split still selects what it used to.
 *
 * "Open" used to mean anything unfinished, which put a complaint nobody had
 * looked at in the same bucket as one sitting with QC — the two need chasing
 * in completely different ways.
 */
export type ComplaintState = 'open' | 'partial' | 'closed' | 'live';

export const STATE_LABEL: Record<ComplaintState, string> = {
  open: 'Open', partial: 'Partially open', closed: 'Closed', live: 'Open + partially',
};

/**
 * The stages that belong to one state, legacy ones included; every stage when
 * no state is chosen. Keeps the Status dropdown honest about the toggle beside
 * it. Lives here rather than beside the filters because a client component
 * imports it, and the filter module pulls in the pool.
 */
export function statusesFor(state: string | undefined): string[] {
  const all = [...new Set<string>([...STATUSES, ...LEGACY_STATUSES])];
  if (state === 'open')    return all.filter(s => s === 'Open');
  if (state === 'partial') return all.filter(s => isOpenStatus(s) && s !== 'Open');
  if (state === 'closed')  return all.filter(s => !isOpenStatus(s));
  if (state === 'live')    return all.filter(isOpenStatus);
  return all;
}

/** The colour each status wears, in pills and on the timeline. Legacy statuses included. */
export const STATUS_TONE: Record<string, string> = {
  'Open': 'var(--neg)', 'Under Investigation': 'var(--accent)', 'Action Pending': 'var(--warn, #B45309)',
  'Replacement Pending': 'var(--warn, #B45309)', 'Customer Confirmation Pending': '#7C3AED',
  'Resolved': 'var(--pos)', 'Closed': 'var(--fg-3)', 'In Progress': 'var(--accent)', 'Awaiting Client': '#7C3AED',
};

/** The five departments of the module, plus the customer, as holders a complaint can sit with. */
export const DEPARTMENTS_LIST = ['Complaint Team', 'QC', 'Quotation Team', 'Billing Team', 'Purchase', 'Customer'] as const;

/** Where the timeline puts a status, 0..6. Legacy statuses map to the nearest step. */
export function statusStep(s: string): number {
  const i = (STATUSES as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  return s === 'In Progress' ? 1 : s === 'Awaiting Client' ? 4 : 0;
}

// ── Severity ───────────────────────────────────────────────────────────────

export type Severity = 'S1' | 'S2' | 'S3' | 'S4';

export interface RiskAnswers {
  risk_safety?: boolean | null; risk_shutdown?: boolean | null; risk_penalty?: boolean | null; risk_pump_failure?: boolean | null;
  risk_major_perf?: boolean | null; risk_head_mismatch?: boolean | null; risk_repeat_failure?: boolean | null;
  risk_repeat_mistake?: boolean | null; risk_cost_impact?: boolean | null;
  risk_workable?: boolean | null; risk_qty_over_5?: boolean | null;
}

/** The eleven questions, in the sheet's order, with the level each forces. */
export const RISK_FIELDS: { key: keyof RiskAnswers; label: string; level: Severity; required: boolean }[] = [
  { key: 'risk_safety',         label: 'Safety risk',                                   level: 'S1', required: true },
  { key: 'risk_shutdown',       label: 'Customer shutdown',                             level: 'S1', required: true },
  { key: 'risk_penalty',        label: 'Contractual penalty',                           level: 'S1', required: false },
  { key: 'risk_pump_failure',   label: 'Pump failure',                                  level: 'S1', required: true },
  { key: 'risk_major_perf',     label: 'Major performance issue',                       level: 'S2', required: true },
  { key: 'risk_head_mismatch',  label: 'Head / pressure mismatch',                      level: 'S2', required: false },
  { key: 'risk_repeat_failure', label: 'Repeat failure',                                level: 'S2', required: true },
  { key: 'risk_repeat_mistake', label: 'Repeat mistake',                                level: 'S2', required: false },
  // Grouped with Repeat Mistake in the sheet's truth table → S2. Decided 12 Sep.
  { key: 'risk_cost_impact',    label: 'Cost impact / manpower above ₹5,000',           level: 'S2', required: false },
  { key: 'risk_workable',       label: 'Workable issue / leakage / dimensional correction', level: 'S3', required: false },
  { key: 'risk_qty_over_5',     label: 'Quantity above 5 nos.',                         level: 'S3', required: false },
];

/** Highest level with any Yes wins; no Yes at all is S4. Null when nothing has been answered yet. */
export function severityOf(a: RiskAnswers): Severity | null {
  const answered = RISK_FIELDS.some(f => a[f.key] != null);
  if (!answered) return null;
  for (const lvl of ['S1', 'S2', 'S3'] as const) {
    if (RISK_FIELDS.some(f => f.level === lvl && a[f.key] === true)) return lvl;
  }
  return 'S4';
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  S1: 'S1 · Critical', S2: 'S2 · High', S3: 'S3 · Medium', S4: 'S4 · Low',
};
/** The Mandatory column of the sheet's matrix, in words. */
export const SEVERITY_REQUIRES: Record<Severity, string> = {
  S1: 'Immediate action recorded within the day, an investigation, and a CAPA document before closure.',
  S2: 'An investigation and a CAPA document before closure.',
  S3: 'A corrective action. The investigation may be skipped.',
  S4: 'Remarks are sufficient.',
};
export const SEVERITY_TONE: Record<Severity, string> = {
  S1: 'var(--neg)', S2: 'var(--warn, #B45309)', S3: 'var(--accent)', S4: 'var(--fg-3)',
};

// ── Pages and fields ───────────────────────────────────────────────────────

export type FieldType =
  | 'text' | 'long' | 'date' | 'number' | 'money' | 'bool' | 'select' | 'user' | 'yesno4' | 'paid'
  /** A dropdown you may also type into — the list suggests, it does not confine. */
  | 'select_free'
  /** A client with client_type = 'OEM', stored as the client's id. */
  | 'oem';

export interface ComplaintField {
  name: string;
  label: string;
  type: FieldType;
  /** For type 'select' / 'select_free': the complaint_lookups kind. */
  lookup?: string;
  /** For type 'select': a fixed list, where the answers are not a lookup table. */
  options?: string[];
  required?: boolean;
  hint?: string;
  /** Shown only when another field holds one of these values. */
  showWhen?: { field: string; equals: (string | boolean)[] };
  /** Pre-filled from the installed base when EC / serial is looked up. */
  fromPump?: boolean;
}

export interface ComplaintPage {
  id: number;
  slug: string;
  title: string;
  owner: string;
  /** Departments that may edit this page. Reps and managers reach page 1 by role. */
  departments: Department[];
  repsMayEdit?: boolean;
  fields: ComplaintField[];
}

export const PAGES: ComplaintPage[] = [
  {
    id: 1, slug: 'registration', title: 'Registration', owner: 'TSM / Complaint Team',
    departments: ['Complaint Team'], repsMayEdit: true,
    fields: [
      { name: 'complaint_date', label: 'Complaint date', type: 'date', required: true },
      { name: 'channel', label: 'Complaint source', type: 'select', lookup: 'source', required: true },
      { name: 'complaint_type', label: 'Complaint type', type: 'select', lookup: 'complaint_type', required: true, hint: 'Technical goes to QC for investigation; Non-technical stays with the Complaint Team.' },
      { name: 'defect_category', label: 'Defect category', type: 'select', lookup: 'defect_category', required: true },
      // Suggest, do not confine: the list covers what has come up before, and a
      // complaint that does not fit one of them should not be filed under the
      // nearest wrong answer. A typed reason is stored as typed; it is not added
      // to the master list, so the list stays a list rather than a pile of
      // spellings.
      { name: 'defect_reason', label: 'Defect reason', type: 'select_free', lookup: 'defect_reason', required: true, hint: 'Pick one, or type the reason if none of them fits.' },
      { name: 'responsible_department', label: 'Responsible department', type: 'select', lookup: 'responsible_department', required: true, hint: 'Who caused it — correctable at investigation.' },
      // The TSM's own read, kept beside the Complaint Team's rather than
      // overwriting it: the two disagreeing is itself worth seeing.
      { name: 'tsm_responsible_department', label: 'Responsible department (TSM)', type: 'select', lookup: 'responsible_department', hint: 'What the TSM believes from the field. Left alongside the answer above, not merged into it.' },
      { name: 'details', label: 'Complaint description', type: 'long', required: true },
      { name: 'contact_person', label: 'Customer contact person', type: 'text', required: true },
      { name: 'contact_detail', label: 'Contact no. / email', type: 'text' },
      // A complaint that arrives through the OEM who supplied the pump is a
      // different conversation from one the client raises directly.
      { name: 'supply_through', label: 'Supply through', type: 'select', options: ['Direct', 'OEM'], hint: 'Did the pump reach this client directly, or through an OEM?' },
      { name: 'oem_client_id', label: 'OEM name', type: 'oem', showWhen: { field: 'supply_through', equals: ['OEM'] }, hint: 'From the client master — the OEM account itself, so its complaints can be counted.' },
    ],
  },
  {
    id: 2, slug: 'order', title: 'Order & Pump', owner: 'Complaint Team / QC',
    departments: ['Complaint Team', 'QC'],
    fields: [
      { name: 'so_no', label: 'SO No.', type: 'text', required: true, fromPump: true },
      { name: 'ec_no', label: 'EC No.', type: 'text', required: true, fromPump: true, hint: 'Looks up the installed base and fills what it knows.' },
      { name: 'ec_date', label: 'EC date', type: 'date' },
      { name: 'ec_made_by', label: 'EC made by', type: 'text' },
      { name: 'invoice_no', label: 'Invoice / challan no.', type: 'text' },
      { name: 'invoice_date', label: 'Invoice date', type: 'date' },
      { name: 'basic_value', label: 'Basic value of items (₹)', type: 'money' },
      { name: 'client_po_no', label: 'Client PO no.', type: 'text' },
      { name: 'client_po_date', label: 'Client PO date', type: 'date' },
      { name: 'pump_serial_no', label: 'Pump serial no.', type: 'text', fromPump: true, hint: 'The traceability key when known — looks up the installed base too. Not always on the pump or the paperwork, so not mandatory.' },
      { name: 'pump_model', label: 'Pump model no.', type: 'text', required: true, fromPump: true },
      { name: 'internal_model_no', label: 'Internal model no.', type: 'text' },
      { name: 'model_version', label: 'Version', type: 'text' },
      { name: 'liquid', label: 'Liquid', type: 'text', fromPump: true },
      { name: 'rubber_moc', label: 'Rubber MOC', type: 'text' },
      { name: 'head_pressure', label: 'Head / pressure', type: 'text', fromPump: true },
      { name: 'part_type', label: 'Part type', type: 'select', lookup: 'part_type' },
      { name: 'part_name', label: 'Part name', type: 'text' },
      { name: 'quantity', label: 'Quantity', type: 'number', fromPump: true },
      { name: 'stator_code', label: 'Stator code', type: 'text' },
      { name: 'mfg_date', label: 'MFG date', type: 'date' },
    ],
  },
  {
    id: 3, slug: 'risk', title: 'Risk & Criticality', owner: 'Complaint Team · QC for technical',
    departments: ['Complaint Team', 'QC'],
    fields: [
      ...RISK_FIELDS.map(f => ({ name: f.key as string, label: f.label, type: 'bool' as FieldType, required: f.required })),
      { name: 'warning_letter', label: 'Warning letter', type: 'yesno4', hint: 'Kept out of the severity score.' },
    ],
  },
  {
    id: 4, slug: 'investigation', title: 'Investigation & Root Cause', owner: 'QC for technical · Complaint Team otherwise',
    departments: ['Complaint Team', 'QC'],
    fields: [
      { name: 'analysis_required', label: 'Analysis required', type: 'bool', required: true },
      { name: 'investigation_assigned_to', label: 'Investigation assigned to', type: 'user', required: true },
      { name: 'investigation_start', label: 'Investigation start date', type: 'date' },
      { name: 'investigation_end', label: 'Investigation completion date', type: 'date' },
      { name: 'root_cause_category', label: 'Root cause category', type: 'select', lookup: 'root_cause_category', required: true },
      { name: 'root_cause', label: 'Complaint root cause', type: 'long', required: true },
      { name: 'internal_remarks', label: 'Internal discussion / analysis remarks', type: 'long' },
      { name: 'corrective_action_required', label: 'Corrective action', type: 'bool', hint: 'Yes opens page 5.' },
      { name: 'preventive_action', label: 'Preventive action', type: 'long' },
      { name: 'responsible_department', label: 'Responsible department', type: 'select', lookup: 'responsible_department', required: true, hint: 'Carried from registration; correct it here if the investigation says otherwise.' },
    ],
  },
  {
    id: 5, slug: 'action', title: 'Corrective Action & Resolution', owner: 'Complaint Team · the assignee',
    departments: ['Complaint Team', 'QC', 'Quotation Team', 'Billing Team'], repsMayEdit: true,
    fields: [
      { name: 'action_against', label: 'Action against complaint', type: 'long', required: true },
      { name: 'action_category', label: 'Action category', type: 'select', lookup: 'action_category', required: true },
      { name: 'action_assigned_to', label: 'Action assigned to', type: 'user', required: true, hint: 'Quotation Team for a free replacement, a rep or fitter for a site visit, QC for online support, Billing for returnable or repair.' },
      { name: 'target_completion_date', label: 'Target completion date', type: 'date', required: true },
      { name: 'actual_completion_date', label: 'Action completion date', type: 'date' },
      { name: 'fr_ec_no', label: 'FR EC no.', type: 'text', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'fr_ec_date', label: 'FR EC date', type: 'date', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'challan_no', label: 'Challan no.', type: 'text', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'challan_date', label: 'Challan date', type: 'date', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'target_dispatch_date', label: 'Target dispatch date', type: 'date', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'challan_value', label: 'Challan value (₹)', type: 'money', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'fr_freight', label: 'FR freight charges (₹)', type: 'money', showWhen: { field: 'action_category', equals: ['Free Replacement', 'Paid Replacement'] } },
      { name: 'status_remarks', label: 'Remarks for complaint status', type: 'long' },
      { name: 'customer_confirmed', label: 'Customer confirmed the fix', type: 'bool', hint: 'The gate from Customer Confirmation Pending to Resolved.' },
    ],
  },
  {
    id: 6, slug: 'capa', title: 'Vendor CAPA & Documents', owner: 'Complaint Team · QC · Purchase',
    departments: ['Complaint Team', 'QC', 'Purchase'],
    fields: [
      { name: 'boi_involved', label: 'BOI involved', type: 'bool' },
      { name: 'vendor_name', label: 'Vendor name', type: 'text', showWhen: { field: 'boi_involved', equals: [true] } },
      { name: 'vendor_recovery', label: 'Vendor recovery', type: 'bool', showWhen: { field: 'boi_involved', equals: [true] } },
      { name: 'capa_required', label: 'CAPA required from vendor', type: 'bool', required: true },
      { name: 'capa_received_date', label: 'CAPA received date', type: 'date', showWhen: { field: 'capa_required', equals: [true] } },
      { name: 'drive_link', label: 'Complaint folder / drive link', type: 'text' },
    ],
  },
  {
    id: 7, slug: 'returnable', title: 'Returnable Material & Follow-up', owner: 'Complaint Team · QC · Billing',
    departments: ['Complaint Team', 'QC', 'Billing Team'],
    fields: [
      { name: 'material_returnable', label: 'Material to be returned', type: 'bool', required: true },
      { name: 'returnable_owner', label: 'Responsible for returnable', type: 'user', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_slip_no', label: 'Returnable slip no.', type: 'text', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_slip_date', label: 'Returnable slip date', type: 'date', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'gr_no', label: 'GR no.', type: 'text', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'paid_to_pay', label: 'Paid / To pay', type: 'paid', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_amount', label: 'Amount (₹)', type: 'money', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_item_value', label: 'Returnable item value (₹)', type: 'money', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_status', label: 'Returnable status', type: 'select', lookup: 'returnable_status', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_action', label: 'Action on returnable material', type: 'long', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'first_email_date', label: 'First email sent', type: 'date' },
      { name: 'last_reminder_date', label: 'Last email reminder sent', type: 'date' },
      { name: 'next_followup_date', label: 'Next follow-up date', type: 'date' },
      { name: 'followup_remarks', label: 'Calling follow-up remarks', type: 'long' },
      { name: 'accounts_action', label: 'Accounts action', type: 'select', lookup: 'accounts_action' },
      { name: 'mgmt_intervention', label: 'Management intervention required', type: 'bool' },
    ],
  },
  {
    id: 8, slug: 'closure', title: 'Closure & Management Review', owner: 'Complaint Team · QC',
    departments: ['Complaint Team', 'QC'],
    fields: [
      { name: 'closure_summary', label: 'Final resolution summary', type: 'long', required: true },
      { name: 'customer_satisfied', label: 'Customer satisfied', type: 'bool', required: true },
      { name: 'repeat_complaint', label: 'Repeat complaint', type: 'bool', hint: 'Set automatically from the same client, model and defect category within twelve months; correct it if you know better.' },
      { name: 'action_effectiveness', label: 'Corrective action effectiveness', type: 'select', lookup: 'effectiveness' },
      { name: 'lessons_learned', label: 'Lessons learned', type: 'long' },
      { name: 'management_remarks', label: 'Management remarks', type: 'long' },
    ],
  },
];

export const pageBySlug = (slug: string) => PAGES.find(p => p.slug === slug) ?? null;
export const pageById = (id: number) => PAGES.find(p => p.id === id) ?? null;

/** All field names the workflow writes, for the save action's allowlist. */
export const ALL_FIELD_NAMES = new Set(PAGES.flatMap(p => p.fields.map(f => f.name)));

export type ComplaintValues = Record<string, unknown>;

export function isFieldShown(f: ComplaintField, values: ComplaintValues): boolean {
  if (!f.showWhen) return true;
  const v = values[f.showWhen.field];
  return f.showWhen.equals.some(e => e === v || (typeof e === 'string' && String(v ?? '') === e));
}

/** Required fields of a page that are still empty, as labels. */
export function missingOnPage(page: ComplaintPage, values: ComplaintValues): string[] {
  return page.fields
    .filter(f => f.required && isFieldShown(f, values))
    .filter(f => { const v = values[f.name]; return v == null || v === ''; })
    .map(f => f.label);
}

// ── Who may edit ───────────────────────────────────────────────────────────

export interface Editor {
  id: number | null;
  role: RisansiRole | string;
  departments: readonly string[];
}

export interface ComplaintForAccess {
  status: string;
  schema_version: number;
  complaint_type?: string | null;
  investigation_assigned_to?: number | null;
  action_assigned_to?: number | null;
  returnable_owner?: number | null;
  rep_user_id?: number | null;
  reported_by_user?: number | null;
  /** The viewer works this complaint's client (owner, cover, team). */
  worksClient?: boolean;
}

/**
 * May this person edit this page of this complaint?
 *
 * Department decides the default; a per-complaint assignment overrides it
 * (Investigation Assigned To edits page 4, Action Assigned To page 5,
 * Responsible for Returnable page 7); reps and managers reach page 1 and page 5
 * through the client they work; admins edit everything. A legacy record
 * (schema_version 1) is read-only for everyone but an admin.
 */
export function canEditPage(user: Editor, c: ComplaintForAccess, page: ComplaintPage): boolean {
  if (isAdminRole(user.role)) return true;
  if (c.schema_version < 2) return false;
  if (c.status === 'Closed') return false;
  const uid = user.id;
  if (uid != null) {
    if (page.id === 4 && c.investigation_assigned_to === uid) return true;
    if (page.id === 5 && c.action_assigned_to === uid) return true;
    if (page.id === 7 && c.returnable_owner === uid) return true;
  }
  if (page.repsMayEdit && (user.role === 'rep' || user.role === 'manager') && (c.worksClient || c.rep_user_id === uid || c.reported_by_user === uid)) return true;
  // Page 3 and 4 for a technical complaint belong to QC; non-technical to the Complaint Team.
  if ((page.id === 3 || page.id === 4) && c.complaint_type) {
    const owner: Department = c.complaint_type === 'Technical' ? 'QC' : 'Complaint Team';
    if (user.departments.includes(owner)) return true;
    return user.departments.includes('Complaint Team') && page.id === 3;   // the team can always fill risk
  }
  return page.departments.some(d => user.departments.includes(d));
}

/** May this person move the complaint between statuses at all? */
export function canMove(user: Editor, c: ComplaintForAccess): boolean {
  if (isAdminRole(user.role)) return true;
  if (c.schema_version < 2) return false;
  return user.departments.includes('Complaint Team') || user.departments.includes('QC')
    || (user.id != null && (c.investigation_assigned_to === user.id || c.action_assigned_to === user.id));
}

// ── Transitions and gates ──────────────────────────────────────────────────

export const NEXT: Record<ComplaintStatus, ComplaintStatus[]> = {
  'Open':                          ['Under Investigation', 'Action Pending', 'Resolved'],
  'Under Investigation':           ['Action Pending', 'Customer Confirmation Pending', 'Resolved'],
  'Action Pending':                ['Replacement Pending', 'Customer Confirmation Pending', 'Resolved'],
  'Replacement Pending':           ['Customer Confirmation Pending', 'Resolved'],
  'Customer Confirmation Pending': ['Resolved', 'Action Pending'],
  'Resolved':                      ['Closed', 'Under Investigation'],
  'Closed':                        ['Under Investigation'],
};

export interface GateContext {
  values: ComplaintValues;
  severity: Severity | null;
  hasCapaDocument: boolean;
}

/**
 * What stands between this complaint and `to`. Empty means it may go.
 * Requirements belong to the transition, not the row: nothing here is asked of
 * a complaint that is not trying to move.
 */
export function gateFor(from: string, to: ComplaintStatus, ctx: GateContext): string[] {
  const v = ctx.values, sev = ctx.severity;
  const need: string[] = [];
  const page = (id: number) => pageById(id) as ComplaintPage;
  const missing = (id: number) => missingOnPage(page(id), v).map(l => `${page(id).title}: ${l}`);

  // Everything after Open needs registration complete, the pump identified, and the risk answered.
  if (from === 'Open' || to === 'Under Investigation' && from !== 'Resolved' && from !== 'Closed') {
    need.push(...missing(1), ...missing(2));
    if (!sev) need.push('Risk & Criticality: answer the risk questions so the severity is known');
    else need.push(...missing(3));
  }
  // Skipping the investigation is allowed only when the severity allows it.
  if (from === 'Open' && to !== 'Under Investigation' && (sev === 'S1' || sev === 'S2')) {
    need.push(`Severity ${sev} requires an investigation before anything else`);
  }
  if (to === 'Action Pending' || to === 'Replacement Pending') {
    if (from !== 'Open') need.push(...missing(5).filter(m => !/completion date$/i.test(m) || /Target/.test(m)));
  }
  if (to === 'Replacement Pending' && !/Replacement/.test(String(v.action_category ?? ''))) {
    need.push('Corrective Action: the action category must be a replacement');
  }
  if (to === 'Customer Confirmation Pending') {
    if (!v.action_against) need.push('Corrective Action: action against complaint');
  }
  if (to === 'Resolved') {
    if (v.customer_confirmed !== true && from === 'Customer Confirmation Pending') need.push('Corrective Action: customer confirmed the fix');
    if (sev === 'S1' || sev === 'S2') {
      if (!v.root_cause) need.push('Investigation: root cause');
      if (!v.root_cause_category) need.push('Investigation: root cause category');
    }
    if (sev === 'S3' && !v.action_against) need.push('Corrective Action: action against complaint');
    if (sev === 'S4' && !v.status_remarks && !v.action_against) need.push('Remarks for complaint status');
  }
  if (to === 'Closed') {
    need.push(...missing(8));
    if ((sev === 'S1' || sev === 'S2') && !ctx.hasCapaDocument) need.push('CAPA document attached (page 6)');
    if (v.material_returnable === true && v.returnable_status && !['Received', 'Closed'].includes(String(v.returnable_status))) {
      need.push(`Returnable material is still ${v.returnable_status}`);
    }
  }
  return [...new Set(need)];
}

// ── Holders — who is accountable while it sits in a status ─────────────────

export interface Holder { department: Department | 'Customer'; userId: number | null }

export function holderFor(status: string, c: ComplaintValues): Holder {
  const type = String(c.complaint_type ?? '');
  const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : c[k] ? Number(c[k]) : null);
  switch (status) {
    case 'Under Investigation':
      return { department: type === 'Technical' ? 'QC' : 'Complaint Team', userId: num('investigation_assigned_to') };
    case 'Action Pending': {
      const cat = String(c.action_category ?? '');
      const dept: Department = /Replacement/.test(cat) ? 'Quotation Team'
        : /Repair/.test(cat) ? 'Billing Team'
        : /Online/.test(cat) ? 'QC' : 'Complaint Team';
      return { department: dept, userId: num('action_assigned_to') };
    }
    case 'Replacement Pending':
      return { department: 'Quotation Team', userId: num('action_assigned_to') };
    case 'Customer Confirmation Pending':
      return { department: 'Customer', userId: null };
    default:
      return { department: 'Complaint Team', userId: null };
  }
}

// ── Lifecycle maths ────────────────────────────────────────────────────────

export interface StageLogRow {
  to_status: string;
  holder_department: string | null;
  holder_user_id: number | null;
  holder_name?: string | null;
  created_at: string;
}

export interface Dwell {
  status: string;
  department: string;
  userId: number | null;
  holderName: string | null;
  from: string;
  to: string | null;
  days: number;
  current: boolean;
}

/** Each stretch of the complaint's life: which status, who held it, for how many days. */
export function dwells(log: StageLogRow[], nowIso: string): Dwell[] {
  const rows = [...log].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: Dwell[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], next = rows[i + 1];
    const end = next ? next.created_at : nowIso;
    const days = Math.max(0, (Date.parse(end) - Date.parse(r.created_at)) / 86400000);
    out.push({
      status: r.to_status, department: r.holder_department ?? 'Complaint Team', userId: r.holder_user_id,
      holderName: r.holder_name ?? null, from: r.created_at, to: next ? next.created_at : null,
      days, current: !next && isOpenStatus(r.to_status),
    });
  }
  return out;
}

/** Days per holder, summed across the complaint's life. */
export function dwellByHolder(d: Dwell[]): { key: string; label: string; days: number; stretches: number }[] {
  const m = new Map<string, { key: string; label: string; days: number; stretches: number }>();
  for (const x of d) {
    if (!isOpenStatus(x.status)) continue;             // time after Resolved / Closed is nobody's
    const key = x.holderName ? `${x.department} · ${x.holderName}` : x.department;
    const cur = m.get(key) ?? { key, label: key, days: 0, stretches: 0 };
    cur.days += x.days; cur.stretches++; m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => b.days - a.days);
}
