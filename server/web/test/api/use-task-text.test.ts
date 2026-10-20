/**
 * `src/api/use-task-text.ts` — the task panel's two texts (LAI-795).
 *
 * Every list is slim, so the panel reads the task in full itself. The hook
 * cannot be rendered here (CONVENTIONS §4); its two rules are pure and are
 * tested directly: **when to read again**, and **what to draw meanwhile**. The
 * read itself is asserted in a browser (`test/browser/slim-list.test.ts`).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Task, TaskSummary } from '../../src/api/tasks.ts';
import { needsText, withText } from '../../src/api/use-task-text.ts';

const summary = (over: Partial<TaskSummary> = {}): TaskSummary =>
  ({ id: 't1', title: 'From the store', comment_count: 2, updated_at: 10, ...over }) as TaskSummary;

const full = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'From the read',
    comment_count: 0,
    description_md: 'The description',
    acceptance_md: '- [ ] done',
    updated_at: 10,
    ...over,
  }) as Task;

void describe('needsText: when the panel reads the task again', () => {
  void test('nothing held yet', () => {
    assert.equal(needsText(summary(), undefined), true);
  });

  void test('what is held is another task’s — the drawer moved to a different one', () => {
    assert.equal(needsText(summary({ id: 't2' }), full()), true);
  });

  void test('the store has a newer version: a write somewhere else may have changed the text', () => {
    assert.equal(needsText(summary({ updated_at: 11 }), full({ updated_at: 10 })), true);
  });

  void test('not when the held copy is as new as the store’s, or newer — the panel’s own write', () => {
    assert.equal(needsText(summary({ updated_at: 10 }), full({ updated_at: 10 })), false);
    assert.equal(needsText(summary({ updated_at: 10 }), full({ updated_at: 12 })), false);
  });
});

void describe('withText: what the panel draws', () => {
  void test('nothing for this task until its texts are read — never another task’s', () => {
    assert.equal(withText(summary(), undefined), undefined);
    assert.equal(withText(summary({ id: 't2' }), full()), undefined);
  });

  void test('the store’s live fields, with the texts held', () => {
    const shown = withText(summary(), full());
    assert.equal(shown?.title, 'From the store');
    assert.equal(shown?.comment_count, 2);
    assert.equal(shown?.description_md, 'The description');
    assert.equal(shown?.acceptance_md, '- [ ] done');
  });

  void test('keeps the held texts while a newer version is being read, rather than blanking them', () => {
    const shown = withText(summary({ updated_at: 11 }), full({ updated_at: 10 }));
    assert.equal(shown?.description_md, 'The description');
  });
});
