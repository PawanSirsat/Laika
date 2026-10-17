/**
 * The Usage page's pure parts (LAI-769): which spaces a reader may choose,
 * where they start, the trend's scale and its axis labels.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  axisDays,
  barHeight,
  defaultScope,
  scopeOptions,
} from '../../../../src/routes/screens/usage/usage-derive.ts';

const PROJECTS = [
  { id: 'p1', slug: 'laika', name: 'Laika' },
  { id: 'p2', slug: 'atlas', name: 'Atlas' },
  { id: 'p3', slug: 'zebra', name: 'Zebra' },
];

void describe('the space selector', () => {
  void test('an owner: the whole organisation first, then every space by name', () => {
    const me = { org_role: 'owner', memberships: [] };
    assert.deepEqual(
      scopeOptions(me, PROJECTS).map((o) => [o.value, o.label]),
      [
        ['', 'All spaces'],
        ['atlas', 'Atlas'],
        ['laika', 'Laika'],
        ['zebra', 'Zebra'],
      ],
    );
    assert.equal(defaultScope(me, PROJECTS), '');
  });

  void test('a member: only the spaces they are in, never the organisation', () => {
    const me = { org_role: 'member', memberships: [{ project_id: 'p3' }, { project_id: 'p1' }] };
    assert.deepEqual(
      scopeOptions(me, PROJECTS).map((o) => o.value),
      ['laika', 'zebra'],
    );
    assert.equal(defaultScope(me, PROJECTS), 'laika');
  });

  void test('a member in no space has nothing to choose', () => {
    const me = { org_role: 'member', memberships: [] };
    assert.deepEqual(scopeOptions(me, PROJECTS), []);
    assert.equal(defaultScope(me, PROJECTS), undefined);
  });
});

void describe('the trend', () => {
  void test('bars from a shared zero baseline, the tallest full height, a non-zero one visible', () => {
    assert.equal(barHeight(0, 1_000), 0);
    assert.equal(barHeight(1_000, 1_000), 100);
    assert.equal(barHeight(500, 1_000), 50);
    assert.ok(barHeight(1, 1_000_000) >= 2, 'a day with tokens is never drawn as none');
    assert.equal(barHeight(0, 0), 0);
  });

  void test('three axis labels: the first day, the middle and the last', () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10),
    );
    assert.deepEqual(axisDays(days), ['2026-09-18', '2026-10-02', '2026-10-17']);
    assert.deepEqual(axisDays(['2026-10-17']), ['2026-10-17']);
    assert.deepEqual(axisDays([]), []);
  });
});
