import { describe, expect, it } from 'vitest';
import { type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { ORG_ROLES, PROJECT_ROLES } from '../../src/db/enums.ts';
import { ApiError } from '../../src/errors.ts';
import {
  ALL_ACTIONS,
  type OrgAction,
  ORG_ACTIONS,
  type ProjectAction,
  PROJECT_ACTIONS,
  READ_ACTIONS,
  SESSION_ONLY_ACTIONS,
} from '../../src/policy/actions.ts';
import { type Actor, can, type Resource } from '../../src/policy/can.ts';
import {
  ACTION_CONDITIONS,
  ACTION_LABELS,
  permissionsCatalogue,
} from '../../src/services/permissions.ts';
import { parseMatrix } from '../helpers/policy-matrix.ts';

/**
 * `GET /api/v1/permissions` as a service (LAI-885).
 *
 * The catalogue is computed by calling `can()`, so most of what is worth
 * asserting is that it **covers** `can()` — every action, by name, both ways —
 * and that it **follows** it: the pinned table below is what makes a flipped
 * cell in `can()` go red here.
 */

function actor(overrides: Partial<ResolvedActor> = {}): ResolvedActor {
  return {
    userId: 'u1',
    email: 'ada@example.test',
    name: 'Ada',
    orgRole: 'member',
    isActive: true,
    projectRole: null,
    memberships: [],
    token: null,
    ...overrides,
  };
}

function thrown(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('should have thrown');
}

const HUMAN_ACTIONS: readonly string[] = ALL_ACTIONS.filter((a) => !a.startsWith('system.'));

describe('every action, by name, from both sides', () => {
  const served = permissionsCatalogue(actor()).permissions.map((p) => p.action as string);

  it('serves every org and project action in actions.ts', () => {
    const missing = HUMAN_ACTIONS.filter((a) => !served.includes(a));
    expect(missing, 'in actions.ts, absent from the response').toEqual([]);
  });

  it('serves nothing actions.ts does not have, and no system.* action', () => {
    const extra = served.filter((a) => !HUMAN_ACTIONS.includes(a));
    expect(extra, 'in the response, absent from actions.ts (or system.*)').toEqual([]);
  });

  it('serves each action once', () => {
    expect(new Set(served).size).toBe(served.length);
  });

  it('gives each action the scope of the list it is declared in', () => {
    for (const p of permissionsCatalogue(actor()).permissions) {
      const expected = (ORG_ACTIONS as readonly string[]).includes(p.action) ? 'org' : 'project';
      expect(p.scope, p.action).toBe(expected);
    }
  });

  it('copies session_only and read_only from the two sets', () => {
    for (const p of permissionsCatalogue(actor()).permissions) {
      expect(p.session_only, p.action).toBe(SESSION_ONLY_ACTIONS.has(p.action));
      expect(p.read_only, p.action).toBe(READ_ACTIONS.has(p.action));
    }
  });
});

/**
 * The whole matrix, pinned. **This is the mutation target**: flip any cell in
 * `can()` and the row it lives on stops matching.
 *
 * Org columns are owner admin member viewer; project columns are lead member
 * viewer. `Y` holds it, `N` does not, `C` holds it under `condition`.
 */
const EXPECTED: Readonly<Record<OrgAction | ProjectAction, string>> = {
  'org.delete': 'YNNN',
  'org.transfer_ownership': 'YNNN',
  'org.settings.edit': 'YYNN',
  'project.create': 'YYNN',
  'project.archive': 'YYNN',
  'user.invite': 'YYNN',
  'user.set_role': 'YCNN',
  'user.deactivate': 'YYNN',
  'org.read': 'YYYY',
  'presence.read': 'YYYY',
  'capacity.read': 'YYYY',
  'member_list.read': 'YYYY',
  'project.join_public': 'CCCC',
  'token.create_own': 'YYYY',
  'token.read_own': 'CCCC',
  'token.revoke_own': 'CCCC',
  'token.list_any': 'YYNN',
  'token.revoke_any': 'YYNN',
  'unlisted.log_own': 'YYYY',
  'heartbeat.send_own': 'YYYY',
  'audit_log.export': 'YYNN',
  'webhook.configure': 'YYNN',
  'profile.read': 'YYNN',
  'profile.set_kind': 'YYNN',
  'profile.rate': 'CCNN',
  'profile.activity.read': 'YYNN',
  'org.developer_insights.set': 'YYNN',
  'activity_sharing.read_own': 'YYYY',
  'activity_sharing.set_own': 'YYYY',
  'local_activity.send_own': 'YYYY',
  'local_activity.read_own': 'YYYY',
  'local_activity.delete_own': 'YYYY',
  'usage.read_org': 'YYNN',
  'usage.read_people': 'YYNN',
  'usage.read_own': 'YYYY',
  'org.model_prices.set': 'YYNN',
  'token_alerts.own': 'YYYY',
  'plan_limit.own': 'YYYY',
  'org.time.set': 'YYNN',
  'time_settings.read_own': 'YYYY',
  'time_settings.set_own': 'YYYY',
  'time_drafts.send_own': 'YYYY',
  'time_drafts.read_own': 'YYYY',
  'time_drafts.manage_own': 'YYYY',
  'time_entries.read_own': 'YYYY',
  'time_entries.write_own': 'YYYY',
  'time_sync.own': 'YYYY',
  'time_sync.map': 'YYNN',
  'time_sync.import_all': 'YYNN',

  'project.members.manage': 'YNN',
  'project.settings.edit': 'YNN',
  'sprint.manage': 'YNN',
  'task.assign_sprint': 'YYN',
  'task.write': 'YYN',
  'task.claim': 'YYN',
  'task.assign_other': 'YYN',
  'comment.create': 'YYN',
  'comment.edit': 'YCN',
  'comment.delete': 'YCN',
  'task.delete': 'YCN',
  'task.dependency.write': 'YYN',
  'task.watch': 'YYY',
  'project.read': 'YYY',
  'meeting_proposal.apply': 'YYN',
  'usage.read_project': 'YYY',
  'budget.set': 'YNN',
};

const LETTER = { yes: 'Y', no: 'N', conditional: 'C' } as const;

describe('which roles hold each action', () => {
  it('matches the pinned matrix, cell for cell', () => {
    const got: Record<string, string> = {};
    for (const p of permissionsCatalogue(actor()).permissions) {
      const roles: readonly string[] = p.scope === 'org' ? ORG_ROLES : PROJECT_ROLES;
      got[p.action] = roles.map((r) => LETTER[p.roles[r]!]).join('');
    }
    expect(got).toEqual(EXPECTED);
  });

  it('keys each row by exactly the roles of its scope', () => {
    for (const p of permissionsCatalogue(actor()).permissions) {
      const roles: readonly string[] = p.scope === 'org' ? ORG_ROLES : PROJECT_ROLES;
      expect(Object.keys(p.roles).sort(), p.action).toEqual([...roles].sort());
    }
  });

  it('states a condition exactly where some role holds the action conditionally', () => {
    for (const p of permissionsCatalogue(actor()).permissions) {
      const conditional = Object.values(p.roles).includes('conditional');
      expect(p.condition !== null, p.action).toBe(conditional);
    }
  });

  it('answers the same whoever asks', () => {
    // The matrix is about roles, not the caller: a viewer on a read-only token
    // reads the same table as the owner signed in.
    const owner = permissionsCatalogue(actor({ orgRole: 'owner' })).permissions;
    const viewer = permissionsCatalogue(
      actor({ orgRole: 'viewer', token: { id: 't1', scope: 'read_only', projectIds: null } }),
    ).permissions;
    expect(viewer).toEqual(owner);
  });
});

/**
 * Every way a `Resource` can change `can()`'s answer, as `can.ts` reads it.
 *
 * An action **without** a declared condition must answer alike across all of
 * these — otherwise `can()` depends on the resource somewhere the catalogue
 * would print a flat yes or no, which is the guess the task forbids.
 */
function probes(self: string): Resource[] {
  const base: Resource[] = [
    {},
    { ownerId: self },
    { ownerId: 'someone-else' },
    { createdBy: self },
    { createdBy: 'someone-else' },
    { visibility: 'public' },
    { visibility: 'private' },
    { targetUserId: self },
    { targetUserId: 'someone-else' },
    ...ORG_ROLES.map((targetOrgRole) => ({ targetOrgRole })),
  ];
  return base.map((r) => ({ projectId: 'p1', ...r }));
}

function roleActors(scope: 'org' | 'project'): Actor[] {
  return scope === 'org'
    ? ORG_ROLES.map((orgRole) => ({
        userId: 'synthetic',
        orgRole,
        isActive: true,
        projectRole: null,
      }))
    : PROJECT_ROLES.map((projectRole) => ({
        userId: 'synthetic',
        orgRole: 'member',
        isActive: true,
        projectRole,
      }));
}

describe('conditions are declared, not guessed', () => {
  it('no undeclared action depends on the resource', () => {
    const offenders: string[] = [];
    for (const action of [...ORG_ACTIONS, ...PROJECT_ACTIONS]) {
      if (ACTION_CONDITIONS[action] !== undefined) continue;
      const scope = (ORG_ACTIONS as readonly string[]).includes(action) ? 'org' : 'project';
      for (const a of roleActors(scope)) {
        const answers = new Set(probes(a.userId).map((r) => can(a, action, r)));
        if (answers.size > 1) offenders.push(`${action} for ${a.orgRole}/${a.projectRole}`);
      }
    }
    expect(offenders, 'depends on the resource but has no ACTION_CONDITIONS entry').toEqual([]);
  });

  it('every declared condition makes some role conditional', () => {
    const stale: string[] = [];
    const rows = permissionsCatalogue(actor()).permissions;
    for (const action of Object.keys(ACTION_CONDITIONS)) {
      const row = rows.find((p) => p.action === action);
      if (!row || !Object.values(row.roles).includes('conditional')) stale.push(action);
    }
    expect(stale, 'declared a condition no role is subject to').toEqual([]);
  });
});

describe('labels are SPEC §3.1 / §3.2 rows', () => {
  /**
   * `presence.read` and `capacity.read` have no §3 row yet — the gap
   * `policy-spec-drift.test.ts` parks under `ACTIONS_WITHOUT_A_ROW`. Their
   * label is the row that test says is coming. When it lands this entry goes
   * stale and the second test below fails until it is removed.
   */
  const WITHOUT_A_ROW: ReadonlySet<string> = new Set(['presence.read', 'capacity.read']);

  const orgRows = new Set(parseMatrix('3.1 Org-level permission matrix').rows.map((r) => r.label));
  const projectRows = new Set(
    parseMatrix('3.2 Project-level permission matrix').rows.map((r) => r.label),
  );

  it('takes every label from a row of its own scope', () => {
    const wrong: string[] = [];
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      if (WITHOUT_A_ROW.has(action)) continue;
      const rows = (ORG_ACTIONS as readonly string[]).includes(action) ? orgRows : projectRows;
      if (!rows.has(label)) wrong.push(`${action}: "${label}"`);
    }
    expect(wrong, 'label is not a row in its SPEC matrix').toEqual([]);
  });

  it('keeps the no-row exemption honest', () => {
    for (const action of WITHOUT_A_ROW) {
      expect(orgRows.has(ACTION_LABELS[action as OrgAction]), `${action} now has a row`).toBe(
        false,
      );
    }
  });

  it('serves the label it declares', () => {
    for (const p of permissionsCatalogue(actor()).permissions) {
      expect(p.label, p.action).toBe(ACTION_LABELS[p.action]);
    }
  });
});

