import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type Capability, GRANTABLE_ROLES, ORG_ROLES } from '../../src/db/enums.ts';
import { ORG_ACTIONS, type OrgAction } from '../../src/policy/actions.ts';
import { type Actor, can, effectiveProjectRole } from '../../src/policy/can.ts';
import {
  CAPABILITY_ACTIONS,
  DEFAULT_GRANTS,
  type OrgGrants,
  OWNER_LOCKED_ACTIONS,
} from '../../src/policy/grants.ts';

/**
 * The owner's grants per org role (SPEC §3, D-102 rule 6, LAI-958).
 *
 * `matrix.test.ts` holds the defaults cell by cell; this holds what a grant
 * **changes**: flipping one capability for one role changes that role's
 * answer for exactly that capability's actions, and nothing else anywhere.
 */

const NONE: OrgGrants = { admin: [], member: [], viewer: [] };
const EVERYTHING: OrgGrants = { admin: CAPABILITIES, member: CAPABILITIES, viewer: CAPABILITIES };

function actor(
  orgRole: Actor['orgRole'],
  orgGrants?: OrgGrants,
  extra: Partial<Actor> = {},
): Actor {
  return { userId: 'u1', orgRole, isActive: true, projectRole: null, orgGrants, ...extra };
}

/** One role holding one capability, everyone else nothing. */
function only(role: (typeof GRANTABLE_ROLES)[number], capability: Capability): OrgGrants {
  return { ...NONE, [role]: [capability] };
}

/** Every org action's answer, per org role, under `grants`. */
function answers(grants: OrgGrants | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const role of ORG_ROLES) {
    for (const action of ORG_ACTIONS) {
      out[`${role} ${action}`] = can(actor(role, grants), action, {});
    }
  }
  return out;
}

describe('the mapping', () => {
  it('gives each action to at most one capability', () => {
    const seen = new Map<OrgAction, Capability>();
    const twice: string[] = [];
    for (const [capability, actions] of Object.entries(CAPABILITY_ACTIONS)) {
      for (const action of actions) {
        if (seen.has(action)) twice.push(action);
        seen.set(action, capability as Capability);
      }
    }
    expect(twice).toEqual([]);
  });

  it('grants no owner-locked action', () => {
    const carried = Object.values(CAPABILITY_ACTIONS).flat();
    expect(carried.filter((a) => (OWNER_LOCKED_ACTIONS as readonly string[]).includes(a))).toEqual(
      [],
    );
  });

  it('defaults to today: admin holds every capability, member and viewer none', () => {
    expect([...DEFAULT_GRANTS.admin].sort()).toEqual([...CAPABILITIES].sort());
    expect(DEFAULT_GRANTS.member).toEqual([]);
    expect(DEFAULT_GRANTS.viewer).toEqual([]);
  });

  it('answers an actor with no matrix exactly as one with the defaults', () => {
    expect(answers(undefined)).toEqual(answers(DEFAULT_GRANTS));
  });
});

describe('a flipped grant changes that role’s answer, and only for that capability', () => {
  const baseline = answers(NONE);

  for (const capability of CAPABILITIES) {
    const actions = CAPABILITY_ACTIONS[capability];
    if (actions.length === 0) continue; // `open_all_projects` is a project role; below.

    for (const role of GRANTABLE_ROLES) {
      it(`${capability} → ${role}`, () => {
        const after = answers(only(role, capability));
        const changed = Object.keys(after)
          .filter((key) => after[key] !== baseline[key])
          .sort();

        expect(changed).toEqual(actions.map((action) => `${role} ${action}`).sort());
        for (const action of actions) {
          expect(baseline[`${role} ${action}`], `${role} ${action} off`).toBe(false);
          expect(after[`${role} ${action}`], `${role} ${action} on`).toBe(true);
        }
      });
    }
  }

  it('the owner holds every capability with nothing granted to anyone', () => {
    for (const action of Object.values(CAPABILITY_ACTIONS).flat()) {
      expect(baseline[`owner ${action}`], action).toBe(true);
    }
  });

  it('withdrawing a capability from admin refuses it to admin', () => {
    const withdrawn: OrgGrants = {
      ...DEFAULT_GRANTS,
      admin: DEFAULT_GRANTS.admin.filter((c) => c !== 'see_org_activity'),
    };
    expect(can(actor('admin', DEFAULT_GRANTS), 'audit_log.export')).toBe(true);
    expect(can(actor('admin', withdrawn), 'audit_log.export')).toBe(false);
    expect(can(actor('admin', withdrawn), 'user.invite')).toBe(true);
  });
});

