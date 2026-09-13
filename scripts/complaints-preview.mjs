#!/usr/bin/env node
// Render the complaints module to HTML files, with real data, and check that
// its numbers add up.
//
//   node scripts/complaints-preview.mjs [complaintId]
//
// The module is auth-gated, so this is how the dashboard, the list and a
// complaint's own page (timeline, lifecycle, the eight pages, the move bar,
// the files) get looked at without signing in. Writes two files under
// node_modules/ and prints their paths. The checks are the ones a dashboard
// must pass: open + closed = all, every open complaint sits with exactly one
// holder, dwell time on a complaint equals its open time, and the funnel,
// severity and age buckets each sum to what they claim to partition.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cp-'));
const write = (name, code) => fs.writeFileSync(path.join(tmp, `${name}.mjs`), code);

// Stubs for what a server render outside Next cannot have.
write('next-link', `import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children); }`);
write('next-navigation', `export const useRouter = () => ({ push() {}, refresh() {} }); export const notFound = () => { throw new Error('notFound'); };`);
write('actions', `const ok = async () => ({ ok: true }); export const saveComplaintPage = ok, moveComplaint = ok, deleteComplaintAttachment = ok, addComplaintNote = ok, deleteComplaint = ok, createComplaintV2 = async () => ({ ok: true, data: { id: 0, complaint_no: '' } }), lookupPump = async () => ({ ok: true, data: null }), listComplaintLookups = async () => ({});`);

const rewrite = (src) => src
  .replace(/from '@\/app\/actions\/risansi-complaints-v2'/g, "from './actions.mjs'")
  .replace(/from 'next\/link'/g, "from './next-link.mjs'")
  .replace(/from 'next\/navigation'/g, "from './next-navigation.mjs'")
  .replace(/from '@\/lib\/([^']+)'/g, "from './$1.mjs'")
  .replace(/from '@\/components\/risansi\/complaints\/([^']+)'/g, "from './$1.mjs'")
  .replace(/from '@\/components\/risansi\/([^']+)'/g, "from './$1.mjs'")
  .replace(/from '\.\/([A-Za-z-]+)'/g, "from './$1.mjs'")
  .replace(/^'use client';\s*/m, '');

