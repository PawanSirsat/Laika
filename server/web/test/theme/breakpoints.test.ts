/**
 * `theme/breakpoints.ts` (LAI-1220): the scale and the query builders. That
 * stylesheets keep to it is `breakpoint-tokens.test.ts`'s job; this is about
 * the module itself.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BREAKPOINTS,
  atOrAbove,
  atOrBelow,
  below,
  type Breakpoint,
} from '../../src/theme/breakpoints.ts';

const NAMES = Object.keys(BREAKPOINTS) as Breakpoint[];

void describe('the breakpoint scale', () => {
  void test('is written smallest first, with no two names on one width', () => {
    const widths = NAMES.map((n) => BREAKPOINTS[n]);
    assert.deepEqual(
      widths,
      [...widths].sort((a, b) => a - b),
      'out of order',
    );
    assert.equal(new Set(widths).size, widths.length, 'two names share a width');
  });

  void test('every width is a whole number of px', () => {
    for (const n of NAMES) assert.ok(Number.isInteger(BREAKPOINTS[n]), n);
  });
});

void describe('the query builders', () => {
  void test('write each name in its documented form', () => {
    for (const n of NAMES) {
      const w = BREAKPOINTS[n];
      assert.equal(atOrBelow(n), `(max-width: ${String(w)}px)`);
      assert.equal(below(n), `(max-width: ${String(w - 1)}px)`);
      assert.equal(atOrAbove(n), `(min-width: ${String(w)}px)`);
    }
  });

  void test('below and atOrAbove leave no width unanswered and none answered twice', () => {
    // Integer widths only: a viewport is a whole number of CSS px here.
    for (const n of NAMES) {
      const w = BREAKPOINTS[n];
      const max = Number(/(\d+)px/.exec(below(n))?.[1]);
      const min = Number(/(\d+)px/.exec(atOrAbove(n))?.[1]);
      for (const x of [w - 2, w - 1, w, w + 1]) {
        assert.equal(Number(x <= max) + Number(x >= min), 1, `${n} at ${String(x)}px`);
      }
    }
  });
});