describe('owner-locked actions are never granted', () => {
  it('stay the owner’s with every capability granted to every role', () => {
    for (const role of GRANTABLE_ROLES) {
      for (const action of OWNER_LOCKED_ACTIONS) {
        expect(can(actor(role, EVERYTHING), action, { targetOrgRole: 'member' }), role).toBe(false);
      }
    }
    for (const action of OWNER_LOCKED_ACTIONS) {
      expect(can(actor('owner', NONE), action, {}), action).toBe(true);
    }
  });
});

describe('the credential still narrows after a grant (§3.3 rule 4)', () => {
  const FULL = { id: 't', scope: 'full' as const, projectIds: null };
  const READ_ONLY = { id: 't', scope: 'read_only' as const, projectIds: null };

  it('session only: a granted member reads a profile signed in, never on a token', () => {
    const grants = only('member', 'see_people_analytics');
    expect(can(actor('member', grants), 'profile.read')).toBe(true);
    expect(can(actor('member', grants, { token: FULL }), 'profile.read')).toBe(false);
  });

  it('read only: a granted member invites on a full token and not on a read-only one', () => {
    const grants = only('member', 'manage_people');
    expect(can(actor('member', grants, { token: FULL }), 'user.invite')).toBe(true);
    expect(can(actor('member', grants, { token: READ_ONLY }), 'user.invite')).toBe(false);
  });

  it('a viewer’s token stays read only, granted or not', () => {
    const grants = only('viewer', 'manage_people');
    expect(can(actor('viewer', grants), 'user.invite')).toBe(true);
    expect(can(actor('viewer', grants, { token: FULL }), 'user.invite')).toBe(false);
  });

  it('a granted member invites as member or viewer, never admin or owner', () => {
    const member = actor('member', only('member', 'manage_people'));
    expect(can(member, 'user.invite', { targetOrgRole: 'viewer' })).toBe(true);
    expect(can(member, 'user.invite', { targetOrgRole: 'member' })).toBe(true);
    expect(can(member, 'user.invite', { targetOrgRole: 'admin' })).toBe(false);
    expect(can(member, 'user.invite', { targetOrgRole: 'owner' })).toBe(false);
  });
});

describe('Open every project is the implicit project role', () => {
  const P = { projectId: 'p1' };

  it('makes a granted member a lead everywhere without a membership', () => {
    const member = actor('member', only('member', 'open_all_projects'));
    expect(effectiveProjectRole(member)).toBe('lead');
    expect(can(member, 'sprint.manage', P)).toBe(true);
    expect(can(actor('member', NONE), 'project.read', P)).toBe(false);
  });

  it('lets a granted viewer read every project and nothing more (D-006)', () => {
    const viewer = actor('viewer', only('viewer', 'open_all_projects'));
    expect(effectiveProjectRole(viewer)).toBe('viewer');
    expect(can(viewer, 'project.read', P)).toBe(true);
    expect(can(viewer, 'task.write', P)).toBe(false);
    // And a lead membership row is still capped.
    expect(effectiveProjectRole({ ...viewer, projectRole: 'lead' })).toBe('viewer');
  });

  it('leaves an admin without it only the memberships they hold', () => {
    const admin = actor('admin', NONE);
    expect(effectiveProjectRole(admin)).toBeNull();
    expect(can(admin, 'project.read', P)).toBe(false);
    expect(effectiveProjectRole({ ...admin, projectRole: 'member' })).toBe('member');
    expect(can({ ...admin, projectRole: 'member' }, 'sprint.manage', P)).toBe(false);
  });

  it('is always the owner’s', () => {
    expect(effectiveProjectRole(actor('owner', NONE))).toBe('lead');
  });
});
