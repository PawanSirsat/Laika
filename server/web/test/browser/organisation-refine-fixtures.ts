/**
 * Fixtures for the Organisation, People and Roles refinement (LAI-1194): an
 * organisation big enough to need every state the screens draw — eight
 * people across four roles, two pending invites, three spaces, a permission
 * catalogue with enough rows that a list of chips would be a wall.
 *
 * Every word here is invented for the test; none of it ships.
 */

import type { ApiStub } from './harness.ts';
import { capacityPerson } from './capacity-org.ts';

export const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const user = (
  id: string,
  name: string,
  org_role: string,
  extra: { is_active?: boolean; last_seen_at?: number | null } = {},
) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: extra.is_active ?? true,
  last_seen_at: extra.last_seen_at ?? null,
  created_at: 1,
  updated_at: 1,
});

export const PEOPLE = [
  user('u1', 'Ada Lovelace', 'owner', { last_seen_at: NOW - 5 * 60_000 }),
  user('u2', 'Tomas Nel', 'member', { last_seen_at: NOW - 3 * HOUR }),
  user('u3', 'Priya Raman', 'admin', { last_seen_at: NOW - DAY }),
  user('u4', 'Sam Okafor', 'viewer', { is_active: false }),
  user('u5', 'Grace Hopper', 'member', { last_seen_at: NOW - 2 * DAY }),
  user('u6', 'Lin Zhao', 'member', { last_seen_at: NOW - 6 * HOUR }),
  user('u7', 'Marta Silva', 'admin', { last_seen_at: NOW - 40 * 60_000 }),
  user('u8', 'Kofi Mensah', 'member'),
];

const project = (id: string, slug: string, name: string, prefix: string) => ({
  id,
  slug,
  name,
  prefix,
  description: null,
  repo: null,
  visibility: 'private',
  color: null,
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 2, todo: 4, in_progress: 3, review: 1, done: 9, cancelled: 0 },
  blocked_count: 0,
  member_count: 4,
  members: [],
  last_activity_at: null,
});

export const PROJECTS = [
  project('p1', 'core', 'Core', 'COR'),
  project('p2', 'mobile', 'Mobile app', 'MOB'),
  project('p3', 'infra', 'Platform infra', 'INF'),
];

const space = (p: (typeof PROJECTS)[number]) => ({
  project_id: p.id,
  slug: p.slug,
  name: p.name,
  load: 'light',
  in_progress: 0,
  todo: 0,
  backlog: 0,
  in_review: 0,
  committed: 0,
  overdue: 0,
  due_soon: 0,
  open: 0,
});

export const CAPACITY = {
  enabled: true,
  people: PEOPLE.map((p, i) =>
    capacityPerson({
      user_id: p.id,
      name: p.name,
      status: i % 3 === 0 ? 'online' : 'offline',
      last_seen: p.last_seen_at,
      spaces: PROJECTS.slice(0, 1 + (i % 3)).map(space),
      agents: [],
    }),
  ),
};

export const ORG = {
  id: 'o1',
  name: 'Northwind',
  presence_enabled: true,
  developer_insights: false,
  created_at: Date.UTC(2026, 10, 4),
  updated_at: 2,
  ai: { configured: true, provider: 'anthropic', key_last4: '9f2a' },
};

export const INVITES = [
  {
    id: 'i1',
    email: 'new.hire@example.com',
    org_role: 'member',
    project_id: 'p1',
    project_role: 'member',
    created_by: 'u1',
    created_at: NOW - HOUR,
    expires_at: NOW + 3 * DAY,
    email_sent: false,
  },
  {
    id: 'i2',
    email: null,
    org_role: 'viewer',
    project_id: null,
    project_role: null,
    created_by: 'u3',
    created_at: NOW - DAY,
    expires_at: NOW + 6 * DAY,
    email_sent: false,
  },
];

const ORG_LABELS = [
  ['org.delete', 'Delete org data'],
  ['org.transfer_ownership', 'Transfer ownership'],
  ['org.settings.edit', 'Org settings (AI provider, SMTP, signup mode)'],
  ['project.create', 'Create / archive space'],
  ['user.invite', 'Invite users'],
  ['user.set_role', 'Change org roles'],
  ['org.permissions.manage', 'Set what each role may do'],
  ['user.deactivate', 'Deactivate user'],
  ['user.sign_out', 'Sign a person out everywhere'],
  ['user.reset_link', 'Issue a password-reset link'],
  ['org.read', 'View the organisation'],
  ['presence.read', 'Presence and capacity'],
  ['user.list', 'View member list'],
  ['project.join', 'Join a public space'],
  ['token.manage_own', 'Generate, read and revoke own tokens'],
  ['token.list_any', 'List anyone’s tokens'],
  ['token.revoke_any', 'Revoke anyone’s token'],
  ['agent.read_own', 'Read own agents'],
  ['agent.manage_own', 'Register and manage own agents'],
  ['unlisted.log', 'Log own unlisted work'],
  ['audit_log.export', 'Export audit log'],
  ['webhook.configure', 'Configure webhooks'],
  ['profile.read', 'View a member’s profile'],
  ['profile.rate', 'Rate a member'],
  ['org.developer_insights.set', 'Turn Developer insights on or off'],
  ['usage.read_org', 'View the organisation’s token usage'],
  ['org.time.set', 'Set the organisation’s Time setting'],
  ['time.own', 'Read and write own time entries'],
] as const;

