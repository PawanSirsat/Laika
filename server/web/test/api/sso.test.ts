/**
 * `src/api/sso.ts` — Organisation → Security's Sign-in card (LAI-1239,
 * LAI-1317): each call's method, path and body, and a directory failure in
 * words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { directoryErrorWords, getSsoSettings, syncDirectoryNow } from '../../src/api/sso.ts';

const ANSWER = {
  sign_in: 'microsoft',
  microsoft: {
    tenant_id: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    client_id: '11111111-2222-3333-4444-555555555555',
    redirect_uri: 'https://laika.example/api/v1/auth/callback/microsoft',
    directory_sync: { enabled: true, every_minutes: 15, last_run: null },
  },
};

const sent: { url: string; method: string; body: unknown; signal: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    signal: init?.signal,
  });
  return Promise.resolve(
    new Response(JSON.stringify(ANSWER), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4, LAI-1239)', () => {
  void test('GET /org/sso and POST /org/sso/directory-sync, written out whole', async () => {
    sent.length = 0;
    const read = await getSsoSettings();
    const synced = await syncDirectoryNow();

    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/org/sso', undefined],
        ['POST', '/api/v1/org/sso/directory-sync', {}],
      ],
    );
    // The body comes back as the server sent it — nothing renamed on the way.
    assert.deepEqual(read, ANSWER);
    assert.deepEqual(synced, ANSWER);
  });

  void test('the read passes its abort signal through', async () => {
    sent.length = 0;
    const controller = new AbortController();
    await getSsoSettings(controller.signal);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.signal, controller.signal);
  });
});

void describe('a directory failure, in words', () => {
  void test('a refused listing says which permission to grant', () => {
    assert.match(
      directoryErrorWords('graph_forbidden_grant_user_read_all'),
      /User\.Read\.All application permission and grant admin consent/,
    );
  });

  void test('a refused app sign-in names the code and the likely cause', () => {
    const words = directoryErrorWords('token_401');
    assert.match(words, /\(token_401\)/);
    assert.match(words, /client secret has not expired/);
  });

  void test('Microsoft out of reach says it will try again — the token endpoint too', () => {
    // `token_unreachable` is a network failure, not a refused secret: it once
    // took the `token_` branch and told the admin to check the secret.
    for (const code of ['graph_unreachable', 'token_unreachable']) {
      assert.equal(directoryErrorWords(code), 'Microsoft could not be reached. It will try again.');
    }
  });

  void test('anything else still names its code', () => {
    assert.equal(
      directoryErrorWords('graph_malformed'),
      'The directory could not be read (graph_malformed).',
    );
  });
});
