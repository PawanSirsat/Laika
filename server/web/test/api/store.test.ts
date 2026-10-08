/**
 * `src/api/store.ts` — the client store, wired (LAI-724, D-075).
 *
 * `query-cache.test.ts`, `task-store.test.ts` and `activity-store.test.ts` pin
 * the mechanisms; this pins how they are put together: the policy in
 * `client.ts` (which answers are reused), that a write makes them stale, and
 * that `setStoreUser` — the session — decides whose they are, for the cache
 * and the task store alike.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { freshFor } from '../../src/api/client.ts';
import { getOrg } from '../../src/api/org.ts';
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

/*
 * **Another project's answers go on a switch** (LAI-724 review, B1). The cache
 * kept every project's lists for the session; the task store already held only
 * the current project, and now the cache follows it.
 */
void describe('switching project', () => {
  void test('drops the last project’s cached lists, and keeps the org-wide ones', async () => {
    stub((url) =>
      url.includes('/tasks')
        ? { data: [], next_cursor: null }
        : url.endsWith('/org')
          ? {}
          : { members: [] },
    );
    setStoreUser('u1');
    await listMembers('alpha');
    await getOrg();
    const stopAlpha = taskStore.subscribe('alpha', () => undefined);
    stopAlpha();
    await new Promise((done) => setTimeout(done, 10));
    const before = calls.length;

    const stopBeta = taskStore.subscribe('beta', () => undefined);
    await new Promise((done) => setTimeout(done, 10));
    await listMembers('alpha');
    await getOrg();
    const after = calls.slice(before).filter((url) => !url.includes('/tasks'));
    assert.deepEqual(
      after,
      ['/api/v1/projects/alpha/members'],
      'the switch should drop alpha’s members and keep the org',
    );
    stopBeta();
  });
});
