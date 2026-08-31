/**
 * `src/api/pick-project.ts` — which project a screen shows when the URL is
 * silent (LAI-423).
 *
 * The old rule was `live[0]` against an **alphabetically** ordered response, so
 * everyone landed on whichever project sorts first regardless of where any work
 * was. Measured against the seeded instance: `['atlas', 'laika-core',
 * 'pathfinder']` — `atlas` had 2 tasks and no sprints, `laika-core` had 41 and
 * three sprints.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pickProject } from '../../src/api/pick-project.ts';
import type { Project, ProjectRow } from '../../src/api/projects.ts';

function project(slug: string, lastActivity: number | null): Project {
  return { id: `id-${slug}`, slug, name: slug, last_activity_at: lastActivity } as Project;
}

/** Alphabetical, the way `GET /projects` actually returns them. */
const ALPHABETICAL: readonly ProjectRow[] = [
  project('atlas', 1_000),
  project('laika-core', 9_000),
  project('pathfinder', 5_000),
];

void describe('the URL wins whenever it names something real', () => {
  void test('an explicit slug is honoured even when another is busier', () => {
    assert.equal(pickProject(ALPHABETICAL, 'atlas')?.slug, 'atlas');
  });

  void test('a stale or mistyped slug falls back rather than dead-ending', () => {
    // Someone following an old link is better served by a working board than by
    // an error, and the server will refuse anything they are not allowed.
    assert.equal(pickProject(ALPHABETICAL, 'deleted-project')?.slug, 'laika-core');
  });
});

void describe('the fallback is where work is, not what sorts first', () => {
  void test('it picks the most recently active, not the alphabetically first', () => {
    // The exact defect: `live[0]` would be `atlas`.
    const picked = pickProject(ALPHABETICAL, undefined);
    assert.equal(picked?.slug, 'laika-core');
    assert.notEqual(picked?.slug, 'atlas', 'fell back to the alphabetically-first project');
  });

  void test('order of the response does not change the answer', () => {
    // A rule that depends on the server's ordering is the rule being replaced.
    const reversed = [...ALPHABETICAL].reverse();
    assert.equal(pickProject(reversed, undefined)?.slug, 'laika-core');
  });

  void test('a project nothing has happened in sorts last, not first', () => {
    // `null` must not win a "most recent" comparison — that hands the reader
    // the emptiest project, which is the symptom being fixed.
    const withUntouched: readonly ProjectRow[] = [project('untouched', null), project('busy', 5)];
    assert.equal(pickProject(withUntouched, undefined)?.slug, 'busy');
  });

  void test('all-untouched still returns one rather than nothing', () => {
    const none: readonly ProjectRow[] = [project('a', null), project('b', null)];
    assert.ok(pickProject(none, undefined) !== undefined, 'showed no project at all');
  });

  void test('no projects is undefined, not a crash', () => {
    assert.equal(pickProject([], undefined), undefined);
    assert.equal(pickProject([], 'anything'), undefined);
  });
});

void describe('tombstones are not projects', () => {
  void test('a tombstone is never picked', () => {
    // It carries no slug, so picking one shows a screen scoped to `undefined`.
    const rows = [{ id: 'gone', deleted: true } as unknown as ProjectRow, project('real', 1)];
    assert.equal(pickProject(rows, undefined)?.slug, 'real');
  });
});
