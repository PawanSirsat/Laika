/**
 * `workroom-resolve.ts` — a key to a task on the client (LAI-1199), since the
 * REST task read takes an id only.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TaskSummary } from '../../../../src/api/tasks.ts';
import {
  findByKey,
  prefixOf,
  spaceOfKey,
} from '../../../../src/routes/screens/workroom/workroom-resolve.ts';

const t = (id: string, key: string, number: number, external_ref: string | null = null) =>
  ({ id, key, number, external_ref }) as TaskSummary;

void describe('prefixOf', () => {
  void test('the part before the number, or nothing for a non-key', () => {
    assert.equal(prefixOf('LAI-42'), 'LAI');
    assert.equal(prefixOf(' lc2-7 '), 'lc2');
    assert.equal(prefixOf('01HZX'), undefined);
    assert.equal(prefixOf('LAI-'), undefined);
  });
});

void describe('spaceOfKey', () => {
  const spaces = [
    { slug: 'core', prefix: 'LC', former_prefixes: [] },
    { slug: 'web', prefix: 'LW', former_prefixes: ['LC'] },
    { slug: 'old', prefix: 'NEW', former_prefixes: ['OLD'] },
  ];
  void test('by prefix, any case; the current prefix beats a former one', () => {
    assert.equal(spaceOfKey('lc-1', spaces)?.slug, 'core');
    assert.equal(spaceOfKey('OLD-3', spaces)?.slug, 'old');
    assert.equal(spaceOfKey('ZZ-1', spaces), undefined);
    assert.equal(spaceOfKey('not a key', spaces), undefined);
  });
});

void describe('findByKey', () => {
  const tasks = [t('a', 'LC-1', 1), t('b', 'LC-2', 2, 'LAI-1199'), t('c', 'LC-3', 3, 'LC-1')];
  void test('by key first, any case — a board key beats an outside id', () => {
    assert.equal(findByKey(tasks, 'lc-1')?.id, 'a');
  });
  void test('by outside id when no key matches', () => {
    assert.equal(findByKey(tasks, 'LAI-1199')?.id, 'b');
  });
  void test('by number when the key used a prefix the space has changed', () => {
    assert.equal(findByKey(tasks, 'OLD-3')?.id, 'c');
  });
  void test('nothing for a key that names nothing', () => {
    assert.equal(findByKey(tasks, 'LC-99'), undefined);
  });
});
