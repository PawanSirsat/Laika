import { createMiddleware } from 'hono/factory';
import { type AppEnv } from '../context.ts';

/**
 * Security headers (SPEC §13.1).
 *
 * Written out rather than delegated to `hono/secure-headers` because two of the
 * decisions here are conditional and one is a policy this repo has to own:
 * HSTS must not be sent over plain HTTP, and the CSP has to match the document
 * this server actually serves.
 */

/**
 * Content-Security-Policy.
 *
 * `script-src 'self'` with **no** `'unsafe-inline'` is the §13.1 requirement, and
 * it is the one that matters: it is what stops an injected `<script>` from
 * running at all.
 *
 * `style-src` does allow `'unsafe-inline'`, deliberately and narrowly. The
 * committed fallback document (LAI-016) carries its CSS in a `<style>` block so
 * that a server with no SPA build still renders something legible, and §13.1
 * asks for "no inline **script**", not no inline style. When the real SPA lands
 * (LAI-007) this should tighten to hashes or `'self'` — see the note on that
 * task; it is not something to guess at before Vite's output exists.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // The SPA talks to its own origin only; SSE (§11.5) is same-origin too.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  // Belt and braces with X-Frame-Options, which older browsers honour instead.
  "frame-ancestors 'none'",
].join('; ');

/** Two years, the value browsers require for preload eligibility. */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Was this request served over HTTPS?
 *
 * Behind a reverse proxy (the documented deployment — `docker/Caddyfile.example`)
 * the connection to Node is plain HTTP and only `X-Forwarded-Proto` says
 * otherwise. That header is client-controllable when nothing trusted sets it, but
 * the consequence here is limited to sending an HSTS header that a plain-HTTP
 * browser ignores — it cannot downgrade anything.
 */
export function isHttps(url: string, forwardedProto: string | undefined): boolean {
  if (forwardedProto !== undefined && forwardedProto !== '') {
    // Proxies may append: "https, http". The first hop is the client's.
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }

  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();

  // Set after `next()` so these land on every response, including the ones the
  // error handler produces.
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Permitted-Cross-Domain-Policies', 'none');
  c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');

  // HSTS only over HTTPS. Sent over plain HTTP it is ignored by browsers; sent
  // on localhost it pins that hostname to HTTPS in the developer's browser for
  // two years, which is a genuinely unpleasant thing to do to someone.
  if (isHttps(c.req.url, c.req.header('X-Forwarded-Proto'))) {
    c.header('Strict-Transport-Security', HSTS_VALUE);
  }
});
