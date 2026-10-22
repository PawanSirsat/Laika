import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { ORG_ROLES, PROJECT_ROLES } from '../../src/db/enums.ts';
import { ApiError } from '../../src/errors.ts';
import { SERVER_ROOT } from '../../src/paths.ts';
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
import { DEFAULT_GRANTS } from '../../src/policy/grants.ts';
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
  // D-102 rule 5 (LAI-958): an admin invites as member or viewer only, and
  // only the owner changes roles or grants.
  'user.invite': 'YCNN',
  'user.set_role': 'YNNN',
  'org.permissions.manage': 'YNNN',
  'user.deactivate': 'YYNN',
  // LAI-981: anyone signs themselves out; somebody else is the deactivate grant's.
  'user.sign_out': 'YYCC',
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
  'people.analytics.read': 'CCNN',
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

/**
 * `ACTIONS_WITHOUT_A_ROW`, read out of `policy-spec-drift.test.ts` rather than
 * copied: the actions `can()` has and no §3 row grants. Read as text, because
 * importing a test file would run its suite a second time inside this one.
 */
function actionsWithoutARow(): Set<string> {
  const text = readFileSync(
    join(SERVER_ROOT, 'test', 'tooling', 'policy-spec-drift.test.ts'),
    'utf8',
  );
  const start = text.indexOf('const ACTIONS_WITHOUT_A_ROW');
  const end = text.indexOf(']);', start);
  if (start < 0 || end < 0) throw new Error('ACTIONS_WITHOUT_A_ROW not found — ANCHOR FAILED');
  return new Set([...text.slice(start, end).matchAll(/^\s*\['([a-z_.]+)',/gm)].map((m) => m[1]!));
}

describe('labels are SPEC §3.1 / §3.2 rows, or null where there is none', () => {
  const orgRows = new Set(parseMatrix('3.1 Org-level permission matrix').rows.map((r) => r.label));
  const projectRows = new Set(
    parseMatrix('3.2 Project-level permission matrix').rows.map((r) => r.label),
  );
  const withoutARow = actionsWithoutARow();

  it('reads real action names out of ACTIONS_WITHOUT_A_ROW', () => {
    const unknown = [...withoutARow].filter((a) => !HUMAN_ACTIONS.includes(a));
    expect(unknown, 'parsed something that is not an action').toEqual([]);
  });

  it('has no label exactly for the actions policy-spec-drift parks without a row', () => {
    const labelless = Object.entries(ACTION_LABELS)
      .filter(([, label]) => label === null)
      .map(([action]) => action)
      .sort();
    expect(labelless).toEqual([...withoutARow].sort());
  });

  it('takes every other label from a row of its own scope', () => {
    const wrong: string[] = [];
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      if (label === null) continue;
      const rows = (ORG_ACTIONS as readonly string[]).includes(action) ? orgRows : projectRows;
      if (!rows.has(label)) wrong.push(`${action}: "${label}"`);
    }
    expect(wrong, 'label is not a row in its SPEC matrix').toEqual([]);
  });

  it('serves the label it declares', () => {
    for (const p of permissionsCatalogue(actor()).permissions) {
      expect(p.label, p.action).toBe(ACTION_LABELS[p.action]);
    }
  });
});

/**
 * The organisation's grants reach the catalogue (LAI-958): both the `roles`
 * cells and the caller's own `me.actions`, from the matrix loaded with the
 * actor — so a changed grant changes the answer and nothing else does.
 */
