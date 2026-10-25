import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TimeDraft, TimeEntry } from '../../../../src/api/time.ts';
import {
  byTask,
  dayStats,
  meetingMinutes,
  share,
  weekStats,
} from '../../../../src/routes/screens/my-day/overview-derive.ts';

/** The Overview's figures (LAI-505): the day's, the week's, by task. */

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

const LAI1 = { id: 't1', key: 'LAI-1', title: 'Search' } as never;

void describe('the day', () => {
  void test('tracked, to review, meetings as a share, and off-screen', () => {
    const stats = dayStats({
      entries: [
        entry({ id: 'a', minutes: 60, kind: 'meeting', source: 'manual' }),
        entry({ id: 'b', minutes: 30, kind: 'meeting' }),
        entry({ id: 'c', minutes: 30, task: LAI1 }),
      ],
      drafts: [draft({ id: 'd', minutes: 80 })],
    });
    assert.deepEqual(
      stats.map((s) => [s.key, s.value, s.sub]),
      [
        ['tracked', 200, '120 confirmed'],
        ['review', 80, 'drafts waiting'],
        ['meetings', 90, '45% of tracked'],
        ['off', 60, 'added by you'],
      ],
    );
    assert.equal(share(1, 0), 0);
    assert.equal(meetingMinutes([]), 0);
  });
});

void describe('the week', () => {
  void test('tracked, to review, per active day, and a bar a day of the busiest', () => {
    const week = weekStats([
      { day: '2026-10-19', confirmed_minutes: 120, drafted_minutes: 0, state: 'confirmed' },
      { day: '2026-10-20', confirmed_minutes: 0, drafted_minutes: 0, state: 'no_signal' },
      { day: '2026-10-21', confirmed_minutes: 60, drafted_minutes: 60, state: 'drafted' },
    ]);
    assert.deepEqual(
      week.stats.map((s) => [s.key, s.value, s.sub]),
      [
        ['tracked', 240, '180 confirmed'],
        ['review', 60, 'drafts waiting'],
        ['per-day', 120, '2 of 3 days'],
      ],
    );
    assert.deepEqual(
      week.days.map((d) => [d.day, d.height]),
      [
        ['2026-10-19', 1],
        ['2026-10-20', 0],
        ['2026-10-21', 1],
      ],
    );
  });
});

void describe('by task', () => {
  void test('largest first, No task yet last, widths of the busiest', () => {
    const rows = byTask(
      [entry({ id: 'a', minutes: 30, task: LAI1 }), entry({ id: 'b', minutes: 45 })],
      [draft({ id: 'c', minutes: 30, task: LAI1 }), draft({ id: 'd', minutes: 10 })],
    );
    assert.deepEqual(
      rows.map((r) => [r.key, r.title, r.minutes, r.width]),
      [
        ['LAI-1', 'Search', 60, 1],
        ['No task yet', '', 55, 55 / 60],
      ],
    );
  });
});
