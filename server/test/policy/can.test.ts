import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors.ts';
import { type OrgRole, type ProjectRole } from '../../src/db/enums.ts';
import { ALL_ACTIONS, isReadAction } from '../../src/policy/actions.ts';
import {
  type Actor,
  assertCan,
  can,
  effectiveProjectRole,
  effectiveTokenScope,
  forcedTokenScope,
  projectRoleOnJoin,
  type TokenContext,
} from '../../src/policy/can.ts';

function actor(
  orgRole: OrgRole,
  projectRole: ProjectRole | null = null,
  token: TokenContext | null = null,
): Actor {
  return { userId: 'u1', orgRole, isActive: true, projectRole, token };
}

describe('org owner and admin hold implicit project lead (SPEC §3, D-006)', () => {
  it('grants lead-only project actions with no membership row', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(effectiveProjectRole(actor(role))).toBe('lead');
      expect(can(actor(role), 'project.settings.edit', { projectId: 'p1' }), role).toBe(true);
      expect(can(actor(role), 'sprint.manage', { projectId: 'p1' }), role).toBe(true);
      expect(can(actor(role), 'project.members.manage', { projectId: 'p1' }), role).toBe(true);
    }
  });

  it('lets them delete a comment they did not write', () => {
    const resource = { projectId: 'p1', ownerId: 'someone-else' };
    expect(can(actor('owner'), 'comment.delete', resource)).toBe(true);
    expect(can(actor('admin'), 'comment.delete', resource)).toBe(true);
  });

  it('does not extend the same courtesy to an org member', () => {
    expect(effectiveProjectRole(actor('member'))).toBeNull();
    expect(can(actor('member'), 'project.read', { projectId: 'p1' })).toBe(false);
  });
});

describe('an org viewer can hold only project role viewer (SPEC §3, D-006)', () => {
  it('caps a membership row that claims lead', () => {
    // Data corruption or an escalation attempt — capped rather than trusted.
    const escalated = actor('viewer', 'lead');

    expect(effectiveProjectRole(escalated)).toBe('viewer');
    expect(can(escalated, 'project.settings.edit', { projectId: 'p1' })).toBe(false);
    expect(can(escalated, 'task.write', { projectId: 'p1' })).toBe(false);
    expect(can(escalated, 'project.read', { projectId: 'p1' })).toBe(true);
  });

  it('caps a membership row that claims member', () => {
    const escalated = actor('viewer', 'member');

    expect(can(escalated, 'task.claim', { projectId: 'p1' })).toBe(false);
    expect(can(escalated, 'comment.create', { projectId: 'p1' })).toBe(false);
  });

  it('joins a public project as a viewer, not a member', () => {
    expect(projectRoleOnJoin('viewer')).toBe('viewer');
    expect(projectRoleOnJoin('member')).toBe('member');
    expect(projectRoleOnJoin('admin')).toBe('member');
  });
});

describe('token scope narrows and never widens (SPEC §6.2, §3.3 rule 4)', () => {
  const full: TokenContext = { id: 'tok_full', scope: 'full', projectIds: null };
  const readOnly: TokenContext = { id: 'tok_ro', scope: 'read_only', projectIds: null };

  it('a read_only token cannot write, whatever the role allows', () => {
    const lead = actor('owner', 'lead', readOnly);

    expect(can(lead, 'task.write', { projectId: 'p1' })).toBe(false);
    expect(can(lead, 'org.settings.edit')).toBe(false);
    expect(can(lead, 'project.read', { projectId: 'p1' })).toBe(true);
    expect(can(lead, 'member_list.read')).toBe(true);
  });

  it('a full token still cannot exceed the role', () => {
    const viewer = actor('viewer', 'viewer', full);

    expect(can(viewer, 'task.write', { projectId: 'p1' })).toBe(false);
    expect(can(viewer, 'org.settings.edit')).toBe(false);
  });

  it("forces a Viewer's token to read_only however it was stored", () => {
    // A role can be downgraded long after a `full` token was minted, and nothing
    // revokes the token when that happens.
    const viewer = actor('viewer', 'viewer', full);

    expect(effectiveTokenScope(viewer, full)).toBe('read_only');
    expect(forcedTokenScope('viewer', 'full')).toBe('read_only');
    expect(forcedTokenScope('member', 'full')).toBe('full');
  });

  it('restricts a project-pinned token to its projects', () => {
    const pinned = actor('member', 'member', {
      id: 'tok_pinned',
      scope: 'full',
      projectIds: ['p1'],
    });

    expect(can(pinned, 'task.write', { projectId: 'p1' })).toBe(true);
    expect(can(pinned, 'task.write', { projectId: 'p2' })).toBe(false);
    expect(can(pinned, 'project.read', { projectId: 'p2' })).toBe(false);
  });

  it('leaves org-scoped actions alone when a token is project-pinned', () => {
    const pinned = actor('admin', null, { id: 'tok_pinned', scope: 'full', projectIds: ['p1'] });

    expect(can(pinned, 'member_list.read')).toBe(true);
    expect(can(pinned, 'user.invite')).toBe(true);
  });

  it('applies scope after the role decision, never instead of it', () => {
    // If scope were consulted first, a full token would look like a grant.
    const memberWithFullToken = actor('member', 'viewer', full);

    expect(can(memberWithFullToken, 'task.write', { projectId: 'p1' })).toBe(false);
  });

  it('a cookie session (no token) is unaffected by scope rules', () => {
    expect(can(actor('member', 'member'), 'task.write', { projectId: 'p1' })).toBe(true);
  });

  it('denies every write action to a read_only token, exhaustively', () => {
    const owner = actor('owner', 'lead', readOnly);

    for (const action of ALL_ACTIONS) {
      const allowed = can(owner, action, {
        projectId: 'p1',
        ownerId: 'u1',
        createdBy: 'u1',
        visibility: 'public',
        targetOrgRole: 'member',
      });
      // Every allowed action under a read_only token must be a read.
      if (allowed) expect(isReadAction(action), `${action} allowed but is not a read`).toBe(true);
    }
  });
});

