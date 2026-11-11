/**
 * `src/api/profiles.ts` — the member profile's client (LAI-743, D-078).
 *
 * Worth pinning here: the **requests** — each call goes to the path and
 * method §6.4 names, with the body the server's `strictObject` accepts and
 * nothing else. Who is offered a profile is the server's `profile.read`
 * (`GET /permissions`, LAI-970), not a role mirrored here.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getProfile, PROFILE_KINDS, profileHref, setProfileKind } from '../../src/api/profiles.ts';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

function stub(answer: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

void describe('the three requests (§6.4)', () => {
  void test('reads one profile by id, escaped', async () => {
    const calls = stub({ user: { id: 'u 1' } });
    await getProfile('u 1');
    assert.equal(calls[0]?.method, 'GET');
    assert.ok(calls[0]?.url.endsWith('/api/v1/users/u%201/profile'), calls[0]?.url);
  });

  void test('sets the kind with PATCH and only the kind', async () => {
    const calls = stub({ user: { id: 'u1', profile_kind: 'manager' } });
    await setProfileKind('u1', 'manager');
    assert.equal(calls[0]?.method, 'PATCH');
    assert.ok(calls[0]?.url.endsWith('/api/v1/users/u1/profile'));
    assert.deepEqual(calls[0]?.body, { profile_kind: 'manager' });
  });

  void test('the kinds match the server', () => {
    assert.deepEqual([...PROFILE_KINDS], ['builder', 'manager']);
  });
});

void describe('where a profile lives', () => {
  void test('the link is a pasteable URL for the one person', () => {
    assert.equal(profileHref('01ABC'), '/people?user=01ABC');
    assert.equal(profileHref('a&b'), '/people?user=a%26b');
  });
});
