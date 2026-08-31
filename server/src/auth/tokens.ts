import { createHash, randomBytes } from 'node:crypto';

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
