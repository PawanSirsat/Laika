import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TimeDraft, TimeEntry, TimeSummary } from '../../../../src/api/time.ts';
import {
  dayBars,
  daysIn,
  kindRows,
  presetRange,
  projectRows,
  rangeProblem,
  share,
  statsOf,
  summaryOfDay,
  taskRows,
  weekOf,
} from '../../../../src/routes/screens/my-day/overview-derive.ts';

/** The Overview's figures (LAI-505; LAI-526): one shape for a day, a week and a range. */

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: 'e',
  day: '2026-10-22',
  tz: 'UTC',
  started_at: null,
  ended_at: null,
  minutes: 30,
  source: 'draft',
  task: null,
  project: null,
  note: null,
  kind: null,
  title: null,
  description: null,
  revision: 1,
  created_at: 1,
  updated_at: 1,
  ...over,
});

const draft = (over: Partial<TimeDraft>): TimeDraft =>
  ({
    id: 'd',
    day: '2026-10-22',
    tz: 'UTC',
    started_at: null,
    ended_at: null,
    minutes: 30,
    source: 'collector',
    task: null,
    project: null,
    general: false,
    note: null,
    ...over,
  }) as TimeDraft;

const LAIKA = { id: 'p1', slug: 'laika', name: 'Laika' };
const SKY = { id: 'p2', slug: 'skynet', name: 'Skynet' };
const LAI1 = { id: 't1', key: 'LAI-1', title: 'Search' };
const SKY1 = { id: 't2', key: 'SKY-1', title: 'Webhooks' };

const DAY = summaryOfDay({
  day: '2026-10-22',
  entries: [
    entry({ id: 'a', minutes: 60, kind: 'meeting', source: 'manual' }),
    entry({ id: 'b', minutes: 30, kind: 'meeting', task: SKY1, project: SKY }),
    entry({ id: 'c', minutes: 30, task: LAI1, project: LAIKA }),
  ],
  drafts: [
    draft({ id: 'd', minutes: 80 }),
    draft({ id: 'f', minutes: 20, task: LAI1, project: LAIKA }),
  ],
});

void describe('the open day, in a summary’s shape', () => {
  void test('totals, meetings, off-screen, one active day', () => {
    assert.deepEqual(
      [DAY.days, DAY.active_days, DAY.confirmed_minutes, DAY.drafted_minutes],
      [1, 1, 120, 100],
    );
    assert.equal(DAY.meeting_minutes, 90);
    assert.equal(DAY.manual_minutes, 60);
    assert.deepEqual(DAY.by_day, [
      { day: '2026-10-22', confirmed_minutes: 120, drafted_minutes: 100 },
    ]);
  });

  void test('by project, largest first, null for time on none', () => {
    assert.deepEqual(
      DAY.by_project.map((p) => [p.project?.slug ?? null, p.confirmed_minutes, p.drafted_minutes]),
      [
        [null, 60, 80],
        ['laika', 30, 20],
        ['skynet', 30, 0],
      ],
    );
  });

  void test('by kind: a draft has none yet', () => {
    assert.deepEqual(DAY.by_kind, [
      { kind: null, minutes: 130 },
      { kind: 'meeting', minutes: 90 },
    ]);
  });
});

