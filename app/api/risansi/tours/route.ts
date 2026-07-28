import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Returns all tour routes (id, name, zone) ordered by name. Used by the
// client form's tour dropdown and the sysadmin mappers.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json([], { status: 401 });
    }

    const { rows } = await risansiPool.query(
      `SELECT tr.id::text AS id, tr.name, tr.zone,
              COALESCE((SELECT string_agg(u.name, ', ' ORDER BY u.name)
                        FROM tour_assignments ta JOIN users u ON u.id = ta.rep_id
                       WHERE ta.tour_id = tr.id AND ta.role = 'rep'), '')     AS reps,
              COALESCE((SELECT string_agg(u.name, ', ' ORDER BY u.name)
                        FROM tour_assignments ta JOIN users u ON u.id = ta.rep_id
                       WHERE ta.tour_id = tr.id AND ta.role = 'manager'), '') AS managers
         FROM tour_routes tr
        ORDER BY tr.name ASC`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('Tours API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
