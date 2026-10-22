/**
 * The Calendar places open tasks by their real `due_on` (LAI-819).
 *
 * It took its dates from `demo/calendar.ts`, which a production build switches
 * off, so production said "0 tasks placed" while 48 open tasks had a due date.
 *
 * **Run west of Greenwich.** `due_on` is a UTC midnight (D-066) and the grid's
 * days are local midnights; east of UTC the two name the same date by luck,
 * and this machine is east of UTC. `node --test` gives every file its own
 * process, so setting the zone here changes nothing else.
 */

process.env.TZ = 'America/Los_Angeles';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  localDay,
  monthGrid,
  placeByDue,
} from '../../../../src/routes/screens/calendar/calendar-derive.ts';
import type { TaskStatus } from '../../../../src/api/tasks.ts';

const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
/** Noon local on 2026-09-18, a Friday. */
const NOW = new Date(2026, 8, 18, 12, 0).getTime();
const GRID = monthGrid(NOW);

const task = (id: string, due: string | null, status: TaskStatus = 'todo') => ({
  id,
  status,
  due_on: due === null ? null : utc(due),
});

void describe('a due date is the day it names, in any time zone', () => {
  void test('the zone really is west of UTC', () => {
    // The control: without it every assertion below could pass by luck.
    assert.equal(new Date(utc('2026-09-22')).getDate(), 21, 'TZ was not applied');
  });

  void test('a task due on the 22nd sits on the 22nd, not the evening before', () => {
    const day = new Date(localDay(utc('2026-09-22')));
    assert.deepEqual([day.getFullYear(), day.getMonth(), day.getDate()], [2026, 8, 22]);
    assert.equal(day.getHours(), 0);
  });
});

void describe('placeByDue', () => {
  void test('open tasks land on their due day', () => {
    const { byDay, placed } = placeByDue(
      [task('a', '2026-09-22'), task('b', '2026-09-22', 'in_progress'), task('c', '2026-09-03')],
      GRID,
    );
    assert.equal(placed, 3);
    assert.deepEqual(
      byDay.get(new Date(2026, 8, 22).getTime())?.map((t) => t.id),
      ['a', 'b'],
    );
    assert.deepEqual(
      byDay.get(new Date(2026, 8, 3).getTime())?.map((t) => t.id),
      ['c'],
    );
  });

  void test('finished work and undated work are placed nowhere', () => {
    const result = placeByDue(
      [task('a', '2026-09-22', 'done'), task('b', '2026-09-22', 'cancelled'), task('c', null)],
      GRID,
    );
    assert.deepEqual(
      { placed: result.placed, dated: result.dated, outside: result.outside },
      { placed: 0, dated: 0, outside: 0 },
    );
    assert.equal(result.byDay.size, 0);
  });

  void test('a date beyond the six weeks is counted apart, never as placed', () => {
    const result = placeByDue([task('a', '2026-09-22'), task('b', '2026-12-25')], GRID);
    assert.deepEqual(
      { placed: result.placed, dated: result.dated, outside: result.outside },
      { placed: 1, dated: 2, outside: 1 },
    );
  });
});
