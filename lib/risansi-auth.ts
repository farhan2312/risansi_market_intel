import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

export type RisansiRole = 'rep' | 'manager' | 'admin' | 'sysadmin';

// Role hierarchy: higher level = more access. Anything unknown is level 0.
const ROLE_LEVEL: Record<RisansiRole, number> = {
  rep:      1,
  manager:  2,
  admin:    3,
  sysadmin: 4,
};

/**
 * True when `userRole` meets or exceeds `requiredRole` in the hierarchy.
 *   hasRole(role, 'admin')    → admin AND sysadmin
 *   hasRole(role, 'sysadmin') → sysadmin only
 */
export function hasRole(userRole: string | null | undefined, requiredRole: RisansiRole): boolean {
  return (ROLE_LEVEL[userRole as RisansiRole] ?? 0) >= ROLE_LEVEL[requiredRole];
}

/** Return the current session or throw. Use inside server actions / route handlers. */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

/** Tour ids assigned to a rep/manager. */
export async function getRepTours(repId: number): Promise<number[]> {
  const res = await risansiPool.query<{ tour_id: number }>(
    `SELECT tour_id FROM tour_assignments WHERE rep_id = $1`,
    [repId],
  );
  return res.rows.map(r => r.tour_id);
}

/**
 * Every rep id that shares at least one tour with this manager, plus the
 * manager themselves. Used to build the "who can I assign to" set and to
 * validate assignments server-side.
 */
export async function getManagerAssignableReps(managerRepId: number): Promise<number[]> {
  const res = await risansiPool.query<{ rep_id: number }>(
    `SELECT DISTINCT ta2.rep_id
       FROM tour_assignments ta1
       JOIN tour_assignments ta2 ON ta1.tour_id = ta2.tour_id
      WHERE ta1.rep_id = $1`,
    [managerRepId],
  );

  const repIds = res.rows.map(r => r.rep_id);
  if (!repIds.includes(managerRepId)) repIds.push(managerRepId);
  return repIds;
}
