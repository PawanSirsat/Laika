import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/services/text-diff.ts';

/**
 * The context document's line diff (§4.68, LAI-555). Unified format, three
 * lines of context, and nothing at all when nothing changed.
 */
describe('diffLines', () => {
  it('is empty when nothing changed', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual({ diff: '', added: 0, removed: 0 });
    expect(diffLines('', '')).toEqual({ diff: '', added: 0, removed: 0 });
  });

  it('from the empty document, every line is an addition', () => {
    expect(diffLines('', 'a\nb')).toEqual({ diff: '@@ -0,0 +1,2 @@\n+a\n+b', added: 2, removed: 0 });
  });

  it('to the empty document, every line is a removal', () => {
    expect(diffLines('a\nb', '')).toEqual({ diff: '@@ -1,2 +0,0 @@\n-a\n-b', added: 0, removed: 2 });
  });

  it('a changed line in the middle keeps three lines of context either side', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
    const after = ['1', '2', '3', '4', 'FIVE', '6', '7', '8', '9'].join('\n');
    expect(diffLines(before, after).diff).toBe(
      ['@@ -2,7 +2,7 @@', ' 2', ' 3', ' 4', '-5', '+FIVE', ' 6', ' 7', ' 8'].join('\n'),
    );
  });

  it('two changes far apart are two hunks', () => {
    const before = Array.from({ length: 20 }, (_, i) => String(i + 1)).join('\n');
    const after = before.replace(/^1$/m, 'one').replace(/^20$/m, 'twenty');
    const { diff, added, removed } = diffLines(before, after);
    expect(diff.split('\n').filter((l) => l.startsWith('@@'))).toEqual([
      '@@ -1,4 +1,4 @@',
      '@@ -17,4 +17,4 @@',
    ]);
    expect([added, removed]).toEqual([2, 2]);
  });

  it('finds the shortest edit, not a rewrite of everything after the change', () => {
    const { added, removed } = diffLines('a\nb\nc\nd', 'a\nX\nb\nc\nd');
    expect([added, removed]).toEqual([1, 0]);
  });

  it('an append is only the appended lines', () => {
    const before = 'one\ntwo';
    const after = 'one\ntwo\n\nthree';
    expect(diffLines(before, after)).toEqual({
      diff: '@@ -1,2 +1,4 @@\n one\n two\n+\n+three',
      added: 2,
      removed: 0,
    });
  });
});
