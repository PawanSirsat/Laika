/**
 * The cache as `request` uses it (LAI-724, D-075).
 *
 * `query-cache.test.ts` pins the mechanism; this pins the policy in
 * `client.ts` and the wiring in `store.ts`: which answers are reused, that a
 * write makes them stale, and that the session's user decides whose they are.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { freshFor } from '../../src/api/client.ts';
import { getProject, setHideDoneAfter } from '../../src/api/projects.ts';
import { setStoreUser, taskStore } from '../../src/api/store.ts';
import { listMembers, listTasks } from '../../src/api/tasks.ts';

const calls: string[] = [];

function stub(body: (url: string) => unknown): void {
  calls.length = 0;
  globalThis.fetch = ((input: string | URL) => {
    const url = input instanceof URL ? input.href : input;
    calls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
}

afterEach(() => {
  setStoreUser(undefined);
});

void describe('which answers may be reused (client.ts)', () => {
  void test('small, slow-changing lists for 30s; presence for a moment; everything else never', () => {
    assert.equal(freshFor('/projects?limit=200'), 30_000);
    assert.equal(freshFor('/projects/laika-core'), 30_000);
    for (const list of ['members', 'mentionable', 'sprints', 'tags', 'board-columns']) {
      assert.equal(freshFor(`/projects/laika-core/${list}`), 30_000, list);
    }
    assert.equal(freshFor('/projects/laika-core/meeting-reviews?limit=200'), 30_000);
    assert.equal(freshFor('/org'), 30_000);
    assert.equal(freshFor('/presence'), 2_000);
    // The task set is the store's, kept current by the stream, never by age.
    assert.equal(freshFor('/projects/laika-core/tasks?limit=200'), 0);
    assert.equal(freshFor('/projects/laika-core/activity?limit=200'), 0);
    assert.equal(freshFor('/projects/laika-core/metrics'), 0);
    assert.equal(freshFor('/me'), 0);
    assert.equal(freshFor('/tasks/01ABC'), 0);
    assert.equal(freshFor('/capacity'), 0);
  });
});

void describe('request reads through the cache once a user is known', () => {
  void test('the frame and a screen asking for members at once is one request', async () => {
    stub(() => ({ members: [] }));
    setStoreUser('u1');
    await Promise.all([listMembers('laika-core'), listMembers('laika-core')]);
    await listMembers('laika-core');
    assert.equal(calls.length, 1, `members was requested ${String(calls.length)} times`);
  });

  void test('signed out, nothing is shared', async () => {
    stub(() => ({ members: [] }));
    await Promise.all([listMembers('laika-core'), listMembers('laika-core')]);
    assert.equal(calls.length, 2);
  });

  void test('a task page is never reused once settled', async () => {
    stub(() => ({ data: [], next_cursor: null }));
    setStoreUser('u1');
    await listTasks('laika-core', { limit: 200 });
    await listTasks('laika-core', { limit: 200 });
    assert.equal(calls.length, 2);
  });

  void test('any write makes the cached answers stale', async () => {
    stub((url) => (url.endsWith('/projects/laika-core') ? { slug: 'laika-core' } : {}));
    setStoreUser('u1');
    await getProject('laika-core');
    await getProject('laika-core');
    assert.equal(calls.length, 1);
    await setHideDoneAfter('laika-core', 7);
    await getProject('laika-core');
    assert.equal(calls.length, 3, 'a read after a write was served the answer from before it');
  });

  void test('a different user is served nothing the last one was', async () => {
    let who = 'alice';
    stub(() => ({ members: [{ user_id: who }] }));
    setStoreUser('u1');
    await listMembers('laika-core');
    who = 'bob';
    setStoreUser('u2');
    const answer = await listMembers('laika-core');
    assert.equal(answer.members[0]?.user_id, 'bob');
    assert.equal(calls.length, 2);
  });

  void test('a change of user also drops the task store', () => {
    stub(() => ({ data: [], next_cursor: null }));
    setStoreUser('u1');
    const stop = taskStore.subscribe('laika-core', () => undefined);
    assert.notEqual(taskStore.peek('laika-core'), undefined);
    setStoreUser(undefined);
    assert.equal(taskStore.peek('laika-core'), undefined, 'the task set survived sign-out');
    stop();
  });
});
