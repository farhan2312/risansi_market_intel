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
 * user may SEE. Visibility is TOUR-based, plus any direct SPECIAL-ACCESS grant:
 *   rep / manager → clients whose tour is one of the tours they're on
 *                   (tour_assignments), OR clients an admin has granted them
 *                   direct access to (client_rep_access). Rep and manager are
 *                   identical here; the difference is only which tours each is on.
 *   admin / +     → everything (returns null = no restriction)
 * A user with no linked id, or a client neither on their tour nor granted, is
 * not visible ('FALSE').
 */
export function clientVisibilitySql(user: CurrentUser, alias = 'c'): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  return `(${alias}.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid})
    OR ${alias}.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid}))`;
}

/**
 * SQL predicate scoping a visits/opportunities/tasks query to the clients the
 * user may SEE, keyed on that table's CLIENT-ID column (e.g. 'v.client_id',
 * 'o.client_id'). A record is visible when its client's tour is one of the
 * user's tours — i.e. fully tour-based, so a rep sees every visit/opportunity
 * for clients on their tours, not only the ones they personally own — plus any
 * client an admin has granted them direct SPECIAL access to.
 *   rep / manager → records whose client is on one of their tours, or granted
 *   admin / +     → everything (null = no restriction)
 */
export function clientScopeSql(user: CurrentUser, clientIdCol: string): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  return `(${clientIdCol} IN (
    SELECT id FROM clients
     WHERE tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid})
  ) OR ${clientIdCol} IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid}))`;
}

/** Can this user SEE a single client? Tour-based, or a direct special-access
 *  grant (mirrors clientVisibilitySql). */
export async function canViewClient(user: CurrentUser, clientId: number): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  const uid = intOrNull(user.id);
  if (uid == null) return false;
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT (EXISTS (
       SELECT 1 FROM clients c
       WHERE c.id = $1 AND c.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = $2)
     ) OR EXISTS (
       SELECT 1 FROM client_rep_access WHERE client_id = $1 AND rep_id = $2
     )) AS ok`,
    [clientId, uid],
  );
  return rows[0]?.ok ?? false;
}

/** Does this rep hold a direct special-access grant for this client? Used to
 *  own work (opportunities) they file for a granted client, independent of tour. */
export async function hasSpecialClientAccess(repId: number, clientId: number): Promise<boolean> {
  const rid = intOrNull(repId), cid = intOrNull(clientId);
  if (rid == null || cid == null) return false;
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM client_rep_access WHERE client_id = $1 AND rep_id = $2) AS ok`,
    [cid, rid],
  );
  return rows[0]?.ok ?? false;
}

/**
 * Can this user access a single complaint? admin/sysadmin always; otherwise
 * when they raised it, it's assigned to them, or its client is on their tour.
 * Mirrors the complaints page visibility predicate.
 */
export async function canAccessComplaint(user: CurrentUser, complaintId: number): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  const uid = intOrNull(user.id);
  const { rows } = await risansiPool.query<{ client_id: number | null; assigned_to_user: number | null; created_by: string | null }>(
    'SELECT client_id, assigned_to_user, created_by FROM complaints WHERE id = $1', [complaintId],
  );
  const r = rows[0];
  if (!r) return false;
  if (uid != null && r.assigned_to_user === uid) return true;
  if (user.email && r.created_by && r.created_by.toLowerCase() === user.email.toLowerCase()) return true;
  if (r.client_id != null) return canViewClient(user, r.client_id);
  return false;
}

/** SQL predicate scoping a `complaints` query (aliased `cm`) to what a user may see. */
export function complaintVisibilitySql(user: CurrentUser, alias = 'cm'): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  const email = (user.email ?? '').replace(/'/g, "''").toLowerCase();
  return `(
    ${alias}.assigned_to_user = ${uid}
    OR lower(${alias}.created_by) = '${email}'
    OR ${alias}.client_id IN (SELECT id FROM clients WHERE tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = ${uid}))
    OR ${alias}.client_id IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid})
  )`;
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

/**
 * Whose Executive Review may this user open?
 *   admin / sysadmin → null (no restriction — every TSM)
 *   manager          → the reps on the tours they're assigned to, plus
 *                      themselves (getManagerAssignableReps). Note this is
 *                      symmetric on shared tours, so a manager also sees a peer
 *                      manager who works the same tour.
 *   rep              → themselves only
 * Returns the allowed users.id list, or null meaning "no restriction". An empty
 * array means "nobody" (a user with no linked id), which callers must treat as
 * no access rather than as unrestricted.
 */
export async function getReviewableRepIds(user: CurrentUser): Promise<number[] | null> {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return [];
  if (user.role === 'manager') return getManagerAssignableReps(uid);
  return [uid];
}

/**
 * Who may fill or correct a visit report: the assigned rep, a manager who
 * shares one of that rep's tours, or admin/sysadmin. Same shape as the
 * opportunity edit gate (userCanEditOpp) so record editing stays consistent
 * across the app. The 30-day re-open window is applied on top of this, not
 * inside it — this answers "is this person allowed at all?", the window answers
 * "is it still soon enough?".
 */
export async function canEditVisitReport(
  user: { role?: string | null; repId?: number | null },
  visitRepId: number | null,
): Promise<boolean> {
  const role = user.role ?? 'rep';
  if (hasRole(role, 'admin')) return true;                       // admin + sysadmin
  if (user.repId != null && visitRepId != null && Number(visitRepId) === Number(user.repId)) return true;
  if (role === 'manager' && user.repId != null && visitRepId != null) {
    const assignable = await getManagerAssignableReps(user.repId);
    return assignable.includes(Number(visitRepId));
  }
  return false;
}
