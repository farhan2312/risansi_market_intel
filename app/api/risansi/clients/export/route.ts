import { NextResponse } from 'next/server';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { OWNERS_SUBQUERY, REV_JOIN, buildClientFilter } from '@/lib/risansi-client-filter';
import { clientPrimaryRepSql, clientSecondaryNamesSql, clientManagerNamesSql } from '@/lib/risansi-client-rep';
import { resolveExportColumns } from '@/lib/risansi-client-export-columns';
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
  primary_rep: string | null; secondary_reps: string | null; managers: string | null;
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
         -- The owner alone, and the cover alone. The reps column above joins them
         -- into one string, which cannot answer "whose account is this" — the
         -- question the other systems consuming this file actually ask.
         (SELECT u.name FROM users u WHERE u.id = ${clientPrimaryRepSql('c.id')}) AS primary_rep,
         ${clientSecondaryNamesSql('c.id')} AS secondary_reps,
         ${clientManagerNamesSql('c.id')} AS managers,
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

  // Value per column key. Order, labels and widths live in
  // lib/risansi-client-export-columns.ts, which the picker reads too — so a
  // ticked column can never come out holding a different column's values.
  const VALUE: Record<string, (r: Row) => string | number> = {
    code:              r => r.code,
    legal_name:        r => r.legal_name,
    trade_name:        r => r.trade_name ?? '',
    group_name:        r => r.group_name ?? '',
    industry:          r => r.industry ?? '',
    client_type:       r => r.client_type ?? '',
    tier:              r => r.tier ?? '',
    status:            r => (r.status ? clientStatusLabel(r.status) : ''),
    market_type:       r => r.market_type ?? '',
    is_sugar:          r => yn(r.is_sugar),
    is_tender:         r => yn(r.is_tender),
    is_end_client:     r => yn(r.is_end_client),
    capacity_bracket:  r => r.capacity_bracket ?? '',
    tcd:               r => r.tcd ?? '',
    klpd:              r => r.klpd ?? '',
    since_year:        r => r.since_year ?? '',
    country:           r => r.country ?? '',
    zone:              r => r.zone ?? '',
    state:             r => r.state ?? '',
    city:              r => r.city ?? '',
    address:           r => r.address ?? '',
    google_maps_url:   r => r.google_maps_url ?? '',
    tour_name:         r => r.tour_name ?? '',
    primary_rep:       r => r.primary_rep ?? '',
    secondary_reps:    r => r.secondary_reps ?? '',
    reps:              r => r.reps ?? '',
    managers:          r => r.managers ?? '',
    lifetime_rev:      r => Math.round(r.lifetime_rev),
    fy_rev:            r => Math.round(r.fy_rev),
    total_outstanding: r => Math.round(r.total_outstanding),
    outstanding_as_of: r => r.outstanding_as_of ?? '',
    open_pipeline_inr: r => Math.round(r.open_pipeline_inr),
    open_opps:         r => r.open_opps,
    last_visit_date:   r => r.last_visit_date ?? '',
    days_since:        r => r.days_since_last_visit ?? '',
    total_visits:      r => r.total_visits,
    contacts_count:    r => r.contacts_count,
    created_by:        r => r.created_by ?? '',
    created_at:        r => (r.created_at ? r.created_at.slice(0, 10) : ''),
    updated_by:        r => r.updated_by ?? '',
    updated_at:        r => (r.updated_at ? r.updated_at.slice(0, 10) : ''),
  };

  const MONEY = '#,##0';
  const COLS = resolveExportColumns(new URL(req.url).searchParams.get('cols'))
    .map(c => ({ h: c.label, w: c.width, f: VALUE[c.key], fmt: c.money ? MONEY : undefined }))
    // A key in the catalogue with no accessor here would write undefined into
    // every row. Drop it rather than ship a column of blanks.
    .filter(c => typeof c.f === 'function');

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
