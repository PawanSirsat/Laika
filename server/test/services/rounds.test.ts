import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors.ts';
import { EVIDENCE_LIMITS, evidenceItems } from '../../src/services/rounds.ts';

/**
 * `evidenceItems` — the rule both surfaces' proof meets before it is stored
 * (§4.26, D-082, LAI-758). Rounds as a whole, their numbering and the
 * send-back that retires on the next one are asserted through `finishTask` in
 * `review.test.ts`, which is where a round is ever written from.
 */

function refused(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('evidenceItems', () => {
  it('is empty for a finish with no proof — today’s arguments still work', () => {
    expect(evidenceItems({})).toEqual([]);
  });

  it('keeps the order: commits, branch, pull request, then tests', () => {
    const items = evidenceItems({
      tests: [{ command: ' pnpm test ', exit_code: 0 }],
      pull_request: 'https://github.com/o/r/pull/1',
      branch: 'main',
      commits: [{ sha: 'ABCDEF1', message: 'fix: one\nbody' }],
    });

    expect(items.map((i) => [i.kind, i.value, i.detail, i.exitCode])).toEqual([
      ['commit', 'abcdef1', 'fix: one', null],
      ['branch', 'main', null, null],
      ['pull_request', 'https://github.com/o/r/pull/1', null, null],
      ['test_run', 'pnpm test', null, 0],
    ]);
  });

  it('accepts a negative or large exit code: a signal or a Windows status is still a result', () => {
    const items = evidenceItems({
      tests: [
        { command: 'a', exit_code: -9 },
        { command: 'b', exit_code: 3221225477 },
      ],
    });
    expect(items.map((i) => i.exitCode)).toEqual([-9, 3221225477]);
  });

  it.each([
    ['a sha shorter than git abbreviates', { commits: [{ sha: 'abc12' }] }, 'commits'],
    ['a sha longer than 40', { commits: [{ sha: 'a'.repeat(41) }] }, 'commits'],
    ['a pull request on another scheme', { pull_request: 'data:text/html,hi' }, 'pull_request'],
    ['a pull request that is not a URL', { pull_request: 'see the PR' }, 'pull_request'],
    ['an empty branch', { branch: '   ' }, 'branch'],
    [
      'a test command with a control character',
      { tests: [{ command: 'a\u0007', exit_code: 0 }] },
      'tests.command',
    ],
    [
      'a commit message first line over the limit',
      { commits: [{ sha: 'abcdef1', message: 'x'.repeat(EVIDENCE_LIMITS.message + 1) }] },
      'commits.message',
    ],
    [
      'more test runs than the limit',
      {
        tests: Array.from({ length: EVIDENCE_LIMITS.tests + 1 }, () => ({
          command: 'a',
          exit_code: 0,
        })),
      },
      'tests',
    ],
  ])('refuses %s, naming the field', (_label, input, field) => {
    const err = refused(() => evidenceItems(input));
    expect(err.code).toBe('unprocessable');
    expect(err.details).toMatchObject({ field });
  });
});
