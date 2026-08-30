import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Returns all routes (id, name, zone) ordered by name, for the client form's
// route dropdown.
//
// It used to carry `reps` and `managers` columns aggregated from the route's
// roster. Nothing consumed them — the only caller reads id/name/zone — and the
// roster they came from stopped meaning anything when access moved onto the
// client, so they went with the table.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json([], { status: 401 });
    }

    const { rows } = await risansiPool.query(
      `SELECT tr.id::text AS id, tr.name, tr.zone
         FROM tour_routes tr
        ORDER BY tr.name ASC`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('Tours API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
