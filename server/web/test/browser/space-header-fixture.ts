/**
 * A space with enough in it to measure the header against (LAI-1198): three
 * sprints with one active, tasks across them and outside them, sizes beside
 * sprint badges, six members so the faces overflow, and tags so the Tag filter
 * draws. The board opens on the active sprint, so 5 of the 12 tasks show.
 */

import type { ApiStub } from './harness.ts';

const NOW = Date.now();
const DAY = 86_400_000;

export const PROJECT = {
  id: 'expense',
  slug: 'expense',
  prefix: 'EXT',
  name: 'Expense Tracker',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const sprint = (id: string, n: number, status: string, name: string) => ({
  id,
  project_id: PROJECT.id,
  name,
  goal: null,
  status,
  starts_on: NOW + (n - 2) * 14 * DAY,
  ends_on: NOW + (n - 1) * 14 * DAY,
  created_at: n,
  updated_at: n,
});

export const SPRINTS = [
  sprint('s1', 1, 'completed', 'Sprint 13 — Exports'),
  sprint('s2', 2, 'active', 'Sprint 14 — Receipts'),
  sprint('s3', 3, 'planned', 'Sprint 15 — Budgets'),
];

const size = (level: string) => ({
  level,
  computed: level,
  overridden: false,
  weight: 1,
  build_p50_ms: null,
  build_p80_ms: null,
  subtasks: 0,
});

const task = (
  n: number,
  title: string,
  status: string,
  sprintId: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: `t${String(n)}`,
  key: `EXT-${String(n)}`,
  number: n,
  project_id: PROJECT.id,
  title,
  description_md: '',
  acceptance_md: '',
  status,
  priority: 'p2',
  position: null,
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: sprintId,
  tags: [],
  ready: false,
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
  size: null,
  created_at: 1,
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
  ...extra,
});

export const TASKS = [
  task(1, 'Move receipt OCR to a background job', 'backlog', 's2', {
    size: size('XL'),
    tags: ['backend'],
    priority: 'p1',
  }),
  task(2, 'Category auto-suggest from merchant name', 'todo', 's2', {
    size: size('M'),
    tags: ['frontend'],
    assignee_id: 'u2',
  }),
  task(3, 'Monthly budget alerts by email', 'todo', 's2', { size: size('S'), tags: ['bug'] }),
  task(4, 'Export expenses to CSV and XLSX', 'in_progress', 's2', {
    size: size('S'),
    assignee_id: 'u3',
  }),
  task(5, 'Recurring expense templates', 'review', 's2', { size: size('M') }),
  task(6, 'Multi-currency support with daily FX rates', 'done', 's1', { size: size('L') }),
  task(7, 'Dark mode chart colours fail contrast', 'done', 's1', { size: size('S') }),
  task(8, 'Audit log for edited expenses', 'backlog', 's3'),
  task(9, 'Bulk-approve expense reports', 'backlog', 's3'),
  task(10, 'Policy limits per category', 'backlog', null),
  task(11, 'Receipt photo cropping', 'backlog', null),
  task(12, 'Onboarding checklist', 'todo', null),
];

const member = (id: string, name: string, role = 'member') => ({
  user_id: id,
  name,
  email: `${id}@example.com`,
  role,
  created_at: 1,
});

export const MEMBERS = [
  member('u1', 'Ada Lovelace', 'lead'),
  member('u2', 'Grace Hopper'),
  member('u3', 'Alan Turing'),
  member('u4', 'Edsger Dijkstra'),
  member('u5', 'Barbara Liskov'),
  member('u6', 'Tony Hoare'),
];

const P = `/api/v1/projects/${PROJECT.slug}`;

export function spaceStub(overrides: Record<string, unknown> = {}): ApiStub {
  const page = (rows: readonly unknown[]) => ({ data: rows, next_cursor: null });
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'u1@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: PROJECT.id, role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...PROJECT,
          task_counts: { backlog: 5, todo: 3, in_progress: 1, review: 1, done: 2, cancelled: 0 },
          blocked_count: 0,
          member_count: MEMBERS.length,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    [P]: PROJECT,
    [`${P}/tasks`]: page(TASKS),
    [`${P}/sprints`]: page(SPRINTS),
    [`${P}/members`]: { members: MEMBERS },
    [`${P}/mentionable`]: { users: MEMBERS.map((m) => ({ id: m.user_id, name: m.name })) },
    [`${P}/activity`]: page([]),
    [`${P}/meeting-reviews`]: page([]),
    [`${P}/tags`]: {
      tags: [
        { name: 'backend', task_count: 1 },
        { name: 'frontend', task_count: 1 },
        { name: 'bug', task_count: 1 },
      ],
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    ...overrides,
  };
}

/** The eight tabs of a space, by path, in the order the tab bar draws them. */
export const SPACE_TABS = [
  '/board',
  '/list',
  '/timeline',
  '/calendar',
  '/sprints',
  '/dashboard',
  '/activity',
  '/meeting-review',
] as const;
