#!/usr/bin/env node
// Phase 4: what changes for each person the moment the new rule goes live.
//
//   node scripts/rep-ownership-diff.mjs
//
// Read-only. Compares the tour rule still in force against the ownership rule
// about to replace it, per user, and then finds the thing that actually matters:
// open work whose owner would stop being able to see it.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false } });

// The rule in force today.
const OLD = `
  SELECT c.id FROM clients c
   WHERE c.deleted_at IS NULL
     AND (c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $1)
          OR c.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = $1))`;

// The rule replacing it: own it, cover it, or manage someone who does.
const NEW = `
  SELECT c.id FROM clients c
   WHERE c.deleted_at IS NULL
     AND (c.primary_rep_id = $1
          OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $1)
          OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1)
          OR c.id IN (SELECT client_id FROM client_secondary_reps
                       WHERE rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1))
          OR c.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = $1))`;

const main = async () => {
  await c.connect();
  const q = async (s, a) => (await c.query(s, a)).rows;
  const people = await q(
    `SELECT id, name, role FROM users
      WHERE is_active AND role IN ('rep','manager') ORDER BY role, name`);

  console.log('ACCESS DIFF — the tour rule against the ownership rule\n');
  console.log('  person                   role      before   after   gained   lost');
  console.log('  ' + '-'.repeat(66));

  const losers = [];
  let totalBefore = 0, totalAfter = 0;
  for (const p of people) {
    const before = new Set((await q(OLD, [p.id])).map(r => r.id));
    const after  = new Set((await q(NEW, [p.id])).map(r => r.id));
    const gained = [...after].filter(x => !before.has(x));
    const lost   = [...before].filter(x => !after.has(x));
    totalBefore += before.size; totalAfter += after.size;
    console.log(`  ${p.name.padEnd(24)} ${p.role.padEnd(9)} ${String(before.size).padStart(6)} ${String(after.size).padStart(7)} ${String('+' + gained.length).padStart(8)} ${String('-' + lost.length).padStart(6)}`);
    if (lost.length) losers.push({ p, lost });
  }
  console.log('  ' + '-'.repeat(66));
  console.log(`  ${'TOTAL (with double-counting)'.padEnd(34)} ${String(totalBefore).padStart(6)} ${String(totalAfter).padStart(7)}`);

  // ── the part that matters ────────────────────────────────────
  console.log('\n\nOPEN WORK THAT WOULD LEAVE SOMEONE\'S VIEW\n');
  let anything = false;
  for (const { p, lost } of losers) {
    const rows = await q(
      `SELECT 'opportunity' AS kind, o.id::text, o.stage AS state, cl.code, left(cl.legal_name,30) AS client
         FROM opportunities o JOIN clients cl ON cl.id = o.client_id
        WHERE o.client_id = ANY($1) AND o.rep_id = $2
          AND o.stage NOT IN ('Won','Lost','Dropped')
       UNION ALL
       SELECT 'visit', v.id::text, v.status, cl.code, left(cl.legal_name,30)
         FROM visits v JOIN clients cl ON cl.id = v.client_id
        WHERE v.client_id = ANY($1) AND v.rep_id = $2 AND v.status <> 'completed'
       UNION ALL
       SELECT 'action', t.id::text, t.status, cl.code, left(cl.legal_name,30)
         FROM tasks t JOIN clients cl ON cl.id = t.client_id
        WHERE t.client_id = ANY($1) AND t.assigned_to_rep = $2 AND t.status <> 'completed'
       ORDER BY 1, 4`,
      [lost, p.id]);
    if (!rows.length) continue;
    anything = true;
    console.log(`  ${p.name} (${p.role}) — ${rows.length} record(s) on ${lost.length} client(s) they lose sight of:`);
    for (const r of rows.slice(0, 12))
      console.log(`      ${r.kind.padEnd(12)} #${String(r.id).padEnd(6)} ${String(r.state).padEnd(12)} ${r.code.padEnd(13)} ${r.client}`);
    if (rows.length > 12) console.log(`      … and ${rows.length - 12} more`);
    console.log('');
  }
  if (!anything) console.log('  None. No open opportunity, visit or action item changes hands.\n');

  // ── clients nobody can reach ─────────────────────────────────
  console.log('\nCLIENTS NO REP OR MANAGER COULD SEE AFTER THE SWITCH\n');
  const orphan = await q(
    `SELECT c.id, c.code, left(c.legal_name,34) AS client, c.status,
            (SELECT count(*)::int FROM opportunities o WHERE o.client_id = c.id) AS opps,
            (SELECT count(*)::int FROM visits v WHERE v.client_id = c.id) AS visits
       FROM clients c
      WHERE c.deleted_at IS NULL AND c.primary_rep_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM client_rep_access a WHERE a.client_id = c.id)
      ORDER BY 5 DESC, 6 DESC, c.code`);
  console.log(`  ${orphan.length} client(s), of which ${orphan.filter(o => o.opps || o.visits).length} carry history:\n`);
  for (const o of orphan.filter(x => x.opps || x.visits))
    console.log(`      ${o.code.padEnd(13)} ${o.client.padEnd(35)} ${String(o.status).padEnd(19)} ${o.opps} opps · ${o.visits} visits`);
  const quiet = orphan.filter(x => !x.opps && !x.visits);
  console.log(`\n      plus ${quiet.length} with no history at all`);
  console.log('\n  These are the Unassigned tab. Admins keep full access throughout.');
  await c.end();
};

main().catch(async (e) => { console.error('FAILED:', e.message); try { await c.end(); } catch {} process.exit(1); });
