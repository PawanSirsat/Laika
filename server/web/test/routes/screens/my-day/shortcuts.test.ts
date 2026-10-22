import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SHORTCUT_SHEET,
  shortcutFor,
  typingIn,
  type KeyLike,
} from '../../../../src/routes/screens/my-day/shortcuts.ts';

/**
 * My day's keys (LAI-831, CHIEF's addition H): ↵ G X T J K on the selected
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

  void test('T goes to the selected draft’s title (LAI-865), in either case', () => {
    assert.equal(shortcutFor(key('t')), 'title');
    assert.equal(shortcutFor(key('T')), 'title');
    // From a button too, as every letter: it has no use for one.
    assert.equal(shortcutFor(key('t', { tagName: 'BUTTON' })), 'title');
    assert.equal(shortcutFor(key('t', { tagName: 'BODY' }, { metaKey: true })), undefined);
  });

  void test('T typed in a field is a letter, the title field’s own included (LAI-865)', () => {
    for (const k of ['t', 'T']) {
      assert.equal(shortcutFor(key(k, { tagName: 'INPUT', type: 'text' })), undefined, k);
      assert.equal(shortcutFor(key(k, { tagName: 'INPUT' })), undefined, k);
      assert.equal(shortcutFor(key(k, { tagName: 'TEXTAREA' })), undefined, k);
    }
  });

  void test('none fires while typing', () => {
    for (const k of ['Enter', 'g', 'x', 't', 'j', 'k', '?']) {
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

  void test('the sheet lists T beside the others (LAI-865)', () => {
    assert.deepEqual(
      SHORTCUT_SHEET.find(([k]) => k === 'T'),
      ['T', 'Type a title for the selected draft'],
    );
    assert.deepEqual(
      SHORTCUT_SHEET.map(([k]) => k),
      ['↵', 'G', 'X', 'T', 'J', 'K', '?', 'Esc'],
    );
  });

  void test('anything else is not a shortcut', () => {
    assert.equal(shortcutFor(key('a')), undefined);
    assert.equal(shortcutFor(key('ArrowDown')), undefined);
  });
});
