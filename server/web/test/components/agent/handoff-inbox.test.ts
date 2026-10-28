/**
 * Inbox → Hand-offs as data (LAI-536): what each filter shows and what its
 * badge counts.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  actionCount,
  matches,
  type HandoffItem,
} from '../../../src/components/agent/handoff-inbox.ts';
import { INBOX } from '../../../src/components/agent-states/agent-state-fixtures.ts';

const item = (over: Partial<HandoffItem>): HandoffItem => ({
  id: 'x',
  kind: 'work_request',
  direction: 'received',
  taskKey: 'LAI-1',
  taskTitle: 'A task',
  from: null,
  to: null,
  state: 'Open',
  yourMove: true,
  needsApproval: false,
  age: 'now',
  ...over,
});

void describe('matches', () => {
  void test('each filter takes its own items', () => {
    const recovery = item({ kind: 'recovery' });
    const sent = item({ direction: 'sent', kind: 'handoff' });
    const approval = item({ kind: 'handoff', needsApproval: true });
    assert.equal(matches(recovery, 'recovery'), true);
    assert.equal(matches(sent, 'recovery'), false);
    assert.equal(matches(sent, 'sent'), true);
    assert.equal(matches(sent, 'received'), false);
    assert.equal(matches(approval, 'needs_approval'), true);
    assert.equal(matches(recovery, 'needs_approval'), false);
  });
});

void describe('actionCount', () => {
  void test('an item that is not your move never counts', () => {
    const items = [
      item({}),
      item({ yourMove: false, state: 'Expired' }),
      item({ direction: 'sent', yourMove: false }),
      item({ kind: 'recovery' }),
    ];
    assert.equal(actionCount(items, 'received'), 2);
    assert.equal(actionCount(items, 'sent'), 0);
    assert.equal(actionCount(items, 'recovery'), 1);
  });

  void test('the gallery inbox counts what the browser test reads', () => {
    // Fixture: three received items need action — a work request, a
    // recovery, a cross-owner approval; the sent offer and the expired
    // request wait on nobody here.
    assert.equal(actionCount(INBOX, 'received'), 3);
    assert.equal(actionCount(INBOX, 'sent'), 0, 'sent items wait on someone else');
    assert.equal(actionCount(INBOX, 'needs_approval'), 1);
    assert.equal(actionCount(INBOX, 'recovery'), 1);
    const expired = INBOX.find((i) => i.state === 'Expired');
    assert.ok(expired !== undefined && !expired.yourMove, 'the fixture lost its expired item');
  });
});
