/**
 * `src/api/unlisted.ts` — the triage queue (SPEC §4.14, LAI-413).
 *
 * Two rules are worth a test. **A promoted row must never be offered promote
 * again** — the server answers `409`, so offering it walks someone into a
 * refusal. And **dismissing is not deleting**: the row survives and a filter
 * finds it, so the client must not treat "not in the default list" as gone.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  firstLine,
  mayPromote,
  newestFirst,
  openUnlistedCount,
  unlistedState,
  type UnlistedWork,
} from '../../src/api/unlisted.ts';

function row(patch: Partial<UnlistedWork> = {}): UnlistedWork {
  return {
    id: 'u1',
    user_id: 'me',
    token_id: 'tok',
    repo: 'laika',
    note: 'the deploy script has a hardcoded path',
    promoted_task_id: null,
    dismissed_at: null,
    created_at: 1,
    ...patch,
  };
}

void describe('a row’s state decides what may be done to it', () => {
  void test('an untriaged row is pending and can be promoted', () => {
    assert.equal(unlistedState(row()), 'pending');
    assert.equal(mayPromote(row()), true);
  });

  void test('a promoted row is never offered promote again', () => {
    // The server answers 409 on a second attempt. Offering the control walks
    // the reader into a refusal that is entirely predictable here.
    const promoted = row({ promoted_task_id: 'task-1' });
    assert.equal(unlistedState(promoted), 'promoted');
    assert.equal(mayPromote(promoted), false);
  });

  void test('a dismissed row is not offered promote either', () => {
    assert.equal(unlistedState(row({ dismissed_at: 2 })), 'dismissed');
    assert.equal(mayPromote(row({ dismissed_at: 2 })), false);
  });

  void test('promoted beats dismissed, because the task still exists', () => {
    // A row that produced work and was later dismissed still has something
    // worth opening. Reporting it as merely dismissed loses that.
    const both = row({ promoted_task_id: 'task-2', dismissed_at: 3 });
    assert.equal(unlistedState(both), 'promoted');
  });

  void test('exactly one state permits promotion', () => {
    // Fails if a future state is added and quietly allowed to promote.
    const states = [row(), row({ promoted_task_id: 't' }), row({ dismissed_at: 1 })];
    assert.equal(states.filter(mayPromote).length, 1);
  });
});

void describe('the compact queue (LAI-754)', () => {
  void test('the open count is pending notes only — promoted and dismissed are decided', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c', promoted_task_id: 'task-1' }),
      row({ id: 'd', dismissed_at: 5 }),
    ];
    assert.equal(openUnlistedCount(rows), 2);
    assert.equal(openUnlistedCount([]), 0);
  });

  void test('newest first, and the input is left alone', () => {
    const rows = [row({ id: 'old', created_at: 1 }), row({ id: 'new', created_at: 9 })];
    assert.deepEqual(
      newestFirst(rows).map((r) => r.id),
      ['new', 'old'],
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['old', 'new'],
      'sorted in place',
    );
  });

  void test('a row shows the first line that says something', () => {
    assert.equal(firstLine('\n  \n  The runner warns.\nSecond line'), 'The runner warns.');
    assert.equal(firstLine('one line'), 'one line');
    assert.equal(firstLine('   '), '');
  });
});
