/**
 * `src/api/tasks.ts` (LAI-049) — the query string and the status call.
 *
 * The filter mapping is where a board quietly shows the wrong tasks: a param
 * that is silently dropped looks like "no results", not like a bug.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { changeStatus, listMembers, listTasks } from '../../src/api/tasks.ts';

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

const page = { data: [], next_cursor: null };

void describe('listTasks query string', () => {
  void test('sends no filter params when none are set', async () => {
    const calls = stub(page);
    await listTasks('laika-core');
    assert.equal(calls[0]?.url, '/api/v1/projects/laika-core/tasks');
  });

  void test('maps every filter onto its query param', async () => {
    const calls = stub(page);
    await listTasks('laika-core', {
      status: 'todo',
      priority: 'p1',
      assignee: 'none',
      ready: true,
      limit: 200,
    });

    const query = new URL(calls[0]?.url ?? '', 'http://x').searchParams;
    assert.equal(query.get('status'), 'todo');
    assert.equal(query.get('priority'), 'p1');
    assert.equal(query.get('assignee'), 'none');
    assert.equal(query.get('ready'), 'true');
    assert.equal(query.get('limit'), '200');
  });

  void test('ready=false is sent, not dropped', async () => {
    // `false` is a real filter — "show me what is not ready" — and a truthiness
    // check would silently turn it into "no filter".
    const calls = stub(page);
    await listTasks('p', { ready: false });
    assert.equal(new URL(calls[0]?.url ?? '', 'http://x').searchParams.get('ready'), 'false');
  });

  void test('escapes the slug', async () => {
    const calls = stub(page);
    await listTasks('a project/with slash');
    assert.ok(calls[0]?.url.includes('a%20project%2Fwith%20slash'));
  });
});

void describe('changeStatus', () => {
  void test('posts the status to the task', async () => {
    const calls = stub({ id: 't1' });
    await changeStatus('t1', 'review');

    assert.equal(calls[0]?.url, '/api/v1/tasks/t1/status');
    assert.equal(calls[0]?.init.method, 'POST');
    const body = calls[0]?.init.body;
    assert.equal(typeof body, 'string');
    assert.deepEqual(JSON.parse(body as string), { status: 'review' });
  });

  void test('rejects when the server refuses the transition', async () => {
    // The board depends on this throwing: it is what keeps the card where it
    // was instead of moving it and snapping back.
    stub({ error: { code: 'unprocessable', message: 'done cannot return to backlog' } }, 422);
    await assert.rejects(changeStatus('t1', 'backlog'));
  });
});

void describe('listMembers uses its own envelope, not the page one', () => {
  void test('reads { members: [...] }', async () => {
    // Regression guard. `/members` does not use `{ data, next_cursor }`, and
    // reading `.data` returned undefined — leaving every name on the board and
    // in the detail panel as a raw ULID. It fails silently, so it needs a test.
    stub({
      members: [
        {
          user_id: 'u1',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          role: 'lead',
          created_at: 0,
        },
      ],
    });

    const list = await listMembers('laika-core');
    assert.equal(list.members.length, 1);
    assert.equal(list.members[0]?.name, 'Ada Lovelace');
  });

  void test('escapes the slug', async () => {
    const calls = stub({ members: [] });
    await listMembers('a b/c');
    assert.ok(calls[0]?.url.includes('a%20b%2Fc'));
  });
});
