/** `src/routes/screens/task/hero-derive.ts` — the task detail's state panel (LAI-1117). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { HandoffOffer } from '../../../../src/api/handoffs.ts';
import type { Round } from '../../../../src/api/review.ts';
import type { TaskLiveClaim, TaskSummary } from '../../../../src/api/tasks.ts';
import {
  confirmedSentence,
  heroKind,
  mayDecideReview,
  openWorkRequest,
  progressFraction,
  reviewFacts,
  workingFor,
  workingSince,
} from '../../../../src/routes/screens/task/hero-derive.ts';

type HeroTask = Pick<TaskSummary, 'status' | 'send_back' | 'claim' | 'selected_agent'>;
const base: HeroTask = { status: 'backlog', send_back: null, claim: null, selected_agent: null };
const claim = { generation: 2 } as TaskLiveClaim;
const agent = { id: 'g' } as NonNullable<TaskSummary['selected_agent']>;
const sendBack = { reason_md: 'Quote it', decided_by: 'u', created_at: 1 };

void describe('heroKind', () => {
  void test('review and done win over everything', () => {
    assert.equal(heroKind({ ...base, status: 'review', claim, send_back: sendBack }), 'review');
    assert.equal(heroKind({ ...base, status: 'done', selected_agent: agent }), 'done');
  });

  void test('a send-back wins over a live claim; a claim over a work request', () => {
    assert.equal(
      heroKind({ ...base, status: 'in_progress', send_back: sendBack, claim }),
      'sent_back',
    );
    assert.equal(
      heroKind({ ...base, status: 'in_progress', claim, selected_agent: agent }),
      'progress',
    );
    assert.equal(heroKind({ ...base, selected_agent: agent }), 'waiting');
  });

  void test('cancelled, or nobody on it, shows none', () => {
    assert.equal(heroKind({ ...base, status: 'cancelled', claim }), null);
    assert.equal(heroKind(base), null);
  });
});

function item(state: 'claimed' | 'confirmed' | 'failed') {
  return { id: state, state, state_source: null, state_at: null };
}

function round(over: Partial<Round> = {}): Round {
  return {
    id: 'r',
    task_id: 't',
    number: 1,
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
    created_at: 1,
    ...over,
  };
}

void describe('confirmedSentence', () => {
  void test('says signed deliveries, never the repository, in every wording', () => {
    const cases: Round[] = [
      round(),
      round({ commits: [{ ...item('confirmed'), sha: 'a', message: null }] }),
      round({
        commits: [{ ...item('confirmed'), sha: 'a', message: null }],
        tests: [{ ...item('claimed'), command: 't', exit_code: 0 }],
      }),
      round({ tests: [{ ...item('failed'), command: 't', exit_code: 1 }] }),
      round({ tests: [{ ...item('claimed'), command: 't', exit_code: 0 }] }),
    ];
    const tones = cases.map((r) => confirmedSentence(r).tone);
    assert.deepEqual(tones, ['none', 'ok', 'partial', 'failed', 'claimed']);
    for (const r of cases) assert.doesNotMatch(confirmedSentence(r).text, /repository/);
    assert.equal(
      confirmedSentence(cases[1]!).text,
      "Laika confirmed all 1 items from GitHub's signed deliveries.",
    );
    assert.match(
      confirmedSentence(cases[2]!).text,
      /^Laika confirmed 1 of 2 items .* 1 still claimed/,
    );
  });
});

void describe('reviewFacts', () => {
  void test('reads the PR number, CI on its head, tests and the branch', () => {
    const facts = reviewFacts(
      round({
        pull_request: {
          ...item('confirmed'),
          url: 'https://github.com/o/r/pull/260',
          merged: false,
        },
        branch: { ...item('confirmed'), name: 'LAI-1113-x' },
        commits: [{ ...item('confirmed'), sha: 'a', message: null }],
        tests: [
          { ...item('confirmed'), command: 'a', exit_code: 0 },
          { ...item('confirmed'), command: 'b', exit_code: 1 },
        ],
        ci: {
          head_sha: 'd0cdedc24312aaaa',
          total: 13,
          passed: 13,
          failed: 0,
          pending: 0,
          failed_names: [],
        },
      }),
    );
    assert.equal(facts.pullRequest.label, '#260 ↗');
    assert.equal(facts.pullRequest.merged, 'Open · not merged');
    assert.equal(facts.ci, '✓ 13 of 13 passed');
    assert.equal(facts.ciTone, 'ok');
    assert.equal(facts.tests, '1 passed · 1 failed');
    assert.equal(facts.commitsSub, 'LAI-1113-x');
  });

  void test('says what is missing rather than drawing a blank', () => {
    const facts = reviewFacts(round());
    assert.equal(facts.pullRequest.label, 'None');
    assert.equal(facts.ci, 'No CI reported');
    assert.equal(facts.tests, 'None run');
  });
});

void describe('workingSince and workingFor', () => {
  const row = (generation: number, at: number): ActivityEvent => ({
    id: String(at),
    seq: at,
    type: 'task.updated',
    project_id: 'p',
    task_id: 't',
    actor_id: 'u',
    actor_kind: 'agent',
    actor_token_id: null,
    payload: { field: 'claim', from: null, to: { generation, session_id: 's' } },
    created_at: at,
  });

  void test('takes the live generation’s own claim row, not an earlier one, else started_at', () => {
    assert.equal(workingSince([row(2, 500), row(1, 100)], 2, 50), 500);
    assert.equal(workingSince([row(1, 100)], 2, 50), 50);
    assert.equal(workingSince([], 2, null), null);
  });

  void test('words a duration, and a fresh start without one', () => {
    assert.equal(workingFor(0, 30_000), 'just started');
    assert.equal(workingFor(0, 18 * 60_000), 'for 18 min');
  });
});

void describe('progressFraction, openWorkRequest, mayDecideReview', () => {
  void test('bounds the fraction and needs an estimate', () => {
    assert.equal(progressFraction(30, 60), 0.5);
    assert.equal(progressFraction(90, 60), 1);
    assert.equal(progressFraction(30, null), null);
  });

  void test('finds the open work request to that agent, newest first', () => {
    const offer = (id: string, kind: string, state: string, to: string, at: number) =>
      ({ id, kind, state, to_agent_id: to, created_at: at }) as unknown as HandoffOffer;
    const offers = [
      offer('old', 'work_request', 'open', 'g', 1),
      offer('new', 'work_request', 'open', 'g', 2),
      offer('h', 'handoff', 'open', 'g', 3),
      offer('done', 'work_request', 'accepted', 'g', 4),
      offer('other', 'work_request', 'open', 'x', 5),
    ];
    assert.equal(openWorkRequest(offers, 'g')?.id, 'new');
    assert.equal(openWorkRequest(offers, 'nobody'), undefined);
  });

  void test('offers the decision to the assignee or a lead, signed in', () => {
    assert.equal(mayDecideReview({ meId: 'u', assigneeId: 'u', leads: false }), true);
    assert.equal(mayDecideReview({ meId: 'u', assigneeId: 'v', leads: true }), true);
    assert.equal(mayDecideReview({ meId: 'u', assigneeId: 'v', leads: false }), false);
    assert.equal(mayDecideReview({ meId: undefined, assigneeId: null, leads: true }), false);
  });
});
