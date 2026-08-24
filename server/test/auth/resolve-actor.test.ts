import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, withProject } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { projectMemberships, users } from '../../src/db/schema.ts';
import { can } from '../../src/policy/can.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

describe('loadActor', () => {
  it('reads the role from the database, not from a session payload', () => {
    const actor = loadActor(t.db, s.userId);

    expect(actor).not.toBeNull();
    expect(actor?.orgRole).toBe('owner');
    expect(actor?.isActive).toBe(true);
    expect(actor?.memberships).toEqual([]);
  });

  it('reflects a demotion immediately', () => {
    // A session minted before a demotion must not keep carrying the old role.
    t.db.update(users).set({ orgRole: 'viewer' }).run();

    expect(loadActor(t.db, s.userId)?.orgRole).toBe('viewer');
  });

  it('reports a deactivated user as inactive so `can()` denies everything', () => {
    t.db.update(users).set({ isActive: 0 }).run();

    const actor = loadActor(t.db, s.userId);
    expect(actor?.isActive).toBe(false);
    expect(can(actor!, 'member_list.read')).toBe(false);
  });

  it('returns null for an unknown user id', () => {
    expect(loadActor(t.db, newId())).toBeNull();
  });

  it('collects every project membership', () => {
    t.db
      .insert(projectMemberships)
      .values({
        id: newId(),
        projectId: s.projectId,
        userId: s.userId,
        role: 'lead',
        createdAt: Date.now(),
      })
      .run();

    expect(loadActor(t.db, s.userId)?.memberships).toEqual([
      { projectId: s.projectId, role: 'lead' },
    ]);
  });
});

describe('withProject', () => {
  it('resolves the membership row for the project in question', () => {
    t.db
      .insert(projectMemberships)
      .values({
        id: newId(),
        projectId: s.projectId,
        userId: s.userId,
        role: 'member',
        createdAt: Date.now(),
      })
      .run();

    const actor = loadActor(t.db, s.userId)!;

    expect(withProject(actor, s.projectId).projectRole).toBe('member');
    expect(withProject(actor, 'some-other-project').projectRole).toBeNull();
  });

  it('leaves the base actor untouched', () => {
    const actor = loadActor(t.db, s.userId)!;
    withProject(actor, s.projectId);

    expect(actor.projectRole).toBeNull();
  });
});
