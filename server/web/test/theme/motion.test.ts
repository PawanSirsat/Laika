/**
 * `theme/motion.ts` (LAI-1208): the one place script asks the reduced-motion
 * question, and the token inventory the stylesheet guard checks against.
 *
 * Runs without a browser: `window` is stood in for, per test, and removed
 * after, so the answer comes from the stand-in's `matchMedia` and nothing else.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  KEPT_UNDER_REDUCED_MOTION,
  MOTION_TOKENS,
  REDUCED_MOTION_QUERY,
  prefersReducedMotion,
} from '../../src/theme/motion.ts';

const host = globalThis as { window?: unknown };

/** A `window` whose `matchMedia` matches only `reduced` queries, recording what it was asked. */
function standIn(reduced: boolean): string[] {
  const asked: string[] = [];
  host.window = {
    matchMedia: (query: string) => {
      asked.push(query);
      return { matches: reduced && query === REDUCED_MOTION_QUERY };
    },
  };
  return asked;
}

afterEach(() => {
  delete host.window;
});

void describe('prefersReducedMotion', () => {
  void test('true when the reader asked for less motion, asking the one query', () => {
    const asked = standIn(true);
    assert.equal(prefersReducedMotion(), true);
    assert.deepEqual(asked, ['(prefers-reduced-motion: reduce)']);
  });

  void test('false when they did not', () => {
    standIn(false);
    assert.equal(prefersReducedMotion(), false);
  });

  void test('false, not a throw, where there is no matchMedia', () => {
    host.window = {};
    assert.equal(prefersReducedMotion(), false);
  });
});

void describe('the token inventory', () => {
  void test('every name is a duration or an easing custom property, once', () => {
    assert.equal(new Set(MOTION_TOKENS).size, MOTION_TOKENS.length);
    for (const t of MOTION_TOKENS) assert.match(t, /^--(duration|ease)-[a-z]+$/);
  });

  void test('what reduced motion keeps is a subset, and every duration but the glow is zeroed', () => {
    for (const t of KEPT_UNDER_REDUCED_MOTION) {
      assert.ok((MOTION_TOKENS as readonly string[]).includes(t), `${t} is not a motion token`);
    }
    const keptDurations = KEPT_UNDER_REDUCED_MOTION.filter((t) => t.startsWith('--duration-'));
    assert.deepEqual(keptDurations, ['--duration-flash']);
  });
});
