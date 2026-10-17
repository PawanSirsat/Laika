import { createMiddleware } from 'hono/factory';
import { type Db } from '../../db/client.ts';
import { type AppEnv } from '../context.ts';
import { conflictError, hashRequest, lookup, remember } from '../idempotency.ts';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * POSTs that keep their own key, so this store neither answers nor records them
 * (LAI-746).
 *
 * This middleware replays **before the route runs** — before `can()` — and its
 * key is the user, not the credential. That is fine for a route whose answer
 * any of the user's credentials may have; it is not for a session-only one
 * (§3.1 `profile.*`), where a token holding a session's key and body was handed
 * the session's `201` without being asked anything. And it stores the response
 * body, which for a rating is the private note.
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
 * The review decisions (D-081, LAI-758): a person's, on a web session. A token
 * holding a session's key and body for one of them is never handed the stored
 * answer — the route runs and refuses it `session_required`.
 */
const DECISION_ROUTES: readonly RegExp[] = [/^\/api\/v1\/tasks\/[^/]+\/(?:accept|send-back)$/];

/**
 * Whether a stored answer may be replayed to a **token** (D-081). The store is
 * keyed by the person, not the credential (LAI-748), so a session's answer is
 * found by the same person's token. Two such answers would hand an agent a
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
 * Replay-safe POSTs (SPEC §6.3).
 *
 * Only POST, and only when the caller supplies the header — the feature is
 * opt-in per request, because a client that has not thought about idempotency
 * gets no benefit from a key the server invented for it.
 *
 * Only successful responses are stored. Replaying a 500 would pin a transient
 * failure in place for 24 hours, so a retry after an error is allowed to
 * actually retry.
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
      keyedByTheRoute(c.req.path)
    ) {
      await next();
      return undefined;
    }

    const body = await c.req.raw.clone().text();
    const fingerprint = hashRequest(c.req.method, c.req.path, body);
    const found = lookup(db, actor.userId, key, fingerprint, now());

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

    if (found.kind === 'replay' && found.response !== undefined) {
      c.header('Idempotent-Replay', 'true');
      return c.body(found.response.body, found.response.status as 200, {
        'Content-Type': 'application/json',
      });
    }

    await next();

    if (c.res.status >= 200 && c.res.status < 300) {
      const stored = await c.res.clone().text();
      remember(db, actor.userId, key, fingerprint, { status: c.res.status, body: stored }, now());
    }

    return undefined;
  });
}
