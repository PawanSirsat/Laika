/**
 * `src/api/use-project-tasks.ts` — the hook every screen but the board reads
 * the project's tasks through (LAI-724).
 *
 * `node --test` cannot render a hook, so this pins what makes it safe to call
 * from ten screens at once: it reads the store and nothing else. A hook that
 * fetched for itself would be the per-screen walk LAI-724 removed, back under a
 * new name. The store it reads is tested in `task-store.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import { code } from '../helpers/code.ts';
import { setStoreUser, taskStore } from '../../src/api/store.ts';
import { reloadProjectTasks } from '../../src/api/use-project-tasks.ts';

const SOURCE = code(
  readFileSync(
    fileURLToPath(new URL('../../src/api/use-project-tasks.ts', import.meta.url)),
    'utf8',
  ),
);

afterEach(() => {
  setStoreUser(undefined);
});

void describe('useProjectTasks reads the store and nothing else', () => {
  void test('it subscribes to the task store and reads its snapshot', () => {
    assert.match(SOURCE, /taskStore\.subscribe\(slug, onChange\)/);
    assert.match(SOURCE, /taskStore\.peek\(slug\)/);
    assert.match(SOURCE, /useSyncExternalStore\(/);
  });

  void test('it makes no request of its own', () => {
    for (const fetches of [/\brequest\(/, /\blistTasks\(/, /\beveryPage\(/, /\bfetch\(/]) {
      assert.doesNotMatch(SOURCE, fetches, `the hook fetches for itself: ${String(fetches)}`);
    }
  });
});

void describe('reloadProjectTasks', () => {
  void test('walks the project again through the store', async () => {
    const asked: string[] = [];
    globalThis.fetch = ((input: string | URL) => {
      asked.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], next_cursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    setStoreUser('u1');
    const stop = taskStore.subscribe('laika-core', () => undefined);
    await new Promise((done) => setTimeout(done, 10));
    assert.equal(asked.length, 1, 'positive control: the first walk');

    reloadProjectTasks('laika-core');
    await new Promise((done) => setTimeout(done, 10));
    assert.equal(asked.length, 2, 'reload did not walk again');
    reloadProjectTasks(undefined);
    assert.equal(asked.length, 2, 'no project, no walk');
    stop();
  });
});
