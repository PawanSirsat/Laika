/**
 * `GET /api/v1/permissions` (SPEC §6.4, LAI-885): who may do what, **as `can()`
 * answers it**.
 *
 * The client used to re-derive permissions in hand-written predicates, which is
 * a second copy of §3 that nothing checks. This serves the matrix instead, and
 * computes every cell by asking `can()` about a synthetic actor holding that
 * role — so there is no table here to drift from policy. What is here is the
 * two things `can()` cannot say for itself:
 *
 *  - **the label**, a §3.1 / §3.2 row as written, because an action id is not
 *    prose (the test holds every label to a row of the document). An action
 *    no row grants yet has `label: null` — no text is invented for it;
 *  - **the condition**, for the actions whose answer depends on the resource.
 *    `can()` needs a target to say yes or no to those, and printing a flat
 *    answer for them would be a guess. Each is declared below with a resource
 *    on which it holds and one on which it does not, and a role that answers
 *    differently on the two is reported `conditional`. A test fails if `can()`
 *    grows a resource dependency nobody declared here.
 *
 * Role holding is about the **role**, so the synthetic actors are signed in:
 * whether a token may do it is the row's `session_only` and `read_only` flags.
 * They carry **the organisation's grants** (§3, LAI-958), the same matrix the
 * caller's actor was loaded with, so a cell changes when the owner changes a
 * grant and there is still no table here to drift.
 * The caller's own grants, under `me`, are the opposite — the caller's real
 * credential, token narrowing and all.
 */

import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { ORG_ROLES, type OrgRole, PROJECT_ROLES, type ProjectRole } from '../db/enums.ts';
import { ApiError } from '../errors.ts';
import {
  type OrgAction,
  ORG_ACTIONS,
  type ProjectAction,
  PROJECT_ACTIONS,
  READ_ACTIONS,
  SESSION_ONLY_ACTIONS,
} from '../policy/actions.ts';
import { type Actor, assertCan, can, effectiveProjectRole, type Resource } from '../policy/can.ts';
import { DEFAULT_GRANTS, implicitProjectRole, type OrgGrants } from '../policy/grants.ts';

type CatalogueAction = OrgAction | ProjectAction;

/**
 * Each action's SPEC §3.1 or §3.2 row, Markdown stripped.
 *
 * Where one row covers several actions they share it; where one action is
 * granted by two rows (`task.write` also covers tags, `project.settings.edit`
 * also covers renaming a tag) the label is the row that names the action's
 * main use.
 *
 * `null` where §3 has **no** row yet — the gap `policy-spec-drift.test.ts`
 * parks as `ACTIONS_WITHOUT_A_ROW`, empty today. The test holds the `null`s to
 * exactly that list, so the day a row lands this map must take its text from
 * the document, as `presence.read` and `capacity.read` did (LAI-953).
 */
