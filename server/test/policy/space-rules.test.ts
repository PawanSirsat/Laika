import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors.ts';
import { type OrgRole, type ProjectRole } from '../../src/db/enums.ts';
import { PROJECT_ACTIONS } from '../../src/policy/actions.ts';
import {
  type Actor,
  assertCan,
  can,
  type ProjectRules,
  type TokenContext,
} from '../../src/policy/can.ts';
import { isReadAction } from '../../src/policy/actions.ts';

/**
 * D-103 items 6 and 7, in `can()` (LAI-976): who may create tasks in a space,
 * and whether agents may write there at all. Both are per project, loaded with
 * the actor like the organisation's grants, and read by `resource.projectId`.
 */

const P = 'p1';
const TOKEN: TokenContext = { id: 'tok', scope: 'full', projectIds: null };

function actor(
  orgRole: OrgRole,
  projectRole: ProjectRole | null,
  rules: Partial<ProjectRules> | null = null,
  token: TokenContext | null = null,
): Actor {
  return {
    userId: 'u1',
    orgRole,
    isActive: true,
    projectRole,
    token,
    projectRules:
      rules === null
        ? null
        : new Map([[P, { taskCreateMinRole: 'member', agentsAllowed: true, ...rules }]]),
  };
}

function refusal(fn: () => void): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('task.create follows the space’s minimum role (D-103 item 6)', () => {
  it('lets a member create by default, and with no rules loaded at all', () => {
    expect(can(actor('member', 'member'), 'task.create', { projectId: P })).toBe(true);
    expect(can(actor('member', 'member', {}), 'task.create', { projectId: P })).toBe(true);
  });

  it('refuses a member, and not a lead, when the space says space admins only', () => {
    const rules = { taskCreateMinRole: 'lead' as const };
    expect(can(actor('member', 'member', rules), 'task.create', { projectId: P })).toBe(false);
    expect(can(actor('member', 'lead', rules), 'task.create', { projectId: P })).toBe(true);
    // An org owner or admin is an implicit lead (§3.2) and so qualifies.
    expect(can(actor('admin', null, rules), 'task.create', { projectId: P })).toBe(true);
  });

  it('says why, in details', () => {
    const error = refusal(() => {
      assertCan(actor('member', 'member', { taskCreateMinRole: 'lead' }), 'task.create', {
        projectId: P,
      });
    });
    expect(error.code).toBe('forbidden');
    expect(error.details).toMatchObject({
      action: 'task.create',
      reason: 'task_create_min_role',
      task_create_min_role: 'lead',
    });
  });

  it('never lets a viewer create, whatever the space says', () => {
    for (const min of ['member', 'lead'] as const) {
      expect(
        can(actor('member', 'viewer', { taskCreateMinRole: min }), 'task.create', {
          projectId: P,
        }),
      ).toBe(false);
    }
  });

  it('is only about creating: a member still edits under space admins only', () => {
    const member = actor('member', 'member', { taskCreateMinRole: 'lead' });
    expect(can(member, 'task.write', { projectId: P })).toBe(true);
    expect(can(member, 'task.claim', { projectId: P })).toBe(true);
  });

  it('reads the rules of the project asked about, not another', () => {
    const member = actor('member', 'member', { taskCreateMinRole: 'lead' });
    expect(can(member, 'task.create', { projectId: 'p2' })).toBe(true);
  });
});

describe('agents off refuses every write an agent token makes there (D-103 item 7)', () => {
  const off = { agentsAllowed: false };

  it('refuses a token every non-read project action, and allows its reads', () => {
    const agent = actor('owner', 'lead', off, TOKEN);
    for (const action of PROJECT_ACTIONS) {
      const expected = isReadAction(action);
      expect(can(agent, action, { projectId: P, ownerId: 'u1', createdBy: 'u1' }), action).toBe(
        expected,
      );
    }
    // The point of the list above, by name, so it cannot pass by being short.
    for (const action of [
      'task.create',
      'task.write',
      'task.claim',
      'comment.create',
      'task.dependency.write',
    ] as const) {
      expect(can(agent, action, { projectId: P }), action).toBe(false);
    }
    expect(can(agent, 'project.read', { projectId: P })).toBe(true);
  });

  it('leaves the same person on a web session alone', () => {
    const person = actor('owner', 'lead', off, null);
    for (const action of ['task.create', 'task.write', 'task.claim', 'comment.create'] as const) {
      expect(can(person, action, { projectId: P }), action).toBe(true);
    }
  });

  it('leaves agents alone in another space, and when the switch is on', () => {
    expect(can(actor('owner', 'lead', off, TOKEN), 'task.write', { projectId: 'p2' })).toBe(true);
    expect(
      can(actor('owner', 'lead', { agentsAllowed: true }, TOKEN), 'task.write', { projectId: P }),
    ).toBe(true);
  });

  it('says why, in details', () => {
    const error = refusal(() => {
      assertCan(actor('member', 'member', off, TOKEN), 'task.claim', { projectId: P });
    });
    expect(error.code).toBe('forbidden');
    expect(error.details).toMatchObject({ action: 'task.claim', reason: 'agents_off' });
  });
});

describe('project.leave (D-103 item 5)', () => {
  it('is any member’s, viewers included', () => {
    for (const role of ['lead', 'member', 'viewer'] as const) {
      expect(can(actor('member', role), 'project.leave', { projectId: P }), role).toBe(true);
    }
  });

  it('is nobody’s who is not on the project', () => {
    expect(can(actor('member', null), 'project.leave', { projectId: P })).toBe(false);
  });
});
