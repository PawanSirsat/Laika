/**
 * `src/api/sprints.ts` (LAI-064).
 *
 * `countSprints` is the part with a decision in it. There is no count endpoint
 * and the page envelope carries no total, so it walks the cursor — a count that
 * stopped at page one would put a confidently wrong number in the nav.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  activateSprint,
  addTasksToSprint,
  canAssignToSprints,
  canManageSprints,
  countSprints,
  createSprint,
  deleteSprint,
  listSprints,
  removeTaskFromSprint,
  SPRINT_STATUSES,
  updateSprint,
  type Sprint,
} from '../../src/api/sprints.ts';

function sprint(id: string): Sprint {
  return { id, name: `Sprint ${id}`, goal: null, starts_on: 0, ends_on: 1, status: 'planned' };
}

function stubPages(pages: readonly { data: Sprint[]; next_cursor: string | null }[]): string[] {
  const urls: string[] = [];
  let index = 0;
  globalThis.fetch = ((input: string | URL) => {
    urls.push(input instanceof URL ? input.href : input);
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return Promise.resolve(
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return urls;
}

void describe('listSprints', () => {
  void test('scopes to the project and escapes the slug', async () => {
    const urls = stubPages([{ data: [], next_cursor: null }]);
    await listSprints('a b/c');
    assert.equal(urls[0], '/api/v1/projects/a%20b%2Fc/sprints');
  });

  void test('passes the status filter through', async () => {
    const urls = stubPages([{ data: [], next_cursor: null }]);
    await listSprints('laika-core', { status: 'active' });
    assert.match(urls[0] ?? '', /status=active/);
  });
});

void describe('countSprints', () => {
  void test('counts across every page', async () => {
    const urls = stubPages([
      { data: [sprint('1'), sprint('2')], next_cursor: 'c1' },
      { data: [sprint('3')], next_cursor: null },
    ]);
    assert.equal(await countSprints('laika-core'), 3);
    assert.equal(urls.length, 2);
    assert.match(urls[1] ?? '', /cursor=c1/);
  });

  void test('an empty project counts zero, in one request', async () => {
    const urls = stubPages([{ data: [], next_cursor: null }]);
    assert.equal(await countSprints('laika-core'), 0);
    assert.equal(urls.length, 1);
  });

  void test('counts every sprint, not just the active one', async () => {
    // §4.15 allows at most one `active` sprint per project, so a badge counting
    // those would read 0 or 1 for ever. The count must not filter by status.
    const urls = stubPages([
      {
        data: [
          { ...sprint('1'), status: 'completed' },
          { ...sprint('2'), status: 'active' },
          { ...sprint('3'), status: 'planned' },
        ],
        next_cursor: null,
      },
    ]);
    assert.equal(await countSprints('laika-core'), 3);
    assert.ok(!(urls[0] ?? '').includes('status='), 'the count must not filter by status');
  });

  void test('a server that never stops is capped rather than looping', async () => {
    stubPages([{ data: [sprint('x')], next_cursor: 'always' }]);
    // Returns what it has: a nav badge is not worth failing a page render over.
    assert.equal(await countSprints('laika-core', undefined, 4), 4);
  });
});

void describe('the client vocabulary matches the server', () => {
  void test('SPRINT_STATUSES is exactly what the database allows', async () => {
    // I wrote `complete` here from memory; the column allows `completed`. A
    // `?status=complete` filter is a 400, and nothing in the client would have
    // said so — the type looked right and the tests I had written all used my
    // own wrong value. Read the enum instead of remembering it.
    const enums = await readFile(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
    const match = /SPRINT_STATUSES = \[([^\]]*)\]/.exec(enums);
    assert.notEqual(match, null, 'could not find SPRINT_STATUSES in the server enums');

    const server = (match?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s !== '');

    assert.deepEqual([...SPRINT_STATUSES], server);
  });
});

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/** Record what the client sends, and answer 200 with an empty object. */
function record(): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

