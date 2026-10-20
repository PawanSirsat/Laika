/**
 * Every row on My day links to its card (LAI-810) by **LAI-755's route**: in
 * its own space by id, or a key search when the space is not known — the two
 * addresses `openTaskInItsSpace` navigates to.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  plainClick,
  spaceOfKey,
  taskHref,
} from '../../../../src/routes/screens/my-day/task-link.ts';
import { code } from '../../../helpers/code.ts';

const click = (over: Partial<Parameters<typeof plainClick>[0]> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

void describe('where a card opens', () => {
  void test('in its own space, by id', () => {
    assert.equal(taskHref({ id: 't 1', key: 'LAI-1' }, 'atlas'), '/board?project=atlas&task=t%201');
  });

  void test('by key when the space is not known', () => {
    assert.equal(taskHref({ id: 't1', key: 'LAI-1' }, undefined), '/board?q=LAI-1');
  });

  void test('the same two addresses the shell navigates to for LAI-755', async () => {
    const outlet = code(
      await readFile(
        new URL('../../../../src/components/shell/ScreenOutlet.tsx', import.meta.url),
        'utf8',
      ),
    );
    assert.match(
      outlet,
      /`\/board\?project=\$\{encodeURIComponent\(projectSlug\)\}&task=\$\{encodeURIComponent\(id\)\}`/,
    );
    assert.match(outlet, /`\/board\?q=\$\{encodeURIComponent\(taskKey\)\}`/);
  });
});

void describe('which clicks the app follows itself', () => {
  void test('a plain left click', () => {
    assert.equal(plainClick(click()), true);
  });

  void test('never one meant for a new tab or window', () => {
    for (const over of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      assert.equal(plainClick(click(over)), false, JSON.stringify(over));
    }
  });
});

void describe('whether the reader can read a card, from its key (review round 1)', () => {
  const spaces = [
    { prefix: 'LAI', slug: 'atlas', name: 'Atlas' },
    { prefix: 'ON-RT', slug: 'onroute', name: 'Onroute' },
  ];

  void test('a key whose prefix is a space the reader can read names that space', () => {
    assert.equal(spaceOfKey('LAI-42', spaces)?.slug, 'atlas');
    assert.equal(spaceOfKey('ON-RT-7', spaces)?.slug, 'onroute');
  });

  void test('any other key is a card the reader cannot read', () => {
    assert.equal(spaceOfKey('SEC-1', spaces), undefined);
    assert.equal(spaceOfKey('LA-42', spaces), undefined);
    assert.equal(spaceOfKey('LAI', spaces), undefined);
    assert.equal(spaceOfKey('LAI-42', []), undefined);
  });
});
