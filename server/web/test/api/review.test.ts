/**
 * `src/api/review.ts` — the review gate's client half (D-081, LAI-758).
 *
 * Four rules worth a test: **a pull request is drawn as a link only when it is
 * http(s)**, whatever the server stored; **a round's summary counts what a
 * reviewer needs** (passed, failed, nothing at all); **the filters mean what
 * their labels say**; and **a send-back needs a reason** before it is sent.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  evidenceSummary,
  filterQueue,
  NO_FILTER,
  safeHttpUrl,
  SEND_BACK_REASON_MAX,
  sendBackProblem,
  shortSha,
  waitingFor,
  type ReviewQueueItem,
  type Round,
} from '../../src/api/review.ts';
import { type Task } from '../../src/api/tasks.ts';

function round(patch: Partial<Round> = {}): Round {
  return {
    id: 'r1',
    task_id: 't1',
    number: 1,
    finished_by: 'u1',
    client_name: 'codex',
    summary_md: 'Did it',
    commits: [],
    branch: null,
    pull_request: null,
    tests: [],
    created_at: 0,
    ...patch,
  };
}

const item = (state = 'claimed' as const) => ({
  id: 'e',
  state,
  state_source: null,
  state_at: null,
});

function queued(
  key: string,
  patch: { slug?: string; assignee?: string | null; round?: Round | null } = {},
): ReviewQueueItem {
  return {
    task: { id: key, key, assignee_id: patch.assignee ?? null } as unknown as Task,
    project: { id: 'p', slug: patch.slug ?? 'laika', name: 'Laika', prefix: 'LAI' },
    assignee_name: null,
    waiting_since: 0,
    round: patch.round === undefined ? null : patch.round,
    finished_by_name: null,
    can_decide: true,
  };
}

void describe('safeHttpUrl', () => {
  void test('keeps http and https', () => {
    assert.equal(safeHttpUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
    assert.equal(safeHttpUrl('http://git.example.test/pr/2'), 'http://git.example.test/pr/2');
  });

  void test('refuses every other scheme and anything that is not a URL', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x/y', 'see the PR']) {
      assert.equal(safeHttpUrl(value), null, value);
    }
  });
});

void describe('evidenceSummary', () => {
  void test('a task never finished has no proof at all', () => {
    assert.deepEqual(evidenceSummary(null), {
      commits: 0,
      pullRequest: null,
      testsPassed: 0,
      testsFailed: 0,
      empty: true,
    });
  });

  void test('counts commits, passed and failed tests, and the PR when it is a safe link', () => {
    const summary = evidenceSummary(
      round({
        commits: [
          { ...item(), sha: 'a', message: null },
          { ...item(), sha: 'b', message: null },
        ],
        pull_request: { ...item(), url: 'https://github.com/o/r/pull/9' },
        tests: [
          { ...item(), command: 'pnpm test', exit_code: 0 },
          { ...item(), command: 'pnpm lint', exit_code: 1 },
          { ...item(), command: 'pnpm format', exit_code: -9 },
        ],
      }),
    );
    assert.deepEqual(summary, {
      commits: 2,
      pullRequest: 'https://github.com/o/r/pull/9',
      testsPassed: 1,
      testsFailed: 2,
      empty: false,
    });
  });

  void test('a finish with only a branch is not "no proof"', () => {
    assert.equal(evidenceSummary(round({ branch: { ...item(), name: 'main' } })).empty, false);
  });
});

void describe('filterQueue', () => {
  const failing = round({ tests: [{ ...item(), command: 'x', exit_code: 2 }] });
  const passing = round({ tests: [{ ...item(), command: 'x', exit_code: 0 }] });
  const items = [
    queued('A', { slug: 'laika', assignee: 'u1', round: failing }),
    queued('B', { slug: 'orb', assignee: null, round: passing }),
    queued('C', { slug: 'laika', assignee: 'u2', round: null }),
  ];
  const keys = (filter: Parameters<typeof filterQueue>[1]) =>
    filterQueue(items, filter).map((i) => i.task.key);

  void test('no filter keeps the server’s order', () => {
    assert.deepEqual(keys(NO_FILTER), ['A', 'B', 'C']);
  });

  void test('by project, by assignee and by unassigned', () => {
    assert.deepEqual(keys({ ...NO_FILTER, project: 'laika' }), ['A', 'C']);
    assert.deepEqual(keys({ ...NO_FILTER, assignee: 'u2' }), ['C']);
    assert.deepEqual(keys({ ...NO_FILTER, assignee: 'none' }), ['B']);
  });

  void test('failing tests and no proof', () => {
    assert.deepEqual(keys({ ...NO_FILTER, failing: true }), ['A']);
    assert.deepEqual(keys({ ...NO_FILTER, noEvidence: true }), ['C']);
    assert.deepEqual(keys({ ...NO_FILTER, failing: true, noEvidence: true }), []);
  });
});

void describe('waitingFor and the small labels', () => {
  void test('reads compactly at every step', () => {
    const now = 10 * 24 * 3_600_000;
    assert.equal(waitingFor(now - 10_000, now), 'just now');
    assert.equal(waitingFor(now - 12 * 60_000, now), '12 min');
    assert.equal(waitingFor(now - 3 * 3_600_000, now), '3 h');
    assert.equal(waitingFor(now - 2 * 24 * 3_600_000, now), '2 d');
    assert.equal(
      waitingFor(now + 5_000, now),
      'just now',
      'a stamp from the future is not negative',
    );
  });

  void test('a sha is drawn as its first twelve characters', () => {
    assert.equal(shortSha('0123456789abcdef0123'), '0123456789ab');
  });
});

void describe('sendBackProblem', () => {
  void test('a blank reason cannot be sent, and says who reads it', () => {
    assert.match(sendBackProblem('   ') ?? '', /agent reads this first/);
  });

  void test('a reason within the limit can, and one over it cannot', () => {
    assert.equal(sendBackProblem('Lint is red'), null);
    assert.notEqual(sendBackProblem('x'.repeat(SEND_BACK_REASON_MAX + 1)), null);
  });
});
