#!/usr/bin/env node
// Every action that returns a refusal must have its refusal read.
//
//   node scripts/action-result-check.mjs      (runs as part of `npm run build`)
//
// Converting an action from `throw` to `return { ok: false }` is only half the
// job. TypeScript is perfectly happy with a caller that ignores the return
// value, so a forgotten call site turns a refusal into a silent success — the
// save appears to work and nothing was written. That is worse than the redacted
// error this whole change exists to remove.
//
// So: find the actions whose return type is a result, find their callers, and
// insist each one looks at `.ok`.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const files = [];
for (const d of ['app', 'components', 'lib']) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) files.push(full);
    }
  })(abs);
}

// Exported async functions whose declared return type is one of the result
// shapes. Read from the source so adding another one needs no edit here.
const RESULT_TYPES = /Promise<\s*(SaveResult|CreateResult|Result(<[^>]*>)?)\s*>/;
const actions = new Map();                       // name -> declaring file
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/export async function (\w+)\s*\([^)]*\)\s*:\s*([^{]+)\{/gs)) {
    if (RESULT_TYPES.test(m[2])) actions.set(m[1], path.relative(ROOT, file).replace(/\\/g, '/'));
  }
}

let problems = 0, checked = 0;
console.log(`${actions.size} action(s) return a result: ${[...actions.keys()].join(', ')}\n`);

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = src.split('\n');

  for (const [name] of actions) {
    // Call sites, excluding the declaration itself and import lines.
    const re = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, 'g');
    for (const m of src.matchAll(re)) {
      const at = m.index;
      const lineNo = src.slice(0, at).split('\n').length;
      const line = lines[lineNo - 1];
      if (/^\s*(import|export async function|\*|\/\/)/.test(line)) continue;
      if (line.includes('from \'@/app/actions')) continue;
      checked++;

      // The result has to be captured and inspected. Accept either an assignment
      // whose variable is later tested for .ok, or an inline `.ok` test.
      const assigned = line.match(/(?:const|let)\s+(\w+)\s*=\s*await\s/);
      const window = lines.slice(lineNo - 1, lineNo + 6).join('\n');
      const readsOk = assigned
        ? new RegExp(`${assigned[1]}\\.ok`).test(window)
        : /\.ok\b/.test(window);

      if (!readsOk) {
        problems++;
        console.log(`  ${rel}:${lineNo}`);
        console.log(`    calls ${name}() and never looks at .ok — a refusal here is silent`);
        console.log(`    ${line.trim()}`);
      }
    }
  }
}

console.log(`\n${checked} call site(s) checked`);
console.log(problems ? `${problems} ignore a refusal` : 'every call site reads its result');
process.exit(problems ? 1 : 0);
