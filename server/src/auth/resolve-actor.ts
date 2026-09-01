import { eq } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type ActorKind, type ProjectRole } from '../db/enums.ts';
import { projectMemberships, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type Logger } from '../log.ts';
import { type Actor, type Principal, type SystemPrincipal } from '../policy/can.ts';
import { type Auth } from './auth.ts';
import { findTokenBySecret, TokenAuthError, touchTokenUsage, tokenProjectIds } from './tokens.ts';

/**
 * Turn a request into an `Actor`, or `null` when nobody is signed in.
 *
 * Shaped as "request in, actor out" deliberately (LAI-005 notes): personal access
 * tokens arrive in M3 as a second credential source, and they should slot in as
 * another branch here rather than as a second, parallel notion of who is asking.
 * Everything downstream — `can()`, the handlers, the MCP tools — sees one type.
 */

export interface ResolvedActor extends Actor {
  email: string;
  name: string;
  /** Every project the user belongs to, so `/me` can report them (§6.4). */
  memberships: { projectId: string; role: ProjectRole }[];
}

export interface ResolveActorOptions {
  auth: Auth;
  db: Db;
  /**
   * Optional so the LAI-002 tests can resolve without one. Threaded because
   * `touchTokenUsage` has one thing to say and no other way to say it: a
   * database it cannot write (LAI-156).
   */
  log?: Logger;
}

/**
 * `Authorization: Bearer …`, or `null` when the header is absent.
 *
 * Case-insensitive on the scheme, because RFC 7235 says the scheme is, and a
 * client sending `bearer` is not making a mistake worth a 401 over.
 */
function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function resolveActor(
  request: Request,
  options: ResolveActorOptions,
  now: number = Date.now(),
): Promise<ResolvedActor | null> {
  const bearer = bearerFrom(request);

  // ## A token and a cookie never both apply, and the token wins
  //
  // Two reasons, and they point the same way:
  //
  //  - **Explicit beats ambient.** A browser attaches its cookie to every
  //    request without being asked; an `Authorization` header is something the
  //    caller deliberately set. The deliberate credential is the one that says
  //    what the caller meant.
  //  - **Narrower beats wider.** A token carries a scope and possibly a project
  //    whitelist; a session carries the user's full authority. Letting the
  //    cookie win would let an agent that happens to hold one *escape* the
  //    limits of the token it presented — the one direction this must never go.
  //
  // And a **bad** bearer is a `401`, never a fall-through to the cookie. Falling
  // back would mean an expired or revoked token silently acting with the full
  // authority of whatever session was also attached, which is precisely the
  // escalation the previous paragraph rules out.
  if (bearer !== null) return resolveTokenActor(options.db, bearer, now, options.log);

  const session = await options.auth.api.getSession({ headers: request.headers });
  if (session === null) return null;

  const actor = loadActor(options.db, session.user.id);

  // **A deactivated account stops here, not at each route** (LAI-442).
  //
  // The token path has refused an inactive user since LAI-005
  // (`resolveTokenActor`, below); the cookie path did not, and every route was
  // relying on its own `can()` calls to notice. They do — §3.3 rule 3 denies a
  // deactivated user everything — but a *filter* that denies each project in
  // turn answers `200 []`, and "you have no projects" is a different claim from
  // "your account is switched off". `GET /me` was the only endpoint that said
  // the true thing, because it looked at the field directly.
  //
  // Authentication is where an inactive account stops. §3.3 rule 1's argument
  // for `can()` — one authority, called everywhere — applies here and there was
  // none.
  //
  // **`403`, where the token path gives `401`**, and the difference is real: a
  // refused token is a bad credential, while a valid cookie for a deactivated
  // person is a good credential whose holder may do nothing. What converges is
  // the *place*, not the status.
  if (actor !== null && !actor.isActive) {
    throw new ApiError('forbidden', 'This account has been deactivated');
  }

  return actor;
}

/**
 * A presented secret → the token's user, carrying that user's real roles.
 *
 * **No service account and no elevated mode** (SPEC §7): a token is a way for
 * somebody to act as themselves from somewhere else, so the actor is loaded the
 * same way a cookie's is and the only difference is the `token` context that
 * `can()` then narrows by.
 *
 * Why the reason is logged and not returned: telling a caller *which* of
 * unknown, expired or revoked they hit distinguishes "this token never existed"
 * from "this token existed" — free information about other people's tokens, on
 * an unauthenticated endpoint.
 */
