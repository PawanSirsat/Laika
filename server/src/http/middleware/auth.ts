import { createMiddleware } from 'hono/factory';
import { type Db } from '../../db/client.ts';
import { type Auth } from '../../auth/auth.ts';
import { resolveActor, type ResolvedActor } from '../../auth/resolve-actor.ts';
import { TokenAuthError } from '../../auth/tokens.ts';
import { type AppEnv } from '../context.ts';

/**
 * Resolve the credential to an `Actor` and attach it (SPEC §6.1, §11.2).
 *
 * It never rejects. An anonymous request gets `actor: null` and continues —
 * rejection is a per-route `assertCan` decision (§6.2), and a middleware that
 * 401s everything makes the public routes (`/health`, setup, the SPA) impossible
 * without carving out exceptions that then have to be maintained.
 */
export function authMiddleware(options: { auth: Auth; db: Db }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let actor: ResolvedActor | null = null;

    try {
      actor = await resolveActor(c.req.raw, options);
    } catch (err) {
      // A **presented token** that is refused is a 401, not an anonymous
      // request. Falling through to `actor: null` would turn "your token is
      // revoked" into "you are not signed in", and — where a cookie is also
      // attached — into a silent escalation to that session's full authority.
      //
      // The reason is logged here and nowhere else: it is on the error rather
      // than in `details`, so it never reaches the response body (§6.1).
      if (err instanceof TokenAuthError) {
        c.get('log').warn('auth.token_rejected', {
          request_id: c.get('requestId'),
          reason: err.reason,
        });
        throw err;
      }

      // A malformed or expired cookie is an anonymous request, not a 500.
      c.get('log').warn('auth.resolve_failed', {
        request_id: c.get('requestId'),
        message: err instanceof Error ? err.message : String(err),
      });
    }

    c.set('actor', actor);

    await next();
  });
}

/** Pass-through, for apps built without auth (the LAI-002 HTTP tests). */
export const anonymousAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set('actor', null);
  await next();
});
