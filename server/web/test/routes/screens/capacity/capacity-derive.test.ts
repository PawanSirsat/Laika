/**
 * Capacity's derivations (LAI-439, redesigned by LAI-767).
 *
 * Every one of these is about **presentation**. The status, last seen, the
 * workload counts and the load badge arrive decided by the server — so what is
 * tested here is which people are shown, in what order, and how it is said.
 * `now` is passed in everywhere, so every edge is fixed.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  barSegments,
  loadIn,
  matchesQuery,
  oldestAge,
  passesFilter,
  sortPeople,
  statusText,
  summarize,
  taskIdsToResolve,
  teamLoad,
  workloadIn,
} from '../../../../src/routes/screens/capacity/capacity-derive.ts';
import type {
  CapacityEntry,
  CapacitySpace,
  CapacityWorkload,
} from '../../../../src/api/presence.ts';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

const ZERO: CapacityWorkload = {
  in_progress: 0,
  todo: 0,
  backlog: 0,
  in_review: 0,
  committed: 0,
  overdue: 0,
  due_soon: 0,
  open: 0,
};

function person(over: Partial<CapacityEntry> & { user_id: string }): CapacityEntry {
  return {
    name: over.user_id,
    email: `${over.user_id}@example.test`,
    org_role: 'member',
    active_sessions: 0,
    in_progress_tasks: [],
    oldest_in_progress_ms: null,
    tasks_in_review: [],
    last_seen: null,
    last_seen_via: null,
    status: 'never',
    workload: ZERO,
    load: 'none',
    spaces: [],
    agents: [],
    ...over,
  };
}

/** Counts as the server builds them: committed and open follow from the parts. */
const work = (over: Partial<CapacityWorkload>): CapacityWorkload => {
  const w = { ...ZERO, ...over };
  return {
    ...w,
    committed: w.in_progress + w.todo,
    open: w.in_progress + w.todo + w.backlog + w.in_review,
  };
};

/** One space, as the server sends it: its counts and its own load. */
const space = (
  project_id: string,
  load: CapacitySpace['load'],
  over: Partial<CapacityWorkload>,
): CapacitySpace => ({ project_id, slug: project_id, name: project_id, load, ...work(over) });

void describe('oldestAge', () => {
  void test('null in, undefined out — no age is not an age of zero', () => {
    assert.equal(oldestAge(null), undefined);
  });

  void test('reads in the unit a person would use, never negative', () => {
    assert.equal(oldestAge(30_000), 'just now');
    assert.equal(oldestAge(40 * MIN), '40 min');
    assert.equal(oldestAge(5 * HOUR), '5 h');
    assert.equal(oldestAge(5 * HOUR + 20 * MIN), '5 h 20 min');
    assert.equal(oldestAge(3 * DAY), '3 d');
    assert.equal(oldestAge(3 * DAY + 4 * HOUR), '3 d 4 h');
    assert.equal(oldestAge(-5_000), 'just now');
  });
});

void describe('matchesQuery — the search', () => {
  const bea = person({ user_id: 'u2', name: 'Béa Nkosi', email: 'bea@kvelld.example' });

  void test('finds by name or email, every word, ignoring case and accents', () => {
    assert.equal(matchesQuery(bea, ''), true);
    assert.equal(matchesQuery(bea, 'bea'), true);
    assert.equal(matchesQuery(bea, 'BEA nk'), true);
    assert.equal(matchesQuery(bea, 'kvelld'), true);
    assert.equal(matchesQuery(bea, 'bea pillay'), false);
    assert.equal(matchesQuery(bea, 'cal'), false);
  });
});

