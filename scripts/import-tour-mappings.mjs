// Import manager↔tour mappings from the filled Tour_Assignments_Template.xlsx
//   node scripts/import-tour-mappings.mjs            → DRY RUN (report only)
//   node scripts/import-tour-mappings.mjs --apply    → write to tour_assignments
//
// Sheet "Tour Assignments": Zone | Tour | # Clients | Manager 1 Email | Manager 2 Email | Manager 3 Email
// Each non-blank manager email → tour_assignments(tour_id, rep_id=users.id, role='manager').
// Idempotent on (tour_id, rep_id).

import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');
const XLSX_PATH = 'C:/Users/Cosmos/Downloads/Tour_Assignments_Template.xlsx';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets['Tour Assignments'] || wb.Sheets[wb.SheetNames.find(n => /tour/i.test(n))];
  if (!ws) throw new Error('No "Tour Assignments" sheet found. Sheets: ' + wb.SheetNames.join(', '));
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const header = rows[0].map(h => String(h).trim());
  console.log('header:', JSON.stringify(header));

  const tourCol = header.findIndex(h => /^tour$/i.test(h));
  const mgrCols = header.map((h, i) => /manager/i.test(h) && /email/i.test(h) ? i : -1).filter(i => i >= 0);
  if (tourCol < 0 || mgrCols.length === 0) throw new Error('Could not locate Tour / Manager Email columns');

  // Lookups
  const { rows: tours } = await client.query('SELECT id, name FROM tour_routes');
  const tourByName = new Map(tours.map(t => [t.name.trim().toLowerCase(), t.id]));
  const { rows: users } = await client.query("SELECT id, lower(email) AS email, role FROM users");
  const userByEmail = new Map(users.map(u => [u.email, { id: u.id, role: u.role }]));

  const pairs = [];          // {tourId, userId, tourName, email, role}
  const problems = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const tourName = String(row[tourCol] ?? '').trim();
    if (!tourName) continue;
    const tourId = tourByName.get(tourName.toLowerCase());
    if (!tourId) { problems.push(`row ${r + 1}: tour "${tourName}" not found`); continue; }
    for (const c of mgrCols) {
      const email = String(row[c] ?? '').trim().toLowerCase();
      if (!email) continue;
      const u = userByEmail.get(email);
      if (!u) { problems.push(`row ${r + 1} (${tourName}): email "${email}" not a known user`); continue; }
      pairs.push({ tourId, userId: u.id, tourName, email, role: u.role });
    }
  }

  // De-dupe
  const seen = new Set();
  const uniq = pairs.filter(p => { const k = p.tourId + '|' + p.userId; if (seen.has(k)) return false; seen.add(k); return true; });

  console.log('\n=== MAPPINGS FOUND ===');
  for (const p of uniq) console.log(`  ${p.tourName.padEnd(24)} ← ${p.email} (${p.role})`);
  console.log(`\ntotal mappings: ${uniq.length} · distinct tours: ${new Set(uniq.map(p => p.tourId)).size} · distinct managers: ${new Set(uniq.map(p => p.userId)).size}`);
  const nonMgr = uniq.filter(p => p.role !== 'manager');
  if (nonMgr.length) console.log('NOTE: emails that are not role=manager:', JSON.stringify(nonMgr.map(p => p.email)));
  if (problems.length) { console.log('\n=== PROBLEMS ==='); problems.forEach(p => console.log('  ' + p)); }

  if (!APPLY) { console.log('\nDRY RUN — no changes. Re-run with --apply to write.'); return; }

  let inserted = 0, existed = 0;
  for (const p of uniq) {
    const res = await client.query(
      `INSERT INTO tour_assignments (tour_id, rep_id, role, assigned_by, assigned_at)
       VALUES ($1, $2, 'manager', 'import:tour-template', NOW())
       ON CONFLICT (tour_id, rep_id) DO UPDATE SET role = 'manager'
       RETURNING (xmax = 0) AS inserted`,
      [p.tourId, p.userId],
    );
    if (res.rows[0]?.inserted) inserted++; else existed++;
  }
  console.log(`\napplied: ${inserted} new, ${existed} already existed (role ensured 'manager')`);
  const { rows: [c] } = await client.query('SELECT COUNT(*)::int n FROM tour_assignments');
  console.log('tour_assignments rows now:', c.n);
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1; }).finally(() => client.end());
