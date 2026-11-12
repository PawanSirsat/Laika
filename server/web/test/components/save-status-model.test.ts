/**
 * `save-status-model.ts` (LAI-1129): the words `SaveStatus` says, and when
 * Retry is worth offering. *Saved* is only ever said for the server's 2xx —
 * the hook moves to it on a resolved save and nowhere else.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, type ErrorCode } from '../../src/api/errors.ts';
import { IDLE, failedWith, saveLine } from '../../src/components/save-status-model.ts';

function apiError(code: ErrorCode, status: number): ApiError {
  return new ApiError(code, `refused ${String(status)}`, status);
}

void describe('SaveStatus words', () => {
  void test('idle says nothing, so the live region is silent until there is news', () => {
    assert.equal(saveLine(IDLE), '');
    assert.equal(saveLine({ kind: 'saving' }), 'Saving…');
    assert.equal(saveLine({ kind: 'saved' }), 'Saved');
    assert.equal(saveLine({ kind: 'failed', message: 'x', retryable: true }), 'Couldn’t save');
  });
});

void describe('Retry only where the same request again could succeed', () => {
  void test('a dropped connection, an internal error or a rate limit is retryable', () => {
    assert.equal(failedWith(new TypeError('Failed to fetch')).retryable, true);
    assert.equal(failedWith(apiError('internal', 500)).retryable, true);
    assert.equal(failedWith(apiError('rate_limited', 429)).retryable, true);
  });

  void test('a refusal of the values or of the person is not', () => {
    const refusals: readonly (readonly [ErrorCode, number])[] = [
      ['bad_request', 400],
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['unprocessable', 422],
    ];
    for (const [code, status] of refusals) {
      assert.equal(failedWith(apiError(code, status)).retryable, false, code);
    }
  });

  void test("the server's message is kept; a cause with none gets a sentence", () => {
    const failed = failedWith(apiError('internal', 500));
    assert.equal(failed.kind, 'failed');
    assert.equal(failed.message, 'refused 500');
    const bare = failedWith('nope');
    assert.equal(bare.message, 'The change was not saved');
  });
});
