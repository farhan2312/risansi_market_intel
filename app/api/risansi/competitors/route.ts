import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';

export async function GET() {
  try {
    const res = await risansiPool.query(
      `SELECT id, name FROM competitors WHERE is_active = TRUE ORDER BY name ASC`,
    );
    return NextResponse.json(res.rows);
  } catch {
    // is_active column may not exist — fall back to the full list
    try {
      const res = await risansiPool.query(
        `SELECT id, name FROM competitors ORDER BY name ASC`,
      );
      return NextResponse.json(res.rows);
    } catch {
      return NextResponse.json([], { status: 500 });
    }
  }
}
