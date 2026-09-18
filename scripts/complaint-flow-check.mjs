#!/usr/bin/env node
// The complaint workflow's rules, exercised.
//
//   node scripts/complaint-flow-check.mjs      (runs as part of `npm run build`)
//
// severityOf against the sheet's truth table and the cases it does not cover;
// the gates that hold a complaint back and the ones that let it through; who
// holds it in each status; who may edit which page; the lifecycle arithmetic.
// Pure functions, so no database — a rule that changes here changes in the
// pages and the actions too, because they import the same module.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cf-'));
const src = fs.readFileSync(path.join(ROOT, 'lib', 'risansi-complaint-flow.ts'), 'utf8').replace(/^import type .*$/gm, '');
fs.writeFileSync(path.join(tmp, 'flow.mjs'), ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const F = await import('file:///' + path.join(tmp, 'flow.mjs').split(path.sep).join('/'));
fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(66)} ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};

console.log('Severity — the sheet\'s truth table, then the gaps it left:');
const no = Object.fromEntries(F.RISK_FIELDS.map(f => [f.key, false]));
check('nothing answered → no severity yet', F.severityOf({}), null);
check('all No → S4', F.severityOf(no), 'S4');
check('workable only → S3', F.severityOf({ ...no, risk_workable: true }), 'S3');
check('major performance only → S2', F.severityOf({ ...no, risk_major_perf: true }), 'S2');
check('safety + major performance → S1', F.severityOf({ ...no, risk_safety: true, risk_major_perf: true }), 'S1');
check('cost impact alone → S2 (decided 12 Sep)', F.severityOf({ ...no, risk_cost_impact: true }), 'S2');
check('quantity > 5 alone → S3', F.severityOf({ ...no, risk_qty_over_5: true }), 'S3');
check('repeat mistake + workable → S2, the higher wins', F.severityOf({ ...no, risk_repeat_mistake: true, risk_workable: true }), 'S2');
check('one answer only, No → S4 (partially answered counts)', F.severityOf({ risk_safety: false }), 'S4');

console.log('\nGates:');
const full = {
  complaint_date: '2026-09-13', channel: 'Email', complaint_type: 'Technical', defect_category: 'Leakage', defect_reason: 'Leakage from gland',
  responsible_department: 'QC & Production', details: 'x', contact_person: 'y',
  so_no: 'SO1', ec_no: 'EC1', pump_serial_no: 'SN1', pump_model: 'M1',
  ...no, risk_safety: false, risk_shutdown: false, risk_pump_failure: false, risk_major_perf: false, risk_repeat_failure: false,
};
check('Open → Under Investigation with pages 1–3 complete: no gate', F.gateFor('Open', 'Under Investigation', { values: full, severity: 'S2', hasCapaDocument: false }), []);
// The serial is not always on the pump or the paperwork (decided 18 Sep), so
// its absence holds nothing back; a missing pump model still does.
check('Open → Under Investigation with no pump serial: not held',
  F.gateFor('Open', 'Under Investigation', { values: { ...full, pump_serial_no: '' }, severity: 'S2', hasCapaDocument: false }), []);
check('Open → Under Investigation with no pump model: named',
  F.gateFor('Open', 'Under Investigation', { values: { ...full, pump_model: '' }, severity: 'S2', hasCapaDocument: false }), ['Order & Pump: Pump model no.']);
check('Open → Under Investigation with risk unanswered: asks for the risk page',
  F.gateFor('Open', 'Under Investigation', { values: full, severity: null, hasCapaDocument: false }),
  ['Risk & Criticality: answer the risk questions so the severity is known']);
check('S1 may not skip the investigation',
  F.gateFor('Open', 'Action Pending', { values: full, severity: 'S1', hasCapaDocument: false }).some(m => /requires an investigation/.test(m)), true);
check('S4 may go Open → Resolved with remarks',
  F.gateFor('Open', 'Resolved', { values: { ...full, status_remarks: 'sorted on the phone' }, severity: 'S4', hasCapaDocument: false }), []);
check('S4 Open → Resolved without remarks: asks for them',
  F.gateFor('Open', 'Resolved', { values: full, severity: 'S4', hasCapaDocument: false }), ['Remarks for complaint status']);
const resolved = { ...full, root_cause: 'r', root_cause_category: 'Material', action_against: 'a', customer_confirmed: true,
  closure_summary: 's', customer_satisfied: true };
check('S2 Resolved → Closed without a CAPA document: refused',
  F.gateFor('Resolved', 'Closed', { values: resolved, severity: 'S2', hasCapaDocument: false }), ['CAPA document attached (page 6)']);
check('S2 Resolved → Closed with a CAPA document: allowed',
  F.gateFor('Resolved', 'Closed', { values: resolved, severity: 'S2', hasCapaDocument: true }), []);
check('S3 Resolved → Closed needs no CAPA document',
  F.gateFor('Resolved', 'Closed', { values: resolved, severity: 'S3', hasCapaDocument: false }), []);
check('Closed blocked while a returnable is In Transit',
  F.gateFor('Resolved', 'Closed', { values: { ...resolved, material_returnable: true, returnable_status: 'In Transit' }, severity: 'S3', hasCapaDocument: false }),
  ['Returnable material is still In Transit']);
