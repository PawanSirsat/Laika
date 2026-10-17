/**
 * `src/api/usage.ts` — token usage, read back (D-084, SPEC §6.4, LAI-769).
 *
 * Each read goes to the path §6.4 names with the query the server takes, and
 * the figures are said the way the page says them: compact, a floor, and a
 * share that never claims a precision it does not have.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  compactTokens,
  getPersonUsage,
  getUsage,
  mayReadOrgUsage,
  mayReadPeopleUsage,
  shareOf,
  USAGE_RANGES,
} from '../../src/api/usage.ts';

function stub(answer: unknown): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL) => {
    urls.push(input instanceof URL ? input.href : input);
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return urls;
}

void describe('the reads (§6.4)', () => {
  void test('the organisation: GET /usage with the range and the reader’s zone', async () => {
    const urls = stub({});
    await getUsage({ days: 30, tz: 'Africa/Johannesburg' });
    const url = new URL(urls[0] ?? '', 'http://x');
    assert.equal(url.pathname, '/api/v1/usage');
    assert.equal(url.searchParams.get('days'), '30');
    assert.equal(url.searchParams.get('tz'), 'Africa/Johannesburg');
    assert.equal(url.searchParams.has('project'), false);
  });

  void test('a space: the same, with ?project=', async () => {
    const urls = stub({});
    await getUsage({ days: 7, tz: 'UTC', project: 'laika' });
    assert.equal(new URL(urls[0] ?? '', 'http://x').searchParams.get('project'), 'laika');
  });

  void test('a person: GET /users/:id/usage', async () => {
    const urls = stub({});
    await getPersonUsage('u 2');
    assert.ok((urls[0] ?? '').endsWith('/api/v1/users/u%202/usage'), urls[0]);
  });

  void test('the ranges the page offers are ones the server serves (1–92 days)', () => {
    assert.deepEqual(
      USAGE_RANGES.map((r) => r.days),
      [7, 30, 90],
    );
  });
});

void describe('who sees what (D-084 item 7), mirrored from §3.1', () => {
  void test('the organisation and people: owners and admins', () => {
    for (const role of ['owner', 'admin']) {
      assert.equal(mayReadOrgUsage(role), true);
      assert.equal(mayReadPeopleUsage(role), true);
    }
    for (const role of ['member', 'viewer', undefined]) {
      assert.equal(mayReadOrgUsage(role), false);
      assert.equal(mayReadPeopleUsage(role), false);
    }
  });
});

void describe('how a figure is said', () => {
  void test('compact, to three significant figures', () => {
    assert.deepEqual([0, 950, 12_400, 1_234_567, 254_973_258, 16_346_307_361].map(compactTokens), [
      '0',
      '950',
      '12.4K',
      '1.23M',
      '255M',
      '16.3B',
    ]);
  });

  void test('a share: a dash for nothing of nothing, and “<1%” rather than a false 0%', () => {
    assert.equal(shareOf(0, 0), '—');
    assert.equal(shareOf(0, 100), '0%');
    assert.equal(shareOf(1, 1_000), '<1%');
    assert.equal(shareOf(9, 666), '1%');
    assert.equal(shareOf(100, 100), '100%');
  });
});