for (const rel of [
  'lib/risansi-complaint-flow.ts', 'lib/risansi-complaint-stats.ts', 'lib/risansi-stage-dashboard.ts',
  'components/risansi/StageCharts.tsx',
  'components/risansi/complaints/ComplaintStats.tsx', 'components/risansi/complaints/ComplaintFilterBar.tsx',
  'components/risansi/complaints/ComplaintTable.tsx', 'components/risansi/complaints/ComplaintTimeline.tsx',
  'components/risansi/complaints/ComplaintMoveBar.tsx', 'components/risansi/complaints/ComplaintPageForm.tsx',
  'components/risansi/complaints/ComplaintAttachments.tsx', 'components/risansi/complaints/ComplaintNotes.tsx',
  'components/risansi/complaints/NewComplaintForm.tsx', 'components/risansi/ClientComplaints.tsx',
]) {
  const name = path.basename(rel).replace(/\.tsx?$/, '');
  write(name, ts.transpileModule(rewrite(fs.readFileSync(path.join(ROOT, rel), 'utf8')), {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react' },
  }).outputText);
}
// The row loader talks to the pool through the app's module; give it a plain one here.
write('db-risansi', `import pg from 'pg'; export default globalThis.__pool;`);
write('risansi-auth', `export const complaintVisibilitySql = () => null;`);
{
  const rel = 'lib/risansi-complaint-rows.ts';
  write('risansi-complaint-rows', ts.transpileModule(rewrite(fs.readFileSync(path.join(ROOT, rel), 'utf8')), {
    fileName: rel, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}

const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });
globalThis.__pool = pool;

const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const flow = await imp('risansi-complaint-flow');
const { loadComplaintRows, loadHolderDwells } = await imp('risansi-complaint-rows');
const { summariseComplaints } = await imp('risansi-complaint-stats');
const { ComplaintStats } = await imp('ComplaintStats');
const { ComplaintFilterBar } = await imp('ComplaintFilterBar');
const { ComplaintTable } = await imp('ComplaintTable');
const { ComplaintTimeline, ComplaintLifecycle } = await imp('ComplaintTimeline');
const { ComplaintMoveBar } = await imp('ComplaintMoveBar');
const { ComplaintPageForm } = await imp('ComplaintPageForm');
const { ComplaintAttachments } = await imp('ComplaintAttachments');
const { ComplaintNotes } = await imp('ComplaintNotes');
const { NewComplaintForm } = await imp('NewComplaintForm');
const { ClientComplaints } = await imp('ClientComplaints');

const admin = { id: 1, role: 'admin', departments: [], email: 'preview@risansi.com' };
const rows = await loadComplaintRows(admin);
const dwells = await loadHolderDwells(admin);
const s = summariseComplaints(rows, dwells);

let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const openRows = rows.filter(r => flow.isOpenStatus(r.status));
check(`${s.total} complaints · open ${s.open} · overdue ${s.overdue} · closed ${s.closed}`, s.open + s.closed === s.total);
check('every open workflow complaint has one holder', openRows.filter(r => r.schema_version >= 2).every(r => r.holder_department));
check('holders by department sum to open workflow', s.byHolderDept.reduce((a, h) => a + h.open, 0) === openRows.filter(r => r.schema_version >= 2).length);
check('funnel counts partition the workflow statuses', s.funnel.reduce((a, x) => a + x.count, 0) === rows.filter(r => flow.STATUSES.includes(r.status)).length);
check('severity buckets partition open workflow', s.bySeverity.reduce((a, b) => a + b.count, 0) === openRows.filter(r => r.schema_version >= 2).length);
check('age buckets partition open', s.openByAge.reduce((a, b) => a + b.count, 0) === s.open);
check('no closure in the future', rows.every(r => !r.closed_at || Date.parse(r.closed_at) <= Date.now() + 60000));
check('no negative days', rows.every(r => r.days_in_status >= 0 && r.age_days >= -0.01));
{
  const by = new Map();
  for (const d of dwells) by.set(d.complaint_id, (by.get(d.complaint_id) ?? 0) + d.days);
  // The stage log starts at created_at; age counts from the complaint date, which can be earlier.
  const off = openRows.filter(r => r.schema_version >= 2).filter(r => (by.get(r.id) ?? 0) - r.age_days > 0.5);
  check('no open complaint has been held for longer than it has existed', off.length === 0);
}
console.log(`\n  avg open age ${s.avgOpenAge?.toFixed(1)}d · avg close ${s.avgTimeToClose?.toFixed(1)}d (median ${s.medianTimeToClose}) · 30d ${s.raised30}↑ ${s.closed30}↓`);
console.log('  holders: ' + s.byHolderDept.map(h => `${h.label} ${h.open} open / ${h.days.toFixed(0)}d now / ${h.totalDays.toFixed(0)}d ever`).join(' · '));

// ── The list page ──
const value = {};
const href = (k, v) => `?${k}=${encodeURIComponent(v)}`;
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort();
const options = { types: uniq(rows.map(r => r.complaint_type)), categories: uniq(rows.map(r => r.defect_category)), responsibles: uniq(rows.map(r => r.responsible_department)), reps: [], holders: [] };
const listHtml = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement(ComplaintStats, { s, href, sel: value }),
  React.createElement(ComplaintFilterBar, { value, options, basePath: '/risansi/complaints' }),
  React.createElement(ComplaintTable, { rows }),
));

// ── One complaint ──
const wanted = Number(process.argv[2]) || openRows.find(r => r.schema_version >= 2)?.id || rows[0].id;
const { rows: [c] } = await pool.query(`
  SELECT c.*, cl.legal_name AS client_name, cl.code AS client_code, c.created_at::text AS created_at FROM complaints c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`, [wanted]);
const { rows: log } = await pool.query(`
  SELECT l.to_status, l.from_status, l.holder_department, l.holder_user_id, u.name AS holder_name, l.created_at::text AS created_at, l.note
    FROM complaint_stage_log l LEFT JOIN users u ON u.id = l.holder_user_id WHERE l.complaint_id = $1 ORDER BY l.created_at, l.id`, [wanted]);