describe('the catalogue follows the organisation’s grants', () => {
  const MEMBER_ANALYTICS = {
    admin: DEFAULT_GRANTS.admin,
    member: ['see_people_analytics'] as const,
    viewer: [],
  };

  function cells(view: ReturnType<typeof permissionsCatalogue>, action: string): string {
    const p = view.permissions.find((row) => row.action === action)!;
    return ORG_ROLES.map((r) => LETTER[p.roles[r]!]).join('');
  }

  it('turns a granted role’s cells on, for that role only', () => {
    const before = permissionsCatalogue(actor());
    const after = permissionsCatalogue(actor({ orgGrants: MEMBER_ANALYTICS }));

    for (const action of ['profile.read', 'profile.activity.read', 'usage.read_people']) {
      expect(cells(before, action), action).toBe('YYNN');
      expect(cells(after, action), action).toBe('YYYN');
    }
    // LAI-957's read of somebody else carries its "not themselves" condition.
    expect(cells(before, 'people.analytics.read')).toBe('CCNN');
    expect(cells(after, 'people.analytics.read')).toBe('CCCN');
    // Everything else is untouched, cell for cell.
    const changed = after.permissions
      .filter((p, i) => JSON.stringify(p) !== JSON.stringify(before.permissions[i]))
      .map((p) => p.action);
    expect(changed.sort()).toEqual([
      'people.analytics.read',
      'profile.activity.read',
      'profile.read',
      'usage.read_people',
    ]);
  });

  it('turns an admin’s cells off when the owner withdraws a grant', () => {
    const view = permissionsCatalogue(actor({ orgGrants: { admin: [], member: [], viewer: [] } }));

    expect(cells(view, 'audit_log.export')).toBe('YNNN');
    expect(cells(view, 'user.invite')).toBe('YNNN');
    expect(cells(view, 'org.time.set')).toBe('YNNN');
    // Not a capability's, so not the grant's to withdraw.
    expect(cells(view, 'project.create')).toBe('YYNN');
  });

  it('changes the caller’s own actions with their role’s grant', () => {
    const plain = permissionsCatalogue(actor()).me;
    const granted = permissionsCatalogue(actor({ orgGrants: MEMBER_ANALYTICS })).me;

    expect(plain.actions).not.toContain('profile.read');
    expect(granted.actions).toContain('profile.read');
    expect(granted.actions).toContain('usage.read_people');
    expect(granted.actions).not.toContain('audit_log.export');
  });

  it('reports the implicit project role the grant gives, and none without it', () => {
    const open = {
      admin: [],
      member: ['open_all_projects'] as const,
      viewer: ['open_all_projects'] as const,
    };

    expect(permissionsCatalogue(actor({ orgGrants: open })).me.implicit_project_role).toBe('lead');
    expect(
      permissionsCatalogue(actor({ orgRole: 'viewer', orgGrants: open })).me.implicit_project_role,
    ).toBe('viewer');
    expect(
      permissionsCatalogue(actor({ orgRole: 'admin', orgGrants: open })).me.implicit_project_role,
    ).toBeNull();
  });

  it('keeps §3.2’s columns about project roles, whatever a member was granted', () => {
    const open = { admin: [], member: ['open_all_projects'] as const, viewer: [] };
    const before = permissionsCatalogue(actor()).permissions.filter((p) => p.scope === 'project');
    const after = permissionsCatalogue(actor({ orgGrants: open })).permissions.filter(
      (p) => p.scope === 'project',
    );
    expect(after).toEqual(before);
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

  const TWO_PROJECTS = [
    { projectId: 'p1', role: 'member' as const },
    { projectId: 'p2', role: 'member' as const },
  ];

  it('lists every membership to a session', () => {
    const { me } = permissionsCatalogue(actor({ memberships: TWO_PROJECTS }));

    expect(me.project_scope).toBe('all');
    expect(me.projects.map((p) => p.project_id).sort()).toEqual(['p1', 'p2']);
  });

  it("leaves out, by id, a project outside a token's whitelist", () => {
    const { me } = permissionsCatalogue(
      actor({
        memberships: TWO_PROJECTS,
        token: { id: 't1', scope: 'full', projectIds: ['p1'] },
      }),
    );

    expect(me.project_scope).toEqual(['p1']);
    expect(me.projects.map((p) => p.project_id)).toEqual(['p1']);
    expect(me.projects[0]!.actions).toContain('task.write');
    expect(JSON.stringify(me)).not.toContain('p2');
  });
});

describe("an owner's implicit lead, per credential", () => {
  const OWNER = { orgRole: 'owner' as const, memberships: [] };

  it('is lead on every project for a session', () => {
    const { me } = permissionsCatalogue(actor(OWNER));

    expect(me.credential).toBe('session');
    expect(me.project_scope).toBe('all');
    expect(me.implicit_project_role).toBe('lead');
  });

  it('is lead only inside the whitelist for a pinned token', () => {
    const { me } = permissionsCatalogue(
      actor({ ...OWNER, token: { id: 't1', scope: 'full', projectIds: ['p1'] } }),
    );

    expect(me.credential).toBe('token');
    expect(me.project_scope).toEqual(['p1']);
    expect(me.implicit_project_role).toBe('lead');
  });

  it('is still the role, not the grants, on a read-only token', () => {
    const { me } = permissionsCatalogue(
      actor({ ...OWNER, token: { id: 't1', scope: 'read_only', projectIds: null } }),
    );

    expect(me.credential).toBe('token');
    expect(me.project_scope).toBe('all');
    expect(me.implicit_project_role).toBe('lead');
    expect(me.actions.every((a) => READ_ACTIONS.has(a))).toBe(true);
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
