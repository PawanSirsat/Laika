/**
 * A default name for the token this page mints (LAI-622).
 *
 * Named after the machine, because that is what makes a single revoke cheap: a
 * year from now the Tokens screen is a list, and "laika-claude on macOS" is the
 * only kind of row somebody can act on without guessing. It mirrors the CLI's
 * `laika-cli on <hostname>`; a browser cannot read a hostname, so the platform
 * is the closest honest equivalent.
 */
export function suggestTokenName(userAgent: string): string {
  const platform = /Mac OS X|Macintosh/u.test(userAgent)
    ? 'macOS'
    : userAgent.includes('Windows')
      ? 'Windows'
      : /Linux|X11/u.test(userAgent)
        ? 'Linux'
        : undefined;

  return platform === undefined ? 'laika-claude' : `laika-claude on ${platform}`;
}
