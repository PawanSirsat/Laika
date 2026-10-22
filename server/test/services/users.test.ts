import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { readPayload } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import { findTokenBySecret } from '../../src/auth/tokens.ts';
import {
  activity,
  orgs,
  projectMemberships,
  projects,
  sessions,
  tokens,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createToken } from '../../src/services/tokens.ts';
import {
  listMemberships,
  listUsers,
  setOrgRole,
  setUserActive,
  signOutEverywhere,
} from '../../src/services/users.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let ownerId: string;

const PAGE = { limit: 50, cursor: null, updatedSince: null };

function makeUser(
  name: string,
  orgRole: OrgRole = 'member',
  extra: { isActive?: number; updatedAt?: number; email?: string } = {},
): string {
  const id = newId();
  const now = extra.updatedAt ?? Date.now();
  t.db
    .insert(users)
    .values({
      id,
      // Name-derived by default so assertions read well; overridable, because
      // `users.email` is unique and two people really can share a name.
      email: extra.email ?? `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
      name,
      orgRole,
      isActive: extra.isActive ?? 1,
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

function expectApiError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    expect(err.code).toBe(code);
    return;
  }
  throw new Error(`Expected an ApiError with code "${code}", but nothing was thrown`);
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  ownerId = makeUser('Ada Lovelace', 'owner');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});
afterEach(() => {
  t.close();
});

describe('the fields a picker needs (AC1)', () => {
  it('returns id, name, email, role and whether they are active', () => {
    const [ada] = listUsers(t.db, actor(ownerId), PAGE);

    expect(ada).toMatchObject({
      id: ownerId,
      name: 'Ada Lovelace',
      email: 'ada.lovelace@example.test',
      org_role: 'owner',
      is_active: true,
    });
    // `expect.any(Number)` is typed `any`, which the lint rules reject — and a
    // typeof check says the same thing without one. The exact key set is asserted
    // below.
    expect(typeof ada?.created_at).toBe('number');
    expect(typeof ada?.updated_at).toBe('number');
  });

  it('reports timestamps as unix-ms, not as Dates', () => {
    // The columns are `Date`-typed since LAI-005 because better-auth hands the
    // adapter Dates; §6.3 speaks unix-ms everywhere.
    const [ada] = listUsers(t.db, actor(ownerId), PAGE);

    expect(typeof ada?.created_at).toBe('number');
    expect(ada?.created_at).toBeGreaterThan(1_700_000_000_000);
  });

  it('never returns anything better-auth needs and §4.1 does not specify', () => {
    // `email_verified` and `image` exist for better-auth (§11.3); v1 has no
    // uploads and verification state is not the directory's business.
    const [ada] = listUsers(t.db, actor(ownerId), PAGE);

    expect(Object.keys(ada ?? {}).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'is_active',
      // When they were last seen signed in (LAI-981) — derived from sessions,
      // not a better-auth field passed through.
      'last_seen_at',
      'name',
      'org_role',
      'updated_at',
    ]);
  });
});

describe('who may read it (AC2)', () => {
  it('is open to every org role — §3.1 "View member list" is ✓ for all four', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const id = makeUser(`Person ${role}`, role);
      expect(listUsers(t.db, actor(id), PAGE).length).toBeGreaterThan(0);
    }
  });

  it('refuses a deactivated caller before reading a row', () => {
    const id = makeUser('Gone Person');
    const deactivated = { ...actor(id), isActive: false };

    // Otherwise deactivation only takes effect at next sign-out.
    expectApiError(() => listUsers(t.db, deactivated, PAGE), 'forbidden');
  });
});

describe('deactivated people (AC3)', () => {
  it('are left out of a plain read, so a picker cannot offer them', () => {
    makeUser('Zoe Active');
    makeUser('Yves Inactive', 'member', { isActive: 0 });

    expect(listUsers(t.db, actor(ownerId), PAGE).map((u) => u.name)).toEqual([
      'Ada Lovelace',
      'Zoe Active',
    ]);
  });

  it('come back when asked for, flagged rather than hidden', () => {
    makeUser('Yves Inactive', 'member', { isActive: 0 });

    const all = listUsers(t.db, actor(ownerId), { ...PAGE, includeInactive: true });

    expect(all.map((u) => u.name)).toEqual(['Ada Lovelace', 'Yves Inactive']);
    expect(all.find((u) => u.name === 'Yves Inactive')?.is_active).toBe(false);
  });

  it('always reach an updated_since catch-up, flag and all', () => {
    const gone = makeUser('Yves Inactive', 'member', { isActive: 0, updatedAt: 5000 });

    // A catch-up that hid the deactivation would leave the client showing them as
    // active for ever — and a tombstone would be a lie, because §4.1 keeps the row.
    const caught = listUsers(t.db, actor(ownerId), { ...PAGE, updatedSince: 4000 });

    expect(caught.map((u) => u.id)).toContain(gone);
    expect(caught.find((u) => u.id === gone)?.is_active).toBe(false);
    expect(caught.some((u) => 'deleted' in u)).toBe(false);
  });

  it('respects the watermark inclusively', () => {
    // Ada is created in `beforeEach` at the real clock, so the watermark has to
    // sit above it for this to say anything.
    const LATER = 9_000_000_000_000;
    makeUser('Old Person', 'member', { updatedAt: 1000 });
    makeUser('New Person', 'member', { updatedAt: LATER });

    expect(
      listUsers(t.db, actor(ownerId), { ...PAGE, updatedSince: LATER }).map((u) => u.name),
    ).toEqual(['New Person']);

    // One millisecond later and it is excluded — inclusive, not "greater than".
    expect(
      listUsers(t.db, actor(ownerId), { ...PAGE, updatedSince: LATER + 1 }).map((u) => u.name),
    ).toEqual([]);
  });
});

describe('ordering and paging (AC3)', () => {
  it('is alphabetical by name, not by when the row changed', () => {
    makeUser('Zoe Zebra', 'member', { updatedAt: 1 });
    makeUser('Bob Badger', 'member', { updatedAt: 9_000_000_000_000 });

    expect(listUsers(t.db, actor(ownerId), PAGE).map((u) => u.name)).toEqual([
      'Ada Lovelace',
      'Bob Badger',
      'Zoe Zebra',
    ]);
  });

  it('walks every page once, with no repeats and no gaps', () => {
    for (const name of ['Bea', 'Cal', 'Dee', 'Eli', 'Fay']) makeUser(name);

    const whole = listUsers(t.db, actor(ownerId), { ...PAGE, limit: 200 }).map((u) => u.id);
    const seen: string[] = [];
    let cursor: { sortKey: string; id: string } | null = null;

    for (let page = 0; page < 10; page++) {
      const rows = listUsers(t.db, actor(ownerId), { ...PAGE, limit: 2, cursor });
      const data = rows.slice(0, 2);
      seen.push(...data.map((u) => u.id));

      if (rows.length <= 2) break;
      const last = data[data.length - 1]!;
      cursor = { sortKey: last.name, id: last.id };
    }

    expect(seen).toEqual(whole);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('breaks a name collision on id, so neither namesake is skipped', () => {
    // Two people really can share a name; the id makes `(name, id)` a total
    // order. Unlike `activity` (LAI-055), nothing here claims the tiebreak
    // *means* anything — it only has to be stable.
    const a = makeUser('Same Name', 'member', { email: 'one@example.test' });
    const b = makeUser('Same Name', 'member', { email: 'two@example.test' });

    const both = listUsers(t.db, actor(ownerId), PAGE).filter((u) => u.name === 'Same Name');
    expect(both).toHaveLength(2);

    const first = both[0]!;
    const next = listUsers(t.db, actor(ownerId), {
      ...PAGE,
      limit: 1,
      cursor: { sortKey: first.name, id: first.id },
    });

    expect(next[0]?.id).toBe([a, b].sort().find((id) => id !== first.id));
  });
});

describe('there is nothing non-human to exclude (AC4)', () => {
  it('has no users column that could introduce a bot account', () => {
    // An agent authenticates with a token belonging to a real person (§4.9), and
    // `actor_kind` distinguishes agent activity per *event*, not per account. If a
    // service-account concept ever lands, this fails and the picker's contract has
    // to be revisited rather than silently starting to offer robots.
    const columns = getTableConfig(users).columns.map((c) => c.name);

    expect(columns.filter((name) => /bot|service|machine|agent|system/i.test(name))).toEqual([]);
  });

  it('lists a person who holds a token exactly like anyone else', () => {
    // The user behind an agent's token is a colleague, so a picker should offer
    // them. There is no second kind of row.
    const person = makeUser('Token Holder');

    expect(listUsers(t.db, actor(ownerId), PAGE).map((u) => u.id)).toContain(person);
    expect(t.db.select().from(users).where(eq(users.id, person)).get()?.isActive).toBe(1);
  });
});

/**
 * Org role changes and deactivation (§3.1, §4.1, LAI-222).
 *
 * §3.1 granted both since the matrix was written and no route wrote either, so
 * the permissions were real and unreachable. Every refusal below is driven, and
 * each is mutation-proved able to fail.
 */
describe('changing an org role', () => {
  it('promotes and demotes, and reports the new role', () => {
    const target = makeUser('Grace', 'member');

    expect(setOrgRole(t.db, actor(ownerId), target, 'admin').org_role).toBe('admin');
    expect(setOrgRole(t.db, actor(ownerId), target, 'viewer').org_role).toBe('viewer');
  });

  it('writes an org-scoped member.role_changed carrying both ends', () => {
    const target = makeUser('Grace', 'member');
    setOrgRole(t.db, actor(ownerId), target, 'admin', 5000);

    const row = t.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'member.role_changed');

    // `project_id` is null because an org role belongs to no project (§4.8,
    // D-022) — the same shape `token.created` has.
    expect(row?.projectId).toBeNull();
    expect(row?.actorId).toBe(ownerId);
    expect(readPayload(row!)).toEqual({
      scope: 'org',
      user_id: target,
      from: 'member',
      to: 'admin',
    });
  });

  it('refuses an Admin any role change — roles are the Owner’s alone (D-102 rule 5)', () => {
    const adminId = makeUser('Admin', 'admin');
    const target = makeUser('Grace', 'member');

    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      try {
        setOrgRole(t.db, actor(adminId), target, role);
        expect.unreachable(`an admin set ${role}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('forbidden');
      }
    }
    expect(t.db.select().from(activity).all()).toEqual([]);
  });

  it('refuses a Member and a Viewer outright', () => {
    const target = makeUser('Grace', 'member');

    for (const role of ['member', 'viewer'] as const) {
      expect(() => setOrgRole(t.db, actor(makeUser(role, role)), target, 'admin')).toThrow(
        ApiError,
      );
    }
  });

  it('writes nothing when the role is already what was asked for', () => {
    const target = makeUser('Grace', 'member');
    setOrgRole(t.db, actor(ownerId), target, 'member');

    // A no-op that logged would put "changed member to member" in the audit
    // trail, which is noise a reader has to learn to ignore.
    expect(t.db.select().from(activity).all()).toHaveLength(0);
  });

  it('404s on a user that does not exist', () => {
    expect(() => setOrgRole(t.db, actor(ownerId), 'nope', 'admin')).toThrow(ApiError);
  });
});

