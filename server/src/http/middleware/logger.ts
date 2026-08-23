import { createMiddleware } from 'hono/factory';
import { type Logger } from '../../log.ts';
import { type AppEnv } from '../context.ts';

/**
 * One structured line per request (SPEC §13.2).
 *
 * `actor_id`, `actor_kind` and `token_id` are emitted as `null` rather than
 * omitted — the field list is part of the log contract, and a consumer that has
 * to distinguish "absent" from "anonymous" has a worse job than one reading a
 * stable shape.
 *
 * The logger runs *before* auth in the §11.2 chain, so it reads the actor in its
 * `finally` block — by then the auth middleware downstream has set it. Reading it
 * up front would log every request as anonymous.
 */
export function requestLogger(log: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('log', log);

    const startedAt = performance.now();

    try {
      await next();
    } finally {
      const actor = c.get('actor');

      log.info('http.request', {
        request_id: c.get('requestId'),
        actor_id: actor?.userId ?? null,
        // `agent` once a request arrives on a token (M3); every credential today
        // is a cookie session (§6.1).
        actor_kind: actor === null || actor === undefined ? null : 'user',
        token_id: actor?.token === null || actor?.token === undefined ? null : 'token',
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  });
}
