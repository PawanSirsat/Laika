import { createMiddleware } from 'hono/factory';
import { type Db } from '../../db/client.ts';
import { type AppEnv } from '../context.ts';
import { conflictError, hashRequest, lookup, remember } from '../idempotency.ts';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

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
    if (c.req.method !== 'POST' || key === undefined || key === '' || actor === null) {
      await next();
      return undefined;
    }

    const body = await c.req.raw.clone().text();
    const fingerprint = hashRequest(c.req.method, c.req.path, body);
    const found = lookup(db, actor.userId, key, fingerprint, now());

    if (found.kind === 'conflict') throw conflictError(key);

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