describe('the last active Owner is the invariant, not four rules', () => {
  it('refuses to demote the only Owner', () => {
    expect(() => setOrgRole(t.db, actor(ownerId), ownerId, 'admin')).toThrow(/last active Owner/i);
  });

  it('refuses to deactivate the only Owner', () => {
    expect(() => setUserActive(t.db, actor(ownerId), ownerId, false)).toThrow(/last active Owner/i);
  });

  it('allows it once a second Owner exists', () => {
    const second = makeUser('Second', 'member');
    setOrgRole(t.db, actor(ownerId), second, 'owner');

    expect(setOrgRole(t.db, actor(ownerId), ownerId, 'admin').org_role).toBe('admin');
  });

  it('does not count a deactivated Owner as cover', () => {
    const second = makeUser('Second', 'owner', { isActive: 0 });
    void second;

    // Two Owner rows, one active. Counting rows rather than *active* rows would
    // let the org be locked out by a person who cannot sign in.
    expect(() => setOrgRole(t.db, actor(ownerId), ownerId, 'admin')).toThrow(/last active Owner/i);
  });

  it('refuses an Admin demoting themselves too, since an Admin changes no role (LAI-958)', () => {
    const adminId = makeUser('Admin', 'admin');

    expect(() => setOrgRole(t.db, actor(adminId), adminId, 'member')).toThrow(ApiError);
  });
});

