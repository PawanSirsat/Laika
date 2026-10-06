import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DAY_MS,
  dateInputToMs,
  dateLabel,
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
