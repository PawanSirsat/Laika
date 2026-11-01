/**
 * `GET /agents/:id/project-access` from the client (LAI-1052): one request,
 * both ids encoded, nothing sent but the query.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { getProjectAccess } from '../../src/api/project-access.ts';

interface Seen {
  url: string;
  method: string;
  body: unknown;
}

let seen: Seen[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  seen = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, method: init?.method ?? 'GET', body: init?.body });
    return Promise.resolve(
      new Response(JSON.stringify({ agent_id: 'a/1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

void describe('getProjectAccess', () => {
  void test('asks for one agent and one project, both encoded, with no body', async () => {
    const answer = await getProjectAccess('a/1', 'on route');
    assert.equal(seen.length, 1);
    const call = seen[0];
    assert.equal(call?.method, 'GET');
    assert.equal(call?.body, undefined);
    assert.match(call?.url ?? '', /\/api\/v1\/agents\/a%2F1\/project-access\?project=on%20route$/);
    assert.equal(answer.agent_id, 'a/1');
  });
});
