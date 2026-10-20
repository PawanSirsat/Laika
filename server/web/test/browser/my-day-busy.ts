/**
 * A busy day, shaped like the owner's production screenshots (LAI-810): 42
 * drafted blocks — some on a card, some on General, some on nothing and one on
 * a card the reader cannot see — fourteen confirmed entries, three of them
 * imported from Solidtime, and **200 tasks waiting on the reader's review**,
 * which is the most `GET /review` ever answers.
 *
 * The day is **today, computed at run time** in UTC (CONVENTIONS: a fixture
 * may not be pinned to the calendar), so the now line is drawn.
 *
 * Served as the API would serve it to its own reader. The writes My day makes
 * — confirm, dismiss, patch, confirm day — are recorded by the harness and
 * answered by {@link busyStub}'s `writes`, which a test may replace.
 *
 * Review round 1 added: a second space, so the reader's work in progress
 * spans two; agent minutes on a card in a space the reader cannot read; and a
 * confirm-day answer that may differ from the page — the server's day, which a
 * collector upload can change under a page already open.
 */

import type { ApiStub, StubCall } from './harness.ts';

export const TODAY = new Date().toISOString().slice(0, 10);
const MIDNIGHT = Date.parse(`${TODAY}T00:00:00Z`);
const at = (minutes: number): number => MIDNIGHT + minutes * 60_000;

export const ATLAS = { id: 'p1', slug: 'atlas', name: 'Atlas' };

/** A card in a space the reader cannot read, that one of their sessions touched. */
export const SECRET = { id: 's9', key: 'SEC-9', title: 'Secret plan' };

/** The cards the day is spent on — all in Atlas, all readable. */
export const CARDS = [
  { id: 't1', key: 'LAI-1', title: 'Search matches keys' },
  { id: 't2', key: 'LAI-2', title: 'Webhook retries back off' },
  { id: 't3', key: 'LAI-3', title: 'Empty states for every list' },
  { id: 't4', key: 'LAI-4', title: 'Capacity reads the org' },
  { id: 't5', key: 'LAI-5', title: 'Token budgets per space' },
  { id: 't6', key: 'LAI-6', title: 'Import from Solidtime' },
] as const;

export const DRAFT_COUNT = 42;

export type Draft = Record<string, unknown> & {
  readonly id: string;
  readonly minutes: number;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly task: unknown;
  readonly project: unknown;
  readonly general: boolean;
};

/**
 * Block `i` (0-based): 20 minutes apart from 06:00, 15 to 19 minutes long.
 * Every 7th is on nothing, every 9th on General, the 11th names a card the
 * reader cannot see, and the rest are on a card.
 */
function draft(i: number): Draft {
  const start = 6 * 60 + i * 20;
  const minutes = 15 + (i % 5);
  const card = CARDS[i % CARDS.length] ?? CARDS[0];
  const untied = i % 7 === 3;
  const hidden = i === 10;
  const general = !untied && !hidden && i % 9 === 5;
  const onCard = !untied && !hidden && !general;
  return {
    id: `d${String(i + 1).padStart(2, '0')}`,
    source: i % 13 === 12 ? 'agent' : 'collector',
    day: TODAY,
    tz: 'UTC',
    started_at: at(start),
    ended_at: at(start + minutes),
    minutes,
    task: onCard ? card : null,
    task_key: hidden ? 'LAI-758' : null,
    project: onCard ? ATLAS : null,
    general,
    signals: {
      prompts: i % 4,
      replies: 2 + (i % 6),
      sessions: 1 + (i % 2),
      commits: i % 3,
      marks: 0,
    },
    note: null,
  };
}

export const DRAFTS: readonly Draft[] = Array.from({ length: DRAFT_COUNT }, (_, i) => draft(i));

/** The blocks that need a card or General before they can be confirmed. */
export const UNTIED_IDS = DRAFTS.filter((d) => d.task === null && !d.general).map((d) => d.id);

