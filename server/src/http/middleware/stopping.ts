import { createMiddleware } from 'hono/factory';
import { ApiError } from '../../errors.ts';
import { type AppEnv } from '../context.ts';

/**
 * Refuse API requests once shutdown has begun (SPEC §11.2, LAI-214).
 *
 * ## What `server.close()` does not do
 *
 * It stops accepting new **TCP connections**. A browser that already holds an
 * idle keep-alive connection to the origin can reuse it — and did: three seconds
 * into a ten-second grace window, a dev instance answered two fresh
 * `GET /api/v1/events` with `200` and a `ready` frame, from a process that was
 * about to be force-killed.
 *
 * **LAI-142 closed the observed path.** Idle connections are now reaped every
 * 50ms rather than once, so the socket in that report would have been gone
 * before the browser reused it — measured: a pooled keep-alive connection is
 * refused at every delay from 0ms upward.
 *
 * **This closes the race that reaping cannot.** A connection that is *busy* when
 * shutdown starts is not idle, so it is not reaped; when its request finishes it
 * is briefly reusable before the next sweep. That window is small, timing
 * dependent, and exactly the kind of thing that shows up once on somebody's
 * machine and never in a test — so the answer is a flag rather than a shorter
 * interval.
 *
 * ## Why `503` and why every API path
 *
 * §9.2's *"degrades, it never errors"* is about malformed input, not about a
 * server that has decided to stop: a client told `200 ready` by a process that
 * will not deliver a frame is worse off than one told to come back. `503` with
 * `Retry-After` is the answer a client can act on, and it is what every
 * load balancer and every `EventSource` already understands.
 *
 * Every API path rather than `/events` alone, because the reused-connection
 * route serves any of them — the stream is only where it is visible.
 *
 * **`/health` is exempt**, deliberately: a supervisor asking whether to keep
 * routing traffic here needs an answer, and "I am draining" is the most useful
 * one it can get. Answering `503` there would be the same information; answering
 * nothing would not.
 */
export function stoppingGate(isStopping: () => boolean) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const path = c.req.path;
    const isApi = path === '/api' || path.startsWith('/api/');

    if (isApi && !path.startsWith('/api/v1/health') && isStopping()) {
      throw new ApiError('unavailable', 'This server is shutting down', {
        retry_after_seconds: 1,
      });
    }

    await next();
  });
}
