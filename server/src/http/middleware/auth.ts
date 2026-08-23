import { createMiddleware } from 'hono/factory';
import { type AppEnv } from '../context.ts';

/**
 * Pass-through until LAI-005.
 *
 * It sits in the chain now, in its SPEC §11.2 position, so that adding real
 * authentication is a change to this file rather than a reordering of `app.ts`.
 * Anonymous requests must continue to reach routes — LAI-005 resolves an
 * `Actor | null` and attaches it; it does not reject here. Rejection is a
 * per-route `assertCan` decision (§6.2).
 */
export const auth = createMiddleware<AppEnv>(async (_c, next) => {
  await next();
});
