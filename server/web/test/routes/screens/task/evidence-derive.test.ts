/** `src/routes/screens/task/evidence-derive.ts` — the Proof section's fold and decisions (LAI-1122). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Round, RoundDecision } from '../../../../src/api/review.ts';
import {
  decisionVerb,
  proofFolded,
  proofFoldLabel,
} from '../../../../src/routes/screens/task/evidence-derive.ts';

function round(over: Partial<Round> = {}): Round {
  return {
    id: 'r',
    task_id: 't',
    number: 2,
    finished_by: 'u',
    client_name: null,
    agent: null,
    by_registered_agent: false,
    summary_md: 'Done',
    commits: [],
    branch: null,
    pull_request: null,
    tests: [],
    ci: null,
    decision: null,
    created_at: 1,
    ...over,
  };
}

const sentBack: RoundDecision = {
  kind: 'sent_back',
  decided_by: 'u',
  reason_md: 'Quote it',
  created_at: 2,
};

void describe('proofFolded', () => {
  void test('folds beside the state panel while the task is in review, by its status', () => {
    const latest = round();
    assert.equal(proofFolded({ shared: true, status: 'review', sendBack: null, latest }), true);
    assert.equal(
      proofFolded({ shared: true, status: 'in_progress', sendBack: null, latest }),
      false,
    );
    assert.equal(proofFolded({ shared: true, status: 'done', sendBack: null, latest }), false);
  });

  void test('never folds away from the state panel, or with no round to summarise', () => {
    // The Review page reads its own rounds and has no state panel above it.
    assert.equal(
      proofFolded({ shared: false, status: 'review', sendBack: null, latest: round() }),
      false,
    );
    assert.equal(
      proofFolded({ shared: true, status: 'review', sendBack: null, latest: undefined }),
      false,
    );
  });

  void test('without a status: an undecided round and no send-back reads as in review', () => {
    const fold = (latest: Round, sendBack: unknown = null) =>
      proofFolded({ shared: true, status: undefined, sendBack, latest });
    assert.equal(fold(round()), true);
    assert.equal(fold(round({ decision: sentBack }), { reason_md: 'Quote it' }), false);
    assert.equal(
      fold(round({ decision: { ...sentBack, kind: 'accepted', reason_md: null } })),
      false,
    );
    // A round from a server older than `decision` is undecided, not a crash.
    const old = Object.fromEntries(
      Object.entries(round()).filter(([key]) => key !== 'decision'),
    ) as unknown as Round;
    assert.equal('decision' in old, false);
    assert.equal(fold(old), true);
  });
});

void describe('proofFoldLabel and decisionVerb', () => {
  void test('names the round and what its proof adds up to', () => {
    const c = { id: 'c', state: 'confirmed' as const, state_source: null, state_at: null };
    assert.equal(
      proofFoldLabel(round({ commits: [{ ...c, sha: 'a', message: null }] })),
      'Proof · round 2 · its 1 item confirmed',
    );
    assert.equal(proofFoldLabel(round()), 'Proof · round 2 · no proof attached');
  });

  void test('says who decided, either way', () => {
    assert.equal(decisionVerb('accepted'), 'Accepted by');
    assert.equal(decisionVerb('sent_back'), 'Sent back by');
  });
});
