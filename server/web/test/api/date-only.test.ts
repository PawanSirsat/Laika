import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DAY_MS,
  dateInputToMs,
  dateLabel,
  dateLabelShort,
  dueState,
  isOverdue,
  msToDateInput,
  startOfUtcDay,
} from '../../src/api/date-only.ts';

const JUL_12 = Date.UTC(2026, 6, 12);

void describe('date-only values (D-066)', () => {
  void test('round-trips the date input through UTC midnight', () => {
    assert.equal(dateInputToMs('2026-07-12'), JUL_12);
    assert.equal(msToDateInput(JUL_12), '2026-07-12');
    assert.equal(dateInputToMs('12/07/2026'), null);
    assert.equal(dateInputToMs('2026-13-45'), null);
  });

  void test('labels the way the owner’s screenshot does', () => {
    assert.equal(dateLabel(JUL_12), '12 Jul 2026');
    assert.equal(dateLabel(Date.UTC(2026, 0, 1)), '1 Jan 2026');
    assert.equal(dateLabelShort(JUL_12), '12 Jul');
  });

  void test('startOfUtcDay floors to the day', () => {
    assert.equal(startOfUtcDay(JUL_12 + 5 * 60 * 60 * 1000), JUL_12);
    assert.equal(startOfUtcDay(JUL_12), JUL_12);
  });

  void test('overdue is strictly past the due day, and only while open', () => {
    const afternoonOfDueDay = JUL_12 + 15 * 60 * 60 * 1000;
    const nextDay = JUL_12 + DAY_MS + 1000;

    // The whole due day is on time.
    assert.equal(isOverdue({ due_on: JUL_12, status: 'in_progress' }, afternoonOfDueDay), false);
    assert.equal(isOverdue({ due_on: JUL_12, status: 'in_progress' }, nextDay), true);
    assert.equal(isOverdue({ due_on: JUL_12, status: 'backlog' }, nextDay), true);
    // Finished late is finished; dropped work has no date to miss.
    assert.equal(isOverdue({ due_on: JUL_12, status: 'done' }, nextDay), false);
    assert.equal(isOverdue({ due_on: JUL_12, status: 'cancelled' }, nextDay), false);
    // No date, never overdue.
    assert.equal(isOverdue({ due_on: null, status: 'in_progress' }, nextDay), false);
  });
});

void describe('dueState — what a card says about a due date (LAI-701)', () => {
  const open = (due_on: number | null) => ({ due_on, status: 'in_progress' as const });
  const firstMs = JUL_12;
  const lastMs = JUL_12 + DAY_MS - 1;

  void test('today, from the first millisecond of the due day to the last', () => {
    assert.equal(dueState(open(JUL_12), firstMs), 'today');
    assert.equal(dueState(open(JUL_12), lastMs), 'today');
  });

  void test('overdue from the first millisecond of the next day', () => {
    assert.equal(dueState(open(JUL_12), lastMs + 1), 'overdue');
    assert.equal(dueState(open(JUL_12), JUL_12 + 30 * DAY_MS), 'overdue');
  });

  void test('a date still ahead says nothing', () => {
    // The owner: show the due date only "if that is gone or for today".
    assert.equal(dueState(open(JUL_12), firstMs - 1), undefined);
    assert.equal(dueState(open(JUL_12 + DAY_MS), lastMs), undefined);
  });

  void test('no date, or finished work, says nothing whatever the date', () => {
    assert.equal(dueState(open(null), lastMs), undefined);
    for (const status of ['done', 'cancelled'] as const) {
      assert.equal(dueState({ due_on: JUL_12, status }, lastMs), undefined, `${status} today`);
      assert.equal(
        dueState({ due_on: JUL_12, status }, JUL_12 + 9 * DAY_MS),
        undefined,
        `${status} past`,
      );
    }
  });

  void test('agrees with isOverdue, so the card and the List cannot disagree', () => {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const now = JUL_12 + offset * DAY_MS + 3_600_000;
      for (const status of ['todo', 'in_progress', 'done', 'cancelled'] as const) {
        const task = { due_on: JUL_12, status };
        assert.equal(
          dueState(task, now) === 'overdue',
          isOverdue(task, now),
          `${status} at ${String(offset)}d`,
        );
      }
    }
  });
});
