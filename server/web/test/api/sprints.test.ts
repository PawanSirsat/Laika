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
import { countSprints, listSprints, SPRINT_STATUSES, type Sprint } from '../../src/api/sprints.ts';

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
