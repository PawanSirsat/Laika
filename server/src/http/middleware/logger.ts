import { createMiddleware } from 'hono/factory';
import { type Logger } from '../../log.ts';
import { type AppEnv } from '../context.ts';

/**
 * One structured line per request (SPEC §13.2).
 *
 * `actor_id`, `actor_kind` and `token_id` are emitted as `null` rather than
 * omitted — the field list is part of the log contract, and a consumer that has
 * to distinguish "absent" from "anonymous" has a worse job than one reading a
 * stable shape. LAI-005 fills them in.
 */
export function requestLogger(log: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('log', log);

    const startedAt = performance.now();

    try {
      await next();
    } finally {
      log.info('http.request', {
        request_id: c.get('requestId'),
        actor_id: null,
        actor_kind: null,
        token_id: null,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  });
}
