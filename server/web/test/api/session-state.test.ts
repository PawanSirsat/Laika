/**
 * `src/api/session-state.ts` (LAI-087).
 *
 * The owner opened a screen of grey skeleton bars that never resolved. The
 * cause was not a wrong branch — it was a **missing** one: the session hook
 * recognised `401` and left everything else to fall through, so any other
 * failure kept the app on `loading` for ever.
 *
 * These tests exist to be **total**. Every status the server can answer with has
 * to land on a rendered state, so the interesting case is not `401` or `409` —
 * it is the one nobody thought of.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, NetworkError } from '../../src/api/errors.ts';
import {
  isSetupRequired,
  sessionFromFailure,
  SESSION_TIMEOUT_MS,
} from '../../src/api/session-state.ts';

/** The gate's real body, from `http/middleware/setup-gate.ts`. */
function setupGate409(): ApiError {
  return new ApiError('conflict', 'This Laika has not been set up yet', 409, {
    setup_required: true,
    setup_path: '/setup',
  });
}

void describe('sessionFromFailure covers every failure, not the two we remember', () => {
  void test('401 is the normal signed-out case', () => {
    assert.deepEqual(sessionFromFailure(new ApiError('unauthorized', 'Not signed in', 401)), {
      status: 'anonymous',
    });
  });

  void test('the setup gate 409 asks for first boot, not an error', () => {
    // There is a screen that fixes this, so sending the reader there beats
    // describing the problem to them.
    assert.deepEqual(sessionFromFailure(setupGate409()), { status: 'setup-required' });
  });

  void test('every other status resolves to a rendered error', () => {
    // The point of the whole task. None of these may leave the app loading.
    const failures: readonly unknown[] = [
      new ApiError('forbidden', 'Nope', 403),
      new ApiError('not_found', 'Gone', 404),
      new ApiError('unprocessable', 'Bad', 422),
      new ApiError('conflict', 'A different conflict', 409),
      new ApiError('internal', 'Boom', 500),
      new NetworkError('unreachable'),
      new Error('something nobody predicted'),
      'a bare string',
      undefined,
      null,
    ];

    for (const cause of failures) {
      const state = sessionFromFailure(cause);
      assert.equal(
        state.status,
        'error',
        `${String(cause)} must resolve to a rendered state, not a skeleton`,
      );
    }
  });

  void test('no failure ever maps back to loading', () => {
    // Stated separately because it is the actual defect, and it should fail
    // loudly if anyone adds a branch that returns `loading` to "wait and see".
    const everything: readonly unknown[] = [
      new ApiError('unauthorized', '', 401),
      setupGate409(),
      new ApiError('internal', '', 500),
      new NetworkError('x'),
      new Error('x'),
      null,
    ];
    const statuses = everything.map((c) => sessionFromFailure(c).status);
    assert.ok(!statuses.includes('loading'), `got ${statuses.join(', ')}`);
  });
});

void describe('isSetupRequired reads the flag, not the prose', () => {
  void test('true only for a conflict carrying setup_required', () => {
    assert.equal(isSetupRequired(setupGate409()), true);
  });

  void test('a conflict without the flag is an ordinary conflict', () => {
    // "A project must keep at least one lead" is also a 409, and must not send
    // anyone to first boot.
    assert.equal(
      isSetupRequired(new ApiError('conflict', 'A project must keep at least one lead', 409)),
      false,
    );
  });

  void test('the message is never matched', () => {
    // Prose gets reworded; the flag is the contract.
    const worded = new ApiError('conflict', 'This Laika has not been set up yet', 409, {});
    assert.equal(isSetupRequired(worded), false);
  });

  void test('non-conflict statuses are never setup', () => {
    assert.equal(isSetupRequired(new ApiError('unauthorized', '', 401)), false);
    assert.equal(isSetupRequired(new NetworkError('x')), false);
    assert.equal(isSetupRequired(null), false);
  });
});

void describe('the skeleton has a ceiling', () => {
  void test('it is long enough for a slow instance and short enough to notice', () => {
    // Not a magic number left unexamined: too short and a working-but-slow
    // instance shows a false failure; too long and the reader waits at a
    // spinner that will never resolve.
    assert.ok(SESSION_TIMEOUT_MS >= 3000, 'too eager — a slow instance would look broken');
    assert.ok(SESSION_TIMEOUT_MS <= 15000, 'too patient — this is the bug being fixed');
  });
});
