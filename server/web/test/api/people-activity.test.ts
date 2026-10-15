/**
 * `src/api/people-activity.ts` — the profile's heatmap read (D-079, LAI-751).
 *
 * One request per person and range, to the path §6.4 names, the range in the
 * query and nothing else beside it — the server refuses an unknown parameter.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ACTIVITY_RANGES, getPeopleActivity } from '../../src/api/people-activity.ts';

function stub(answer: unknown): { url: string; method: string }[] {
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input.href : input, method: init?.method ?? 'GET' });
    return Promise.resolve(
      new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

void describe('the heatmap read (§6.4)', () => {
  void test('asks for one person and one range, escaped, with GET', async () => {
    const calls = stub({ range: '52w' });
    const answer = await getPeopleActivity('u 1', '52w');
    assert.deepEqual(answer, { range: '52w' });
    assert.equal(calls[0]?.method, 'GET');
    assert.ok(calls[0]?.url.endsWith('/api/v1/people/u%201/activity?range=52w'), calls[0]?.url);
  });

  void test('offers exactly the two ranges the server answers', () => {
    assert.deepEqual([...ACTIVITY_RANGES], ['12w', '52w']);
  });
});
