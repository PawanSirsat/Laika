/**
 * `src/api/review.ts` — the review gate's client half (D-082, LAI-758).
 *
 * Four rules worth a test: **a pull request is drawn as a link only when it is
 * http(s)**, whatever the server stored; **a round's summary counts what a
 * reviewer needs** (passed, failed, nothing at all); **the filters mean what
 * their labels say**; and **a send-back needs a reason** before it is sent.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ciLine,
  ciVerdict,
  evidenceSummary,
  filterQueue,
  NO_FILTER,
  proofStamp,
  safeHttpUrl,
  SEND_BACK_REASON_MAX,
  sendBackProblem,
  shortSha,
  roundAgentName,
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
    agent: null,
    by_registered_agent: false,
    summary_md: 'Did it',
    commits: [],
    branch: null,
    pull_request: null,
    tests: [],
    ci: null,
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
  patch: {
    slug?: string;
    assignee?: string | null;
    round?: Round | null;
    cue?: ReviewQueueItem['cue'];
  } = {},
): ReviewQueueItem {
  return {
    task: { id: key, key, assignee_id: patch.assignee ?? null } as unknown as Task,
    project: { id: 'p', slug: patch.slug ?? 'laika', name: 'Laika', prefix: 'LAI' },
    assignee_name: null,
    waiting_since: 0,
    round: patch.round === undefined ? null : patch.round,
    finished_by_name: null,
    can_decide: true,
    cue: patch.cue ?? null,
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
        pull_request: { ...item(), url: 'https://github.com/o/r/pull/9', merged: null },
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

  void test('“check this one”: only the tasks the server cued as finished far faster than forecast (LAI-772)', () => {
    const cued = [
      queued('A', { slug: 'laika', assignee: 'u1', round: passing }),
      queued('B', {
        slug: 'laika',
        assignee: 'u1',
        round: passing,
        cue: { kind: 'fast', build_ms: 60_000, forecast_p50_ms: 3_600_000 },
      }),
    ];
    assert.deepEqual(
      filterQueue(cued, { ...NO_FILTER, fast: true }).map((i) => i.task.key),
      ['B'],
    );
    assert.deepEqual(
      filterQueue(cued, NO_FILTER).map((i) => i.task.key),
      ['A', 'B'],
    );
  });

  void test('failing tests and no proof', () => {
    assert.deepEqual(keys({ ...NO_FILTER, failing: true }), ['A']);
    assert.deepEqual(keys({ ...NO_FILTER, noEvidence: true }), ['C']);
    assert.deepEqual(keys({ ...NO_FILTER, failing: true, noEvidence: true }), []);
  });
});

/** CI as GitHub reported it (D-083). */
const ci = (patch: Partial<NonNullable<Round['ci']>> = {}): NonNullable<Round['ci']> => ({
  head_sha: 'a'.repeat(40),
  total: 3,
  passed: 3,
  failed: 0,
  pending: 0,
  failed_names: [],
  ...patch,
});

void describe('CI from GitHub (D-083)', () => {
  // **The agent's exit codes and CI disagree on purpose here**: `A` claims a
  // pass and CI failed, `B` claims a failure and CI passed. The CI filters
  // follow CI, and *Failing tests* still follows the claim.
  const items = [
    queued('A', {
      round: round({
        tests: [{ ...item(), command: 'x', exit_code: 0 }],
        ci: ci({ passed: 2, failed: 1, failed_names: ['lint'] }),
      }),
    }),
    queued('B', {
      round: round({ tests: [{ ...item(), command: 'x', exit_code: 1 }], ci: ci() }),
    }),
    queued('C', { round: round({ ci: ci({ passed: 2, pending: 1 }) }) }),
    queued('D', { round: round() }),
  ];
  const keys = (filter: Parameters<typeof filterQueue>[1]) =>
    filterQueue(items, filter).map((i) => i.task.key);

  void test('CI failed and CI confirmed filter by GitHub, not by the claimed exit codes', () => {
    assert.deepEqual(keys({ ...NO_FILTER, ciFailed: true }), ['A']);
    assert.deepEqual(keys({ ...NO_FILTER, ciConfirmed: true }), ['B']);
    assert.deepEqual(keys({ ...NO_FILTER, failing: true }), ['B']);
  });

  void test('a verdict for each case, and none without CI', () => {
    assert.deepEqual(
      items.map((i) => ciVerdict(i.round)),
      ['failed', 'confirmed', 'pending', 'none'],
    );
    assert.equal(ciVerdict(null), 'none');
  });

  void test('the CI line says the server’s sentence', () => {
    assert.equal(ciLine(ci()), 'CI: 3 of 3 checks passed');
    assert.equal(ciLine(ci({ total: 1, passed: 1 })), 'CI: 1 of 1 check passed');
    assert.equal(ciLine(ci({ passed: 2, failed: 1, failed_names: ['lint'] })), 'CI: lint failed');
    assert.equal(ciLine(ci({ passed: 2, pending: 1 })), 'CI: 2 of 3 checks passed, 1 pending');
    assert.equal(
      ciLine(ci({ total: 6, passed: 2, failed: 4, failed_names: ['a', 'b', 'c', 'd'] })),
      'CI: 4 of 6 checks failed',
    );
  });

  void test('proofStamp moves when GitHub changes an item, so an open proof re-reads', () => {
    assert.equal(proofStamp(round()), 0);
    assert.equal(
      proofStamp(
        round({
          commits: [{ ...item(), sha: 'a', message: null }],
          tests: [
            {
              id: 't',
              state: 'confirmed',
              state_source: 'github',
              state_at: 42,
              command: 'x',
              exit_code: 0,
            },
          ],
        }),
      ),
      42,
    );
  });
});

void describe('waitingFor and the small labels', () => {
  void test('reads compactly at every step', () => {
    const now = 10 * 24 * 3_600_000;
    assert.equal(waitingFor(now - 10_000, now), 'just now');
    assert.equal(waitingFor(now - 12 * 60_000, now), '12 min');
    assert.equal(waitingFor(now - 3 * 3_600_000, now), '3 h');
    assert.equal(waitingFor(now - 2 * 24 * 3_600_000, now), '2 d');
    // In words with both units (LAI-830), never a floor that drops 59 minutes.
    assert.equal(waitingFor(now - (3 * 3_600_000 + 12 * 60_000), now), '3 h 12 min');
    assert.equal(waitingFor(now - (2 * 24 + 5) * 3_600_000, now), '2 d 5 h');
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

void describe('who finished a round (D-120, LAI-1001)', () => {
  void test('a registered agent is its harness and device, never the client’s word', () => {
    const r = round({
      client_name: 'omnigent on Belka',
      agent: { id: 'ag1', harness: 'omnigent', device_label: 'Belka' },
      by_registered_agent: true,
    });
    assert.equal(roundAgentName(r), 'Omnigent · Belka');
  });

  void test('no registered agent: the client’s word, marked unregistered; a person: null', () => {
    assert.equal(
      roundAgentName(round({ client_name: 'codex-mcp-client' })),
      'unregistered agent (codex-mcp-client)',
    );
    assert.equal(roundAgentName(round({ client_name: null })), null);
  });

  void test('another person’s agent, withheld by the server, is an agent — never its token name', () => {
    const r = round({ client_name: 'Polly', agent: null, by_registered_agent: true });
    assert.equal(roundAgentName(r), 'an agent');
  });

  void test('a round from before the field reads as unregistered, not as a crash', () => {
    const old = { client_name: 'mcp' } as Parameters<typeof roundAgentName>[0];
    assert.equal(roundAgentName(old), 'unregistered agent (mcp)');
  });
});
