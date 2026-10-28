import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { type ResolvedActor, withProject } from '../../auth/resolve-actor.ts';
import { type Db } from '../../db/client.ts';
import { projects, tasks } from '../../db/schema.ts';
import { type ProjectAction, can } from '../../policy/can.ts';
import { type AppEnv } from '../context.ts';
import { AUTH_BASE_PATH } from '../../auth/auth.ts';
import { conflictError, hashRequest, idempotencyOwner, lookup, remember } from '../idempotency.ts';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * POSTs that keep their own key, so this store neither answers nor records them
 * (LAI-746).
 *
 * This middleware replays **before the route runs** — before `can()`. Its key
 * was the user, not the credential, when this list was made; a token's is its
 * own since LAI-534 (`idempotencyOwner`), but a session's is still the
 * person's, and the store keeps the response body, which for a rating is the
 * private note.
 *
 * So these routes take the header themselves and answer a retry from their own
 * row, after the permission: `POST /users/:id/ratings` keeps the key on the
 * rating (§4.21). Narrower than re-keying every route by credential, which is
 * filed as its own task.
 */
const KEYED_BY_THE_ROUTE: readonly RegExp[] = [/^\/api\/v1\/users\/[^/]+\/ratings$/];

export function keyedByTheRoute(path: string): boolean {
  return KEYED_BY_THE_ROUTE.some((pattern) => pattern.test(path));
}

/**
 * The review decisions (D-082, LAI-758): a person's, on a web session. A token
 * holding a session's key and body for one of them is never handed the stored
 * answer — the route runs and refuses it `session_required`.
 */
const DECISION_ROUTES: readonly RegExp[] = [/^\/api\/v1\/tasks\/[^/]+\/(?:accept|send-back)$/];

/**
 * Whether a stored answer may be replayed to a **token** (D-082). The store was
 * keyed by the person, not the credential (LAI-748), so a session's answer was
 * found by the same person's token; since LAI-534 a token reads only its own
 * rows, and this stays as the second lock. Two such answers would hand an agent a
 * success the gate refuses it: a review decision, and any task moved into a
 * done category — a stored task view saying `status: "done"` was a session's
 * move, because a token's is refused before anything is stored. For those, the
 * route runs instead and gives the token its own answer.
 */
export function tokenMayReplay(path: string, storedBody: string): boolean {
  if (DECISION_ROUTES.some((pattern) => pattern.test(path))) return false;
  try {
    const parsed: unknown = JSON.parse(storedBody);
    return !(
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { status?: unknown }).status === 'done'
    );
  } catch {
    return true;
  }
}

/**
 * **The POSTs whose answers the store keeps — an allow-list** (LAI-534 round
 * 2, Codex review of PR #102).
 *
 * The store replays before the route runs, so a stored answer is handed back
 * without the route's `can()` being asked again. Each entry therefore names
 * the question its route asks, and {@link idempotencyMiddleware} asks it again
 * of the actor as it is **now** — role, membership, agent grant, token scope
 * and pin — before replaying. Refused, the route runs instead and gives the
 * answer a fresh request gets.
 *
 * **An allow-list rather than a deny-list of secret routes**, because of which
 * way each is wrong when somebody forgets. A route left off this list loses
 * deduplication of retries, visibly and harmlessly. A secret route left off a
 * deny-list would persist its secret and replay it before `can()` — the defect
 * this replaced. `markOneTimeSecret` stays as the second lock: a marked answer
 * is never stored even if its route is listed here.
 *
 * Each entry is a route that **creates** something, where a retried request
 * would otherwise make a second one, and whose route asks exactly one
 * project-scoped (or org) `can()` — so the question can be stated here and
 * held equal to the route's by `test/http/idempotency.test.ts`. A route
 * needing more than that does not belong on the list.
 */
interface CacheableRoute {
  readonly pattern: RegExp;
  /** The route's own `can()`, against the actor as it stands now. */
  readonly mayStill: (db: Db, actor: ResolvedActor, param: string | undefined) => boolean;
}

function inProjectBySlug(action: ProjectAction) {
  return (db: Db, actor: ResolvedActor, slug: string | undefined): boolean => {
    if (slug === undefined) return false;
    const project = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .get();
    if (project === undefined) return false;
    return can(withProject(actor, project.id), action, { projectId: project.id });
  };
}

function inTaskProject(action: ProjectAction) {
  return (db: Db, actor: ResolvedActor, taskId: string | undefined): boolean => {
    if (taskId === undefined) return false;
    const task = db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    if (task === undefined) return false;
    return can(withProject(actor, task.projectId), action, { projectId: task.projectId });
  };
}

