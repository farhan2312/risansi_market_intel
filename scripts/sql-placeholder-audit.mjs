#!/usr/bin/env node
// Find INSERT statements whose column list and placeholder list disagree.
//
//   node scripts/sql-placeholder-audit.mjs
//
// This exists because `INSERT INTO opportunity_items (…10 columns…) VALUES
// ($1..$11)` shipped and stood for seven weeks. Nothing caught it: it type-checks,
// it builds, and it only fails at runtime on the row that reaches it — which for
// that one was every quotation save that had any quoted items. A count of two
// lists is the whole check, so it may as well be automatic.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIRS = ['app', 'lib', 'components', 'scripts', 'migrations'];
const EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.sql']);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (EXT.has(path.extname(e.name))) files.push(full);
  }
})(ROOT) ?? null;

// Re-walk only the directories we care about (the IIFE above starts at ROOT).
files.length = 0;
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (EXT.has(path.extname(e.name))) files.push(full);
    }
  })(abs);
}

/** Split a column list on commas that are not inside brackets or quotes. */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', quote = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// INSERT INTO <table> ( <cols> ) VALUES ( <vals> )
const RE = /INSERT\s+INTO\s+([A-Za-z_][\w.]*)\s*\(([^;]*?)\)\s*VALUES\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gis;

let problems = 0, checked = 0, skipped = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (const m of src.matchAll(RE)) {
    const [full, table, colsRaw, valsRaw] = m;
    // A column list built by interpolation cannot be counted from the source.
    if (colsRaw.includes('${') || valsRaw.includes('${')) { skipped++; continue; }
    // Strip SQL line comments so a commented column is not counted.
    const cols = splitTop(colsRaw.replace(/--[^\n]*/g, '')).filter(Boolean);
    const vals = splitTop(valsRaw.replace(/--[^\n]*/g, '')).filter(Boolean);
    checked++;
    const line = lines.findIndex(l => l.includes(full.split('\n')[0].trim().slice(0, 40))) + 1;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (cols.length !== vals.length) {
      problems++;
      console.log(`\n  ${rel}:${line || '?'}  INSERT INTO ${table}`);
      console.log(`    ${cols.length} columns but ${vals.length} values`);
      console.log(`    columns: ${cols.join(', ')}`);
      console.log(`    values:  ${vals.join(', ')}`);
      continue;
    }
    // Placeholders must run $1..$N with nothing missing and nothing beyond the
    // count — a gap binds the wrong value, an overshoot fails the bind outright.
    const nums = [...full.matchAll(/\$(\d+)/g)].map(x => Number(x[1]));
    if (nums.length) {
      const max = Math.max(...nums);
      const seen = new Set(nums);
      const missing = [];
      for (let i = 1; i <= max; i++) if (!seen.has(i)) missing.push(i);
      if (missing.length) {
        problems++;
        console.log(`\n  ${rel}:${line || '?'}  INSERT INTO ${table}`);
        console.log(`    placeholders run to $${max} but $${missing.join(', $')} never appear`);
      }
    }
  }
}

console.log(`\n${checked} literal INSERT statements checked, ${skipped} skipped (built by interpolation)`);
console.log(problems ? `${problems} problem(s)` : 'every column list matches its value list');
process.exit(problems ? 1 : 0);
