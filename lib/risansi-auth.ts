import { cache } from 'react';
import { getServerSession } from 'next-auth/next';
import type { Session } from 'next-auth';
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
// One session read per request, shared. getServerSession re-runs next-auth's jwt
// callback — which queries the users table — every call, and a single page render
// calls getCurrentUser/requireSession many times (per gated component). React's
// cache() dedupes them to one lookup for the lifetime of the request.
const getSession = cache(async () => getServerSession(authOptions));

/**
 * Is this session still entitled to the portal?
 *
 * Holding a valid cookie is not the same as still being allowed in. An admin
 * can revoke someone at any moment, and the session they are already holding
 * stays cryptographically valid for the rest of its 8 hours. The jwt callback
 * re-reads `users` on every request, so `risansiAccess` is always current — the
 * bug was that nothing outside proxy.ts ever looked at it.
 *
 * proxy.ts applies this rule to pages, but its matcher is /risansi/* and
 * /admin/* only, so nothing under /api/** ever passes through it. Enforcing it
 * here instead puts the check on the path EVERY caller shares: route handlers,
 * server actions, and server components alike.
 *
 * Anything that is not exactly 'Approved' — Pending, Rejected (which is what a
 * revoke writes), or a status this code has never heard of — is refused.
 */
function isApproved(session: Session | null): boolean {
  return session?.user?.risansiAccess === 'Approved';
}

export const requireSession = cache(async () => {
  const session = await getSession();
  if (!session?.user) throw new Error('Unauthorized');
  if (!isApproved(session)) throw new Error('Your access to the portal has been withdrawn.');
  return session;
});

// ── Current user + visibility (post-unification on `users`) ───────

export interface CurrentUser {
  id:    number | null;   // users.id (same integer space as the old reps.id)
  email: string | null;
  role:  RisansiRole;
}

/** A caller with no identity and no privileges. Every scope helper below turns
 *  this into 'FALSE', and every route that tests `user.email` returns 401. */
const SIGNED_OUT: CurrentUser = { id: null, email: null, role: 'rep' };

/**
 * Resolve the signed-in user from the session. role defaults to 'rep'.
 *
 * A session whose access is no longer 'Approved' resolves to SIGNED_OUT rather
 * than to its old identity — see isApproved above. Returning the real id and
 * role here is what let a revoked rep keep calling /api/risansi/** with a
 * cookie they were no longer entitled to.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const session = await getSession();
  if (!isApproved(session)) return SIGNED_OUT;
  return {
    id:    (session?.user?.repId as number | null) ?? null,
    email: session?.user?.email ?? null,
    role:  ((session?.user?.role as RisansiRole) ?? 'rep'),
  };
});

// All ids below come from the trusted session (integers), so inlining them
// into SQL is injection-safe and keeps callers free of param-index juggling.
function intOrNull(v: unknown): number | null {
  // null, undefined and '' are all rejected explicitly, and the result must be
  // positive. Number(null) and Number('') are both 0, and Number.isInteger(0) is
  // true — so the obvious version hands back a user id of 0 for someone who has
  // no id at all. Every caller here turns that into a predicate like
  // `primary_rep_id = 0`, which matches nothing only because no row happens to
  // carry id 0. That is luck rather than a rule, and the callers all document
  // themselves as returning FALSE for an unlinked user, so make it true.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The clients a person may see, as SQL.
 *
 * I am the primary rep, I am a secondary rep, I manage somebody who is either,
 * or an admin granted me the client directly. Managers reach clients through
 * their team rather than through a route, and one level only — a manager under a
 * manager inherits nothing, because the tours this replaced were never a
 * hierarchy and inventing one would be a guess.
 *
 * Admins are unrestricted and get null, meaning no predicate at all. A signed-out
 * or unlinked user gets 'FALSE' rather than an empty string, so a missing id can
 * never widen a query instead of narrowing it.
 */
function clientRuleSql(uid: number, clientIdCol: string): string {
  return `(${clientIdCol} IN (
      SELECT c2.id FROM clients c2
       WHERE c2.primary_rep_id = ${uid}
          OR c2.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})
    )
    OR ${clientIdCol} IN (
      SELECT s.client_id FROM client_secondary_reps s
       WHERE s.rep_id = ${uid}
          OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})
    )
    OR ${clientIdCol} IN (SELECT client_id FROM client_rep_access WHERE rep_id = ${uid}))`;
}

