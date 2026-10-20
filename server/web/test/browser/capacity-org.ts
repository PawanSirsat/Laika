/**
 * An org shaped like the owner's (LAI-767): five people, three of them never
 * seen, and an owner with seven tasks in progress and two agents running.
 *
 * Served as `GET /capacity` would serve it **to the reader it is built for**:
 * an owner gets the profile kind, the 14-day series, every agent on a usable
 * token and the unlisted ids; a member gets none of them, as the server
 * withholds them (LAI-767's server tests hold that half).
 */

import type { ApiStub } from './harness.ts';

/** The browser's clock and the fixture's agree, so "23 min" reads as 23 min. */
export const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;

export const LAIKA = {
  id: 'p1',
  slug: 'laika',
  name: 'Laika',
  prefix: 'LAI',
  description: null,
  repo: 'PawanSirsat/Laika',
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 3, in_progress: 6, review: 2, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 5,
  members: [],
  last_activity_at: 2,
};

export const ONROUTE = {
  ...LAIKA,
  id: 'p2',
  slug: 'onroute',
  name: 'Onroute',
  prefix: 'ONR',
  repo: 'kvell/onroute',
};

export function task(
  id: string,
  key: string,
  title: string,
  status: string,
  project: { id: string } = LAIKA,
  assignee = 'u1',
) {
  return {
    id,
    key,
    project_id: project.id,
    number: Number(key.split('-')[1]),
    title,
    description_md: null,
    acceptance_md: null,
    status,
    priority: 'p2',
    assignee_id: assignee,
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    ready: false,
    stale_flagged_at: null,
    blocked: false,
    blocked_by: [],
    blocks: [],
    tags: [],
    comment_count: 0,
    branch: null,
    external_ref: null,
    started_at: NOW - 5 * 3600000,
    completed_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

/** Pawan's seven in progress, two of them in Onroute, and Bea's one. */
export const TASKS = [
  task('t1', 'LAI-9', 'Parity tests for the MCP tools', 'in_progress'),
  task('t2', 'LAI-12', 'Heartbeat retention job', 'in_progress'),
  task('t3', 'LAI-15', 'Rate limit headers', 'in_progress'),
  task('t4', 'LAI-18', 'Capacity redesign', 'in_progress'),
  task('t5', 'LAI-21', 'Review gate follow-ups', 'in_progress'),
  task('t6', 'ONR-356', 'Route planner caches its tiles', 'in_progress', ONROUTE),
  task('t7', 'ONR-360', 'Driver app offline queue', 'in_progress', ONROUTE),
  task('t10', 'LAI-40', 'Members screen sorts by last seen', 'in_progress', LAIKA, 'u2'),
];

const zero = {
  in_progress: 0,
  todo: 0,
  backlog: 0,
  in_review: 0,
  committed: 0,
  overdue: 0,
  due_soon: 0,
  open: 0,
};

/** Counts as the server builds them (LAI-818): committed and open follow from the parts. */
function counts(over: Partial<typeof zero>): typeof zero {
  const w = { ...zero, ...over };
  return {
    ...w,
    committed: w.in_progress + w.todo,
    open: w.in_progress + w.todo + w.backlog + w.in_review,
  };
}

/** One space, with its own load as the server decides it (D-092). */
const space = (project: typeof LAIKA, load: string, over: Partial<typeof zero>) => ({
  project_id: project.id,
  slug: project.slug,
  name: project.name,
  ...counts(over),
  load,
});

type Reader = 'owner' | 'member';

type Served = { readonly user_id: string } & Record<string, unknown>;

/** One person as the server serves them to `reader`. */
function person(
  reader: Reader,
  base: Served,
  admin: {
    profile_kind: string;
    activity_14d: number[];
    activity_14d_split: { by_self: number; by_agents: number; bookkeeping: number };
    unlisted: string[];
  },
  agents: { client: string; running: boolean; last_at: number | null }[],
): Served {
  const visible = reader === 'owner' ? agents : agents.filter((a) => a.running);
  return reader === 'owner' ? { ...base, agents: visible, ...admin } : { ...base, agents: visible };
}

export function capacityFor(reader: Reader) {
  return {
    enabled: true,
    people: [
      person(
        reader,
        {
          user_id: 'u1',
          name: 'Pawan Sirsat',
          email: 'pawan@kvelld.example',
          org_role: 'owner',
          active_sessions: 2,
          in_progress_tasks: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'],
          oldest_in_progress_ms: 3 * DAY,
          tasks_in_review: ['t8', 't9'],
          last_seen: NOW - 40_000,
          last_seen_via: 'agent',
          status: 'online',
          // Heavy across every space (7 in progress), Normal in Laika and
          // Light in Onroute: the per-space badge has something to show.
          workload: counts({
            in_progress: 7,
            todo: 3,
            backlog: 12,
            in_review: 2,
            overdue: 1,
            due_soon: 2,
          }),
          load: 'heavy',
          spaces: [
            space(LAIKA, 'normal', {
              in_progress: 5,
              todo: 3,
              backlog: 12,
              in_review: 1,
              overdue: 1,
              due_soon: 1,
            }),
            space(ONROUTE, 'light', { in_progress: 2, in_review: 1, due_soon: 1 }),
          ],
        },
        {
          profile_kind: 'builder',
          activity_14d: [3, 5, 0, 0, 8, 12, 6, 4, 9, 0, 0, 11, 14, 7],
          // 79 in all: the three parts of the same fortnight.
          activity_14d_split: { by_self: 21, by_agents: 40, bookkeeping: 18 },
          unlisted: ['n1'],
        },
        [
          { client: 'claude-code', running: true, last_at: NOW - 40_000 },
          { client: 'codex', running: true, last_at: NOW - 2 * MIN },
          { client: 'cursor', running: false, last_at: NOW - 3 * DAY },
        ],
      ),
      person(
        reader,
        {
          user_id: 'u2',
          name: 'Bea Nkosi',
          email: 'bea@kvelld.example',
          org_role: 'member',
          active_sessions: 0,
          in_progress_tasks: ['t10'],
          oldest_in_progress_ms: 2 * DAY,
          tasks_in_review: ['t11'],
          last_seen: NOW - 23 * MIN,
          last_seen_via: 'board',
          status: 'away',
          workload: counts({ in_progress: 1, in_review: 1, todo: 2, due_soon: 1 }),
          load: 'light',
          spaces: [space(LAIKA, 'light', { in_progress: 1, in_review: 1, todo: 2, due_soon: 1 })],
        },
        {
          profile_kind: 'manager',
          activity_14d: [0, 2, 1, 0, 0, 3, 0, 0, 1, 2, 0, 0, 4, 1],
          activity_14d_split: { by_self: 14, by_agents: 0, bookkeeping: 0 },
          unlisted: [],
        },
        [{ client: 'claude-code', running: false, last_at: NOW - 2 * DAY }],
      ),
      ...(
        [
          ['u3', 'Cal Mokoena', 'cal@kvelld.example', []],
          ['u4', 'Dee Pillay', 'dee@kvelld.example', [space(ONROUTE, 'light', { todo: 2 })]],
          ['u5', 'Eli van Wyk', 'eli@kvelld.example', []],
        ] as const
      ).map(([id, name, email, spaces]) =>
        person(
          reader,
          {
            user_id: id,
            name,
            email,
            org_role: 'member',
            active_sessions: 0,
            in_progress_tasks: [],
            oldest_in_progress_ms: null,
            tasks_in_review: [],
            last_seen: null,
            last_seen_via: null,
            status: 'never',
            workload: id === 'u4' ? counts({ todo: 2 }) : { ...zero },
            load: id === 'u4' ? 'light' : 'none',
            spaces,
          },
          {
            profile_kind: 'builder',
            activity_14d: Array<number>(14).fill(0),
            activity_14d_split: { by_self: 0, by_agents: 0, bookkeeping: 0 },
            unlisted: [],
          },
          [],
        ),
      ),
    ],
  };
}

export const PRESENCE = {
  enabled: true,
  present: [
    {
      user_id: 'u1',
      name: 'Pawan Sirsat',
      repo: 'PawanSirsat/Laika',
      branch: 'lai-9-parity',
      matched_task_id: 't1',
      project_ids: ['p1'],
      is_agent: true,
      client: 'claude-code',
      clients: ['claude-code', 'codex'],
      last_seen: NOW - 40_000,
    },
  ],
};

const ME = {
  owner: {
    id: 'u1',
    email: 'pawan@kvelld.example',
    name: 'Pawan Sirsat',
    org_role: 'owner',
    is_active: true,
    memberships: [
      { project_id: 'p1', role: 'lead' },
      { project_id: 'p2', role: 'lead' },
    ],
  },
  member: {
    id: 'u2',
    email: 'bea@kvelld.example',
    name: 'Bea Nkosi',
    org_role: 'member',
    is_active: true,
    memberships: [
      { project_id: 'p1', role: 'member' },
      { project_id: 'p2', role: 'member' },
    ],
  },
};

/** Everything `/capacity` asks for, as `reader` would be answered. */
export function orgStub(reader: Reader): ApiStub {
  const stub: Record<string, unknown> = {
    '/api/v1/me': ME[reader],
    '/api/v1/projects': { data: [LAIKA, ONROUTE], next_cursor: null },
    '/api/v1/projects/laika': LAIKA,
    '/api/v1/projects/onroute': ONROUTE,
    '/api/v1/presence': PRESENCE,
    '/api/v1/capacity': capacityFor(reader),
    // Three waiting, for the tile; only the count is read on this page.
    '/api/v1/review': {
      tasks: ['t8', 't9', 't11'].map((id) => ({ task: { id }, waiting_since: NOW - DAY })),
      truncated: false,
    },
  };
  for (const t of TASKS) stub[`/api/v1/tasks/${t.id}`] = t;
  if (reader === 'owner') {
    stub['/api/v1/unlisted'] = {
      data: [
        {
          id: 'n1',
          user_id: 'u1',
          token_id: 'tok1',
          repo: 'PawanSirsat/Laika',
          note: 'The migration runner logs a warning nobody reads.',
          promoted_task_id: null,
          dismissed_at: null,
          created_at: NOW - 3600000,
        },
      ],
      next_cursor: null,
    };
  }
  return stub;
}

/**
 * One `GET /capacity` entry with the LAI-767 fields filled for a person with
 * no open work and no signal — for a test about something else that only
 * needs a person on the page. Pass what the test is about.
 */
export function capacityPerson(
  over: { readonly user_id: string; readonly name: string } & Record<string, unknown>,
): Served {
  return {
    email: `${over.user_id}@example.test`,
    org_role: 'member',
    active_sessions: 0,
    in_progress_tasks: [],
    oldest_in_progress_ms: null,
    tasks_in_review: [],
    last_seen: null,
    last_seen_via: null,
    status: 'never',
    workload: { ...zero },
    load: 'none',
    spaces: [],
    agents: [],
    ...over,
  };
}