const { rows: files } = await pool.query(`SELECT id, category, file_name, mime_type, byte_size, caption, uploaded_by, uploaded_at::text AS uploaded_at FROM complaint_attachments WHERE complaint_id = $1`, [wanted]);
const { rows: notes } = await pool.query(`SELECT body, created_by, created_at::text AS created_at FROM complaint_updates WHERE complaint_id = $1 AND body NOT LIKE 'Status changed to %' ORDER BY created_at DESC LIMIT 20`, [wanted]);
const { rows: lookupRows } = await pool.query('SELECT kind, value FROM complaint_lookups WHERE is_active ORDER BY kind, sort_order, value');
const { rows: users } = await pool.query(`SELECT u.id, u.name, u.role, ARRAY(SELECT d.department FROM user_departments d WHERE d.user_id = u.id) AS departments FROM users u WHERE u.is_active ORDER BY u.name`);
const lookups = {}; for (const r of lookupRows) (lookups[r.kind] ??= []).push(r.value);
const life = flow.dwells(log, new Date().toISOString());
const holders = flow.dwellByHolder(life);
const legacy = c.schema_version < 2;
const gate = {};
for (const to of (flow.NEXT[c.status] ?? [])) gate[to] = flow.gateFor(c.status, to, { values: c, severity: c.severity, hasCapaDocument: files.some(f => f.category === 'capa') });
const panel = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 12 };
const h = (title, node) => React.createElement('div', { style: panel }, React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, title), node);
const detailHtml = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement('h1', { style: { fontSize: 22, margin: '0 0 12px' } }, `${c.complaint_no} · ${c.status} · ${c.client_name ?? ''}`),
  h('Timeline', React.createElement(React.Fragment, null,
    React.createElement(ComplaintTimeline, { status: c.status, dwells: life, legacy }),
    !legacy && React.createElement('div', { style: { marginTop: 14 } }, React.createElement(ComplaintMoveBar, { complaintId: c.id, status: c.status, canMove: true, gate })))),
  ...flow.PAGES.map(p => h(`${p.id}. ${p.title}`, React.createElement(React.Fragment, null,
    p.id === 1 && React.createElement('div', { style: { marginBottom: 14 } }, React.createElement(ComplaintAttachments, { complaintId: c.id, files, canEdit: true, canEditCapa: true, only: ['complaint', 'photo'] })),
    React.createElement(ComplaintPageForm, { complaintId: c.id, clientId: c.client_id, page: p, initial: c, lookups, users, canEdit: !legacy && p.id !== 8, whyNot: p.id === 8 ? 'Closure is the Complaint Team\'s.' : null }),
    p.id === 6 && React.createElement('div', { style: { marginTop: 14 } }, React.createElement(ComplaintAttachments, { complaintId: c.id, files, canEdit: true, canEditCapa: true }))))),
  h('Lifecycle', React.createElement(ComplaintLifecycle, { dwells: life, byHolder: holders })),
  h('Notes', React.createElement(ComplaintNotes, { complaintId: c.id, notes, isAdmin: true })),
));

// ── Raise, and the Client 360 panel ──
const { rows: clients } = await pool.query(`SELECT id::int AS id, code, legal_name AS name FROM clients WHERE deleted_at IS NULL ORDER BY legal_name LIMIT 300`);
const newHtml = renderToStaticMarkup(React.createElement(NewComplaintForm, { clients, preselect: c.client_id, lookups, users }));
const c360Rows = await loadComplaintRows(admin, { clientId: c.client_id });
const c360Html = renderToStaticMarkup(React.createElement('div', { style: { maxWidth: 640 } }, React.createElement(ClientComplaints, { complaints: c360Rows, clientId: c.client_id })));

await pool.end();
fs.rmSync(tmp, { recursive: true, force: true });

const CSS = `<style>:root{--fg:#0D1B2E;--fg-2:#2D3E55;--fg-3:#6B7F96;--fg-4:#A8BAC8;--bg:#F4F6FB;--bg-paper:#fff;--bg-elev:#EDF1F7;--bg-sunk:#E2E8F3;--line:rgba(10,22,40,.08);--line-2:rgba(10,22,40,.05);--line-strong:rgba(10,22,40,.16);--accent:#1A5CB8;--pos:#059669;--pos-soft:#D1FAE5;--neg:#DC2626;--neg-soft:#FEE2E2;--neg-strong:#991B1B;--warn:#D97706;--warn-soft:#FEF3C7;--warn-strong:#92400E;--radius:6px;--font-mono:ui-monospace,monospace;--brand-blue:#1A5CB8}`
  + `body{margin:0;padding:22px;background:var(--bg);font:14px system-ui,sans-serif;color:var(--fg)}`
  + `.stage-grid-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}h2{font-size:15px;margin:28px 0 10px;color:var(--fg-3)}</style>`;
const outList = path.join(ROOT, 'node_modules', '.cache-complaints-list.html');
const outDetail = path.join(ROOT, 'node_modules', '.cache-complaints-detail.html');
fs.writeFileSync(outList, `<!doctype html><meta charset="utf-8"><title>Complaints</title>${CSS}${listHtml}<h2>Client 360 panel</h2>${c360Html}`);
fs.writeFileSync(outDetail, `<!doctype html><meta charset="utf-8"><title>Complaint</title>${CSS}${detailHtml}<h2>Raise a complaint</h2>${newHtml}`);
console.log(`\n  ${outList}\n  ${outDetail}`);
process.exit(bad ? 1 : 0);
