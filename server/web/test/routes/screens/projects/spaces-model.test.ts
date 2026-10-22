/**
 * The Spaces page's rules (D-103 item 12, LAI-978), without a browser. What
 * the page draws from them is in `test/browser/spaces-page.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Project } from '../../../../src/api/projects.ts';
import {
  ago,
  matchesSearch,
  progressLine,
  progressOf,
  readSpacesQuery,
  sectionsFor,
  spaceCounts,
  spaceSubline,
  splitSpaces,
  writeSpacesQuery,
} from '../../../../src/routes/screens/projects/spaces-model.ts';

const space = (id: string, over: Partial<Project> = {}): Project => ({
  id,
  slug: id,
  prefix: id.toUpperCase(),
  name: `Space ${id}`,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 0,
  members: [],
  last_activity_at: null,
  ...over,
});

const MINE = space('mine');
const MINE_PUBLIC = space('minepub', { visibility: 'public' });
const OPEN = space('open', { visibility: 'public', repo: 'acme/rocket' });
const SHUT = space('shut');
const GONE = space('gone', { archived_at: 5 });
const mine = (p: Project): boolean => p.id === 'mine' || p.id === 'minepub';

void describe('the URL carries the chip, the view and the search', () => {
  void test('defaults are all, grid and empty', () => {
    assert.deepEqual(readSpacesQuery(new URLSearchParams('')), {
      filter: 'all',
      view: 'grid',
      q: '',
    });
    assert.deepEqual(readSpacesQuery(new URLSearchParams('filter=bogus&view=table')), {
      filter: 'all',
      view: 'grid',
      q: '',
    });
  });

  void test('a change is written, a default is removed, other parameters stay', () => {
    const start = new URLSearchParams('other=1');
    const listed = writeSpacesQuery(start, { view: 'list', filter: 'archived', q: 'rock' });
    assert.equal(listed.toString(), 'other=1&filter=archived&view=list&q=rock');
    assert.deepEqual(readSpacesQuery(listed), { filter: 'archived', view: 'list', q: 'rock' });
    const back = writeSpacesQuery(listed, { view: 'grid', filter: 'all', q: '' });
    assert.equal(back.toString(), 'other=1');
  });
});

void describe('search', () => {
  void test('matches name, slug, prefix, repository and description, any case', () => {
    assert.equal(matchesSearch(OPEN, 'ROCKET'), true, 'repository');
    assert.equal(matchesSearch(OPEN, 'space open'), true, 'name');
    assert.equal(matchesSearch(space('x', { description: 'Payments core' }), 'payments'), true);
    assert.equal(matchesSearch(OPEN, 'nothing-like-it'), false);
    assert.equal(matchesSearch(OPEN, '   '), true, 'a blank search hides nothing');
  });
});

void describe('sections and counts', () => {
  const split = splitSpaces([MINE, MINE_PUBLIC, OPEN, SHUT], [GONE, MINE], mine);

  void test('yours, joinable public and archived are kept apart', () => {
    assert.deepEqual(
      split.yours.map((p) => p.id),
      ['mine', 'minepub'],
    );
    assert.deepEqual(
      split.joinable.map((p) => p.id),
      ['open'],
      'a private space the reader is not in is never listed',
    );
    assert.deepEqual(
      split.archived.map((p) => p.id),
      ['gone'],
      'a live row in the archived list is not shown as archived',
    );
  });

  void test('an archived row in the main list is not shown as live', () => {
    const s = splitSpaces([MINE, GONE], [], () => true);
    assert.deepEqual(
      s.yours.map((p) => p.id),
      ['mine'],
    );
  });

  void test('counts: all is yours plus joinable; public counts both; archived its own', () => {
    assert.deepEqual(spaceCounts(split), { all: 3, yours: 2, public: 2, archived: 1 });
  });

  void test('each chip shows its own sections, narrowed by the search', () => {
    const ids = (s: ReturnType<typeof sectionsFor>) => ({
      yours: s.yours.map((p) => p.id),
      joinable: s.joinable.map((p) => p.id),
      archived: s.archived.map((p) => p.id),
    });
    assert.deepEqual(ids(sectionsFor(split, 'all', '')), {
      yours: ['mine', 'minepub'],
      joinable: ['open'],
      archived: [],
    });
    assert.deepEqual(ids(sectionsFor(split, 'yours', '')), {
      yours: ['mine', 'minepub'],
      joinable: [],
      archived: [],
    });
    assert.deepEqual(ids(sectionsFor(split, 'public', '')), {
      yours: ['minepub'],
      joinable: ['open'],
      archived: [],
    });
    assert.deepEqual(ids(sectionsFor(split, 'archived', '')), {
      yours: [],
      joinable: [],
      archived: ['gone'],
    });
    assert.deepEqual(ids(sectionsFor(split, 'all', 'rocket')), {
      yours: [],
      joinable: ['open'],
      archived: [],
    });
  });
});

void describe('the numbers on a card', () => {
  void test('progress counts every task but cancelled, from the served counts', () => {
    const p = progressOf(
      space('x', {
        task_counts: {
          backlog: 300,
          todo: 10,
          in_progress: 10,
          review: 42,
          done: 358,
          cancelled: 9,
        },
        blocked_count: 38,
      }),
    );
    assert.deepEqual(p, { total: 720, done: 358, review: 42, active: 10, blocked: 38 });
    assert.deepEqual(progressLine(p), {
      main: '358/720 done',
      active: '10 active',
      blocked: '38 blocked',
    });
  });

  void test('nothing active or blocked says nothing about it', () => {
    assert.deepEqual(progressLine(progressOf(space('x'))), {
      main: '0/0 done',
      active: null,
      blocked: null,
    });
  });

  void test('the sub-line is key · repository, or key · slug', () => {
    assert.equal(spaceSubline(OPEN), 'OPEN-1 · acme/rocket');
    assert.equal(spaceSubline(MINE), 'MINE-1 · mine');
  });

  void test('updated reads short', () => {
    assert.equal(ago(0, 30_000), 'just now');
    assert.equal(ago(0, 3 * 60_000), '3m ago');
    assert.equal(ago(0, 2 * 3_600_000), '2h ago');
    assert.equal(ago(0, 3 * 86_400_000), '3d ago');
  });
});