void describe('passesFilter — each chip', () => {
  const online = person({
    user_id: 'on',
    status: 'online',
    load: 'heavy',
    workload: work({ in_progress: 7, overdue: 1 }),
    agents: [{ client: 'codex', running: true, last_at: NOW }],
  });
  const away = person({
    user_id: 'away',
    status: 'away',
    load: 'light',
    workload: work({ todo: 1 }),
    agents: [{ client: 'cursor', running: false, last_at: NOW - DAY }],
  });
  const never = person({ user_id: 'never' });

  const pass = (filter: Parameters<typeof passesFilter>[1]) =>
    [online, away, never].filter((p) => passesFilter(p, filter, null)).map((p) => p.user_id);

  void test('All, Online now, Agents running, Heavy, Overdue, No work, Never seen', () => {
    assert.deepEqual(pass('all'), ['on', 'away', 'never']);
    assert.deepEqual(pass('online'), ['on']);
    // An agent they use and are not running is not "running".
    assert.deepEqual(pass('agents'), ['on']);
    assert.deepEqual(pass('heavy'), ['on']);
    assert.deepEqual(pass('overdue'), ['on']);
    assert.deepEqual(pass('none'), ['never']);
    assert.deepEqual(pass('never'), ['never']);
  });

  void test('Overdue and No work read the chosen space', () => {
    const split = person({
      user_id: 'split',
      workload: work({ todo: 2, overdue: 1 }),
      spaces: [space('p1', 'light', { todo: 1, overdue: 1 }), space('p2', 'light', { todo: 1 })],
    });
    assert.equal(passesFilter(split, 'overdue', 'p1'), true);
    assert.equal(passesFilter(split, 'overdue', 'p2'), false);
    assert.equal(passesFilter(split, 'none', 'p3'), true);
    assert.deepEqual(workloadIn(split, 'p3'), ZERO);
  });

  // D-092 item 3: a badge shown while a space is selected is that space's load
  // (LAI-818). The server sends each space's load; the web reads it.
  void test('Heavy load reads the chosen space’s load, not the global one', () => {
    const pawan = person({
      user_id: 'pawan',
      load: 'heavy',
      workload: work({ in_progress: 7, todo: 3 }),
      spaces: [
        space('laika', 'normal', { in_progress: 5, todo: 3 }),
        space('onroute', 'light', { in_progress: 2 }),
      ],
    });
    assert.equal(passesFilter(pawan, 'heavy', null), true);
    assert.equal(passesFilter(pawan, 'heavy', 'laika'), false);
    assert.equal(passesFilter(pawan, 'heavy', 'onroute'), false);
    assert.equal(loadIn(pawan, null), 'heavy');
    assert.equal(loadIn(pawan, 'laika'), 'normal');
    assert.equal(loadIn(pawan, 'onroute'), 'light');
    // No work in that space is no load there.
    assert.equal(loadIn(pawan, 'elsewhere'), 'none');

    const heavyHere = person({
      user_id: 'cal',
      load: 'heavy',
      workload: work({ in_progress: 7 }),
      spaces: [space('laika', 'heavy', { in_progress: 7 })],
    });
    assert.equal(passesFilter(heavyHere, 'heavy', 'laika'), true);
  });
});

void describe('sortPeople', () => {
  const people = [
    person({ user_id: 'cal', name: 'Cal', status: 'never' }),
    person({
      user_id: 'bea',
      name: 'Bea',
      status: 'away',
      last_seen: NOW - 23 * MIN,
      load: 'light',
      workload: work({ in_progress: 1 }),
    }),
    person({
      user_id: 'pawan',
      name: 'Pawan',
      status: 'online',
      last_seen: NOW - 40_000,
      load: 'heavy',
      workload: work({ in_progress: 7 }),
    }),
    person({
      user_id: 'ada',
      name: 'Ada',
      status: 'offline',
      last_seen: NOW - 2 * HOUR,
      load: 'normal',
      workload: work({ in_progress: 3 }),
    }),
  ];
  const ids = (sort: Parameters<typeof sortPeople>[1]) =>
    sortPeople(people, sort, null).map((p) => p.user_id);

  void test('online first, then away, offline, never seen', () => {
    assert.deepEqual(ids('online'), ['pawan', 'bea', 'ada', 'cal']);
  });

  void test('heaviest load first, by the server’s badge', () => {
    assert.deepEqual(ids('load'), ['pawan', 'ada', 'bea', 'cal']);
  });

  void test('in a space, by that space’s load, and overdue does not make anyone heavier', () => {
    const inSpace = [
      person({
        user_id: 'late',
        load: 'heavy',
        workload: work({ in_progress: 9, todo: 1, overdue: 4 }),
        spaces: [space('p1', 'light', { todo: 1, overdue: 4 })],
      }),
      person({
        user_id: 'busy',
        load: 'normal',
        workload: work({ in_progress: 4 }),
        spaces: [space('p1', 'normal', { in_progress: 4 })],
      }),
    ];
    assert.deepEqual(
      sortPeople(inSpace, 'load', 'p1').map((p) => p.user_id),
      ['busy', 'late'],
    );
    assert.deepEqual(
      sortPeople(inSpace, 'load', null).map((p) => p.user_id),
      ['late', 'busy'],
    );
  });

  void test('by name, and by last seen with never seen last', () => {
    assert.deepEqual(ids('name'), ['ada', 'bea', 'cal', 'pawan']);
    assert.deepEqual(ids('seen'), ['pawan', 'bea', 'ada', 'cal']);
  });
});

