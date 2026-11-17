/**
 * `workroom-layout.ts` — the Workroom's panel maths (LAI-1199): limits, the
 * separator's keys, drag, breakpoints, areas, the focus key, and widths kept
 * in storage that can be garbage or can throw.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_PREFS,
  PANEL_LIMITS,
  PREFS_KEY,
  areaOf,
  clampWidth,
  dragWidth,
  isFocusKey,
  layoutMode,
  parsePrefs,
  readPrefs,
  separatorKey,
  writePrefs,
} from '../../../../src/routes/screens/workroom/workroom-layout.ts';

void describe('limits', () => {
  void test('the spec’s widths: left 200–360 from 248, right 280–440 from 320', () => {
    assert.deepEqual(PANEL_LIMITS.left, { min: 200, max: 360, initial: 248 });
    assert.deepEqual(PANEL_LIMITS.right, { min: 280, max: 440, initial: 320 });
  });

  void test('clampWidth holds a width inside its panel’s limits', () => {
    assert.equal(clampWidth('left', 10), 200);
    assert.equal(clampWidth('left', 9999), 360);
    assert.equal(clampWidth('right', 300.4), 300);
    assert.equal(clampWidth('right', Number.NaN), 320);
  });
});

void describe('separatorKey', () => {
  void test('→ moves the line right: the left panel grows, the right shrinks', () => {
    assert.deepEqual(separatorKey('left', 248, { key: 'ArrowRight' }), {
      kind: 'width',
      width: 264,
    });
    assert.deepEqual(separatorKey('right', 320, { key: 'ArrowRight' }), {
      kind: 'width',
      width: 304,
    });
    assert.deepEqual(separatorKey('left', 248, { key: 'ArrowLeft' }), {
      kind: 'width',
      width: 232,
    });
  });

  void test('Shift takes the bigger step, and still stops at the limit', () => {
    assert.deepEqual(separatorKey('left', 248, { key: 'ArrowRight', shiftKey: true }), {
      kind: 'width',
      width: 312,
    });
    assert.deepEqual(separatorKey('left', 340, { key: 'ArrowRight', shiftKey: true }), {
      kind: 'width',
      width: 360,
    });
  });

  void test('Home and End go to the limits; Enter toggles; other keys are not its', () => {
    assert.deepEqual(separatorKey('right', 320, { key: 'Home' }), { kind: 'width', width: 280 });
    assert.deepEqual(separatorKey('right', 320, { key: 'End' }), { kind: 'width', width: 440 });
    assert.deepEqual(separatorKey('left', 248, { key: 'Enter' }), { kind: 'toggle' });
    assert.equal(separatorKey('left', 248, { key: 'a' }), null);
  });
});

void describe('dragWidth', () => {
  void test('follows the pointer, mirrored for the right panel, clamped', () => {
    assert.equal(dragWidth('left', 248, 40), 288);
    assert.equal(dragWidth('right', 320, 40), 280);
    assert.equal(dragWidth('right', 320, -500), 440);
  });
});

void describe('layoutMode', () => {
  void test('three at ≥1280, two at ≥1024, one below', () => {
    assert.equal(layoutMode({ three: true, two: true }), 'three');
    assert.equal(layoutMode({ three: false, two: true }), 'two');
    assert.equal(layoutMode({ three: false, two: false }), 'one');
  });
});

void describe('preferences', () => {
  void test('a clean round trip through storage', () => {
    const held = new Map<string, string>();
    const store = {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => {
        held.set(k, v);
      },
    };
    const prefs = { left: 300, right: 400, leftCollapsed: true, rightCollapsed: false };
    writePrefs(store, prefs);
    assert.ok(held.has(PREFS_KEY));
    assert.deepEqual(readPrefs(store), prefs);
  });

  void test('garbage, out-of-range values and wrong types fall back or clamp', () => {
    assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('{nope'), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('"x"'), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('{"left":5,"right":"wide","leftCollapsed":"yes"}'), {
      ...DEFAULT_PREFS,
      left: 200,
    });
  });

  void test('storage that throws reads as the defaults and writes nothing, quietly', () => {
    const throwing = {
      getItem: (): string => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    assert.deepEqual(readPrefs(throwing), DEFAULT_PREFS);
    assert.doesNotThrow(() => {
      writePrefs(throwing, DEFAULT_PREFS);
    });
    assert.deepEqual(readPrefs(undefined), DEFAULT_PREFS);
  });
});

void describe('areas and the focus key', () => {
  void test('?area= names an area, or it is Overview', () => {
    assert.equal(areaOf('evidence'), 'evidence');
    assert.equal(areaOf('nonsense'), 'overview');
    assert.equal(areaOf(null), 'overview');
  });

  void test('the focus key is a bare `.`, and clashes with no key the app already binds', () => {
    assert.equal(isFocusKey({ key: '.' }), true);
    assert.equal(isFocusKey({ key: '.', metaKey: true }), false);
    assert.equal(isFocusKey({ key: '.', ctrlKey: true }), false);
    for (const taken of ['/', 'c', 'j', 'k', 'a', 's', 'Escape']) {
      assert.equal(isFocusKey({ key: taken }), false, taken);
    }
  });
});
