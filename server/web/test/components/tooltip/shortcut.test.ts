/**
 * A shortcut written once and shown the reader's way (LAI-1209): glyphs run
 * together on a Mac, words joined by `+` elsewhere, and the DOM's key names
 * for `aria-keyshortcuts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ariaShortcut, formatShortcut } from '../../../src/components/tooltip/shortcut.ts';

void describe('formatShortcut', () => {
  void test('a Mac reads glyphs, run together', () => {
    assert.equal(formatShortcut('Mod+B', true), '⌘B');
    assert.equal(formatShortcut('Mod+Shift+Z', true), '⌘⇧Z');
    assert.equal(formatShortcut('Mod+Alt+C', true), '⌘⌥C');
  });

  void test('everywhere else reads words joined by +', () => {
    assert.equal(formatShortcut('Mod+B', false), 'Ctrl+B');
    assert.equal(formatShortcut('Mod+Shift+8', false), 'Ctrl+Shift+8');
  });

  void test('a bare key is its keycap: Escape is Esc, Enter is ↵, a letter is upper case', () => {
    assert.equal(formatShortcut('Escape', true), 'Esc');
    assert.equal(formatShortcut('Escape', false), 'Esc');
    assert.equal(formatShortcut('Mod+Enter', true), '⌘↵');
    assert.equal(formatShortcut('j', false), 'J');
  });

  void test('an arrow is its arrow, and a symbol is itself (LAI-1213)', () => {
    assert.equal(formatShortcut('ArrowLeft', true), '←');
    assert.equal(formatShortcut('ArrowRight', false), '→');
    assert.equal(formatShortcut('/', false), '/');
    assert.equal(formatShortcut('.', true), '.');
    assert.equal(ariaShortcut('ArrowLeft', true), 'ArrowLeft');
  });
});

void describe('ariaShortcut', () => {
  void test('Mod is Meta on a Mac and Control elsewhere; letters upper case', () => {
    assert.equal(ariaShortcut('Mod+b', true), 'Meta+B');
    assert.equal(ariaShortcut('Mod+Shift+Z', false), 'Control+Shift+Z');
    assert.equal(ariaShortcut('Escape', false), 'Escape');
  });
});