function entry(i: number): Record<string, unknown> {
  const card = CARDS[(i + 2) % CARDS.length] ?? CARDS[0];
  const source = i % 5 === 1 ? 'import' : i % 3 === 0 ? 'manual' : 'draft';
  const start = 21 * 60 + i * 9;
  const timed = i % 6 !== 4;
  return {
    id: `e${String(i + 1).padStart(2, '0')}`,
    day: TODAY,
    tz: 'UTC',
    started_at: timed ? at(start) : null,
    ended_at: timed ? at(start + 8) : null,
    minutes: 8,
    source,
    task: i % 4 === 2 ? null : card,
    project: i % 4 === 2 ? null : ATLAS,
    note: i % 4 === 2 ? 'Standup' : null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
  };
}

export const ENTRIES = Array.from({ length: 14 }, (_, i) => entry(i));

const weekday = (new Date(MIDNIGHT).getUTCDay() + 6) % 7;

export const BUSY_DAY = {
  day: TODAY,
  tz: 'UTC',
  today: TODAY,
  settings: { org_mode: 'drafts', draft_my_time: true, drafting: true, min_sync_interval_s: 300 },
  drafts: DRAFTS,
  entries: ENTRIES,
  agent: {
    minutes: 312,
    keyboard_minutes: 48,
    by_task: [
      ...CARDS.map((task, i) => ({ task, minutes: 20 + i * 7 })),
      { task: SECRET, minutes: 11 },
    ],
    unattributed_minutes: 40,
  },
  state: 'drafted',
  week: Array.from({ length: 7 }, (_, i) => {
    const day = new Date(MIDNIGHT + (i - weekday) * 86_400_000).toISOString().slice(0, 10);
    const drafted = DRAFTS.reduce((sum, d) => sum + d.minutes, 0);
    return {
      day,
      confirmed_minutes: day === TODAY ? 112 : day < TODAY ? 420 : 0,
      drafted_minutes: day === TODAY ? drafted : 0,
      state: day === TODAY ? 'drafted' : day < TODAY ? 'confirmed' : 'future',
    };
  }),
};

export function summary(
  id: string,
  key: string,
  title: string,
  status: string,
  blockedBy: string[] = [],
  updatedAt = 5,
) {
  return {
    id,
    key,
    title,
    status,
    status_id: `st-${status}`,
    status_name: status,
    project_id: 'p1',
    number: Number(key.split('-')[1] ?? '0'),
    priority: 'p2',
    assignee_id: 'u1',
    blocked_by: blockedBy,
    blocks: [],
    updated_at: updatedAt,
  };
}

/** 200 waiting on the reader — `GET /review`'s ceiling. */
export const REVIEW_COUNT = 200;

const queue = Array.from({ length: REVIEW_COUNT }, (_, i) => ({
  task: summary(
    `r${String(i + 1)}`,
    `LAI-${String(300 + i)}`,
    `Review item ${String(i + 1)}`,
    'review',
  ),
  project: { id: 'p1', slug: 'atlas', name: 'Atlas', prefix: 'LAI' },
  assignee_name: 'Grace Hopper',
  waiting_since: 1 + i,
  round: {
    ci: {
      head_sha: 'a',
      total: 2,
      passed: i % 3 === 0 ? 1 : 2,
      failed: i % 3 === 0 ? 1 : 0,
      pending: 0,
      failed_names: [],
    },
  },
  finished_by_name: null,
  can_decide: true,
  cue: null,
}));

export const IN_PROGRESS_COUNT = 8;

/** The entry a confirmed draft becomes. */
export function entryOf(d: Draft): Record<string, unknown> {
  return {
    id: `e-${d.id}`,
    day: TODAY,
    tz: 'UTC',
    started_at: d.started_at,
    ended_at: d.ended_at,
    minutes: d.minutes,
    source: 'draft',
    task: d.task,
    project: d.project,
    note: null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
  };
}

