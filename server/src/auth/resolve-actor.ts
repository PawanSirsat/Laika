import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type ActorKind, type ProjectRole } from '../db/enums.ts';
import { mergeGrants, readStoredGrants } from '../db/org-grants.ts';
import {
  agentProjectGrants,
  agents,
  projectMemberships,
  projects,
  type tokens,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type Logger } from '../log.ts';
import {
  type Actor,
  type AgentContext,
  type TokenContext,
  type Principal,
  type ProjectRules,
  type SystemPrincipal,
} from '../policy/can.ts';
import { DEFAULT_GRANTS } from '../policy/grants.ts';
import { type Auth } from './auth.ts';
import {
  findTokenById,
  findTokenBySecret,
  LAST_USED_THROTTLE_MS,
  looksLikePlaceholder,
  PLACEHOLDER_MESSAGE,
  TokenAuthError,
  type TokenRejection,
  touchTokenUsage,
  tokenProjectIds,
} from './tokens.ts';

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
  /**
   * The claim generation this request says it acts under (proposal §4.2,
   * LAI-541): REST's `X-Laika-Claim-Generation`, MCP's `claim_generation`.
   * **A claim, not a credential** — the fence in `services/claims.ts` checks it
   * against the task's live claim and the token's agent, and it grants
   * nothing by itself. Absent when the caller sent none.
   */
  claimGeneration?: number | undefined;
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
  /**
   * Receives each `Set-Cookie` better-auth produced while reading the session
   * (LAI-811): the renewed cookie when the session was older than its
   * `updateAge`, or the expiring one when the session was dead.
   *
   * **Absent means the session is not renewed at all.** A caller with no way
   * to deliver the renewed cookie must not slide the database expiry either,
   * or the two fall out of step, which is the defect LAI-811 fixed. The auth
   * middleware passes it only for `/api/` requests; see `middleware/auth.ts`.
   */
  setCookie?: (cookie: string) => void;
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

  // **`returnHeaders`, or the renewal never reaches the browser** (LAI-811).
  //
  // On a session older than `updateAge`, better-auth slides the database
  // expiry out and writes a fresh cookie with the full `Max-Age`. Without
  // `returnHeaders` that cookie was thrown away: the database said the session
  // had weeks left while the browser's copy kept the `Max-Age` it got at
  // sign-in, and dropped it on schedule. `setup.ts` already does this.
  //
  // `disableRefresh` when there is nowhere to deliver the cookie: see
  // `setCookie`. An expiring cookie for a dead session is produced either way,
  // and is likewise only handed over to a caller that asked.
  const setCookie = options.setCookie;
  const { headers, response: session } = await options.auth.api.getSession({
    headers: request.headers,
    query: { disableRefresh: setCookie === undefined },
    returnHeaders: true,
  });
  if (setCookie !== undefined) {
    for (const cookie of headers.getSetCookie()) setCookie(cookie);
  }

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
  if (!found.ok) {
    // The one refusal that may say more: a placeholder is the caller's own
    // configuration showing through, and naming it leaks nothing (D-076).
    if (found.reason === 'malformed' && looksLikePlaceholder(presented)) {
      throw new TokenAuthError('malformed', PLACEHOLDER_MESSAGE);
    }
    throw new TokenAuthError(found.reason);
  }

  const actor = loadActor(db, found.row.userId);
  if (actor === null) throw new TokenAuthError('unknown');
  if (!actor.isActive) throw new TokenAuthError('inactive_user');

  // **An agent's token is refused here, before any handler runs, once its
  // agent is revoked** (D-114). Revoking the agent revokes its tokens in the
  // same transaction, so this is the second lock on the same door: a token
  // row that somehow kept `revoked_at` null still opens nothing.
  const token = tokenContextFor(db, found.row);
  if (!token.ok) throw new TokenAuthError(token.reason);
  if (token.token.agent !== null && token.token.agent !== undefined) {
    touchAgentSeen(db, token.token.agent.id, now);
  }

  touchTokenUsage(db, found.row, now, log);

  return { ...actor, token: token.token };
}

