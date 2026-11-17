/**
 * `src/components/mark-plate.ts` (LAI-1321): an image mark that would vanish
 * into a theme gets a ring (an opaque tile) or a plate (a cut-out) in that
 * theme, judged from its pixels — an opaque tile by its edge, a cut-out by
 * what is drawn — and a mid-tone or colourful one gets nothing.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  analyseMark,
  COLOURFUL_FROM,
  coverSquare,
  DARK_BELOW,
  EDGE_BAND,
  forgetPlates,
  LIGHT_ABOVE,
  plateFor,
  plateOf,
  rememberPlate,
  SAMPLE_SIZE,
  subscribePlates,
  TRANSPARENT_SHARE,
  VISIBLE_ALPHA,
} from '../../src/components/mark-plate.ts';

type Rgba = readonly [number, number, number, number];

const N = SAMPLE_SIZE;
const BLACK: Rgba = [0, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** A 32×32 image, each pixel whatever `paint` says for its `x`, `y`. */
function image(paint: (x: number, y: number) => Rgba): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) rgba.set(paint(x, y), (y * N + x) * 4);
  }
  return rgba;
}

/** One colour edge to edge. */
const tile = (pixel: Rgba): Uint8ClampedArray => image(() => pixel);

/** `inside` in the square from `from` to `to` (exclusive), `outside` around it. */
function figure(from: number, to: number, inside: Rgba, outside: Rgba): Uint8ClampedArray {
  return image((x, y) => (x >= from && x < to && y >= from && y < to ? inside : outside));
}

const plateOfPixels = (rgba: Uint8ClampedArray): ReturnType<typeof plateFor> =>
  plateFor(analyseMark(rgba, N, N));

void describe('plateFor(analyseMark(…))', () => {
  void test('a black square with a large white figure is a dark tile: a ring in dark', () => {
    // The owner's logo. Its middle is mostly white, but the page meets its black edge.
    const logo = figure(EDGE_BAND, N - EDGE_BAND, WHITE, BLACK);
    const analysis = analyseMark(logo, N, N);
    assert.equal(analysis.transparent, false);
    assert.equal(analysis.luminance, 0);
    assert.equal(plateFor(analysis), 'ring-in-dark');
  });

  void test('a white-ish opaque tile: a ring in light', () => {
    assert.equal(plateOfPixels(tile([240, 242, 245, 255])), 'ring-in-light');
    // Its edge decides, whatever is drawn inside.
    assert.equal(plateOfPixels(figure(4, 28, BLACK, WHITE)), 'ring-in-light');
  });

  void test('dark drawing on a transparent ground: a plate in dark', () => {
    const cutOut = figure(8, 24, [20, 24, 30, 255], CLEAR);
    const analysis = analyseMark(cutOut, N, N);
    assert.equal(analysis.transparent, true);
    assert.equal(plateFor(analysis), 'plate-in-dark');
  });

  void test('white drawing on a transparent ground: a plate in light', () => {
    // The clear pixels are transparent *black*: counted, they would make it dark.
    assert.equal(plateOfPixels(figure(8, 24, WHITE, CLEAR)), 'plate-in-light');
  });

  void test('a mid-grey tile reads on both themes: nothing', () => {
    assert.equal(plateOfPixels(tile([128, 128, 128, 255])), null);
  });

  void test('a saturated colour reads on both themes, however dark or light: nothing', () => {
    // Pure blue is dark by luminance (0.07) and pure yellow light (0.93), but both are colours.
    assert.equal(plateOfPixels(tile([0, 0, 255, 255])), null);
    assert.equal(plateOfPixels(tile([255, 0, 0, 255])), null);
    assert.equal(plateOfPixels(tile([255, 255, 0, 255])), null);
    assert.equal(plateOfPixels(figure(8, 24, [0, 0, 255, 255], CLEAR)), null);
  });

  void test('an image with nothing visible gets nothing', () => {
    const analysis = analyseMark(tile(CLEAR), N, N);
    assert.equal(analysis.transparent, true);
    assert.ok(Number.isNaN(analysis.luminance));
    assert.equal(plateFor(analysis), null);
  });

  void test('a rounded tile’s clear corners are the page’s, not the logo’s', () => {
    // A white tile with its four 4×4 corners cut out: 64 px, under the share that
    // makes it a cut-out, so it is a tile, and its edge is white where it is drawn.
    const corner = (v: number): boolean => v < 4 || v >= N - 4;
    const rounded = image((x, y) => (corner(x) && corner(y) ? CLEAR : WHITE));
    const analysis = analyseMark(rounded, N, N);
    assert.equal(analysis.transparent, false);
    // White, to the last bit of the weights' floating-point sum: no black corner counted.
    assert.ok(analysis.luminance > 0.999, String(analysis.luminance));
    assert.equal(plateFor(analysis), 'ring-in-light');
  });
});

