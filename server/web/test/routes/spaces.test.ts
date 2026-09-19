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
    board_hide_done_days: null,
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

void describe('the sequence does not change when you use it (LAI-260)', () => {
  /**
   * The owner's report: clicking a space moved it to the top and the rows
   * shuffled under the pointer. **Recency chooses the members; it must not
   * choose the order.**
   */
  void test('the drawn order is the same whichever space you are in', () => {
    const projects = [
      project('laika-web', 'Laika Web', 'LW', 2, 1),
      project('laika-infra', 'Laika Infra', 'LI', 1, 1),
      project('laika-core', 'Laika Core', 'LC', 10, 1),
    ];

    const order = (recent: readonly string[], current?: string) =>
      recentSpaces(projects, recent, current).map((s2) => s2.slug);

    const baseline = order([]);
    // Every way of arriving at this list — any recency, any current space —
    // draws it identically.
    assert.deepEqual(order(['laika-infra'], 'laika-infra'), baseline);
    assert.deepEqual(order(['laika-web'], 'laika-web'), baseline);
    assert.deepEqual(order(['laika-core', 'laika-web'], 'laika-core'), baseline);
  });

  void test('and that order is by name, so it is predictable', () => {
    const projects = [
      project('zeta', 'Zeta', 'ZE', 1, 1),
      project('alpha', 'Alpha', 'AL', 1, 1),
      project('mid', 'Mid', 'MI', 1, 1),
    ];
    assert.deepEqual(
      recentSpaces(projects, ['zeta'], 'zeta').map((s2) => s2.name),
      ['Alpha', 'Mid', 'Zeta'],
    );
  });

  void test('recency still decides membership — only the sequence is stable', () => {
    // Four projects, three slots: the least-recent one is the one that goes.
    const projects = [
      project('a-one', 'A One', 'AO', 1, 1),
      project('b-two', 'B Two', 'BT', 1, 1),
      project('c-three', 'C Three', 'CT', 1, 1),
      project('d-four', 'D Four', 'DF', 1, 1),
    ];
    const shown = recentSpaces(projects, ['d-four', 'c-three', 'b-two'], 'd-four');
    assert.equal(shown.length, 3);
    assert.deepEqual(
      shown.map((s2) => s2.slug),
      ['b-two', 'c-three', 'd-four'],
      'drawn by name',
    );
    assert.ok(
      !shown.some((s2) => s2.slug === 'a-one'),
      'the least-recent space must still fall off the list',
    );
  });
});

void describe('which spaces are shown', () => {
  const ALL = [CORE, WEB, INFRA, DOCS];

  /**
   * **These assert membership, not sequence** (LAI-260). Recency chooses the
   * three; it stopped choosing their order when the owner reported that
   * clicking a space shuffled the rows under the pointer. The order is
   * asserted in its own block above.
   */
  const slugs = (spaces: readonly { readonly slug: string }[]) =>
    [...spaces.map((s2) => s2.slug)].sort();

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
    assert.deepEqual(slugs(spaces), ['laika-docs', 'laika-infra', 'laika-web'].sort());
  });

  void test('a current project on top of a full remembered list still caps', () => {
    const spaces = recentSpaces(ALL, ['laika-docs', 'laika-web', 'laika-infra'], 'laika-core');
    assert.equal(spaces.length, RECENT_LIMIT);
    // The space you are in must be *on* the list; where it is drawn is not
    // recency's business (LAI-260).
    assert.ok(spaces.some((s2) => s2.slug === 'laika-core'));
  });

  void test('the remembered three are the three shown', () => {
    const spaces = recentSpaces(ALL, ['laika-docs', 'laika-web', 'laika-infra']);
    assert.deepEqual(slugs(spaces), ['laika-docs', 'laika-infra', 'laika-web'].sort());
  });

  void test('the project you are in is shown, even on a first visit', () => {
    const spaces = recentSpaces(ALL, [], 'laika-infra');
    assert.ok(spaces.some((s2) => s2.slug === 'laika-infra'));
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
    assert.deepEqual(slugs(spaces), ['laika-core', 'laika-web']);
    assert.ok(!spaces.some((s2) => s2.slug === 'gone'));
  });

  void test('no duplicates when the current project is also remembered', () => {
    const spaces = recentSpaces(ALL, ['laika-core', 'laika-web'], 'laika-core');
    assert.equal(new Set(spaces.map((s2) => s2.slug)).size, spaces.length);
    assert.ok(spaces.some((s2) => s2.slug === 'laika-core'));
  });

  void test('fewer projects than the limit shows them all and no placeholders', () => {
    const spaces = recentSpaces([CORE], []);
    assert.deepEqual(
      spaces.map((s) => s.slug),
      ['laika-core'],
    );
  });
});