/**
 * A token row that is still good → the credential `can()` narrows by: its
 * scope, its pin, and its registered agent with that agent's grants — or why
 * the agent no longer lets it act (D-114, LAI-534).
 *
 * **The one place a token's context is built**, so every path that turns a
 * row into an actor narrows it the same way. `resolveTokenActor` uses it per
 * request; a credential that outlives its request — an open event stream
 * re-reading its actor (LAI-539) — must use it too, or a reloaded stream keeps
 * the token's pin and drops the agent's grants and revocation. The agent is
 * read from `tokens.agent_id` and from nowhere else.
 *
 * Reads only; it checks nothing about the row's own revocation or expiry,
 * which its callers have already applied (`findTokenBySecret`, and LAI-539's
 * `findTokenById`).
 */
export function tokenContextFor(
  db: Db,
  row: typeof tokens.$inferSelect,
): { ok: true; token: TokenContext } | { ok: false; reason: 'agent_revoked' } {
  const agent = row.agentId === null ? null : loadAgent(db, row.agentId);
  if (row.agentId !== null && agent?.status !== 'active') {
    return { ok: false, reason: 'agent_revoked' };
  }
  return {
    ok: true,
    token: {
      id: row.id,
      scope: row.scope,
      projectIds: tokenProjectIds(row),
      expiresAt: row.expiresAt,
      agent,
    },
  };
}

/** The agent and its grants, as `can()` reads them (§4.63, §4.64). */
export function loadAgent(db: Db, agentId: string): AgentContext | null {
  const row = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (row === undefined) return null;

  const grants = db
    .select({ projectId: agentProjectGrants.projectId, scope: agentProjectGrants.scope })
    .from(agentProjectGrants)
    .where(eq(agentProjectGrants.agentId, agentId))
    .all();

  return {
    id: row.id,
    displayName: row.displayName,
    harness: row.harness,
    deviceLabel: row.deviceLabel,
    status: row.status,
    grants: new Map(grants.map((g) => [g.projectId, g.scope])),
  };
}

/**
 * `agents.last_seen_at`, at most once per {@link LAST_USED_THROTTLE_MS} — the
 * token's own throttle and for its reason: a read must not become a write.
 * The read happens on every request; the write, once a minute at most. A
 * database that cannot be written skips the stamp, as `touchTokenUsage` does.
 */
export function touchAgentSeen(db: Db, agentId: string, now: number): boolean {
  try {
    const result = db
      .update(agents)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(agents.id, agentId),
          or(isNull(agents.lastSeenAt), lte(agents.lastSeenAt, now - LAST_USED_THROTTLE_MS)),
        ),
      )
      .run();
    return result.changes > 0;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_READONLY')) return false;
    throw err;
  }
}

/**
 * An actor resolved earlier → the same actor as it stands at `now`, or why it
 * no longer may act (LAI-539, audit M10).
 *
 * For a credential that outlives its request: an open event stream. Two things
 * the request-time resolution settled can change under it, and both must be
 * read again rather than trusted:
 *
 *  - **The person** — role, memberships, grants, active status — as
 *    `loadActor` reads them.
 *  - **The token**, when the actor arrived on one. Re-reading only the person
 *    is the defect this exists to fix: `loadActor` returns `token: null`, so a
 *    stream that refreshed its actor that way silently became a cookie stream,
 *    escaped the token's project whitelist and scope, and outlived revocation
 *    and expiry.
 *
 * Token checks come first, in the order `resolveTokenActor` applies them, so a
 * revoked token on a deactivated account reports `revoked` either way.
 */