export const ACTION_LABELS: Readonly<Record<CatalogueAction, string | null>> = {
  'org.delete': 'Delete org data',
  'org.transfer_ownership': 'Transfer ownership',
  'org.settings.edit': 'Org settings (AI provider, SMTP, signup mode)',
  'project.create': 'Create / archive project',
  'project.archive': 'Create / archive project',
  'user.invite': 'Invite users',
  'user.set_role': 'Change org roles',
  'org.permissions.manage': 'Set what each role may do',
  'user.deactivate': 'Deactivate user',
  'user.sign_out': 'Sign a person out everywhere',
  'user.reset_password': 'Issue a password-reset link',
  'org.read': 'View the organisation',
  'presence.read': 'Presence and capacity',
  'capacity.read': 'Presence and capacity',
  'member_list.read': 'View member list',
  'project.join_public': 'Join a public project',
  'token.create_own': 'Generate, read and revoke own tokens',
  'token.read_own': 'Generate, read and revoke own tokens',
  'token.revoke_own': 'Generate, read and revoke own tokens',
  'token.list_any': "List / revoke anyone's token",
  'token.revoke_any': "List / revoke anyone's token",
  'agent.read_own': 'Read own agents',
  'agent.manage_own': 'Register and manage own agents',
  'unlisted.log_own': 'Log own unlisted work',
  'heartbeat.send_own': 'Send own heartbeat',
  'audit_log.export': 'Export audit log',
  'webhook.configure': 'Configure webhooks',
  'profile.read': "View a member's profile",
  'profile.set_kind': "Set a member's profile kind",
  'profile.rate': 'Rate a member',
  'profile.activity.read': "View a member's activity heatmap",
  'people.analytics.read': "View a member's day, time and shared activity",
  'org.developer_insights.set': 'Turn Developer insights on or off',
  'activity_sharing.read_own': 'Read own activity-sharing setting',
  'activity_sharing.set_own': 'Set own local-activity scope',
  'local_activity.send_own': 'Send own local activity',
  'local_activity.read_own': 'Read and delete own local activity',
  'local_activity.delete_own': 'Read and delete own local activity',
  'usage.read_org': "View the organisation's token usage",
  'usage.read_people': "View anyone's token usage, per person",
  'usage.read_own': 'View own token usage',
  'org.model_prices.set': 'Set API-equivalent prices',
  'token_alerts.own': 'Read and dismiss own token alerts',
  'plan_limit.own': 'Read and set own plan limit',
  'org.time.set': "Set the organisation's Time setting",
  'time_settings.read_own': 'Read own time settings',
  'time_settings.set_own': 'Set own Draft my time',
  'time_drafts.send_own': 'Send own time drafts',
  'time_drafts.read_own': 'Read and manage own time drafts',
  'time_drafts.manage_own': 'Read and manage own time drafts',
  'time_entries.read_own': 'Read and write own time entries',
  'time_entries.write_own': 'Read and write own time entries',
  'time_sync.own': 'Sync own time with Solidtime',
  'time_sync.map': 'Map Solidtime projects and people',
  'time_sync.import_all': "Import everyone's Solidtime time",

  'project.members.manage': 'Manage project members',
  'project.settings.edit': 'Edit project settings and context_md',
  'sprint.manage': 'Create / edit / delete sprints',
  'task.assign_sprint': 'Assign tasks into or out of a sprint',
  'task.create': 'Create tasks',
  'task.write': 'Edit / move any task',
  'task.claim': 'Claim a task (start_working)',
  'task.checkpoint.create': 'Save a checkpoint on a task your agent holds',
  'task.checkpoint.retag': 'Re-tag a checkpoint one of your agents saved',
  'task.assign_other': 'Assign a task to someone else',
  'comment.create': 'Add comment',
  'comment.edit': 'Edit / delete comment',
  'comment.delete': 'Edit / delete comment',
  'task.delete': 'Cancel / delete task',
  'task.dependency.write': 'Add / remove dependencies',
  'task.watch': 'Watch / unwatch a task',
  'project.read': 'Read tasks, comments, activity, capacity',
  'meeting_proposal.apply': 'Apply a meeting-diff proposal',
  'usage.read_project': "Read a project's token totals",
  'budget.set': 'Set token budgets',
  'project.leave': 'Leave a project',
};

/**
 * An action whose answer depends on the resource, said in words, with a
 * resource on which the condition holds and one on which it does not.
 */
export interface ActionCondition {
  readonly text: string;
  readonly holds: (userId: string) => Resource;
  readonly fails: (userId: string) => Resource;
}

const SOMEONE_ELSE = 'someone-else';

/**
 * Every action `can()` answers differently for different resources. These
 * are the cases the task asks to be documented:
 *
 *  - `user.invite` — anyone but the Owner invites as Member or Viewer only
 *    (D-102 rule 5, LAI-958); an Owner may invite any role.
 *  - `project.join_public` — every role, a public project only. Which project
 *    role the joiner lands on is `projectRoleOnJoin`, not a permission.
 *  - `token.read_own`, `token.revoke_own` — every role, their own tokens only.
 *  - `user.sign_out` — every role may sign themselves out; somebody else is
 *    whoever holds *Deactivate people and reset access*, with
 *    `user.deactivate` (LAI-981, LAI-985).
 *  - `profile.rate` — Owner and Admin, anybody but themselves.
 *  - `people.analytics.read` — anybody but themselves: their own is `/me`
 *    (LAI-957).
 *  - `comment.edit`, `comment.delete` — a Lead any comment, a Member their own.
 *  - `task.delete` — a Lead any task, a Member one they created.
 */
