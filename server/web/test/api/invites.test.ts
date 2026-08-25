/**
 * `src/api/invites.ts` (LAI-077).
 *
 * Two of these calls are **pre-auth** — the holder has no account, which is what
 * they are here to fix. The parts worth asserting are the ones a screen cannot
 * see: that the token is escaped into the path, and that `email` is *omitted*
 * rather than sent as `null` for an email-bound invite, because the accept body
 * is a strict schema that refuses unknown and mismatched keys.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { acceptInvite, previewInvite, INVITE_REFUSED_REASON } from '../../src/api/invites.ts';

interface Captured {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * The captured request body, as JSON.
 *
 * Asserts it is a string first rather than casting: `RequestInit['body']` is a
 * `BodyInit`, so a `String()` on it would happily produce `[object Object]` and
 * the parse would fail somewhere less obvious than here.
 */
function jsonBody(captured: Captured | undefined): Record<string, unknown> {
  const body = captured?.init?.body;
  assert.equal(typeof body, 'string', 'expected a JSON string body');
  return JSON.parse(body as string) as Record<string, unknown>;
}

function stub(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

const PREVIEW = {
  org_name: 'Kvelld',
  inviter_name: 'Ada Lovelace',
  org_role: 'member',
  project_id: null,
  project_name: null,
  project_role: null,
  email: 'newcomer@example.com',
  expires_at: 1788226848628,
};

void describe('previewInvite', () => {
  void test('puts the token in the path, escaped', async () => {
    const calls = stub(200, PREVIEW);
    await previewInvite('abc/../admin');
    // A token is opaque and attacker-supplied. Unescaped, `/../` would walk the
    // path to a different endpoint entirely.
    assert.match(calls[0]?.url ?? '', /\/invites\/abc%2F\.\.%2Fadmin$/);
  });

  void test('is a GET with no body — there is no session to send', async () => {
    const calls = stub(200, PREVIEW);
    await previewInvite('tok');
    const method = calls[0]?.init?.method ?? 'GET';
    assert.equal(method, 'GET');
    assert.equal(calls[0]?.init?.body, undefined);
  });
});

void describe('acceptInvite', () => {
  void test('omits email entirely for an email-bound invite', async () => {
    const calls = stub(201, { user_id: 'u', email: 'a@b.c', org_role: 'member', project_id: null });
    await acceptInvite({ token: 'tok', name: 'Ada', password: 'a-long-password' });

    const body = jsonBody(calls[0]);
    // Not `null`, not `undefined` — absent. The body is a strict schema, and the
    // server takes the address from the invite in this case.
    assert.ok(!('email' in body), `email should be absent, got ${JSON.stringify(body)}`);
    assert.deepEqual(Object.keys(body).sort(), ['name', 'password', 'token']);
  });

  void test('sends email for a link invite, which is bound to no address', async () => {
    const calls = stub(201, { user_id: 'u', email: 'a@b.c', org_role: 'viewer', project_id: null });
    await acceptInvite({
      token: 'tok',
      name: 'Grace',
      password: 'a-long-password',
      email: 'grace@example.com',
    });

    const body = jsonBody(calls[0]);
    assert.equal(body.email, 'grace@example.com');
  });

  void test('is a POST to /invites/accept', async () => {
    const calls = stub(201, { user_id: 'u', email: 'a@b.c', org_role: 'member', project_id: null });
    await acceptInvite({ token: 'tok', name: 'Ada', password: 'a-long-password' });
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.match(calls[0]?.url ?? '', /\/invites\/accept$/);
  });
});

void describe('the refusal wording is the server’s, not ours', () => {
  void test('it names all three possibilities', () => {
    // The server answers one status for unknown, expired and already-spent, on
    // purpose, so that posting guesses cannot confirm a token exists. A client
    // that said "expired" would be guessing with two-in-three odds.
    for (const word of ['invalid', 'expired', 'already used']) {
      assert.ok(
        INVITE_REFUSED_REASON.includes(word),
        `"${word}" missing — the message would imply the server told us which`,
      );
    }
  });
});
