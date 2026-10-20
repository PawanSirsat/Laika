/**
 * A space shaped like production OnRoute on 2026-10-20 (LAI-817, D-092).
 *
 * The owner looked at OnRoute's dashboard, saw *"Ashutosh 24, Pawan 6"* under
 * Work by person, and knew it was wrong: Pawan had done most of the work. The
 * audit reproduced every figure on that screen from production, and this
 * fixture rebuilds the same **shape** so a browser can show the before and the
 * after side by side:
 *
 * | figure | the old screen | what was true |
 * | --- | --- | --- |
 * | Work by person, 7 days | Ashutosh 24, Unassigned 15, Sakshi 7, Pawan 6 | open tasks *touched*, by current assignee |
 * | delivered, 7 days | — | Ashutosh 23, Pawan 3 |
 * | delivered, 30 days or all time | — | Pawan 168, Ashutosh 86, Sakshi 16 |
 * | donut centre | 52 open tasks | 301 open |
 * | Stale | 266 | the server flags 7; 37 more wait in review |
 * | Blocked | 30 | 11 to do or in progress; 19 backlog chains |
 * | due dates | — | 2 of 301 open tasks have one |
 *
 * **Built from named groups, not tuned until it matched.** Each group below is
 * a sentence of the table, and `EXPECTED` is counted from the groups by the
 * same plain arithmetic a reader would do — never by calling the code under
 * test, so a wrong rule in the app cannot agree with itself.
 *
 * Anchored to `Date.now()` (CONVENTIONS §4): every time is *n days ago*.
 */

import type { Page, Route } from 'playwright';
import type { ApiStub } from './harness.ts';

export const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TODAY = NOW - (NOW % DAY);
const ago = (days: number): number => NOW - Math.round(days * DAY);

export const ASH = 'u-ash';
export const PAW = 'u-paw';
export const SAK = 'u-sak';
export const NAMES: Readonly<Record<string, string>> = {
  [ASH]: 'Ashutosh',
  [PAW]: 'Pawan',
  [SAK]: 'Sakshi',
};
/** Pawan's agent token: its moves are written `actor_kind: 'agent'`, `actor_id` Pawan. */
export const PAW_TOKEN = 'tok-paw-omnigent';

