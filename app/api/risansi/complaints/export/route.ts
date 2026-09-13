import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { getCurrentUser } from '@/lib/risansi-auth';
import { loadComplaintRows, parseComplaintFilters, FILTER_KEYS, type ComplaintListRow } from '@/lib/risansi-complaint-rows';

export const runtime = 'nodejs';

// The complaints table, as a sheet.
//
//   GET /api/risansi/complaints/export?<the list page's search params>
//
// Same rows as the page: loadComplaintRows applies the viewer's scope and the
// same filters, including the bars clicked on the dashboard, so what comes
// down is what was on screen.

type Cell = string | number | Date | null;
const dateOf = (s: string | null) => (s ? new Date(s.slice(0, 10)) : null);

const COLS: { key: string; label: string; width: number; get: (r: ComplaintListRow) => Cell }[] = [
  { key: 'complaint_no', label: 'Complaint no.', width: 14, get: r => r.complaint_no },
  { key: 'legacy_ref', label: 'Legacy ref', width: 12, get: r => r.legacy_ref },
  { key: 'client_code', label: 'Client code', width: 14, get: r => r.client_code },
  { key: 'client_name', label: 'Client', width: 32, get: r => r.client_name },
  { key: 'status', label: 'Status', width: 26, get: r => r.status },
  { key: 'severity', label: 'Severity', width: 9, get: r => r.severity },
  { key: 'complaint_type', label: 'Type', width: 14, get: r => r.complaint_type },
  { key: 'defect_category', label: 'Defect category', width: 20, get: r => r.defect_category },
  { key: 'defect_reason', label: 'Defect reason', width: 20, get: r => r.defect_reason },
  { key: 'responsible_department', label: 'Responsible dept', width: 18, get: r => r.responsible_department },
  { key: 'holder', label: 'Sitting with', width: 22, get: r => (r.status === 'Resolved' || r.status === 'Closed' || r.schema_version < 2) ? null : (r.holder_name ? `${r.holder_name} · ${r.holder_department}` : r.holder_department) },
  { key: 'days_in_status', label: 'Days in status', width: 12, get: r => (r.status === 'Resolved' || r.status === 'Closed') ? null : Math.round(r.days_in_status * 10) / 10 },
  { key: 'age_days', label: 'Age (days)', width: 11, get: r => Math.round(r.age_days * 10) / 10 },
  { key: 'target', label: 'Target completion', width: 14, get: r => dateOf(r.target_completion_date) },
  { key: 'overdue', label: 'Overdue', width: 9, get: r => (r.overdue ? 'Yes' : '') },
  { key: 'rep', label: 'Rep', width: 18, get: r => r.rep_name },
  { key: 'complaint_date', label: 'Raised', width: 12, get: r => dateOf(r.complaint_date ?? r.created_at) },
  { key: 'resolved_at', label: 'Resolved', width: 12, get: r => dateOf(r.resolved_at) },
  { key: 'closed_at', label: 'Closed', width: 12, get: r => dateOf(r.closed_at) },
  { key: 'channel', label: 'Source', width: 12, get: r => r.channel },
  { key: 'pump_model', label: 'Pump model', width: 16, get: r => r.pump_model },
  { key: 'pump_serial_no', label: 'Serial no.', width: 14, get: r => r.pump_serial_no },
  { key: 'contact_person', label: 'Contact', width: 18, get: r => r.contact_person },
  { key: 'repeat', label: 'Repeat', width: 8, get: r => (r.repeat_complaint ? 'Yes' : r.repeat_complaint === false ? 'No' : '') },
  { key: 'reopen_count', label: 'Reopened', width: 9, get: r => r.reopen_count || null },
  { key: 'details', label: 'Description', width: 60, get: r => r.details },
];

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const sp: Record<string, string> = {};
  for (const k of url.searchParams.keys()) sp[k] = url.searchParams.get(k) ?? '';
  const filters = parseComplaintFilters(sp);
  const rows = await loadComplaintRows(user, { filters });
  const applied = FILTER_KEYS.filter(k => filters[k]).map(k => `${k}: ${filters[k]}`);

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Complaints', { views: [{ state: 'frozen', ySplit: 4 }] });
  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo optional */ }
  ws.getRow(1).height = 26; ws.getRow(2).height = 16; ws.getRow(3).height = 6;
  const title = ws.getCell('C1'); title.value = 'Complaints';
  title.font = { size: 14, bold: true, color: { argb: 'FF0A3D8F' } };
  const sub = ws.getCell('C2');
  sub.value = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${applied.length ? applied.join(' · ') : 'no filters'} · ${stamp}`;
  sub.font = { size: 10, color: { argb: 'FF64748B' } };

  const HEAD = 4;
  COLS.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
    cell.alignment = { vertical: 'middle' };
    ws.getColumn(i + 1).width = c.width;
  });
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: COLS.length } };

  rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    COLS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = c.get(r);
      cell.value = v;
      if (v instanceof Date) cell.numFmt = 'dd-mmm-yyyy';
      if (typeof v === 'number') cell.numFmt = Number.isInteger(v) ? '0' : '0.0';
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
