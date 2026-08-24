/**
 * Content-Security-Policy construction (SPEC §13.1).
 *
 * Pure half of the paired module (CONVENTIONS §3); the Hono binding lives at
 * `http/middleware/security-headers.ts` under the same name.
 */

import { createHash } from 'node:crypto';

/** Two years — the value browsers require for preload eligibility. */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * The sha256 of every inline `<style>` block in an HTML document, formatted as a
 * CSP source expression.
 *
 * Computed from the file rather than pasted as a literal: a hardcoded hash stops
 * matching the moment someone edits the document, and the symptom is an unstyled
 * page nobody looks at until a deploy goes wrong. Deriving it means it cannot
 * drift by construction.
 */
export function extractStyleHashes(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '', 'utf8')
        .digest('base64')}'`,
  );
}

/**
 * Build the policy.
 *
 * ## Why `style-src` is split (LAI-205)
 *
 * `style-src` covers two different things, and they need different answers:
 *
 * - **inline `<style>` elements** — the dangerous half. `'unsafe-inline'` here
 *   re-enables the injection class CSP exists to stop for styles: exfiltration
 *   through attribute selectors and `background: url(...)`, and UI redressing by
 *   restyling the page. The only inline block Laika serves is the fallback
 *   document's, so it is hashed and the allowance is dropped.
 * - **inline `style=""` attributes** — the half the product structurally needs.
 *   Avatar colours are derived from the user id at runtime (SPEC §4.1), so their
 *   values do not exist until render and there is no stylesheet to put them in.
 *
 * CSP Level 3 splits these into `style-src-elem` and `style-src-attr`, both
 * falling back to `style-src` when absent.
 *
 * ## Why plain `style-src` keeps `'unsafe-inline'` and carries **no** hash
 *
 * Engines without the CSP3 split — Firefox before 128, Safari before 15.4 — read
 * the plain directive. Two rules make that line what it is:
 *
 * - it keeps `'unsafe-inline'`, so inline style **attributes** work on every
 *   engine. Under this policy no browser can block them: it either supports the
 *   split and reads `style-src-attr`, or it does not and reads this. That is why
 *   the avatar colours cannot break, rather than why they happen not to.
 * - it carries **no hash**, deliberately. CSP2 and later *ignore*
 *   `'unsafe-inline'` in any source list that also contains a hash or nonce — so
 *   adding the hash here would silently disable the allowance on exactly the old
 *   engines this line exists for, and break inline attributes there.
 *
 * Modern engines therefore get the real tightening via `style-src-elem`, and old
 * ones are left no worse than before.
 */
export function buildContentSecurityPolicy(styleHashes: readonly string[]): string {
  const elemSources = ["'self'", ...styleHashes].join(' ');

  return [
    "default-src 'self'",
    // No 'unsafe-inline', no 'unsafe-eval' — the build contains no eval and no
    // inline script (§13.1).
    "script-src 'self'",

    // Legacy fallback. See the module comment: keeps 'unsafe-inline', no hash.
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem ${elemSources}`,
    "style-src-attr 'unsafe-inline'",

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
}

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
