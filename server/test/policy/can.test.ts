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

/**
 * A member's profile is for a person at the web app, never for a token
 * (§3.1 "session only", D-078, LAI-743).
 *
 * Every other token rule here *narrows* a role; this one closes the door
 * outright, because a profile carries private ratings and a token is how an
 * agent acts. A full, unscoped Owner token is the case that matters: scope
 * rules alone would let it through, since the three actions name no project
 * and an Owner holds them.
 */
describe('profile actions refuse every token (LAI-743)', () => {
  const PROFILE_ACTIONS = [
    'profile.read',
    'profile.set_kind',
    'profile.rate',
    // The organisation's switch for D-079 follows the same rule (LAI-751 review).
    'org.developer_insights.set',
  ] as const;
  const someoneElse = { targetUserId: 'u2' };
  const tokens: Record<string, TokenContext> = {
    'full and unscoped': { id: 'tok_full', scope: 'full', projectIds: null },
    read_only: { id: 'tok_ro', scope: 'read_only', projectIds: null },
    'pinned to a project': { id: 'tok_pin', scope: 'full', projectIds: ['p1'] },
  };

  it('allows each on a cookie session, so the refusals below are the token’s', () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const action of PROFILE_ACTIONS) {
        expect(can(actor(role), action, someoneElse), `${role} / ${action}`).toBe(true);
      }
    }
  });

  it('refuses each to an Owner or Admin holding any kind of token', () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const [kind, token] of Object.entries(tokens)) {
        for (const action of PROFILE_ACTIONS) {
          expect(
            can(actor(role, null, token), action, someoneElse),
            `${role} / ${kind} / ${action}`,
          ).toBe(false);
        }
      }
    }
  });

  it('leaves the same tokens able to do what they could before', () => {
    // The refusal is about these three actions, not a token that stopped
    // working: the same Owner token still reads the member list and invites.
    const owner = actor('owner', null, { id: 'tok_full', scope: 'full', projectIds: null });
    expect(can(owner, 'member_list.read')).toBe(true);
    expect(can(owner, 'user.invite')).toBe(true);
  });
});

/**
 * LAI-773's four rows refuse every token: prices and budgets are the figures
 * that exist to watch agents, so an agent's token must not move them; alerts
 * and the plan limit are the person's own, read and set signed in (D-087).
 */
