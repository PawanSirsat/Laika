/**
 * `use-delayed.ts` — when a loading indicator is allowed on screen (LAI-293).
 *
 * **A skeleton that appears for 80ms and vanishes is worse than no skeleton.**
 * It reads as a flicker, and the screen looks broken rather than fast. Against
 * a local instance most calls return under 50ms, so without this every
 * navigation blinked.
 *
 * Two rules, and a test for each, because **a delay alone is only half of it**:
 * work finishing at `delay + 10ms` still flashes the skeleton for ten
 * milliseconds — the same defect, moved later.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';
import { HOLD_FOR_MS, SHOW_AFTER_MS } from '../../src/components/use-delayed.ts';

const source = code(
  readFileSync(
    fileURLToPath(new URL('../../src/components/use-delayed.ts', import.meta.url)),
    'utf8',
  ),
);

void describe('the two rules are both real', () => {
  void test('the delay is long enough to swallow a fast response', () => {
    // Local calls land in 30–50ms. A delay under 100ms would still show them.
    assert.ok(SHOW_AFTER_MS >= 100, `a ${String(SHOW_AFTER_MS)}ms delay is not a delay`);
  });

  void test('the hold is at least the delay, or the flash just moves later', () => {
    assert.ok(
      HOLD_FOR_MS >= SHOW_AFTER_MS,
      `hold ${String(HOLD_FOR_MS)}ms < delay ${String(SHOW_AFTER_MS)}ms — a response ` +
        'arriving just after the delay still flashes',
    );
  });

  void test('nothing is shown before the delay elapses', () => {
    // The timer sets it; there is no path that shows it synchronously.
    assert.match(
      source,
      /setTimeout\(\(\) => \{[\s\S]{0,120}setShown\(true\);[\s\S]{0,40}\}, delay\)/,
    );
    assert.match(source, /const \[shown, setShown\] = useState\(false\)/);
  });

  /**
   * The hold is measured **from when it appeared**, not from when the work
   * stopped. A fixed timeout on the way out keeps a skeleton that has already
   * been up for a second on screen for another 300ms, delaying the content for
   * no reason at all.
   */
  void test('the hold counts from when it appeared', () => {
    assert.match(source, /Date\.now\(\) - shownAt\.current/);
    assert.match(source, /Math\.max\(0, hold - elapsed\)/);
    // Already past the hold: down it goes, with no further timer.
    assert.match(source, /if \(remaining === 0\)/);
  });

  void test('every timer is cleared, so an unmount cannot set state later', () => {
    const clears = source.match(/clearTimeout\(timer\)/g) ?? [];
    assert.ok(clears.length >= 2, `only ${String(clears.length)} cleanup path(s)`);
  });
});
