import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, heartbeats, orgs, tokens, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  BRANCH_MAX_LENGTH,
  recordHeartbeat,
  REPO_MAX_LENGTH,
} from '../../src/services/heartbeats.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Presence, at the service (SPEC §9.1, §4.10, D-005).
 *
 * The route tests own the transport — `202`, token-only, the strict body. What
 * is left here is what a caller reaching the service directly still gets: an
 * MCP tool or the plugin could, and a bound only the route applies is not a
 * bound (LAI-404).
 */

let t: TestDb;
let ownerId: string;

function makeUser(orgRole: OrgRole, label: string): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${label}@example.test`,
      name: label,
      orgRole,
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

/**
 * The same person, acting through a token.
 *
 * The token row is **real**, not a synthetic id: `heartbeats.token_id` is a
 * foreign key, and a fabricated one is refused by the database rather than
 * quietly stored. The route tests mint through the API and never met this; the
 * service tests would have, and the constraint said so immediately.
 */
function withToken(base: ResolvedActor, scope: 'full' | 'read_only'): ResolvedActor {
  const id = newId();
  t.db
    .insert(tokens)
    .values({
      id,
      userId: base.userId,
      name: 'test',
      prefix: 'lai_test',
      tokenHash: `${id}-hash`,
      scope,
      projectIdsJson: null,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: Date.now(),
    })
    .run();

  return { ...base, token: { id, scope, projectIds: null } };
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('owner', 'owner');
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});

afterEach(() => {
  t.close();
});

describe('what it records', () => {
  it('writes §4.10’s columns and nothing else', () => {
    const view = recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
      repo: 'kvell/laika',
      branch: 'main',
      now: 1000,
    });

    expect(view).toEqual({
      id: view.id,
      user_id: ownerId,
      token_id: view.token_id,
      repo: 'kvell/laika',
      branch: 'main',
      matched_task_id: null,
      created_at: 1000,
    });
  });

  it('trims but does not otherwise touch the branch', () => {
    // §9.2's branch → task resolution is M5. Nothing here parses it, so a
    // branch that looks like a task key is still just a string.
    recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
      repo: '  kvell/laika  ',
      branch: '  feature/LAI-417  ',
    });

    const row = t.db.select().from(heartbeats).get();
    expect(row?.repo).toBe('kvell/laika');
    expect(row?.branch).toBe('feature/LAI-417');
    expect(row?.matchedTaskId).toBeNull();
  });

  it('writes no activity row', () => {
    // Presence is not an audited action, and §4.8's `heartbeat.session` names a
    // session rather than a ping — what writes it, and when, is M4's plugin
    // work or M5's presence view. Not this.
    recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), { repo: 'r', branch: 'b' });
    recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), { repo: 'r', branch: 'b' });

    expect(t.db.select().from(activity).all()).toHaveLength(0);
  });

  it('records a null token when there is none', () => {
    // §9.1 makes the endpoint token-only, but the service is reachable without
    // one and should say so honestly rather than inventing an id.
    recordHeartbeat(t.db, actor(ownerId), { repo: 'r', branch: 'b' });

    expect(t.db.select().from(heartbeats).get()?.tokenId).toBeNull();
  });
});

describe('the bounds are the service’s, not the route’s', () => {
  it('accepts exactly the limits', () => {
    expect(() =>
      recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
        repo: 'x'.repeat(REPO_MAX_LENGTH),
        branch: 'y'.repeat(BRANCH_MAX_LENGTH),
      }),
    ).not.toThrow();
  });

  it('refuses one character more, naming both limits', () => {
    try {
      recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
        repo: 'x'.repeat(REPO_MAX_LENGTH + 1),
        branch: 'b',
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const api = error as ApiError;
      expect(api.code).toBe('unprocessable');
      expect(api.details).toMatchObject({ repo_limit: REPO_MAX_LENGTH });
    }

    expect(t.db.select().from(heartbeats).all()).toHaveLength(0);
  });

  it('refuses an empty repo or branch', () => {
    for (const input of [
      { repo: '', branch: 'b' },
      { repo: 'r', branch: '' },
      { repo: '   ', branch: 'b' },
    ]) {
      expect(() => recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), input)).toThrowError(
        ApiError,
      );
    }
  });
});

describe('can() (§3.1’s "Send own heartbeat")', () => {
  it('allows every role that can hold a writing token', () => {
    // ✓ for all four in §3.1 — your own record about your own work — and the
    // three whose token can carry `full` scope can act on it.
    for (const role of ['owner', 'admin', 'member'] as const) {
      const id = makeUser(role, `${role}-user`);
      expect(() =>
        recordHeartbeat(t.db, withToken(actor(id), 'full'), { repo: 'r', branch: 'b' }),
      ).not.toThrow();
    }
  });

  it('refuses a Viewer even holding a token stored as `full`', () => {
    // **Stronger than "a Viewer's token is created read_only".** `can()` applies
    // `effectiveTokenScope`, which returns `read_only` for a Viewer *whatever
    // the stored row says* — so a token minted while they were a Member and
    // then demoted stops writing immediately, without anything revoking it.
    //
    // I expected this to pass and it did not, which is the better answer: the
    // forcing is at check time, not only at creation.
    const id = makeUser('viewer', 'viewer-full');

    try {
      recordHeartbeat(t.db, withToken(actor(id), 'full'), { repo: 'r', branch: 'b' });
      expect.unreachable('a Viewer is read_only whatever the token says');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });

  it('refuses a read_only token whatever the role', () => {
    // The credential, not the role — which is why the Viewer cell is ✓ and a
    // Viewer still cannot send one in practice (§9.1 is token-only, §4.9 forces
    // a Viewer's token to read_only).
    for (const role of ['owner', 'member', 'viewer'] as const) {
      const id = makeUser(role, `${role}-ro`);

      try {
        recordHeartbeat(t.db, withToken(actor(id), 'read_only'), { repo: 'r', branch: 'b' });
        expect.unreachable(`${role} with a read_only token should be refused`);
      } catch (error) {
        expect((error as ApiError).code).toBe('forbidden');
      }
    }

    expect(t.db.select().from(heartbeats).all()).toHaveLength(0);
  });
});
