import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';

export async function GET() {
  try {
    const res = await risansiPool.query(`
      SELECT DISTINCT industry
      FROM clients
      WHERE industry IS NOT NULL
        AND industry != ''
        AND deleted_at IS NULL
      ORDER BY industry ASC
    `);
    const industries = res.rows.map((r: { industry: string }) => r.industry);
    return NextResponse.json(industries);
  } catch (err) {
    console.error('Industries API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
