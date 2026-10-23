/**
 * A reset link's refusals, read from the envelope (D-104 item 4, LAI-988).
 * The browser tests drive `/reset-password`; these pin each `reason` the
 * server sends to the state the page shows.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import { resetRefusal } from '../../src/api/password-resets.ts';

const refused = (
  code: ConstructorParameters<typeof ApiError>[0],
  status: number,
  details: unknown,
) => new ApiError(code, 'the server’s words', status, details);

void describe('a refused reset link', () => {
  void test('maps every reason the server sends', () => {
    assert.equal(resetRefusal(refused('not_found', 404, { reason: 'unknown' })), 'unknown');
    for (const reason of ['used', 'revoked', 'expired'] as const) {
      assert.equal(resetRefusal(refused('conflict', 409, { reason })), reason);
    }
    assert.equal(resetRefusal(refused('forbidden', 403, { reason: 'inactive' })), 'inactive');
    assert.equal(
      resetRefusal(refused('rate_limited', 429, { retry_after_seconds: 3 })),
      'throttled',
    );
  });

  void test('anything else is the form’s to show, not a dead link', () => {
    assert.equal(resetRefusal(refused('unprocessable', 422, { field: 'new_password' })), undefined);
    assert.equal(resetRefusal(new Error('offline')), undefined);
  });
});