void describe('the thresholds', () => {
  const opaque = (luminance: number) => ({ transparent: false, luminance, colourful: false });

  void test('dark is under DARK_BELOW, light over LIGHT_ABOVE, and between is nothing', () => {
    assert.equal(plateFor(opaque(DARK_BELOW - 0.001)), 'ring-in-dark');
    assert.equal(plateFor(opaque(DARK_BELOW)), null);
    assert.equal(plateFor(opaque(LIGHT_ABOVE)), null);
    assert.equal(plateFor(opaque(LIGHT_ABOVE + 0.001)), 'ring-in-light');
    assert.equal(plateFor({ ...opaque(0), colourful: true }), null);
  });

  void test('the same lines, reached from pixels: grey 71 is dark, 72 is not; 209 is not light, 210 is', () => {
    // The weights sum to 1, so a grey's luminance is its level over 255.
    const grey = (v: number): Uint8ClampedArray => tile([v, v, v, 255]);
    assert.ok(71 / 255 < DARK_BELOW && 72 / 255 > DARK_BELOW);
    assert.equal(plateOfPixels(grey(71)), 'ring-in-dark');
    assert.equal(plateOfPixels(grey(72)), null);
    assert.ok(209 / 255 < LIGHT_ABOVE && 210 / 255 > LIGHT_ABOVE);
    assert.equal(plateOfPixels(grey(209)), null);
    assert.equal(plateOfPixels(grey(210)), 'ring-in-light');
  });

  void test('colourful from a mean chroma of COLOURFUL_FROM: a dark green either side of it', () => {
    assert.ok(89 / 255 < COLOURFUL_FROM && 90 / 255 >= COLOURFUL_FROM);
    // Both are dark (0.25): only the chroma differs.
    assert.equal(analyseMark(tile([0, 89, 0, 255]), N, N).colourful, false);
    assert.equal(plateOfPixels(tile([0, 89, 0, 255])), 'ring-in-dark');
    assert.equal(analyseMark(tile([0, 90, 0, 255]), N, N).colourful, true);
    assert.equal(plateOfPixels(tile([0, 90, 0, 255])), null);
  });

  void test('a cut-out from TRANSPARENT_SHARE of see-through pixels, see-through under VISIBLE_ALPHA', () => {
    const share = Math.ceil(N * N * TRANSPARENT_SHARE);
    // The first `count` pixels in reading order are see-through at `alpha`.
    const holes = (count: number, alpha: number): Uint8ClampedArray =>
      image((x, y) => (y * N + x < count ? [0, 0, 0, alpha] : WHITE));
    assert.equal(analyseMark(holes(share - 1, 0), N, N).transparent, false);
    assert.equal(analyseMark(holes(share, 0), N, N).transparent, true);
    assert.equal(analyseMark(holes(share, VISIBLE_ALPHA - 1), N, N).transparent, true);
    assert.equal(analyseMark(holes(share, VISIBLE_ALPHA), N, N).transparent, false);
    // *At least* the share: on a 10×10 image the share is a whole number of pixels, and counts.
    const exact = Math.round(100 * TRANSPARENT_SHARE);
    const small = new Uint8ClampedArray(100 * 4).fill(255);
    for (let i = 0; i < exact; i += 1) small[i * 4 + 3] = 0;
    assert.equal(analyseMark(small, 10, 10).transparent, true);
    small[(exact - 1) * 4 + 3] = 255;
    assert.equal(analyseMark(small, 10, 10).transparent, false);
  });

  void test('an opaque tile is judged by its outer EDGE_BAND pixels and no further in', () => {
    // A black band exactly EDGE_BAND wide around white: dark. One pixel narrower: mostly white.
    assert.equal(plateOfPixels(figure(EDGE_BAND, N - EDGE_BAND, WHITE, BLACK)), 'ring-in-dark');
    assert.equal(
      plateOfPixels(figure(EDGE_BAND - 1, N - EDGE_BAND + 1, WHITE, BLACK)),
      null,
      'half the band white is mid-tone',
    );
  });
});

void describe('coverSquare', () => {
  void test('the centred square, as object-fit: cover shows it in a square box', () => {
    assert.deepEqual(coverSquare(200, 100), { x: 50, y: 0, size: 100 });
    assert.deepEqual(coverSquare(100, 300), { x: 0, y: 100, size: 100 });
    assert.deepEqual(coverSquare(64, 64), { x: 0, y: 0, size: 64 });
  });
});

void describe('the plate remembered per image URL', () => {
  afterEach(() => {
    forgetPlates();
  });

  void test('unmeasured is undefined; a measurement — none included — is kept per URL', () => {
    const url = '/api/v1/projects/core/icon?v=3';
    assert.equal(plateOf(url), undefined);
    rememberPlate(url, 'ring-in-dark');
    assert.equal(plateOf(url), 'ring-in-dark');
    // A new upload is a new `?v=`, and is measured afresh.
    assert.equal(plateOf('/api/v1/projects/core/icon?v=4'), undefined);
    rememberPlate('/api/v1/projects/core/icon?v=4', null);
    assert.equal(plateOf('/api/v1/projects/core/icon?v=4'), null);
    forgetPlates();
    assert.equal(plateOf(url), undefined);
  });

  void test('every mark is told of a new measurement, and not of one it already had', () => {
    let told = 0;
    const stop = subscribePlates(() => {
      told += 1;
    });
    rememberPlate('/a', 'plate-in-light');
    assert.equal(told, 1);
    rememberPlate('/a', 'plate-in-light');
    assert.equal(told, 1, 'the same answer again is no change');
    rememberPlate('/b', null);
    assert.equal(told, 2, 'a measured "none" is news to a mark waiting on it');
    stop();
    rememberPlate('/c', 'ring-in-light');
    assert.equal(told, 2);
  });
});
