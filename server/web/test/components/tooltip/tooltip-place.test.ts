/**
 * Where the tooltip goes (LAI-1193): below its control, centred, flipped
 * above only when below does not fit, and never outside the window.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  TIP_GAP,
  TIP_MARGIN,
  placeTooltip,
} from '../../../src/components/tooltip/tooltip-place.ts';

const VIEW = { width: 1440, height: 900 };
const TIP = { width: 120, height: 28 };

void describe('placeTooltip', () => {
  void test('below the control and centred on it', () => {
    const at = placeTooltip({ left: 500, top: 100, width: 32, height: 32 }, TIP, VIEW);
    assert.deepEqual(at, { x: 456, y: 132 + TIP_GAP, side: 'bottom' });
  });

  void test('flips above when there is no room below and room above', () => {
    const at = placeTooltip({ left: 500, top: 860, width: 32, height: 32 }, TIP, VIEW);
    assert.equal(at.side, 'top');
    assert.equal(at.y, 860 - TIP_GAP - TIP.height);
  });

  void test('stays below when neither side fits — it does not jump off the top', () => {
    const at = placeTooltip({ left: 500, top: 10, width: 32, height: 32 }, TIP, {
      width: 1440,
      height: 60,
    });
    assert.equal(at.side, 'bottom');
  });

  void test('prefer top is honoured when it fits, and flipped when it does not', () => {
    const anchor = { left: 500, top: 100, width: 32, height: 32 };
    assert.equal(placeTooltip(anchor, TIP, VIEW, 'top').side, 'top');
    assert.equal(placeTooltip({ ...anchor, top: 10 }, TIP, VIEW, 'top').side, 'bottom');
  });

  void test('the last toolbar icon, against the right edge: slid left inside the margin', () => {
    const at = placeTooltip({ left: 1410, top: 100, width: 28, height: 28 }, TIP, VIEW);
    assert.equal(at.x, VIEW.width - TIP_MARGIN - TIP.width);
  });

  void test('against the left edge: held at the margin', () => {
    const at = placeTooltip({ left: 2, top: 100, width: 28, height: 28 }, TIP, VIEW);
    assert.equal(at.x, TIP_MARGIN);
  });

  void test('a 390px phone keeps a wide tooltip inside the window', () => {
    const at = placeTooltip(
      { left: 350, top: 100, width: 32, height: 32 },
      { width: 280, height: 40 },
      { width: 390, height: 844 },
    );
    assert.ok(at.x >= TIP_MARGIN && at.x + 280 <= 390 - TIP_MARGIN, String(at.x));
  });
});
