import { createMiddleware } from 'hono/factory';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { type Auth } from '../../auth/auth.ts';
import { resolveActor, type ResolvedActor } from '../../auth/resolve-actor.ts';
import { TokenAuthError } from '../../auth/tokens.ts';
import { type AppEnv } from '../context.ts';

/**
 * Resolve the credential to an `Actor` and attach it (SPEC §6.1, §11.2).
 *
 * **A request that presents nothing** gets `actor: null` and continues —
 * rejection is a per-route `assertCan` decision (§6.2), and a middleware that
 * 401s everything makes the public routes (`/health`, setup, the SPA) impossible
 * without carving out exceptions that then have to be maintained.
 *
 * **A request that presents something and is refused does not.** `actor: null`
 * means "nobody is asking", and three things are not that: a refused token
 * (`TokenAuthError`), a deactivated account (`ApiError`, LAI-442), and the
 * database being unwritable (LAI-437). Each used to arrive at the client as
 * *"Not signed in"*, which is a different claim from any of them and sends the
 * reader somewhere that cannot help.
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
      // **`TokenAuthError` is checked first because it *is* an `ApiError`**
      // (`tokens.ts:116`), so an `instanceof ApiError` test above this one
      // matches every rejected token and this branch becomes unreachable.
      //
      // It was unreachable, from LAI-442 until now — that change added the
      // `ApiError` branch above it, and **every token rejection has been logged
      // as `auth.session_refused` with `code: 'unauthorized'` ever since,
      // losing `reason`.** Unknown, revoked, expired and inactive_user all
      // became the same line, which is the one thing this log exists to tell
      // apart, and `resolve-actor.ts`'s note that the reason is "logged and not
      // returned" quietly stopped being true.
      //
      // Nothing caught it because the status was right either way. A mutation
      // that should have turned this file red and did not is what found it.
      if (err instanceof TokenAuthError) {
        c.get('log').warn('auth.token_rejected', {
          request_id: c.get('requestId'),
          reason: err.reason,
        });
        throw err;
      }

      // A deliberate refusal is not an anonymous request either (LAI-442). The
      // resolver throws `ApiError` when a session belongs to a deactivated
      // account; swallowing it here would turn "your account is switched off"
      // into "you are not signed in", which is the same class of wrong answer
      // this task exists to remove one layer down.
      if (err instanceof ApiError) {
        c.get('log').warn('auth.session_refused', {
          request_id: c.get('requestId'),
          code: err.code,
        });
        throw err;
      }

      // ## Anything left is the infrastructure, not the credential (LAI-437)
      //
      // This used to fall through to `actor: null`, so the route then answered
      // `401 unauthorized — "Not signed in"`. On a restored database file owned
      // by the wrong user, that is what **every** token request returned: the
      // resolver's `last_used_at` write threw `SQLITE_READONLY`, and an
      // unwritable disk was reported as a bad credential.
      //
      // **It sends the operator to the wrong place.** "Not signed in" means
      // rotate the token, mint a new one, check you pasted it correctly — none
      // of which can work, and every minute spent there is a minute the disk is
      // not being looked at. Same family as LAI-224 (`403` rendered as "can't
      // reach the instance") and LAI-090 (a rate-limited sign-in rendered as
      // "email or password is wrong").
      //
      // **The old comment here said "a malformed or expired cookie is an
      // anonymous request, not a 500", and that case does not exist.** Measured
      // rather than reasoned about: better-auth's `getSession` **returns `null`**
      // for a garbage cookie, a nonsense header and a well-formed-but-invalid
      // token alike — it does not throw, so it never reaches this catch and
      // `session === null` above already handles it. The comment was defending a
      // path that cannot be taken, which is how the swallow survived review.
      //
      // So: **no string matching on the message** — the two credential failures
      // are named types and are rethrown above; whatever is left is by
      // definition not one of them. Rethrowing rather than wrapping in
      // `ApiError('internal')` on purpose: `createErrorHandler`'s unhandled path
      // logs the **stack** and hands the client the `request_id` to quote
      // (§13.2), both of which a wrapper would throw away.
      //
      // The `auth.resolve_failed` line stays. It is why this was diagnosable in
      // two minutes: it names the layer, where `http.unhandled` names only the
      // request.
      c.get('log').warn('auth.resolve_failed', {
        request_id: c.get('requestId'),
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
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
