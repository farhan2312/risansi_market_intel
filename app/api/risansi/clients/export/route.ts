import { NextResponse } from 'next/server';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { OWNERS_SUBQUERY, REV_JOIN, buildClientFilter } from '@/lib/risansi-client-filter';
import { getCurrentFY } from '@/lib/risansi-utils';
import { clientStatusLabel } from '@/lib/risansi-client-status';

// xlsx generation needs the Node runtime.
export const runtime = 'nodejs';

interface Row {
  code: string; legal_name: string; trade_name: string | null; group_name: string | null;
  industry: string | null; client_type: string | null; tier: string | null; status: string | null;
  market_type: string | null; is_sugar: boolean | null; is_tender: boolean | null; is_end_client: boolean | null;
  capacity_bracket: string | null; tcd: number | null; klpd: number | null; since_year: string | null;
  country: string | null; zone: string | null; state: string | null; city: string | null;
  address: string | null; google_maps_url: string | null;
  tour_name: string | null; reps: string | null;
  lifetime_rev: number; fy_rev: number; total_outstanding: number; outstanding_as_of: string | null;
  open_pipeline_inr: number; open_opps: number;
  last_visit_date: string | null; days_since_last_visit: number | null;
  total_visits: number; contacts_count: number;
  created_by: string | null; created_at: string | null; updated_by: string | null; updated_at: string | null;
}

const yn = (v: boolean | null) => (v ? 'Yes' : 'No');

