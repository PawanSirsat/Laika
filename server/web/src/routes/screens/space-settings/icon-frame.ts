/**
 * The geometry of the icon frame editor (LAI-1321): where a picked image sits
 * in its square frame, how far it may move and zoom, and what the cropped
 * square it becomes is. Pure, so every rule is unit-tested; the editor only
 * draws what this says.
 *
 * The frame is `frame` CSS pixels square. Zoom `1` is **the whole image
 * fitted** inside it (its longer side meets the frame), up to `MAX_ZOOM`.
 * `x` and `y` are where the image's centre sits, in frame pixels from the
 * frame's centre — so zooming about the centre is scaling them, and Reset is
 * all three back to `1, 0, 0`.
 */

/** The editor's frame, CSS pixels: big enough to place a logo by eye, small enough for a phone. */
export const FRAME_PX = 240;

/** The most an image may be zoomed past fitting whole. */
export const MAX_ZOOM = 4;

/** The cropped icon's largest side, pixels — a mark is drawn at most 4rem across. */
export const OUTPUT_MAX_PX = 512;

/** The smallest cropped icon: below this a mark is drawn blurred on a high-density screen. */
export const OUTPUT_MIN_PX = 64;

/** Arrow keys move this many frame pixels, or `KEY_STEP_BIG_PX` with Shift. */
export const KEY_STEP_PX = 4;
export const KEY_STEP_BIG_PX = 16;

/** `+` and `-` change the zoom by this much. */
export const ZOOM_STEP = 0.1;

/** The largest icon the server takes (D-152). */
export const ICON_LIMIT_BYTES = 1024 * 1024;

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

/** What fills the frame where the image does not. */
export type FrameBackground = 'transparent' | 'white' | 'black' | 'space';

export const FRAME_BACKGROUNDS: readonly FrameBackground[] = [
  'transparent',
  'white',
  'black',
  'space',
];

export function backgroundLabel(background: FrameBackground): string {
  switch (background) {
    case 'transparent':
      return 'Transparent';
    case 'white':
      return 'White';
    case 'black':
      return 'Black';
    case 'space':
      return 'Space colour';
  }
}

/** The whole image, centred: where the editor starts, and what Reset returns to. */
export const START: Placement = { zoom: 1, x: 0, y: 0 };

/** The scale that fits the whole image inside the frame. */
export function fitScale(image: ImageSize, frame: number = FRAME_PX): number {
  return Math.min(frame / image.width, frame / image.height);
}

/** The image's drawn size in the frame at `zoom`. */
export function drawnSize(image: ImageSize, zoom: number, frame: number = FRAME_PX): ImageSize {
  const scale = fitScale(image, frame) * zoom;
  return { width: image.width * scale, height: image.height * scale };
}

