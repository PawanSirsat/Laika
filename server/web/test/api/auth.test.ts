/**
 * `src/api/auth.ts` — why a sign-in failed, not just that it did (LAI-220).
 *
 * LAI-078 collapsed every `SignInError` into "rejected credentials". A `429`
 * from better-auth's limiter then rendered *"Email or password is wrong."* to
 * someone whose password was **right** — measured on a running instance: five
 * rapid failures, then the correct password, and the form still blamed it.
 * They retry, stay limited, and conclude they have forgotten it.
 *
 * The exemption for `api/auth.ts` in `WEB_NO_MIRROR_REQUIRED` said it was a
 * "thin better-auth boundary". It stopped being thin the moment a caller had to
 * ask it *why*.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { isCredentialRejection, signIn, SignInError } from '../../src/api/auth.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, body: unknown): void {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

/** better-auth's real 401, as the server wraps it. */
const REJECTED = {
  error: {
    code: 'unauthorized',
    message: 'Invalid email or password',
    details: { message: 'Invalid email or password', auth_code: 'INVALID_EMAIL_OR_PASSWORD' },
  },
};

/** better-auth's real 429, copied from a running instance in production. */
const LIMITED = {
  error: {
    code: 'rate_limited',
    message: 'Too many requests. Please try again later.',
    details: { message: 'Too many requests. Please try again later.' },
  },
};

const CREDENTIALS = { email: 'a@b.c', password: 'a-long-password', rememberMe: false };

async function failure(status: number, body: unknown): Promise<SignInError> {
  stub(status, body);
  try {
    await signIn(CREDENTIALS);
  } catch (cause) {
    assert.ok(cause instanceof SignInError, `expected SignInError, got ${String(cause)}`);
    return cause;
  }
  throw new Error('signIn resolved when it should have thrown');
}

void describe('a failed sign-in carries why it failed', () => {
  void test('401 is a credential rejection', async () => {
    const error = await failure(401, REJECTED);
    assert.equal(error.status, 401);
    assert.equal(isCredentialRejection(error), true);
  });

  void test('429 is NOT a credential rejection', async () => {
    // The whole point. The password may be perfectly correct.
    const error = await failure(429, LIMITED);
    assert.equal(error.status, 429);
    assert.equal(isCredentialRejection(error), false);
  });

  void test('the rate-limit message survives, rather than being replaced', async () => {
    // It is the only accurate thing available. "Email or password is wrong"
    // would be a guess about a password that was never checked.
    const error = await failure(429, LIMITED);
    assert.match(error.message, /Too many requests/);
    assert.ok(!/password is wrong/i.test(error.message));
  });

  void test('a server fault is not the reader’s credentials either', async () => {
    for (const status of [500, 502, 503]) {
      const error = await failure(status, {
        error: { code: 'internal', message: 'Something broke', details: null },
      });
      assert.equal(
        isCredentialRejection(error),
        false,
        `${String(status)} was treated as a wrong password`,
      );
    }
  });

  void test('nothing but a 401 is ever a rejection', () => {
    // Guards the shape of the check itself: an implementation that tested the
    // class, or truthiness of `status`, would pass every case above but this.
    for (const status of [400, 403, 404, 409, 422, 429, 500]) {
      assert.equal(
        isCredentialRejection(new SignInError('x', undefined, status)),
        false,
        `${String(status)} counted as a credential rejection`,
      );
    }
    assert.equal(isCredentialRejection(new SignInError('x', undefined, 401)), true);
  });

  void test('a non-SignInError is never a rejection', () => {
    for (const other of [new Error('offline'), null, undefined, 'a string']) {
      assert.equal(isCredentialRejection(other), false);
    }
  });
});
