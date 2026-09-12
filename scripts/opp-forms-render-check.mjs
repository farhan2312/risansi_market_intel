#!/usr/bin/env node
// Render every opportunity form once, for every stage, and make sure none throws.
//
//   node scripts/opp-forms-render-check.mjs
//
// A form that throws on its first render is the worst kind of bug: the page
// goes to "Something went wrong" with nothing in the console the user can see,
// and nothing on the server. The move form did exactly that for a day — its
// state initializer read the state it was creating — and no build step caught
// it, because it type-checks. This does what tsc cannot: it mounts the forms.
//
// Effects do not run under renderToStaticMarkup, so fetches, timers and server
// actions are never reached; they are stubbed only so the modules import.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.ofr-'));

// Stubs for what the components import but never call at render time.
const stubs = {
  'next/navigation': `export const useRouter = () => ({ refresh() {}, push() {} }); export const usePathname = () => '/';`,
  'next/link': `import React from 'react'; export default ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children);`,
  'actions/risansi': `export const updateOpportunity = async () => ({ ok: true }); export const createPipelineOpportunity = async () => ({ ok: true, id: '1' }); export const deleteOpportunity = async () => ({ ok: true, data: null }); export const addSalesOrder = async () => ({ ok: true, data: null }); export const deleteSalesOrder = async () => ({ ok: true, data: null }); export const addPurchaseOrder = async () => ({ ok: true, data: null }); export const deletePurchaseOrder = async () => ({ ok: true, data: null }); export const listSalesOrders = async () => []; export const listPurchaseOrders = async () => []; export const saveQuotedDetails = async () => ({ ok: true, data: null }); export const updateWonFinalValue = async () => ({ ok: true, data: null });`,
  'actions/risansi-opportunity-remarks': `export const addOpportunityRemark = async () => ({ ok: true }); export const listOpportunityRemarks = async () => [];`,
};

const seen = new Map();
function compile(rel) {
  if (seen.has(rel)) return seen.get(rel);
  const out = path.join(tmp, rel.replace(/[\\/]/g, '__').replace(/\.tsx?$/, '') + '.mjs');
  seen.set(rel, out);
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Rewrite imports to compiled siblings or stubs.
  src = src.replace(/from '([^']+)'/g, (m, spec) => {
    for (const [k, body] of Object.entries(stubs)) {
      if (spec === k || spec.endsWith('/' + k) || spec === '@/app/' + k) {
        const f = path.join(tmp, 'stub__' + k.replace(/[\\/]/g, '__') + '.mjs');
        if (!fs.existsSync(f)) fs.writeFileSync(f, body);
        return `from './${path.basename(f)}'`;
      }
    }
    let target = null;
    if (spec.startsWith('@/')) target = spec.slice(2);
    else if (spec.startsWith('./')) target = path.posix.join(path.posix.dirname(rel.replace(/\\/g, '/')), spec.slice(2));
    if (!target) return m;                                   // react, etc.
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
      if (fs.existsSync(path.join(ROOT, target + ext))) return `from './${path.basename(compile(target + ext))}'`;
    }
    return m;
  });
  fs.writeFileSync(out, ts.transpileModule(src, {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react' },
  }).outputText);
  return out;
}
const load = async (rel) => import('file:///' + compile(rel).split(path.sep).join('/'));

const { OppStageMoveModal } = await load('components/risansi/OppStageMoveModal.tsx');
const { ALL_STAGES } = await load('lib/risansi-opportunity-fields.ts');

const opp = {
  id: 1, stage: 'Prospect', client_name: 'TEST CLIENT', client_code: 'TEST01',
  value_cr: 0.12, final_value_cr: null, offer_value_inr: 1200000, quote_ref: null,
  product: 'Pump', product_type: 'PCP', opportunity_category: 'New Requirement',
};

let bad = 0;
for (const from of ['Prospect', 'Suspect', 'Quoted']) {
  for (const target of ALL_STAGES) {
    if (target === from) continue;
    try {
      const html = renderToStaticMarkup(React.createElement(OppStageMoveModal, {
        opp: { ...opp, stage: from }, target, usdRate: 86, onCancel() {}, onDone() {},
      }));
      const ok = html.includes(`${from} → ${target}`);
      if (!ok) bad++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} move form ${from} → ${target} (${html.length} chars)`);
    } catch (e) {
      bad++;
      console.log(`  FAIL move form ${from} → ${target}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} form(s) throw on render` : '\nevery move form renders');
process.exit(bad ? 1 : 0);
