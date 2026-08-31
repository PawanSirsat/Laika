import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { hashToken } from '../../src/auth/tokens.ts';
import { readPayload } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, tokens, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createProject } from '../../src/services/projects.ts';
import {
  createToken,
  listOwnTokens,
  listTokensFor,
  revokeOwnToken,
  revokeTokenFor,
} from '../../src/services/tokens.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Personal access tokens (SPEC §4.9, §6.4, LAI-402).
 *
 * Against a real SQLite file with migrations applied (§13.3), because the two
 * properties that matter most — the plaintext is in no column, and the audit row
 * lands in the same transaction as the token — are properties of the database,
 * not of the function that called it.
 */

let t: TestDb;
let orgId: string;
let ownerId: string;

const LIST = { limit: 50, cursor: null };

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

/** Every activity row of a given type, payload parsed. */
function rowsOfType(type: string): Record<string, unknown>[] {
  return t.db
    .select()
    .from(activity)
    .all()
    .filter((row) => row.type === type)
    .map((row) => readPayload(row) as Record<string, unknown>);
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('owner', 'owner');
  orgId = newId();
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});

afterEach(() => {
  t.close();
});

describe('the secret is shown once and stored never (§4.9)', () => {
  it('returns a plaintext that appears in no column of the row', () => {
    const { token, secret } = createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'my laptop',
      scope: 'full',
    });

    const row = t.db.select().from(tokens).where(eq(tokens.id, token.id)).get();
    expect(row).toBeDefined();

    // Every column, stringified — so a secret smuggled into `name`, or into a
    // column added later, fails this too.
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(secret);

    // And the body of the secret, in case only the `lai_` prefix were stripped.
    expect(stored).not.toContain(secret.slice(4));
  });

  it('stores the hash, and the hash is of the whole secret including `lai_`', () => {
    const { token, secret } = createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'ci',
      scope: 'read_only',
    });

    const row = t.db.select().from(tokens).where(eq(tokens.id, token.id)).get();
    expect(row?.tokenHash).toBe(hashToken(secret));
    expect(row?.prefix).toBe(secret.slice(0, 8));
  });

  it('never carries the secret or the hash on the view', () => {
    const { token, secret } = createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'ci',
      scope: 'full',
    });

    expect(JSON.stringify(token)).not.toContain(secret);
    expect(Object.keys(token)).not.toContain('token_hash');
    expect(Object.keys(token)).not.toContain('tokenHash');
    expect(Object.keys(token)).not.toContain('secret');

    // The list path is the one a UI polls, so it gets its own assertion rather
    // than relying on both going through `toView` today.
    const listed = listOwnTokens(t.db, actor(ownerId), LIST);
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(JSON.stringify(listed)).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('scope is forced for a viewer, not refused (§3.1)', () => {
  it('gives an org viewer read_only even when they ask for full', () => {
    const viewerId = makeUser('viewer', 'viewer');

    const { token } = createToken(t.sqlite, t.db, actor(viewerId), {
      name: 'viewer token',
      scope: 'full',
    });

    // Not a 400. §3.1's cell reads "Generate own tokens ✓ (`read_only` forced)"
    // — the scope is forced, not the request rejected.
    expect(token.scope).toBe('read_only');
  });

  it('leaves a member asking for full alone', () => {
    const memberId = makeUser('member', 'member');
    const { token } = createToken(t.sqlite, t.db, actor(memberId), { name: 'm', scope: 'full' });
    expect(token.scope).toBe('full');
  });
});

