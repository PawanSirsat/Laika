import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadActor,
  resolveTokenActor,
  touchAgentSeen,
  type ResolvedActor,
} from '../../src/auth/resolve-actor.ts';
import { LAST_USED_THROTTLE_MS, TokenAuthError } from '../../src/auth/tokens.ts';
import { activity, agents, tokens } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  registerAgent,
  revokeAgent,
  rotateAgentToken,
  setAgentGrants,
} from '../../src/services/agents.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/agents.ts` (D-114, LAI-534): the transactions and the resolver
 * half. The HTTP behaviour is `test/http/routes/agents.test.ts`'s.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function register() {
  return registerAgent(t.sqlite, t.db, owner, {
    displayName: 'Claude',
    harness: 'claude-code',
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
}

function refusedWith(fn: () => unknown): TokenAuthError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TokenAuthError);
    return err as TokenAuthError;
  }
  throw new Error('expected a TokenAuthError, and nothing was thrown');
}

describe('rotation is one transaction', () => {
  it('mints nothing when revoking the old token fails', () => {
    const created = register();
    const before = {
      tokens: t.db.select().from(tokens).all(),
      activity: t.db.select().from(activity).all().length,
    };

    // Make the revoke half fail, inside the transaction.
    t.db.run(sql`
      CREATE TRIGGER fail_revoke BEFORE UPDATE OF revoked_at ON tokens
      BEGIN SELECT RAISE(ABORT, 'revoke refused for the test'); END
    `);
    expect(() =>
      rotateAgentToken(t.sqlite, t.db, owner, created.agent.id, { tokenId: created.token.id }),
    ).toThrow(/revoke refused for the test/);

    // Neither half landed: no new token, no new event, the old one still live.
    expect(t.db.select().from(tokens).all()).toEqual(before.tokens);
    expect(t.db.select().from(activity).all()).toHaveLength(before.activity);
    expect(resolveTokenActor(t.db, created.secret, Date.now()).token?.id).toBe(created.token.id);
  });

  it('keeps the old token’s scope and pin, and carries a future expiry over', () => {
    const created = register();
    const expiresAt = Date.now() + 86_400_000;
    const changed = t.db
      .update(tokens)
      .set({ scope: 'read_only', projectIdsJson: JSON.stringify([s.projectId]), expiresAt })
      .where(eq(tokens.id, created.token.id))
      .run();
    expect(changed.changes).toBe(1);

    const rotated = rotateAgentToken(t.sqlite, t.db, owner, created.agent.id, {
      tokenId: created.token.id,
    });
    const row = t.db.select().from(tokens).where(eq(tokens.id, rotated.token.id)).get();
    expect(row).toMatchObject({
      scope: 'read_only',
      projectIdsJson: JSON.stringify([s.projectId]),
      expiresAt,
      agentId: created.agent.id,
    });
  });
});

describe('the resolver refuses a revoked agent before any handler', () => {
  it('says agent_revoked even when the token row was left live', () => {
    const created = register();
    // The second lock on its own: the agent revoked, its token row untouched.
    const changed = t.db
      .update(agents)
      .set({ status: 'revoked', revokedAt: Date.now() })
      .where(eq(agents.id, created.agent.id))
      .run();
    expect(changed.changes).toBe(1);
    expect(
      t.db.select().from(tokens).where(eq(tokens.id, created.token.id)).get()?.revokedAt,
    ).toBeNull();

    const err = refusedWith(() => resolveTokenActor(t.db, created.secret, Date.now()));
    expect(err.code).toBe('unauthorized');
    expect(err.reason).toBe('agent_revoked');
    // Off the wire, as every token refusal is.
    expect(JSON.stringify(err.toBody())).not.toContain('agent_revoked');
  });

  it('says revoked after revokeAgent, which revokes the rows too', () => {
    const created = register();
    revokeAgent(t.sqlite, t.db, owner, created.agent.id);
    expect(refusedWith(() => resolveTokenActor(t.db, created.secret, Date.now())).reason).toBe(
      'revoked',
    );
  });

  it('carries the agent and its grants into the actor, from tokens.agent_id alone', () => {
    const created = register();
    const actor = resolveTokenActor(t.db, created.secret, Date.now());
    expect(actor.token?.agent?.id).toBe(created.agent.id);
    expect([...(actor.token?.agent?.grants ?? new Map()).entries()]).toEqual([
      [s.projectId, 'full'],
    ]);

    setAgentGrants(t.sqlite, t.db, owner, created.agent.id, []);
    const narrowed = resolveTokenActor(t.db, created.secret, Date.now());
    expect(narrowed.token?.agent?.grants.size).toBe(0);
  });
});

describe('last_seen_at', () => {
  it('is stamped on use, at most once per throttle window', () => {
    const created = register();
    const now = Date.now();
    resolveTokenActor(t.db, created.secret, now);
    const seen = () =>
      t.db.select().from(agents).where(eq(agents.id, created.agent.id)).get()?.lastSeenAt;
    expect(seen()).toBe(now);

    expect(touchAgentSeen(t.db, created.agent.id, now + 1)).toBe(false);
    expect(seen()).toBe(now);
    expect(touchAgentSeen(t.db, created.agent.id, now + LAST_USED_THROTTLE_MS)).toBe(true);
    expect(seen()).toBe(now + LAST_USED_THROTTLE_MS);
  });
});

describe('registering is session only', () => {
  it('refuses a token-borne actor with session_required', () => {
    const created = register();
    const asToken = resolveTokenActor(t.db, created.secret, Date.now());
    try {
      registerAgent(t.sqlite, t.db, asToken, {
        displayName: 'child',
        harness: 'other',
        grants: [],
      });
      throw new Error('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('forbidden');
      expect(((err as ApiError).details as { reason?: string }).reason).toBe('session_required');
    }
  });
});
