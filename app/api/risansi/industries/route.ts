import risansiPool from '@/lib/db-risansi';

export async function GET() {
  try {
    const { rows } = await risansiPool.query<{ id: string; name: string; is_sugar: boolean }>(
      `SELECT id, name, COALESCE(is_sugar, false) AS is_sugar
       FROM industries
       WHERE is_active = TRUE
       ORDER BY sort_order, name`,
    );
    return Response.json(rows);
  } catch {
    // Table may not exist or columns differ — return empty array
    return Response.json([]);
  }
}
