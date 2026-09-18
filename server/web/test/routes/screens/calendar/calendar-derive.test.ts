/**
 * The calendar's month grid (LAI-271).
 *
 * Date arithmetic is where off-by-one errors hide: the task lands on the wrong
 * day and the screen looks entirely plausible.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  byDay,
  monthGrid,
  startOfDay,
} from '../../../../src/routes/screens/calendar/calendar-derive.ts';

/** 2026-09-18 is a Friday. */
const FRIDAY = new Date(2026, 8, 18, 14, 30).getTime();

void describe('the month grid', () => {
  void test('is always six weeks, whatever the month does', () => {
    // A grid that changes height as you page moves everything beneath it.
    for (const month of [0, 1, 4, 8, 11]) {
      const at = new Date(2026, month, 15).getTime();
      assert.equal(monthGrid(at).length, 42, `month ${String(month)} is not six weeks`);
    }
  });

  void test('starts on a Monday, as the design lays the week out', () => {
    const grid = monthGrid(FRIDAY);
    const first = new Date(grid[0]?.at ?? 0);
    assert.equal(first.getDay(), 1, 'the grid does not start on a Monday');
  });

  void test('marks today once, and only today', () => {
    const grid = monthGrid(FRIDAY);
    const todays = grid.filter((d) => d.isToday);
    assert.equal(todays.length, 1);
    assert.equal(todays[0]?.dayOfMonth, 18);
  });

  void test('knows which days belong to the month and which are padding', () => {
    const grid = monthGrid(FRIDAY);
    const inMonth = grid.filter((d) => d.inMonth);
    // September has 30 days.
    assert.equal(inMonth.length, 30);
    assert.ok(
      grid.some((d) => !d.inMonth),
      'no padding days — the grid cannot be six weeks',
    );
  });

  void test('marks weekends', () => {
    const grid = monthGrid(FRIDAY);
    // Six weeks, two weekend days each.
    assert.equal(grid.filter((d) => d.isWeekend).length, 12);
  });
});

void describe('placing tasks on days', () => {
  const task = (id: string, due: number | undefined) => ({ id, due });

  void test('buckets by the day, not the instant', () => {
    const morning = new Date(2026, 8, 18, 9, 0).getTime();
    const evening = new Date(2026, 8, 18, 23, 30).getTime();
    const map = byDay([task('a', morning), task('b', evening)], (t) => t.due);

    assert.equal(map.size, 1, 'two times on one day made two buckets');
    assert.equal(map.get(startOfDay(morning))?.length, 2);
  });

  void test('a task with no due date is placed nowhere, not on today', () => {
    const map = byDay([task('a', undefined)], (t) => t.due);
    assert.equal(map.size, 0);
  });
});
