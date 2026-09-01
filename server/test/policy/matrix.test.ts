import { describe, expect, it } from 'vitest';
import { type OrgRole, type ProjectRole } from '../../src/db/enums.ts';
import {
  type Action,
  ALL_ACTIONS,
  type OrgAction,
  type ProjectAction,
  SYSTEM_ACTIONS,
} from '../../src/policy/actions.ts';
import { type Actor, can, type Resource, systemPrincipal } from '../../src/policy/can.ts';

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
  // | View the organisation | ✓ | ✓ | ✓ | ✓ |
  // Its own row rather than folded into `member_list.read` (LAI-222): the
  // response also carries the AI provider block, which is gated field-level on
  // `org.settings.edit`, and a borrowed row would have handed the next field
  // added to it a grant nobody reviewed.
  ['org.read', true, true, true, true],
  // | Presence and capacity | ✓ | ✓ | ✓ | ✓ |
  // The row grants asking; §9.1's per-project filter decides what comes back,
  // and capacity's `unlisted` narrows again on `audit_log.export` (LAI-432).
  ['presence.read', true, true, true, true],
  ['capacity.read', true, true, true, true],
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
  // | Send own heartbeat | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
  // Same shape and same reason as the row above: your own record about your own
  // work. §9.1 makes it token-only, so a Viewer is stopped by the credential.
  ['heartbeat.send_own', true, true, true, true],
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
  // | Watch / unwatch a task | ✓ | ✓ | ✓ |
  // Every role, including viewer — and **not** in `READ_ACTIONS`, which is what
  // refuses a `read_only` token (D-047). See `can.test.ts` for the pair.
  ['task.watch', true, true, true],
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

/**
 * SPEC §3.4 — the system principal (D-050, LAI-448).
 *
 * **Both directions, and the denied side is the one that matters.** A principal
 * that passes everything and a principal that passes the right things look
 * identical from the granted side — so the granted set is asserted by
 * enumeration and *everything else in the closed union* is asserted denied. That
 * is `CONVENTIONS.md` §4's fixture rule applied to a permission table.
 */
describe('SPEC §3.4 — the system principal', () => {
  const PROJECT = 'prj_resolved';
  const cron = systemPrincipal();
  const delivery = systemPrincipal(PROJECT);

  /** Exactly §3.4's grant. Anything not here must be denied. */
  const GRANTED: readonly [Action, Resource][] = [
    ['system.heartbeat.prune', {}],
    ['system.task.flag_stale', {}],
    ['system.invite.expire', {}],
    ['system.meeting_review.expire', {}],
    ['task.write', { projectId: PROJECT }],
    ['comment.create', { projectId: PROJECT }],
  ];

  it('holds each of §3.4’s actions', () => {
    for (const [action, resource] of GRANTED) {
      const principal = resource.projectId === undefined ? cron : delivery;
      expect(can(principal, action, resource), action).toBe(true);
    }
  });

  it('holds nothing else in the closed union', () => {
    // The half that makes the half above mean something. `org.delete`,
    // `user.set_role` and `token.create_own` are in here by construction rather
    // than by being listed, which is what stops the list drifting from the union.
    const granted = new Set(GRANTED.map(([action]) => action as string));

    const leaked = ALL_ACTIONS.filter(
      (action) =>
        !granted.has(action) &&
        (can(delivery, action, { projectId: PROJECT }) || can(cron, action, {})),
    );

    expect(leaked, 'the system principal holds an action §3.4 does not grant').toEqual([]);
  });

  it('cannot do the things a person does — named, so the failure reads', () => {
    // The three D-050 calls out. Redundant with the sweep above and worth the
    // duplication: when this breaks, the message should say what was granted
    // rather than print a list.
    for (const action of ['org.delete', 'user.set_role', 'token.create_own'] as const) {
      expect(can(delivery, action, { projectId: PROJECT }), action).toBe(false);
    }
  });

  it('is scoped to the project the delivery resolved to', () => {
    // §9.2 degrades rather than errors, so a push on `main` resolves to nothing.
    // That must deny rather than widen — rule 3, not a special case.
    expect(can(cron, 'task.write', { projectId: PROJECT })).toBe(false);
    expect(can(delivery, 'task.write', { projectId: 'prj_somewhere_else' })).toBe(false);
    expect(can(delivery, 'task.write', {})).toBe(false);
  });

  it('gives no human role a §3.4-only action', () => {
    // The other direction of the same grant: these four have no §3.1 or §3.2
    // row, so every role — Owner included — must be denied.
    for (const orgRole of ['owner', 'admin', 'member', 'viewer'] as const) {
      for (const action of SYSTEM_ACTIONS) {
        expect(
          can({ userId: 'u1', orgRole, isActive: true, projectRole: 'lead' }, action, {
            projectId: PROJECT,
          }),
          `${orgRole} / ${action}`,
        ).toBe(false);
      }
    }
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
      // §3.4's own, asserted in full by the describe above.
      ...SYSTEM_ACTIONS,
    ]);

    expect(ALL_ACTIONS.filter((a) => !asserted.has(a))).toEqual([]);
  });
});