/** A block on nothing the collector uploaded after the page was read. */
export const ARRIVED: Draft = {
  ...draft(41),
  id: 'dx',
  minutes: 20,
  task: null,
  project: null,
  general: false,
};

/**
 * Every write My day can make, answered as the server would — an entry for a
 * confirm, `204` for a dismiss, the draft for a patch, and for confirm-day the
 * entries of every block **the server** holds (`serverDrafts`). A test that
 * wants a refusal passes its own `writes`.
 */
export function defaultWrites(call: StubCall, serverDrafts: readonly Draft[] = DRAFTS): unknown {
  if (call.path.includes('/time/days/')) return { entries: serverDrafts.map(entryOf) };
  return call.path.endsWith('/confirm') ? { id: 'new-entry' } : {};
}

/**
 * The busy day's stub. `writes` answers every POST and PATCH to a draft or a
 * day; the default accepts them all. `day` is what `GET /me/time` serves —
 * the page's day.
 */
export function busyStub(
  writes: (call: StubCall) => unknown = (call) => defaultWrites(call),
  day: typeof BUSY_DAY = BUSY_DAY,
): ApiStub {
  const draftRoutes: Record<string, unknown> = {};
  for (const d of [...DRAFTS, ARRIVED]) {
    draftRoutes[`/api/v1/me/time-drafts/${d.id}`] = writes;
    draftRoutes[`/api/v1/me/time-drafts/${d.id}/confirm`] = writes;
    draftRoutes[`/api/v1/me/time-drafts/${d.id}/dismiss`] = writes;
  }
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [
        { project_id: 'p1', role: 'lead' },
        { project_id: 'p2', role: 'member' },
      ],
    },
    '/api/v1/me/time': day,
    [`/api/v1/me/time/days/${TODAY}/confirm`]: writes,
    ...draftRoutes,
    '/api/v1/projects': {
      data: [
        {
          id: 'p1',
          slug: 'atlas',
          prefix: 'LAI',
          name: 'Atlas',
          archived_at: null,
          task_counts: { backlog: 0, todo: 4, in_progress: 8, review: 0, done: 0, cancelled: 0 },
          member_count: 1,
          members: [],
        },
        {
          id: 'p2',
          slug: 'onroute',
          prefix: 'ON',
          name: 'Onroute',
          archived_at: null,
          task_counts: { backlog: 0, todo: 0, in_progress: 2, review: 0, done: 0, cancelled: 0 },
          member_count: 1,
          members: [],
        },
      ],
      next_cursor: null,
    },
    // Touched less recently than any in Atlas, so both are past the first five.
    '/api/v1/projects/onroute/tasks?assignee=u1&status=in_progress': {
      data: [
        { ...summary('o1', 'ON-1', 'Route one', 'in_progress', [], 50), project_id: 'p2' },
        { ...summary('o2', 'ON-2', 'Route two', 'in_progress', [], 49), project_id: 'p2' },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/onroute/tasks?assignee=u1&status=todo': { data: [], next_cursor: null },
    '/api/v1/projects/atlas/tasks?assignee=u1&status=in_progress': {
      data: Array.from({ length: IN_PROGRESS_COUNT }, (_, i) =>
        summary(
          `p${String(i + 1)}`,
          `LAI-${String(40 + i)}`,
          `In progress ${String(i + 1)}`,
          'in_progress',
          [],
          100 - i,
        ),
      ),
      next_cursor: null,
    },
    '/api/v1/projects/atlas/tasks?assignee=u1&status=todo': {
      data: [
        summary('b1', 'LAI-60', 'Blocked one', 'todo', ['x9']),
        summary('b2', 'LAI-61', 'Blocked two', 'todo', ['x9']),
        summary('b3', 'LAI-62', 'Not blocked', 'todo'),
      ],
      next_cursor: null,
    },
    '/api/v1/tasks/x9': summary('x9', 'LAI-99', 'The blocker', 'in_progress'),
    '/api/v1/review': { tasks: queue, truncated: true },
  };
}
