/**
 * `src/api/profiles.ts` — the member profile's client (LAI-743, D-078).
 *
 * Two kinds of thing are worth pinning here. The **requests**: each call goes
 * to the path and method §6.4 names, with the body the server's `strictObject`
 * accepts and nothing else. And the **gate**: `mayOpenProfiles` mirrors §3.1's
 * `profile.read` row for every org role, so a link is offered to exactly the
 * people the server answers — absent, not disabled, for everyone else.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  attemptKey,
  getProfile,
  mayOpenProfiles,
  mayRate,
  PROFILE_KINDS,
  profileHref,
  rateMember,
  RATING_NOTE_MAX,
  setProfileKind,
} from '../../src/api/profiles.ts';
import { ORG_ROLES } from '../../src/api/invites.ts';

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

  void test('rates with POST, score and note and nothing else', async () => {
    const calls = stub({ id: 'r1', score: 4, note: 'Steady.' }, 201);
    await rateMember('u1', { score: 4, note: 'Steady.' });
    assert.equal(calls[0]?.method, 'POST');
    assert.ok(calls[0]?.url.endsWith('/api/v1/users/u1/ratings'));
    assert.deepEqual(calls[0]?.body, { score: 4, note: 'Steady.' });
  });

  void test('the kinds and the note limit match the server', () => {
    assert.deepEqual([...PROFILE_KINDS], ['builder', 'manager']);
    assert.equal(RATING_NOTE_MAX, 500);
  });
});

void describe('who is offered a profile (§3.1 profile.read)', () => {
  void test('owners and admins, and no other role', () => {
    const offered = ORG_ROLES.filter((role) => mayOpenProfiles(role));
    assert.deepEqual(offered, ['owner', 'admin']);
    // Not a vacuous check: the other roles exist and are refused.
    assert.ok(ORG_ROLES.includes('member') && ORG_ROLES.includes('viewer'));
  });

  void test('nobody before the session is known', () => {
    assert.equal(mayOpenProfiles(undefined), false);
    assert.equal(mayOpenProfiles(''), false);
  });

  void test('an admin may rate anyone but themselves', () => {
    const ada = { id: 'u1', org_role: 'admin' };
    assert.equal(mayRate(ada, 'u2'), true);
    assert.equal(mayRate(ada, 'u1'), false);
    assert.equal(mayRate({ id: 'u3', org_role: 'member' }, 'u2'), false);
    assert.equal(mayRate(undefined, 'u2'), false);
  });

  void test('the link is a pasteable URL for the one person', () => {
    assert.equal(profileHref('01ABC'), '/people?user=01ABC');
    assert.equal(profileHref('a&b'), '/people?user=a%26b');
  });
});

void describe('a rating is sent with its attempt’s key (LAI-746)', () => {
  void test('sends Idempotency-Key when given one, and none when not', async () => {
    const calls = stub({ id: 'r1', score: 4, note: 'Steady.' }, 201);
    await rateMember('u1', { score: 4, note: 'Steady.' }, 'attempt-abc');
    await rateMember('u1', { score: 4, note: 'Steady.' });
    assert.equal(calls[0]?.headers['idempotency-key'], 'attempt-abc');
    assert.equal(calls[1]?.headers['idempotency-key'], undefined);
    // Still JSON: the header joins the content type rather than replacing it.
    assert.equal(calls[0]?.headers['content-type'], 'application/json');
  });

  void test('makes a key without crypto.randomUUID, which plain HTTP does not have', () => {
    // Production is plain HTTP on an IP (HANDOVER §2): not a secure context,
    // so `randomUUID` is undefined there. `getRandomValues` is not gated.
    // Shadowed by an own property and deleted after, which puts the
    // prototype's method back without holding it unbound.
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    try {
      assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
      const keys = new Set(Array.from({ length: 200 }, () => attemptKey()));
      assert.equal(keys.size, 200, 'two attempts shared a key');
      for (const key of keys) assert.match(key, /^rating-[0-9a-f]{32}$/);
    } finally {
      Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
    }
  });
});