describe('project scoping is validated, never silently narrowed', () => {
  it('accepts ids the requester can read', () => {
    const project = createProject(t.sqlite, t.db, actor(ownerId), {
      name: 'Laika',
      slug: 'laika',
      prefix: 'LAI',
    });

    const { token } = createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'scoped',
      scope: 'full',
      projectIds: [project.id],
    });

    expect(token.project_ids).toEqual([project.id]);
  });

  it('null means every project the user can reach', () => {
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'all', scope: 'full' });
    expect(token.project_ids).toBeNull();
  });

  it('rejects an id that names no project, even for an Owner', () => {
    // The case a permission check alone misses: an Owner has implicit lead
    // everywhere, so `can(project.read)` says yes to an id that exists nowhere.
    // Existence has to be checked as well, or a token is scoped to a phantom.
    expect(() =>
      createToken(t.sqlite, t.db, actor(ownerId), {
        name: 'phantom',
        scope: 'full',
        projectIds: ['does-not-exist'],
      }),
    ).toThrowError(ApiError);

    try {
      createToken(t.sqlite, t.db, actor(ownerId), {
        name: 'phantom',
        scope: 'full',
        projectIds: ['does-not-exist'],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('unprocessable');
      expect((error as ApiError).details).toMatchObject({ project_ids: ['does-not-exist'] });
    }
  });

  it('rejects a project the requester cannot read, rather than dropping it', () => {
    const project = createProject(t.sqlite, t.db, actor(ownerId), {
      name: 'Private',
      slug: 'private',
      prefix: 'PRV',
    });
    const outsiderId = makeUser('viewer', 'outsider');

    try {
      createToken(t.sqlite, t.db, actor(outsiderId), {
        name: 'sneaky',
        scope: 'read_only',
        projectIds: [project.id],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('unprocessable');
    }

    // Nothing was written — not a token scoped to fewer projects than asked.
    expect(t.db.select().from(tokens).all()).toHaveLength(0);
  });
});

describe('expiry', () => {
  it('is optional', () => {
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });
    expect(token.expires_at).toBeNull();
  });

  it('must be in the future', () => {
    const now = Date.now();
    try {
      createToken(t.sqlite, t.db, actor(ownerId), {
        name: 'past',
        scope: 'full',
        expiresAt: now - 1,
        now,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('unprocessable');
    }
  });

  it('refuses one exactly at now — a token that expires on arrival is a mistake', () => {
    const now = Date.now();
    expect(() =>
      createToken(t.sqlite, t.db, actor(ownerId), {
        name: 'now',
        scope: 'full',
        expiresAt: now,
        now,
      }),
    ).toThrowError(ApiError);
  });
});

describe('revoking', () => {
  it('sets revoked_at and is idempotent', () => {
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });

    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id, 1000);
    expect(listOwnTokens(t.db, actor(ownerId), LIST)[0]?.revoked_at).toBe(1000);

    // Second revoke: no throw, and the original timestamp stands. A token is
    // not un-revoked and not re-revoked.
    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id, 2000);
    expect(listOwnTokens(t.db, actor(ownerId), LIST)[0]?.revoked_at).toBe(1000);
  });

  it('writes exactly one activity row, not one per call', () => {
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });

    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id);
    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id);
    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id);

    // Nothing changed on calls two and three, so nothing happened to record.
    // An event claiming a change that did not occur is worse than none.
    expect(rowsOfType('token.revoked')).toHaveLength(1);
  });

  it('refuses somebody else’s token to a Member', () => {
    const memberId = makeUser('member', 'member');
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });

    try {
      revokeOwnToken(t.sqlite, t.db, actor(memberId), token.id);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });

  it('lets an Admin revoke anyone’s, through their own user path', () => {
    const adminId = makeUser('admin', 'admin');
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });

    revokeTokenFor(t.sqlite, t.db, actor(adminId), ownerId, token.id, 500);
    expect(listOwnTokens(t.db, actor(ownerId), LIST)[0]?.revoked_at).toBe(500);
  });

  it('refuses an Admin revoking a token through the wrong user’s path', () => {
    const adminId = makeUser('admin', 'admin');
    const otherId = makeUser('member', 'other');
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });

    // The token is the Owner's; the path names someone else. Allowing it would
    // put the wrong owner in the audit row.
    try {
      revokeTokenFor(t.sqlite, t.db, actor(adminId), otherId, token.id);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('not_found');
    }
  });

  it('refuses a Member listing or revoking anyone else’s', () => {
    const memberId = makeUser('member', 'member');

    try {
      listTokensFor(t.db, actor(memberId), ownerId, LIST);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });
});

describe('the audit trail (§4.8)', () => {
  it('records a mint and a revoke as org-scoped rows', () => {
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'ci', scope: 'full' });
    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id);

    const rows = t.db.select().from(activity).all();
    const tokenRows = rows.filter((r) => r.type.startsWith('token.'));

    expect(tokenRows.map((r) => r.type)).toEqual(['token.created', 'token.revoked']);
    for (const row of tokenRows) {
      // Org-scoped: §3.1 puts these behind the audit-log cell, and a token
      // belongs to a person rather than to any one project.
      expect(row.projectId).toBeNull();
      // The actor is the person, never the token.
      expect(row.actorId).toBe(ownerId);
      expect(row.actorKind).toBe('user');
    }
  });

  it('names the token by id and never by secret', () => {
    const { token, secret } = createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'ci',
      scope: 'read_only',
    });

    const [created] = rowsOfType('token.created');
    expect(created).toMatchObject({ token_id: token.id, name: 'ci', scope: 'read_only' });
    expect(JSON.stringify(created)).not.toContain(secret);
  });

  it('rolls the row back with the token if the write fails', () => {
    // The activity row is written inside the same transaction as the insert, so
    // there is no state where one exists without the other.
    const before = t.db.select().from(activity).all().length;
    expect(() =>
      createToken(t.sqlite, t.db, actor(ownerId), {
        name: 'bad',
        scope: 'full',
        projectIds: ['nope'],
      }),
    ).toThrowError(ApiError);

    expect(t.db.select().from(activity).all().length).toBe(before);
    expect(t.db.select().from(tokens).all()).toHaveLength(0);
  });
});

describe('listing', () => {
  it('returns only your own, newest first', () => {
    const otherId = makeUser('member', 'other');
    createToken(t.sqlite, t.db, actor(ownerId), { name: 'first', scope: 'full', now: 1 });
    createToken(t.sqlite, t.db, actor(ownerId), { name: 'second', scope: 'full', now: 2 });
    createToken(t.sqlite, t.db, actor(otherId), { name: 'theirs', scope: 'full', now: 3 });

    expect(listOwnTokens(t.db, actor(ownerId), LIST).map((row) => row.name)).toEqual([
      'second',
      'first',
    ]);
  });

  it('includes revoked tokens — history does not disappear', () => {
    const { token } = createToken(t.sqlite, t.db, actor(ownerId), { name: 'n', scope: 'full' });
    revokeOwnToken(t.sqlite, t.db, actor(ownerId), token.id);

    expect(listOwnTokens(t.db, actor(ownerId), LIST)).toHaveLength(1);
  });

  it('404s for a user who does not exist, rather than an empty list', () => {
    const adminId = makeUser('admin', 'admin');
    try {
      listTokensFor(t.db, actor(adminId), 'nobody', LIST);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('not_found');
    }
  });
});