describe('deactivating and reactivating', () => {
  it('flips is_active and writes the verb that names it', () => {
    const target = makeUser('Grace', 'member');

    expect(setUserActive(t.db, actor(ownerId), target, false).is_active).toBe(false);
    expect(setUserActive(t.db, actor(ownerId), target, true).is_active).toBe(true);

    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);

    // Not `member.removed`: the person is not removed and the row stays (§4.1).
    expect(types).toEqual(['user.deactivated', 'user.reactivated']);
  });

  it('keeps the row, because history keeps its author (§4.1)', () => {
    const target = makeUser('Grace', 'member');
    setUserActive(t.db, actor(ownerId), target, false);

    expect(t.db.select().from(users).where(eq(users.id, target)).get()).toBeDefined();
  });

  it('refuses a Member and a Viewer', () => {
    const target = makeUser('Grace', 'member');

    for (const role of ['member', 'viewer'] as const) {
      expect(() => setUserActive(t.db, actor(makeUser(role, role)), target, false)).toThrow(
        ApiError,
      );
    }
  });

  it('writes nothing when the state is already what was asked for', () => {
    const target = makeUser('Grace', 'member');
    setUserActive(t.db, actor(ownerId), target, true);

    expect(t.db.select().from(activity).all()).toHaveLength(0);
  });
});

