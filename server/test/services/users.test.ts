import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { listUsers } from '../../src/services/users.ts';
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
      avatarColor: '#123456',
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
  it('returns id, name, email, avatar_color, role and whether they are active', () => {
    const [ada] = listUsers(t.db, actor(ownerId), PAGE);

    expect(ada).toMatchObject({
      id: ownerId,
      name: 'Ada Lovelace',
      email: 'ada.lovelace@example.test',
      avatar_color: '#123456',
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
      'avatar_color',
      'created_at',
      'email',
      'id',
      'is_active',
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
