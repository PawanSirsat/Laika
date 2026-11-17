/**
 * The palette's open state (LAI-1192): open remembers what to give the focus
 * back to, a second open is a no-op, toggle is what a second ⌘K does, and
 * every change is told to subscribers exactly once.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  closePalette,
  isPaletteOpen,
  openPalette,
  paletteOpener,
  subscribePalette,
  togglePalette,
} from '../../../src/components/command/palette-store.ts';

const element = (tagName: string) => ({ tagName, focus: () => undefined }) as unknown as Element;

void afterEach(() => {
  closePalette();
});

void describe('the palette store', () => {
  void test('opens, remembering the opener, and closes', () => {
    const trigger = element('BUTTON');
    openPalette(trigger);
    assert.equal(isPaletteOpen(), true);
    assert.equal(paletteOpener(), trigger);
    closePalette();
    assert.equal(isPaletteOpen(), false);
  });

  void test('a second open keeps the first opener', () => {
    const first = element('BUTTON');
    openPalette(first);
    openPalette(element('INPUT'));
    assert.equal(paletteOpener(), first);
  });

  void test('the page body is not somewhere to return focus to', () => {
    openPalette(element('BODY'));
    assert.equal(paletteOpener(), null);
  });

  void test('toggle opens and closes, and each change is told once', () => {
    let told = 0;
    const stop = subscribePalette(() => {
      told += 1;
    });
    togglePalette(element('BUTTON'));
    assert.equal(isPaletteOpen(), true);
    togglePalette();
    assert.equal(isPaletteOpen(), false);
    closePalette();
    assert.equal(told, 2, 'a close of a closed palette is not news');
    stop();
    togglePalette(element('BUTTON'));
    assert.equal(told, 2, 'an unsubscribed listener is still told');
  });
});
