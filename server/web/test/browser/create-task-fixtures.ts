import { defaultPermissions, type ApiStub } from './harness.ts';

/**
 * One space with two members, a tag, an active sprint and two open tasks —
 * what the Create task dialog's tests open on (LAI-1167). Shared by the two
 * files so a change to the fixture cannot leave one of them describing a
 * different space.
 */

export const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  color: 'violet',
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

export const task = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task number ${String(n)}`,
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  status_id: 'st-todo',
  status_name: 'To do',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: true,
  blocked: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: Date.now() - n * 60_000,
  started_at: null,
  completed_at: null,
  ...extra,
});

/** What the stub answers a successful create with: the task the form made. */
export const NEW_TASK = task(7, { id: 't-new', key: 'LC-7', title: 'Ship the dialog' });

export const SPRINT = {
  id: 's1',
  project_id: 'laika-core',
  name: 'Sprint 4',
  goal: null,
  starts_on: Date.UTC(2026, 10, 2),
  ends_on: Date.UTC(2026, 10, 16),
  status: 'active',
  created_at: 1,
  updated_at: 1,
};

export const me = (id: string, name: string, orgRole: string, role: string) => ({
  id,
  email: `${id}@example.com`,
  name,
  org_role: orgRole,
  is_active: true,
  memberships: [{ project_id: 'laika-core', role }],
});

export const ADA = me('u1', 'Ada Lovelace', 'member', 'lead');
export const TOMAS = me('u2', 'Tomas Member', 'member', 'member');

/**
 * `/permissions` as the server answers it in a *Space admins only* space:
 * the default grants with `task.create` held by the lead alone — the shape
 * `board-create-gate.test.ts` established.
 */
export function adminsOnly(person: ReturnType<typeof me>): unknown {
  const base = defaultPermissions(person) as {
    me: { projects: { project_id: string; role: string; actions: string[] }[] };
  };
  return {
    ...base,
    me: {
      ...base.me,
      projects: base.me.projects.map((grant) => ({
        ...grant,
        actions:
          grant.role === 'lead' ? grant.actions : grant.actions.filter((a) => a !== 'task.create'),
      })),
    },
  };
}

export function stub(person: ReturnType<typeof me>, extra: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': person,
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 2, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [
            { user_id: 'u1', name: 'Ada Lovelace' },
            { user_id: 'u2', name: 'Tomas Member' },
          ],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': { data: [task(1), task(2)], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [
        {
          user_id: 'u1',
          name: 'Ada Lovelace',
          email: 'u1@example.com',
          role: 'lead',
          created_at: 1,
        },
        {
          user_id: 'u2',
          name: 'Tomas Member',
          email: 'u2@example.com',
          role: 'member',
          created_at: 1,
        },
      ],
    },
    '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [{ name: 'ui', task_count: 3 }] },
    '/api/v1/agents': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: true, present: [] },
    ...extra,
  };
}

export const DIALOG = '[data-dialog="create-task"]';
