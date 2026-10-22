import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  shortcutFor,
  typingIn,
  type KeyLike,
} from '../../../../src/routes/screens/my-day/shortcuts.ts';

/**
 * My day's keys (LAI-831, CHIEF's addition H): ↵ G X J K on the selected
 * draft, ? for the sheet — and **none of them while typing in a field**.
 */

const key = (k: string, target: KeyLike['target'] = { tagName: 'BODY' }, extra = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target,
  ...extra,
});

void describe('typingIn', () => {
  void test('a text field, a text area, a select or editable text is typing', () => {
    assert.equal(typingIn({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(typingIn({ tagName: 'INPUT', type: 'search' }), true);
    assert.equal(typingIn({ tagName: 'TEXTAREA' }), true);
    assert.equal(typingIn({ tagName: 'SELECT' }), true);
    assert.equal(typingIn({ tagName: 'DIV', isContentEditable: true }), true);
  });

  void test('a checkbox, a button or the page is not', () => {
    assert.equal(typingIn({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(typingIn({ tagName: 'BUTTON' }), false);
    assert.equal(typingIn({ tagName: 'BODY' }), false);
    assert.equal(typingIn(null), false);
  });
});

void describe('shortcutFor', () => {
  void test('← and → step along the Timeline (LAI-888), and not while typing', () => {
    assert.equal(shortcutFor(key('ArrowRight')), 'right');
    assert.equal(shortcutFor(key('ArrowLeft')), 'left');
    assert.equal(shortcutFor(key('ArrowRight', { tagName: 'INPUT', type: 'text' })), undefined);
  });

  void test('the six keys, in either case', () => {
    assert.equal(shortcutFor(key('Enter')), 'confirm');
    assert.equal(shortcutFor(key('g')), 'general');
    assert.equal(shortcutFor(key('G')), 'general');
    assert.equal(shortcutFor(key('x')), 'dismiss');
    assert.equal(shortcutFor(key('j')), 'next');
    assert.equal(shortcutFor(key('k')), 'prev');
    assert.equal(shortcutFor(key('?')), 'help');
    assert.equal(shortcutFor(key('Escape')), 'close');
  });

  void test('none fires while typing', () => {
    for (const k of ['Enter', 'g', 'x', 'j', 'k', '?']) {
      assert.equal(shortcutFor(key(k, { tagName: 'INPUT', type: 'text' })), undefined, k);
      assert.equal(shortcutFor(key(k, { tagName: 'TEXTAREA' })), undefined, k);
    }
  });

  void test('a key with Cmd, Ctrl or Alt is the browser’s', () => {
    assert.equal(shortcutFor(key('g', { tagName: 'BODY' }, { metaKey: true })), undefined);
    assert.equal(shortcutFor(key('x', { tagName: 'BODY' }, { ctrlKey: true })), undefined);
    assert.equal(shortcutFor(key('j', { tagName: 'BODY' }, { altKey: true })), undefined);
  });

  void test('Enter on a button or a link presses that, not Confirm', () => {
    assert.equal(shortcutFor(key('Enter', { tagName: 'BUTTON' })), undefined);
    assert.equal(shortcutFor(key('Enter', { tagName: 'A' })), undefined);
    assert.equal(shortcutFor(key('Enter', { tagName: 'INPUT', type: 'checkbox' })), undefined);
    // Letters still work from a button: it has no use for them.
    assert.equal(shortcutFor(key('x', { tagName: 'BUTTON' })), 'dismiss');
  });

  void test('anything else is not a shortcut', () => {
    assert.equal(shortcutFor(key('a')), undefined);
    assert.equal(shortcutFor(key('ArrowDown')), undefined);
  });
});
