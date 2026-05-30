import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { NewVisitClient } from './NewVisitClient';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export interface ClientOption {
  id: string;
  client_code: string;
  legal_name: string;
  industry: string;
  last_visit: string | null;   // YYYY-MM-DD or null
  days_since: number | null;
}

export default async function NewVisitPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? '';

  const rep = await q<{ id: string; name: string } | null>(async () => {
    const { rows } = await risansiPool.query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }, null);

  // All active clients assigned to this rep (for autocomplete)
  const clients = await q<ClientOption[]>(async () => {
    const { rows } = await risansiPool.query<{
      id: string; client_code: string; legal_name: string; industry: string;
      last_visit: string | null; days_since: string | null;
    }>(`
      SELECT c.id, c.client_code, c.legal_name, c.industry,
             MAX(v.visit_date)::text AS last_visit,
             CASE
               WHEN MAX(v.visit_date) IS NULL THEN NULL
               ELSE EXTRACT(DAY FROM NOW() - MAX(v.visit_date)::timestamp)::int
             END::text AS days_since
      FROM clients c
      LEFT JOIN visits v ON v.client_id = c.id AND v.status = 'completed'
      WHERE c.rep_id = $1 AND c.status = 'Active'
      GROUP BY c.id
      ORDER BY c.legal_name
    `, [rep?.id ?? '']);
    return rows.map(r => ({
      ...r,
      days_since: r.days_since != null ? Number(r.days_since) : null,
    }));
  }, []);

  return (
    <NewVisitClient
      repId={rep?.id ?? null}
      repName={rep?.name ?? session?.user?.name ?? email.split('@')[0]}
      clients={clients}
    />
  );
}
