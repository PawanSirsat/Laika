import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDayWeekDay } from '../../../../src/api/time.ts';
import {
  dayLong,
  weekTiles,
  weekTotal,
} from '../../../../src/routes/screens/my-day/week-derive.ts';

/**
 * The week strip (LAI-831, the owner's design and CHIEF's addition E): each
 * day's figure, its two-part bar and its word — and **no target**: the bars
 * are the week's own busiest day, never a fixed length of day.
 */

const week: MyDayWeekDay[] = [
  { day: '2026-10-19', confirmed_minutes: 450, drafted_minutes: 0, state: 'confirmed' },
  { day: '2026-10-20', confirmed_minutes: 0, drafted_minutes: 0, state: 'no_signal' },
  { day: '2026-10-21', confirmed_minutes: 90, drafted_minutes: 270, state: 'drafted' },
  { day: '2026-10-22', confirmed_minutes: 0, drafted_minutes: 0, state: 'future' },
];

void describe('weekTiles', () => {
  const tiles = weekTiles(week, '2026-10-21');

  void test('names each day by its weekday and date, and only today is today', () => {
    assert.deepEqual(
      tiles.map((t) => [t.name, t.date, t.isToday]),
      [
        ['Mon', '19', false],
        ['Tue', '20', false],
        ['Wed', '21', true],
        ['Thu', '22', false],
      ],
    );
  });

  void test('a day not yet happened, a day with no signal, a day to settle, a settled one', () => {
    assert.deepEqual(
      tiles.map((t) => t.state),
      ['confirmed', 'no_signal', 'drafted', 'future'],
    );
    assert.equal(tiles[0]?.label, 'Settled');
    assert.equal(tiles[1]?.label, 'No signal');
    assert.match(tiles[2]?.label ?? '', / to settle$/);
    assert.equal(tiles[3]?.label, 'Not yet');
    // No signal is not zero hours; a future day has no figure at all.
    assert.equal(tiles[1]?.figure, '—');
    assert.equal(tiles[3]?.figure, '');
  });

  void test('bars are shares of the week’s busiest day, never of a target', () => {
    assert.equal(tiles[0]?.confirmedShare, 1);
    assert.equal(tiles[0]?.draftedShare, 0);
    assert.equal(tiles[2]?.confirmedShare, 90 / 450);
    assert.equal(tiles[2]?.draftedShare, 270 / 450);
    assert.equal(tiles[1]?.confirmedShare, 0);
  });

  void test('a week with nothing in it draws no bars', () => {
    const empty = weekTiles(
      [{ day: '2026-10-19', confirmed_minutes: 0, drafted_minutes: 0, state: 'no_signal' }],
      '2026-10-21',
    );
    assert.deepEqual([empty[0]?.confirmedShare, empty[0]?.draftedShare], [0, 0]);
  });
});

void describe('weekTotal', () => {
  void test('adds the week’s confirmed and drafted minutes apart and together', () => {
    assert.deepEqual(weekTotal(week), { confirmed: 540, drafted: 270, total: 810 });
  });
});

void describe('dayLong', () => {
  void test('the day in words, whatever the reader’s zone', () => {
    assert.equal(dayLong('2026-10-21'), 'Wednesday 21 October');
  });
});
