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

/**
 * The smaller of the PNG and the WebP — a browser that cannot make WebP gives
 * `null` for it, or a PNG in its place — or `null` when even the smaller is
 * over the server's limit.
 */
export function smallerExport<T extends { readonly size: number; readonly type: string }>(
  png: T,
  webp: T | null,
  limit: number = ICON_LIMIT_BYTES,
): T | null {
  const webpReal = webp !== null && webp.type === 'image/webp' ? webp : null;
  const best = webpReal !== null && webpReal.size < png.size ? webpReal : png;
  return best.size <= limit ? best : null;
}