// ---------------------------------------------- D-104 item 3 (LAI-981)

/** A better-auth session row, as sign-in writes one. */
function seedSession(userId: string, updatedAt: number): string {
  const id = newId();
  t.db
    .insert(sessions)
    .values({
      id,
      userId,
      token: `tok_${id}`,
      expiresAt: new Date(updatedAt + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
    })
    .run();
  return id;
}

function sessionsOf(userId: string): number {
  return t.db.select().from(sessions).where(eq(sessions.userId, userId)).all().length;
}

function mint(userId: string, name: string): { id: string; secret: string } {
  const { token, secret } = createToken(t.sqlite, t.db, actor(userId), { name, scope: 'full' });
  return { id: token.id, secret };
}

function payloadsOf(type: string): Record<string, unknown>[] {
  return t.db
    .select()
    .from(activity)
    .all()
    .filter((row) => row.type === type)
    .map((row) => readPayload(row) as Record<string, unknown>);
}

describe('deactivation ends access (D-104 item 3, LAI-981)', () => {
  it('revokes every token and ends every session of the person', () => {
    const target = makeUser('Grace', 'member');
    const laptop = mint(target, 'laptop');
    const agent = mint(target, 'agent');
    seedSession(target, 1000);
    seedSession(target, 2000);

    setUserActive(t.db, actor(ownerId), target, false, 5000);

    expect(findTokenBySecret(t.db, laptop.secret, 6000)).toEqual({ ok: false, reason: 'revoked' });
    expect(findTokenBySecret(t.db, agent.secret, 6000)).toEqual({ ok: false, reason: 'revoked' });
    expect(sessionsOf(target)).toBe(0);

    const [payload] = payloadsOf('user.deactivated');
    expect(payload).toMatchObject({ user_id: target, sessions_ended: 2 });
    expect([...(payload?.token_ids as string[])].sort()).toEqual([laptop.id, agent.id].sort());
  });

  it("leaves everybody else's tokens and sessions alone", () => {
    const target = makeUser('Grace', 'member');
    const bystander = makeUser('Hedy', 'member');
    mint(target, 'laptop');
    const theirs = mint(bystander, 'laptop');
    seedSession(bystander, 1000);

    setUserActive(t.db, actor(ownerId), target, false);

    expect(findTokenBySecret(t.db, theirs.secret, Date.now()).ok).toBe(true);
    expect(sessionsOf(bystander)).toBe(1);
  });

  it("keeps an already-revoked token's revoked_at, rather than restamping it", () => {
    const target = makeUser('Grace', 'member');
    const old = mint(target, 'old');
    t.db.update(tokens).set({ revokedAt: 1234 }).where(eq(tokens.id, old.id)).run();

    setUserActive(t.db, actor(ownerId), target, false, 5000);

    expect(t.db.select().from(tokens).where(eq(tokens.id, old.id)).get()?.revokedAt).toBe(1234);
    expect(payloadsOf('user.deactivated')[0]?.token_ids).toEqual([]);
  });

  it('restores neither tokens nor sessions on reactivation', () => {
    const target = makeUser('Grace', 'member');
    const laptop = mint(target, 'laptop');
    seedSession(target, 1000);

    setUserActive(t.db, actor(ownerId), target, false, 5000);
    setUserActive(t.db, actor(ownerId), target, true, 6000);

    expect(findTokenBySecret(t.db, laptop.secret, 7000)).toEqual({ ok: false, reason: 'revoked' });
    expect(sessionsOf(target)).toBe(0);
    expect(payloadsOf('user.reactivated')[0]).toEqual({ user_id: target, org_role: 'member' });
  });

  it('does it in the same transaction as the flag: a refusal leaves all three untouched', () => {
    // The last Owner cannot be deactivated (409). Nothing of theirs may go.
    const laptop = mint(ownerId, 'laptop');
    seedSession(ownerId, 1000);

    expectApiError(() => setUserActive(t.db, actor(ownerId), ownerId, false), 'conflict');

    expect(findTokenBySecret(t.db, laptop.secret, Date.now()).ok).toBe(true);
    expect(sessionsOf(ownerId)).toBe(1);
  });

  it('rolls the flag back when ending access fails part-way', () => {
    const target = makeUser('Grace', 'member');
    const laptop = mint(target, 'laptop');
    seedSession(target, 1000);
    // Fail the last write before the event: the flag and the tokens have
    // already been written inside the transaction when the sessions refuse.
    t.sqlite.exec(
      "CREATE TRIGGER sessions_refuse BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );

    expect(() => setUserActive(t.db, actor(ownerId), target, false)).toThrow(/refused/);

    expect(t.db.select().from(users).where(eq(users.id, target)).get()?.isActive).toBe(1);
    expect(findTokenBySecret(t.db, laptop.secret, Date.now()).ok).toBe(true);
    expect(sessionsOf(target)).toBe(1);
  });

  it('keeps when they were last seen after their sessions are gone', () => {
    const target = makeUser('Grace', 'member');
    seedSession(target, 1000);
    seedSession(target, 3000);

    const view = setUserActive(t.db, actor(ownerId), target, false, 5000);

    expect(view.last_seen_at).toBe(3000);
  });
});

describe('signing a person out everywhere (D-104 item 3, LAI-981)', () => {
  it('ends every session and leaves their tokens', () => {
    const target = makeUser('Grace', 'member');
    const laptop = mint(target, 'laptop');
    seedSession(target, 1000);
    seedSession(target, 2000);

    expect(signOutEverywhere(t.db, actor(ownerId), target, 5000)).toEqual({
      user_id: target,
      sessions_ended: 2,
    });

    expect(sessionsOf(target)).toBe(0);
    expect(findTokenBySecret(t.db, laptop.secret, 6000).ok).toBe(true);
    // And they stay active: this is not a deactivation.
    expect(t.db.select().from(users).where(eq(users.id, target)).get()?.isActive).toBe(1);
  });

  it('is logged, naming who and how many', () => {
    const target = makeUser('Grace', 'member');
    seedSession(target, 1000);

    signOutEverywhere(t.db, actor(ownerId), target, 5000);

    const rows = t.db.select().from(activity).all();
    expect(rows.map((r) => [r.type, r.actorId, r.projectId])).toEqual([
      ['user.signed_out', ownerId, null],
    ]);
    expect(payloadsOf('user.signed_out')).toEqual([{ user_id: target, sessions_ended: 1 }]);
  });

  it('writes no event when there was nothing to end', () => {
    const target = makeUser('Grace', 'member');

    expect(signOutEverywhere(t.db, actor(ownerId), target).sessions_ended).toBe(0);
    expect(t.db.select().from(activity).all()).toHaveLength(0);
  });

  it('lets anyone sign themselves out, a Viewer included', () => {
    for (const role of ['member', 'viewer'] as const) {
      const self = makeUser(`Self ${role}`, role);
      seedSession(self, 1000);

      expect(signOutEverywhere(t.db, actor(self), self).sessions_ended).toBe(1);
    }
  });

  it('lets an Admin sign somebody else out, by default', () => {
    const target = makeUser('Grace', 'member');
    seedSession(target, 1000);

    expect(signOutEverywhere(t.db, actor(makeUser('Admin', 'admin')), target).sessions_ended).toBe(
      1,
    );
  });

  it('refuses a Member or Viewer signing somebody else out, with forbidden', () => {
    const target = makeUser('Grace', 'member');
    seedSession(target, 1000);

    for (const role of ['member', 'viewer'] as const) {
      expectApiError(
        () => signOutEverywhere(t.db, actor(makeUser(`Other ${role}`, role)), target),
        'forbidden',
      );
    }
    expect(sessionsOf(target)).toBe(1);
  });

  it('404s on a person who does not exist', () => {
    expectApiError(() => signOutEverywhere(t.db, actor(ownerId), 'usr_nobody'), 'not_found');
  });
});

describe('last_seen_at (LAI-981)', () => {
  it('is null for somebody who never signed in', () => {
    makeUser('Grace', 'member');

    const grace = listUsers(t.db, actor(ownerId), PAGE).find((u) => u.name === 'Grace');
    expect(grace?.last_seen_at).toBeNull();
  });

  it('is the latest activity across their live sessions', () => {
    const target = makeUser('Grace', 'member');
    seedSession(target, 1000);
    seedSession(target, 4000);
    seedSession(ownerId, 9000);

    const grace = listUsers(t.db, actor(ownerId), PAGE).find((u) => u.id === target);
    expect(grace?.last_seen_at).toBe(4000);
  });

  it('survives a forced sign-out, and a later sign-in moves it on', () => {
    const target = makeUser('Grace', 'member');
    seedSession(target, 4000);
    signOutEverywhere(t.db, actor(ownerId), target);

    const find = () => listUsers(t.db, actor(ownerId), PAGE).find((u) => u.id === target);
    expect(find()?.last_seen_at).toBe(4000);

    seedSession(target, 8000);
    expect(find()?.last_seen_at).toBe(8000);
  });
});

describe("a person's spaces (LAI-981)", () => {
  function makeProject(name: string, visibility: 'public' | 'private' = 'private'): string {
    const id = newId();
    const now = Date.now();
    const orgId = t.db.select().from(orgs).get()!.id;
    t.db
      .insert(projects)
      .values({
        id,
        orgId,
        name,
        slug: name.toLowerCase(),
        prefix: name.slice(0, 3).toUpperCase(),
        visibility,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  function join(projectId: string, userId: string, role: 'lead' | 'member' | 'viewer'): void {
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId, userId, role, createdAt: 1000 })
      .run();
  }

  it('lists each space with the role held there, alphabetically', () => {
    const target = makeUser('Grace', 'member');
    const zeta = makeProject('Zeta');
    const alpha = makeProject('Alpha');
    join(zeta, target, 'lead');
    join(alpha, target, 'viewer');

    expect(listMemberships(t.db, actor(ownerId), target)).toEqual([
      {
        project_id: alpha,
        slug: 'alpha',
        name: 'Alpha',
        prefix: 'ALP',
        role: 'viewer',
        archived: false,
        joined_at: 1000,
      },
      {
        project_id: zeta,
        slug: 'zeta',
        name: 'Zeta',
        prefix: 'ZET',
        role: 'lead',
        archived: false,
        joined_at: 1000,
      },
    ]);
  });

  it('shows a member only the spaces they can read themselves', () => {
    const target = makeUser('Grace', 'member');
    const asker = makeUser('Hedy', 'member');
    const shared = makeProject('Shared');
    const secret = makeProject('Secret');
    join(shared, target, 'member');
    join(shared, asker, 'member');
    join(secret, target, 'member');

    expect(listMemberships(t.db, actor(asker), target).map((m) => m.name)).toEqual(['Shared']);
    // The owner reads every space, so sees both.
    expect(listMemberships(t.db, actor(ownerId), target).map((m) => m.name)).toEqual([
      'Secret',
      'Shared',
    ]);
  });

  it('refuses a deactivated caller and 404s an unknown person', () => {
    const target = makeUser('Grace', 'member');
    const gone = makeUser('Gone', 'admin', { isActive: 0 });

    expectApiError(() => listMemberships(t.db, actor(gone), target), 'forbidden');
    expectApiError(() => listMemberships(t.db, actor(ownerId), 'usr_nobody'), 'not_found');
  });
});
