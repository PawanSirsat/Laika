/**
 * The tab strip's pure rules (LAI-1193): the WAI-ARIA keys, which edge fades,
 * and how far to scroll to reveal a tab. Every strip in the app runs these,
 * so a wrong answer here is wrong on every page at once.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  scrollToReveal,
  stripOverflow,
  tabKeyTarget,
} from '../../../src/components/tabs/tab-keys.ts';

void describe('tabKeyTarget', () => {
  void test('Right moves one tab and wraps from the last to the first', () => {
    assert.equal(tabKeyTarget('ArrowRight', 0, 4), 1);
    assert.equal(tabKeyTarget('ArrowRight', 2, 4), 3);
    assert.equal(tabKeyTarget('ArrowRight', 3, 4), 0);
  });

  void test('Left moves one tab and wraps from the first to the last', () => {
    assert.equal(tabKeyTarget('ArrowLeft', 3, 4), 2);
    assert.equal(tabKeyTarget('ArrowLeft', 1, 4), 0);
    assert.equal(tabKeyTarget('ArrowLeft', 0, 4), 3);
  });

  void test('Home and End jump to the ends from anywhere', () => {
    for (const at of [0, 1, 2, 3]) {
      assert.equal(tabKeyTarget('Home', at, 4), 0);
      assert.equal(tabKeyTarget('End', at, 4), 3);
    }
  });

  void test('any other key is left alone — Tab, Enter, Space, letters, Up and Down', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowUp', 'ArrowDown', 'Escape']) {
      assert.equal(tabKeyTarget(key, 1, 4), undefined, key);
    }
  });

  void test('no tabs, no target; one tab stays on itself', () => {
    assert.equal(tabKeyTarget('ArrowRight', 0, 0), undefined);
    assert.equal(tabKeyTarget('ArrowRight', 0, 1), 0);
    assert.equal(tabKeyTarget('ArrowLeft', 0, 1), 0);
  });

  void test('from outside the tabs, Right enters at the first and Left at the last', () => {
    assert.equal(tabKeyTarget('ArrowRight', -1, 4), 0);
    assert.equal(tabKeyTarget('ArrowLeft', -1, 4), 3);
  });
});

void describe('stripOverflow', () => {
  void test('a strip that fits fades nowhere', () => {
    assert.deepEqual(stripOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }), {
      start: false,
      end: false,
    });
    // Sub-pixel rounding is not overflow.
    assert.deepEqual(stripOverflow({ scrollLeft: 0, scrollWidth: 300.6, clientWidth: 300 }), {
      start: false,
      end: false,
    });
  });

  void test('scrolled home, only the end fades; scrolled to the end, only the start', () => {
    assert.deepEqual(stripOverflow({ scrollLeft: 0, scrollWidth: 600, clientWidth: 390 }), {
      start: false,
      end: true,
    });
    assert.deepEqual(stripOverflow({ scrollLeft: 210, scrollWidth: 600, clientWidth: 390 }), {
      start: true,
      end: false,
    });
  });

  void test('in the middle, both edges fade', () => {
    assert.deepEqual(stripOverflow({ scrollLeft: 100, scrollWidth: 600, clientWidth: 390 }), {
      start: true,
      end: true,
    });
  });
});

void describe('scrollToReveal', () => {
  const strip = { scrollLeft: 0, scrollWidth: 800, clientWidth: 390 };

  void test('a tab already in view needs no scroll', () => {
    assert.equal(scrollToReveal({ left: 100, width: 80 }, strip, 24), undefined);
  });

  void test('a tab past the right edge scrolls just far enough, plus the fade inset', () => {
    // Tab ends at 520; the window must end at 544 → scrollLeft 154.
    assert.equal(scrollToReveal({ left: 440, width: 80 }, strip, 24), 154);
  });

  void test('a tab past the left edge scrolls back to it, minus the inset, never below 0', () => {
    const scrolled = { ...strip, scrollLeft: 300 };
    assert.equal(scrollToReveal({ left: 200, width: 80 }, scrolled, 24), 176);
    assert.equal(scrollToReveal({ left: 10, width: 80 }, scrolled, 24), 0);
  });

  void test('never past the strip’s end', () => {
    assert.equal(scrollToReveal({ left: 740, width: 60 }, strip, 24), 410);
  });
});