function clampTo(lo: number, hi: number, value: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * A placement the editor allows: zoom within `1 … MAX_ZOOM`, and the image's
 * centre no further from the frame's than half the image — any part of it
 * may be brought to the middle, and it can never be dragged out of sight.
 */
export function clampPlacement(
  placement: Placement,
  image: ImageSize,
  frame: number = FRAME_PX,
): Placement {
  const zoom = clampTo(1, MAX_ZOOM, placement.zoom);
  const drawn = drawnSize(image, zoom, frame);
  return {
    zoom,
    x: clampTo(-drawn.width / 2, drawn.width / 2, placement.x),
    y: clampTo(-drawn.height / 2, drawn.height / 2, placement.y),
  };
}

/** Moved by `dx`, `dy` frame pixels — a drag, or an arrow key. */
export function moveBy(
  placement: Placement,
  dx: number,
  dy: number,
  image: ImageSize,
  frame: number = FRAME_PX,
): Placement {
  return clampPlacement(
    { zoom: placement.zoom, x: placement.x + dx, y: placement.y + dy },
    image,
    frame,
  );
}

/**
 * Zoomed to `zoom` about the frame's centre: the point of the image under the
 * centre stays under it, so the offset scales with the zoom.
 */
export function zoomTo(
  placement: Placement,
  zoom: number,
  image: ImageSize,
  frame: number = FRAME_PX,
): Placement {
  const next = clampTo(1, MAX_ZOOM, zoom);
  const ratio = next / placement.zoom;
  return clampPlacement(
    { zoom: next, x: placement.x * ratio, y: placement.y * ratio },
    image,
    frame,
  );
}

/**
 * What a key does in the frame, or `null` for a key it leaves alone:
 * arrows move (`Shift` for a bigger step), `+`/`=` and `-`/`_` zoom, `0`
 * resets.
 */
export function keyPlacement(
  placement: Placement,
  key: string,
  shift: boolean,
  image: ImageSize,
  frame: number = FRAME_PX,
): Placement | null {
  const step = shift ? KEY_STEP_BIG_PX : KEY_STEP_PX;
  switch (key) {
    case 'ArrowLeft':
      return moveBy(placement, -step, 0, image, frame);
    case 'ArrowRight':
      return moveBy(placement, step, 0, image, frame);
    case 'ArrowUp':
      return moveBy(placement, 0, -step, image, frame);
    case 'ArrowDown':
      return moveBy(placement, 0, step, image, frame);
    case '+':
    case '=':
      return zoomTo(placement, placement.zoom + ZOOM_STEP, image, frame);
    case '-':
    case '_':
      return zoomTo(placement, placement.zoom - ZOOM_STEP, image, frame);
    case '0':
      return START;
    default:
      return null;
  }
}

/**
 * The cropped icon's side, pixels: as many as the image has across the frame
 * at this zoom — so a small logo is not blown up, nor a photo kept at full
 * size — within `OUTPUT_MIN_PX … OUTPUT_MAX_PX`.
 */
export function outputSize(image: ImageSize, zoom: number, frame: number = FRAME_PX): number {
  const sourceAcross = frame / (fitScale(image, frame) * zoom);
  return Math.round(clampTo(OUTPUT_MIN_PX, OUTPUT_MAX_PX, sourceAcross));
}

/** Where to draw the image on a square canvas `size` pixels across, to match the frame. */
export function drawRect(
  placement: Placement,
  image: ImageSize,
  size: number,
  frame: number = FRAME_PX,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const k = size / frame;
  const drawn = drawnSize(image, placement.zoom, frame);
  return {
    x: (frame / 2 + placement.x - drawn.width / 2) * k,
    y: (frame / 2 + placement.y - drawn.height / 2) * k,
    width: drawn.width * k,
    height: drawn.height * k,
  };
}

/** One way to encode the cropped square: its side, its type, and a WebP's quality. */
export interface ExportStep {
  readonly size: number;
  readonly type: 'image/png' | 'image/webp';
  readonly quality: number;
}

/** WebP qualities tried, best first, before a smaller square is. */
export const WEBP_QUALITIES: readonly number[] = [0.92, 0.8, 0.6];

/**
 * The encodings *Use this* tries, as tiers in order (LAI-1321 review: a board
 * whose attachment limit is under a megabyte must still take an icon). The
 * first tier with an encoding at or under the limit wins, and the smallest of
 * that tier is used — so a lower quality or a smaller square is only ever
 * used when the better one cannot fit:
 *
 * - at the cropped size: PNG and WebP at its best quality, then WebP at 0.8,
 *   then at 0.6;
 * - then the same at three-quarters the size, and so on down to
 *   `OUTPUT_MIN_PX`.
 */
export function exportPlan(size: number): readonly (readonly ExportStep[])[] {
  const sizes: number[] = [];
  for (let side = size; ; side = Math.round(side * 0.75)) {
    const clamped = Math.max(OUTPUT_MIN_PX, side);
    if (sizes.at(-1) !== clamped) sizes.push(clamped);
    if (clamped === OUTPUT_MIN_PX) break;
  }
  const [best = 0.92, ...lower] = WEBP_QUALITIES;
  return sizes.flatMap((side) => [
    [
      { size: side, type: 'image/png' as const, quality: 1 },
      { size: side, type: 'image/webp' as const, quality: best },
    ],
    ...lower.map((quality) => [{ size: side, type: 'image/webp' as const, quality }]),
  ]);
}

/** Whether an encoding is worse than the first one tried: smaller, or a lower-quality WebP. */
export function isReduced(step: ExportStep, first: number): boolean {
  return (
    step.size < first || (step.type === 'image/webp' && step.quality < (WEBP_QUALITIES[0] ?? 1))
  );
}

/**
 * The smallest encoding at or under `limit`, or `null` when none is. An
 * encoder that cannot make WebP hands back a PNG in its place, and that
 * still counts by its size.
 */
export function smallestUnder<T extends { readonly size: number }>(
  candidates: readonly T[],
  limit: number,
): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (candidate.size > limit) continue;
    if (best === null || candidate.size < best.size) best = candidate;
  }
  return best;
}

/** The most pixels a picked image may have before it is decoded: a camera photo, not a trap. */
export const MAX_PICK_PIXELS = 40_000_000;

/**
 * A picked image's size, read from its header before anything decodes it —
 * PNG's `IHDR`, a JPEG's first frame header (`SOF0`–`SOF15` but the
 * table and marker codes), WebP's `VP8 `, `VP8L` or `VP8X` — or `null` when
 * the header is not one of those (LAI-1321 review: a 20 000 × 20 000 PNG of
 * a few kilobytes would otherwise be decoded into gigabytes).
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const at = (i: number): number => bytes[i] ?? 0;
  const u16be = (i: number): number => (at(i) << 8) | at(i + 1);
  const u32be = (i: number): number =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  const ascii = (i: number, text: string): boolean =>
    [...text].every((c, k) => at(i + k) === c.charCodeAt(0));

  // PNG: the signature, then IHDR first, width and height big-endian.
  if (at(0) === 0x89 && ascii(1, 'PNG') && ascii(12, 'IHDR')) {
    return { width: u32be(16), height: u32be(20) };
  }

  // WebP: RIFF … WEBP, then one of three first chunks.
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) {
      return {
        width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
        height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
      };
    }
    if (ascii(12, 'VP8L') && at(20) === 0x2f) {
      const bits = (at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24)) >>> 0;
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (ascii(12, 'VP8 ') && at(23) === 0x9d && at(24) === 0x01 && at(25) === 0x2a) {
      return {
        width: (at(26) | (at(27) << 8)) & 0x3fff,
        height: (at(28) | (at(29) << 8)) & 0x3fff,
      };
    }
    return null;
  }

  // JPEG: walk the segments to the first frame header.
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      // Fill bytes, and markers with no length.
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: u16be(i + 7), height: u16be(i + 5) };
      if (marker === 0xd9 || marker === 0xda) return null;
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  return null;
}

/**
 * The frame's position in words, for a screen reader (LAI-1321 review): the
 * zoom, and where the image sits from the centre.
 */
export function describePlacement(placement: Placement): string {
  const across =
    Math.round(placement.x) === 0
      ? 'centred across'
      : `${String(Math.abs(Math.round(placement.x)))} ${placement.x > 0 ? 'right' : 'left'}`;
  const down =
    Math.round(placement.y) === 0
      ? 'centred down'
      : `${String(Math.abs(Math.round(placement.y)))} ${placement.y > 0 ? 'down' : 'up'}`;
  return `Zoom ${placement.zoom.toFixed(1)}×, ${across}, ${down}.`;
}
