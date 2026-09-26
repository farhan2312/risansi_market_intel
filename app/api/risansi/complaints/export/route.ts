import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { loadComplaintRows, parseComplaintFilters, parseComplaintSort, FILTER_KEYS, type ComplaintListRow } from '@/lib/risansi-complaint-rows';
import { PAGES, SEVERITY_LABEL, type ComplaintField, type Severity } from '@/lib/risansi-complaint-flow';

export const runtime = 'nodejs';

// The complaints table, as a sheet — with every field the complaint form asks.
//
//   GET /api/risansi/complaints/export?<the list page's search params>
//
// Same rows as the page: loadComplaintRows applies the viewer's scope and the
// same filters, including the bars clicked on the dashboard. The columns come
// in two parts: the record's identity and where it stands (number, client,
// status, severity, who holds it, ages), then every field of the eight pages
// in the order the form shows them, labelled "<page>: <field>". The columns
// are read from the same catalogue the forms render from, so a field added
// to the form is in the export the same day.

type Cell = string | number | Date | null;
const dateOf = (s: unknown) => (s ? new Date(String(s).slice(0, 10)) : null);
const isOpen = (s: string) => s !== 'Resolved' && s !== 'Closed';
const NAVY = 'FF0A3D8F';

interface Col { key: string; label: string; width: number; get: (r: ComplaintListRow, full: Record<string, unknown>, names: Map<number, string>) => Cell; group: string }

const HEAD_COLS: Col[] = [
  { key: 'complaint_no', label: 'Complaint no.', width: 14, group: 'Record', get: r => r.complaint_no },
  { key: 'legacy_ref', label: 'Legacy ref', width: 10, group: 'Record', get: r => r.legacy_ref },
  { key: 'client_code', label: 'Client code', width: 14, group: 'Record', get: r => r.client_code },
  { key: 'client_name', label: 'Client', width: 34, group: 'Record', get: r => r.client_name },
  { key: 'rep', label: 'Rep', width: 18, group: 'Record', get: r => r.rep_name },
  { key: 'status', label: 'Status', width: 26, group: 'Where it stands', get: r => r.status },
  { key: 'severity', label: 'Severity', width: 14, group: 'Where it stands', get: r => (r.severity ? SEVERITY_LABEL[r.severity as Severity] : null) },
  { key: 'holder', label: 'Sitting with', width: 24, group: 'Where it stands', get: r => (!isOpen(r.status) || r.schema_version < 2) ? null : (r.holder_name ? `${r.holder_name} · ${r.holder_department}` : r.holder_department) },
  { key: 'since', label: 'In this status since', width: 14, group: 'Where it stands', get: r => (isOpen(r.status) && r.schema_version >= 2 ? dateOf(r.since) : null) },
  { key: 'days_in_status', label: 'Days in status', width: 11, group: 'Where it stands', get: r => (isOpen(r.status) ? Math.round(r.days_in_status * 10) / 10 : null) },
  { key: 'age_days', label: 'Age (days)', width: 10, group: 'Where it stands', get: r => Math.round(r.age_days * 10) / 10 },
  { key: 'overdue', label: 'Overdue', width: 9, group: 'Where it stands', get: r => (r.overdue ? 'Yes' : '') },
  { key: 'resolved_at', label: 'Resolved on', width: 12, group: 'Where it stands', get: r => dateOf(r.resolved_at) },
  { key: 'closed_at', label: 'Closed on', width: 12, group: 'Where it stands', get: r => dateOf(r.closed_at) },
  { key: 'reopen_count', label: 'Reopened (times)', width: 10, group: 'Where it stands', get: r => r.reopen_count || null },
  { key: 'raised_by', label: 'Raised by', width: 18, group: 'Record', get: (_r, full, names) => (full.reported_by_user ? names.get(Number(full.reported_by_user)) ?? null : (full.reported_by_raw as string | null) ?? null) },
  { key: 'created_at', label: 'Registered on', width: 12, group: 'Record', get: r => dateOf(r.created_at) },
];

/** One column per form field, valued the way the form shows it. */
/** OEM id → legal name, filled per request before the columns are built. */
const oemNames = new Map<number, string>();

