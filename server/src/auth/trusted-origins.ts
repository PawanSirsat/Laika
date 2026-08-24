/**
 * Which origins better-auth accepts (SPEC §6.1, LAI-090).
 *
 * ## The bug this exists to fix
 *
 * `LAIKA_PUBLIC_URL` was `http://localhost:3000`; the owner opened
 * `http://127.0.0.1:3000` and could not sign in. Correct credentials, `403`, and
 * a UI that said *"Email or password is wrong."* Those are the same machine —
 * the difference is how somebody typed it into a browser.
 *
 * ## Decision: loopback spellings are one host
 *
 * `localhost`, `127.0.0.1` and `::1` all name the machine the server is running
 * on, so when the configured public URL is one of them the others are trusted
 * too. The reasoning, so it can be argued with:
 *
 *  - **There is no attacker this separation stops.** The origin check is a CSRF
 *    defence: it stops a page on *another* site from driving this API with the
 *    user's cookie. A page served from `http://127.0.0.1:3000` is served **by
 *    this instance** — nobody else can bind that port on that machine. An
 *    attacker who can serve pages from the operator's loopback already runs code
 *    on the box, and the sign-in form is not what they would use.
 *  - **The failure mode is severe and silent.** Locking the operator out of
 *    their own self-hosted instance, with a message pointing at their password,
 *    is a real cost paid against no benefit.
 *
 * ## What this deliberately does not do
 *
 * It does not trust the LAN address, a hostname, or a proxy's origin. Those are
 * genuinely different hosts and `LAIKA_PUBLIC_URL` is how an operator declares
 * them — widening to "any origin" would delete the CSRF check, which is not the
 * defect. It also adds nothing when the configured URL is a real hostname: an
 * instance published at `https://laika.example.com` does not silently start
 * trusting `http://localhost:3000`.
 */

/** Hostnames that mean "this machine". `127.0.0.0/8` is all loopback. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host === '::1') return true;

  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** The canonical spellings of loopback, in the order a person is likely to type them. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

/**
 * The origins better-auth should accept for this public URL.
 *
 * Always includes the configured URL's own origin. When that origin is loopback,
 * the other loopback spellings on the same scheme and port come with it.
 *
 * Returns the input unchanged if it cannot be parsed — `env.ts` has already
 * validated it, and inventing a fallback here would hide a misconfiguration
 * behind a wider trust set, which is the wrong direction.
 */
export function trustedOriginsFor(publicUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return [publicUrl];
  }

  if (!isLoopbackHost(url.hostname)) return [url.origin];

  const port = url.port === '' ? '' : `:${url.port}`;
  return LOOPBACK_HOSTS.map((host) => `${url.protocol}//${host}${port}`);
}
