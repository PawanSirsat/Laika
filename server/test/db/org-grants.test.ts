import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { mergeGrants, readStoredGrants } from '../../src/db/org-grants.ts';
import { orgRoleGrants, orgs, users } from '../../src/db/schema.ts';
import { DEFAULT_GRANTS } from '../../src/policy/grants.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The stored grants (§4.58, LAI-958): a missing row is the default, a stored
 * row wins over it, and `loadActor` carries the result on every actor.
 */

let t: TestDb;
let orgId: string;
let ownerId: string;

function insertUser(orgRole: 'owner' | 'admin' | 'member' | 'viewer'): string {
  const id = newId();
  const now = new Date();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: orgRole,
      orgRole,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function store(orgRole: 'admin' | 'member' | 'viewer', capability: string, granted: 0 | 1): void {
  t.db
    .insert(orgRoleGrants)
    .values({
      orgId,
      orgRole,
      capability: capability as 'manage_people',
      granted,
      setBy: ownerId,
      updatedAt: Date.now(),
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  ownerId = insertUser('owner');
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

describe('readStoredGrants and mergeGrants', () => {
  it('reads nothing before setup, and the defaults are the answer', () => {
    const empty = freshDb();
    try {
      expect(readStoredGrants(empty.db)).toEqual({});
    } finally {
      empty.close();
    }
    expect(mergeGrants(readStoredGrants(t.db), DEFAULT_GRANTS)).toEqual(DEFAULT_GRANTS);
  });

  it('lets a stored cell win over its default, both ways, and leaves the rest alone', () => {
    store('member', 'see_org_activity', 1);
    store('admin', 'manage_people', 0);

    const merged = mergeGrants(readStoredGrants(t.db), DEFAULT_GRANTS);
    expect(merged.member).toEqual(['see_org_activity']);
    expect(merged.admin).not.toContain('manage_people');
    expect(merged.admin).toHaveLength(DEFAULT_GRANTS.admin.length - 1);
    expect(merged.viewer).toEqual([]);
  });

  it('refuses an owner row and an unknown capability at the database (CHECK)', () => {
    expect(() =>
      t.db
        .insert(orgRoleGrants)
        .values({
          orgId,
          orgRole: 'owner' as 'admin',
          capability: 'manage_people',
          granted: 1,
          setBy: ownerId,
          updatedAt: Date.now(),
        })
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() => store('member', 'delete_the_org', 1)).toThrow(/CHECK constraint failed/);
  });
});

describe('loadActor carries the grants', () => {
  it('on every actor, owner included, read fresh each time', () => {
    const memberId = insertUser('member');
    expect(loadActor(t.db, memberId)?.orgGrants).toEqual(DEFAULT_GRANTS);

    store('member', 'see_people_analytics', 1);
    expect(loadActor(t.db, memberId)?.orgGrants?.member).toEqual(['see_people_analytics']);
    expect(loadActor(t.db, ownerId)?.orgGrants?.member).toEqual(['see_people_analytics']);
  });
});
