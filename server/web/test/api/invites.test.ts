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
import {
  INVITE_REFUSED_REASON,
  acceptInvite,
  canManageOrg,
  createInvite,
  listInvites,
  previewInvite,
  revokeInvite,
} from '../../src/api/invites.ts';

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

    // A 204 may not carry a body — `new Response('null', { status: 204 })`
    // throws, and the throw surfaces as a NetworkError from `request()`, which
    // looks like the instance being unreachable rather than a broken stub.
    // `revokeInvite` really does answer 204, so this matters here.
    const empty = status === 204 || status === 205 || status === 304;
    return Promise.resolve(
      new Response(empty ? null : JSON.stringify(body), {
        status,
        ...(empty ? {} : { headers: { 'content-type': 'application/json' } }),
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

void describe('managing invites from the organisation screen (LAI-086)', () => {
  void test('a link invite sends email: null rather than omitting it', async () => {
    const calls = stub(201, { invite: {}, token: 't', accept_url: 'u' });
    await createInvite({ email: null, org_role: 'member' });

    const body = jsonBody(calls[0]);
    // The schema spells "no address" and "absent" the same way on purpose, so a
    // client that means a link invite should say so rather than rely on the
    // default. `'email' in body` distinguishes the two; truthiness does not.
    assert.ok('email' in body, 'email was omitted, not sent as null');
    assert.equal(body.email, null);
    assert.equal(body.org_role, 'member');
  });

  void test('revoke escapes the id into the path', async () => {
    const calls = stub(204, null);
    await revokeInvite('abc/../../users');
    assert.match(calls[0]?.url ?? '', /\/invites\/abc%2F\.\.%2F\.\.%2Fusers$/);
    assert.equal(calls[0]?.init?.method, 'DELETE');
  });

  void test('listing invites is a plain GET', async () => {
    const calls = stub(200, { data: [], next_cursor: null });
    await listInvites();
    assert.match(calls[0]?.url ?? '', /\/invites$/);
    assert.equal(calls[0]?.init?.method ?? 'GET', 'GET');
  });
});

void describe('canManageOrg matches SPEC §3.1, and the server', () => {
  void test('Owner and Admin may; Member and Viewer may not', () => {
    // §3.1 "Invite users / change org roles" is Owner and Admin only.
    // Confirmed against a running instance: a viewer gets 403 on GET /invites
    // and 200 on GET /users, which is exactly this split.
    assert.equal(canManageOrg('owner'), true);
    assert.equal(canManageOrg('admin'), true);
    assert.equal(canManageOrg('member'), false);
    assert.equal(canManageOrg('viewer'), false);
  });

  void test('an unknown role is refused, not waved through', () => {
    // A role this build has not heard of is a newer server, and guessing
    // permissive is the wrong way to be wrong.
    for (const unknown of ['', 'root', 'superuser', 'OWNER', 'Admin']) {
      assert.equal(canManageOrg(unknown), false, `${unknown} was allowed`);
    }
  });
});
