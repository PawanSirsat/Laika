import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findTokenBySecret,
  hashToken,
  LAST_USED_THROTTLE_MS,
  looksLikePlaceholder,
  newTokenSecret,
  recordMcpUse,
  recordRestWrite,
  restWriteCountsAsPresence,
  TOKEN_PREFIX,
  TOKEN_SECRET_LENGTH,
  tokenDisplayPrefix,
  tokenProjectIds,
  touchTokenUsage,
} from '../../src/auth/tokens.ts';
import { newId } from '../../src/db/ids.ts';
import { eq } from 'drizzle-orm';
import { agents, orgs, tokens, users } from '../../src/db/schema.ts';
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
      lastMcpAt: null,
      lastRestWriteAt: null,
      lastClient: null,
      lastClientName: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: 0,
      agentId: null,
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
      lastMcpAt: null,
      lastRestWriteAt: null,
      lastClient: null,
      lastClientName: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: 0,
      agentId: null,
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

describe('MCP activity is recorded on the token (D-076)', () => {
  let t: TestDb;
  let tokenId: string;

  beforeEach(() => {
    t = freshDb();
    const userId = newId();
    tokenId = newId();
    t.db
      .insert(users)
      .values({
        id: userId,
        email: 'agent@example.test',
        name: 'Agent',
        orgRole: 'member',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .run();
    t.db
      .insert(tokens)
      .values({
        id: tokenId,
        userId,
        name: 'omnigent on macOS',
        prefix: 'lai_aaaa',
        tokenHash: 'x'.repeat(64),
        scope: 'full',
        createdAt: 0,
      })
      .run();
  });
  afterEach(() => {
    t.close();
  });

  function stored() {
    const row = t.db.select().from(tokens).where(eq(tokens.id, tokenId)).get();
    if (row === undefined) throw new Error('token vanished');
    return {
      lastMcpAt: row.lastMcpAt,
      lastClient: row.lastClient,
      lastClientName: row.lastClientName,
    };
  }

  it('stamps last_mcp_at the first time, and the client named on initialize', () => {
    expect(recordMcpUse(t.db, tokenId, 1_000, 'claude-code')).toEqual({ mcp: true, client: true });

    expect(stored()).toEqual({
      lastMcpAt: 1_000,
      lastClient: 'claude-code',
      lastClientName: 'claude-code',
    });
  });

  it('is throttled like last_used_at', () => {
    recordMcpUse(t.db, tokenId, 1_000, undefined);

    expect(recordMcpUse(t.db, tokenId, 1_000 + LAST_USED_THROTTLE_MS - 1, undefined).mcp).toBe(
      false,
    );
    expect(stored().lastMcpAt).toBe(1_000);

    expect(recordMcpUse(t.db, tokenId, 1_000 + LAST_USED_THROTTLE_MS, undefined).mcp).toBe(true);
    expect(stored().lastMcpAt).toBe(1_000 + LAST_USED_THROTTLE_MS);
  });

  it('leaves the client alone on a request that is not initialize', () => {
    recordMcpUse(t.db, tokenId, 1_000, 'Cursor');
    recordMcpUse(t.db, tokenId, 1_000 + LAST_USED_THROTTLE_MS, undefined);

    expect(stored()).toMatchObject({ lastClient: 'cursor', lastClientName: 'Cursor' });
  });

  it('writes the client only when it changed', () => {
    recordMcpUse(t.db, tokenId, 1_000, 'Cursor');

    expect(recordMcpUse(t.db, tokenId, 2_000, 'Cursor').client).toBe(false);
    expect(recordMcpUse(t.db, tokenId, 3_000, 'opencode').client).toBe(true);
    expect(stored()).toMatchObject({ lastClient: 'opencode', lastClientName: 'opencode' });
  });

  it('falls back to the token name for a generic client', () => {
    // Omnigent introduces itself as `mcp`.
    recordMcpUse(t.db, tokenId, 1_000, 'mcp');

    expect(stored()).toMatchObject({ lastClient: 'omnigent', lastClientName: 'mcp' });
  });

  it('stores the name cleaned and capped', () => {
    recordMcpUse(t.db, tokenId, 1_000, `\u202E${'y'.repeat(100)}`);

    expect(stored().lastClientName).toBe('y'.repeat(64));
  });

  it('never lets a generic name or a probe replace a better client', () => {
    // A stored `cursor` is worth more than Omnigent's `mcp` (which reads the
    // token name) or Hermes's throwaway `hermes-probe`.
    recordMcpUse(t.db, tokenId, 1_000, 'Cursor');

    expect(recordMcpUse(t.db, tokenId, 2_000, 'mcp').client).toBe(false);
    expect(recordMcpUse(t.db, tokenId, 3_000, 'hermes-probe').client).toBe(false);
    expect(stored()).toMatchObject({ lastClient: 'cursor', lastClientName: 'Cursor' });
  });

  it('lets a weak name fill a blank', () => {
    expect(recordMcpUse(t.db, tokenId, 1_000, 'mcp').client).toBe(true);
    expect(stored()).toMatchObject({ lastClient: 'omnigent', lastClientName: 'mcp' });
  });

  it('lets a weak name replace an unknown client', () => {
    // `other` is no better than what the token name says.
    t.db
      .update(tokens)
      .set({ lastClient: 'other', lastClientName: 'some-tool' })
      .where(eq(tokens.id, tokenId))
      .run();

    expect(recordMcpUse(t.db, tokenId, 1_000, 'mcp').client).toBe(true);
    expect(stored()).toMatchObject({ lastClient: 'omnigent', lastClientName: 'mcp' });
  });

  it('stamps no MCP time while presence is off, and still records the client', () => {
    // LAI-150: a disabled org stores no heartbeats, so turning presence back on
    // shows nothing from while it was off. MCP activity follows the same rule.
    // The client is token metadata, like `last_used_at`, and is kept.
    t.db
      .insert(orgs)
      .values({
        id: newId(),
        name: 'Laika',
        ownerUserId: t.db.select().from(users).get()?.id ?? '',
        presenceEnabled: 0,
        createdAt: 0,
        updatedAt: 0,
      })
      .run();

    expect(recordMcpUse(t.db, tokenId, 1_000, 'Cursor')).toEqual({ mcp: false, client: true });
    expect(stored()).toEqual({ lastMcpAt: null, lastClient: 'cursor', lastClientName: 'Cursor' });
  });

  it('touches nothing for a token that does not exist', () => {
    expect(recordMcpUse(t.db, 'nope', 1_000, 'Cursor')).toEqual({ mcp: false, client: false });
  });
});

describe('a registered agent’s token takes its harness from the agent (D-120, LAI-1001)', () => {
  let t: TestDb;
  let tokenId: string;

  /** A token named `name`, linked to an agent on `harness` when one is given. */
  function seed(name: string, harness: string | null): void {
    t = freshDb();
    const userId = newId();
    const orgId = newId();
    tokenId = newId();
    t.db
      .insert(users)
      .values({
        id: userId,
        email: 'owner@example.test',
        name: 'Owner',
        orgRole: 'member',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .run();
    t.db
      .insert(orgs)
      .values({ id: orgId, name: 'Laika', ownerUserId: userId, createdAt: 0, updatedAt: 0 })
      .run();
    const agentId = harness === null ? null : newId();
    if (agentId !== null && harness !== null) {
      t.db
        .insert(agents)
        .values({
          id: agentId,
          orgId,
          ownerUserId: userId,
          displayName: name,
          harness,
          deviceLabel: 'Belka',
          createdAt: 0,
        })
        .run();
    }
    t.db
      .insert(tokens)
      .values({
        id: tokenId,
        userId,
        agentId,
        name,
        prefix: 'lai_bbbb',
        tokenHash: 'y'.repeat(64),
        scope: 'full',
        createdAt: 0,
      })
      .run();
  }
  afterEach(() => {
    t.close();
  });

  const stored = () => {
    const row = t.db.select().from(tokens).where(eq(tokens.id, tokenId)).get();
    return { lastClient: row?.lastClient, lastClientName: row?.lastClientName };
  };

  it('an agent registered as Polly on omnigent, introducing itself as mcp, is omnigent', () => {
    seed('Polly', 'omnigent');
    expect(recordMcpUse(t.db, tokenId, 1_000, 'mcp').client).toBe(true);
    expect(stored()).toEqual({ lastClient: 'omnigent', lastClientName: 'mcp' });
  });

  it('the agent’s harness wins over a client that names something else', () => {
    seed('codex on Strelka', 'claude-code');
    recordMcpUse(t.db, tokenId, 1_000, 'codex-mcp-client');
    expect(stored()).toEqual({ lastClient: 'claude-code', lastClientName: 'codex-mcp-client' });
  });

  it('a wrong slug stored before the agent’s harness counted is repaired by a weak name', () => {
    seed('Polly', 'omnigent');
    t.db
      .update(tokens)
      .set({ lastClient: 'cursor', lastClientName: 'Cursor' })
      .where(eq(tokens.id, tokenId))
      .run();
    expect(recordMcpUse(t.db, tokenId, 1_000, 'mcp').client).toBe(true);
    expect(stored()).toEqual({ lastClient: 'omnigent', lastClientName: 'mcp' });
  });

  it('an unregistered legacy token still reads its name’s first word', () => {
    seed('Polly', null);
    recordMcpUse(t.db, tokenId, 1_000, 'mcp');
    expect(stored()).toEqual({ lastClient: 'other', lastClientName: 'mcp' });
  });
});

describe('a REST write is recorded on the token (D-081)', () => {
  let t: TestDb;
  let tokenId: string;

  beforeEach(() => {
    t = freshDb();
    const userId = newId();
    tokenId = newId();
    t.db
      .insert(users)
      .values({
        id: userId,
        email: 'agent@example.test',
        name: 'Agent',
        orgRole: 'member',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .run();
    t.db
      .insert(tokens)
      .values({
        id: tokenId,
        userId,
        name: 'omnigent on macOS',
        prefix: 'lai_aaaa',
        tokenHash: 'x'.repeat(64),
        scope: 'full',
        createdAt: 0,
      })
      .run();
  });
  afterEach(() => {
    t.close();
  });

  const stamp = () =>
    t.db.select().from(tokens).where(eq(tokens.id, tokenId)).get()?.lastRestWriteAt;

  it('counts a write under /api/ and never a read, nor /mcp', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(restWriteCountsAsPresence(method, '/api/v1/tasks/t1'), method).toBe(true);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(restWriteCountsAsPresence(method, '/api/v1/tasks/t1'), method).toBe(false);
    }
    // `/mcp` records itself, with the client's name (D-076).
    expect(restWriteCountsAsPresence('POST', '/mcp')).toBe(false);
  });

  it('stamps the first write and is throttled like last_used_at', () => {
    expect(recordRestWrite(t.db, tokenId, 1_000)).toBe(true);
    expect(stamp()).toBe(1_000);

    expect(recordRestWrite(t.db, tokenId, 1_000 + LAST_USED_THROTTLE_MS - 1)).toBe(false);
    expect(stamp()).toBe(1_000);

    expect(recordRestWrite(t.db, tokenId, 1_000 + LAST_USED_THROTTLE_MS)).toBe(true);
    expect(stamp()).toBe(1_000 + LAST_USED_THROTTLE_MS);
  });

  it('stamps nothing while presence is off', () => {
    t.db
      .insert(orgs)
      .values({
        id: newId(),
        name: 'Laika',
        ownerUserId: t.db.select().from(users).get()?.id ?? '',
        presenceEnabled: 0,
        createdAt: 0,
        updatedAt: 0,
      })
      .run();

    expect(recordRestWrite(t.db, tokenId, 1_000)).toBe(false);
    expect(stamp()).toBeNull();
  });

  it('touches nothing for a token that does not exist', () => {
    expect(recordRestWrite(t.db, 'nope', 1_000)).toBe(false);
  });
});

describe('an unexpanded placeholder is recognised, not looked up', () => {
  it.each([
    '${LAIKA_TOKEN}',
    '${env:LAIKA_TOKEN}',
    '{env:LAIKA_TOKEN}',
    '$LAIKA_TOKEN',
    '${{ secrets.LAIKA_TOKEN }}',
    '%LAIKA_TOKEN%',
    '<token>',
    'lai_...',
    'lai_…',
  ])('%s is a placeholder', (presented) => {
    expect(looksLikePlaceholder(presented)).toBe(true);
  });

  it.each([`lai_${'a'.repeat(40)}`, 'lai_tooshort', 'ghp_0123', 'not a token'])(
    '%s is not',
    (presented) => {
      expect(looksLikePlaceholder(presented)).toBe(false);
    },
  );
});