describe("the caller's own grants", () => {
  it('lists every org action an owner holds when signed in', () => {
    const { me } = permissionsCatalogue(actor({ orgRole: 'owner' }));

    expect(me.org_role).toBe('owner');
    expect(me.credential).toBe('session');
    expect(me.implicit_project_role).toBe('lead');
    expect(me.actions).toContain('org.delete');
    expect(me.actions).toContain('webhook.configure');
    // Conditional for the role, so held: an owner may read their own tokens.
    expect(me.actions).toContain('token.read_own');
    expect(me.actions.every((a) => (ORG_ACTIONS as readonly string[]).includes(a))).toBe(true);
  });

  it('narrows to what the credential allows — a read-only token holds reads only', () => {
    const { me } = permissionsCatalogue(
      actor({ orgRole: 'owner', token: { id: 't1', scope: 'read_only', projectIds: null } }),
    );

    expect(me.credential).toBe('token');
    expect(me.actions).toContain('org.read');
    expect(me.actions).not.toContain('org.delete');
    expect(me.actions.every((a) => READ_ACTIONS.has(a))).toBe(true);
  });

  it('drops session-only actions on a full token', () => {
    const { me } = permissionsCatalogue(
      actor({ orgRole: 'owner', token: { id: 't1', scope: 'full', projectIds: null } }),
    );

    expect(me.actions).toContain('org.delete');
    expect(me.actions).not.toContain('webhook.configure');
    expect(me.actions.some((a) => SESSION_ONLY_ACTIONS.has(a))).toBe(false);
  });

  it('gives a member their project actions per membership, through the effective role', () => {
    const { me } = permissionsCatalogue(
      actor({ memberships: [{ projectId: 'p1', role: 'member' }] }),
    );

    expect(me.implicit_project_role).toBeNull();
    expect(me.actions).not.toContain('project.create');
    expect(me.projects).toHaveLength(1);
    expect(me.projects[0]!.project_id).toBe('p1');
    expect(me.projects[0]!.role).toBe('member');
    expect(me.projects[0]!.actions).toContain('task.write');
    expect(me.projects[0]!.actions).toContain('comment.edit');
    expect(me.projects[0]!.actions).not.toContain('sprint.manage');
  });

  it('caps an org viewer at project viewer whatever the membership says', () => {
    const { me } = permissionsCatalogue(
      actor({ orgRole: 'viewer', memberships: [{ projectId: 'p1', role: 'lead' }] }),
    );

    expect(me.projects[0]!.role).toBe('viewer');
    expect(me.projects[0]!.actions).not.toContain('task.write');
    expect(me.projects[0]!.actions).toContain('project.read');
  });

  it("follows a token's project whitelist", () => {
    const { me } = permissionsCatalogue(
      actor({
        memberships: [
          { projectId: 'p1', role: 'member' },
          { projectId: 'p2', role: 'member' },
        ],
        token: { id: 't1', scope: 'full', projectIds: ['p1'] },
      }),
    );

    expect(me.projects.find((p) => p.project_id === 'p1')!.actions).toContain('task.write');
    expect(me.projects.find((p) => p.project_id === 'p2')!.actions).toEqual([]);
  });
});

describe('who may ask', () => {
  it('refuses nobody signed in with unauthorized', () => {
    expect(thrown(() => permissionsCatalogue(null)).code).toBe('unauthorized');
  });

  it('refuses a deactivated account with forbidden on org.read', () => {
    const err = thrown(() => permissionsCatalogue(actor({ isActive: false })));
    expect(err.code).toBe('forbidden');
    expect(err.details).toMatchObject({ action: 'org.read' });
  });

  it('serves every role, including a viewer on a read-only token', () => {
    for (const orgRole of ORG_ROLES) {
      expect(permissionsCatalogue(actor({ orgRole })).permissions.length).toBe(
        HUMAN_ACTIONS.length,
      );
    }
    const viewer = actor({
      orgRole: 'viewer',
      token: { id: 't1', scope: 'read_only', projectIds: null },
    });
    expect(permissionsCatalogue(viewer).me.org_role).toBe('viewer');
  });
});
