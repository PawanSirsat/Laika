/**
 * `src/api/tasks.ts` (LAI-049) — the query string and the status call.
 *
 * The filter mapping is where a board quietly shows the wrong tasks: a param
 * that is silently dropped looks like "no results", not like a bug.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import {
  assignTask,
  canAssignOthers,
  claimTask,
  claimWinner,
  canCreateTask,
  changeStatus,
  createTask,
  listMembers,
  listTasks,
} from '../../src/api/tasks.ts';

interface Call {
  url: string;
  init: RequestInit;
}

/** The JSON a call sent, parsed. */
function body(call: Call | undefined): Record<string, unknown> {
  const raw = call?.init.body;
  assert.equal(typeof raw, 'string');
  return JSON.parse(raw as string) as Record<string, unknown>;
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

void describe('createTask (LAI-065)', () => {
  void test('posts to the project and sends created_via: web', async () => {
    const calls = stub({ id: 't1', key: 'LC-1', title: 'Ship it' });
    await createTask('laika-core', { title: 'Ship it', priority: 'p1' });

    assert.equal(calls[0]?.url, '/api/v1/projects/laika-core/tasks');
    assert.equal(calls[0]?.init.method, 'POST');

    const sent = body(calls[0]);
    assert.equal(sent.title, 'Ship it');
    assert.equal(sent.priority, 'p1');
    // §9 attributes activity by this. A task made in the browser that claims to
    // have come from an agent is a lie in the audit trail.
    assert.equal(sent.created_via, 'web');
  });

  void test('omits optional fields rather than sending undefined', async () => {
    // The body is strict — an unrecognised or malformed key is 422, not ignored.
    const calls = stub({ id: 't1' });
    await createTask('laika-core', { title: 'Just a title' });
    const sent = body(calls[0]);
    assert.deepEqual(Object.keys(sent).sort(), ['created_via', 'title']);
  });

  void test('escapes the slug', async () => {
    const calls = stub({ id: 't1' });
    await createTask('a b/c', { title: 'x' });
    assert.equal(calls[0]?.url, '/api/v1/projects/a%20b%2Fc/tasks');
  });
});

void describe('canCreateTask (LAI-065)', () => {
  const project = 'p1';
  const member = [{ project_id: project, role: 'member' }];
  const lead = [{ project_id: project, role: 'lead' }];
  const viewerRow = [{ project_id: project, role: 'viewer' }];

  void test('org owner and admin may, with no membership row at all', () => {
    // They hold implicit lead everywhere (policy/can.ts).
    assert.equal(canCreateTask('owner', project, []), true);
    assert.equal(canCreateTask('admin', project, []), true);
  });

  void test('project lead and member may', () => {
    assert.equal(canCreateTask('member', project, lead), true);
    assert.equal(canCreateTask('member', project, member), true);
  });

  void test('a project viewer may not', () => {
    assert.equal(canCreateTask('member', project, viewerRow), false);
  });

  void test('an org viewer may not, whatever their membership row says', () => {
    // D-006: a row claiming otherwise is corruption or an escalation attempt,
    // and the server caps it. The UI must agree or it offers a button that 403s.
    assert.equal(canCreateTask('viewer', project, lead), false);
    assert.equal(canCreateTask('viewer', project, member), false);
  });

  void test('no membership in this project means no', () => {
    assert.equal(canCreateTask('member', project, [{ project_id: 'other', role: 'lead' }]), false);
  });
});

void describe('assignment (LAI-097)', () => {
  void test('assignTask sends the id, and null to unassign', async () => {
    let calls = stub({ id: 't1' });
    await assignTask('t1', 'u9');
    assert.equal(calls[0]?.url, '/api/v1/tasks/t1');
    assert.equal(calls[0]?.init.method, 'PATCH');
    assert.equal(body(calls[0]).assignee_id, 'u9');

    calls = stub({ id: 't1' });
    await assignTask('t1', null);
    // `null` clears; absent would mean "leave it alone". They are different
    // requests, so the key is always sent.
    assert.ok('assignee_id' in body(calls[0]));
    assert.equal(body(calls[0]).assignee_id, null);
  });

  void test('claimTask posts to the compare-and-swap endpoint', async () => {
    const calls = stub({ id: 't1' });
    await claimTask('t1');
    assert.equal(calls[0]?.url, '/api/v1/tasks/t1/claim');
    assert.equal(calls[0]?.init.method, 'POST');
  });

  void test('claimWinner reads the winner out of a losing 409', () => {
    // The whole point of the compare-and-swap: the server says who got there
    // first, and a generic failure would throw that away.
    const lost = new ApiError('conflict', 'That task is already claimed', 409, {
      assignee_id: 'u-sana',
    });
    assert.equal(claimWinner(lost), 'u-sana');
  });

  void test('claimWinner is undefined for anything else', () => {
    assert.equal(claimWinner(new ApiError('conflict', 'A different conflict', 409)), undefined);
    assert.equal(claimWinner(new ApiError('forbidden', 'no', 403)), undefined);
    assert.equal(claimWinner(new Error('boom')), undefined);
    assert.equal(claimWinner(null), undefined);
  });

  void test('a Viewer may not assign others', () => {
    // `task.assign_other` is member+ (§3.2), so this mirrors task creation.
    assert.equal(canAssignOthers('viewer', 'p1', [{ project_id: 'p1', role: 'lead' }]), false);
    assert.equal(canAssignOthers('member', 'p1', [{ project_id: 'p1', role: 'member' }]), true);
    assert.equal(canAssignOthers('owner', 'p1', []), true);
  });
});
