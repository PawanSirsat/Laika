/**
 * What the Meeting review screen works out for itself (LAI-455).
 *
 * The screen asks a person to authorise an LLM's reading of a conversation to
 * change their board, so **almost nothing here is a judgement** — every figure
 * about what happened comes from the apply response. The one thing worth testing
 * hard is `landedState`, because it is the difference between reporting what
 * happened and reporting what was hoped for.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  changedFields,
  describeChange,
  describeOutcome,
  isActionable,
  KIND_LABEL,
  KIND_MEANING,
  landedState,
  whyNotActionable,
} from '../../../../src/routes/screens/meeting-review/review-derive.ts';
import {
  PROPOSAL_KINDS,
  type ApplyResult,
  type MeetingReview,
  type ProposalView,
} from '../../../../src/api/meeting-reviews.ts';

function review(over: Partial<MeetingReview> = {}): MeetingReview {
  return {
    id: 'r1',
    project_id: 'p1',
    source: 'standup.txt',
    status: 'pending',
    proposal_count: 2,
    reviewed_by: null,
    reviewed_at: null,
    expires_at: 0,
    created_at: 0,
    ...over,
  };
}

function proposal(over: Partial<ProposalView> & { id: string }): ProposalView {
  return {
    kind: 'new',
    task: null,
    title: null,
    description: null,
    changes: null,
    reason: null,
    quote: 'somebody said this',
    applied_at: null,
    ...over,
  };
}

void describe('landedState — read from the response, never the selection', () => {
  const result: ApplyResult = {
    id: 'r1',
    status: 'applied',
    applied: [{ id: 'a', kind: 'new', outcome: { effect: 'task.created', task_id: 't1' } }],
    already_applied: ['b'],
  };
  const accepted = new Set(['a', 'b', 'c']);

  void test('a proposal in `applied` reports what it did', () => {
    const landed = landedState('a', accepted, result);
    assert.equal(landed.state, 'applied');
    assert.deepEqual(landed.state === 'applied' ? landed.outcome : undefined, {
      effect: 'task.created',
      task_id: 't1',
    });
  });

  void test('a repeat is `already`, not a second success', () => {
    assert.equal(landedState('b', accepted, result).state, 'already');
  });

  void test('**accepted and absent from the response is refused**', () => {
    // This is the criterion the screen exists for. `c` was sent and did not come
    // back — LAI-451 decides each proposal separately, so a member accepting a
    // lead-only `decision` lands here. A screen reporting its selection would
    // call this a success.
    assert.equal(landedState('c', accepted, result).state, 'refused');
  });

  void test('never accepted is `not-sent`, which is not the same as refused', () => {
    // Conflating the two would tell somebody their choice was rejected when
    // they never made it.
    assert.equal(landedState('d', accepted, result).state, 'not-sent');
  });

  void test('an empty response refuses everything that was sent', () => {
    const nothing: ApplyResult = { id: 'r1', status: 'applied', applied: [], already_applied: [] };
    for (const id of ['a', 'b', 'c']) {
      assert.equal(landedState(id, accepted, nothing).state, 'refused', id);
    }
  });
});

void describe('the four tags', () => {
  void test('every kind has a label and a plain-words meaning', () => {
    // A tag with no wording is a colour, and colour alone is gone for a
    // colour-blind reader and in a screenshot.
    for (const kind of PROPOSAL_KINDS) {
      assert.ok((KIND_LABEL[kind] ?? '').length > 0, `${kind} has no label`);
      assert.ok((KIND_MEANING[kind] ?? '').length > 5, `${kind} has no meaning`);
    }
  });

  void test('`DEAD` says it closes work, because it is the one that removes something', () => {
    assert.match(KIND_MEANING.dead, /clos/i);
    assert.notEqual(KIND_MEANING.dead, KIND_MEANING.new);
  });

  void test('`DECISION` says it is not a task', () => {
    // It writes `context_md`, which is why it is lead-only and why a member's
    // acceptance of it can come back refused.
    assert.match(KIND_MEANING.decision, /context|record/i);
  });
});

void describe('describeChange — a change with no before is not reviewable', () => {
  void test('it omits the arrow rather than inventing a from', () => {
    const change = describeChange('status', 'done', undefined);
    assert.equal(change.from, undefined, '`? → done` claims a fact nobody has');
    assert.equal(change.to, 'done');
  });

  void test('it shows both when the before is known', () => {
    const change = describeChange('status', 'done', 'in_progress');
    assert.equal(change.from, 'in_progress');
    assert.equal(change.to, 'done');
  });

  void test('null reads as `none`, not as the string "null"', () => {
    assert.equal(describeChange('assignee_id', null, undefined).to, 'none');
  });
});

void describe('changedFields', () => {
  void test('sorted, so the same proposal reads the same way twice', () => {
    const p = proposal({ id: 'x', kind: 'change', changes: { status: 'done', priority: 'p1' } });
    assert.deepEqual(changedFields(p), ['priority', 'status']);
  });

  void test('no changes is an empty list, not a crash', () => {
    assert.deepEqual(changedFields(proposal({ id: 'x' })), []);
  });
});

void describe('describeOutcome', () => {
  void test('it names the task in the reader’s terms', () => {
    const key = (id: string) => (id === 't1' ? 'LC-4' : id);
    assert.equal(describeOutcome({ effect: 'task.created', task_id: 't1' }, key), 'created LC-4');
    assert.equal(
      describeOutcome({ effect: 'task.status_changed', task_id: 't1', to: 'done' }, key),
      'moved LC-4 to done',
    );
    assert.equal(
      describeOutcome({ effect: 'context.appended' }, key),
      'appended to the project context',
    );
  });
});

void describe('actionability comes from status, not the clock', () => {
  void test('only `pending` can be acted on', () => {
    assert.equal(isActionable(review()), true);
    for (const status of ['applied', 'discarded', 'expired'] as const) {
      assert.equal(isActionable(review({ status })), false, status);
    }
  });

  void test('expiry is never computed here', () => {
    // §11.6's sweep sets `expired` and writes the audit row. A screen comparing
    // `expires_at` to `Date.now()` would be a second definition that disagrees
    // with it — and disagreeing means offering to apply what the server refuses.
    const past = review({ expires_at: 1, status: 'pending' });
    assert.equal(isActionable(past), true, 'the screen decided expiry for itself');
  });

  void test('each blocked status says why, in words a reader can act on', () => {
    assert.equal(whyNotActionable(review()), undefined);
    for (const status of ['applied', 'discarded', 'expired'] as const) {
      const why = whyNotActionable(review({ status }));
      assert.ok((why ?? '').length > 20, `${status} has no explanation`);
    }
    assert.match(whyNotActionable(review({ status: 'expired' })) ?? '', /seven days/);
  });
});
