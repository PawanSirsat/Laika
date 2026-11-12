/**
 * Fixtures for the Organisation tabs pass (LAI-1210): LAI-1194's organisation
 * (eight people, two invites, three spaces) with everything the other tabs
 * read as well — tokens for several people, model prices, a GitHub webhook,
 * a page of activity across two days and a page of Work.
 *
 * Every word here is invented for the test; none of it ships.
 */

import type { ApiStub } from './harness.ts';
import { task } from './capacity-org.ts';
import { NOW, ORG, OWNER, PEOPLE, PROJECTS, token } from './organisation-refine-fixtures.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Tokens across three people: fresh, never used, stale, expiring, an agent's. */
export const TOKENS: Readonly<Record<string, readonly unknown[]>> = {
  u2: [
    token('t1', 'Laptop — Claude Code'),
    token('t2', 'CI runner', { scope: 'read_only', last_used_at: null }),
  ],
  u3: [
    token('t3', 'Old deploy script', {
      last_used_at: NOW - 120 * DAY,
      created_at: NOW - 200 * DAY,
    }),
    token('t4', 'Release bot', { expires_at: NOW + 3 * DAY }),
  ],
  u5: [],
};

export const PRICES = {
  as_of: '2026-10-18',
  can_set: true,
  entries: [
    {
      model: 'claude-opus-5-5',
      input: 4,
      output: 20,
      cache_write: 5,
      cache_read: 0.2,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      as_of: '2026-10-18',
      confirmed: true,
      overridden: false,
      table: null,
    },
    {
      model: 'gpt-5.2-codex',
      input: 1.75,
      output: 14,
      cache_write: 1.75,
      cache_read: 0.175,
      source: 'https://developers.openai.com/api/docs/pricing',
      as_of: '2026-10-18',
      confirmed: false,
      overridden: false,
      table: null,
      note: 'Not on the price page; priced as gpt-5.3-codex.',
    },
  ],
};

/**
 * An hour on a local calendar day, `days` before today — so a history row is
 * on Today or Yesterday whatever time the suite runs, rather than drifting
 * across midnight as `NOW - 2h` would at 01:00.
 */
const localAt = (days: number, hour: number): number => {
  const d = new Date(NOW);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days, hour, 15).getTime();
};

const activity = (
  seq: number,
  type: string,
  at: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: `a${String(seq)}`,
  seq,
  type,
  project_id: 'p1',
  task_id: null,
  actor_id: 'u1',
  actor_kind: 'user',
  actor_token_id: null,
  payload: null,
  created_at: at,
  ...extra,
});

export const HISTORY = [
  activity(1, 'task.created', localAt(0, 11), {
    task_id: 'w1',
    actor_id: 'u2',
    payload: { key: 'COR-7', title: 'Heartbeat retention job' },
  }),
  activity(2, 'comment.added', localAt(0, 10), { task_id: 'w2', actor_id: 'u3', project_id: 'p2' }),
  activity(3, 'token.created', localAt(0, 9), { project_id: null }),
  activity(4, 'sprint.created', localAt(1, 16), { actor_id: null, actor_kind: 'system' }),
  activity(5, 'task.status_changed', localAt(1, 14), {
    task_id: 'w3',
    actor_id: 'u5',
    actor_kind: 'agent',
    payload: { key: 'COR-9', from: 'todo', to: 'in_progress' },
  }),
];

const STATUS_NAMES: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
};

const work = (id: string, key: string, title: string, status: string, p: number, who: string) => ({
  ...task(id, key, title, status, PROJECTS[p] ?? PROJECTS[0], who),
  assignee_id: who === '' ? null : who,
  status_id: `st-${status}`,
  status_name: STATUS_NAMES[status] ?? status,
  updated_at: NOW - 3 * HOUR,
});

export const WORK = [
  work('w1', 'COR-7', 'Heartbeat retention job', 'in_progress', 0, 'u2'),
  work('w2', 'MOB-3', 'Offline queue for the driver app', 'review', 1, 'u3'),
  work('w3', 'COR-9', 'Rate limit headers', 'todo', 0, 'u5'),
  work('w4', 'INF-2', 'Rotate the staging certificates', 'backlog', 2, ''),
];

/** Every tab's reads, for an owner. */
export const TABS = (extra: ApiStub = {}): ApiStub =>
  OWNER({
    '/api/v1/org': {
      ...ORG,
      github_webhook: { configured: false, payload_url: 'https://board.example/webhooks/github' },
    },
    '/api/v1/org/model-prices': PRICES,
    '/api/v1/users/u2/tokens': { data: TOKENS.u2, next_cursor: null },
    '/api/v1/users/u3/tokens': { data: TOKENS.u3, next_cursor: null },
    '/api/v1/users/u5/tokens': { data: TOKENS.u5, next_cursor: null },
    '/api/v1/activity/history': { data: HISTORY, next_cursor: null },
    '/api/v1/tasks': { data: WORK, next_cursor: null },
    '/api/v1/tasks/summary': {
      total: WORK.length,
      by_status: { backlog: 1, todo: 1, in_progress: 1, review: 1, done: 0, cancelled: 0 },
      by_assignee: PEOPLE.slice(0, 3).map((p) => ({ user_id: p.id, name: p.name, count: 1 })),
      overdue: 0,
      blocked: 0,
      unassigned: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    ...extra,
  });
