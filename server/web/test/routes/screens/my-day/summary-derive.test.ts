import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TimeDraft, TimeEntry } from '../../../../src/api/time.ts';
import {
  daySplit,
  noteOf,
  offScreen,
  splitKeyOf,
  weekdayOf,
} from '../../../../src/routes/screens/my-day/summary-derive.ts';

/**
 * Where the day went (LAI-503): by kind, else Building on a card and General
 * on none; largest first; nothing from nothing; the off-screen entries.
 */

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

void describe('splitKeyOf', () => {
  void test('a kind wins; a block with none is Building’s, as the design counts it (LAI-510)', () => {
    assert.equal(
      splitKeyOf(entry({ kind: 'meeting', task: { key: 'LAI-1' } as never })),
      'meeting',
    );
    assert.equal(splitKeyOf(entry({ task: { key: 'LAI-1' } as never })), 'work');
    assert.equal(splitKeyOf(entry({ project: { slug: 'atlas' } as never })), 'work');
    assert.equal(splitKeyOf(entry({})), 'work');
  });
});

void describe('daySplit', () => {
  void test('groups by kind in the design’s order of kinds, with its words and rounded shares', () => {
    const split = daySplit(
      [
        entry({ id: 'a', minutes: 60, kind: 'meeting' }),
        entry({ id: 'b', minutes: 30, kind: 'meeting' }),
        entry({ id: 'c', minutes: 45, task: { key: 'LAI-1' } as never }),
      ],
      [draft({ id: 'd', minutes: 15 })],
    );
    assert.deepEqual(
      split.map((s) => [s.key, s.label, s.minutes, s.pct]),
      [
        ['work', 'Building', 60, 40],
        ['meeting', 'Meetings', 90, 60],
      ],
    );
  });

  void test('nothing yields no segment', () => {
    assert.deepEqual(daySplit([], []), []);
  });
});

void describe('offScreen and noteOf', () => {
  void test('only what was typed or timed is off-screen; the note is the day’s or empty', () => {
    const typed = entry({ id: 't', source: 'manual' });
    assert.deepEqual(offScreen([entry({ id: 'x' }), typed, entry({ id: 'i', source: 'import' })]), [
      typed,
    ]);
    assert.equal(noteOf({ day_note: null }), '');
    assert.equal(
      noteOf({ day_note: { day: '2026-10-22', note: 'Long day', updated_at: 1 } }),
      'Long day',
    );
  });
});

void describe('weekdayOf', () => {
  void test('the title names the day by its weekday, whatever the reader’s zone', () => {
    assert.equal(weekdayOf('2026-10-22'), 'Thursday');
    assert.equal(weekdayOf('2026-10-25'), 'Sunday');
  });
});