void describe('the figures', () => {
  void test('stats: four for a day, and Per active day over several', () => {
    assert.deepEqual(
      statsOf(DAY).map((s) => [s.key, s.value, s.sub]),
      [
        ['tracked', 220, '120 confirmed'],
        ['review', 100, 'drafts waiting'],
        ['meetings', 90, '41% of tracked'],
        ['off', 60, 'added by you'],
      ],
    );
    const week: TimeSummary = { ...DAY, days: 7, active_days: 2 };
    assert.deepEqual(statsOf(week).at(-1), {
      key: 'per-day',
      label: 'Per active day',
      value: 110,
      sub: '2 of 7 days',
    });
  });

  void test('by kind: what nobody named is Building’s, in the design’s order', () => {
    assert.deepEqual(
      kindRows(DAY.by_kind).map((k) => [k.key, k.label, k.minutes, k.pct]),
      [
        ['work', 'Building', 130, 59],
        ['meeting', 'Meetings', 90, 41],
      ],
    );
  });

  void test('by project: No project for time on none, shares of what was tracked, bars of the busiest', () => {
    assert.deepEqual(
      projectRows(DAY.by_project).map((p) => [p.label, p.minutes, p.pct, p.width]),
      [
        ['No project', 140, 64, 1],
        ['Laika', 50, 23, 50 / 140],
        ['Skynet', 30, 14, 30 / 140],
      ],
    );
  });

  void test('by task: a card; time typed on none is No task, drafted time on nothing yet No task yet', () => {
    assert.deepEqual(
      taskRows(DAY.by_task).map((t) => [t.key, t.title, t.minutes]),
      [
        ['No task yet', '', 80],
        ['No task', 'logged by kind', 60],
        ['LAI-1', 'Search', 50],
        ['SKY-1', 'Webhooks', 30],
      ],
    );
    const drafted = summaryOfDay({
      day: '2026-10-22',
      entries: [],
      drafts: [draft({ minutes: 15 })],
    });
    assert.deepEqual(
      taskRows(drafted.by_task).map((t) => [t.key, t.title]),
      [['No task yet', '']],
    );
  });

  void test('by day: each day of the busiest; an empty day is a zero bar', () => {
    const bars = dayBars({
      ...DAY,
      days: 2,
      by_day: [
        { day: '2026-10-21', confirmed_minutes: 0, drafted_minutes: 0 },
        { day: '2026-10-22', confirmed_minutes: 120, drafted_minutes: 100 },
      ],
    });
    assert.deepEqual(
      bars.map((b) => [b.day, b.height]),
      [
        ['2026-10-21', 0],
        ['2026-10-22', 1],
      ],
    );
  });

  void test('a share of nothing is nothing', () => {
    assert.equal(share(10, 0), 0);
  });
});

void describe('the stretch', () => {
  void test('the week is Monday to Sunday, whatever day is open', () => {
    assert.deepEqual(weekOf('2026-10-22'), { from: '2026-10-19', to: '2026-10-25' });
    assert.deepEqual(weekOf('2026-10-26'), { from: '2026-10-26', to: '2026-11-01' });
  });

  void test('the quick picks, counted back from today', () => {
    assert.deepEqual(presetRange('last7', '2026-10-26'), { from: '2026-10-20', to: '2026-10-26' });
    assert.deepEqual(presetRange('last30', '2026-10-26'), { from: '2026-09-27', to: '2026-10-26' });
    assert.deepEqual(presetRange('thisMonth', '2026-10-26'), {
      from: '2026-10-01',
      to: '2026-10-26',
    });
    assert.deepEqual(presetRange('lastMonth', '2026-10-26'), {
      from: '2026-09-01',
      to: '2026-09-30',
    });
    assert.deepEqual(presetRange('lastMonth', '2026-03-05'), {
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  void test('a picked range is read only when it can be: both days, in order, a quarter at most', () => {
    assert.equal(rangeProblem({ from: '2026-10-01', to: '2026-10-26' }), undefined);
    assert.match(rangeProblem({ from: '', to: '2026-10-26' }) ?? '', /both days/);
    assert.match(rangeProblem({ from: '2026-10-27', to: '2026-10-26' }) ?? '', /before the first/);
    assert.equal(daysIn('2026-07-02', '2026-10-01'), 92);
    assert.equal(rangeProblem({ from: '2026-07-02', to: '2026-10-01' }), undefined);
    assert.match(rangeProblem({ from: '2026-07-01', to: '2026-10-01' }) ?? '', /92 days or fewer/);
  });
});
