import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { tokens } from '../db/schema.ts';
import { ApiError } from '../errors.ts';

/**
 * Personal access token secrets (SPEC §4.9, §13.1).
 *
 * Split from `services/tokens.ts` for the same reason `auth/invites.ts` is split
 * from `services/invites.ts`: minting is a service concern, but **recognising**
 * a presented credential is an auth concern, and LAI-403's middleware needs
 * `hashToken` without pulling in the whole CRUD surface.
 *
 * §4.9 is unambiguous about the shape: `lai_<40 base62>`, and *"the secret is
 * never stored and is shown exactly once, at creation"*. Only the hash and the
 * display prefix reach the database.
 */

/** §4.9's literal format. */
export const TOKEN_PREFIX = 'lai_';
export const TOKEN_SECRET_LENGTH = 40;

/** `prefix` in §4.9 — "first 8 chars, shown in the UI so a token is identifiable". */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 8;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * The largest multiple of 62 that fits in a byte.
 *
 * 256 is not a multiple of 62, so `randomBytes(n) % 62` is **biased**: bytes
 * 0–247 cover the alphabet four times over, and 248–255 wrap onto the first
 * eight characters, making them ~3% likelier than the rest. That is a small
 * amount of entropy given away for nothing, on the one value in this codebase
 * whose whole job is being unguessable — so bytes at or above this are
 * discarded and redrawn rather than folded.
 */
const UNBIASED_CEILING = 248;

/**
 * 40 base62 characters — about 238 bits, all of it from the CSPRNG.
 *
 * Nothing derived from the user, the clock or the id contributes: those are
 * discoverable by whoever wants to forge one. Same reasoning as
 * `newInviteToken`, which says the M3 tokens should be minted the same way.
 */
export function newTokenSecret(random: (size: number) => Uint8Array = randomBytes): string {
  let secret = '';

  while (secret.length < TOKEN_SECRET_LENGTH) {
    // Drawn a block at a time rather than byte by byte: rejection means the
    // number of bytes needed is not known in advance, and one syscall per
    // character would be the expensive way to find that out.
    //
    // `random` is injectable for one reason: rejection is invisible to a
    // statistical test at any sample size a suite can afford, so the only way to
    // prove a biased byte is *discarded* rather than folded is to hand one over
    // and look. Production always uses `randomBytes`.
    for (const byte of random(TOKEN_SECRET_LENGTH)) {
      if (byte >= UNBIASED_CEILING) continue;

      secret += BASE62.charAt(byte % 62);
      if (secret.length === TOKEN_SECRET_LENGTH) break;
    }
  }

  return TOKEN_PREFIX + secret;
}

/** Tokens are stored hashed, never in plaintext (§4.9, §13.1). */
export function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * The identifiable stub kept on the row.
 *
 * Taken from the **whole** token, so it reads `lai_` plus four characters —
 * §4.9 says "first 8 chars" and this is that, literally. Four distinguishing
 * characters is ample for telling apart the handful of tokens one person holds,
 * which is what the field is for; it is not, and is not used as, a lookup key.
 */
export function tokenDisplayPrefix(secret: string): string {
  return secret.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH);
}

// ----------------------------------------------------- presenting one (LAI-403)

/**
 * How long a token may go without its `last_used_at` being rewritten.
 *
 * SPEC §7.2 requires a read tool not to mutate on every call, and a token is
 * read on **every** request — an unthrottled write would turn `GET /tasks` into
 * a write, take the write lock, and make an agent's read traffic contend with
 * the board's actual work.
 *
 * A minute is enough resolution for "when was this last used" on a screen that
 * shows a date, and it collapses a busy agent's thousand requests into one write.
 */
export const LAST_USED_THROTTLE_MS = 60_000;

/** Why a presented token was refused. Logged, never returned (§6.1). */
export type TokenRejection = 'malformed' | 'unknown' | 'expired' | 'revoked' | 'inactive_user';

/**
 * A refused token — `401`, with the reason **off the wire**.
 *
 * The reason is a field on the error, deliberately **not** in `details`:
 * `ApiError.toBody()` serialises `details` into the response, so putting it
 * there would tell an unauthenticated caller whether a token is unknown or
 * merely revoked — which distinguishes "this never existed" from "this existed",
 * free information about somebody else's token. Checked against `toBody()`
 * rather than assumed; the first draft of this had it in `details`.
 */
export class TokenAuthError extends ApiError {
  readonly reason: TokenRejection;

  constructor(reason: TokenRejection) {
    super('unauthorized', 'That access token is not valid');
    this.name = 'TokenAuthError';
    this.reason = reason;
  }
}

export interface TokenLookup {
  row: typeof tokens.$inferSelect;
}

/**
 * `Authorization: Bearer lai_…` → the row, or why not.
 *
 * **Looked up by hash**, never by scanning and comparing plaintext: the hash
 * column is uniquely indexed, so this is one indexed equality match whatever the
 * table size, and the plaintext never appears in a query.
 *
 * The final comparison is `timingSafeEqual` even though the lookup already
 * matched. That looks redundant and is not quite: it closes the gap between
 * "SQLite found a row for this hash" and "this hash is that row's hash", and it
 * costs one fixed-length compare on a path that already hit the disk.
 */
export function findTokenBySecret(
  db: Db,
  presented: string,
  now: number,
): { ok: true; row: typeof tokens.$inferSelect } | { ok: false; reason: TokenRejection } {
  if (
    !presented.startsWith(TOKEN_PREFIX) ||
    presented.length !== TOKEN_PREFIX.length + TOKEN_SECRET_LENGTH
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const presentedHash = hashToken(presented);
  const row = db.select().from(tokens).where(eq(tokens.tokenHash, presentedHash)).get();
  if (row === undefined) return { ok: false, reason: 'unknown' };

  const stored = Buffer.from(row.tokenHash, 'utf8');
  const offered = Buffer.from(presentedHash, 'utf8');
  // Length is checked first because `timingSafeEqual` throws on a mismatch. Both
  // are fixed-length hex, so this branch leaks nothing about the secret.
  if (stored.length !== offered.length || !timingSafeEqual(stored, offered)) {
    return { ok: false, reason: 'unknown' };
  }

  if (row.revokedAt !== null) return { ok: false, reason: 'revoked' };
  if (row.expiresAt !== null && row.expiresAt <= now) return { ok: false, reason: 'expired' };

  return { ok: true, row };
}

/**
 * Stamp `last_used_at`, at most once per {@link LAST_USED_THROTTLE_MS}.
 *
 * Returns whether it wrote, so a test can assert the throttle rather than infer
 * it from a timestamp that happens not to have moved.
 */
export function touchTokenUsage(db: Db, row: typeof tokens.$inferSelect, now: number): boolean {
  if (row.lastUsedAt !== null && now - row.lastUsedAt < LAST_USED_THROTTLE_MS) return false;

  db.update(tokens).set({ lastUsedAt: now }).where(eq(tokens.id, row.id)).run();
  return true;
}

/** `project_ids_json` → the whitelist `can()` reads, or `null` for unscoped. */
export function tokenProjectIds(row: typeof tokens.$inferSelect): readonly string[] | null {
  if (row.projectIdsJson === null) return null;

  try {
    const parsed: unknown = JSON.parse(row.projectIdsJson);
    // A whitelist we cannot read is an **empty** whitelist, not an absent one.
    // `null` here would widen the token to every project — the one direction a
    // parse failure must never move.
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
