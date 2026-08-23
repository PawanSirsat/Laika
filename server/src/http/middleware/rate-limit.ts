import { createMiddleware } from 'hono/factory';
import { type AppEnv } from '../context.ts';

/**
 * Pass-through until LAI-006, which owns the in-process token bucket and the
 * `429` + `Retry-After` response (SPEC §6.3).
 *
 * Placed after `auth` deliberately: the real limiter keys on the resolved actor
 * and token, so it can only run once auth has produced them.
 */
export const rateLimit = createMiddleware<AppEnv>(async (_c, next) => {
  await next();
});
