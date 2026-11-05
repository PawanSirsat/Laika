/**
 * *On your plate* while time tracking is off (LAI-1191): the reader's open
 * work, overdue first, then due soon, then in progress, then the rest — the
 * order made here because `GET /tasks` takes no due-date filter.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DUE_SOON_DAYS,
  offPlate,
  offPlateKind,
} from '../../../../src/routes/screens/my-day/off-plate-derive.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';

const DAY = 24 * 60 * 60 * 1000;
const MIDNIGHT = Date.UTC(2026, 10, 4);
const NOW = MIDNIGHT + 15 * 60 * 60 * 1000;

function task(id: string, status: string, due: number | null, updated = 0): TaskSummary {
  return {
    id,
    key: `LAI-${id}`,
    status,
    due_on: due,
    updated_at: updated,
  } as unknown as TaskSummary;
}

void describe('offPlateKind', () => {
  void test('due before today is overdue; today counts as on time', () => {
    assert.equal(offPlateKind(task('1', 'todo', MIDNIGHT - DAY), NOW), 'overdue');
    assert.equal(offPlateKind(task('2', 'todo', MIDNIGHT), NOW), 'soon');
  });

  void test(`due within ${String(DUE_SOON_DAYS)} days is soon, after that it is not`, () => {
    assert.equal(
      offPlateKind(task('1', 'todo', MIDNIGHT + (DUE_SOON_DAYS - 1) * DAY), NOW),
      'soon',
    );
    assert.equal(offPlateKind(task('2', 'todo', MIDNIGHT + DUE_SOON_DAYS * DAY), NOW), 'open');
  });

  void test('undated work in progress is in progress; the rest is open', () => {
    assert.equal(offPlateKind(task('1', 'in_progress', null), NOW), 'progress');
    assert.equal(offPlateKind(task('2', 'review', null), NOW), 'open');
  });
});

void describe('offPlate', () => {
  void test('orders overdue, soon, in progress, the rest — dates earliest first, else latest change', () => {
    const rows = offPlate(
      [
        task('open-old', 'todo', null, 1),
        task('progress', 'in_progress', null, 5),
        task('soon-late', 'todo', MIDNIGHT + 3 * DAY),
        task('overdue-recent', 'todo', MIDNIGHT - DAY),
        task('open-new', 'backlog', null, 9),
        task('soon-early', 'in_progress', MIDNIGHT + DAY),
        task('overdue-old', 'review', MIDNIGHT - 5 * DAY),
      ],
      NOW,
    );
    assert.deepEqual(
      rows.map((r) => r.task.id),
      [
        'overdue-old',
        'overdue-recent',
        'soon-early',
        'soon-late',
        'progress',
        'open-new',
        'open-old',
      ],
    );
  });

  void test('finished work is never on the plate, and a task listed twice is drawn once', () => {
    const rows = offPlate(
      [
        task('1', 'done', MIDNIGHT - DAY),
        task('2', 'cancelled', null),
        task('3', 'todo', null),
        task('3', 'todo', null),
      ],
      NOW,
    );
    assert.deepEqual(
      rows.map((r) => r.task.id),
      ['3'],
    );
  });
});
