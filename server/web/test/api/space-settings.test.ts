/**
 * `src/api/space-settings.ts` (LAI-977): the two calls the settings page
 * makes, and how a refusal finds its field.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import { leaveSpace, settingsFieldErrors, updateSpace } from '../../src/api/space-settings.ts';

interface Call {
  url: string;
  init: RequestInit;
}

function stub(response: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

void describe('updateSpace', () => {
  void test('PATCHes the space by slug with exactly the fields given', async () => {
    const calls = stub({ id: 'p1' });
    await updateSpace('laika core', { prefix: 'LK', repo: null });
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? '', /\/api\/v1\/projects\/laika%20core$/);
    assert.equal(calls[0]?.init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { prefix: 'LK', repo: null });
  });
});

void describe('leaveSpace', () => {
  void test('POSTs to /leave and hands back what the server said', async () => {
    const answer = { slug: 'laika', implicit_access: true, notice: 'You can still open it.' };
    const calls = stub(answer);
    assert.deepEqual(await leaveSpace('laika'), answer);
    assert.match(calls[0]?.url ?? '', /\/api\/v1\/projects\/laika\/leave$/);
    assert.equal(calls[0]?.init.method, 'POST');
  });

  void test('a last-admin refusal rejects with the server’s words', async () => {
    const message =
      'You are the last space admin here — make someone else a space admin, then leave';
    stub({ error: { code: 'conflict', message, details: { reason: 'last_lead' } } }, 409);
    await assert.rejects(leaveSpace('laika'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'conflict');
      assert.equal(error.message, message);
      return true;
    });
  });
});

void describe('settingsFieldErrors', () => {
  void test('a 409 lands on the field its details name', () => {
    const error = new ApiError('conflict', '"OLD" was another space’s prefix', 409, {
      field: 'prefix',
      reason: 'former',
    });
    assert.deepEqual(settingsFieldErrors(error), { prefix: '"OLD" was another space’s prefix' });
  });

  void test('a 422 lands on each field its issues name', () => {
    const error = new ApiError('unprocessable', 'Invalid request body', 422, {
      issues: [{ path: 'name', message: 'Too short', code: 'too_small' }],
    });
    assert.deepEqual(settingsFieldErrors(error), { name: 'Too short' });
  });

  void test('anything else names no field, so the caller says it whole', () => {
    assert.deepEqual(settingsFieldErrors(new ApiError('conflict', 'busy', 409, null)), {});
    assert.deepEqual(settingsFieldErrors(new ApiError('forbidden', 'no', 403, null)), {});
    assert.deepEqual(settingsFieldErrors(new Error('network')), {});
  });
});
