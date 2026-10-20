/**
 * A week of My day as the API serves it (LAI-831): **today** drafted — blocks
 * on a card, on General, on nothing, one naming a card the reader cannot see,
 * an agent's proposal with no set time — with confirmed time between them;
 * **yesterday** and the day before that's settled; a day with **no signal**;
 * and the days after today **not yet**.
 *
 * The days are computed at run time in UTC (CONVENTIONS: a fixture may not be
 * pinned to the calendar), so today's now line is drawn. Every view is keyed by
 * its `?day=`, and every view carries the same week around it, as the server
 * does.
 */

import type { ApiStub } from './harness.ts';

const DAY_MS = 86_400_000;

export const TODAY = new Date().toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const YESTERDAY = addDays(TODAY, -1);
export const QUIET = addDays(TODAY, -2);
export const EARLIER = addDays(TODAY, -3);
export const TOMORROW = addDays(TODAY, 1);

/** Unix ms of `h:mm` UTC on `day`. */
export const at = (day: string, h: number, m = 0): number =>
  Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60_000;

export const ATLAS = { id: 'p1', slug: 'atlas', name: 'Atlas' };
export const CARD_A = { id: 't11', key: 'LAI-11', title: 'Search matches keys' };
export const CARD_B = { id: 't12', key: 'LAI-12', title: 'Webhook retries back off' };
export const CARD_C = { id: 't13', key: 'LAI-13', title: 'Empty states for every list' };

const signals = (prompts: number, sessions: number, commits: number, marks = 0) => ({
  prompts,
  replies: prompts * 2,
  sessions,
  commits,
  marks,
});

export type Draft = Record<string, unknown> & { readonly id: string; readonly minutes: number };
export type Entry = Record<string, unknown> & { readonly id: string; readonly minutes: number };

function draft(
  id: string,
  day: string,
  from: [number, number] | null,
  minutes: number,
  extra: Record<string, unknown>,
): Draft {
  const started = from === null ? null : at(day, from[0], from[1]);
  return {
    id,
    source: 'collector',
    day,
    tz: 'UTC',
    started_at: started,
    ended_at: started === null ? null : started + minutes * 60_000,
    minutes,
    task: null,
    task_key: null,
    project: null,
    general: false,
    signals: signals(0, 0, 0),
    note: null,
    ...extra,
  };
}

function entry(
  id: string,
  day: string,
  from: [number, number] | null,
  minutes: number,
  extra: Record<string, unknown>,
): Entry {
  const started = from === null ? null : at(day, from[0], from[1]);
  return {
    id,
    day,
    tz: 'UTC',
    started_at: started,
    ended_at: started === null ? null : started + minutes * 60_000,
    minutes,
    source: 'draft',
    task: null,
    project: null,
    note: null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
    ...extra,
  };
}

/** Today: five drafted blocks and two confirmed entries, with gaps between. */
export function todayDrafts(): Draft[] {
  return [
    draft('d1', TODAY, [8, 40], 95, {
      task: CARD_A,
      project: ATLAS,
      signals: signals(18, 2, 3),
    }),
    draft('d2', TODAY, [10, 40], 40, { signals: signals(6, 1, 0) }),
    draft('d3', TODAY, [13, 0], 110, {
      task: CARD_C,
      project: ATLAS,
      signals: signals(22, 3, 4, 1),
    }),
    draft('d4', TODAY, [15, 30], 40, { task_key: 'SEC-9', signals: signals(5, 1, 1) }),
    draft('d5', TODAY, null, 25, {
      source: 'agent',
      task: CARD_B,
      project: ATLAS,
      note: 'Reviewed the retry backoff',
    }),
  ];
}

export function todayEntries(): Entry[] {
  return [
    entry('e1', TODAY, [11, 30], 30, { source: 'manual', note: 'Planning call' }),
    entry('e2', TODAY, [12, 0], 30, { task: CARD_B, project: ATLAS, revision: 2 }),
  ];
}

const settledEntries = (day: string): Entry[] => [
  entry(`${day}-1`, day, [9, 0], 150, { task: CARD_A, project: ATLAS }),
  entry(`${day}-2`, day, [12, 0], 45, { source: 'manual', note: 'Design review' }),
  entry(`${day}-3`, day, [13, 30], 180, { task: CARD_C, project: ATLAS, revision: 3 }),
  entry(`${day}-4`, day, [16, 45], 75, { task: CARD_B, project: ATLAS }),
];

const sum = (list: readonly { minutes: number }[]): number =>
  list.reduce((n, x) => n + x.minutes, 0);

