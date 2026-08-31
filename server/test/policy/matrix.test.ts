import { describe, expect, it } from 'vitest';
import { type OrgRole, type ProjectRole } from '../../src/db/enums.ts';
import { ALL_ACTIONS, type OrgAction, type ProjectAction } from '../../src/policy/actions.ts';
import { type Actor, can, type Resource } from '../../src/policy/can.ts';

/**
 * The executable version of SPEC §3.1 and §3.2 (§3.3 rule 5).
 *
 * Both tables below are transcribed cell for cell, in the spec's row order, so
 * that reviewing this file against the document is a line-by-line read. Every
 * cell is asserted — the `✓` and the `—` alike, because a matrix test that only
 * checks the allows would pass for a `can()` that returns `true` unconditionally.
 */

const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];
const PROJECT_ROLES: ProjectRole[] = ['lead', 'member', 'viewer'];

function actor(orgRole: OrgRole, projectRole: ProjectRole | null = null): Actor {
  return { userId: 'u1', orgRole, isActive: true, projectRole };
}

// ---------------------------------------------------------------- SPEC §3.1

/** owner, admin, member, viewer — in that column order, as printed. */
type OrgRow = [OrgAction, boolean, boolean, boolean, boolean];

const ORG_MATRIX: OrgRow[] = [
  // | Delete org data / transfer ownership | ✓ | — | — | — |
  ['org.delete', true, false, false, false],
  ['org.transfer_ownership', true, false, false, false],
  // | Org settings (AI provider, SMTP, signup mode) | ✓ | ✓ | — | — |
  ['org.settings.edit', true, true, false, false],
  // | Create / archive project | ✓ | ✓ | — | — |
  ['project.create', true, true, false, false],
  ['project.archive', true, true, false, false],
  // | Invite users / change org roles | ✓ | ✓ (not to Owner) | — | — |
  ['user.invite', true, true, false, false],
  // | Deactivate user | ✓ | ✓ | — | — |
  ['user.deactivate', true, true, false, false],
  // | View member list | ✓ | ✓ | ✓ | ✓ |
  ['member_list.read', true, true, true, true],
  // | Generate own tokens | ✓ | ✓ | ✓ | ✓ (read_only forced) |
  ['token.create_own', true, true, true, true],
  // | List / revoke anyone's token | ✓ | ✓ | — | — |
  ['token.list_any', true, true, false, false],
  ['token.revoke_any', true, true, false, false],
  // | Log own unlisted work | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
  // Every role: it is your own record about your own work, creating nothing in
  // any project. The Viewer ✓ is the role's answer — their credential is what
  // stops them, not the matrix (see `can.test.ts`).
  ['unlisted.log_own', true, true, true, true],
  // | Export audit log | ✓ | ✓ | — | — |
  ['audit_log.export', true, true, false, false],
  // | Configure webhooks | ✓ | ✓ | — | — |
  ['webhook.configure', true, true, false, false],
];

describe('SPEC §3.1 — org-level matrix', () => {
  for (const [action, ...expected] of ORG_MATRIX) {
    it(`${action}: ${ORG_ROLES.map((r, i) => `${r}=${expected[i] ? 'yes' : 'no'}`).join(' ')}`, () => {
      ORG_ROLES.forEach((role, i) => {
        expect(can(actor(role), action, {}), `${action} / ${role}`).toBe(expected[i]);
      });
    });
  }
});

