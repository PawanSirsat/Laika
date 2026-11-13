/**
 * `src/api/time-logging.ts` — the Time logging grid (D-148, LAI-1175): one
 * read, a stretch and nothing else, on its own path beside `/me/time/days`.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { getTimeLogging, timeLoggingParams } from '../../src/api/time-logging.ts';

const sent: { url: string; method: string }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({ url: input instanceof URL ? input.href : input, method: init?.method ?? 'GET' });
  return Promise.resolve(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}) as unknown as typeof fetch;

beforeEach(() => {
  sent.length = 0;
});

void describe('the grid is one GET of a stretch', () => {
  void test('the params are from and to, in that order, so one month is one address', () => {
    assert.equal(
      timeLoggingParams('2026-11-01', '2026-11-30').toString(),
      'from=2026-11-01&to=2026-11-30',
    );
  });

  void test('it asks /time/days — everyone’s days, not /me/time/days', async () => {
    await getTimeLogging('2026-11-01', '2026-11-30');
    assert.deepEqual(sent, [
      { url: '/api/v1/time/days?from=2026-11-01&to=2026-11-30', method: 'GET' },
    ]);
  });
});
