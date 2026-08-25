/**
 * The board honours the whole filter (LAI-069).
 *
 * `useBoard` used to destructure four named fields off `TaskFilter`, rebuild the
 * request from those, and depend on exactly them. So when `sprint` was added to
 * the type it was accepted by TypeScript, written into the URL, read by the
 * board, put in the filter object — **and then silently dropped here.** No
 * request, no error, no failing test; the sprint rail simply did not filter.
 *
 * The fix is to depend on the filter's serialised content and forward it whole.
 * This test exists so the old shape cannot come back, because the next field
 * added would disappear exactly the same way.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

async function hook(): Promise<string> {
  return code(await readFile(new URL('../../src/api/use-board.ts', import.meta.url), 'utf8'));
}

void describe('useBoard forwards every filter field', () => {
  void test('the filter is passed whole, not field by field', async () => {
    const src = await hook();
    assert.match(
      src,
      /listTasks\(\s*slug,\s*\{\s*\.\.\.filter/,
      'spread the filter — naming fields drops any added later',
    );
  });

  void test('it does not destructure named filter fields', async () => {
    const src = await hook();
    assert.ok(
      !/const \{[^}]*\} = filter;/.test(src),
      'destructuring is how `sprint` was lost; depend on the content instead',
    );
  });

  void test('the effect depends on the filter content', async () => {
    const src = await hook();
    assert.match(src, /filterKey/, 'a serialised key re-runs on any field changing');
    assert.match(src, /\}, \[slug, filterKey, attempt\]\)/, 'and it must be in the dependencies');
  });
});
