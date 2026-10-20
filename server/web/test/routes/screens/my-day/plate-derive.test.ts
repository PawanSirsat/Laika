/**
 * *On your plate* (LAI-796): the reader's own work in progress, what waits on
 * their review, and what is blocked — from data the board already serves.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  blockerIds,
  capped,
  moreHref,
  plateOf,
  PLATE_CAP,
  type PlateItem,
} from '../../../../src/routes/screens/my-day/plate-derive.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';
import type { ReviewQueueItem } from '../../../../src/api/review.ts';

function task(id: string, status: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    key: `LAI-${id}`,
    title: `Task ${id}`,
    status,
    blocked_by: [],
    updated_at: 0,
    ...extra,
  } as unknown as TaskSummary;
}

const mine = (...tasks: TaskSummary[]) => tasks.map((t) => ({ task: t, slug: 'laika' }));

function waiting(
  id: string,
  can: boolean,
  ci: Readonly<Record<string, number>> | null,
): ReviewQueueItem {
  return {
    task: { ...task(id, 'review'), description_md: null, acceptance_md: null },
    project: { id: 'p1', slug: 'laika', name: 'Laika', prefix: 'LAI' },
    assignee_name: null,
    waiting_since: 0,
    round: ci === null ? null : ({ ci } as never),
    finished_by_name: null,
    can_decide: can,
    cue: null,
  };
}

void describe('in progress', () => {
  void test('the reader’s tasks in progress, most recently touched first', () => {
    const plate = plateOf(
      mine(
        task('1', 'in_progress', { updated_at: 5 }),
        task('2', 'todo'),
        task('3', 'in_progress', { updated_at: 9 }),
      ),
      new Map(),
      [],
    );
    assert.deepEqual(
      plate.inProgress.map((i) => i.key),
      ['LAI-3', 'LAI-1'],
    );
    assert.equal(plate.inProgress[0]?.slug, 'laika');
  });
});

void describe('blocked', () => {
  void test('an open task with an open blocker, naming what it waits on', () => {
    const plate = plateOf(
      mine(task('1', 'todo', { blocked_by: ['9'] })),
      new Map([['9', { key: 'LAI-9', status: 'in_progress' }]]),
      [],
    );
    assert.deepEqual(
      plate.blocked.map((i) => [i.key, i.note]),
      [['LAI-1', 'Waiting on LAI-9']],
    );
  });

  void test('a blocker that is done or cancelled holds nothing up', () => {
    const plate = plateOf(
      mine(task('1', 'todo', { blocked_by: ['8', '9'] })),
      new Map([
        ['8', { key: 'LAI-8', status: 'done' }],
        ['9', { key: 'LAI-9', status: 'cancelled' }],
      ]),
      [],
    );
    assert.deepEqual(plate.blocked, []);
  });

  void test('a blocker among the reader’s own tasks is read from them', () => {
    const plate = plateOf(
      mine(task('1', 'todo', { blocked_by: ['2'] }), task('2', 'in_progress')),
      new Map(),
      [],
    );
    assert.deepEqual(
      plate.blocked.map((i) => i.note),
      ['Waiting on LAI-2'],
    );
  });

  void test('a blocker nobody could read still blocks, and is not named', () => {
    const plate = plateOf(mine(task('1', 'todo', { blocked_by: ['x'] })), new Map(), []);
    assert.deepEqual(
      plate.blocked.map((i) => i.note),
      ['Waiting on another task'],
    );
  });

  void test('a blocked task in progress is listed once, as blocked', () => {
    const plate = plateOf(
      mine(task('1', 'in_progress', { blocked_by: ['9'] })),
      new Map([['9', { key: 'LAI-9', status: 'todo' }]]),
      [],
    );
    assert.deepEqual(plate.inProgress, []);
    assert.equal(plate.blocked.length, 1);
  });

  void test('done work is never on the plate', () => {
    const plate = plateOf(
      mine(task('1', 'done', { blocked_by: ['9'] })),
      new Map([['9', { key: 'LAI-9', status: 'todo' }]]),
      [],
    );
    assert.deepEqual(plate.blocked, []);
  });
});

void describe('waiting on your review', () => {
  void test('only what this reader may decide', () => {
    const plate = plateOf([], new Map(), [waiting('4', true, null), waiting('5', false, null)]);
    assert.deepEqual(
      (plate.review ?? []).map((i) => i.key),
      ['LAI-4'],
    );
  });

  void test('says what CI reported, and nothing when it reported nothing', () => {
    const plate = plateOf([], new Map(), [
      waiting('1', true, { total: 3, passed: 3, failed: 0, pending: 0 }),
      waiting('2', true, { total: 3, passed: 1, failed: 1, pending: 1 }),
      waiting('3', true, { total: 2, passed: 1, failed: 0, pending: 1 }),
      waiting('4', true, null),
    ]);
    assert.deepEqual(
      (plate.review ?? []).map((i) => [i.note, i.tone]),
      [
        ['CI passed', 'ok'],
        ['CI failed', 'bad'],
        ['CI pending', 'wait'],
        [undefined, undefined],
      ],
    );
  });

  void test('a queue not read yet is no list', () => {
    assert.equal(plateOf([], new Map(), undefined).review, undefined);
  });
});

void describe('which blockers to look up', () => {
  void test('those of open tasks that are not the reader’s own', () => {
    assert.deepEqual(
      blockerIds(
        mine(
          task('1', 'todo', { blocked_by: ['2', '9'] }),
          task('2', 'todo'),
          task('3', 'done', { blocked_by: ['7'] }),
        ),
      ),
      ['9'],
    );
  });

  void test('each once', () => {
    assert.deepEqual(
      blockerIds(
        mine(task('1', 'todo', { blocked_by: ['9'] }), task('2', 'todo', { blocked_by: ['9'] })),
      ),
      ['9'],
    );
  });
});

void describe('five of each, then +N more (LAI-810)', () => {
  const item = (n: number, slug: string | undefined = 'atlas'): PlateItem => ({
    id: `t${String(n)}`,
    key: `LAI-${String(n)}`,
    title: `Task ${String(n)}`,
    slug,
  });

  void test('at most five shown; the rest counted, not dropped', () => {
    assert.equal(PLATE_CAP, 5);
    const all = Array.from({ length: 200 }, (_, i) => item(i));
    const { shown, more } = capped(all);
    assert.deepEqual(
      shown.map((i) => i.key),
      ['LAI-0', 'LAI-1', 'LAI-2', 'LAI-3', 'LAI-4'],
    );
    assert.equal(more, 195);
    assert.equal(capped(all.slice(0, 5)).more, 0);
    assert.equal(capped([]).more, 0);
  });

  void test('+N more leads where the rest live', () => {
    assert.equal(moreHref('review', [item(6)], 'u1'), '/inbox?tab=review');
    assert.equal(
      moreHref('progress', [item(6, 'onroute'), item(7)], 'u1'),
      '/list?project=onroute&assignee=u1&status=in_progress',
    );
    // No URL filter says "blocked": the reader's own open work in that space.
    assert.equal(moreHref('blocked', [item(6)], 'u1'), '/list?project=atlas&assignee=u1');
    assert.equal(moreHref('blocked', [{ ...item(6), slug: undefined }], undefined), '/list');
  });
});
