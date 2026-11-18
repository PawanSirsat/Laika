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
  restoredToast,
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
  void test('the parent rule in its own words', () => {
    const refused = new ApiError('conflict', 'server words', 409, { reason: 'parent_archived' });
    assert.equal(
      archiveRefusal(refused, false),
      'Its parent task is archived. Restore the parent first.',
    );
  });

  void test('otherwise the server’s sentence, and a plain fallback for anything else', () => {
    assert.equal(archiveRefusal(new ApiError('forbidden', 'Not yours', 403), true), 'Not yours');
    assert.equal(archiveRefusal(new Error('network'), true), 'The task could not be archived.');
    assert.equal(archiveRefusal(undefined, false), 'The task could not be restored.');
  });
});
