import { normaliseUrl } from './api.ts';

/**
 * One place a board URL and a token can come from — the environment, `laika
 * init`'s `~/.claude/settings.json`, the installer's `~/.laika/env` — as it
 * holds them: either half may be missing.
 */
export interface CredentialSource {
  /** Where it is, in words: `the environment`, or a path. */
  readonly from: string;
  readonly url?: string | undefined;
  readonly token?: string | undefined;
}

/** The board, where it came from, and a token for that board when one is held. */
export interface PairedCredential {
  /** Normalised: no trailing slash. */
  readonly url: string;
  readonly from: string;
  readonly token?: string;
  /** Where the token came from: `from`, or another source naming the same board. */
  readonly tokenFrom?: string;
}

function named(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * **A board URL and its token as a pair, never mixed** (LAI-1343).
 *
 * The board is the first source, in the order given, that names one. Its token
 * is that source's own — or, when it holds none, the first other source's
 * whose own URL names **the same board**. A token is never paired with a board
 * its own source did not name.
 *
 * So the environment's `LAIKA_URL` for board B beside `~/.laika/env`'s URL and
 * token for board C is **B with no token** — never B with C's token, which is
 * what reading the two names one at a time across the sources gave, and how
 * `laika activity on` sent C's token to B. A shell that exports only
 * `LAIKA_URL`, beside a file holding that same board and its token, still
 * finds the token: it is that board's.
 */
export function pairCredentials(
  sources: readonly CredentialSource[],
): PairedCredential | undefined {
  const first = sources.find((source) => named(source.url));
  if (first === undefined || !named(first.url)) return undefined;
  const url = normaliseUrl(first.url.trim());
  const holder = sources.find(
    (source) => named(source.token) && named(source.url) && normaliseUrl(source.url.trim()) === url,
  );
  return holder === undefined || !named(holder.token)
    ? { url, from: first.from }
    : { url, from: first.from, token: holder.token.trim(), tokenFrom: holder.from };
}

/**
 * **Why the board named has no token here** (LAI-1343 review): another place
 * holds a token for another board, which is not sent here; or a place holds a
 * token with no URL beside it, which names no board. Two lines naming the
 * places and the boards, never a token; `undefined` when neither is so.
 */
export function unpairedLines(
  paired: PairedCredential,
  sources: readonly CredentialSource[],
): readonly [string, string] | undefined {
  const other = sources.find(
    (source) =>
      named(source.token) && named(source.url) && normaliseUrl(source.url.trim()) !== paired.url,
  );
  if (other !== undefined) {
    return [
      `No token for ${paired.url}. ${other.from} holds one for ${normaliseUrl(other.url?.trim() ?? '')}, which is not sent to another board.`,
      paired.from === 'the environment'
        ? 'Set LAIKA_URL and LAIKA_TOKEN together, or unset LAIKA_URL to use that board.'
        : `Put ${paired.url}'s token beside its URL in ${paired.from}, or remove that URL to use the other board.`,
    ];
  }
  const orphan = sources.find((source) => named(source.token) && !named(source.url));
  if (orphan !== undefined) {
    return [
      `No token for ${paired.url}. LAIKA_TOKEN in ${orphan.from} is not used: no LAIKA_URL beside it names its board.`,
      `Set LAIKA_URL and LAIKA_TOKEN together in ${orphan.from}.`,
    ];
  }
  return undefined;
}
