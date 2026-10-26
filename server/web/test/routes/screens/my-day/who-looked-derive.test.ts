import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type WhoLooked } from '../../../../src/api/people-analytics.ts';
import {
  LOOKING_WINDOW_MS,
  lookingNow,
  reachesPast,
} from '../../../../src/routes/screens/my-day/who-looked-derive.ts';

const NOW = Date.UTC(2026, 9, 26, 8, 49);
const MIN = 60_000;

function look(id: string, viewer: string, name: string, minutesAgo: number): WhoLooked {
  return {
    id,
    viewer: { id: viewer, name },
    kind: id.endsWith('a') ? 'local_activity' : 'time',
    day: id.endsWith('a') ? null : '2026-10-26',
    viewed_at: NOW - minutesAgo * MIN,
  };
}

void describe('who is looking now (LAI-529)', () => {
  void test('one line a person, at their latest look, the latest first', () => {
    const rows = [
      look('1', 'u-andrea', 'Andrea Ordóñez Cárdenas', 2),
      look('1a', 'u-andrea', 'Andrea Ordóñez Cárdenas', 2),
      look('2', 'u-grace', 'Grace Hopper', 6),
      look('3', 'u-andrea', 'Andrea Ordóñez Cárdenas', 9),
      look('3a', 'u-andrea', 'Andrea Ordóñez Cárdenas', 9),
    ];
    assert.deepEqual(lookingNow(rows, NOW), [
      { id: 'u-andrea', name: 'Andrea Ordóñez Cárdenas', at: NOW - 2 * MIN },
      { id: 'u-grace', name: 'Grace Hopper', at: NOW - 6 * MIN },
    ]);
  });

  void test('a look older than the window is not now; one on its edge still is', () => {
    const edge = LOOKING_WINDOW_MS / MIN;
    const rows = [
      look('1', 'u-ada', 'Ada Lovelace', edge),
      look('2', 'u-grace', 'Grace Hopper', edge + 1),
    ];
    assert.deepEqual(
      lookingNow(rows, NOW).map((p) => p.name),
      ['Ada Lovelace'],
    );
    assert.deepEqual(lookingNow([look('1', 'u-ada', 'Ada Lovelace', 60)], NOW), []);
  });

  void test('the order holds whichever order the rows arrive in', () => {
    const rows = [look('2', 'u-grace', 'Grace Hopper', 7), look('1', 'u-ada', 'Ada Lovelace', 1)];
    assert.deepEqual(
      lookingNow(rows, NOW).map((p) => p.name),
      ['Ada Lovelace', 'Grace Hopper'],
    );
  });

  void test('a page reaches past the window once its oldest look is outside it', () => {
    assert.equal(
      reachesPast([look('1', 'u-ada', 'Ada', 1), look('2', 'u-ada', 'Ada', 14)], NOW),
      false,
    );
    assert.equal(
      reachesPast([look('1', 'u-ada', 'Ada', 1), look('2', 'u-ada', 'Ada', 16)], NOW),
      true,
    );
    assert.equal(reachesPast([], NOW), true);
  });
});
