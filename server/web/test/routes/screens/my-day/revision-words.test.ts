import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TimeRevision } from '../../../../src/api/time.ts';
import { revisionBy, revisionWords } from '../../../../src/routes/screens/my-day/revision-words.ts';

/**
 * HISTORY in words (LAI-515), naming whoever changed somebody's entry when it
 * was not them (D-143, LAI-1165) — an import's included, since owners and
 * admins may correct one.
 */

const rev = (over: Partial<TimeRevision> = {}): TimeRevision => ({
  revision: 1,
  change: 'created',
  changed_by: 'u2',
  changed_by_name: 'Grace Hopper',
  day: '2026-11-05',
  tz: 'UTC',
  minutes: 30,
  task_id: null,
  project_id: null,
  note: null,
  started_at: null,
  ended_at: null,
  created_at: 0,
  ...over,
});
const ADA = { changed_by: 'u1', changed_by_name: 'Ada Lovelace' };

void describe('who changed it, in words (D-143)', () => {
  void test('the person’s own revisions name nobody', () => {
    assert.equal(revisionBy(rev(), 'manual', true, 'u2'), undefined);
    assert.equal(revisionWords(rev(), 'manual', true, 'u2'), 'Added by hand · 30 min');
    assert.equal(
      revisionWords(rev({ change: 'edited', minutes: 45 }), 'manual', false, 'u2'),
      'Edited · 45 min',
    );
  });

  void test('an owner’s add, change and delete name the owner', () => {
    assert.equal(revisionWords(rev(ADA), 'manual', true, 'u2'), 'Added by Ada Lovelace · 30 min');
    assert.equal(
      revisionWords(rev({ ...ADA, change: 'edited', minutes: 45 }), 'manual', false, 'u2'),
      'Changed by Ada Lovelace · 45 min',
    );
    assert.equal(
      revisionWords(rev({ ...ADA, change: 'deleted' }), 'manual', false, 'u2'),
      'Deleted by Ada Lovelace',
    );
  });

  void test('an import’s first revision is Solidtime’s; an owner’s change to it is named', () => {
    assert.equal(revisionWords(rev(ADA), 'import', true, 'u2'), 'Imported from Solidtime');
    assert.equal(revisionBy(rev(ADA), 'import', true, 'u2'), undefined);
    assert.equal(
      revisionWords(rev({ ...ADA, change: 'edited', minutes: 15 }), 'import', false, 'u2'),
      'Changed by Ada Lovelace · 15 min',
    );
  });
});