// GET /api/risansi/clients/export?<same filter params as the list page>
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { whereClause, params } = buildClientFilter(sp, user);

  const fy = getCurrentFY();
  const FY_START = fy.startDate;                                    // e.g. 2026-04-01
  const FY_END   = `${Number(FY_START.slice(0, 4)) + 1}-04-01`;     // 2027-04-01
  const fyStartIdx = params.length + 1;
  const fyEndIdx   = params.length + 2;
  const queryParams = [...params, FY_START, FY_END];

  let rows: Row[] = [];
  try {
    const res = await risansiPool.query<Row>(
      `SELECT
         c.code, c.legal_name, c.trade_name, c.group_name,
         c.industry, c.client_type, c.tier, c.status, c.market_type,
         c.is_sugar, c.is_tender, c.is_end_client,
         c.capacity_bracket, c.tcd, c.klpd, c.since_year,
         c.country, tr.zone AS zone, c.state, c.city, c.address, c.google_maps_url,
         tr.name AS tour_name,
         COALESCE(${OWNERS_SUBQUERY}, '') AS reps,
         COALESCE(rev.lifetime_rev, 0)::float8 AS lifetime_rev,
         (SELECT COALESCE(SUM(m.total_value), 0) FROM client_revenue_monthly m
            WHERE m.client_id = c.id AND m.month >= $${fyStartIdx} AND m.month < $${fyEndIdx})::float8 AS fy_rev,
         COALESCE(c.total_outstanding, 0)::float8 AS total_outstanding,
         c.outstanding_as_of::text AS outstanding_as_of,
         ((SELECT COALESCE(SUM(o.value_cr), 0) FROM opportunities o
            WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost')) * 10000000)::float8 AS open_pipeline_inr,
         (SELECT COUNT(*) FROM opportunities o WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost'))::int AS open_opps,
         c.last_visit_date::text AS last_visit_date,
         (CURRENT_DATE - c.last_visit_date) AS days_since_last_visit,
         (SELECT COUNT(*) FROM visits v WHERE v.client_id = c.id)::int AS total_visits,
         (SELECT COUNT(*) FROM contacts ct WHERE ct.client_id = c.id)::int AS contacts_count,
         c.created_by, c.created_at::text AS created_at,
         c.updated_by, c.updated_at::text AS updated_at
       FROM clients c
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
       ${REV_JOIN}
       WHERE ${whereClause}
       ORDER BY c.legal_name ASC NULLS LAST`,
      queryParams as (string | number)[],
    );
    rows = res.rows;
  } catch (err) {
    console.error('[clients/export] query failed:', err);
    return new NextResponse('Export failed', { status: 500 });
  }

  // Ordered columns: header, width, value accessor, and number format (money is
  // kept numeric so it stays analysable in Excel).
  const MONEY = '#,##0';
  const COLS: Array<{ h: string; w: number; f: (r: Row) => string | number; fmt?: string }> = [
    { h: 'Client Code', w: 14, f: r => r.code },
    { h: 'Legal Name', w: 30, f: r => r.legal_name },
    { h: 'Trade Name', w: 22, f: r => r.trade_name ?? '' },
    { h: 'Group Name', w: 22, f: r => r.group_name ?? '' },
    { h: 'Industry', w: 16, f: r => r.industry ?? '' },
    { h: 'Client Type', w: 14, f: r => r.client_type ?? '' },
    { h: 'Tier', w: 10, f: r => r.tier ?? '' },
    { h: 'Status', w: 16, f: r => r.status ? clientStatusLabel(r.status) : '' },
    { h: 'Market Type', w: 12, f: r => r.market_type ?? '' },
    { h: 'Sugar', w: 7, f: r => yn(r.is_sugar) },
    { h: 'Tender', w: 8, f: r => yn(r.is_tender) },
    { h: 'End Client', w: 10, f: r => yn(r.is_end_client) },
    { h: 'Capacity Bracket', w: 16, f: r => r.capacity_bracket ?? '' },
    { h: 'TCD', w: 8, f: r => r.tcd ?? '' },
    { h: 'KLPD', w: 8, f: r => r.klpd ?? '' },
    { h: 'Customer Since', w: 16, f: r => r.since_year ?? '' },
    { h: 'Country', w: 12, f: r => r.country ?? '' },
    { h: 'Zone', w: 12, f: r => r.zone ?? '' },
    { h: 'State', w: 14, f: r => r.state ?? '' },
    { h: 'City', w: 16, f: r => r.city ?? '' },
    { h: 'Address', w: 34, f: r => r.address ?? '' },
    { h: 'Google Maps URL', w: 26, f: r => r.google_maps_url ?? '' },
    { h: 'Tour / Route', w: 18, f: r => r.tour_name ?? '' },
    { h: 'Rep(s)', w: 24, f: r => r.reps ?? '' },
    { h: 'Lifetime Revenue (₹)', w: 18, f: r => Math.round(r.lifetime_rev), fmt: MONEY },
    { h: 'Current FY Revenue (₹)', w: 18, f: r => Math.round(r.fy_rev), fmt: MONEY },
    { h: 'Total Outstanding (₹)', w: 18, f: r => Math.round(r.total_outstanding), fmt: MONEY },
    { h: 'Outstanding As Of', w: 16, f: r => r.outstanding_as_of ?? '' },
    { h: 'Open Pipeline (₹)', w: 16, f: r => Math.round(r.open_pipeline_inr), fmt: MONEY },
    { h: 'Open Opportunities', w: 16, f: r => r.open_opps },
    { h: 'Last Visit Date', w: 14, f: r => r.last_visit_date ?? '' },
    { h: 'Days Since Last Visit', w: 18, f: r => r.days_since_last_visit ?? '' },
    { h: 'Total Visits', w: 12, f: r => r.total_visits },
    { h: 'Contacts', w: 10, f: r => r.contacts_count },
    { h: 'Created By', w: 16, f: r => r.created_by ?? '' },
    { h: 'Created On', w: 12, f: r => (r.created_at ? r.created_at.slice(0, 10) : '') },
    { h: 'Updated By', w: 16, f: r => r.updated_by ?? '' },
    { h: 'Updated On', w: 12, f: r => (r.updated_at ? r.updated_at.slice(0, 10) : '') },
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clients', { views: [{ state: 'frozen', ySplit: 3 }] });
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

  // Logo top-left (over A1:B2, aspect-preserved from 267×95).
  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo missing — export still works */ }
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 16;

  // Title band (to the right of the logo).
  const title = ws.getCell('C1');
  title.value = 'Client 360 — Clients Export';
  title.font = { size: 14, bold: true, color: { argb: 'FF0A3D8F' } };
  const sub = ws.getCell('C2');
  sub.value = `${rows.length.toLocaleString('en-IN')} client${rows.length === 1 ? '' : 's'} · ${stamp}`;
  sub.font = { size: 10, color: { argb: 'FF64748B' } };

  // Header row (3) — navy band, white bold.
  const header = ws.getRow(3);
  COLS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
    cell.alignment = { vertical: 'middle', wrapText: false };
  });
  header.height = 18;

  // Data rows (from 4).
  rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.f(r);
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="clients-export-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
