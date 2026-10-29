import { describe, expect, it } from 'vitest';
import { diffLines, MAX_EDIT_DISTANCE } from '../../src/services/text-diff.ts';

/**
 * The context document's line diff (§4.68, LAI-555). Unified format, three
 * lines of context, and nothing at all when nothing changed.
 */
describe('diffLines', () => {
  it('is empty when nothing changed', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual({ diff: '', added: 0, removed: 0, truncated: false });
    expect(diffLines('', '')).toEqual({ diff: '', added: 0, removed: 0, truncated: false });
  });

  it('from the empty document, every line is an addition', () => {
    expect(diffLines('', 'a\nb')).toEqual({
      diff: '@@ -0,0 +1,2 @@\n+a\n+b',
      added: 2,
      removed: 0,
      truncated: false,
    });
  });

  it('to the empty document, every line is a removal', () => {
    expect(diffLines('a\nb', '')).toEqual({
      diff: '@@ -1,2 +0,0 @@\n-a\n-b',
      added: 0,
      removed: 2,
      truncated: false,
    });
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
      truncated: false,
    });
  });
});

describe('the bound is on the response (LAI-555 review)', () => {
  const doc = (prefix: string, n: number): string =>
    Array.from({ length: n }, (_, i) => `${prefix} ${String(i)}`).join('\n');

  it('exactly MAX_EDIT_DISTANCE changed lines is answered in full', () => {
    // 1,000 out and 1,000 in: 2,000 changed lines, the bound itself.
    const { diff, added, removed, truncated } = diffLines(doc('old', 1000), doc('new', 1000));
    expect(MAX_EDIT_DISTANCE).toBe(2000);
    expect(truncated).toBe(false);
    expect([added, removed]).toEqual([1000, 1000]);
    expect(diff.split('\n').filter((l) => /^[-+]/.test(l))).toHaveLength(2000);
  });

  it('one more changed line is truncated: no diff, no counts', () => {
    expect(diffLines(doc('old', 1001), doc('new', 1000))).toEqual({
      diff: '',
      added: null,
      removed: null,
      truncated: true,
    });
  });

  it('the review’s case — two unrelated 1,001-line documents — is truncated, not 2,002 lines', () => {
    expect(diffLines(doc('old', 1001), doc('new', 1001)).truncated).toBe(true);
  });

  it('a large rewrite is truncated quickly', () => {
    const started = Date.now();
    expect(diffLines(doc('old', 30_000), doc('new', 30_000)).truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a small change inside a large document is still answered', () => {
    const before = doc('line', 30_000);
    const after = before.replace(/^line 15000$/m, 'changed');
    expect(diffLines(before, after)).toMatchObject({ added: 1, removed: 1, truncated: false });
  });

  it('just inside the bound, still finds the shortest edit', () => {
    const lines = Array.from({ length: MAX_EDIT_DISTANCE }, (_, i) => `l${String(i)}`);
    const after = lines.map((l, i) => (i % 2 === 0 ? l : `${l}!`)).join('\n');
    const { added, removed, truncated } = diffLines(lines.join('\n'), after);
    expect(truncated).toBe(false);
    expect([added, removed]).toEqual([MAX_EDIT_DISTANCE / 2, MAX_EDIT_DISTANCE / 2]);
  });
});