export const ACTION_CONDITIONS: Readonly<Partial<Record<CatalogueAction, ActionCondition>>> = {
  'user.invite': {
    text: 'As Member or Viewer only',
    holds: () => ({ targetOrgRole: 'member' }),
    fails: () => ({ targetOrgRole: 'admin' }),
  },
  'project.join_public': {
    text: 'Public projects only',
    holds: () => ({ visibility: 'public' }),
    fails: () => ({ visibility: 'private' }),
  },
  'token.read_own': {
    text: 'Their own tokens only',
    holds: (userId) => ({ ownerId: userId }),
    fails: () => ({ ownerId: SOMEONE_ELSE }),
  },
  'token.revoke_own': {
    text: 'Their own tokens only',
    holds: (userId) => ({ ownerId: userId }),
    fails: () => ({ ownerId: SOMEONE_ELSE }),
  },
  'user.sign_out': {
    text: 'Themselves only',
    holds: (userId) => ({ targetUserId: userId }),
    fails: () => ({ targetUserId: SOMEONE_ELSE }),
  },
  'user.reset_password': {
    text: 'Not for the Owner',
    holds: () => ({ targetOrgRole: 'member' }),
    fails: () => ({ targetOrgRole: 'owner' }),
  },
  'profile.rate': {
    text: 'Anyone but themselves',
    holds: () => ({ targetUserId: SOMEONE_ELSE }),
    fails: (userId) => ({ targetUserId: userId }),
  },
  'people.analytics.read': {
    text: 'Anyone but themselves',
    holds: () => ({ targetUserId: SOMEONE_ELSE }),
    fails: (userId) => ({ targetUserId: userId }),
  },
  'comment.edit': {
    text: 'Their own comments only',
    holds: (userId) => ({ ownerId: userId }),
    fails: () => ({ ownerId: SOMEONE_ELSE }),
  },
  'comment.delete': {
    text: 'Their own comments only',
    holds: (userId) => ({ ownerId: userId }),
    fails: () => ({ ownerId: SOMEONE_ELSE }),
  },
  'task.delete': {
    text: 'Tasks they created only',
    holds: (userId) => ({ createdBy: userId }),
    fails: () => ({ createdBy: SOMEONE_ELSE }),
  },
};

export type Holding = 'yes' | 'no' | 'conditional';

/** One action and which built-in roles hold it. */
export interface PermissionRow {
  action: CatalogueAction;
  scope: 'org' | 'project';
  /** The SPEC §3.1 / §3.2 row, or `null` for an action no row grants yet. */
  label: string | null;
  /** No token may perform it, whatever its scope (`SESSION_ONLY_ACTIONS`). */
  session_only: boolean;
  /** A `read_only` token may perform it (`READ_ACTIONS`). */
  read_only: boolean;
  /** Set when some role is `conditional`; says what the condition is. */
  condition: string | null;
  /** Org roles for an `org` row, project roles for a `project` row. */
  roles: Record<string, Holding>;
}

export interface ProjectGrants {
  project_id: string;
  /** The effective role — an org viewer's membership is capped at `viewer`. */
  role: ProjectRole | null;
  actions: ProjectAction[];
}

/** The wire shape of `GET /api/v1/permissions`. */
export interface PermissionsView {
  org_roles: OrgRole[];
  project_roles: ProjectRole[];
  permissions: PermissionRow[];
  me: {
    org_role: OrgRole;
    credential: 'session' | 'token';
    /**
     * The projects this credential may reach: `'all'`, or a token's project
     * whitelist (§4.9). Everything below about projects holds only inside it.
     */
    project_scope: 'all' | string[];
    /**
     * The project role held on every project in `project_scope`, membership
     * or not: `lead` for an Owner, and for a role granted *Open every
     * project* (an Admin by default), `viewer` for a Viewer granted it
     * (LAI-958). A role, not a grant of actions: a `read_only` token still
     * holds only reads there.
     */
    implicit_project_role: ProjectRole | null;
    /** Org actions the caller may take on this credential, conditional ones included. */
    actions: OrgAction[];
    /**
     * Project actions per membership, on this credential. A membership this
     * credential may not read (`project.read`) is left out, not listed empty,
     * so a token pinned to one project learns nothing of the others.
     */
    projects: ProjectGrants[];
  };
}

/**
 * The projects this credential may reach: a token's pin, and for a registered
 * agent's token its grants as well (D-114) — the agent is pinned to them.
 */
function projectScope(actor: ResolvedActor): readonly string[] | null {
  const token = actor.token;
  if (token === undefined || token === null) return null;
  const agent = token.agent;
  if (agent === undefined || agent === null) return token.projectIds;

  const granted = [...agent.grants.keys()];
  return token.projectIds === null
    ? granted
    : granted.filter((id) => token.projectIds?.includes(id) === true);
}

