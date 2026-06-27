import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar } from '@/components/risansi';
import { ActionQueueRow, type QueueTask } from '@/components/risansi/ActionQueueRow';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { REP_TASKS_QUERY, ADMIN_TASKS_QUERY } from '@/lib/risansi-action-queue';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export default async function ActionRegistryPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? '';
  const user  = await getCurrentUser();

  // Admin / sysadmin see every task; rep / manager see only what belongs to
  // them (assigned, created, on their visits, or a client on one of their tours).
  const isAdmin = hasRole(user.role, 'admin');

  // Resolve the user's users.id for the scoped query (sessions usually carry it).
  let repId: number | null = user.id;
  if (repId == null && email) {
    repId = await q<number | null>(async () => {
      const { rows } = await risansiPool.query<{ id: number }>(
        'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [email],
      );
      return rows[0]?.id ?? null;
    }, null);
  }

  const tasks = await q<QueueTask[]>(async () => {
    if (isAdmin) {
      const { rows } = await risansiPool.query<QueueTask>(ADMIN_TASKS_QUERY);
      return rows;
    }
    if (repId == null) return [];
    const { rows } = await risansiPool.query<QueueTask>(REP_TASKS_QUERY, [repId, email]);
    return rows;
  }, []);

  const openCount    = tasks.filter(t => t.status !== 'completed').length;
  const overdueCount = tasks.filter(t => t.status === 'open' && !!t.due_date && new Date(t.due_date) < new Date()).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Action Registry']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Action Registry</span>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {openCount} open
              {overdueCount > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--neg)', fontWeight: 600 }}>· {overdueCount} overdue</span>
              )}
            </span>
          </div>
          <div>
            {tasks.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                No action items — all caught up ✓
              </div>
            ) : (
              tasks.map(task => <ActionQueueRow key={task.id} task={task} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
