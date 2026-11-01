/**
 * `src/api/people-analytics.ts` — a person's day and shared local activity,
 * read by somebody else, and the person's own list of who looked (D-102,
 * LAI-957, LAI-959).
 *
 * Each read goes to the path §6.4 names, with the query the server's strict
 * schemas accept and nothing else; none of them writes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ANALYTICS_VIEW_KINDS,
  getPersonDay,
  getPersonLocalActivity,
  listAnalyticsViews,
  PEOPLE_ANALYTICS,
  viewKindLabel,
} from '../../src/api/people-analytics.ts';
import { stripComments } from '../helpers/enums.ts';

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

void describe('reading somebody else’s analytics (§6.4)', () => {
  void test('a person’s day: one GET, the id escaped, the day and zone as /me/time takes them', async () => {
    const calls = stub({ day: '2026-10-21' });
    await getPersonDay('u 2', '2026-10-21', 'Asia/Kolkata');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'GET');
    assert.ok(
      calls[0]?.url.endsWith('/api/v1/people/u%202/time?day=2026-10-21&tz=Asia%2FKolkata'),
      calls[0]?.url,
    );
  });

  void test('their shared local activity: fourteen days, the window the person reads', async () => {
    const calls = stub({ days: [] });
    await getPersonLocalActivity('u2');
    assert.equal(calls[0]?.method, 'GET');
    assert.ok(calls[0]?.url.endsWith('/api/v1/people/u2/local-activity?days=14'), calls[0]?.url);
  });

  void test('who looked: GET /me/analytics-views, the page asked only when given', async () => {
    const calls = stub({ data: [], next_cursor: null });
    await listAnalyticsViews();
    await listAnalyticsViews({ limit: 20, cursor: 'c1' });
    assert.ok(calls[0]?.url.endsWith('/api/v1/me/analytics-views'), calls[0]?.url);
    assert.ok(
      calls[1]?.url.endsWith('/api/v1/me/analytics-views?limit=20&cursor=c1'),
      calls[1]?.url,
    );
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'GET'],
    );
  });
});

void describe('who holds it (D-102 rule 6)', () => {
  void test('the action is §3.1’s name for it', () => {
    assert.equal(PEOPLE_ANALYTICS, 'people.analytics.read');
  });
});

void describe('what was looked at', () => {
  void test('the kinds are the server’s, in its order', () => {
    const enums = readFileSync(
      fileURLToPath(new URL('../../../src/db/enums.ts', import.meta.url)),
      'utf8',
    );
    const block = /export const ANALYTICS_VIEW_KINDS = \[([\s\S]*?)\] as const;/.exec(enums);
    assert.ok(block !== null, 'ANALYTICS_VIEW_KINDS is not in server/src/db/enums.ts');
    const server = [...stripComments(block[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(server.length > 0);
    assert.deepEqual([...ANALYTICS_VIEW_KINDS], server);
  });

  void test('each reads as a phrase, and an unknown one is drawn rather than dropped', () => {
    assert.equal(viewKindLabel('time'), 'your day');
    assert.equal(viewKindLabel('local_activity'), 'your shared local activity');
    assert.equal(viewKindLabel('something_new'), 'something new');
  });
});
