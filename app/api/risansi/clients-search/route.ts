import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  if (q.length < 2) return Response.json([]);

  try {
    // Per-user visibility — predicate inlines integers, so it needs no params.
    const user = await getCurrentUser();
    const visPred = clientVisibilitySql(user, 'c');
    const visClause = visPred ? `AND (${visPred})` : '';

    const res = await risansiPool.query(
      `SELECT c.id, c.code, c.legal_name, c.city, c.state, c.industry,
              -- first owner (by assignment order) stands in for the legacy primary rep
              (SELECT ca.user_id FROM client_assignments ca
                WHERE ca.client_id = c.id ORDER BY ca.assigned_at, ca.user_id LIMIT 1) AS primary_rep_id,
              NULL::int                                                     AS secondary_rep_id,
              (SELECT string_agg(u.name, ', ' ORDER BY u.name)
                 FROM client_assignments ca JOIN users u ON u.id = ca.user_id
                WHERE ca.client_id = c.id)                                  AS primary_rep_name,
              NULL::text                                                    AS secondary_rep_name
       FROM clients c
       WHERE c.deleted_at IS NULL
         AND c.status = 'ACTIVE'
         AND (
           c.legal_name ILIKE $1
           OR c.code     ILIKE $1
           OR c.city     ILIKE $1
         )
         ${visClause}
       ORDER BY c.legal_name ASC
       LIMIT 20`,
      [`%${q}%`],
    );
    return Response.json(res.rows);
  } catch {
    return Response.json([]);
  }
}