void describe('statusText — words, not only a colour', () => {
  void test('online, away with minutes, last seen, never, and presence off', () => {
    const at = (status: CapacityEntry['status'], ago: number | null) =>
      statusText(
        person({
          user_id: 'u',
          status,
          last_seen: ago === null ? null : NOW - ago,
          last_seen_via: ago === null ? null : 'board',
        }),
        NOW,
      );
    assert.equal(at('online', 40_000).text, 'Online now');
    assert.equal(at('away', 23 * MIN).text, 'Away · 23 min');
    assert.equal(at('away', 75 * MIN).text, 'Away · 1 h 15 min');
    assert.equal(at('offline', 2 * HOUR).text, 'Last seen 2 h ago');
    assert.equal(at('never', null).text, 'Never seen');
    assert.equal(at(null, null).text, 'Presence is off');
    // The tooltip carries the absolute time and what the signal was.
    assert.match(
      at('offline', 2 * HOUR).title ?? '',
      /2026, \d{1,2}:\d\d:\d\d [AP]M · a board action$/,
    );
  });
});

void describe('bars and figures', () => {
  void test('the stacked bar leaves out empty parts and scales to its widest', () => {
    const parts = barSegments(work({ in_progress: 2, todo: 2 }), 8);
    assert.deepEqual(
      parts.map((p) => [p.key, p.n, p.pct]),
      [
        ['in_progress', 2, 25],
        ['todo', 2, 25],
      ],
    );
    assert.deepEqual(barSegments(ZERO, 0), []);
  });

  void test('the tiles sum what the server sent', () => {
    const sum = summarize(
      [
        person({
          user_id: 'a',
          status: 'online',
          active_sessions: 2,
          workload: work({ in_progress: 7, overdue: 1 }),
        }),
        person({ user_id: 'b', status: 'away', workload: work({ in_progress: 1 }) }),
      ],
      null,
    );
    assert.deepEqual(sum, { online: 1, sessions: 2, inProgress: 8, overdue: 1 });
  });

  void test('team load is everyone with committed work, heaviest first, and a count of the rest', () => {
    const load = teamLoad(
      [
        person({ user_id: 'light', load: 'light', workload: work({ todo: 2 }) }),
        person({ user_id: 'idle' }),
        person({ user_id: 'heavy', load: 'heavy', workload: work({ in_progress: 7, todo: 5 }) }),
        // D-092: review waits on the reviewer and backlog is the pipeline, so
        // a person with only those has nothing committed (LAI-818).
        person({ user_id: 'waiting', workload: work({ in_review: 100, backlog: 209 }) }),
      ],
      null,
    );
    assert.deepEqual(
      load.rows.map((p) => p.user_id),
      ['heavy', 'light'],
    );
    assert.equal(load.idle, 2);
    assert.equal(load.scale, 12);
  });

  void test('the bar is committed work only: in progress and to do', () => {
    const parts = barSegments(work({ in_progress: 1, todo: 3, backlog: 209, in_review: 77 }), 4);
    assert.deepEqual(
      parts.map((p) => [p.key, p.n, p.pct]),
      [
        ['in_progress', 1, 25],
        ['todo', 3, 75],
      ],
    );
  });
});

void describe('taskIdsToResolve — only what is drawn', () => {
  void test('the open cards’ tasks and the matched ones, nothing folded', () => {
    const people = [
      person({ user_id: 'a', in_progress_tasks: ['t1', 't2'] }),
      person({ user_id: 'b', in_progress_tasks: ['t3'] }),
    ];
    assert.deepEqual(taskIdsToResolve(people, new Set(), ['t9', null]), ['t9']);
    assert.deepEqual([...taskIdsToResolve(people, new Set(['a']), ['t1'])].sort(), ['t1', 't2']);
  });
});
