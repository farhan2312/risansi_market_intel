import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';

export async function POST(req: Request) {
  try {
    const { codes } = await req.json() as { codes: string[] };

    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ found: {}, notFound: [] });
    }

    const upper = codes.map(c => c.toUpperCase());

    const res = await risansiPool.query<{ id: string; code: string; legal_name: string }>(
      `SELECT id::text, UPPER(code) AS code, legal_name
       FROM clients
       WHERE UPPER(code) = ANY($1::text[])
         AND deleted_at IS NULL`,
      [upper],
    );

    const found: Record<string, { id: string; legal_name: string }> = {};
    res.rows.forEach(r => {
      found[r.code] = { id: r.id, legal_name: r.legal_name };
    });

    const notFound = upper.filter(c => !found[c]);

    return NextResponse.json({ found, notFound });
  } catch (err) {
    console.error('[validate-revenue-codes]', err);
    return NextResponse.json({ found: {}, notFound: [] }, { status: 500 });
  }
}
