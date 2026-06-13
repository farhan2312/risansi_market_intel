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
      `SELECT id::text AS id, name, zone
         FROM tour_routes
        ORDER BY name ASC`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('Tours API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
