import risansiPool from '@/lib/db-risansi';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  if (q.length < 2) return Response.json([]);

  try {
    const res = await risansiPool.query(
      `SELECT id, code, legal_name, city, state, industry
       FROM clients
       WHERE deleted_at IS NULL
         AND status = 'ACTIVE'
         AND (
           legal_name ILIKE $1
           OR code     ILIKE $1
           OR city     ILIKE $1
         )
       ORDER BY legal_name ASC
       LIMIT 20`,
      [`%${q}%`],
    );
    return Response.json(res.rows);
  } catch {
    return Response.json([]);
  }
}