/** A project id no real project has; project actions need one to be asked. */
const SYNTHETIC_PROJECT = 'synthetic-project';
const SYNTHETIC_USER = 'synthetic-user';

function resourceFor(action: CatalogueAction, userId: string, projectId?: string): Resource {
  const condition = ACTION_CONDITIONS[action];
  return { ...(projectId === undefined ? {} : { projectId }), ...condition?.holds(userId) };
}

function holding(actor: Actor, action: CatalogueAction, projectId?: string): Holding {
  const condition = ACTION_CONDITIONS[action];
  const base = projectId === undefined ? {} : { projectId };
  if (condition === undefined) return can(actor, action, base) ? 'yes' : 'no';

  const whenHolds = can(actor, action, { ...base, ...condition.holds(actor.userId) });
  const whenFails = can(actor, action, { ...base, ...condition.fails(actor.userId) });
  if (!whenHolds) return 'no';
  return whenFails ? 'yes' : 'conditional';
}

function row(
  action: CatalogueAction,
  scope: 'org' | 'project',
  orgGrants: OrgGrants | null | undefined,
): PermissionRow {
  const roles: Record<string, Holding> = {};

  if (scope === 'org') {
    for (const orgRole of ORG_ROLES) {
      const actor: Actor = {
        userId: SYNTHETIC_USER,
        orgRole,
        isActive: true,
        projectRole: null,
        orgGrants,
      };
      roles[orgRole] = holding(actor, action);
    }
  } else {
    // An org member holding each project role: the one org role whose project
    // role is neither implied (owner, admin) nor capped (viewer).
    for (const projectRole of PROJECT_ROLES) {
      // Without *Open every project*, or a member granted it would answer
      // `lead` in every column.
      const actor: Actor = {
        userId: SYNTHETIC_USER,
        orgRole: 'member',
        isActive: true,
        projectRole,
        orgGrants: { ...(orgGrants ?? DEFAULT_GRANTS), member: [] },
      };
      roles[projectRole] = holding(actor, action, SYNTHETIC_PROJECT);
    }
  }

  const conditional = Object.values(roles).includes('conditional');
  return {
    action,
    scope,
    label: ACTION_LABELS[action],
    session_only: SESSION_ONLY_ACTIONS.has(action),
    read_only: READ_ACTIONS.has(action),
    condition: conditional ? (ACTION_CONDITIONS[action]?.text ?? null) : null,
    roles,
  };
}

/**
 * The catalogue, and what the caller holds.
 *
 * Guarded on `org.read` — *"View the organisation"*, which every role holds
 * and a `read_only` token keeps. Who may do what in this organisation is a
 * fact about the organisation, and no narrower row exists that every member
 * holds; `member_list.read` would answer alike, and is about people.
 */
export function permissionsCatalogue(actor: ResolvedActor | null): PermissionsView {
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  assertCan(actor, 'org.read');

  const permissions = [
    ...ORG_ACTIONS.map((a) => row(a, 'org', actor.orgGrants)),
    ...PROJECT_ACTIONS.map((a) => row(a, 'project', actor.orgGrants)),
  ];

  const orgActions = ORG_ACTIONS.filter((a) => can(actor, a, resourceFor(a, actor.userId)));

  const projects = actor.memberships.flatMap((m): ProjectGrants[] => {
    const inProject: Actor = { ...actor, projectRole: m.role };
    if (!can(inProject, 'project.read', { projectId: m.projectId })) return [];
    return [
      {
        project_id: m.projectId,
        role: effectiveProjectRole(inProject),
        actions: PROJECT_ACTIONS.filter((a) =>
          can(inProject, a, resourceFor(a, actor.userId, m.projectId)),
        ),
      },
    ];
  });

  const whitelist = projectScope(actor);

  return {
    org_roles: [...ORG_ROLES],
    project_roles: [...PROJECT_ROLES],
    permissions,
    me: {
      org_role: actor.orgRole,
      credential: actor.token === undefined || actor.token === null ? 'session' : 'token',
      project_scope: whitelist === null ? 'all' : [...whitelist],
      implicit_project_role: implicitProjectRole(actor.orgRole, actor.orgGrants),
      actions: orgActions,
      projects,
    },
  };
}
