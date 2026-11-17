/**
 * The Create task dialog's Space field (LAI-1227): which spaces it offers,
 * which it starts on, and what a change of space keeps and clears. The
 * browser half — the field, the reloads, the stale submit — is
 * `test/browser/create-task-space.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  creatableSpaces,
  defaultCreateSpace,
  draftForSpace,
  keepValidInSpace,
  LAST_CREATE_SPACE_KEY,
  readLastCreateSpace,
  writeLastCreateSpace,
} from '../../../src/components/create-task/create-space.ts';
import { emptyDraft } from '../../../src/components/create-task/create-task-form.ts';
import type { ProjectStatus } from '../../../src/api/statuses.ts';
import type { Member } from '../../../src/api/tasks.ts';

const space = (slug: string) => ({ id: `id-${slug}`, slug, name: slug, key: slug.slice(0, 2) });
const ALLOWED = [space('atlas'), space('core')];

const status = (id: string, category: string, position: number, hidden = false) =>
  ({ id, name: id, category, position, hidden }) as unknown as ProjectStatus;
const member = (id: string) => ({ user_id: id, name: id }) as unknown as Member;

void describe('the spaces offered', () => {
  void test('only those whose task.create the server grants, in the order given', () => {
    const all = [space('atlas'), space('core'), space('docs')];
    const granted = new Set(['id-docs', 'id-atlas']);
    assert.deepEqual(
      creatableSpaces(all, (id) => granted.has(id)).map((s) => s.slug),
      ['atlas', 'docs'],
    );
    assert.deepEqual(
      creatableSpaces(all, () => false),
      [],
    );
  });
});

void describe('the space it starts on', () => {
  void test('asked for, else on screen, else last used, else the first allowed', () => {
    assert.equal(
      defaultCreateSpace({ preset: 'core', current: 'atlas', last: 'atlas', allowed: ALLOWED }),
      'core',
    );
    assert.equal(defaultCreateSpace({ current: 'core', last: 'atlas', allowed: ALLOWED }), 'core');
    assert.equal(defaultCreateSpace({ last: 'core', allowed: ALLOWED }), 'core');
    assert.equal(defaultCreateSpace({ allowed: ALLOWED }), 'atlas');
  });

  void test('a space the reader may no longer create in is passed over at every step', () => {
    assert.equal(
      defaultCreateSpace({ preset: 'gone', current: 'viewer-only', last: 'old', allowed: ALLOWED }),
      'atlas',
    );
    assert.equal(defaultCreateSpace({ current: 'x', last: 'core', allowed: ALLOWED }), 'core');
  });

  void test('none allowed: none chosen', () => {
    assert.equal(defaultCreateSpace({ current: 'core', last: 'core', allowed: [] }), undefined);
  });
});

void describe('the last space created in', () => {
  void test('kept per browser as a slug, and refused storage is no memory, not an error', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    writeLastCreateSpace(storage, 'core');
    assert.equal(store.get(LAST_CREATE_SPACE_KEY), 'core');
    assert.equal(readLastCreateSpace(storage), 'core');
    store.set(LAST_CREATE_SPACE_KEY, '<script>');
    assert.equal(readLastCreateSpace(storage), undefined, 'a value that is not a slug');
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(readLastCreateSpace(refusing), undefined);
    assert.doesNotThrow(() => {
      writeLastCreateSpace(refusing, 'core');
    });
    assert.equal(readLastCreateSpace(undefined), undefined);
  });
});

void describe('a change of space', () => {
  const filled = {
    ...emptyDraft(),
    title: 'Ship it',
    description: 'Why',
    priority: 'p1' as const,
    statusId: 's-old',
    sprintId: 'sp-old',
    agentId: 'ag-1',
    parentId: 't-parent',
    blockedBy: ['t-1'],
    assigneeId: 'u1',
    tags: ['ui'],
    dueOn: '2026-12-01',
  };

  void test('keeps what describes the task, clears what names the old space', () => {
    const next = draftForSpace(filled);
    assert.equal(next.title, 'Ship it');
    assert.equal(next.description, 'Why');
    assert.equal(next.priority, 'p1');
    assert.deepEqual(next.tags, ['ui']);
    assert.equal(next.dueOn, '2026-12-01');
    assert.equal(next.statusId, undefined);
    assert.equal(next.sprintId, null);
    assert.equal(next.agentId, null);
    assert.equal(next.parentId, null);
    assert.deepEqual(next.blockedBy, []);
    assert.equal(next.assigneeId, 'u1', 'the assignee waits for the new space’s members');
  });

  void test('a status the space does not have becomes its default; one it has stays', () => {
    const statuses = [status('todo', 'todo', 2), status('back', 'backlog', 1)];
    assert.equal(keepValidInSpace(filled, { statuses, members: undefined }).statusId, 'back');
    const own = { ...filled, statusId: 'todo' };
    assert.equal(keepValidInSpace(own, { statuses, members: undefined }), own, 'unchanged object');
  });

  void test('an assignee who is not a member becomes nobody — once the members are known', () => {
    const own = { ...filled, statusId: 'todo' };
    const statuses = [status('todo', 'todo', 1)];
    assert.equal(keepValidInSpace(own, { statuses, members: undefined }).assigneeId, 'u1');
    assert.equal(keepValidInSpace(own, { statuses, members: [member('u2')] }).assigneeId, null);
    assert.equal(keepValidInSpace(own, { statuses, members: [member('u1')] }), own);
  });

  void test('nothing is decided while the statuses are unknown', () => {
    assert.equal(keepValidInSpace(filled, { statuses: [], members: undefined }), filled);
  });
});