describe('SPEC §3.1 — rows that depend on the resource', () => {
  it('Admin may set any role except Owner', () => {
    expect(can(actor('admin'), 'user.set_role', { targetOrgRole: 'admin' })).toBe(true);
    expect(can(actor('admin'), 'user.set_role', { targetOrgRole: 'member' })).toBe(true);
    expect(can(actor('admin'), 'user.set_role', { targetOrgRole: 'owner' })).toBe(false);
  });

  it('Owner may set any role including Owner', () => {
    for (const target of ORG_ROLES) {
      expect(can(actor('owner'), 'user.set_role', { targetOrgRole: target })).toBe(true);
    }
  });

  it('Member and Viewer may set no roles at all', () => {
    for (const role of ['member', 'viewer'] as const) {
      for (const target of ORG_ROLES) {
        expect(can(actor(role), 'user.set_role', { targetOrgRole: target })).toBe(false);
      }
    }
  });

  it('every role may join a public project, and none may join a private one', () => {
    for (const role of ORG_ROLES) {
      expect(can(actor(role), 'project.join_public', { visibility: 'public' })).toBe(true);
      expect(can(actor(role), 'project.join_public', { visibility: 'private' })).toBe(false);
    }
  });

  it('own-token actions resolve against the owner id', () => {
    for (const role of ORG_ROLES) {
      expect(can(actor(role), 'token.read_own', { ownerId: 'u1' })).toBe(true);
      expect(can(actor(role), 'token.revoke_own', { ownerId: 'u1' })).toBe(true);
      expect(can(actor(role), 'token.read_own', { ownerId: 'someone-else' })).toBe(false);
      expect(can(actor(role), 'token.revoke_own', { ownerId: 'someone-else' })).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- SPEC §3.2

/** lead, member, viewer — in that column order, as printed. */
type ProjectRow = [ProjectAction, boolean, boolean, boolean];

const PROJECT_MATRIX: ProjectRow[] = [
  // | Manage project members | ✓ | — | — |
  ['project.members.manage', true, false, false],
  // | Edit project settings and context_md | ✓ | — | — |
  ['project.settings.edit', true, false, false],
  // | Create / edit / delete sprints | ✓ | — | — |
  ['sprint.manage', true, false, false],
  // | Assign tasks into or out of a sprint | ✓ | ✓ | — |
  ['task.assign_sprint', true, true, false],
  // | Create / edit / move any task | ✓ | ✓ | — |
  ['task.write', true, true, false],
  // | Claim a task (start_working) | ✓ | ✓ | — |
  ['task.claim', true, true, false],
  // | Assign a task to someone else | ✓ | ✓ | — |
  ['task.assign_other', true, true, false],
  // | Add comment | ✓ | ✓ | — |
  ['comment.create', true, true, false],
  // | Add / remove dependencies | ✓ | ✓ | — |
  ['task.dependency.write', true, true, false],
  // | Read tasks, comments, activity, capacity | ✓ | ✓ | ✓ |
  ['project.read', true, true, true],
  // | Apply a meeting-diff proposal | ✓ | ✓ | — |
  ['meeting_proposal.apply', true, true, false],
];

/** An org `member` so the org role never grants implicit lead. */
function projectActor(projectRole: ProjectRole | null): Actor {
  return actor('member', projectRole);
}

describe('SPEC §3.2 — project-level matrix', () => {
  for (const [action, ...expected] of PROJECT_MATRIX) {
    it(`${action}: ${PROJECT_ROLES.map((r, i) => `${r}=${expected[i] ? 'yes' : 'no'}`).join(' ')}`, () => {
      PROJECT_ROLES.forEach((role, i) => {
        expect(can(projectActor(role), action, { projectId: 'p1' }), `${action} / ${role}`).toBe(
          expected[i],
        );
      });
    });
  }

  it('denies every project action to a non-member', () => {
    for (const [action] of PROJECT_MATRIX) {
      expect(can(projectActor(null), action, { projectId: 'p1' }), action).toBe(false);
    }
  });
});

describe('SPEC §3.2 — the `own` cells', () => {
  const OWN: Resource = { projectId: 'p1', ownerId: 'u1', createdBy: 'u1' };
  const THEIRS: Resource = { projectId: 'p1', ownerId: 'u2', createdBy: 'u2' };

  it('| Edit / delete comment | own + any | own | — |', () => {
    for (const action of ['comment.edit', 'comment.delete'] as const) {
      // Lead: any comment, including someone else's.
      expect(can(projectActor('lead'), action, THEIRS), `lead ${action}`).toBe(true);
      expect(can(projectActor('lead'), action, OWN), `lead own ${action}`).toBe(true);
      // Member: their own only.
      expect(can(projectActor('member'), action, OWN), `member own ${action}`).toBe(true);
      expect(can(projectActor('member'), action, THEIRS), `member other ${action}`).toBe(false);
      // Viewer: neither.
      expect(can(projectActor('viewer'), action, OWN), `viewer ${action}`).toBe(false);
    }
  });

  it('| Cancel / delete task | ✓ | own-created | — |', () => {
    expect(can(projectActor('lead'), 'task.delete', THEIRS)).toBe(true);
    expect(can(projectActor('member'), 'task.delete', OWN)).toBe(true);
    expect(can(projectActor('member'), 'task.delete', THEIRS)).toBe(false);
    expect(can(projectActor('viewer'), 'task.delete', OWN)).toBe(false);
  });

  it('treats a missing owner id as not-yours rather than as a match', () => {
    // Both undefined must not compare equal — that would make every ownerless
    // resource everyone's.
    expect(can(projectActor('member'), 'comment.edit', { projectId: 'p1' })).toBe(false);
    expect(can(projectActor('member'), 'task.delete', { projectId: 'p1' })).toBe(false);
  });
});

describe('completeness', () => {
  it('asserts every action in the closed union', () => {
    const asserted = new Set<string>([
      ...ORG_MATRIX.map(([a]) => a as string),
      ...PROJECT_MATRIX.map(([a]) => a as string),
      'user.set_role',
      'project.join_public',
      'token.read_own',
      'token.revoke_own',
      'comment.edit',
      'comment.delete',
      'task.delete',
    ]);

    expect(ALL_ACTIONS.filter((a) => !asserted.has(a))).toEqual([]);
  });
});
