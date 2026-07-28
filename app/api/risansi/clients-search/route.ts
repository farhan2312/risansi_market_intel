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
              -- The ONE resolved owner. A viewer holding a direct special-access
              -- grant OWNS work they file here (the server assigns them as rep),
              -- so resolve to them — this is also what unblocks the New
              -- Opportunity form for a granted client that is on no tour.
              -- Otherwise: the tour's designated (active) owner, else its FIRST
              -- active rep by (assigned_at, rep_id) — never null just because a
              -- tour has more than one rep. (The old HAVING count(*) = 1 wrongly
              -- returned null for any multi-rep tour, falsely blocking creation.)
              CASE
                WHEN $3::int IS NOT NULL
                 AND EXISTS (SELECT 1 FROM client_rep_access a WHERE a.client_id = c.id AND a.rep_id = $3::int)
                THEN (SELECT u.name FROM users u WHERE u.id = $3::int)
                ELSE (SELECT u.name FROM users u WHERE u.id = COALESCE(
                   (SELECT pu.id FROM tour_routes tr
                      JOIN users pu ON pu.id = tr.primary_rep_id AND pu.is_active
                     WHERE tr.id = c.tour_id),
                   (SELECT ta.rep_id FROM tour_assignments ta
                      JOIN users ru ON ru.id = ta.rep_id AND ru.is_active
                     WHERE ta.tour_id = c.tour_id AND ta.role = 'rep'
                     ORDER BY ta.assigned_at, ta.rep_id LIMIT 1)
                 ))
              END                                                            AS owner_name
       FROM clients c
       WHERE c.deleted_at IS NULL
         -- Match the Client 360 list, which shows every non-deleted client of
         -- any status. The old status=ACTIVE filter hid 1,500+ clients, every
         -- lead and prospect among them, so a rep could not plan a visit or
         -- raise an opportunity against them. Status is a list filter, not a
         -- gate on who exists.
         AND (
           c.legal_name ILIKE $1
           OR c.code     ILIKE $1
           OR c.city     ILIKE $1
         )
         ${visClause}
       -- Prefix hits first (typing a name prefix surfaces that client over a
       -- mid-word match), so the LIMIT never buries the client searched for.
       ORDER BY (CASE WHEN c.legal_name ILIKE $2 OR c.code ILIKE $2 THEN 0 ELSE 1 END),
                c.legal_name ASC
       LIMIT 25`,
      [`%${q}%`, `${q}%`, user.id],
    );
    return Response.json(res.rows);
  } catch {
    return Response.json([]);
  }
}
