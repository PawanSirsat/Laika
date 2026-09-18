/**
 * `src/api/users.ts` (LAI-059, unblocked by LAI-060).
 *
 * `listAllUsers` is the part worth testing: it walks the cursor. A picker that
 * stopped at page one would show a complete-looking list with people missing
 * from it, which is the same silent failure as rendering an empty board — the
 * screen looks right and the person you want is simply not there.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listAllUsers, listUsers, type OrgUser } from '../../src/api/users.ts';

interface Call {
  url: string;
}

function user(id: string, name: string): OrgUser {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    org_role: 'member',
    is_active: true,
    created_at: 0,
    updated_at: 0,
  };
}

/** Serves the given pages in order, recording the URL each call asked for. */
function stubPages(pages: readonly { data: OrgUser[]; next_cursor: string | null }[]): Call[] {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = ((input: string | URL) => {
    calls.push({ url: input instanceof URL ? input.href : input });
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return Promise.resolve(
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

void describe('listUsers', () => {
  void test('asks for no parameters by default', async () => {
    const calls = stubPages([{ data: [], next_cursor: null }]);
    await listUsers();
    assert.ok(calls[0]?.url.endsWith('/users'), `unexpected url ${calls[0]?.url ?? '(none)'}`);
  });

  void test('passes cursor and limit through', async () => {
    const calls = stubPages([{ data: [], next_cursor: null }]);
    await listUsers({ cursor: 'abc', limit: 5 });
    assert.match(calls[0]?.url ?? '', /cursor=abc/);
    assert.match(calls[0]?.url ?? '', /limit=5/);
  });

  void test('never asks for deactivated people', async () => {
    const calls = stubPages([{ data: [], next_cursor: null }]);
    await listUsers();
    // The server excludes them unless asked. A picker that offered a
    // deactivated colleague would be offering someone who cannot sign in.
    assert.ok(!(calls[0]?.url ?? '').includes('include_inactive'));
  });
});

void describe('listAllUsers follows the cursor', () => {
  void test('collects every page, in order', async () => {
    const calls = stubPages([
      { data: [user('1', 'Ada Lovelace')], next_cursor: 'c1' },
      { data: [user('2', 'Bob Badger')], next_cursor: 'c2' },
      { data: [user('3', 'Grace Hopper')], next_cursor: null },
    ]);

    const all = await listAllUsers();

    assert.deepEqual(
      all.users.map((u) => u.name),
      ['Ada Lovelace', 'Bob Badger', 'Grace Hopper'],
    );
    assert.equal(all.truncated, false);
    assert.equal(calls.length, 3);
    assert.match(calls[1]?.url ?? '', /cursor=c1/);
    assert.match(calls[2]?.url ?? '', /cursor=c2/);
  });

  void test('a single page makes exactly one request', async () => {
    const calls = stubPages([{ data: [user('1', 'Ada Lovelace')], next_cursor: null }]);
    const all = await listAllUsers();
    assert.equal(calls.length, 1);
    assert.equal(all.users.length, 1);
    assert.equal(all.truncated, false);
  });

  void test('a directory asks for inactive people; a picker does not', async () => {
    // **The URL, not the result.** A fixture answers whatever it was going to
    // answer regardless of the query, so asserting on `all.users` here would be
    // satisfied by a client that dropped the parameter — the exact blindness
    // that hid this defect in `test/browser/` (LAI-240, LAI-241).
    const calls = stubPages([{ data: [user('1', 'Ada Lovelace')], next_cursor: null }]);
    await listAllUsers(undefined, { includeInactive: true });
    assert.match(calls[0]?.url ?? '', /include_inactive=true/, 'the directory did not ask');

    const plain = stubPages([{ data: [user('1', 'Ada Lovelace')], next_cursor: null }]);
    await listAllUsers();
    assert.doesNotMatch(
      plain[0]?.url ?? '',
      /include_inactive/,
      'a picker asked for locked-out people',
    );
  });

  void test('the flag is carried onto every page, not just the first', async () => {
    // The server re-reads it per request. Dropping it after page one truncates
    // the tail of a directory to active people — a partial answer that looks
    // complete, which is this task's own bug one layer down.
    const calls = stubPages([
      { data: [user('1', 'Ada Lovelace')], next_cursor: 'c1' },
      { data: [user('2', 'Tomas Nel')], next_cursor: null },
    ]);
    await listAllUsers(undefined, { includeInactive: true });
    assert.equal(calls.length, 2, `expected two pages, saw ${String(calls.length)}`);
    for (const [i, call] of calls.entries()) {
      assert.match(call.url, /include_inactive=true/, `page ${String(i + 1)} dropped the flag`);
    }
    assert.match(calls[1]?.url ?? '', /cursor=c1/, 'the second page did not follow the cursor');
  });

  void test('a server that never stops is capped, and says so', async () => {
    // Not a product limit — a runaway guard. The caller is told, because a
    // truncated directory that claims to be complete is the bug this whole
    // function exists to avoid.
    stubPages([{ data: [user('x', 'Endless Person')], next_cursor: 'always' }]);
    const all = await listAllUsers(undefined, { maxPages: 3 });
    assert.equal(all.truncated, true);
    assert.equal(all.users.length, 3);
  });
});
