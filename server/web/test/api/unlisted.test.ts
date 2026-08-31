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
  mayPromote,
  mayTriageUnlisted,
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

void describe('the queue is offered to exactly whom the server allows', () => {
  void test('owner and admin may triage', () => {
    // Mirrors `audit_log.export`, which is admin-up — these rows are audit rows.
    assert.equal(mayTriageUnlisted('owner'), true);
    assert.equal(mayTriageUnlisted('admin'), true);
  });

  void test('member and viewer never see it', () => {
    // Absent, not disabled (LAI-082): every endpoint answers 403 for them, so
    // an entry would advertise a screen that cannot open.
    assert.equal(mayTriageUnlisted('member'), false);
    assert.equal(mayTriageUnlisted('viewer'), false);
  });

  void test('an unknown role is refused, not admitted', () => {
    // A new org role must default to hidden rather than inheriting access.
    assert.equal(mayTriageUnlisted('auditor'), false);
    assert.equal(mayTriageUnlisted(''), false);
  });
});
