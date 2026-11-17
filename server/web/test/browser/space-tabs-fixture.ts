/**
 * One small space for the Dashboard, Sprints and Timeline tests (LAI-1195).
 *
 * Shaped like the seeded space the visual audit measured: an ended sprint, a
 * running one and a planned one, open and finished work across priorities,
 * a few due dates (one overdue), metrics with more than one bar, and a
 * forecast. Every expected number in `space-tabs.test.ts` is counted from
 * these arrays there, never by calling the app's own derivations.
 */

import type { ApiStub } from './harness.ts';

export const DAY = 86_400_000;
/** Midday today, UTC, so nothing depends on the hour the suite runs. */
export const NOW = Math.floor(Date.now() / DAY) * DAY + DAY / 2;
export const at = (days: number): number => Math.floor(NOW / DAY) * DAY + days * DAY;

export const PROJECT = {
  id: 'p1',
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

const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

export const counts = (by: Partial<Record<Status, number>>) => {
  const by_status = Object.fromEntries(STATUSES.map((s) => [s, by[s] ?? 0]));
  return { total: Object.values(by_status).reduce((a, b) => a + b, 0), by_status };
};

export interface FixtureTask {
  id: string;
  key: string;
  status: Status;
  priority: 'p1' | 'p2' | 'p3';
  sprint_id: string | null;
  due_on: number | null;
  updated_at: number;
  created_at: number;
  [field: string]: unknown;
}

const task = (i: number, over: Partial<FixtureTask>): FixtureTask => ({
  id: `t${String(i)}`,
  key: `EXT-${String(i)}`,
  number: i,
  project_id: 'p1',
  title: `Expense task ${String(i)}`,
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  position: null,
  assignee_id: i % 3 === 0 ? null : i % 2 === 0 ? 'u1' : 'u2',
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
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
  created_at: NOW - (i + 1) * DAY,
  updated_at: NOW - (i % 9) * DAY - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const PLAN: readonly [Status, 'p1' | 'p2' | 'p3', string | null][] = [
  ['done', 'p1', 's2'],
  ['done', 'p2', 's2'],
  ['in_progress', 'p1', 's2'],
  ['in_progress', 'p2', 's2'],
  ['review', 'p2', 's2'],
  ['todo', 'p3', 's2'],
  ['todo', 'p1', 's2'],
  ['todo', 'p2', 's2'],
  ['todo', 'p2', 's3'],
  ['todo', 'p3', 's3'],
  ['backlog', 'p3', 's3'],
  ['backlog', 'p2', null],
  ['backlog', 'p3', null],
  ['done', 'p2', 's1'],
  ['done', 'p1', 's1'],
  ['cancelled', 'p3', null],
];

export const TASKS: FixtureTask[] = PLAN.map(([status, priority, sprint], i) =>
  task(i + 1, {
    status,
    priority,
    sprint_id: sprint,
    due_on: i === 2 ? at(-2) : i === 4 ? at(2) : i === 6 ? at(4) : null,
  }),
);

const sprintCounts = (id: string) => {
  const by: Partial<Record<Status, number>> = {};
  for (const t of TASKS.filter((x) => x.sprint_id === id)) by[t.status] = (by[t.status] ?? 0) + 1;
  return counts(by);
};

export const sprint = (
  id: string,
  name: string,
  from: number,
  to: number,
  status: string,
  goal: string | null,
) => ({
  id,
  project_id: 'p1',
  name,
  goal,
  starts_on: from,
  ends_on: to,
  status,
  created_at: 1,
  updated_at: 1,
  task_counts: sprintCounts(id),
});

export const SPRINTS = [
  sprint('s1', 'Sprint 13 — Exports', at(-30), at(-17), 'completed', 'CSV export shipped.'),
  sprint('s2', 'Sprint 14 — Receipts', at(-6), at(7), 'active', 'Upload is fast.'),
  sprint('s3', 'Sprint 15 — Approvals', at(8), at(21), 'planned', 'Managers approve claims.'),
];

export const METRICS_DAYS = [1, 0, 2, 0, 1, 3, 0, 1];

const MEMBERS = [
  { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead', created_at: 1 },
  { user_id: 'u2', name: 'Grace Hopper', email: 'g@example.com', role: 'member', created_at: 1 },
];

const forecastFor = (id: string) => ({
  sprint_id: id,
  total: 8,
  done: 2,
  forecast: { probability: 0.85, low: 5, high: 7, median: 6, days_left: 7 },
  reason: null,
  basis: { days: 42, tasks_done: 31, weight_done: 29.5 },
});

const TASKS_PATH = '/api/v1/projects/expense/tasks';

/**
 * The stub. `timeline` keys the task list by `?sprint=` as the Timeline asks
 * for it; the other screens read the whole list from the path alone.
 */
export function spaceStub(options: { readonly timeline?: boolean } = {}): ApiStub {
  const all = () => ({ data: TASKS.map((t) => ({ ...t })), next_cursor: null });
  const bySprint = (id: string | null) => ({
    data: TASKS.filter((t) => t.sprint_id === id).map((t) => ({ ...t })),
    next_cursor: null,
  });
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...PROJECT,
          task_counts: { backlog: 3, todo: 5, in_progress: 2, review: 1, done: 4, cancelled: 1 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/expense': PROJECT,
    ...(options.timeline === true
      ? {
          [`${TASKS_PATH}?sprint=s1`]: bySprint('s1'),
          [`${TASKS_PATH}?sprint=s2`]: bySprint('s2'),
          [`${TASKS_PATH}?sprint=s3`]: bySprint('s3'),
          [`${TASKS_PATH}?sprint=none`]: bySprint(null),
        }
      : { [TASKS_PATH]: all }),
    '/api/v1/projects/expense/sprints': { data: SPRINTS, next_cursor: null },
    '/api/v1/projects/expense/members': { members: MEMBERS },
    '/api/v1/projects/expense/mentionable': {
      users: MEMBERS.map((m) => ({ id: m.user_id, name: m.name })),
    },
    '/api/v1/projects/expense/activity': { data: [], next_cursor: null },
    '/api/v1/projects/expense/tags': { tags: [] },
    '/api/v1/projects/expense/metrics': {
      since: NOW - 7 * DAY,
      throughput: METRICS_DAYS.map((completed, i) => ({
        day: new Date(at(i - 7)).toISOString().slice(0, 10),
        completed,
      })),
      cycle_time: { measured: 8, unmeasured: 0, p50_ms: 2 * DAY, p75_ms: 3 * DAY, p90_ms: 5 * DAY },
    },
    '/api/v1/sprints/s2/forecast': forecastFor('s2'),
    '/api/v1/sprints/s3/forecast': {
      ...forecastFor('s3'),
      total: 3,
      done: 0,
      forecast: null,
      reason: 'not_enough_history',
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}
