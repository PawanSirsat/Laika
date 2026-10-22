import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { readPayload } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgRoleGrants, orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { can } from '../../src/policy/can.ts';
import {
  getOrgPermissions,
  type GrantsInput,
  setOrgPermissions,
} from '../../src/services/org-permissions.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * `services/org-permissions.ts` (LAI-958): who may read and replace the
 * matrix, what a body must be, and that a saved grant reaches `can()` through
 * the next actor `loadActor` builds. The route's codes are asserted in
 * `http/routes/permissions.test.ts`.
 */

let t: TestDb;
const ids: Record<string, string> = {};

const OFF = {
  see_people_analytics: false,
  see_org_activity: false,
  open_all_projects: false,
  manage_people: false,
  change_org_settings: false,
};
const ON = Object.fromEntries(Object.keys(OFF).map((k) => [k, true]));
const DEFAULTS: GrantsInput = { admin: ON, member: OFF, viewer: OFF };

function actor(role: string): ResolvedActor {
  const loaded = loadActor(t.db, ids[role]!);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function codeOf(fn: () => unknown): { code: string; details: unknown } {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return { code: err.code, details: err.details };
    throw err;
  }
  throw new Error('should have thrown');
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    ids[role] = newId();
    t.db
      .insert(users)
      .values({
        id: ids[role],
        email: `${role}@example.test`,
        name: role,
        orgRole: role,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
  }
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ids.owner!, createdAt: now, updatedAt: now })
    .run();
});
afterEach(() => {
  t.close();
});

describe('reading', () => {
  it('answers every role the same matrix', () => {
    const owner = getOrgPermissions(t.db, actor('owner'));
    for (const role of ['admin', 'member', 'viewer']) {
      expect(getOrgPermissions(t.db, actor(role))).toEqual(owner);
    }
    expect(owner.grants).toEqual(DEFAULTS);
  });
});

describe('replacing', () => {
  it('is the owner’s alone', () => {
    for (const role of ['admin', 'member', 'viewer']) {
      expect(codeOf(() => setOrgPermissions(t.db, actor(role), DEFAULTS))).toMatchObject({
        code: 'forbidden',
        details: { action: 'org.permissions.manage' },
      });
    }
    expect(t.db.select().from(orgRoleGrants).all()).toEqual([]);
  });

  it('asks can() before it validates anything', () => {
    // A member sending garbage learns they may not, not what a body looks like.
    expect(codeOf(() => setOrgPermissions(t.db, actor('member'), { owner: OFF }))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('writes every cell, one audit row, and the next actor holds the grant', () => {
    const member = () => actor('member');
    expect(can(member(), 'audit_log.export')).toBe(false);

    const view = setOrgPermissions(
      t.db,
      actor('owner'),
      { ...DEFAULTS, member: { ...OFF, see_org_activity: true } },
      1_000,
    );

    expect(view.grants.member.see_org_activity).toBe(true);
    expect(view.updated_at).toBe(1_000);
    expect(t.db.select().from(orgRoleGrants).all()).toHaveLength(15);
    expect(can(member(), 'audit_log.export')).toBe(true);
    // The viewer's answer is untouched.
    expect(can(actor('viewer'), 'audit_log.export')).toBe(false);

    const rows = t.db.select().from(activity).all();
    expect(rows.map((r) => r.type)).toEqual(['member.role_changed']);
    expect(rows[0]!.actorId).toBe(ids.owner);
    expect(readPayload(rows[0]!)).toEqual({
      scope: 'org_permissions',
      from: { admin: Object.keys(OFF), member: [], viewer: [] },
      to: { admin: Object.keys(OFF), member: ['see_org_activity'], viewer: [] },
    });
  });

  it('names an owner-locked action rather than calling it unknown', () => {
    expect(
      codeOf(() =>
        setOrgPermissions(t.db, actor('owner'), {
          ...DEFAULTS,
          viewer: { ...OFF, 'user.set_role': true },
        }),
      ),
    ).toMatchObject({
      code: 'unprocessable',
      details: { field: 'grants.viewer.user.set_role', reason: 'owner_locked' },
    });
  });

  it('writes nothing for a body equal to what is there', () => {
    setOrgPermissions(t.db, actor('owner'), DEFAULTS);
    expect(t.db.select().from(orgRoleGrants).all()).toEqual([]);
    expect(t.db.select().from(activity).all()).toEqual([]);
  });
});