check('Customer Confirmation Pending → Resolved needs the customer\'s yes',
  F.gateFor('Customer Confirmation Pending', 'Resolved', { values: { ...resolved, customer_confirmed: null }, severity: 'S3', hasCapaDocument: false }),
  ['Corrective Action: customer confirmed the fix']);
check('Replacement Pending needs a replacement action category',
  F.gateFor('Action Pending', 'Replacement Pending', { values: { ...resolved, action_category: 'Repair', action_assigned_to: 5, target_completion_date: '2026-10-01' }, severity: 'S3', hasCapaDocument: false }),
  ['Corrective Action: the action category must be a replacement']);
check('Reopen: Closed → Under Investigation is a legal move', F.NEXT.Closed.includes('Under Investigation'), true);
check('every status has somewhere to go', F.STATUSES.every(s => F.NEXT[s].length > 0), true);

console.log('\nHolders:');
check('Under Investigation, technical → QC', F.holderFor('Under Investigation', { complaint_type: 'Technical', investigation_assigned_to: 7 }), { department: 'QC', userId: 7 });
check('Under Investigation, non-technical → Complaint Team', F.holderFor('Under Investigation', { complaint_type: 'Non-technical' }), { department: 'Complaint Team', userId: null });
check('Action Pending, free replacement → Quotation Team', F.holderFor('Action Pending', { action_category: 'Free Replacement', action_assigned_to: 3 }), { department: 'Quotation Team', userId: 3 });
check('Action Pending, repair → Billing Team', F.holderFor('Action Pending', { action_category: 'Repair' }).department, 'Billing Team');
check('Customer Confirmation Pending → the customer', F.holderFor('Customer Confirmation Pending', {}).department, 'Customer');
check('Open → Complaint Team', F.holderFor('Open', {}).department, 'Complaint Team');

console.log('\nWho may edit:');
const p = (id) => F.pageById(id);
const live = { status: 'Open', schema_version: 2, complaint_type: 'Technical' };
const team  = { id: 1, role: 'staff', departments: ['Complaint Team'] };
const qc    = { id: 2, role: 'staff', departments: ['QC'] };
const quote = { id: 3, role: 'staff', departments: ['Quotation Team'] };
const rep   = { id: 4, role: 'rep', departments: [] };
const admin = { id: 5, role: 'admin', departments: [] };
const nobody = { id: 6, role: 'staff', departments: [] };
check('Complaint Team edits registration', F.canEditPage(team, live, p(1)), true);
check('a rep edits registration on a client they work', F.canEditPage(rep, { ...live, worksClient: true }, p(1)), true);
check('a rep does not edit registration on a stranger\'s client', F.canEditPage(rep, { ...live, worksClient: false }, p(1)), false);
check('QC edits investigation on a technical complaint', F.canEditPage(qc, live, p(4)), true);
check('Complaint Team does not edit investigation on a technical complaint', F.canEditPage(team, live, p(4)), false);
check('Complaint Team edits investigation on a non-technical one', F.canEditPage(team, { ...live, complaint_type: 'Non-technical' }, p(4)), true);
check('Quotation Team does not edit investigation…', F.canEditPage(quote, live, p(4)), false);
check('…but does when named as the action assignee, on page 5', F.canEditPage(quote, { ...live, action_assigned_to: 3 }, p(5)), true);
check('staff with no department edits nothing', F.PAGES.every(pg => !F.canEditPage(nobody, live, pg)), true);
check('admin edits everything', F.PAGES.every(pg => F.canEditPage(admin, live, pg)), true);
check('a legacy record is read-only for the team', F.canEditPage(team, { ...live, schema_version: 1 }, p(1)), false);
check('a closed record is read-only for the team', F.canEditPage(team, { ...live, status: 'Closed' }, p(8)), false);
check('Purchase edits CAPA & documents', F.canEditPage({ id: 9, role: 'staff', departments: ['Purchase'] }, live, p(6)), true);
check('Billing edits returnable', F.canEditPage({ id: 9, role: 'staff', departments: ['Billing Team'] }, live, p(7)), true);

console.log('\nLifecycle:');
const log = [
  { to_status: 'Open', holder_department: 'Complaint Team', holder_user_id: null, created_at: '2026-09-01T00:00:00Z' },
  { to_status: 'Under Investigation', holder_department: 'QC', holder_user_id: 2, holder_name: 'RK', created_at: '2026-09-03T00:00:00Z' },
  { to_status: 'Customer Confirmation Pending', holder_department: 'Customer', holder_user_id: null, created_at: '2026-09-10T00:00:00Z' },
  { to_status: 'Resolved', holder_department: 'Complaint Team', holder_user_id: null, created_at: '2026-09-12T00:00:00Z' },
];
const d = F.dwells(log, '2026-09-13T00:00:00Z');
check('four stretches', d.length, 4);
check('days per stretch', d.map(x => Math.round(x.days)), [2, 7, 2, 1]);
check('only an open final stretch is "current"', d.map(x => x.current), [false, false, false, false]);
const by = F.dwellByHolder(d);
check('QC · RK held it longest, and time after Resolved counts for nobody', by.map(x => `${x.key}:${Math.round(x.days)}`), ['QC · RK:7', 'Complaint Team:2', 'Customer:2']);
const open = F.dwells(log.slice(0, 2), '2026-09-13T00:00:00Z');
check('an open complaint\'s last stretch is current, 10 days and counting', [open[1].current, Math.round(open[1].days)], [true, 10]);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nevery rule behaves');
process.exit(bad ? 1 : 0);
