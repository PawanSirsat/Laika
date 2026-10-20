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
import type { CapacityEntry, CapacityWorkload } from '../../../../src/api/presence.ts';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

const ZERO: CapacityWorkload = {
  in_progress: 0,
  in_review: 0,
  todo: 0,
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

const work = (over: Partial<CapacityWorkload>): CapacityWorkload => {
  const w = { ...ZERO, ...over };
  return { ...w, open: over.open ?? w.in_progress + w.in_review + w.todo };
};

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
      spaces: [
        { project_id: 'p1', slug: 'a', name: 'A', ...work({ todo: 1, overdue: 1 }) },
        { project_id: 'p2', slug: 'b', name: 'B', ...work({ todo: 1 }) },
      ],
    });
    assert.equal(passesFilter(split, 'overdue', 'p1'), true);
    assert.equal(passesFilter(split, 'overdue', 'p2'), false);
    assert.equal(passesFilter(split, 'none', 'p3'), true);
    assert.deepEqual(workloadIn(split, 'p3'), ZERO);
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

  void test('team load is everyone with open work, heaviest first, and a count of the rest', () => {
    const load = teamLoad(
      [
        person({ user_id: 'light', load: 'light', workload: work({ todo: 2 }) }),
        person({ user_id: 'idle' }),
        person({ user_id: 'heavy', load: 'heavy', workload: work({ in_progress: 7, todo: 5 }) }),
      ],
      null,
    );
    assert.deepEqual(
      load.rows.map((p) => p.user_id),
      ['heavy', 'light'],
    );
    assert.equal(load.idle, 1);
    assert.equal(load.scale, 12);
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
