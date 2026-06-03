import risansiPool from '@/lib/db-risansi';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  if (q.length < 2) return Response.json([]);

  try {
    const res = await risansiPool.query(
      `SELECT c.id, c.code, c.legal_name, c.city, c.state, c.industry,
              c.primary_rep_id, c.secondary_rep_id,
              COALESCE(r1.name, c.primary_rep_name)   AS primary_rep_name,
              COALESCE(r2.name, c.secondary_rep_name) AS secondary_rep_name
       FROM clients c
       LEFT JOIN reps r1 ON c.primary_rep_id   = r1.id
       LEFT JOIN reps r2 ON c.secondary_rep_id = r2.id
       WHERE c.deleted_at IS NULL
         AND c.status = 'ACTIVE'
         AND (
           c.legal_name ILIKE $1
           OR c.code     ILIKE $1
           OR c.city     ILIKE $1
         )
       ORDER BY c.legal_name ASC
       LIMIT 20`,
      [`%${q}%`],
    );
    return Response.json(res.rows);
  } catch {
    return Response.json([]);
  }
}
