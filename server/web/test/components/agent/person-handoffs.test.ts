/**
 * Inbox → Hand-offs as words (LAI-550), from a person's inbox as served
 * (LAI-1009): what the badge adds up, when *Approve* is offered, that
 * approval and acceptance are said apart, and that a re-read never moves the
 * row being acted on.
 *
 * **That an expired or resolved offer never counts is the server's** — its
 * `counts` are live and unexpired only, asserted in
 * `server/test/http/routes/person-handoff-inbox.test.ts` (*counts every view,
 * live and unexpired only*). Here: the badge is those counts and nothing
 * counted from rows, so closed rows on screen cannot reach it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PersonHandoffAgent, PersonHandoffView } from '../../../src/api/handoffs.ts';
import {
  acceptanceWords,
  approvalWords,
  checkpointWords,
  handoffsWaiting,
  mayApprove,
  mayWithdraw,
  mergeHeld,
  nextActionWords,
} from '../../../src/components/agent/person-handoffs.ts';

const agent = (id: string, ownerId: string, device = 'Belka'): PersonHandoffAgent => ({
  id,
  display_name: `agent ${id}`,
  harness: 'claude-code',
  device_label: device,
  status: 'active',
  owner: { id: ownerId, name: `Owner ${ownerId}` },
});

const row = (over: Partial<PersonHandoffView>): PersonHandoffView => ({
  id: 'o1',
  kind: 'handoff',
  state: 'pending_approval',
  task_id: 't1',
  task_key: 'LC-1',
  task_title: 'A task',
  project_id: 'p1',
  project_slug: 'laika',
  from_agent: agent('a-from', 'u-sam'),
  to_agent: agent('a-to', 'u-kim', 'Strelka'),
  checkpoint_id: 'c1',
  checkpoint: { commit_sha: 'f'.repeat(40), verification: 'verified', saved_at: 1_000 },
  reason: 'Context is full',
  requires_approval: true,
  approved: false,
  approved_at: null,
  expires_at: 10_000_000,
  closed_reason: null,
  created_at: 500,
  closed_at: null,
  next_action: 'approve',
  from_agent_redacted: false,
  to_agent_redacted: false,
  ...over,
});

void describe('the badge is the server’s counts', () => {
  void test('received plus needs approval — the two that wait on the reader', () => {
    assert.equal(handoffsWaiting({ received: 2, sent: 5, needs_approval: 1, recovery: 7 }), 3);
  });

  void test('sent and recovery alone are not the reader’s move', () => {
    assert.equal(handoffsWaiting({ received: 0, sent: 4, needs_approval: 0, recovery: 3 }), 0);
  });

  void test('not read yet is no badge, never zero', () => {
    assert.equal(handoffsWaiting(undefined), undefined);
  });
});

void describe('Approve', () => {
  void test('offered when the server says approve and the receiver is someone else’s', () => {
    assert.equal(mayApprove(row({}), 'u-lead'), true);
  });

  void test('never for the receiving agent’s owner, whatever the hint says', () => {
    assert.equal(mayApprove(row({}), 'u-kim'), false);
  });

  void test('never before the reader is known, and never for an unnamed receiver', () => {
    assert.equal(mayApprove(row({}), undefined), false);
    assert.equal(mayApprove(row({ to_agent: null }), 'u-lead'), false);
  });

  void test('offered for a receiver the server withheld: never the reader’s own (LAI-1012)', () => {
    const withheld = row({ to_agent: null, to_agent_redacted: true });
    assert.equal(mayApprove(withheld, 'u-lead'), true);
    assert.equal(mayApprove(withheld, undefined), false);
    assert.equal(mayApprove({ ...withheld, next_action: 'wait_for_approval' }, 'u-lead'), false);
  });

  void test('a withheld receiver is a registered agent, not any eligible agent (LAI-1012)', () => {
    const withheld = row({ to_agent: null, to_agent_redacted: true });
    assert.equal(acceptanceWords(withheld), 'a registered agent can accept once it is approved');
    assert.doesNotMatch(nextActionWords(withheld), /eligible/);
    assert.match(acceptanceWords(row({ to_agent: null })), /any eligible agent/);
  });

  void test('only on a pending offer the server says to approve', () => {
    assert.equal(mayApprove(row({ state: 'open' }), 'u-lead'), false);
    assert.equal(mayApprove(row({ next_action: 'wait_for_approval' }), 'u-lead'), false);
  });

  void test('Withdraw only on a live offer the server says to cancel', () => {
    assert.equal(mayWithdraw(row({ next_action: 'cancel', state: 'open' })), true);
    assert.equal(mayWithdraw(row({ next_action: 'cancel', state: 'expired' })), false);
    assert.equal(mayWithdraw(row({ next_action: 'approve' })), false);
  });
});

void describe('approval and acceptance are two steps', () => {
  void test('an approved offer is still waiting for the agent to accept', () => {
    const approved = row({ state: 'open', approved: true, next_action: 'wait_for_receiver' });
    assert.equal(approvalWords(approved), 'Approved by a person');
    assert.equal(acceptanceWords(approved), 'Waiting for Claude Code · Strelka to accept');
  });

  void test('pending: approval waits, acceptance follows it', () => {
    assert.equal(approvalWords(row({})), 'Waiting for a person to approve');
    assert.equal(acceptanceWords(row({})), 'Claude Code · Strelka can accept once it is approved');
  });

  void test('accepted only when the server says so', () => {
    assert.equal(acceptanceWords(row({ state: 'accepted' })), 'Accepted by Claude Code · Strelka');
    assert.equal(acceptanceWords(row({ state: 'expired' })), 'Expired before anyone accepted');
  });

  void test('a same-owner offer needs no approval', () => {
    assert.equal(approvalWords(row({ requires_approval: false })), 'No approval needed');
  });

  void test('the next step is the server’s, in words; an agent accepts, not a person', () => {
    assert.match(
      nextActionWords(row({ next_action: 'accept_with_your_agent' })),
      /Run Claude Code · Strelka: it accepts/,
    );
    assert.match(
      nextActionWords(row({ next_action: 'wait_for_approval' })),
      /assignee or a space lead/,
    );
  });
});

void describe('the save', () => {
  void test('its age and verification', () => {
    assert.equal(checkpointWords(row({}), 1_000 + 12 * 60_000), 'Saved 12 min ago · verified');
  });

  void test('removed by retention, or never carried', () => {
    assert.equal(checkpointWords(row({ checkpoint: null }), 0), 'The save was removed');
    assert.equal(checkpointWords(row({ checkpoint: null, checkpoint_id: null }), 0), 'No save');
  });
});

void describe('a re-read never moves the row being acted on', () => {
  const a = row({ id: 'a' });
  const b = row({ id: 'b' });
  const c = row({ id: 'c' });
  const shown = [a, b, c].map((r) => ({ row: r, gone: false }));

  void test('not holding: the server’s order, as answered', () => {
    const merged = mergeHeld(shown, [c, row({ id: 'new' }), a], false);
    assert.deepEqual(
      merged.rows.map((r) => r.row.id),
      ['c', 'new', 'a'],
    );
    assert.equal(merged.waiting, 0);
  });

  void test('holding: rows keep their places, change in place, and new ones wait', () => {
    const approved = row({ id: 'b', state: 'open', approved: true });
    const merged = mergeHeld(shown, [row({ id: 'new' }), approved, c], true);
    assert.deepEqual(
      merged.rows.map((r) => [r.row.id, r.gone]),
      [
        ['a', true],
        ['b', false],
        ['c', false],
      ],
    );
    assert.equal(merged.rows[1]?.row.state, 'open', 'the acted-on row changed in place');
    assert.equal(merged.waiting, 1);
  });
});
