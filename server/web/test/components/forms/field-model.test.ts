/**
 * `Field`'s count, its described-by order, and focus-the-first-error
 * (LAI-1204). The worst-case strings are the break-ui pass: a family emoji, a
 * flag, combining marks, a CJK sentence and a count in the thousands.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  charCount,
  describedByIds,
  focusFirstInvalid,
  graphemes,
  type Focusable,
  type InvalidQuery,
} from '../../../src/components/forms/field-model.ts';

void describe('the character count', () => {
  void test('counts what a person typed, not UTF-16 code units', () => {
    assert.equal(graphemes(''), 0);
    assert.equal(graphemes('Laika'), 5);
    // One keystroke each, five or more code units each.
    assert.equal('👩‍💻'.length, 5);
    assert.equal(graphemes('👩‍💻'), 1);
    assert.equal(graphemes('🇿🇦'), 1);
    // "é" as e + combining acute: two code units, one letter.
    assert.equal(graphemes('é'), 1);
    assert.equal(graphemes('タスクを移動'), 6);
  });

  void test('draws used / max and says it in words', () => {
    const c = charCount('Ship it', 120, 'en');
    assert.equal(c.text, '7 / 120');
    assert.equal(c.spoken, '7 of 120 characters');
    assert.equal(c.over, false);
  });

  void test('is over only past the limit, not at it', () => {
    assert.equal(charCount('a'.repeat(10), 10).over, false);
    assert.equal(charCount('a'.repeat(11), 10).over, true);
  });

  void test('groups big numbers for the reader', () => {
    assert.equal(charCount('', 10000, 'en').text, '0 / 10,000');
    assert.equal(charCount('', 10000, 'de').text, '0 / 10.000');
  });
});

void describe('aria-describedby order', () => {
  void test('help, then count, then error — the order they are read in', () => {
    assert.equal(describedByIds({ helpId: 'h', countId: 'c', errorId: 'e' }), 'h c e');
    assert.equal(describedByIds({ errorId: 'e', helpId: 'h' }), 'h e');
    assert.equal(describedByIds({}), undefined);
    assert.equal(describedByIds({ helpId: '' }), undefined);
  });
});

void describe('focusing the first invalid field', () => {
  const field = (log: string[], name: string): Focusable => ({
    focus: (options) => {
      log.push(`focus ${name} preventScroll=${String(options?.preventScroll)}`);
    },
    scrollIntoView: () => {
      log.push(`scroll ${name}`);
    },
  });

  void test('asks for the first aria-invalid control and focuses it', () => {
    const log: string[] = [];
    const asked: string[] = [];
    const root: InvalidQuery = {
      querySelector: (selector) => {
        asked.push(selector);
        return field(log, 'prefix');
      },
    };
    assert.equal(focusFirstInvalid(root), true);
    assert.deepEqual(asked, ['[aria-invalid="true"]']);
    // Focus without the browser's jump, then a centred scroll: the field lands
    // mid-screen with its label visible, not glued to the top edge.
    assert.deepEqual(log, ['focus prefix preventScroll=true', 'scroll prefix']);
  });

  void test('reports nothing found, so the caller can focus a form message instead', () => {
    assert.equal(focusFirstInvalid({ querySelector: () => null }), false);
    assert.equal(focusFirstInvalid(null), false);
  });
});
