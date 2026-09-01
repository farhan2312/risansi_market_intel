#!/usr/bin/env node
// Opportunity 5092: a sale order recorded as one rupee.
//
//   node scripts/fix-opp-5092-sale-value.mjs           report only
//   node scripts/fix-opp-5092-sale-value.mjs --commit  write
//
// AHMEDNAGAR STEELS PVT LTD, quote RIL/QT/WI/2627/PCP/400, four ZLPRO pumps
// quoted at Rs 22,32,900. It is marked Won, and both its Sale Order Value and
// its sales order SO26/1/779 read 0.0000001 crore -- one rupee.
//
// WHY Rs 22,32,900 IS THE RIGHT NUMBER, rather than a guess:
//
//   * Across all 778 opportunities carrying a sales order, so_value_cr equals
//     final_value_cr 737 times. The two are kept in step by convention.
//   * SO26/1/779 was entered on 2026-08-29 in a batch of ten. In every OTHER
//     row of that batch the sale order value equals the quoted value to the
//     rupee -- 0.0000800, 0.0012126, 0.0015400 and so on, each matching its
//     opportunity exactly. This row is the only one that breaks the pattern.
//   * One rupee is not a plausible sale for four pumps.
//
// So the order was placed at the quoted value and the figure did not make it
// into the field. Both columns are set to 0.2232900 crore.
//
// The eight other opportunities with an implausibly small final value are NOT
// touched. Several have different and genuinely ambiguous shapes -- #4960's
// final is a tenth of its own sales order, five sit at almost exactly 1% of
// their quote -- and inventing numbers for those would be worse than leaving
// them visible. They are listed at the end for a human to decide.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COMMIT = process.argv.includes('--commit');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false } });
await c.connect();

const OPP = 5092;
const CORRECT = '0.2232900';          // crores — the quoted value, to the rupee
const rs = (cr) => 'Rs ' + Math.round(Number(cr) * 1e7).toLocaleString('en-IN');

const { rows: [before] } = await c.query(
  `SELECT o.id, c.code, c.legal_name, o.stage, o.quote_ref,
          o.value_cr::text AS quoted, o.final_value_cr::text AS final,
          (SELECT sum(so.so_value_cr)::text FROM opportunity_sales_orders so
            WHERE so.opportunity_id = o.id) AS so
     FROM opportunities o JOIN clients c ON c.id = o.client_id WHERE o.id = $1`, [OPP]);

if (!before) { console.log(`Opportunity ${OPP} not found.`); await c.end(); process.exit(1); }

console.log(`${before.code} — ${before.legal_name}`);
console.log(`  ${before.quote_ref} · ${before.stage}\n`);
console.log(`  quoted value      ${rs(before.quoted)}`);
console.log(`  sale order value  ${rs(before.final)}   <- one rupee`);
console.log(`  sales order       ${rs(before.so)}   <- one rupee`);
console.log(`\n  both should read  ${rs(CORRECT)}`);

if (Number(before.final) === Number(CORRECT)) {
  console.log('\nAlready corrected. Nothing to do.');
  await c.end(); process.exit(0);
}

if (COMMIT) {
  await c.query('BEGIN');
  // One transaction: the two columns are kept in step by convention, and leaving
  // half of this applied would produce an order-in-hand figure that is wrong in
  // a new way rather than the old one.
  await c.query('UPDATE opportunities SET final_value_cr = $2, updated_at = NOW() WHERE id = $1', [OPP, CORRECT]);
  await c.query(
    `UPDATE opportunity_sales_orders SET so_value_cr = $2 WHERE opportunity_id = $1 AND so_value_cr < 0.000001`,
    [OPP, CORRECT]);
  await c.query(
    `INSERT INTO assignment_audit (entity_type, entity_id, action, old_value, new_value, changed_by)
     VALUES ('opportunity', $1, 'correct_sale_value', $2::jsonb, $3::jsonb, 'script:fix-opp-5092-sale-value')`,
    [String(OPP),
     JSON.stringify({ final_value_cr: before.final, so_value_cr: before.so }),
     JSON.stringify({ final_value_cr: CORRECT, so_value_cr: CORRECT, basis: 'quoted value; every other SO in the same batch equals its quote' })],
  ).catch(() => {});   // the audit is a record, not a gate
  await c.query('COMMIT');

  const { rows: [after] } = await c.query(
    `SELECT o.final_value_cr::text AS final,
            (SELECT sum(so.so_value_cr)::text FROM opportunity_sales_orders so
              WHERE so.opportunity_id = o.id) AS so
       FROM opportunities o WHERE o.id = $1`, [OPP]);
  console.log(`\nDone. sale order value ${rs(after.final)} · sales order ${rs(after.so)}`);
} else {
  console.log('\nDry run. Re-run with --commit to apply.');
}

// ── the ones deliberately left alone ──────────────────────────────
const { rows: rest } = await c.query(`
  SELECT o.id, c.code, o.value_cr::text quoted, o.final_value_cr::text final,
         (SELECT sum(so.so_value_cr)::text FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id) so
    FROM opportunities o JOIN clients c ON c.id = o.client_id
   WHERE o.stage = 'Won' AND COALESCE(o.value_cr,0) > 0
     AND COALESCE(o.final_value_cr,0) < o.value_cr * 0.05 AND o.id <> $1
   ORDER BY o.value_cr DESC`, [OPP]);

if (rest.length) {
  console.log(`\n${rest.length} other Won opportunities have a sale order value under 5% of their quote.`);
  console.log('Not touched — the right number cannot be inferred for these:\n');
  for (const r of rest) {
    const pct = (Number(r.final) / Number(r.quoted) * 100).toFixed(1);
    console.log(`  #${String(r.id).padEnd(6)} ${r.code.padEnd(13)} quoted ${rs(r.quoted).padEnd(16)} final ${rs(r.final).padEnd(14)} SO ${rs(r.so).padEnd(14)} (${pct}% of quote)`);
  }
}

await c.end();
