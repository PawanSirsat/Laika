import { createMiddleware } from 'hono/factory';
import { LIMITS, type LimitPolicy, type RateLimiter } from '../rate-limit.ts';
import { type AppEnv } from '../context.ts';
import { ApiError } from '../errors.ts';

/**
 * SPEC §6.3's limits, applied per actor. Sits after `auth` in the §11.2 chain
 * because it keys on the resolved actor.
 *
 * Anonymous requests share a bucket keyed by nothing more specific than "anon".
 * That is deliberate for v1: the only unauthenticated endpoints are `/health`
 * and the SPA, and a per-IP bucket behind a reverse proxy needs a trusted
 * `X-Forwarded-For` policy, which is a decision this task should not make
 * quietly. It is noted in the review notes rather than assumed.
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return createMiddleware<AppEnv>(async (c, next) => {
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
