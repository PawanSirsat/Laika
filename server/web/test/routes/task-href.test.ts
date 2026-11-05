/**
 * `task-href.ts` — where a task link opens (LAI-1190, B2 and B18).
 *
 * The bug was a link with no space: `/board?q=KEY` let the board fall back to
 * the space it last showed, so Meeting review and Unlisted could open the
 * wrong space's board. Each case below pins one half of the rule.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { slugOfKey, taskHref, withTaskOpen } from '../../src/routes/task-href.ts';

void describe('taskHref', () => {
  void test('names the space and opens the drawer by id', () => {
    assert.equal(taskHref({ id: 't1', key: 'LAI-1' }, 'atlas'), '/board?project=atlas&task=t1');
  });

  void test('opens by key when the caller has no id', () => {
    assert.equal(taskHref({ key: 'LAI-7' }, 'atlas'), '/board?project=atlas&task=LAI-7');
  });

  void test('opens on another view of the space when asked', () => {
    assert.equal(
      taskHref({ id: 't1', key: 'LAI-1' }, 'atlas', '/calendar'),
      '/calendar?project=atlas&task=t1',
    );
  });

  void test('falls back to a key search only when no space is known', () => {
    assert.equal(taskHref({ id: 't1', key: 'LAI-1' }, undefined), '/board?q=LAI-1');
  });

  void test('encodes what it is given', () => {
    assert.equal(taskHref({ key: 'A B' }, 'a&b'), '/board?project=a%26b&task=A+B');
  });
});

void describe('withTaskOpen', () => {
  void test('keeps the view’s own keys and sets project and task', () => {
    const next = withTaskOpen(new URLSearchParams('sprint=s1&new=task'), { key: 'LAI-3' }, 'atlas');
    assert.equal(next.toString(), 'sprint=s1&project=atlas&task=LAI-3');
  });

  void test('does not change what it was given', () => {
    const params = new URLSearchParams('sprint=s1');
    withTaskOpen(params, { id: 't1', key: 'LAI-1' }, 'atlas');
    assert.equal(params.toString(), 'sprint=s1');
  });
});

void describe('slugOfKey', () => {
  const spaces = [
    { prefix: 'LAI', slug: 'laika' },
    { prefix: 'LAI-OPS', slug: 'ops' },
  ];

  void test('finds the space by the key’s prefix', () => {
    assert.equal(slugOfKey('LAI-12', spaces), 'laika');
  });

  void test('splits at the last dash, so a prefix may hold one', () => {
    assert.equal(slugOfKey('LAI-OPS-3', spaces), 'ops');
  });

  void test('is undefined for a key no readable space owns, or no key at all', () => {
    assert.equal(slugOfKey('ZZ-1', spaces), undefined);
    assert.equal(slugOfKey('01JABCDEF', spaces), undefined);
  });
});
