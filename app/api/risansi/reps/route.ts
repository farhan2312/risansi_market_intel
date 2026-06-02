import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';

export async function GET() {
  try {
    const { rows } = await risansiPool.query<{
      id: string; name: string; zone: string | null; route: string | null;
    }>(
      `SELECT id::text AS id, name, zone, route
       FROM reps
       WHERE is_active = TRUE
       ORDER BY name ASC`,
    );

    if (rows.length > 0) {
      return NextResponse.json(rows);
    }

    // Fallback: distinct rep names from clients if reps table is empty
    const { rows: fallback } = await risansiPool.query<{
      id: null; name: string; zone: null; route: null;
    }>(
      `SELECT DISTINCT
         NULL::text        AS id,
         primary_rep_name  AS name,
         NULL::text        AS zone,
         NULL::text        AS route
       FROM clients
       WHERE primary_rep_name IS NOT NULL
         AND primary_rep_name != ''
         AND deleted_at IS NULL
       ORDER BY name ASC`,
    );

    return NextResponse.json(fallback);
  } catch (err) {
    console.error('Reps API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
