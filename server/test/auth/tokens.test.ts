import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashToken,
  newTokenSecret,
  TOKEN_PREFIX,
  TOKEN_SECRET_LENGTH,
  tokenDisplayPrefix,
} from '../../src/auth/tokens.ts';

/**
 * Token secrets (SPEC §4.9, LAI-402).
 *
 * The format is spec'd literally — `lai_<40 base62>` — and the interesting
 * property is not the shape but where the characters come from.
 */

const FORMAT = /^lai_[0-9A-Za-z]{40}$/;

describe('the format §4.9 specifies', () => {
  it('is `lai_` followed by exactly 40 base62 characters', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newTokenSecret()).toMatch(FORMAT);
    }
  });

  it('is that length by construction, not by coincidence', () => {
    expect(TOKEN_PREFIX).toBe('lai_');
    expect(TOKEN_SECRET_LENGTH).toBe(40);
    expect(newTokenSecret()).toHaveLength(TOKEN_PREFIX.length + TOKEN_SECRET_LENGTH);
  });

  it('does not repeat itself', () => {
    // Not a randomness test — a wiring test. A secret built from the id, the
    // clock or a module-level counter would collide or march, and both show up
    // here long before they show up in production.
    const seen = new Set(Array.from({ length: 500 }, () => newTokenSecret()));
    expect(seen.size).toBe(500);
  });
});

describe('the alphabet is drawn without bias', () => {
  /** A source that hands back exactly these bytes, cycling if asked for more. */
  const feed =
    (bytes: readonly number[]) =>
    (size: number): Uint8Array =>
      Uint8Array.from({ length: size }, (_, i) => bytes[i % bytes.length] ?? 0);

  it('discards a byte in the biased tail rather than folding it', () => {
    // 256 is not a multiple of 62. Bytes 248–255 would wrap onto the first
    // eight characters of the alphabet, making them ~25% likelier than the
    // rest. 250 is in that tail: folded it yields BASE62[250 % 62] = '2';
    // discarded, the next byte decides.
    //
    // This is the assertion that cannot be replaced by sampling. At 8,000
    // characters the bias moves a bucket from ~129 to ~161, which no
    // non-flaky bound distinguishes from noise.
    const folded = newTokenSecret(feed([250, 5]));
    expect(folded.charAt(TOKEN_PREFIX.length)).toBe('5');
    expect(folded.charAt(TOKEN_PREFIX.length)).not.toBe('2');
  });

  it('still fills the full length when most bytes are rejected', () => {
    // A source that is almost all tail: the loop must keep drawing rather than
    // returning something short.
    const mostlyRejected = feed([255, 254, 253, 252, 251, 250, 249, 248, 7]);
    expect(newTokenSecret(mostlyRejected)).toMatch(FORMAT);
  });

  it('accepts a byte just below the tail', () => {
    // 247 is the last unbiased byte; 247 % 62 = 61, the alphabet's last char.
    expect(newTokenSecret(feed([247])).charAt(TOKEN_PREFIX.length)).toBe('z');
  });
});

describe('what is stored', () => {
  it('hashes with SHA-256, so the row cannot be read back into a token', () => {
    const secret = newTokenSecret();
    expect(hashToken(secret)).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(hashToken(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(secret)).not.toContain(secret);
  });

  it('hashes deterministically, or a presented token could never be matched', () => {
    const secret = newTokenSecret();
    expect(hashToken(secret)).toBe(hashToken(secret));
    expect(hashToken(secret)).not.toBe(hashToken(newTokenSecret()));
  });

  it('keeps the first eight characters as the display prefix', () => {
    const secret = newTokenSecret();
    expect(tokenDisplayPrefix(secret)).toBe(secret.slice(0, 8));
    expect(tokenDisplayPrefix(secret)).toHaveLength(8);
    // §4.9's "first 8 chars" includes `lai_`, so four of them distinguish.
    expect(tokenDisplayPrefix(secret).startsWith(TOKEN_PREFIX)).toBe(true);
  });
});
