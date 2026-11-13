import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EASE,
  ZOOM_MS,
  zoomFrames,
  zoomTransforms,
} from '../../../../src/routes/screens/my-day/span-motion.ts';

/**
 * The View's zoom (LAI-1174): the design's timing kept, its stretch dropped —
 * one scale for both axes, the opened part's centre on the stage's, and zoom
 * out the same keyframes played back. That it runs, and that less motion
 * stops it, is `browser/my-day-span.test.ts`'s.
 */

void describe('the zoom', () => {
  const stage = { left: 0, top: 0, width: 1000, height: 600 };
  const cell = { left: 200, top: 100, width: 100, height: 100 };

  void test('the design’s timing and curve: 520 ms on cubic-bezier(.32,.72,0,1)', () => {
    assert.equal(ZOOM_MS, 520);
    assert.equal(EASE, 'cubic-bezier(.32,.72,0,1)');
  });

  void test('one scale for both axes, so nothing is stretched mid-zoom', () => {
    const { big, small } = zoomTransforms(stage, cell);
    // Covering the stage takes max(1000/100, 600/100) = 10 on both axes.
    assert.match(big, /scale\(10\)$/);
    // Fitting the stage in the cell takes min(100/1000, 100/600) = 0.1.
    assert.match(small, /scale\(0\.1\)$/);
    assert.doesNotMatch(big, /scale\([^)]*,/);
  });

  void test('the cell’s centre lands on the stage’s centre', () => {
    const { big } = zoomTransforms(stage, cell);
    const [, tx, ty] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(big) ?? [];
    // Centre (250, 150) × 10 + translate = (500, 300).
    assert.equal(Number(tx), 500 - 2500);
    assert.equal(Number(ty), 300 - 1500);
  });

  void test('in: the coarse layer is gone by 55 %, the fine one in by 40 %; out is played back', () => {
    const into = zoomFrames(stage, cell, 'in');
    assert.equal(into.leaving[1]?.offset, 0.55);
    assert.equal(into.entering[1]?.offset, 0.4);
    assert.equal(into.leaving.at(-1)?.opacity, 0);
    const out = zoomFrames(stage, cell, 'out');
    assert.equal(out.entering[0]?.transform, into.leaving.at(-1)?.transform);
    assert.equal(out.leaving.at(-1)?.transform, into.entering[0]?.transform);
  });
});
