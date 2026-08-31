import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findTokenBySecret,
  hashToken,
  LAST_USED_THROTTLE_MS,
  newTokenSecret,
  TOKEN_PREFIX,
  TOKEN_SECRET_LENGTH,
  tokenDisplayPrefix,
  tokenProjectIds,
  touchTokenUsage,
} from '../../src/auth/tokens.ts';
import { newId } from '../../src/db/ids.ts';
import { tokens, users } from '../../src/db/schema.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

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

// ------------------------------------------------ presenting one (LAI-403)

describe('finding a token by the secret presented', () => {
  let t: TestDb;
  let userId: string;

  function mint(overrides: Partial<typeof tokens.$inferInsert> = {}): {
    secret: string;
    id: string;
  } {
    const secret = newTokenSecret();
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        name: 'ci',
        prefix: tokenDisplayPrefix(secret),
        tokenHash: hashToken(secret),
        scope: 'full',
        projectIdsJson: null,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: Date.now(),
        ...overrides,
      })
      .run();
    return { secret, id };
  }

  beforeEach(() => {
    t = freshDb();
    userId = newId();
    const now = Date.now();
    t.db
      .insert(users)
      .values({
        id: userId,
        email: 'agent@example.test',
        name: 'Agent',
        orgRole: 'member',
        avatarColor: '#123456',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
  });

  afterEach(() => {
    t.close();
  });

  it('finds a valid one', () => {
    const { secret, id } = mint();
    const found = findTokenBySecret(t.db, secret, Date.now());

    expect(found.ok).toBe(true);
    expect(found.ok && found.row.id).toBe(id);
  });

  it('rejects malformed, wrong-prefix and wrong-length secrets without touching the table', () => {
    const now = Date.now();
    const cases: [string, string][] = [
      ['not a token at all', 'malformed'],
      ['ghp_0123456789012345678901234567890123456789', 'malformed'],
      ['lai_tooshort', 'malformed'],
      [`lai_${'a'.repeat(41)}`, 'malformed'],
      ['', 'malformed'],
    ];

    for (const [presented, reason] of cases) {
      const found = findTokenBySecret(t.db, presented, now);
      expect(found.ok, presented).toBe(false);
      expect(!found.ok && found.reason, presented).toBe(reason);
    }
  });

  it('rejects a well-formed secret that matches nothing as `unknown`', () => {
    mint();
    const found = findTokenBySecret(t.db, newTokenSecret(), Date.now());
    expect(!found.ok && found.reason).toBe('unknown');
  });

  it('distinguishes revoked from expired', () => {
    const now = 10_000;
    const revoked = mint({ revokedAt: 5_000 });
    const expired = mint({ expiresAt: 9_999 });

    expect(!findTokenBySecret(t.db, revoked.secret, now).ok).toBe(true);
    const r = findTokenBySecret(t.db, revoked.secret, now);
    expect(!r.ok && r.reason).toBe('revoked');

    const e = findTokenBySecret(t.db, expired.secret, now);
    expect(!e.ok && e.reason).toBe('expired');
  });

  it('treats an expiry exactly at now as expired', () => {
    const { secret } = mint({ expiresAt: 1_000 });
    const found = findTokenBySecret(t.db, secret, 1_000);
    expect(!found.ok && found.reason).toBe('expired');
  });

  it('accepts one that expires in a moment', () => {
    const { secret } = mint({ expiresAt: 1_001 });
    expect(findTokenBySecret(t.db, secret, 1_000).ok).toBe(true);
  });
});

describe('last_used_at is throttled (§7.2)', () => {
  let t: TestDb;

  beforeEach(() => {
    t = freshDb();
  });
  afterEach(() => {
    t.close();
  });

  function row(lastUsedAt: number | null): typeof tokens.$inferSelect {
    return {
      id: 'tok',
      userId: 'u',
      name: 'ci',
      prefix: 'lai_aaaa',
      tokenHash: 'x'.repeat(64),
      scope: 'full',
      projectIdsJson: null,
      lastUsedAt,
      expiresAt: null,
      revokedAt: null,
      createdAt: 0,
    };
  }

  it('writes the first time', () => {
    expect(touchTokenUsage(t.db, row(null), 1_000)).toBe(true);
  });

  it('does not write again inside the window', () => {
    // Two calls a second apart are one write. A token is read on *every*
    // request, so an unthrottled stamp would make `GET /tasks` a write and put
    // an agent's reads in contention for the write lock.
    expect(touchTokenUsage(t.db, row(1_000), 2_000)).toBe(false);
    expect(touchTokenUsage(t.db, row(1_000), 1_000 + LAST_USED_THROTTLE_MS - 1)).toBe(false);
  });

  it('writes again once the window has passed', () => {
    expect(touchTokenUsage(t.db, row(1_000), 1_000 + LAST_USED_THROTTLE_MS)).toBe(true);
  });
});

describe('the project whitelist errs closed', () => {
  function row(json: string | null): typeof tokens.$inferSelect {
    return {
      id: 'tok',
      userId: 'u',
      name: 'ci',
      prefix: 'lai_aaaa',
      tokenHash: 'x'.repeat(64),
      scope: 'full',
      projectIdsJson: json,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: 0,
    };
  }

  it('null means every project the user can reach', () => {
    expect(tokenProjectIds(row(null))).toBeNull();
  });

  it('reads a stored list', () => {
    expect(tokenProjectIds(row('["p1","p2"]'))).toEqual(['p1', 'p2']);
  });

  it('turns an unreadable list into an EMPTY whitelist, never an absent one', () => {
    // The direction matters and only one is safe. `null` would widen the token
    // to every project the user can reach — a parse failure escalating a
    // scoped token to an unscoped one.
    expect(tokenProjectIds(row('{ not json'))).toEqual([]);
    expect(tokenProjectIds(row('"a string"'))).toEqual([]);
    expect(tokenProjectIds(row('42'))).toEqual([]);
  });
});
