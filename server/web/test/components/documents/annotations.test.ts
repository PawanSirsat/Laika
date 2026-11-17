/**
 * Comment anchors (LAI-1131, T8): a quote with context, re-found by words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  anchorFor,
  CONTEXT,
  locate,
  nextAnnotationId,
} from '../../../src/components/documents/annotations.ts';

const TEXT = 'The relay ships rows. The relay stops on a rejected row. The relay backs off.';

void describe('anchorFor', () => {
  void test('keeps the words and up to CONTEXT characters each side', () => {
    const start = TEXT.indexOf('stops');
    const a = anchorFor(TEXT, start, start + 5, 'h-relay');
    assert.equal(a.exact, 'stops');
    assert.equal(a.prefix, TEXT.slice(Math.max(0, start - CONTEXT), start));
    assert.equal(a.suffix, TEXT.slice(start + 5, start + 5 + CONTEXT));
    assert.equal(a.headingId, 'h-relay');
  });
});

void describe('locate', () => {
  void test('finds the occurrence with the same surroundings, not the first', () => {
    const second = TEXT.indexOf('The relay', 5);
    const a = anchorFor(TEXT, second, second + 'The relay'.length, '');
    assert.deepEqual(locate(TEXT, a), { start: second, end: second + 9 });
    const third = TEXT.lastIndexOf('The relay');
    assert.deepEqual(locate(TEXT, anchorFor(TEXT, third, third + 9, '')), {
      start: third,
      end: third + 9,
    });
  });

  void test('re-finds words after the text around them was edited', () => {
    const start = TEXT.indexOf('rejected row');
    const a = anchorFor(TEXT, start, start + 'rejected row'.length, '');
    const edited = `Preface added. ${TEXT.replace('backs off', 'waits')}`;
    const at = locate(edited, a);
    assert.ok(at !== null);
    assert.equal(edited.slice(at.start, at.end), 'rejected row');
  });

  void test('words that are gone are null — outdated, never re-attached elsewhere', () => {
    const start = TEXT.indexOf('rejected');
    const a = anchorFor(TEXT, start, start + 8, '');
    assert.equal(locate(TEXT.replace('rejected', 'refused'), a), null);
  });

  void test('an empty quote locates nothing', () => {
    assert.equal(locate(TEXT, anchorFor(TEXT, 3, 3, '')), null);
  });
});

void describe('nextAnnotationId', () => {
  void test('unique within the tab', () => {
    const ids = Array.from({ length: 5 }, () => nextAnnotationId());
    assert.equal(new Set(ids).size, 5);
  });
});
