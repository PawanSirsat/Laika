import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { typingIn } from '../../src/components/typing-in.ts';

/**
 * The one rule every single-letter shortcut defers to (LAI-831, shared by the
 * Create task dialog's `c` in LAI-1167): a key pressed inside something being
 * typed in is a letter, not a command.
 */
void describe('typingIn', () => {
  void test('a text field, a text area, a select or editable text is typing', () => {
    assert.equal(typingIn({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(typingIn({ tagName: 'INPUT', type: 'search' }), true);
    assert.equal(typingIn({ tagName: 'INPUT' }), true);
    assert.equal(typingIn({ tagName: 'textarea' }), true);
    assert.equal(typingIn({ tagName: 'SELECT' }), true);
    assert.equal(typingIn({ tagName: 'DIV', isContentEditable: true }), true);
  });

  void test('a range input is: its arrows move its own thumb (LAI-891)', () => {
    assert.equal(typingIn({ tagName: 'INPUT', type: 'range' }), true);
  });

  void test('a pressed control, a button or the page is not', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'color']) {
      assert.equal(typingIn({ tagName: 'INPUT', type }), false, type);
    }
    assert.equal(typingIn({ tagName: 'BUTTON' }), false);
    assert.equal(typingIn({ tagName: 'BODY' }), false);
    assert.equal(typingIn(null), false);
  });
});
