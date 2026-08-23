import { createMiddleware } from 'hono/factory';
import { LIMITS, type LimitPolicy, type RateLimiter } from '../rate-limit.ts';
import { type AppEnv } from '../context.ts';
import { ApiError } from '../errors.ts';
import { isReservedPath } from '../static.ts';

/**
 * SPEC §6.3's limits, applied per actor. Sits after `auth` in the §11.2 chain
 * because it keys on the resolved actor.
 *
 * ## What is deliberately not limited (LAI-030)
 *
 * **The liveness probe.** `GET /api/v1/health` is exempt. The container's
 * `HEALTHCHECK` calls it every 30s and marks the container unhealthy after three
 * failures, so rate-limiting it means a burst of anonymous traffic exhausts the
 * shared bucket, the probe gets a `429`, and the orchestrator **restarts a server
 * that was working**. Load becomes an outage, and the restart makes it worse.
 * A liveness probe that can be rate-limited is not a liveness probe.
 *
 * **Static assets and the SPA document.** §6.3 is the REST API's contract; a
 * single page load pulls a dozen files, so counting them against an API budget
 * measures the wrong thing. Serving a file from disk is also not the cost this
 * limiter exists to protect.
 *
 * ## Anonymous requests share one bucket
 *
 * Everything unauthenticated that *is* limited shares a single bucket. The
 * alternative is per-IP, and behind a reverse proxy — the documented deployment
 * (§11.7) — every request carries the proxy's address unless `X-Forwarded-For` is
 * trusted. Trusting that header without knowing which hop set it lets any client
 * invent its own identity and defeat the limiter completely, which is strictly
 * worse than one shared bucket. Per-IP needs a trusted-proxy configuration first;
 * until Laika has one, and until an expensive unauthenticated endpoint exists to
 * protect, sharing is the honest default.
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!isLimited(c.req.path)) {
      await next();
      return;
    }

    const { key, policy } = classify(c.req.path, c.get('actor')?.userId ?? null);
    const decision = limiter.take(key, policy);

    c.header('X-RateLimit-Limit', String(policy.perMinute));
    c.header('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiError('rate_limited', 'Too many requests', {
        retry_after_seconds: decision.retryAfterSeconds,
      });
    }

    await next();
  });
}

/** The liveness probe (§11.7, `docker/Dockerfile`'s HEALTHCHECK). */
export const HEALTH_PATH = '/api/v1/health';

/**
 * Whether this path is subject to §6.3's limits at all.
 *
 * Reserved prefixes — `/api`, `/mcp`, `/webhooks` — are the API surface. Anything
 * else is a static asset or the SPA document.
 */
export function isLimited(path: string): boolean {
  if (path === HEALTH_PATH) return false;
  return isReservedPath(path);
}

export function classify(
  path: string,
  actorId: string | null,
): { key: string; policy: LimitPolicy } {
  const who = actorId ?? 'anonymous';

  // Heartbeats are frequent, cheap and get their own budget (§6.3, §9.1) so a
  // busy agent cannot spend its whole session allowance on presence pings.
  if (path.startsWith('/api/v1/heartbeats')) {
    return { key: `heartbeat:${who}`, policy: LIMITS.heartbeat };
  }

  // Token-authenticated requests get the tighter budget once tokens land (M3);
  // until then every authenticated request is a cookie session.
  return { key: `session:${who}`, policy: LIMITS.session };
}
