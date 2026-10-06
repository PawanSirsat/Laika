import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EVERY_PAGE_CAP, everyPage } from '../../src/api/every-page.ts';
import type { Page } from '../../src/api/tasks.ts';

/** A list of `n` numbers served `size` at a time, recording each cursor asked for. */
function server(n: number, size: number) {
  const asked: (string | undefined)[] = [];
  const fetchPage = (cursor: string | undefined): Promise<Page<number>> => {
    asked.push(cursor);
    const from = cursor === undefined ? 0 : Number(cursor);
    const data = Array.from({ length: Math.min(size, n - from) }, (_, i) => from + i);
    const next = from + size < n ? String(from + size) : null;
    return Promise.resolve({ data, next_cursor: next });
  };
  return { asked, fetchPage };
}

void describe('everyPage (LAI-702)', () => {
  void test('follows the cursor to the end and keeps the order', async () => {
    const s = server(5, 2);
    const got = await everyPage(s.fetchPage);
    assert.deepEqual(got.items, [0, 1, 2, 3, 4]);
    assert.equal(got.truncated, false);
    // The first request carries no cursor; each later one the server's.
    assert.deepEqual(s.asked, [undefined, '2', '4']);
  });

  void test('one page is one request', async () => {
    const s = server(3, 200);
    const got = await everyPage(s.fetchPage);
    assert.deepEqual(got.items, [0, 1, 2]);
    assert.deepEqual(s.asked, [undefined]);
  });

  void test('an empty list is empty, not truncated', async () => {
    const got = await everyPage(server(0, 50).fetchPage);
    assert.deepEqual(got, { items: [], truncated: false });
  });

  void test('stops at the cap and says so, rather than stopping quietly', async () => {
    const s = server(10, 1);
    const got = await everyPage(s.fetchPage, 3);
    assert.deepEqual(got.items, [0, 1, 2]);
    assert.equal(got.truncated, true);
    assert.equal(s.asked.length, 3);
  });

  void test('the default cap is a runaway guard, not a working size', () => {
    assert.ok(EVERY_PAGE_CAP * 200 >= 5000);
  });
});
