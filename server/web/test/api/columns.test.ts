/**
 * The board-columns transport (LAI-266).
 *
 * Every call is asserted against a recording `fetch`, because what this module
 * can get wrong is invisible from the types: the **method**, the **path**, and
 * the **body shape**. A `PATCH` where the server wants `PUT` type-checks
 * perfectly and answers 405 at runtime.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  createColumn,
  deleteColumn,
  listColumns,
  renameColumn,
  reorderColumns,
  setColumnHidden,
  setColumnStatuses,
} from '../../src/api/columns.ts';

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
      new Response(JSON.stringify({ columns: [], reassigned: [] }), {
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
  void test('gets the board for a slug', async () => {
    await listColumns('laika-core');

    const call = only();
    assert.equal(call.method, 'GET');
    assert.match(call.url, /\/projects\/laika-core\/board-columns$/);
  });
});

void describe('writing', () => {
  void test('creates with POST and a name', async () => {
    await createColumn('laika-core', 'QA');

    const call = only();
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/projects\/laika-core\/board-columns$/);
    assert.deepEqual(call.body, { name: 'QA' });
  });

  void test('renames with PATCH', async () => {
    await renameColumn('laika-core', 'c1', 'QA');

    const call = only();
    assert.equal(call.method, 'PATCH');
    assert.match(call.url, /\/board-columns\/c1$/);
    assert.deepEqual(call.body, { name: 'QA' });
  });

  void test('hides with PATCH, separately from renaming', async () => {
    await setColumnHidden('laika-core', 'c1', true);

    assert.deepEqual(only().body, { hidden: true });
  });

  void test('replaces statuses with PUT, in one request', async () => {
    /*
     * `PUT`, not `PATCH`, and **one** request rather than one per affected
     * column. Moving `review` from QA to In progress touches two columns; as
     * two requests it can half-apply, and the half that lands leaves `review`
     * in no column — the one state the model forbids.
     */
    await setColumnStatuses('laika-core', 'c1', ['review', 'done']);

    const call = only();
    assert.equal(call.method, 'PUT');
    assert.match(call.url, /\/board-columns\/c1\/statuses$/);
    assert.deepEqual(call.body, { statuses: ['review', 'done'] });
  });

  void test('deletes with a destination in the body', async () => {
    // The destination is required by the server rather than defaulted: a
    // column's statuses have to go somewhere, and letting the caller omit it
    // would make "wherever seems reasonable" a decision nobody took.
    await deleteColumn('laika-core', 'c1', 'c2');

    const call = only();
    assert.equal(call.method, 'DELETE');
    assert.deepEqual(call.body, { reassign_to_column_id: 'c2' });
  });

  void test('reorders by POSTing the whole list', async () => {
    // The whole order, never a moved id and a neighbour — a client working from
    // a stale board is then refused rather than silently dropping a lane.
    await reorderColumns('laika-core', ['c3', 'c1', 'c2']);

    const call = only();
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/board-columns\/reorder$/);
    assert.deepEqual(call.body, { column_ids: ['c3', 'c1', 'c2'] });
  });
});

void describe('paths', () => {
  void test('encode a slug that needs it', async () => {
    await listColumns('a b/c');

    assert.match(only().url, /a%20b%2Fc/);
  });

  void test('encode a column id that needs it', async () => {
    await renameColumn('laika-core', 'a/b', 'QA');

    assert.match(only().url, /a%2Fb/);
  });
});
