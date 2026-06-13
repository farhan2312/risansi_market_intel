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

/** Tour ids assigned to a rep/manager. (tour_assignments.rep_id holds a users.id.) */
export async function getRepTours(repId: number): Promise<number[]> {
  const res = await risansiPool.query<{ tour_id: number }>(
    `SELECT tour_id FROM tour_assignments WHERE rep_id = $1`,
    [repId],
  );
  return res.rows.map(r => r.tour_id);
}

// ── Current user + visibility (post-unification on `users`) ───────

export interface CurrentUser {
  id:    number | null;   // users.id (same integer space as the old reps.id)
  email: string | null;
  role:  RisansiRole;
}

/** Resolve the signed-in user from the session. role defaults to 'rep'. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const session = await getServerSession(authOptions);
  return {
    id:    (session?.user?.repId as number | null) ?? null,
    email: session?.user?.email ?? null,
    role:  ((session?.user?.role as RisansiRole) ?? 'rep'),
  };
}

// All ids below come from the trusted session (integers), so inlining them
// into SQL is injection-safe and keeps callers free of param-index juggling.
function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * SQL predicate restricting a `clients` query (aliased `alias`) to what the
 * user may SEE:
 *   rep      → clients they're assigned to (client_assignments)
 *   manager  → assigned clients OR clients whose tour is one of their tours
 *   admin/+  → everything (returns null = no restriction)
 * A user with no linked id sees nothing ('FALSE').
 */
export function clientVisibilitySql(user: CurrentUser, alias = 'c'): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  const assigned = `${alias}.id IN (SELECT client_id FROM client_assignments WHERE user_id = ${uid})`;
  if (user.role === 'manager') {
    return `(${assigned} OR ${alias}.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid}))`;
  }
  return assigned;
}

/**
 * SQL predicate restricting a visits/opportunities query to what the user may
 * SEE, keyed on the owner column (e.g. 'v.rep_id', 'o.rep_id'):
 *   rep      → only their own
 *   manager  → own + anyone sharing one of their tours
 *   admin/+  → everything (null = no restriction)
 */
export function ownerVisibilitySql(user: CurrentUser, ownerCol: string): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  if (user.role === 'manager') {
    return `${ownerCol} IN (
      SELECT DISTINCT ta2.rep_id FROM tour_assignments ta1
      JOIN tour_assignments ta2 ON ta1.tour_id = ta2.tour_id
      WHERE ta1.rep_id = ${uid}
      UNION SELECT ${uid}
    )`;
  }
  return `${ownerCol} = ${uid}`;
}

/** Can this user SEE a single client? (mirrors clientVisibilitySql.) */
export async function canViewClient(user: CurrentUser, clientId: number): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  const uid = intOrNull(user.id);
  if (uid == null) return false;
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM client_assignments WHERE client_id = $1 AND user_id = $2
     ) OR ($3 = 'manager' AND EXISTS (
       SELECT 1 FROM clients c
       WHERE c.id = $1 AND c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $2)
     )) AS ok`,
    [clientId, uid, user.role],
  );
  return rows[0]?.ok ?? false;
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
