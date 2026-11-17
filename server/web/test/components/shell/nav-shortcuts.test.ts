/**
 * The sidebar's keys and the app's shortcuts sheet (LAI-1221): Alt + a digit
 * goes to a destination the reader can see and nowhere else, never from a
 * field, never with ⌘, Ctrl or Shift; `?` opens the app's sheet only where no
 * screen claims it (the sheet's own rules are `shortcut-sheet.test.ts`). The
 * browser half is `test/browser/header-actions.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  helpKeyOpensSheet,
  NAV_SHORTCUT_DIGITS,
  navShortcut,
  navShortcutTarget,
  type NavKey,
} from '../../../src/components/shell/nav-shortcuts.ts';
import { navRoutes } from '../../../src/routes/route-table.ts';
import { shortcutFor } from '../../../src/routes/screens/my-day/shortcuts.ts';
import { dialogCommand } from '../../../src/routes/screens/review/review-derive.ts';
import { isPaletteShortcut } from '../../../src/components/command/palette-model.ts';

const ALL = ['/my-day', '/inbox', '/insights', '/organisation', '/developer'];
const key = (over: Partial<NavKey>): NavKey => ({
  code: 'Digit2',
  altKey: true,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  target: { tagName: 'BODY' },
  ...over,
});

void describe('Alt + a digit', () => {
  void test('every sidebar destination has one, each its own digit', () => {
    const everyone = navRoutes(() => true).map((r) => r.path);
    for (const path of everyone) assert.ok(navShortcut(path), `${path} has no key`);
    const digits = Object.values(NAV_SHORTCUT_DIGITS);
    assert.equal(new Set(digits).size, digits.length, 'two destinations share a digit');
  });

  void test('goes to the destination, by code — ⌥2 types ™ on a Mac, the code is still Digit2', () => {
    assert.equal(navShortcutTarget(key({}), ALL), '/inbox');
    assert.equal(navShortcutTarget(key({ code: 'Digit1' }), ALL), '/my-day');
    assert.equal(navShortcutTarget(key({ code: 'Numpad5' }), ALL), '/developer');
  });

  void test('only for a destination the reader can see', () => {
    assert.equal(navShortcutTarget(key({ code: 'Digit3' }), ['/my-day', '/inbox']), undefined);
  });

  void test('never from a field, and never with ⌘, Ctrl or Shift, or without Alt', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      assert.equal(navShortcutTarget(key({ target: { tagName } }), ALL), undefined, tagName);
    }
    assert.equal(navShortcutTarget(key({ target: { isContentEditable: true } }), ALL), undefined);
    assert.equal(navShortcutTarget(key({ metaKey: true }), ALL), undefined);
    assert.equal(navShortcutTarget(key({ ctrlKey: true }), ALL), undefined);
    assert.equal(navShortcutTarget(key({ shiftKey: true }), ALL), undefined);
    assert.equal(navShortcutTarget(key({ altKey: false }), ALL), undefined);
    assert.equal(navShortcutTarget(key({ defaultPrevented: true }), ALL), undefined);
    assert.equal(navShortcutTarget(key({ code: 'KeyI' }), ALL), undefined);
  });

  void test('clashes with no key a screen binds: My day, Review, the palette', () => {
    for (const digit of Object.values(NAV_SHORTCUT_DIGITS)) {
      const event = { key: digit, metaKey: false, ctrlKey: false, altKey: true, target: null };
      assert.equal(shortcutFor(event), undefined, `My day answers Alt+${digit}`);
      assert.equal(dialogCommand(event, false), null, `Review answers Alt+${digit}`);
      assert.equal(isPaletteShortcut(event), false);
    }
  });
});

void describe('the ? key', () => {
  const doc = (hits: Record<string, boolean>) => ({
    querySelector: (selector: string) => (hits[selector] === true ? ({} as Element) : null),
  });
  const press = { key: '?', metaKey: false, ctrlKey: false, altKey: false, target: null };

  void test('opens the app’s sheet where no screen claims ?', () => {
    assert.equal(helpKeyOpensSheet(press, doc({})), true);
  });

  void test('leaves ? to a screen whose own help claims it — My day', () => {
    assert.equal(
      helpKeyOpensSheet(press, doc({ '[aria-keyshortcuts="?"]:not([data-header-help])': true })),
      false,
    );
  });

  void test('never over a modal, never typed, never with a modifier', () => {
    assert.equal(helpKeyOpensSheet(press, doc({ '[aria-modal="true"]': true })), false);
    assert.equal(helpKeyOpensSheet({ ...press, target: { tagName: 'INPUT' } }, doc({})), false);
    assert.equal(helpKeyOpensSheet({ ...press, metaKey: true }, doc({})), false);
  });
});
