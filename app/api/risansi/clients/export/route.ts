import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { OWNERS_SUBQUERY, REV_JOIN, buildClientFilter } from '@/lib/risansi-client-filter';
import { getCurrentFY } from '@/lib/risansi-utils';

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

  // Map to friendly, ordered columns. Money stays numeric so it's analysable.
  const data = rows.map(r => ({
    'Client Code':            r.code,
    'Legal Name':             r.legal_name,
    'Trade Name':             r.trade_name ?? '',
    'Group Name':             r.group_name ?? '',
    'Industry':               r.industry ?? '',
    'Client Type':            r.client_type ?? '',
    'Tier':                   r.tier ?? '',
    'Status':                 r.status ?? '',
    'Market Type':            r.market_type ?? '',
    'Sugar':                  yn(r.is_sugar),
    'Tender':                 yn(r.is_tender),
    'End Client':             yn(r.is_end_client),
    'Capacity Bracket':       r.capacity_bracket ?? '',
    'TCD':                    r.tcd ?? '',
    'KLPD':                   r.klpd ?? '',
    'Customer Since':         r.since_year ?? '',
    'Country':                r.country ?? '',
    'Zone':                   r.zone ?? '',
    'State':                  r.state ?? '',
    'City':                   r.city ?? '',
    'Address':                r.address ?? '',
    'Google Maps URL':        r.google_maps_url ?? '',
    'Tour / Route':           r.tour_name ?? '',
    'Rep(s)':                 r.reps ?? '',
    'Lifetime Revenue (₹)':   Math.round(r.lifetime_rev),
    'Current FY Revenue (₹)': Math.round(r.fy_rev),
    'Total Outstanding (₹)':  Math.round(r.total_outstanding),
    'Outstanding As Of':      r.outstanding_as_of ?? '',
    'Open Pipeline (₹)':      Math.round(r.open_pipeline_inr),
    'Open Opportunities':     r.open_opps,
    'Last Visit Date':        r.last_visit_date ?? '',
    'Days Since Last Visit':  r.days_since_last_visit ?? '',
    'Total Visits':           r.total_visits,
    'Contacts':               r.contacts_count,
    'Created By':             r.created_by ?? '',
    'Created On':             r.created_at ? r.created_at.slice(0, 10) : '',
    'Updated By':             r.updated_by ?? '',
    'Updated On':             r.updated_at ? r.updated_at.slice(0, 10) : '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  // Rough column widths for readability.
  ws['!cols'] = [
    12, 30, 22, 22, 16, 14, 10, 12, 12, 7, 8, 10, 16, 8, 8, 14, 12, 12, 14, 16, 34, 26, 18, 24,
    18, 18, 18, 16, 16, 16, 14, 18, 12, 10, 16, 12, 16, 12,
  ].map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const stamp = new Date().toISOString().slice(0, 10);
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
