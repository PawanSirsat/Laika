/**
 * `/project-setups` from the client (LAI-1066): the reader's records for one
 * project and tool, and *I've added it* sent as the board's record — the
 * slug and id encoded, and nothing in the body but the four fields.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { listProjectSetups, recordSelfReport } from '../../src/api/project-setups.ts';

interface Seen {
  url: string;
  method: string;
  body: unknown;
}

let seen: Seen[] = [];
let reply: unknown = { data: [] };
const realFetch = globalThis.fetch;

beforeEach(() => {
  seen = [];
  reply = { data: [] };
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

void describe('listProjectSetups', () => {
  void test('asks for one project and one tool, encoded, and returns the rows', async () => {
    reply = { data: [{ id: 's1' }] };
    const rows = await listProjectSetups('on route', 'a/1');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.method, 'GET');
    assert.match(
      seen[0]?.url ?? '',
      /\/api\/v1\/project-setups\?project=on\+route&agent_id=a%2F1$/,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['s1'],
    );
  });

  void test('without a tool, asks for the project only', async () => {
    await listProjectSetups('onroute');
    assert.match(seen[0]?.url ?? '', /\/api\/v1\/project-setups\?project=onroute$/);
  });
});

void describe('recordSelfReport', () => {
  void test('posts the reader’s word: the tool, the project, the revision and the file', async () => {
    reply = { id: 's1', source: 'self_reported_browser' };
    const made = await recordSelfReport({
      agentId: 'a1',
      projectSlug: 'onroute',
      templateRevision: 2,
      instructionsPath: 'CLAUDE.md',
    });
    assert.equal(seen[0]?.method, 'POST');
    assert.match(seen[0]?.url ?? '', /\/api\/v1\/project-setups$/);
    assert.deepEqual(seen[0]?.body, {
      agent_id: 'a1',
      project_slug: 'onroute',
      template_revision: 2,
      instructions_path: 'CLAUDE.md',
    });
    assert.equal(made.source, 'self_reported_browser');
  });
});