interface DayData {
  readonly drafts: Draft[];
  readonly entries: Entry[];
}

/** What each day holds; anything not named is empty. */
export function weekData(): Map<string, DayData> {
  return new Map([
    [TODAY, { drafts: todayDrafts(), entries: todayEntries() }],
    [YESTERDAY, { drafts: [], entries: settledEntries(YESTERDAY) }],
    [EARLIER, { drafts: [], entries: settledEntries(EARLIER) }],
  ]);
}

function stateOf(day: string, data: DayData | undefined): string {
  if (data !== undefined && data.drafts.length > 0) return 'drafted';
  if (data !== undefined && data.entries.length > 0) return 'confirmed';
  return day > TODAY ? 'future' : 'no_signal';
}

function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export const SETTINGS = {
  org_mode: 'drafts',
  draft_my_time: true,
  drafting: true,
  min_sync_interval_s: 300,
};

export const AGENT = {
  minutes: 112,
  keyboard_minutes: 38,
  by_task: [
    { task: CARD_A, minutes: 45 },
    { task: CARD_C, minutes: 41 },
  ],
  unattributed_minutes: 26,
};

const NO_AGENT = { minutes: 0, keyboard_minutes: 0, by_task: [], unattributed_minutes: 0 };

/** `GET /me/time?day=` for `day`, from `data`. */
export function viewOf(day: string, data: Map<string, DayData> = weekData()): unknown {
  const own = data.get(day);
  const monday = mondayOf(day);
  const held = [...data.values()].flatMap((d) => d.drafts);
  return {
    day,
    tz: 'UTC',
    today: TODAY,
    settings: SETTINGS,
    drafts: own?.drafts ?? [],
    entries: own?.entries ?? [],
    breaks: [],
    drafts_held: { count: held.length, minutes: sum(held) },
    agent: day === TODAY ? AGENT : NO_AGENT,
    state: stateOf(day, own),
    week: Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      const w = data.get(d);
      return {
        day: d,
        confirmed_minutes: sum(w?.entries ?? []),
        drafted_minutes: sum(w?.drafts ?? []),
        state: stateOf(d, w),
      };
    }),
  };
}

function task(id: string, key: string, title: string, status: string, blockedBy: string[] = []) {
  return {
    id,
    key,
    title,
    status,
    status_id: `st-${status}`,
    status_name: status,
    project_id: 'p1',
    number: Number(key.slice(4)),
    priority: 'p2',
    assignee_id: 'u1',
    blocked_by: blockedBy,
    blocks: [],
    updated_at: 5,
  };
}

/**
 * Everything My day reads, for three weeks either side of today: the person,
 * their spaces and their own open work, and one review waiting on them.
 */
export function weekStub(data: Map<string, DayData> = weekData()): ApiStub {
  const days: Record<string, unknown> = {};
  for (let i = -21; i <= 21; i += 1) {
    const day = addDays(TODAY, i);
    days[`/api/v1/me/time?day=${day}`] = () => viewOf(day, data);
  }
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    ...days,
    '/api/v1/projects': {
      data: [
        {
          id: 'p1',
          slug: 'atlas',
          prefix: 'LAI',
          name: 'Atlas',
          archived_at: null,
          task_counts: { backlog: 0, todo: 1, in_progress: 3, review: 0, done: 0, cancelled: 0 },
          member_count: 1,
          members: [],
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/atlas/tasks?assignee=u1&status=in_progress': {
      data: [
        task(CARD_A.id, CARD_A.key, CARD_A.title, 'in_progress'),
        task(CARD_B.id, CARD_B.key, CARD_B.title, 'in_progress'),
        task(CARD_C.id, CARD_C.key, CARD_C.title, 'in_progress'),
      ],
      next_cursor: null,
    },
    '/api/v1/projects/atlas/tasks?assignee=u1&status=todo': {
      data: [task('t14', 'LAI-14', 'Import from Solidtime', 'todo', ['t19'])],
      next_cursor: null,
    },
    '/api/v1/tasks/t19': task('t19', 'LAI-19', 'Solidtime client', 'in_progress'),
    '/api/v1/review': {
      tasks: [
        {
          task: task('t15', 'LAI-15', 'Capacity reads the org', 'review'),
          project: { id: 'p1', slug: 'atlas', name: 'Atlas', prefix: 'LAI' },
          assignee_name: null,
          waiting_since: 1,
          round: {
            ci: { head_sha: 'a', total: 2, passed: 2, failed: 0, pending: 0, failed_names: [] },
          },
          finished_by_name: null,
          can_decide: true,
          cue: null,
        },
      ],
      truncated: false,
    },
  };
}
