import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDayWeekDay } from '../../../../src/api/time.ts';
import {
  dayLong,
  shortDay,
  weekTiles,
  weekTotal,
} from '../../../../src/routes/screens/my-day/week-derive.ts';

/**
 * The week strip (LAI-831, the owner's design and CHIEF's addition E): each
 * day's figure, its two-part bar and its word — and **no target**: the bars
 * are the week's own busiest day, never a fixed length of day.
 */

const week: MyDayWeekDay[] = [
  { day: '2026-10-19', confirmed_minutes: 450, drafted_minutes: 0, state: 'confirmed', off: null },
  { day: '2026-10-20', confirmed_minutes: 0, drafted_minutes: 0, state: 'no_signal', off: null },
  { day: '2026-10-21', confirmed_minutes: 90, drafted_minutes: 270, state: 'drafted', off: null },
  { day: '2026-10-22', confirmed_minutes: 0, drafted_minutes: 0, state: 'future', off: null },
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
      [
        {
          day: '2026-10-19',
          confirmed_minutes: 0,
          drafted_minutes: 0,
          state: 'no_signal',
          off: null,
        },
      ],
      '2026-10-21',
    );
    assert.deepEqual([empty[0]?.confirmedShare, empty[0]?.draftedShare], [0, 0]);
  });
});

void describe('weekTiles — a day off (D-149, LAI-1184)', () => {
  const offWeek: MyDayWeekDay[] = [
    {
      day: '2026-09-21',
      confirmed_minutes: 0,
      drafted_minutes: 0,
      state: 'no_signal',
      off: { holiday: { label: 'Heritage Day' }, leave: null },
    },
    {
      day: '2026-09-22',
      confirmed_minutes: 240,
      drafted_minutes: 0,
      state: 'confirmed',
      off: { holiday: null, leave: { part: 'full', status: 'approved', type: 'Annual' } },
    },
    {
      day: '2026-09-23',
      confirmed_minutes: 0,
      drafted_minutes: 0,
      state: 'no_signal',
      off: { holiday: null, leave: { part: 'second_half', status: 'approved', type: null } },
    },
    {
      day: '2026-09-24',
      confirmed_minutes: 0,
      drafted_minutes: 0,
      state: 'future',
      off: { holiday: null, leave: { part: 'full', status: 'pending', type: null } },
    },
  ];
  const tiles = weekTiles(offWeek, '2026-09-23');

  void test('a holiday with nothing on it is named, and has no figure — never no signal', () => {
    assert.equal(tiles[0]?.figure, '');
    assert.equal(tiles[0]?.label, 'Heritage Day');
    assert.deepEqual([tiles[0]?.off, tiles[0]?.mark], ['holiday', 'tint']);
  });

  void test('a day off with time keeps its figure and word, and says the leave after them', () => {
    assert.equal(tiles[1]?.figure, '4 h');
    assert.equal(tiles[1]?.label, 'Settled · On leave · Annual');
    assert.deepEqual([tiles[1]?.off, tiles[1]?.mark], ['leave', 'dot']);
  });

  void test('half-day leave owes half: still no signal, half filled; requested is only dashed', () => {
    assert.equal(tiles[2]?.figure, '—');
    assert.equal(tiles[2]?.label, 'No signal · On leave · afternoon');
    assert.equal(tiles[2]?.mark, 'half');
    assert.equal(tiles[3]?.label, 'Not yet · Leave requested');
    assert.deepEqual([tiles[3]?.off, tiles[3]?.mark], ['requested', 'dash']);
  });

  void test('a day with no day off carries no mark', () => {
    assert.deepEqual(
      weekTiles(week, '2026-10-21').map((t) => [t.off, t.mark]),
      week.map(() => [null, null]),
    );
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

void describe('shortDay', () => {
  void test('the day as the Timeline card’s head says it, whatever the reader’s zone (LAI-513)', () => {
    assert.equal(shortDay('2026-10-22'), 'Thu 22 Oct');
  });
});
