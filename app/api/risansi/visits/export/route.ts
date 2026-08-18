import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

// Tour / visit-plan summary for a date range, for one rep or all of them.
//
// The print view at /print/planned-visits answers a different question — a route
// plan to carry — and takes only from/to/rep. This one answers "how did the
// period go": per-rep and per-tour rollups over the same rows the Field Activity
// page is showing, with the underlying visits behind them, so a number can
// always be traced to the visits that produced it.

const NAVY = 'FF0A3D8F';
const GREY = 'FF64748B';

const txt = (v: unknown) => (v == null ? '' : String(v));
const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
const iso = (v: unknown): string =>
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

interface VisitRow {
  id: number; visit_date: string; status: string; purpose: string | null;
  is_planned: boolean | null; is_unplanned: boolean | null;
  check_in_time: string | null; check_out_time: string | null;
  gps_within_radius: boolean | null; manual_checkin: boolean | null;
  outcome: string | null; summary: string | null;
  follow_up_required: boolean | null; follow_up_text: string | null;
  follow_up_due_date: string | null; submitted_at: string | null;
  rep_id: number | null; rep_name: string | null;
  client_id: number; client_code: string | null; client_name: string;
  city: string | null; state: string | null; industry: string | null;
  tour_id: number | null; tour_name: string | null; zone: string | null;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const sp = new URL(req.url).searchParams;

  // Defaults to the current calendar month, matching the PDF export's default.
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const asIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = iso(sp.get('from')) || asIso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to   = iso(sp.get('to'))   || asIso(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const repRaw  = sp.get('rep') ?? '';
  const repId   = /^\d+$/.test(repRaw) ? Number(repRaw) : null;
  const purpose = (sp.get('purpose') ?? '').trim();
  const search  = (sp.get('search') ?? '').trim();
  const status  = (sp.get('status') ?? '').trim();

  const where: string[] = ['v.visit_date BETWEEN $1 AND $2'];
  const vals: unknown[] = [from, to];
  const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };

  if (repId != null) add('v.rep_id = ?', repId);
  if (purpose)       add('v.purpose = ?', purpose);
  if (status)        add('v.status = ?', status);
  if (search) {
    // One placeholder used twice, so it is spelled out rather than run through
    // add() — that helper substitutes a single '?' and would leave the second.
    vals.push(`%${search}%`);
    where.push(`(c.legal_name ILIKE $${vals.length} OR c.code ILIKE $${vals.length})`);
  }

  // Tour-based visibility, exactly as the page applies it — an export must never
  // show a row the page would have withheld.
  const scope = clientScopeSql(user, 'v.client_id');
  if (scope) where.push(scope);

  const { rows } = await risansiPool.query<VisitRow>(
    `SELECT v.id, v.visit_date::text AS visit_date, v.status, v.purpose,
            v.is_planned, v.is_unplanned,
            v.check_in_time::text AS check_in_time, v.check_out_time::text AS check_out_time,
            v.gps_within_radius, v.manual_checkin,
            v.outcome, v.summary, v.follow_up_required, v.follow_up_text,
            v.follow_up_due_date::text AS follow_up_due_date,
            v.submitted_at::text AS submitted_at,
            v.rep_id, u.name AS rep_name,
            v.client_id, c.code AS client_code, c.legal_name AS client_name,
            c.city, c.state, c.industry,
            c.tour_id, tr.name AS tour_name, tr.zone
       FROM visits v
       JOIN clients c ON c.id = v.client_id
       LEFT JOIN users u ON u.id = v.rep_id
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
      WHERE ${where.join(' AND ')}
      ORDER BY v.visit_date, u.name NULLS LAST, c.legal_name`,
    vals as never[],
  );

