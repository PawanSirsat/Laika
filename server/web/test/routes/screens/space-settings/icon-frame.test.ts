/**
 * `icon-frame.ts` (LAI-1321): the frame editor's geometry — fitting, zooming
 * about the centre, keeping the image in sight, the keys, the cropped size and
 * where the image lands on the cropped square, and choosing the export.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clampPlacement,
  drawnSize,
  drawRect,
  fitScale,
  ICON_LIMIT_BYTES,
  KEY_STEP_BIG_PX,
  KEY_STEP_PX,
  keyPlacement,
  MAX_ZOOM,
  moveBy,
  outputSize,
  smallerExport,
  START,
  zoomTo,
} from '../../../../src/routes/screens/space-settings/icon-frame.ts';

const WIDE = { width: 800, height: 400 };
const FRAME = 240;

void describe('fitting and zoom', () => {
  void test('zoom 1 fits the whole image: its longer side meets the frame', () => {
    assert.equal(fitScale(WIDE, FRAME), 0.3);
    assert.deepEqual(drawnSize(WIDE, 1, FRAME), { width: 240, height: 120 });
    assert.deepEqual(drawnSize({ width: 100, height: 300 }, 1, FRAME), { width: 80, height: 240 });
  });

  void test('zoom stays within 1 … 4, about the frame’s centre', () => {
    assert.equal(zoomTo(START, 9, WIDE, FRAME).zoom, MAX_ZOOM);
    assert.equal(zoomTo(START, 0.2, WIDE, FRAME).zoom, 1);
    // The point under the centre stays under it: the offset scales with the zoom.
    const placed = { zoom: 2, x: 30, y: -10 };
    assert.deepEqual(zoomTo(placed, 3, WIDE, FRAME), { zoom: 3, x: 45, y: -15 });
  });
});

void describe('moving', () => {
  void test('the image moves freely, but its centre never leaves half its own size', () => {
    assert.deepEqual(moveBy(START, 20, -10, WIDE, FRAME), { zoom: 1, x: 20, y: -10 });
    // Drawn 240 × 120 at zoom 1: the centre goes at most 120 across and 60 down.
    assert.deepEqual(moveBy(START, 500, 500, WIDE, FRAME), { zoom: 1, x: 120, y: 60 });
    assert.deepEqual(clampPlacement({ zoom: 1, x: -999, y: -999 }, WIDE, FRAME), {
      zoom: 1,
      x: -120,
      y: -60,
    });
  });

  void test('keys: arrows move, Shift moves further, + and - zoom, 0 resets, others pass', () => {
    assert.deepEqual(keyPlacement(START, 'ArrowRight', false, WIDE, FRAME), {
      zoom: 1,
      x: KEY_STEP_PX,
      y: 0,
    });
    assert.deepEqual(keyPlacement(START, 'ArrowUp', true, WIDE, FRAME), {
      zoom: 1,
      x: 0,
      y: -KEY_STEP_BIG_PX,
    });
    assert.equal(keyPlacement(START, '+', false, WIDE, FRAME)?.zoom, 1.1);
    assert.equal(keyPlacement(START, '=', false, WIDE, FRAME)?.zoom, 1.1);
    assert.equal(keyPlacement({ zoom: 2, x: 0, y: 0 }, '-', false, WIDE, FRAME)?.zoom, 1.9);
    assert.deepEqual(keyPlacement({ zoom: 3, x: 9, y: 9 }, '0', false, WIDE, FRAME), START);
    assert.equal(keyPlacement(START, 'Enter', false, WIDE, FRAME), null);
    assert.equal(keyPlacement(START, 'a', false, WIDE, FRAME), null);
  });
});

void describe('the cropped square', () => {
  void test('as many pixels as the image has across the frame, within 64 … 512', () => {
    // 800 wide fitted to 240: 800 source pixels across the frame — capped at 512.
    assert.equal(outputSize(WIDE, 1, FRAME), 512);
    // A 120-pixel logo fitted: 120 across, kept.
    assert.equal(outputSize({ width: 120, height: 120 }, 1, FRAME), 120);
    // Zoomed 4× into the 120-pixel logo: 30 across, lifted to the floor.
    assert.equal(outputSize({ width: 120, height: 120 }, 4, FRAME), 64);
  });

  void test('the image lands where the frame shows it, scaled to the square', () => {
    // Centred at zoom 1 on a 480 square: full width, a band down the middle.
    assert.deepEqual(drawRect(START, WIDE, 480, FRAME), { x: 0, y: 120, width: 480, height: 240 });
    // Moved 30 right and zoomed 2×: 480 × 240 in the frame, offset by 30.
    assert.deepEqual(drawRect({ zoom: 2, x: 30, y: 0 }, WIDE, 240, FRAME), {
      x: -90,
      y: 0,
      width: 480,
      height: 240,
    });
  });
});

void describe('smallerExport', () => {
  const blob = (size: number, type: string) => ({ size, type });

  void test('the smaller of PNG and WebP, under the limit', () => {
    assert.deepEqual(
      smallerExport(blob(900, 'image/png'), blob(300, 'image/webp')),
      blob(300, 'image/webp'),
    );
    assert.deepEqual(
      smallerExport(blob(200, 'image/png'), blob(300, 'image/webp')),
      blob(200, 'image/png'),
    );
    // A browser with no WebP encoder hands back a PNG for it, or nothing.
    assert.deepEqual(
      smallerExport(blob(900, 'image/png'), blob(100, 'image/png')),
      blob(900, 'image/png'),
    );
    assert.deepEqual(smallerExport(blob(900, 'image/png'), null), blob(900, 'image/png'));
  });

  void test('nothing when even the smaller is over the server’s megabyte', () => {
    assert.equal(
      smallerExport(
        blob(ICON_LIMIT_BYTES + 2, 'image/png'),
        blob(ICON_LIMIT_BYTES + 1, 'image/webp'),
      ),
      null,
    );
    assert.deepEqual(
      smallerExport(blob(ICON_LIMIT_BYTES, 'image/png'), null),
      blob(ICON_LIMIT_BYTES, 'image/png'),
    );
  });
});