describe('deny by default (SPEC §3.3 rule 3)', () => {
  it('denies a deactivated user everything, including reads', () => {
    const deactivated: Actor = { ...actor('owner', 'lead'), isActive: false };

    for (const action of ALL_ACTIONS) {
      expect(
        can(deactivated, action, { projectId: 'p1', ownerId: 'u1', createdBy: 'u1' }),
        action,
      ).toBe(false);
    }
  });

  it('denies an unknown action arriving from an untyped caller', () => {
    // Types stop this at the boundary; the runtime must not fall through to true.
    const unknown = 'task.nuke' as never;
    expect(can(actor('owner', 'lead'), unknown, { projectId: 'p1' })).toBe(false);
  });

  it('denies a project action with no membership and no implicit lead', () => {
    expect(can(actor('member', null), 'project.read', { projectId: 'p1' })).toBe(false);
  });

  it('defaults the resource to empty rather than requiring one', () => {
    expect(can(actor('owner'), 'org.delete')).toBe(true);
    expect(can(actor('member'), 'org.delete')).toBe(false);
  });
});

describe('the cases LAI-004 calls out by name', () => {
  it('Admin cannot delete the org or transfer ownership', () => {
    expect(can(actor('admin'), 'org.delete')).toBe(false);
    expect(can(actor('admin'), 'org.transfer_ownership')).toBe(false);
  });

  it('Admin can edit org settings', () => {
    // §3.1 moved this to Admin+ when the matrix was rewritten; the task's older
    // phrasing ("Admin cannot edit org settings") predates that. Spec wins (D-011).
    expect(can(actor('admin'), 'org.settings.edit')).toBe(true);
  });

  it('Admin cannot promote anyone to Owner', () => {
    expect(can(actor('admin'), 'user.set_role', { targetOrgRole: 'owner' })).toBe(false);
  });

  it('Member cannot delete a task they did not create', () => {
    expect(
      can(actor('member', 'member'), 'task.delete', { projectId: 'p1', createdBy: 'u2' }),
    ).toBe(false);
  });

  it('a non-member cannot read a project', () => {
    expect(can(actor('member', null), 'project.read', { projectId: 'p1' })).toBe(false);
  });

  it('Viewer write attempts all fail', () => {
    const viewer = actor('viewer', 'viewer');

    for (const action of ALL_ACTIONS) {
      if (isReadAction(action)) continue;
      const allowed = can(viewer, action, {
        projectId: 'p1',
        ownerId: 'u1',
        createdBy: 'u1',
        visibility: 'public',
      });
      // The only writes a Viewer keeps are over their own tokens (§3.1).
      const selfToken = action === 'token.create_own' || action === 'token.revoke_own';
      const joining = action === 'project.join_public';

      expect(allowed, `${action} allowed for viewer`).toBe(selfToken || joining);
    }
  });
});

describe('assertCan', () => {
  it('returns quietly when allowed', () => {
    expect(() => {
      assertCan(actor('owner'), 'org.delete');
    }).not.toThrow();
  });

  it('throws the §6.3 forbidden error when denied', () => {
    try {
      assertCan(actor('member'), 'org.delete');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiError = err as ApiError;
      expect(apiError.code).toBe('forbidden');
      expect(apiError.status).toBe(403);
      expect(apiError.toBody().error.code).toBe('forbidden');
    }
  });

  it('names the action in details without leaking the actor', () => {
    try {
      assertCan(actor('member'), 'org.delete');
    } catch (err) {
      const details = (err as ApiError).details as { action: string };
      expect(details.action).toBe('org.delete');
      expect(JSON.stringify(details)).not.toContain('u1');
    }
  });
});