  const todayIso = asIso(new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })));

  // One visit is counted once, under exactly one outcome. 'planned' in the past
  // is a MISS — the plan was made and the day went by — while 'planned' ahead of
  // today is simply still upcoming, and lumping the two would make every future
  // plan look like a failure.
  interface Tally {
    key: string; label: string; extra: string;
    total: number; completed: number; checkedIn: number; missed: number; upcoming: number;
    unplanned: number; gpsOk: number; manual: number; followUps: number;
    clients: Set<number>; tours: Set<string>; reps: Set<string>;
  }
  const blank = (key: string, label: string, extra = ''): Tally => ({
    key, label, extra,
    total: 0, completed: 0, checkedIn: 0, missed: 0, upcoming: 0,
    unplanned: 0, gpsOk: 0, manual: 0, followUps: 0,
    clients: new Set(), tours: new Set(), reps: new Set(),
  });

  const tally = (t: Tally, v: VisitRow) => {
    t.total++;
    if (v.status === 'completed') t.completed++;
    else if (v.status === 'checked-in') t.checkedIn++;
    else if (v.visit_date < todayIso) t.missed++;
    else t.upcoming++;
    if (v.is_unplanned) t.unplanned++;
    if (v.gps_within_radius) t.gpsOk++;
    if (v.manual_checkin) t.manual++;
    if (v.follow_up_required) t.followUps++;
    t.clients.add(v.client_id);
    if (v.tour_name) t.tours.add(v.tour_name);
    if (v.rep_name) t.reps.add(v.rep_name);
  };

  const byRep = new Map<string, Tally>();
  const byTour = new Map<string, Tally>();
  for (const v of rows) {
    const rk = txt(v.rep_id) || 'none';
    if (!byRep.has(rk)) byRep.set(rk, blank(rk, v.rep_name ?? 'Unassigned'));
    tally(byRep.get(rk)!, v);

    const tk = txt(v.tour_id) || 'none';
    if (!byTour.has(tk)) byTour.set(tk, blank(tk, v.tour_name ?? 'No tour', v.zone ?? ''));
    tally(byTour.get(tk)!, v);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';

  const pct = (n: number, d: number) => (d > 0 ? n / d : 0);

  interface Col { h: string; w: number; f: (t: Tally) => string | number; fmt?: string }
  const ROLLUP = (firstHeader: string, firstWidth: number, extraHeader?: string): Col[] => [
    { h: firstHeader, w: firstWidth, f: t => t.label },
    ...(extraHeader ? [{ h: extraHeader, w: 14, f: (t: Tally) => t.extra }] : []),
    { h: 'Visits', w: 9, f: t => t.total },
    { h: 'Completed', w: 11, f: t => t.completed },
    { h: 'In progress', w: 12, f: t => t.checkedIn },
    { h: 'Missed', w: 9, f: t => t.missed },
    { h: 'Upcoming', w: 11, f: t => t.upcoming },
    { h: 'Completion %', w: 13, f: t => pct(t.completed, t.completed + t.missed + t.checkedIn), fmt: '0%' },
    { h: 'Unplanned', w: 11, f: t => t.unplanned },
    { h: 'Clients covered', w: 15, f: t => t.clients.size },
    { h: 'Tours worked', w: 13, f: t => t.tours.size },
    { h: 'GPS verified', w: 13, f: t => t.gpsOk },
    { h: 'Manual check-in', w: 15, f: t => t.manual },
    { h: 'Follow-ups raised', w: 16, f: t => t.followUps },
  ];

  const header = (ws: ExcelJS.Worksheet, cols: { h: string; w: number }[], titleText: string, subText: string, withLogo: boolean) => {
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
    if (withLogo) {
      try {
        const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
        ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
      } catch { /* logo missing — export still works */ }
      ws.getRow(1).height = 26;
      ws.getRow(2).height = 16;
    }
    const t = ws.getCell(withLogo ? 'C1' : 'A1');
    t.value = titleText;
    t.font = { size: 13, bold: true, color: { argb: NAVY } };
    const s = ws.getCell(withLogo ? 'C2' : 'A2');
    s.value = subText;
    s.font = { size: 10, color: { argb: GREY } };
    const hdr = ws.getRow(3);
    cols.forEach((c, i) => {
      const cell = hdr.getCell(i + 1);
      cell.value = c.h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    hdr.height = 26;
  };

  const rollupSheet = (name: string, cols: Col[], data: Tally[], subText: string, withLogo: boolean) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
    header(ws, cols, `Tour summary — ${name}`, subText, withLogo);
    const sorted = [...data].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    sorted.forEach((t, ri) => {
      const row = ws.getRow(4 + ri);
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = c.f(t);
        if (c.fmt) cell.numFmt = c.fmt;
      });
    });
    // Totals band. Recomputed from the visits, not summed from the rows above:
    // a visit on two tours would be double counted by a column sum, and the
    // distinct client/tour counts cannot be summed at all.
    const all = blank('all', 'TOTAL');
    rows.forEach(v => tally(all, v));
    const tr = ws.getRow(4 + sorted.length + 1);
    cols.forEach((c, i) => {
      const cell = tr.getCell(i + 1);
      cell.value = i === 0 ? 'TOTAL' : (i === 1 && cols[1].h === 'Zone' ? '' : c.f(all));
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin', color: { argb: NAVY } } };
      if (c.fmt) cell.numFmt = c.fmt;
    });
    if (!sorted.length) {
      const cell = ws.getRow(4).getCell(1);
      cell.value = 'No visits fall in this range with these filters.';
      cell.font = { italic: true, color: { argb: GREY }, size: 10 };
    }
  };

  const scopeLabel = repId != null
    ? (rows.find(r => r.rep_id === repId)?.rep_name ?? `Rep #${repId}`)
    : 'All reps';
  const sub = `${from} to ${to} · ${scopeLabel} · ${rows.length.toLocaleString('en-IN')} visit${rows.length === 1 ? '' : 's'} · exported ${stamp}`;

  rollupSheet('By Rep',  ROLLUP('Rep', 26),                 [...byRep.values()],  sub, true);
  rollupSheet('By Tour', ROLLUP('Tour', 30, 'Zone'),        [...byTour.values()], sub, false);

  // ── Visit detail ──────────────────────────────────────────────

  const DETAIL: { h: string; w: number; f: (v: VisitRow) => string | number }[] = [
    { h: 'Date', w: 12, f: v => day(v.visit_date) },
    { h: 'Rep', w: 22, f: v => txt(v.rep_name) },
    { h: 'Client', w: 34, f: v => txt(v.client_name) },
    { h: 'Client Code', w: 14, f: v => txt(v.client_code) },
    { h: 'Tour', w: 26, f: v => txt(v.tour_name) },
    { h: 'Zone', w: 12, f: v => txt(v.zone) },
    { h: 'City', w: 16, f: v => txt(v.city) },
    { h: 'State', w: 16, f: v => txt(v.state) },
    { h: 'Industry', w: 16, f: v => txt(v.industry) },
    { h: 'Purpose', w: 20, f: v => txt(v.purpose) },
    { h: 'Status', w: 12, f: v =>
      v.status === 'planned' && v.visit_date < todayIso ? 'missed' : txt(v.status) },
    { h: 'Planned?', w: 10, f: v => (v.is_unplanned ? 'Unplanned' : v.is_planned ? 'Planned' : '') },
    { h: 'Check-in', w: 17, f: v => txt(v.check_in_time).slice(0, 16).replace('T', ' ') },
    { h: 'Check-out', w: 17, f: v => txt(v.check_out_time).slice(0, 16).replace('T', ' ') },
    { h: 'GPS verified', w: 12, f: v => (v.gps_within_radius ? 'Yes' : v.check_in_time ? 'No' : '') },
    { h: 'Manual check-in', w: 14, f: v => (v.manual_checkin ? 'Yes' : '') },
    { h: 'Outcome', w: 24, f: v => txt(v.outcome) },
    { h: 'Summary', w: 60, f: v => txt(v.summary) },
    { h: 'Follow-up', w: 40, f: v => (v.follow_up_required ? txt(v.follow_up_text) || 'Yes' : '') },
    { h: 'Follow-up Due', w: 14, f: v => day(v.follow_up_due_date) },
    { h: 'Submitted', w: 12, f: v => day(v.submitted_at) },
  ];

  const det = wb.addWorksheet('Visits', { views: [{ state: 'frozen', ySplit: 3, xSplit: 3 }] });
  header(det, DETAIL, 'Tour summary — visit detail', sub, false);
  rows.forEach((v, ri) => {
    const row = det.getRow(4 + ri);
    DETAIL.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.f(v);
      cell.alignment = { vertical: 'top', wrapText: i >= 16 };
    });
  });
  if (rows.length) det.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: DETAIL.length } };
  else {
    const cell = det.getRow(4).getCell(1);
    cell.value = 'No visits fall in this range with these filters.';
    cell.font = { italic: true, color: { argb: GREY }, size: 10 };
  }

  // ── What produced this file ───────────────────────────────────

  const fws = wb.addWorksheet('Filters Applied');
  fws.getColumn(1).width = 26; fws.getColumn(2).width = 60;
  fws.getCell('A1').value = 'Filters applied to this export';
  fws.getCell('A1').font = { size: 12, bold: true, color: { argb: NAVY } };
  fws.getCell('A2').value = 'Reproduce this file by setting the same filters on Field Activity.';
  fws.getCell('A2').font = { size: 10, color: { argb: GREY } };
  const applied: [string, string][] = [
    ['Date from', from],
    ['Date to', to],
    ['Rep', scopeLabel],
    ['Purpose', purpose || 'All purposes'],
    ['Status', status || 'All statuses'],
    ['Client search', search || '(none)'],
    ['Visibility', clientScopeSql(user, 'v.client_id') ? 'Limited to your tours and special-access clients' : 'All clients (admin)'],
    ['Visits matched', String(rows.length)],
    ['Exported by', txt(user.email)],
    ['Exported on', stamp],
    ['"Missed" means', `a visit still marked planned whose date is before ${todayIso}`],
  ];
  applied.forEach(([k, v], i) => {
    const row = fws.getRow(4 + i);
    row.getCell(1).value = k; row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).value = v; row.getCell(2).alignment = { wrapText: true };
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const who = repId != null ? scopeLabel.replace(/[^\w.\-]/g, '_').slice(0, 30) : 'all-reps';
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="tour-summary-${who}-${from}-to-${to}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
