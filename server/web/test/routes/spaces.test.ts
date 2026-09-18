/**
 * Spaces — the sidebar's model of projects you have opened (LAI-248).
 *
 * Pure functions, so the ordering rules are testable without a browser. What
 * the browser proves is in `test/browser/spaces-sidebar.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  promote,
  readRecent,
  recentSpaces,
  RECENT_LIMIT,
  spaceKey,
  spaceMeta,
} from '../../src/routes/spaces.ts';
import type { Project } from '../../src/api/projects.ts';

const project = (
  slug: string,
  name: string,
  prefix: string,
  tasks: number,
  members: number,
): Project => ({
  id: slug,
  slug,
  prefix,
  name,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: tasks, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: members,
  members: [],
  last_activity_at: 2,
});

const CORE = project('laika-core', 'Laika Core', 'LC', 5, 5);
const WEB = project('laika-web', 'Laika Web', 'LW', 3, 1);
const INFRA = project('laika-infra', 'Laika Infra', 'LI', 14, 2);
const DOCS = project('laika-docs', 'Laika Docs', 'LD', 9, 2);

void describe('a space key is the project prefix', () => {
  /**
   * **The real field, not a derivation.** `Project.prefix` is what makes a task
   * `LC-42`, and the design keys its spaces `LC`/`LW`/`LI`/`LD` — the same
   * letters. The first version of this module derived two letters from the
   * name, which agrees for `Laika Core` and diverges the moment a project is
   * renamed without its prefix changing.
   */
  void test('it comes from `prefix`, even when the name would give something else', () => {
    assert.equal(spaceKey(CORE), 'LC');
    assert.equal(spaceKey({ prefix: 'ZZ', name: 'Laika Core' }), 'ZZ');
  });

  void test('an empty prefix falls back to the name rather than rendering blank', () => {
    // A key is the whole of a space's identity in a narrow sidebar; an empty
    // chip reads as a broken row.
    assert.equal(spaceKey({ prefix: '', name: 'Weather Service' }), 'WE');
    assert.equal(spaceKey({ prefix: '   ', name: '' }), '??');
  });
});

void describe('the meta line', () => {
  void test('sums every status and pluralises both halves', () => {
    assert.equal(spaceMeta(CORE), '5 tasks · 5 members');
    assert.equal(spaceMeta(WEB), '3 tasks · 1 member');
    assert.equal(
      spaceMeta(project('x', 'X', 'XX', 1, 1)),
      '1 task · 1 member',
      'singular on both sides',
    );
  });
});

void describe('recency', () => {
  void test('promote moves a slug to the front and caps the list', () => {
    assert.deepEqual(promote(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
    assert.deepEqual(promote(['a', 'b', 'c'], 'd'), ['d', 'a', 'b']);
    assert.equal(promote(['a', 'b', 'c'], 'd').length, RECENT_LIMIT);
  });

  void test('promoting the front entry is a no-op, not a duplicate', () => {
    assert.deepEqual(promote(['a', 'b'], 'a'), ['a', 'b']);
  });

  void test('unreadable storage answers empty rather than throwing', () => {
    // A sidebar that will not render because a string in localStorage is wrong
    // is a worse outcome than one that forgot where you were.
    assert.deepEqual(readRecent({ getItem: () => 'not json' }), []);
    assert.deepEqual(readRecent({ getItem: () => '{"not":"an array"}' }), []);
    assert.deepEqual(readRecent({ getItem: () => '[1,2,"ok"]' }), ['ok']);
    assert.deepEqual(readRecent({ getItem: () => null }), []);
    assert.deepEqual(
      readRecent({
        getItem: () => {
          throw new Error('SecurityError');
        },
      }),
      [],
    );
  });
});

void describe('which spaces are shown', () => {
  const ALL = [CORE, WEB, INFRA, DOCS];

  /**
   * **Storage is untrusted input.** `promote` caps at three on the way in, so a
   * longer list can only arrive from an older version of this code or a
   * hand-edited `localStorage` — and `readRecent` returns whatever is there.
   *
   * The first version of this file only ever passed three, so deleting the cap
   * from `recentSpaces` was a mutation **nothing caught**: the fill-up loop's
   * own `break` still held, and no test fed it more than the limit. Found by
   * mutation, not by reading.
   */
  void test('more remembered than the limit is still capped', () => {
    const spaces = recentSpaces(ALL, ['laika-docs', 'laika-web', 'laika-infra', 'laika-core']);
    assert.equal(spaces.length, RECENT_LIMIT, `showed ${String(spaces.length)} spaces`);
    assert.deepEqual(
      spaces.map((s) => s.slug),
      ['laika-docs', 'laika-web', 'laika-infra'],
    );
  });

  void test('a current project on top of a full remembered list still caps', () => {
    const spaces = recentSpaces(ALL, ['laika-docs', 'laika-web', 'laika-infra'], 'laika-core');
    assert.equal(spaces.length, RECENT_LIMIT);
    assert.equal(spaces[0]?.slug, 'laika-core');
  });

  void test('remembered order wins, capped at three', () => {
    const spaces = recentSpaces(ALL, ['laika-docs', 'laika-web', 'laika-infra']);
    assert.deepEqual(
      spaces.map((s) => s.slug),
      ['laika-docs', 'laika-web', 'laika-infra'],
    );
  });

  void test('the project you are in comes first, even on a first visit', () => {
    const spaces = recentSpaces(ALL, [], 'laika-infra');
    assert.equal(spaces[0]?.slug, 'laika-infra');
  });

  /**
   * A first visit has no stored order. An empty SPACES section would be the
   * worst first impression of the whole model.
   */
  void test('with nothing remembered it still fills the row', () => {
    const spaces = recentSpaces(ALL, []);
    assert.equal(spaces.length, RECENT_LIMIT);
  });

  void test('a remembered project that no longer exists is dropped, not drawn broken', () => {
    // Deleted, or a membership revoked between visits.
    const spaces = recentSpaces([CORE, WEB], ['gone', 'laika-web']);
    assert.deepEqual(
      spaces.map((s) => s.slug),
      ['laika-web', 'laika-core'],
    );
    assert.ok(!spaces.some((s) => s.slug === 'gone'));
  });

  void test('no duplicates when the current project is also remembered', () => {
    const spaces = recentSpaces(ALL, ['laika-core', 'laika-web'], 'laika-core');
    assert.equal(new Set(spaces.map((s) => s.slug)).size, spaces.length);
    assert.equal(spaces[0]?.slug, 'laika-core');
  });

  void test('fewer projects than the limit shows them all and no placeholders', () => {
    const spaces = recentSpaces([CORE], []);
    assert.deepEqual(
      spaces.map((s) => s.slug),
      ['laika-core'],
    );
  });
});