export function resolveTokenActor(
  db: Db,
  presented: string,
  now: number,
  log?: Logger,
): ResolvedActor {
  const found = findTokenBySecret(db, presented, now);
  if (!found.ok) throw new TokenAuthError(found.reason);

  const actor = loadActor(db, found.row.userId);
  if (actor === null) throw new TokenAuthError('unknown');
  if (!actor.isActive) throw new TokenAuthError('inactive_user');

  touchTokenUsage(db, found.row, now, log);

  return {
    ...actor,
    token: {
      id: found.row.id,
      scope: found.row.scope,
      projectIds: tokenProjectIds(found.row),
    },
  };
}

/**
 * The three attribution fields every `activity` row needs (§4.8, LAI-403).
 *
 * A helper rather than three lines repeated at eighteen call sites: the two
 * fields that vary are exactly the two that say the request arrived on a token.
 * Spreading one object means a new call site cannot record a cookie's
 * attribution for an agent's request by forgetting a field.
 *
 * ## The system principal returns `null`, and §4.8 already said so
 *
 * `activity.actor_id` is documented *"Null for system actors — webhooks (§6.1)
 * and cron (§11.6)"*, and `actor_kind` has `system` for *"no human — cron or
 * webhook"*. So this is not a new rule; it is the first caller that needs it
 * (LAI-446).
 *
 * **LAI-448 deliberately left this alone**: `SystemPrincipal` carries no
 * `actor_kind` and no `actor_id`, because authority and attribution are
 * different questions and a principal that carries an identity acquires one by
 * accident. This is where the second question is answered, and it is answered
 * from §4.8 rather than from the principal.
 */
export function activityActor(principal: Principal): {
  actorId: string | null;
  actorKind: ActorKind;
  actorTokenId: string | null;
} {
  if (isSystemPrincipal(principal)) {
    return { actorId: null, actorKind: 'system', actorTokenId: null };
  }

  const token = principal.token;

  return {
    actorId: principal.userId,
    actorKind: token === null || token === undefined ? 'user' : 'agent',
    actorTokenId: token?.id ?? null,
  };
}

/**
 * Load the actor from its id.
 *
 * Read from the database rather than trusted from the session payload: org role
 * and active status change, and a session minted before a demotion must not keep
 * carrying the old role around.
 */
export function loadActor(db: Db, userId: string): ResolvedActor | null {
  const row = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      orgRole: users.orgRole,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (row === undefined) return null;

  const memberships = db
    .select({ projectId: projectMemberships.projectId, role: projectMemberships.role })
    .from(projectMemberships)
    .where(eq(projectMemberships.userId, userId))
    .all();

  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    orgRole: row.orgRole,
    isActive: row.isActive === 1,
    // `can()` takes one already-resolved project role (§3.3 rule 2). The caller
    // picks which project the request concerns; see `withProject`.
    projectRole: null,
    memberships,
    token: null,
  };
}

/**
 * The actor as `can()` wants it for a specific project — the membership row
 * resolved, or `null` for a non-member.
 *
 * A helper rather than something each handler does by hand: a handler that
 * forgets it passes `projectRole: null` and silently denies, which looks like a
 * permissions bug and is very hard to spot in review.
 */
/**
 * Everything a service can be asked to act for: a real person's resolved actor,
 * or §3.4's principal. Narrower than `Principal`, which admits a bare `Actor`
 * with no memberships to narrow.
 */
export type ServiceCaller = ResolvedActor | SystemPrincipal;

export function withProject(principal: ResolvedActor, projectId: string): ResolvedActor;
export function withProject(principal: SystemPrincipal, projectId: string): SystemPrincipal;
export function withProject(principal: ServiceCaller, projectId: string): ServiceCaller;
/**
 * **Overloads rather than a generic with a cast.** The generic version compiles
 * only with an `as T`, and a cast here would be asserting exactly the thing the
 * function is supposed to establish — that what comes out is the same shape as
 * what went in. Three signatures say it and the compiler checks it.
 */
export function withProject(principal: ServiceCaller, projectId: string): ServiceCaller {
  // A system principal has no memberships to look up — its project scope is the
  // delivery that resolved, and `can()` compares it to the resource directly
  // (§3.4). Returning it unchanged is not a special case so much as the absence
  // of one: there is nothing to narrow.
  if (isSystemPrincipal(principal)) return principal;

  const membership = principal.memberships.find((m) => m.projectId === projectId);

  return { ...principal, projectRole: membership?.role ?? null };
}

/** Narrow to the §3.4 principal. Exported so services can branch on it. */
export function isSystemPrincipal(principal: Principal): principal is SystemPrincipal {
  return 'kind' in principal && principal.kind === 'system';
}
