/**
 * Version comparison (LAI-1131, T7): the line diff, its folding, and the
 * section-level summary.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  diffLines,
  diffSections,
  diffStats,
  foldUnchanged,
  MAX_CELLS,
  sectionKey,
  type DiffLine,
} from '../../../src/components/documents/line-diff.ts';

/** Rebuild each side from the diff: the strongest property a diff has. */
function sides(lines: readonly DiffLine[]): [string, string] {
  return [
    lines
      .filter((l) => l.kind !== 'insert')
      .map((l) => l.text)
      .join('\n'),
    lines
      .filter((l) => l.kind !== 'remove')
      .map((l) => l.text)
      .join('\n'),
  ];
}

void describe('diffLines', () => {
  void test('identical text is all same', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    assert.deepEqual(diffStats(d), { inserted: 0, removed: 0 });
    assert.equal(d.length, 3);
  });

  void test('marks an inserted and a removed line with their line numbers', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc\nd');
    assert.deepEqual(
      d.map((l) => [l.kind, l.text, l.oldLine ?? null, l.newLine ?? null]),
      [
        ['same', 'a', 1, 1],
        ['insert', 'B', null, 2],
        ['remove', 'b', 2, null],
        ['same', 'c', 3, 3],
        ['insert', 'd', null, 4],
      ],
    );
    assert.deepEqual(diffStats(d), { inserted: 2, removed: 1 });
  });

  void test('both versions can be rebuilt from the diff, and it is minimal', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\nsix';
    const after = 'zero\none\nthree\nfour\nFIVE\nsix\nseven';
    const d = diffLines(before, after);
    assert.deepEqual(sides(d), [before, after]);
    // LCS is one, three, four, six: 4 kept of 6 and 7.
    assert.deepEqual(diffStats(d), { inserted: 3, removed: 2 });
  });

  void test('the trial fixture A v1 → v2 round-trips', () => {
    const dir = new URL('../../../src/components/documents/trial/fixtures/', import.meta.url);
    const v1 = readFileSync(fileURLToPath(new URL('architecture-v1.md', dir)), 'utf8');
    const v2 = readFileSync(fileURLToPath(new URL('architecture-v2.md', dir)), 'utf8');
    const d = diffLines(v1, v2);
    assert.deepEqual(sides(d), [v1, v2]);
    assert.ok(d.some((l) => l.kind === 'insert' && l.text.includes('batchSize: 250')));
    assert.ok(d.some((l) => l.kind === 'remove' && l.text.includes('batchSize: 200')));
  });

  void test('refuses an input too large to diff in a tab', () => {
    const big = 'x\n'.repeat(Math.ceil(Math.sqrt(MAX_CELLS)) + 10);
    assert.throws(() => diffLines(big, `${big}y`), /diff too large/);
  });
});

void describe('foldUnchanged', () => {
  void test('folds a long unchanged run to its context', () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join('\n');
    const after = before.replace('l15', 'L15');
    const hunks = foldUnchanged(diffLines(before, after), 3);
    const folded = hunks
      .filter((h) => h.kind === 'fold')
      .map((h) => (h.kind === 'fold' ? h.count : 0));
    // 15 same before (12 folded, 3 kept), 14 after (11 folded, 3 kept).
    assert.deepEqual(folded, [12, 11]);
    const shown = hunks.flatMap((h) => (h.kind === 'lines' ? h.lines : []));
    assert.equal(shown.filter((l) => l.kind !== 'same').length, 2);
  });

  void test('a short run is never folded', () => {
    const hunks = foldUnchanged(diffLines('a\nb\nc', 'a\nX\nc'), 3);
    assert.equal(hunks.filter((h) => h.kind === 'fold').length, 0);
  });
});

void describe('sections', () => {
  void test('sectionKey ignores numbering, not words', () => {
    assert.equal(sectionKey('7.3 Change the ledger'), 'change the ledger');
    assert.equal(sectionKey('8. Risks'), 'risks');
    assert.equal(sectionKey('Appendix A. Load test'), 'load test');
    assert.equal(sectionKey('The system today'), 'the system today');
  });

  void test('added, removed, moved and changed sections', () => {
    const before = '# Doc\n## 1. Intro\nhello\n## 2. Risks\nr\n## 3. Plan\np\n## 4. Old\ngone\n';
    const after =
      '# Doc\n## 1. Intro\nhello there\n## 2. Plan\np\n## 3. Risks\nr\n## 4. New\nfresh\n';
    const out = diffSections(before, after);
    const by = new Map(out.map((s) => [sectionKey(s.title), s.change]));
    assert.equal(by.get('intro'), 'changed');
    assert.equal(by.get('new'), 'added');
    assert.equal(by.get('old'), 'removed');
    // One of Risks/Plan moved; the other kept its relative place.
    const moved = out.filter((s) => s.change === 'moved').map((s) => sectionKey(s.title));
    assert.equal(moved.length, 1);
    assert.ok(['risks', 'plan'].includes(moved[0] ?? ''));
  });

  void test('a renumbered but otherwise identical section is unchanged', () => {
    const out = diffSections('## 1. A\nsee 2.1\n## 2. B\nx', '## 1. A\nsee 3.1\n## 3. B\nx');
    assert.deepEqual(
      out.map((s) => s.change),
      ['unchanged', 'unchanged'],
    );
  });
});
