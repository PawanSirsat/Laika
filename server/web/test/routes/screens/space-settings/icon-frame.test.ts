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
  describePlacement,
  drawRect,
  exportPlan,
  fitScale,
  ICON_LIMIT_BYTES,
  imageSize,
  isReduced,
  KEY_STEP_BIG_PX,
  KEY_STEP_PX,
  keyPlacement,
  MAX_ZOOM,
  moveBy,
  outputSize,
  smallestUnder,
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

void describe('fitting the board’s limit (LAI-1321 review)', () => {
  void test('tiers: the cropped size first — PNG and best WebP, then lower WebP — then smaller', () => {
    const plan = exportPlan(512);
    assert.deepEqual(plan[0], [
      { size: 512, type: 'image/png', quality: 1 },
      { size: 512, type: 'image/webp', quality: 0.92 },
    ]);
    assert.deepEqual(plan[1], [{ size: 512, type: 'image/webp', quality: 0.8 }]);
    assert.deepEqual(plan[2], [{ size: 512, type: 'image/webp', quality: 0.6 }]);
    assert.deepEqual(plan[3]?.[0], { size: 384, type: 'image/png', quality: 1 });
    // Down to the floor, and no further, and no size twice.
    const sizes = [...new Set(plan.flat().map((step) => step.size))];
    assert.deepEqual(sizes, [512, 384, 288, 216, 162, 122, 92, 69, 64]);
  });

  void test('a smaller square or a lower quality is reduced; the first tier is not', () => {
    assert.equal(isReduced({ size: 512, type: 'image/png', quality: 1 }, 512), false);
    assert.equal(isReduced({ size: 512, type: 'image/webp', quality: 0.92 }, 512), false);
    assert.equal(isReduced({ size: 512, type: 'image/webp', quality: 0.8 }, 512), true);
    assert.equal(isReduced({ size: 384, type: 'image/png', quality: 1 }, 512), true);
  });

  void test('the smallest encoding at or under the limit, or none', () => {
    const blob = (size: number) => ({ size });
    assert.deepEqual(smallestUnder([blob(900), blob(300)], 1000), blob(300));
    assert.deepEqual(smallestUnder([blob(900), blob(1200)], 1000), blob(900));
    assert.deepEqual(smallestUnder([blob(1000)], 1000), blob(1000));
    assert.equal(smallestUnder([blob(1001), blob(2000)], 1000), null);
    assert.equal(smallestUnder([], ICON_LIMIT_BYTES), null);
  });
});

void describe('imageSize — read before decoding (LAI-1321 review)', () => {
  const bytes = (...parts: (number | string)[]): Uint8Array =>
    Uint8Array.from(
      parts.flatMap((part) =>
        typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : [part],
      ),
    );
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  void test('PNG: IHDR’s width and height', () => {
    const png = bytes(
      0x89,
      'PNG',
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      'IHDR',
      ...u32(20000),
      ...u32(15000),
    );
    assert.deepEqual(imageSize(png), { width: 20000, height: 15000 });
  });

  void test('JPEG: walks past APP segments to the frame header', () => {
    const jpeg = bytes(
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      6,
      'JFIF',
      0xff,
      0xdb,
      0,
      4,
      0,
      0,
      0xff,
      0xc2,
      0,
      17,
      8,
      0x0f,
      0xa0,
      0x1f,
      0x40,
      3,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    );
    assert.deepEqual(imageSize(jpeg), { width: 8000, height: 4000 });
  });

  void test('WebP: VP8X, VP8L and VP8 headers', () => {
    const riff = (chunk: string, ...data: number[]) =>
      bytes('RIFF', 0, 0, 0, 0, 'WEBP', chunk, 0, 0, 0, 0, ...data);
    // VP8X: 24-bit width-1 and height-1 after four flag bytes.
    assert.deepEqual(imageSize(riff('VP8X', 0, 0, 0, 0, 0x1f, 0x03, 0, 0x0f, 0x02, 0)), {
      width: 800,
      height: 528,
    });
    // VP8L: the 0x2f signature, then 14-bit width-1 and height-1.
    const w = 400 - 1;
    const h = 300 - 1;
    const bits = (w | (h << 14)) >>> 0;
    assert.deepEqual(
      imageSize(
        riff('VP8L', 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, bits >>> 24),
      ),
      { width: 400, height: 300 },
    );
    // VP8: a frame tag, the start code, then 14-bit width and height.
    assert.deepEqual(imageSize(riff('VP8 ', 0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00)), {
      width: 320,
      height: 240,
    });
  });

  void test('anything else has no size', () => {
    assert.equal(imageSize(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(imageSize(bytes('GIF89a', 1, 0, 1, 0)), null);
    assert.equal(imageSize(new Uint8Array()), null);
  });
});

void describe('describePlacement', () => {
  void test('the zoom and where the image sits, in words', () => {
    assert.equal(describePlacement(START), 'Zoom 1.0×, centred across, centred down.');
    assert.equal(describePlacement({ zoom: 1.5, x: 20, y: -30.4 }), 'Zoom 1.5×, 20 right, 30 up.');
    assert.equal(describePlacement({ zoom: 2, x: -4, y: 12 }), 'Zoom 2.0×, 4 left, 12 down.');
  });
});