void describe('the mutations the sprints screen needs (LAI-083)', () => {
  void test('create posts to the project, escaping the slug', async () => {
    const sent = record();
    await createSprint('a b/c', { name: 'S1', starts_on: 1, ends_on: 2 });

    assert.equal(sent[0]?.url, '/api/v1/projects/a%20b%2Fc/sprints');
    assert.equal(sent[0]?.method, 'POST');
    assert.deepEqual(sent[0]?.body, { name: 'S1', starts_on: 1, ends_on: 2 });
  });

  void test('update patches the sprint by id', async () => {
    const sent = record();
    await updateSprint('s1', { name: 'Renamed' });

    assert.equal(sent[0]?.url, '/api/v1/sprints/s1');
    assert.equal(sent[0]?.method, 'PATCH');
  });

  void test('a null goal is sent, because null clears it and absent does not', async () => {
    // Two different requests server-side: `null` clears the column, omitting the
    // key leaves it alone. A client that dropped nulls could never clear a goal.
    const sent = record();
    await updateSprint('s1', { goal: null });

    assert.deepEqual(sent[0]?.body, { goal: null });
  });

  void test('activate is a status change, not a bespoke endpoint', async () => {
    // There is no `/activate` route: §4.15's one-active rule is enforced on the
    // status transition itself, so inventing a verb here would 404.
    const sent = record();
    await activateSprint('s1');

    assert.equal(sent[0]?.url, '/api/v1/sprints/s1');
    assert.equal(sent[0]?.method, 'PATCH');
    assert.deepEqual(sent[0]?.body, { status: 'active' });
  });

  void test('delete uses DELETE and sends no body', async () => {
    const sent = record();
    await deleteSprint('s1');

    assert.equal(sent[0]?.method, 'DELETE');
    assert.equal(sent[0]?.body, undefined);
  });

  void test('assignment sends every id in one request', async () => {
    // All-or-nothing is a server guarantee (`addTasksToSprint` runs in one
    // transaction). Sending them one at a time would quietly discard it.
    const sent = record();
    await addTasksToSprint('s1', ['t1', 't2', 't3']);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.url, '/api/v1/sprints/s1/tasks');
    assert.deepEqual(sent[0]?.body, { task_ids: ['t1', 't2', 't3'] });
  });

  void test('removal names both ids in the path', async () => {
    const sent = record();
    await removeTaskFromSprint('s1', 't1');

    assert.equal(sent[0]?.url, '/api/v1/sprints/s1/tasks/t1');
    assert.equal(sent[0]?.method, 'DELETE');
  });
});

void describe('who may do what — mirrors policy/can.ts, decides nothing', () => {
  const lead = [{ project_id: 'p1', role: 'lead' }];
  const member = [{ project_id: 'p1', role: 'member' }];
  const viewer = [{ project_id: 'p1', role: 'viewer' }];

  void test('org owner and admin hold implicit lead everywhere (§3)', () => {
    for (const role of ['owner', 'admin']) {
      assert.equal(canManageSprints(role, 'p1', []), true, role);
      assert.equal(canAssignToSprints(role, 'p1', []), true, role);
    }
  });

  void test('managing sprints is lead-only', () => {
    assert.equal(canManageSprints('member', 'p1', lead), true);
    assert.equal(canManageSprints('member', 'p1', member), false);
    assert.equal(canManageSprints('member', 'p1', viewer), false);
    assert.equal(canManageSprints('member', 'p1', []), false);
  });

  void test('assigning tasks is member and above — a wider cell than managing', () => {
    // §3.2 separates `sprint.manage` (lead) from `task.assign_sprint` (member+).
    // Collapsing them into one helper would silently hide assignment from every
    // Member, which is the more common role on any real board.
    assert.equal(canAssignToSprints('member', 'p1', member), true);
    assert.equal(canManageSprints('member', 'p1', member), false);
    assert.equal(canAssignToSprints('viewer', 'p1', viewer), false);
  });

  void test('a membership in another project grants nothing here', () => {
    assert.equal(canManageSprints('member', 'p2', lead), false);
    assert.equal(canAssignToSprints('member', 'p2', member), false);
  });
});
