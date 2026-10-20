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
  offeredSpaces,
  scopeFor,
  scopeOptions,
  spaceRow,
  spaceUsageHref,
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

void describe('the space in the address, ?project= (LAI-814)', () => {
  const owner = { org_role: 'owner', memberships: [] };
  const member = { org_role: 'member', memberships: [{ project_id: 'p3' }, { project_id: 'p1' }] };

  void test('opens the space it names, for a reader offered it', () => {
    assert.equal(scopeFor(owner, PROJECTS, 'atlas'), 'atlas');
    assert.equal(scopeFor(member, PROJECTS, 'zebra'), 'zebra');
    // `''` is All spaces: an owner's, never a member's.
    assert.equal(scopeFor(owner, PROJECTS, ''), '');
    assert.equal(scopeFor(member, PROJECTS, ''), 'laika');
  });

  void test('without one, or naming a space the reader is not offered, opens where the page would', () => {
    assert.equal(scopeFor(owner, PROJECTS, undefined), '');
    assert.equal(scopeFor(member, PROJECTS, undefined), 'laika');
    // Atlas is not theirs, and a slug nobody has is nobody's: never a 403.
    assert.equal(scopeFor(member, PROJECTS, 'atlas'), 'laika');
    assert.equal(scopeFor(owner, PROJECTS, 'gone'), '');
    assert.equal(scopeFor({ org_role: 'member', memberships: [] }, PROJECTS, 'laika'), undefined);
  });

  void test('a space’s own view is Insights → Usage & cost with its slug', () => {
    assert.equal(spaceUsageHref('laika'), '/insights?tab=usage&project=laika');
    assert.equal(spaceUsageHref('a b&c'), '/insights?tab=usage&project=a%20b%26c');
  });
});

void describe('a By space row is a link only to a space the selector offers (LAI-814 review)', () => {
  const owner = { org_role: 'owner', memberships: [] };

  void test('the offered spaces are the selector’s, All spaces aside', () => {
    assert.deepEqual([...(offeredSpaces(owner, PROJECTS) ?? [])].sort(), [
      'atlas',
      'laika',
      'zebra',
    ]);
    // No list: nothing is known to be offered, or to be archived.
    assert.equal(offeredSpaces(owner, null), null);
  });

  void test('a space the selector offers is a link; one the loaded list lacks is archived', () => {
    const offered = offeredSpaces(owner, PROJECTS);
    assert.equal(spaceRow('laika', offered), 'link');
    // `GET /projects` sends an archived space as a tombstone, so the list lacks
    // it, and its ?project= would open All spaces.
    assert.equal(spaceRow('oldsite', offered), 'archived');
    assert.equal(spaceRow('laika', null), 'plain');
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
