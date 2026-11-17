/**
 * The shortcuts sheet's open state (LAI-1221): one store, so the header's ?
 * button, the `?` key and the palette open the one sheet; opening twice is
 * one open, and every change is heard. The sheet itself is browser-tested
 * (`test/browser/header-actions.test.ts`).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  closeShortcuts,
  isShortcutsOpen,
  openShortcuts,
  shortcutsOpener,
} from '../../../src/components/shell/shortcuts-store.ts';

void describe('the shortcuts store', () => {
  void test('opens once, closes once, and keeps no opener it cannot focus', () => {
    assert.equal(isShortcutsOpen(), false);
    openShortcuts(null);
    assert.equal(isShortcutsOpen(), true);
    openShortcuts(null);
    assert.equal(isShortcutsOpen(), true);
    assert.equal(shortcutsOpener(), null, 'nothing to give focus back to outside a page');
    closeShortcuts();
    assert.equal(isShortcutsOpen(), false);
    closeShortcuts();
    assert.equal(isShortcutsOpen(), false);
  });
});