export function reloadActor(
  db: Db,
  previous: ResolvedActor,
  now: number,
): { ok: true; actor: ResolvedActor } | { ok: false; reason: TokenRejection } {
  const presented = previous.token;
  let token: ResolvedActor['token'] = null;

  if (presented !== null && presented !== undefined) {
    const found = findTokenById(db, presented.id, now);
    if (!found.ok) return found;
    // A token belongs to one person for life; a row naming somebody else is
    // not this credential, whatever its id.
    if (found.row.userId !== previous.userId) return { ok: false, reason: 'unknown' };
    // Through `tokenContextFor`, as `resolveTokenActor` does, so the stream
    // keeps the token's registered agent — its grants and its revocation —
    // and not only the pin (integration of LAI-534 and LAI-539).
    const context = tokenContextFor(db, found.row);
    if (!context.ok) return context;
    token = context.token;
  }

  const fresh = loadActor(db, previous.userId);
  if (fresh === null) return { ok: false, reason: 'unknown' };
  if (!fresh.isActive) return { ok: false, reason: 'inactive_user' };

  return { ok: true, actor: { ...fresh, token } };
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
    // What the owner granted each role (§3, LAI-958), read with the role and
    // for the same reason: a grant withdrawn after sign-in must not linger.
    orgGrants: mergeGrants(readStoredGrants(db), DEFAULT_GRANTS),
    // Each space's own rules (D-103, LAI-976), for the same reason: a space
    // that turns its agents off must not wait for their tokens to re-resolve.
    projectRules: loadProjectRules(db),
  };
}

/**
 * The spaces whose rules differ from the defaults, by id — `can()` treats an
 * absent one as the default, so the map holds only what changes an answer and
 * stays as small as the number of spaces anybody has changed.
 */
export function loadProjectRules(db: Db): Map<string, ProjectRules> {
  const columns = {
    id: projects.id,
    taskCreateMinRole: projects.taskCreateMinRole,
    agentsAllowed: projects.agentsAllowed,
  };
  // Two reads rather than one `OR`, so each is a search of `projects_rules_idx`
  // and neither walks the table: every `lead` space, and the `member` spaces
  // with agents off.
  const rows = [
    ...db.select(columns).from(projects).where(eq(projects.taskCreateMinRole, 'lead')).all(),
    ...db
      .select(columns)
      .from(projects)
      .where(and(eq(projects.taskCreateMinRole, 'member'), eq(projects.agentsAllowed, false)))
      .all(),
  ];
  return new Map(
    rows.map((row) => [
      row.id,
      { taskCreateMinRole: row.taskCreateMinRole, agentsAllowed: row.agentsAllowed },
    ]),
  );
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

/**
 * Is this caller a program rather than a person at a keyboard? (LAI-266)
 *
 * Board columns made the §5 transition table too strict to drag against: with
 * user-made columns, `todo → done` is an ordinary gesture and
 * `ALLOWED_TRANSITIONS` refuses it. The owner's decision was to widen the table
 * for people and leave it exactly as it is for agents.
 *
 * **The agent table alone did not keep agents out of `done`.** This comment
 * said it kept §5's *"Agents do not self-certify"* true, and it did not: the
 * table held `review → done`, so a token could accept its own work in review
 * (audit H6). Since LAI-758 (D-082) the table has no edge into `done`, and
 * `changeStatus` refuses any principal this function calls an agent a move into
 * a done-**category** status before the table is asked — the rule lives there,
 * and this function only says who it applies to.
 *
 * **`isSystemPrincipal` is not that question, and reaching for it is the
 * mistake this function exists to prevent.** It means `kind === 'system'` — the
 * §11.6 cron and §10.1's webhook. A token-bearing agent is an ordinary
 * `ResolvedActor` (see `resolveTokenActor` above: *"a token is a way for
 * somebody to act as themselves from somewhere else"*), so branching on it would
 * hand every MCP caller the widened rule — the one outcome the split exists to
 * prevent.
 *
 * The real discriminator is `token`, which `Actor` documents as *"Absent or
 * `null` when the request arrived on a session cookie (§6.1)"*, and which the
 * browser never carries.
 *
 * ## Why this is not `activityActor(p).actorKind !== 'user'`
 *
 * It would be one expression and one source of truth, and it is the wrong
 * source. `activityActor` answers **attribution** — what the `activity` row
 * says — and `can()`'s docblock draws that line deliberately: *"authority and
 * attribution are different questions and a principal that carries an identity
 * acquires one by accident."* Deriving authority from attribution crosses it.
 *
 * The two must nonetheless agree, so a test asserts they do across all three
 * principal shapes. Separate in code, undriftable in test.
 */
export function isAgentPrincipal(principal: Principal): boolean {
  if (isSystemPrincipal(principal)) return true;

  return principal.token !== null && principal.token !== undefined;
}