export const CACHEABLE_ROUTES: readonly CacheableRoute[] = [
  // `createProject`: `project.create`, an org action.
  { pattern: /^\/api\/v1\/projects$/, mayStill: (_db, actor) => can(actor, 'project.create') },
  // `createTask`: `task.create` in the project.
  { pattern: /^\/api\/v1\/projects\/([^/]+)\/tasks$/, mayStill: inProjectBySlug('task.create') },
  // `createSprint`: `sprint.manage` in the project.
  {
    pattern: /^\/api\/v1\/projects\/([^/]+)\/sprints$/,
    mayStill: inProjectBySlug('sprint.manage'),
  },
  // `addComment`: `comment.create` in the task's project.
  { pattern: /^\/api\/v1\/tasks\/([^/]+)\/comments$/, mayStill: inTaskProject('comment.create') },
  // `addTaskDependency`: `task.dependency.write` in the task's project.
  {
    pattern: /^\/api\/v1\/tasks\/([^/]+)\/dependencies$/,
    mayStill: inTaskProject('task.dependency.write'),
  },
];

/** The listed route a path is, and its parameter — or `null`: not stored. */
export function cacheableRoute(
  path: string,
): { route: CacheableRoute; param: string | undefined } | null {
  for (const route of CACHEABLE_ROUTES) {
    const match = route.pattern.exec(path);
    if (match !== null) {
      const raw = match[1];
      return { route, param: raw === undefined ? undefined : decodeURIComponent(raw) };
    }
  }
  return null;
}

/**
 * Replay-safe POSTs (SPEC §6.3).
 *
 * Only POST, only a route on {@link CACHEABLE_ROUTES}, and only when the
 * caller supplies the header — the feature is opt-in per request, because a client that has not thought about idempotency
 * gets no benefit from a key the server invented for it.
 *
 * Only successful responses are stored. Replaying a 500 would pin a transient
 * failure in place for 24 hours, so a retry after an error is allowed to
 * actually retry.
 *
 * **Never an answer that reveals a secret** (LAI-534): a route that returns a
 * token, a link or a webhook secret once calls `markOneTimeSecret`, and the
 * answer is not stored, so the plaintext is not persisted and cannot be
 * replayed. **And a token's rows are its own** (`idempotencyOwner`): a
 * registered agent's token, or any other token of the same person, never
 * receives an answer another credential earned — the route runs and `can()`
 * answers it. better-auth's routes under `/api/v1/auth/` are not touched.
 */
export function idempotencyMiddleware(db: Db, now: () => number = Date.now) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER);
    const actor = c.get('actor');

    // Unauthenticated callers have no actor to scope a key to, and scoping by
    // anything else would let one caller replay another's response.
    if (
      c.req.method !== 'POST' ||
      key === undefined ||
      key === '' ||
      actor === null ||
      keyedByTheRoute(c.req.path) ||
      // better-auth's own routes answer with session tokens in the body, and
      // keep their own rules about retries: the store has no business there.
      c.req.path.startsWith(`${AUTH_BASE_PATH}/`)
    ) {
      await next();
      return undefined;
    }

    // Only the allow-list is stored or replayed (LAI-534 round 2). Anything
    // else runs as though no key had been sent.
    const listed = cacheableRoute(c.req.path);
    if (listed === null) {
      await next();
      return undefined;
    }

    const body = await c.req.raw.clone().text();
    const fingerprint = hashRequest(c.req.method, c.req.path, body);
    const owner = idempotencyOwner(actor);
    const found = lookup(db, owner, key, fingerprint, now());

    if (found.kind === 'conflict') throw conflictError(key);

    const isToken = actor.token !== null && actor.token !== undefined;
    if (
      found.kind === 'replay' &&
      found.response !== undefined &&
      isToken &&
      !tokenMayReplay(c.req.path, found.response.body)
    ) {
      // The route answers this token itself, and nothing is stored over the
      // session's row: the key stays the session's.
      await next();
      return undefined;
    }

    // **Asked again, of the actor as it is now** (LAI-534 round 2): a stored
    // answer is not a permission. Refused, the route runs and gives the answer
    // a fresh request gets; the stored row stays the one that was earned.
    if (
      found.kind === 'replay' &&
      found.response !== undefined &&
      !listed.route.mayStill(db, actor, listed.param)
    ) {
      await next();
      return undefined;
    }

    if (found.kind === 'replay' && found.response !== undefined) {
      c.header('Idempotent-Replay', 'true');
      return c.body(found.response.body, found.response.status as 200, {
        'Content-Type': 'application/json',
      });
    }

    await next();

    // An answer that reveals a secret is never stored (LAI-534): not the
    // secret, and not a row a retry could replay it from.
    if (c.res.status >= 200 && c.res.status < 300 && c.get('oneTimeSecret') !== true) {
      const stored = await c.res.clone().text();
      remember(db, owner, key, fingerprint, { status: c.res.status, body: stored }, now());
    }

    return undefined;
  });
}
