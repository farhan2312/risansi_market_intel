import risansiPool from '@/lib/db-risansi';

export async function GET() {
  try {
    const { rows } = await risansiPool.query<{
      id: string; name: string; initials: string | null;
      zone: string | null; route: string | null; rep_code: string | null;
    }>(
      `SELECT id, name, initials, zone, route, rep_code
       FROM reps
       WHERE is_active = TRUE
       ORDER BY name`,
    );
    return Response.json(rows);
  } catch {
    // Fallback without rep_code (column may not exist)
    try {
      const { rows } = await risansiPool.query<{
        id: string; name: string; initials: string | null;
        zone: string | null; route: string | null;
      }>(
        `SELECT id, name, initials, zone, route
         FROM reps
         WHERE is_active = TRUE
         ORDER BY name`,
      );
      return Response.json(rows);
    } catch {
      return Response.json([]);
    }
  }
}