/**
 * Work still in flight that this person owns, regardless of who owns the client.
 *
 * A rep keeps sight of their own record until it closes, and then it stops being
 * theirs: once an opportunity is Won, Lost or Dropped — or a visit completed, or
 * an action done — it is only reachable through the client, like everything else.
 * So a rep finishes what they started on an account that has moved to a colleague,
 * and does not keep a permanent window into it.
 *
 * This matters more than it sounds. Scoping records purely through the client
 * would have taken 403 open opportunities, 10 visits and 19 action items out of
 * the view of the very people working them on the day of the switch. The set
 * drains on its own as those records close.
 *
 * `ownOpen` is written by the caller because only the caller knows the table:
 * pass 'o.rep_id = :uid AND o.stage NOT IN (...)' from an opportunities query.
 * Use the :uid placeholder; it is replaced with the integer id.
 */
export function clientScopeSql(
  user: CurrentUser, clientIdCol: string, ownOpen?: string,
): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  const base = clientRuleSql(uid, clientIdCol);
  if (!ownOpen) return base;
  // split/join rather than a regex: the id is a verified integer, and a literal
  // replace cannot be broken by an escape going astray on the way into the file.
  return `(${base} OR (${ownOpen.split(':uid').join(String(uid))}))`;
}

/** The same rule against a `clients` query aliased `alias`. */
export function clientVisibilitySql(user: CurrentUser, alias = 'c'): string | null {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  return clientRuleSql(uid, `${alias}.id`);
}

/** Ready-made open-record predicates, so the three tables spell it the same way. */
export const OWN_OPEN = {
  opportunity: (alias = 'o') => `${alias}.rep_id = :uid AND ${alias}.stage NOT IN ('Won','Lost','Dropped')`,
  visit:       (alias = 'v') => `${alias}.rep_id = :uid AND ${alias}.status <> 'completed'`,
  task:        (alias = 't') => `${alias}.assigned_to_rep = :uid AND ${alias}.status <> 'completed'`,
} as const;

export async function canViewClient(user: CurrentUser, clientId: number): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  const uid = intOrNull(user.id);
  if (uid == null) return false;
  // Client-level only, with no open-record limb: this answers "may I open this
  // account", and owning a live opportunity on someone else's client does not
  // make the account yours. The record stays reachable from the lists that scope
  // with clientScopeSql; the client page itself does not open.
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT (EXISTS (
       SELECT 1 FROM clients c
        WHERE c.id = $1
          AND (c.primary_rep_id = $2
               OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))
     ) OR EXISTS (
       SELECT 1 FROM client_secondary_reps s
        WHERE s.client_id = $1
          AND (s.rep_id = $2
               OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))
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
 * when they raised it, it's assigned to them, or they work its client.
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
  // The client limb goes through clientRuleSql rather than spelling itself out,
  // which is how it came to be left behind on the route rule while everything
  // else moved: a complaint on a client you own was invisible unless you also
  // happened to share a route with it.
  return `(
    ${alias}.assigned_to_user = ${uid}
    OR lower(${alias}.created_by) = '${email}'
    OR ${clientRuleSql(uid, `${alias}.client_id`)}
  )`;
}

/**
 * The people a manager may act for: their team, plus themselves. Drives "who can
 * I assign to", the rep dropdown, the visit-report edit gate, the quotation-file
 * gate and the Executive Review scope.
 *
 * This used to mean "everybody who shares a route with me", which was symmetric
 * — so a peer manager on the same route counted as assignable, and a rep on a
 * busy shared route inherited a dozen colleagues nobody had put them under. The
 * hierarchy is explicit now, so the answer is exactly the reps beneath them.
 *
 * A manager with no team gets just themselves, which is right: several of them
 * own clients directly and have nobody underneath.
 */
export async function getManagerAssignableReps(managerRepId: number): Promise<number[]> {
  const res = await risansiPool.query<{ rep_id: number }>(
    `SELECT rep_id FROM manager_reps WHERE manager_id = $1`,
    [managerRepId],
  );

  const repIds = res.rows.map(r => r.rep_id);
  if (!repIds.includes(managerRepId)) repIds.push(managerRepId);
  return repIds;
}

/**
 * Whose Executive Review may this user open?
 *   admin / sysadmin → null (no restriction — every TSM)
 *   manager          → their team plus themselves (getManagerAssignableReps).
 *                      No longer symmetric: a peer manager is not on your team
 *                      merely because you both work the same territory.
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
 * Who may fill or correct a visit report: the assigned rep, a manager that rep
 * reports to, or admin/sysadmin. Same shape as the
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
