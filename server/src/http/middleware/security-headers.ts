import { createMiddleware } from 'hono/factory';
import { type AppEnv } from '../context.ts';
import { HSTS_VALUE, isHttps } from '../security-headers.ts';

/**
 * Security headers (SPEC §13.1). Hono binding for `http/security-headers.ts`.
 *
 * The policy is built once at startup rather than per request — it depends on
 * the hash of a file that cannot change while the process runs.
 */
export function createSecurityHeaders(contentSecurityPolicy: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    await next();

    // Set after `next()` so these land on every response, including the ones the
    // error handler produces — the 500 path is where a missing `nosniff` would
    // matter most.
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Permitted-Cross-Domain-Policies', 'none');
    c.header('Content-Security-Policy', contentSecurityPolicy);
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');

    // HSTS only over HTTPS. Sent over plain HTTP it is ignored by browsers; sent
    // on localhost it pins that hostname to HTTPS in the developer's browser for
    // two years, which is a genuinely unpleasant thing to do to someone.
    if (isHttps(c.req.url, c.req.header('X-Forwarded-Proto'))) {
      c.header('Strict-Transport-Security', HSTS_VALUE);
    }
  });
}