export const ONROUTE = {
  id: 'p-onroute',
  slug: 'onroute',
  prefix: 'OR',
  name: 'OnRoute',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const STATUS_NAME: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

export interface FixtureTask {
  id: string;
  key: string;
  status: string;
  assignee_id: string | null;
  blocked_by: string[];
  due_on: number | null;
  stale_flagged_at: number | null;
  updated_at: number;
  [field: string]: unknown;
}

export interface FixtureEvent {
  id: string;
  seq: number;
  type: string;
  project_id: string;
  task_id: string;
  actor_id: string;
  actor_kind: 'user' | 'agent';
  actor_token_id: string | null;
  payload: unknown;
  created_at: number;
}

const TITLES = [
  'Route optimiser ignores toll preference',
  'Driver app: offline queue for proof of delivery',
  'Depot import rejects UTF-8 BOM',
  'ETA drift when a stop is skipped',
  'Dispatch board: bulk reassign',
  'Fleet report CSV is missing the trailer column',
  'Customer SMS template per depot',
  'Geofence radius per stop type',
  'Retry webhook deliveries with backoff',
  'Vehicle capacity in pallets, not kilograms',
];

const tasks: FixtureTask[] = [];
const events: Omit<FixtureEvent, 'seq'>[] = [];

function addTask(
  status: string,
  assignee: string | null,
  updatedAt: number,
  over: Partial<FixtureTask> = {},
): FixtureTask {
  const n = tasks.length + 1;
  const t: FixtureTask = {
    id: `or${String(n)}`,
    key: `OR-${String(n)}`,
    number: n,
    project_id: ONROUTE.id,
    title: `${TITLES[n % TITLES.length] ?? 'Task'} (${String(n)})`,
    description_md: '',
    acceptance_md: '',
    status,
    status_id: `st-${status}`,
    status_name: STATUS_NAME[status],
    priority: (['p1', 'p2', 'p2', 'p3'] as const)[n % 4],
    position: null,
    assignee_id: assignee,
    created_by: assignee ?? PAW,
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
    created_at: Math.min(updatedAt, ago(40)) - n * HOUR,
    updated_at: updatedAt,
    started_at: null,
    completed_at: status === 'done' ? updatedAt : null,
    ...over,
  };
  tasks.push(t);
  return t;
}

/** A move between categories, as the server writes it (§4.8, LAI-739). */
function move(
  task: FixtureTask,
  actor: string,
  from: string,
  to: string,
  at: number,
  agent = false,
): void {
  events.push({
    id: `ev${String(events.length + 1)}`,
    type: 'task.status_changed',
    project_id: ONROUTE.id,
    task_id: task.id,
    actor_id: actor,
    actor_kind: agent ? 'agent' : 'user',
    actor_token_id: agent ? PAW_TOKEN : null,
    payload: {
      from,
      to,
      from_status_name: STATUS_NAME[from],
      to_status_name: STATUS_NAME[to],
    },
    created_at: at,
  });
}

/** Any other touch — the kind that bumps `updated_at` without moving the task. */
function touch(task: FixtureTask, actor: string, at: number): void {
  events.push({
    id: `ev${String(events.length + 1)}`,
    type: 'task.updated',
    project_id: ONROUTE.id,
    task_id: task.id,
    actor_id: actor,
    actor_kind: 'user',
    actor_token_id: null,
    payload: { field: 'sprint_id' },
    created_at: at,
  });
}

const blockWith = (blocked: FixtureTask, by: FixtureTask): void => {
  blocked.blocked_by.push(by.id);
  (by.blocks as string[]).push(blocked.id);
};

/* ── Open work touched in the last 7 days: the 52 the old card counted ─────── */

// Ashutosh, 24: 14 in review he delivered this week, 2 in progress, 6 to do,
// 2 backlog — and 7 of them blocked.
const ashReview = Array.from({ length: 14 }, (_, i) => {
  const at = ago(0.2 + i * 0.3);
  const t = addTask('review', ASH, at);
  move(t, ASH, 'in_progress', 'review', at);
  return t;
});
// One of the 14 went round twice: delivered, sent back by Pawan, delivered
// again. It is still one task delivered.
const twice = ashReview[0]!;
move(twice, ASH, 'in_progress', 'review', ago(6));
move(twice, PAW, 'review', 'in_progress', ago(5.5));

const ashProgress = [addTask('in_progress', ASH, ago(1)), addTask('in_progress', ASH, ago(2))];
const ashTodo = [
  addTask('todo', ASH, ago(3)),
  addTask('todo', ASH, ago(4)),
  addTask('todo', ASH, ago(5.5)),
  addTask('todo', ASH, ago(6)),
  addTask('todo', ASH, ago(6.4)),
  addTask('todo', ASH, ago(6.8)),
];
const ashBacklog = [addTask('backlog', ASH, ago(5.8)), addTask('backlog', ASH, ago(6.6))];

// Pawan, 6: one his agent delivered this week, still waiting for review.
const pawReview = addTask('review', PAW, ago(1.5));
move(pawReview, PAW, 'in_progress', 'review', ago(1.5), true);
const pawProgress = [addTask('in_progress', PAW, ago(0.5)), addTask('in_progress', PAW, ago(2.5))];
addTask('todo', PAW, ago(3.5));
addTask('backlog', PAW, ago(5.2), {});
addTask('backlog', PAW, ago(6.2));

// Sakshi, 7.
const sakProgress = [
  addTask('in_progress', SAK, ago(0.8)),
  addTask('in_progress', SAK, ago(1.8)),
  addTask('in_progress', SAK, ago(2.8)),
];
addTask('todo', SAK, ago(3.2));
addTask('todo', SAK, ago(4.2));
addTask('todo', SAK, ago(5.4));
addTask('todo', SAK, ago(6.9));

// Unassigned, 15.
for (const days of [0.6, 1.6, 2.6]) addTask('backlog', null, ago(days));
for (const days of [0.9, 1.9, 2.9, 3.9, 4.9]) addTask('todo', null, ago(days));
for (const days of [5.1, 5.3, 5.6, 5.9, 6.1, 6.3, 6.7]) addTask('backlog', null, ago(days));

/* ── Open work nobody touched this week: 249 more ──────────────────────────── */

// 37 waiting for review, delivered 7½–12 days ago (median about 8).
const quietReview = (owner: string, count: number, agent: boolean): FixtureTask[] =>
  Array.from({ length: count }, (_, i) => {
    const at = ago(7.5 + ((i * 7) % 10) * 0.5);
    const t = addTask('review', owner, at);
    move(t, owner, 'in_progress', 'review', at, agent);
    return t;
  });
quietReview(ASH, 20, false);
quietReview(PAW, 10, true);
quietReview(SAK, 7, false);

// 12 in progress, 7 of them flagged stale by the server's job (§11.6).
const flagged = [PAW, PAW, PAW, ASH, ASH, SAK, SAK].map((who, i) =>
  addTask('in_progress', who, ago(10 + i * 1.5), { stale_flagged_at: ago(2 + i * 0.5) }),
);
const quietProgress = [PAW, PAW, ASH, ASH, SAK].map((who, i) =>
  addTask('in_progress', who, ago(8 + i * 0.3)),
);

// 60 to do and 140 backlog, spread as OnRoute's are.
const spread = (status: string, owners: readonly (readonly [string | null, number])[]) =>
  owners.flatMap(([who, count]) =>
    Array.from({ length: count }, (_, i) => addTask(status, who, ago(8 + ((i * 13) % 50)))),
  );
const quietTodo = spread('todo', [
  [ASH, 14],
  [PAW, 20],
  [SAK, 6],
  [null, 20],
]);
const quietBacklog = spread('backlog', [
  [ASH, 4],
  [PAW, 40],
  [SAK, 10],
  [null, 86],
]);

// Two open tasks have a due date: one in three days, one two days late.
quietTodo[0]!.due_on = TODAY + 3 * DAY;
quietTodo[1]!.due_on = TODAY - 2 * DAY;

/* ── Blocked: 11 to do or in progress, 19 backlog waiting on backlog ──────── */

// Ashutosh's 7: five of his to do and both his backlog, each on unfinished work.
for (const t of ashTodo.slice(0, 5)) blockWith(t, ashProgress[0]!);
blockWith(ashBacklog[0]!, quietBacklog[0]!);
blockWith(ashBacklog[1]!, quietBacklog[1]!);
// Six more to do, waiting on work in progress.
for (const [i, t] of quietTodo.slice(2, 8).entries()) {
  blockWith(t, [...pawProgress, ...sakProgress, ...quietProgress][i]!);
}
// Seventeen more backlog chains: backlog waiting on backlog.
for (let i = 0; i < 17; i += 1) blockWith(quietBacklog[10 + i]!, quietBacklog[40 + i]!);

/* ── Finished work, and who moved it ───────────────────────────────────────── */

/** Delivered into review by `who`, then closed by `closer` some hours later. */
function deliveredAndClosed(
  who: string,
  closer: string,
  deliveredAt: number,
  agent: boolean,
): void {
  const closedAt = deliveredAt + 6 * HOUR;
  const t = addTask('done', who, closedAt);
  move(t, who, 'in_progress', 'review', deliveredAt, agent);
  move(t, closer, 'review', 'done', closedAt);
}

/** Moved straight to done by `who` — a self-close, done without review. */
function selfClosed(who: string, at: number, agent: boolean): void {
  const t = addTask('done', who, at);
  move(t, who, 'in_progress', 'done', at, agent);
}

// This week: Ashutosh delivers nine more that Pawan reviews; Pawan's agent
// delivers one Sakshi reviews; Pawan closes one of his own without review.
for (let i = 0; i < 9; i += 1) deliveredAndClosed(ASH, PAW, ago(1 + i * 0.6), false);
deliveredAndClosed(PAW, SAK, ago(3), true);
selfClosed(PAW, ago(2.2), false);

// The three weeks before: Pawan's agents carry most of it.
for (let i = 0; i < 25; i += 1) selfClosed(PAW, ago(8 + (i % 21)), true);
for (let i = 0; i < 50; i += 1) deliveredAndClosed(PAW, ASH, ago(8 + (i % 21) + 0.1), true);
for (let i = 0; i < 80; i += 1) deliveredAndClosed(PAW, PAW, ago(8 + (i % 21) + 0.2), true);
for (let i = 0; i < 43; i += 1) deliveredAndClosed(ASH, PAW, ago(8 + (i % 21) + 0.3), false);
for (let i = 0; i < 9; i += 1) deliveredAndClosed(SAK, ASH, ago(8 + (i % 21) + 0.4), false);

// Long ago, before anyone measured: four cancelled.
for (let i = 0; i < 4; i += 1) addTask('cancelled', null, ago(60 + i));

// Every open task touched in the last 30 days has the touch on record.
for (const t of tasks) {
  const moved = events.some((e) => e.task_id === t.id && e.created_at === t.updated_at);
  if (!moved && t.updated_at >= ago(30) && t.status !== 'cancelled') {
    touch(t, t.assignee_id ?? PAW, t.updated_at);
  }
}

export const TASKS: readonly FixtureTask[] = tasks;

/** Newest first, as the endpoint answers; `seq` rises with time. */
export const EVENTS: readonly FixtureEvent[] = [...events]
  .sort((a, b) => a.created_at - b.created_at)
  .map((e, i) => ({ ...e, seq: i + 1 }))
  .reverse();

/** The groups' sums, for the tests and the screenshots to check against. */
export const EXPECTED = {
  open: 301,
  touchedOpen7d: 52,
  delivered7d: { [ASH]: 23, [PAW]: 3 },
  delivered30d: { [PAW]: 168, [ASH]: 86, [SAK]: 16 },
  /** Pawan: nine closes and one send-back; Sakshi: one close. */
  reviewed7d: { [PAW]: 10, [SAK]: 1 },
  reviewed30d: { [PAW]: 53, [ASH]: 59, [SAK]: 1 },
  selfClosed7d: { [PAW]: 1 },
  selfClosed30d: { [PAW]: 26 },
  staleFlagged: flagged.length,
  oldStale: 266,
  reviewOver5d: 37,
  blockedCommitted: 11,
  blockedBacklog: 19,
  dated: 2,
} as const;

/** Throughput as `/metrics` sums it: done per UTC day since `since`. */
function metricsFor(since: number) {
  const days = Math.ceil((NOW - since) / DAY) + 1;
  const throughput = Array.from({ length: days }, (_, i) => {
    const start = TODAY - (days - 1 - i) * DAY;
    return {
      day: new Date(start).toISOString().slice(0, 10),
      completed: tasks.filter(
        (t) =>
          t.status === 'done' &&
          (t.completed_at as number) >= Math.max(start, since) &&
          (t.completed_at as number) < start + DAY,
      ).length,
    };
  });
  return {
    since,
    throughput,
    cycle_time: { measured: 40, unmeasured: 0, p50_ms: 2 * DAY, p75_ms: 4 * DAY, p90_ms: 8 * DAY },
  };
}

/**
 * `activity` and `metrics` answer for the range asked, as the server does.
 *
 * The stub's functions see only the path, and both answers depend on
 * `?since=`; a route ahead of the stub reads it. **Call `page.unrouteAll`
 * before closing** — a route still fulfilling fails the run while every
 * assertion is green.
 */
export async function routeRanged(page: Page): Promise<void> {
  const sinceOf = (route: Route): number | undefined => {
    const raw = new URL(route.request().url()).searchParams.get('since');
    return raw === null ? undefined : Number(raw);
  };
  await page.route('**/api/v1/projects/onroute/activity**', async (route) => {
    const since = sinceOf(route);
    await route.fulfill({
      json: {
        data: EVENTS.filter((e) => since === undefined || e.created_at >= since),
        next_cursor: null,
      },
    });
  });
  await page.route('**/api/v1/projects/onroute/metrics**', async (route) => {
    await route.fulfill({ json: metricsFor(sinceOf(route) ?? NOW - 30 * DAY) });
  });
}

export function onrouteStub(): ApiStub {
  const counts = Object.fromEntries(
    ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'].map((s) => [
      s,
      tasks.filter((t) => t.status === s).length,
    ]),
  );
  return {
    '/api/v1/me': {
      id: PAW,
      email: 'pawan@example.com',
      name: 'Pawan',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: ONROUTE.id, role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...ONROUTE,
          task_counts: counts,
          blocked_count: 30,
          member_count: 3,
          members: [],
          last_activity_at: NOW,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/onroute': ONROUTE,
    '/api/v1/projects/onroute/tasks': () => ({
      data: tasks.map((t) => ({ ...t })),
      next_cursor: null,
    }),
    '/api/v1/projects/onroute/members': {
      members: [ASH, PAW, SAK].map((id) => ({
        user_id: id,
        name: NAMES[id],
        email: `${id}@example.com`,
        role: id === PAW ? 'lead' : 'member',
        created_at: 1,
      })),
    },
    '/api/v1/projects/onroute/mentionable': {
      users: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
    },
    '/api/v1/projects/onroute/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/onroute/tags': { tags: [] },
    '/api/v1/projects/onroute/meeting-reviews': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o',
      name: 'Kvell Dynamics',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}