function fieldCol(pageTitle: string, f: ComplaintField): Col {
  const width = f.type === 'long' ? 50 : f.type === 'date' ? 12 : f.type === 'bool' || f.type === 'yesno4' || f.type === 'paid' ? 10 : f.type === 'money' || f.type === 'number' ? 14 : f.type === 'user' ? 18 : 20;
  return {
    key: f.name, label: f.label, width, group: pageTitle,
    get: (_r, full, names) => {
      const v = full[f.name];
      if (v == null || v === '') return null;
      switch (f.type) {
        case 'date': return dateOf(v);
        case 'money': case 'number': return Number(v);
        case 'bool': return v === true || v === 't' ? 'Yes' : v === false || v === 'f' ? 'No' : String(v);
        case 'user': return names.get(Number(v)) ?? String(v);
        case 'oem': return oemNames.get(Number(v)) ?? `OEM #${v}`;
        default: return String(v);
      }
    },
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const sp: Record<string, string> = {};
  for (const k of url.searchParams.keys()) sp[k] = url.searchParams.get(k) ?? '';
  const filters = parseComplaintFilters(sp);
  const rows = await loadComplaintRows(user, { filters, sort: parseComplaintSort(sp) });
  const applied = FILTER_KEYS.filter(k => filters[k]).map(k => `${k}: ${filters[k]}`);

  // The full record for each row the viewer may see, and the names behind
  // every user-typed field.
  const ids = rows.map(r => r.id);
  const [{ rows: fullRows }, { rows: userRows }] = await Promise.all([
    ids.length ? risansiPool.query<Record<string, unknown> & { id: number }>('SELECT * FROM complaints WHERE id = ANY($1::int[])', [ids]) : Promise.resolve({ rows: [] as (Record<string, unknown> & { id: number })[] }),
    risansiPool.query<{ id: number; name: string }>('SELECT id, name FROM users'),
  ]);
  const full = new Map(fullRows.map(r => [r.id, r]));
  const names = new Map(userRows.map(u => [u.id, u.name]));

  const cols: Col[] = [...HEAD_COLS];
  oemNames.clear();
  for (const o of (await risansiPool.query<{ id: number; legal_name: string }>(
    `SELECT id, legal_name FROM clients WHERE client_type = 'OEM' AND deleted_at IS NULL`)).rows) {
    oemNames.set(o.id, o.legal_name);
  }
  for (const p of PAGES) for (const f of p.fields) cols.push(fieldCol(`${p.id}. ${p.title}`, f));

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';
  const ws = wb.addWorksheet('Complaints', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }] });
  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo optional */ }
  ws.getRow(1).height = 26; ws.getRow(2).height = 16; ws.getRow(3).height = 6;
  const title = ws.getCell('C1'); title.value = 'Complaints — every field of the form';
  title.font = { size: 14, bold: true, color: { argb: NAVY } };
  const sub = ws.getCell('C2');
  sub.value = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${applied.length ? applied.join(' · ') : 'no filters'} · ${stamp}`;
  sub.font = { size: 10, color: { argb: 'FF64748B' } };

  // Row 4 names the page each run of columns belongs to; row 5 is the header.
  const GROUP = 4, HEAD = 5;
  let start = 1;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i].group !== cols[start - 1].group) {
      const cell = ws.getCell(GROUP, start);
      cell.value = cols[start - 1].group;
      cell.font = { bold: true, color: { argb: NAVY }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF8' } };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      if (i > start) ws.mergeCells(GROUP, start, GROUP, i);
      start = i + 1;
    }
  }
  ws.getRow(GROUP).height = 18;
  cols.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width;
  });
  ws.getRow(HEAD).height = 30;
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: cols.length } };

  rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    const f = full.get(r.id) ?? {};
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = c.get(r, f, names);
      cell.value = v;
      if (v instanceof Date) cell.numFmt = 'dd-mmm-yyyy';
      else if (typeof v === 'number') cell.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.0';
      if (typeof v === 'string' && v.length > 60) cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="complaints-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
