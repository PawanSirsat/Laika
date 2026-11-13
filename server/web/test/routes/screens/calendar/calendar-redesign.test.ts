import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dateOnlyOf,
  dayOverflow,
  localDay,
  monthOf,
  monthParam,
  monthWeeks,
  splitOverdue,
  sprintSegments,
  stepMonth,
} from '../../../../src/routes/screens/calendar/calendar-derive.ts';
import { toolbarFilter } from '../../../../src/routes/screens/board/filter-keys.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';

/**
 * The Calendar's rework (LAI-1178): any month by the address, overdue work
 * apart from the grid, every day one height with "+N more", one sprint band
 * per week, a dropped day written back as the date-only value it names, and
 * the toolbar's own filters read as the board reads them.
 */

const NOV_12 = new Date(2026, 10, 12, 15).getTime();

void describe('months', () => {
  void test('the address names a month; anything else is this one', () => {
    assert.equal(monthOf('2027-02', NOV_12), new Date(2027, 1, 1).getTime());
    assert.equal(monthOf(undefined, NOV_12), new Date(2026, 10, 1).getTime());
    assert.equal(monthOf('2026-13', NOV_12), new Date(2026, 10, 1).getTime());
    assert.equal(monthOf('nope', NOV_12), new Date(2026, 10, 1).getTime());
  });

  void test('steps across a year and writes back as the address does', () => {
    const nov = monthOf(undefined, NOV_12);
    assert.equal(monthParam(stepMonth(nov, 2)), '2027-01');
    assert.equal(monthParam(stepMonth(nov, -11)), '2025-12');
  });

  void test('a paged month marks today only when today is in it', () => {
    const feb = monthWeeks(monthOf('2027-02', NOV_12), 6, NOV_12).flatMap((w) => w.days);
    assert.equal(feb.filter((d) => d.isToday).length, 0);
    assert.equal(feb.find((d) => d.inMonth)?.dayOfMonth, 1);
    const nov = monthWeeks(monthOf(undefined, NOV_12), 6, NOV_12).flatMap((w) => w.days);
    assert.equal(nov.filter((d) => d.isToday).length, 1);
  });
});

type Fixture = Pick<TaskSummary, 'due_on' | 'status' | 'priority' | 'number'> & {
  readonly id: string;
};
const t = (
  n: number,
  due: number | null,
  status: TaskSummary['status'] = 'todo',
  priority: TaskSummary['priority'] = 'p2',
): Fixture => ({ id: `t${String(n)}`, number: n, due_on: due, status, priority });
const ids = (list: readonly Fixture[]): string[] => list.map((x) => x.id);
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m, d);

void describe('splitOverdue', () => {
  void test('open work due before today goes apart, oldest first; today stays', () => {
    const { overdue, rest } = splitOverdue(
      [
        t(1, utc(2026, 10, 12)),
        t(2, utc(2026, 9, 28)),
        t(3, utc(2026, 10, 1), 'todo', 'p1'),
        t(4, utc(2026, 10, 1), 'todo', 'p3'),
        t(5, utc(2026, 9, 1), 'done'),
        t(6, null),
      ],
      NOV_12,
    );
    assert.deepEqual(ids(overdue), ['t2', 't3', 't4']);
    assert.deepEqual(ids(rest), ['t1', 't5', 't6']);
  });
});

void describe('dayOverflow', () => {
  void test('most urgent first; never "+1 more"', () => {
    const list = [t(4, 0, 'todo', 'p3'), t(2, 0, 'todo', 'p1'), t(3, 0, 'todo', 'p2')];
    const three = dayOverflow(list, 3);
    assert.equal(three.more, 0);
    assert.deepEqual(ids(three.shown), ['t2', 't3', 't4']);
    const four = dayOverflow([...list, t(9, 0)], 3);
    assert.equal(four.shown.length, 2);
    assert.equal(four.more, 2);
    assert.equal(four.all.length, 4);
  });
});

void describe('sprintSegments', () => {
  const days = monthWeeks(monthOf(undefined, NOV_12), 6, NOV_12)[2]?.days ?? [];
  void test('one band per sprint per week, named where it starts', () => {
    // The third row of November 2026 runs Mon 9 to Sun 15.
    const bands = sprintSegments(days, [
      {
        id: 's10',
        name: 'Sprint 10',
        status: 'completed',
        starts_on: utc(2026, 9, 26),
        ends_on: utc(2026, 10, 10),
      },
      {
        id: 's11',
        name: 'Sprint 11',
        status: 'active',
        starts_on: utc(2026, 10, 11),
        ends_on: utc(2026, 10, 24),
      },
      {
        id: 'later',
        name: 'Later',
        status: 'planned',
        starts_on: utc(2026, 11, 1),
        ends_on: utc(2026, 11, 14),
      },
    ]);
    assert.deepEqual(
      bands.map((b) => [b.id, b.from, b.to, b.starts, b.running]),
      [
        ['s10', 0, 1, false, false],
        ['s11', 2, 6, true, true],
      ],
    );
  });
});

void describe('a dropped day', () => {
  void test('is the date-only value of the same calendar date, read back the same', () => {
    const local = new Date(2026, 10, 14).getTime();
    assert.equal(dateOnlyOf(local), Date.UTC(2026, 10, 14));
    assert.equal(localDay(dateOnlyOf(local)), local);
  });
});

void describe('toolbarFilter', () => {
  void test('reads the toolbar’s four, ignoring what the server would refuse', () => {
    assert.deepEqual(
      toolbarFilter(new URLSearchParams('priority=p1&tag=infra&assignee=u1&ready=true&q=x')),
      { priority: 'p1', tag: 'infra', assignee: 'u1', ready: true },
    );
    assert.deepEqual(toolbarFilter(new URLSearchParams('priority=p9&tag=Bad Tag!')), {});
    assert.deepEqual(toolbarFilter(new URLSearchParams('')), {});
  });
});
