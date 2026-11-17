/**
 * The palette's Recent and its highlighted matches (LAI-1221): ids only are
 * written, never a title or a query; entries are named again from what the
 * reader may read now and dropped when they cannot be; and a highlight never
 * changes a label's text.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  pushRecent,
  readRecent,
  RECENT_LIMIT,
  recentKey,
  writeRecent,
  type RecentEntry,
} from '../../../src/components/command/palette-recent.ts';
import {
  goToItems,
  highlightParts,
  recentItems,
} from '../../../src/components/command/palette-model.ts';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

void describe('Recent', () => {
  void test('newest first, no repeats, at most five, per person', () => {
    let list: readonly RecentEntry[] = [];
    for (const id of ['/a', '/b', '/a', '/c', '/d', '/e', '/f']) {
      list = pushRecent(list, { kind: 'page', id });
    }
    assert.equal(list.length, RECENT_LIMIT);
    assert.deepEqual(
      list.map((e) => e.id),
      ['/f', '/e', '/d', '/c', '/a'],
    );
    const storage = memory();
    writeRecent(storage, 'u1', list);
    assert.deepEqual(readRecent(storage, 'u1'), list);
    assert.deepEqual(readRecent(storage, 'u2'), []);
  });

  void test('writes ids only: a title smuggled onto an entry never reaches storage', () => {
    const storage = memory();
    const entry = { kind: 'task', id: '01T', key: 'LC-12', space: 'core', title: 'Payroll' };
    writeRecent(storage, 'u1', pushRecent([], entry as RecentEntry));
    const raw = storage.map.get(recentKey('u1')) ?? '';
    assert.doesNotMatch(raw, /Payroll/);
    assert.deepEqual(JSON.parse(raw), [{ kind: 'task', id: '01T', key: 'LC-12', space: 'core' }]);
  });

  void test('a hand-edited or broken store reads as nothing, never a throw', () => {
    const storage = memory();
    storage.map.set(recentKey('u1'), '{nope');
    assert.deepEqual(readRecent(storage, 'u1'), []);
    storage.map.set(
      recentKey('u1'),
      JSON.stringify([{ kind: 'page', id: '/inbox' }, { kind: 'evil', id: 'x' }, { id: 'a b' }]),
    );
    assert.deepEqual(readRecent(storage, 'u1'), [{ kind: 'page', id: '/inbox' }]);
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    assert.deepEqual(readRecent(refusing, 'u1'), []);
  });

  void test('named again from what the reader may read now; the rest is dropped', () => {
    const pages = goToItems(() => true, undefined, undefined);
    const rows = recentItems(
      [
        { kind: 'page', id: '/inbox' },
        { kind: 'page', id: '/gone' },
        { kind: 'space', id: 'core' },
        { kind: 'space', id: 'archived' },
        { kind: 'person', id: 'u2' },
        { kind: 'task', id: '01T', key: 'LC-12', space: 'core' },
      ],
      {
        pages,
        spaces: [{ id: 'p1', slug: 'core', name: 'Laika Core', key: 'LC' }],
        people: undefined,
        currentPath: '/inbox',
      },
    );
    assert.deepEqual(
      rows.map((r) => [r.label, r.href]),
      [
        ['Inbox', '/inbox'],
        ['Laika Core', '/board?project=core'],
        ['LC-12', '/board?project=core&task=01T'],
      ],
    );
  });
});

void describe('highlighted matches', () => {
  const marks = (text: string, query: string) =>
    highlightParts(text, query)
      .filter((p) => p.match)
      .map((p) => p.text);

  void test('marks each word, case-insensitive, and the parts are the label exactly', () => {
    assert.deepEqual(marks('Release checklist', 'check REL'), ['Rel', 'check']);
    for (const [text, query] of [
      ['Inbox', 'in'],
      ['Laika Core', 'lai laika'],
      ['x', ''],
    ] as const) {
      assert.equal(
        highlightParts(text, query)
          .map((p) => p.text)
          .join(''),
        text,
      );
    }
    assert.deepEqual(marks('Laika', 'lai laika'), ['Laika']);
    assert.deepEqual(marks('Inbox', ''), []);
  });
});
