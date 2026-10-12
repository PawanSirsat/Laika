/**
 * A default name for the token this page mints (LAI-622, re-aimed by LAI-737).
 *
 * `<agent> on <platform>`. The platform is what makes a single revoke cheap: a
 * year from now the Tokens screen is a list, and "codex on macOS" is the only
 * kind of row somebody can act on without guessing. A browser cannot read a
 * hostname, so the platform is the closest honest equivalent to the CLI's
 * `laika-cli on <hostname>`.
 *
 * **The first word is the agent's slug, and that is load-bearing.** LAI-736
 * identifies a client that introduces itself generically — Omnigent and Hermes
 * both send `mcp` — by the first word of its token's name, so a token named
 * after its agent is what lets presence say *Omnigent* rather than *another
 * agent*.
 */
export function suggestTokenName(userAgent: string, agentWord = 'claude-code'): string {
  const platform = /Mac OS X|Macintosh/u.test(userAgent)
    ? 'macOS'
    : userAgent.includes('Windows')
      ? 'Windows'
      : /Linux|X11/u.test(userAgent)
        ? 'Linux'
        : undefined;

  return platform === undefined ? agentWord : `${agentWord} on ${platform}`;
}
