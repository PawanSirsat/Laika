/**
 * The project-statuses API client (LAI-739; was the board-columns client,
 * LAI-266). One board column is one status now, so the calls are plain:
 * list, create with a kind, rename or hide, reorder with the whole list, and
 * delete naming where the tasks go.
 *
 * Asserted against the wire — method, path and body — because a client that
 * sends the right intent to the wrong path fails only against a live server.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  createStatus,
  deleteStatus,
  listStatuses,
  reorderStatuses,
  updateStatus,
} from '../../src/api/statuses.ts';

interface Seen {
  url: string;
  method: string;
  body: unknown;
}

let seen: Seen[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  seen = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    return Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const only = (): Seen => {
  assert.equal(seen.length, 1, `expected one request, saw ${String(seen.length)}`);
  return seen[0]!;
};

void describe('reading', () => {
  void test('gets the statuses for a slug', async () => {
    await listStatuses('laika-core');

    const call = only();
    assert.equal(call.method, 'GET');
    assert.match(call.url, /\/projects\/laika-core\/statuses$/);
  });
});

void describe('writing', () => {
  void test('creates with POST, a name and its kind', async () => {
    await createStatus('laika-core', { name: 'QA', category: 'review' });

    const call = only();
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/projects\/laika-core\/statuses$/);
    assert.deepEqual(call.body, { name: 'QA', category: 'review' });
  });

  void test('renames with PATCH, sending only the name', async () => {
    await updateStatus('laika-core', 's1', { name: 'QA' });

    const call = only();
    assert.equal(call.method, 'PATCH');
    assert.match(call.url, /\/statuses\/s1$/);
    assert.deepEqual(call.body, { name: 'QA' });
  });

  void test('hides with PATCH, separately from renaming', async () => {
    await updateStatus('laika-core', 's1', { hidden: true });

    assert.deepEqual(only().body, { hidden: true });
  });

  void test('deletes naming where the tasks go — always, as the server requires', async () => {
    await deleteStatus('laika-core', 's1', 's2');

    const call = only();
    assert.equal(call.method, 'DELETE');
    assert.match(call.url, /\/statuses\/s1$/);
    assert.deepEqual(call.body, { move_to: 's2' });
  });

  void test('reorders by PUTting the whole list', async () => {
    // The whole order, never a moved id and a neighbour — a client working from
    // a stale board is then refused rather than silently dropping a column.
    await reorderStatuses('laika-core', ['s3', 's1', 's2']);

    const call = only();
    assert.equal(call.method, 'PUT');
    assert.match(call.url, /\/statuses\/order$/);
    assert.deepEqual(call.body, { ids: ['s3', 's1', 's2'] });
  });
});

void describe('paths', () => {
  void test('encode a slug that needs it', async () => {
    await listStatuses('a b/c');

    assert.match(only().url, /a%20b%2Fc/);
  });

  void test('encode a status id that needs it', async () => {
    await updateStatus('laika-core', 'a/b', { name: 'QA' });

    assert.match(only().url, /a%2Fb/);
  });
});