describe('token-usage settings refuse every token (LAI-773)', () => {
  const tokens: TokenContext[] = [
    { id: 'tok_full', scope: 'full', projectIds: null },
    { id: 'tok_ro', scope: 'read_only', projectIds: null },
    { id: 'tok_pin', scope: 'full', projectIds: ['p1'] },
  ];
  const cases = [
    ['org.model_prices.set', 'owner', null],
    ['token_alerts.own', 'member', null],
    ['plan_limit.own', 'viewer', null],
    ['budget.set', 'member', 'lead'],
  ] as const;

  it('allows each on a cookie session, so the refusals below are the token’s', () => {
    for (const [action, role, projectRole] of cases) {
      expect(can(actor(role, projectRole), action, { projectId: 'p1' }), action).toBe(true);
    }
  });

  it('refuses each to any token', () => {
    for (const [action, role, projectRole] of cases) {
      for (const token of tokens) {
        expect(
          can(actor(role, projectRole, token), action, { projectId: 'p1' }),
          `${action} / ${token.id}`,
        ).toBe(false);
      }
    }
  });

  it('gives a project member no budget, and a lead one', () => {
    expect(can(actor('member', 'member'), 'budget.set', { projectId: 'p1' })).toBe(false);
    expect(can(actor('member', 'lead'), 'budget.set', { projectId: 'p1' })).toBe(true);
    // An admin is an implicit lead.
    expect(can(actor('admin', null), 'budget.set', { projectId: 'p1' })).toBe(true);
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
      // The only writes a Viewer keeps are over their **own** records (§3.1):
      // their tokens, joining a public project, and logging their own unlisted
      // work. None of them touch anyone else's data.
      const selfToken = action === 'token.create_own' || action === 'token.revoke_own';
      const joining = action === 'project.join_public';
      const ownUnlisted = action === 'unlisted.log_own';
      const ownHeartbeat = action === 'heartbeat.send_own';
      // `task.watch` is the fifth, and the one that shows what this test is
      // really about (D-047, LAI-143). It is **not** a read action — that is
      // deliberate and is what refuses a `read_only` token — but the *role*
      // allows it, because anyone who may read a task may choose to hear about
      // it. The role layer and the scope layer answer different questions, and
      // §3.3 rule 4 exists so they can differ.
      //
      // So the rule this test states is not "a Viewer performs no writes" — it
      // is "a Viewer writes nothing that is not about themselves".
      const ownWatch = action === 'task.watch';
      // D-079's own-activity rows (LAI-751): their consent, their reports and
      // what is held about them — the heartbeat's "own record about own work".
      const ownLocalActivity =
        action === 'activity_sharing.set_own' ||
        action === 'local_activity.send_own' ||
        action === 'local_activity.read_own' ||
        action === 'local_activity.delete_own';
      // D-084's own tokens (LAI-769): a read of their own record, session
      // only — so not in `READ_ACTIONS`, which is about what a token may do.
      const ownUsage = action === 'usage.read_own';
      // LAI-773: their own alerts and their own plan limit, session only.
      const ownTokenData = action === 'token_alerts.own' || action === 'plan_limit.own';
      // D-088 (LAI-787): their own Draft my time, drafts and entries.
      const ownTime =
        action === 'time_settings.set_own' ||
        action === 'time_drafts.send_own' ||
        action === 'time_drafts.read_own' ||
        action === 'time_drafts.manage_own' ||
        action === 'time_entries.read_own' ||
        action === 'time_entries.write_own' ||
        // LAI-788: syncing their own time with Solidtime, signed in.
        action === 'time_sync.own';
      // D-103 item 5 (LAI-976): leaving a space removes their own membership
      // and writes nothing about the space's work.
      const ownMembership = action === 'project.leave';

      expect(allowed, `${action} allowed for viewer`).toBe(
        selfToken ||
          joining ||
          ownUnlisted ||
          ownHeartbeat ||
          ownWatch ||
          ownLocalActivity ||
          ownUsage ||
          ownTokenData ||
          ownTime ||
          ownMembership,
      );
    }
  });

  it('a Viewer’s token cannot log unlisted work, even though their role can', () => {
    // §3.1 marks the cell ✓ for Viewer and the restriction comes from the
    // **credential**, not the role: a Viewer's token is forced to `read_only`
    // (§4.9) and `tokenAllows` refuses every non-read action.
    //
    // Asserted because the role-level ✓ above looks, on its own, like a Viewer
    // gaining a write — and the reason it is not is a rule enforced somewhere
    // else entirely. If `read_only` forcing were ever relaxed, this is the test
    // that would go red and say what actually changed.
    const withToken: Actor = {
      ...actor('viewer', 'viewer'),
      token: { id: 'tok', scope: 'read_only', projectIds: null },
    };

    expect(can(withToken, 'unlisted.log_own', {})).toBe(false);

    // And the same person on a cookie session may.
    expect(can(actor('viewer', 'viewer'), 'unlisted.log_own', {})).toBe(true);
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

/**
 * D-088's rows (LAI-787): the organisation's switch, the person's own switch,
 * reading drafts and confirming them, and confirmed time per person are a
 * signed-in person's — every token is refused, an owner's full one included.
 * Sending a draft and reading one's own settings are what a collector and an
 * agent do, so a token may.
 */
describe('time refuses every token but where a collector or an agent acts (LAI-787)', () => {
  const tokens: TokenContext[] = [
    { id: 'tok_full', scope: 'full', projectIds: null },
    { id: 'tok_ro', scope: 'read_only', projectIds: null },
    { id: 'tok_pin', scope: 'full', projectIds: ['p1'] },
  ];
  const sessionOnly = [
    ['org.time.set', 'owner'],
    ['time_settings.set_own', 'member'],
    ['time_drafts.read_own', 'owner'],
    ['time_drafts.manage_own', 'admin'],
    ['time_entries.read_own', 'owner'],
    ['time_entries.write_own', 'member'],
  ] as const;

  it('allows each on a cookie session, so the refusals below are the token’s', () => {
    for (const [action, role] of sessionOnly) {
      expect(can(actor(role, null), action), action).toBe(true);
    }
  });

  it('refuses each to any token', () => {
    for (const [action, role] of sessionOnly) {
      for (const token of tokens) {
        expect(can(actor(role, null, token), action), `${action} / ${token.id}`).toBe(false);
      }
    }
  });

  it('lets a full token send a draft and any token read the switches', () => {
    const full = actor('member', null, tokens[0]);
    const readOnly = actor('member', null, tokens[1]);
    expect(can(full, 'time_drafts.send_own')).toBe(true);
    expect(can(readOnly, 'time_drafts.send_own')).toBe(false);
    expect(can(full, 'time_settings.read_own')).toBe(true);
    expect(can(readOnly, 'time_settings.read_own')).toBe(true);
  });

  it('gives a member no organisation switch', () => {
    expect(can(actor('member', null), 'org.time.set')).toBe(false);
    expect(can(actor('viewer', null), 'org.time.set')).toBe(false);
  });
});