const PROJECT_LABELS = [
  ['project.members.manage', 'Manage space members'],
  ['project.settings.edit', 'Edit space settings and context'],
  ['sprint.manage', 'Create / edit / delete sprints'],
  ['task.create', 'Create tasks'],
  ['task.edit_any', 'Edit / move any task'],
  ['task.claim', 'Claim a task'],
  ['task.assign', 'Assign a task to someone else'],
  ['comment.create', 'Add comment'],
  ['comment.edit', 'Edit / delete comment'],
  ['task.delete', 'Cancel / delete task'],
  ['task.read', 'Read tasks, comments, activity, capacity'],
  ['project.leave', 'Leave a space'],
] as const;

const yes = (roles: readonly string[]) => Object.fromEntries(roles.map((r) => [r, 'yes']));

export const CATALOGUE = {
  org_roles: ['owner', 'admin', 'member', 'viewer'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [
    ...ORG_LABELS.map(([action, label], i) => ({
      action,
      scope: 'org',
      label,
      session_only: i < 3,
      read_only: i > 9 && i < 14,
      condition: null,
      roles: {
        ...yes(['owner']),
        admin: i < 3 ? 'no' : 'yes',
        member: i > 9 ? 'yes' : 'no',
        viewer: i > 9 && i < 14 ? 'yes' : 'no',
      },
    })),
    ...PROJECT_LABELS.map(([action, label], i) => ({
      action,
      scope: 'project',
      label,
      session_only: false,
      read_only: action === 'task.read',
      condition: action === 'comment.edit' ? 'Their own comments only' : null,
      roles: {
        lead: 'yes',
        member: i < 3 ? 'no' : action === 'comment.edit' ? 'conditional' : 'yes',
        viewer: action === 'task.read' ? 'yes' : 'no',
      },
    })),
  ],
};

export const permissions = (
  org_role: string,
  actions: readonly string[],
  projects: readonly { project_id: string; role: string; actions: readonly string[] }[] = [],
) => ({
  ...CATALOGUE,
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: org_role === 'owner' || org_role === 'admin' ? 'lead' : null,
    actions,
    projects,
  },
});

export const OWNER_ACTIONS = ORG_LABELS.map(([action]) => action);
const PROJECT_ACTIONS = PROJECT_LABELS.map(([action]) => action);

export const GRANTS = {
  roles: ['admin', 'member', 'viewer'],
  capabilities: [
    {
      id: 'invite',
      label: 'Invite people',
      description: 'Send invites and re-issue links.',
      actions: ['user.invite'],
    },
    {
      id: 'deactivate',
      label: 'Deactivate people',
      description: 'Lock someone out without deleting their history.',
      actions: ['user.deactivate'],
    },
  ],
  grants: {
    admin: { invite: true, deactivate: true },
    member: { invite: false, deactivate: false },
    viewer: { invite: false, deactivate: false },
  },
  owner_locked: [{ action: 'org.transfer_ownership', label: 'Transfer ownership' }],
  updated_at: null,
  updated_by: null,
};

export const token = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  prefix: `lai_${id}xy`,
  scope: 'full',
  project_ids: null,
  last_used_at: NOW - HOUR,
  expires_at: null,
  revoked_at: null,
  created_at: NOW - DAY,
  ...extra,
});

export const me = (id: string, org_role: string) => ({
  ...user(id, PEOPLE.find((p) => p.id === id)?.name ?? 'Someone', org_role),
  memberships: [],
});

/** The whole organisation, read by its owner. */
export const OWNER = (extra: ApiStub = {}): ApiStub => ({
  '/api/v1/projects': { data: PROJECTS, next_cursor: null },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: INVITES, next_cursor: null },
  '/api/v1/capacity': CAPACITY,
  '/api/v1/org': ORG,
  '/api/v1/org/overview': {
    people: { active: 7, seen_this_week: 6, since: 1 },
    tasks: { open: 31, in_review: 4, blocked: 2, overdue: 3 },
  },
  '/api/v1/org/permissions': GRANTS,
  '/api/v1/org/time/breaks': { data: [] },
  '/api/v1/me': me('u1', 'owner'),
  '/api/v1/permissions': permissions(
    'owner',
    OWNER_ACTIONS,
    PROJECTS.slice(0, 2).map((p) => ({ project_id: p.id, role: 'lead', actions: PROJECT_ACTIONS })),
  ),
  '/api/v1/users/u2/tokens': {
    data: [token('t1', 'Laptop — Claude Code'), token('t2', 'CI runner', { scope: 'read_only' })],
    next_cursor: null,
  },
  ...extra,
});

/** A member: reads the directory and the roles, changes nothing. */
export const MEMBER = (extra: ApiStub = {}): ApiStub =>
  OWNER({
    '/api/v1/me': me('u2', 'member'),
    '/api/v1/permissions': permissions(
      'member',
      OWNER_ACTIONS.slice(10, 14),
      PROJECTS.slice(0, 1).map((p) => ({
        project_id: p.id,
        role: 'member',
        actions: PROJECT_ACTIONS.slice(3),
      })),
    ),
    ...extra,
  });
