/** `src/routes/screens/task/archive-model.ts` — archiving a task, in words (LAI-1353). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../../../src/api/errors.ts';
import {
  archivedBanner,
  archivedRowMeta,
  archivedToast,
  archiveRefusal,
  bulkArchivedToast,
  bulkDeleteQuestion,
  bulkTrashedToast,
  daysLeftLabel,
  deleteConfirm,
  purgeConfirm,
  purgedToast,
  restoredToast,
  TRASH_DAYS,
  trashBanner,
  trashDaysLeft,
  trashedToast,
  trashRowMeta,
  untrashedToast,
} from '../../../../src/routes/screens/task/archive-model.ts';

const NOW = Date.UTC(2026, 10, 19, 12);
const DEC_3 = Date.UTC(2026, 11, 3, 12);
const LAST_YEAR = Date.UTC(2025, 2, 7, 12);

void describe('archivedToast', () => {
  void test('names the task, and its subtasks only when it had any', () => {
    assert.equal(archivedToast('LAI-12', 0), 'LAI-12 archived');
    assert.equal(archivedToast('LAI-12', 1), 'LAI-12 and 1 subtask archived');
    assert.equal(archivedToast('LAI-12', 3), 'LAI-12 and 3 subtasks archived');
  });

  void test('the List’s bulk count, singular and plural', () => {
    assert.equal(bulkArchivedToast(1), '1 task archived');
    assert.equal(bulkArchivedToast(4), '4 tasks archived');
  });

  void test('a restore says where it went back to', () => {
    assert.equal(restoredToast('LAI-12'), 'LAI-12 is back on the board');
  });
});

void describe('archivedBanner', () => {
  void test('says who, when, and that it is read-only', () => {
    assert.equal(
      archivedBanner(DEC_3, 'Ada', NOW),
      'Archived by Ada on 3 Dec. It is read-only until it is restored.',
    );
  });

  void test('leaves out a name it cannot resolve, and shows the year when it is not this one', () => {
    assert.equal(
      archivedBanner(LAST_YEAR, undefined, NOW),
      'Archived on 7 Mar 2025. It is read-only until it is restored.',
    );
  });
});

void describe('archivedRowMeta', () => {
  void test('who and the day, or the day alone', () => {
    assert.equal(archivedRowMeta(DEC_3, 'Ada', NOW), 'Ada · 3 Dec');
    assert.equal(archivedRowMeta(DEC_3, '', NOW), '3 Dec');
  });
});

void describe('archiveRefusal', () => {
  void test('the parent rule in its own words, for either shelf', () => {
    const archived = new ApiError('conflict', 'server words', 409, { reason: 'parent_archived' });
    assert.equal(
      archiveRefusal(archived, 'restore'),
      'Its parent task is archived. Restore the parent first.',
    );
    const deleted = new ApiError('conflict', 'server words', 409, { reason: 'parent_deleted' });
    assert.equal(
      archiveRefusal(deleted, 'restore'),
      'Its parent task is in Trash. Restore the parent first.',
    );
  });

  void test('otherwise the server’s sentence, and a plain fallback for anything else', () => {
    assert.equal(
      archiveRefusal(new ApiError('forbidden', 'Not yours', 403), 'archive'),
      'Not yours',
    );
    assert.equal(
      archiveRefusal(new Error('network'), 'archive'),
      'The task could not be archived.',
    );
    assert.equal(archiveRefusal(undefined, 'restore'), 'The task could not be restored.');
    assert.equal(archiveRefusal(undefined, 'delete'), 'The task could not be moved to Trash.');
  });
});

void describe('Trash (LAI-1354)', () => {
  const DAY = 86_400_000;

  void test('counts the days left down from 30, never below 0', () => {
    assert.equal(TRASH_DAYS, 30);
    assert.equal(trashDaysLeft(NOW, NOW), 30);
    assert.equal(trashDaysLeft(NOW - 3 * DAY - 1, NOW), 27);
    assert.equal(trashDaysLeft(NOW - 29 * DAY, NOW), 1);
    assert.equal(trashDaysLeft(NOW - 45 * DAY, NOW), 0);
    assert.deepEqual([27, 1, 0].map(daysLeftLabel), ['27 days left', '1 day left', 'last day']);
  });

  void test('the toasts, singular and plural, and where a restore lands', () => {
    assert.equal(trashedToast('LAI-12', 0), 'LAI-12 moved to Trash');
    assert.equal(trashedToast('LAI-12', 2), 'LAI-12 and 2 subtasks moved to Trash');
    assert.equal(bulkTrashedToast(1), '1 task moved to Trash');
    assert.equal(bulkTrashedToast(3), '3 tasks moved to Trash');
    assert.equal(untrashedToast('LAI-12', false), 'LAI-12 is back on the board');
    assert.equal(untrashedToast('LAI-12', true), 'LAI-12 is back in the archive');
  });

  void test('Delete now says what goes for good, what stays, and that it cannot come back (LAI-1355)', () => {
    assert.deepEqual(purgeConfirm('LAI-12', 0), {
      title: 'Delete LAI-12 for good?',
      body: 'Its title, description, comments and files are erased now, and it cannot be restored. Its key, history and logged time stay.',
    });
    assert.equal(
      purgeConfirm('LAI-12', 2).body,
      'Its title, description, comments and files are erased now, and its 2 subtasks with it, and it cannot be restored. Its key, history and logged time stay.',
    );
    assert.equal(purgedToast('LAI-12', 0), 'LAI-12 deleted for good');
    assert.equal(purgedToast('LAI-12', 1), 'LAI-12 and 1 subtask deleted for good');
    assert.equal(archiveRefusal(new Error('network'), 'purge'), 'The task could not be deleted.');
  });

  void test('the confirm says what goes and that it can come back', () => {
    assert.deepEqual(deleteConfirm('LAI-12', 0), {
      title: 'Move LAI-12 to Trash?',
      body: 'It leaves the board. You can restore it from Trash for 30 days.',
    });
    assert.equal(
      deleteConfirm('LAI-12', 1).body,
      'It leaves the board with its 1 subtask. You can restore it from Trash for 30 days.',
    );
    assert.equal(bulkDeleteQuestion(2), 'Move 2 tasks to Trash?');
  });

  void test('the banner and a row say who, when and how long is left', () => {
    assert.equal(
      trashBanner(NOW - 3 * DAY, 'Ada', NOW),
      'Moved to Trash by Ada on 16 Nov — 27 days left to restore it. It is read-only.',
    );
    assert.equal(trashRowMeta(NOW - 3 * DAY, 'Ada', NOW), 'Ada · 16 Nov · 27 days left');
    assert.equal(trashRowMeta(NOW, undefined, NOW), '19 Nov · 30 days left');
  });
});
