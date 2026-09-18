/**
 * The mentionable client (LAI-284, closing half of LAI-458).
 *
 * **This test exists because I got the shape wrong.** The first version assumed
 * a `Page` with `data`, and person-shaped `user_id` fields — because every
 * neighbouring endpoint is paginated and every other payload says `user_id`.
 * The route returns `{ users: [{ id, name }] }`. `page.data` was `undefined`,
 * `people.length` threw, and the whole task drawer went blank.
 *
 * So what is pinned here is the **shape**, read from the route rather than from
 * its neighbours.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { listMentionable } from '../../src/api/mentions.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(body: unknown): { readonly urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { urls };
}

void describe('listMentionable', () => {
  void test('asks the project’s mentionable endpoint', async () => {
    const calls = stub({ users: [] });
    await listMentionable('laika-core');
    assert.equal(calls.urls.length, 1);
    assert.match(calls.urls[0] ?? '', /\/projects\/laika-core\/mentionable$/);
  });

  void test('reads `users`, and each person’s `id`', async () => {
    stub({
      users: [
        { id: 'u1', name: 'Ada Lovelace' },
        { id: 'u2', name: 'Grace Hopper' },
      ],
    });
    const list = await listMentionable('laika-core');

    // Not `data`, and not `user_id` — the two things the first version assumed.
    assert.equal(list.users.length, 2);
    assert.equal(list.users[0]?.id, 'u1');
    assert.equal(list.users[0]?.name, 'Ada Lovelace');
  });

  void test('an empty space gives an empty list, not undefined', async () => {
    /*
     * The composer disables its `@` button on `users.length === 0`, so an
     * absent array is the crash this file is named for.
     */
    stub({ users: [] });
    const list = await listMentionable('laika-core');
    assert.deepEqual(list.users, []);
  });

  void test('escapes a slug rather than pasting it into the path', async () => {
    const calls = stub({ users: [] });
    await listMentionable('a/b');
    assert.match(calls.urls[0] ?? '', /projects\/a%2Fb\/mentionable/);
  });
});
