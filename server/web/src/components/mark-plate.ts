/**
 * Whether an image mark needs a ring or a plate to be seen (LAI-1321).
 *
 * A logo that is a white figure on a black square vanishes into the dark
 * theme: its edge is the page's colour. `ProjectMark` draws the loaded image
 * small, hands the pixels here, and puts the answer on the mark as
 * `data-plate`; `project-mark.css` draws it in the one theme that needs it.
 *
 * - **Opaque and dark** — a light ring, in a dark theme.
 * - **Opaque and light** — a dark ring, in the light theme.
 * - **Transparent, dark content** — a light plate behind it, in a dark theme.
 * - **Transparent, light content** — a dark plate behind it, in the light theme.
 * - **Mid-tone or colourful** — nothing: it already stands off both themes.
 *
 * Pure and DOM-free — the canvas read is `ProjectMark`'s — so the decision is
 * tested here on fixed pixels. The answer is remembered per image URL, which
 * carries the icon's `?v=`, so a new upload is measured afresh and a mark
 * that mounts again draws its plate on the first paint, never a flash of none.
 */

/** The side, in pixels, of the square the image is drawn into before it is read. */
export const SAMPLE_SIZE = 32;

/** The outer band, in pixels of the sample, that decides how an opaque tile meets the page. */
export const EDGE_BAND = 2;

/** A pixel at or above this alpha is seen; below it, the page shows through. */
export const VISIBLE_ALPHA = 128;

/** The share of see-through pixels that makes an image a cut-out rather than a tile. */
export const TRANSPARENT_SHARE = 0.1;

/*
 * The thresholds, on the same 0..1 scale as `luminance`. Measured from
 * `styles/theme.css`: the dark themes' surfaces run 0.00 (black's canvas) to
 * 0.16 (dark's hovered card, #222a3b), the light theme's 0.93 (its column) to
 * 1.00 (its card). A tile under DARK_BELOW can sit on a dark surface it barely
 * differs from, and one over LIGHT_ABOVE on a light one, and its edge is lost.
 * Between them a tile is at least 0.12 from every dark surface and 0.11 from
 * every light one.
 */

/** Darker than this, and the mark is lost on a dark theme. */
export const DARK_BELOW = 0.28;

/** Lighter than this, and the mark is lost on the light theme. */
export const LIGHT_ABOVE = 0.82;

/**
 * Mean chroma at or over this is a colour, not a shade of grey. A coloured
 * logo is left alone: its hue already separates it from both themes' near-grey
 * surfaces, and a ring would only frame a logo that was never lost.
 */
export const COLOURFUL_FROM = 0.35;

export interface MarkAnalysis {
  /** At least `TRANSPARENT_SHARE` of the pixels are see-through. */
  readonly transparent: boolean;
  /**
   * The measured pixels' mean `0.2126R + 0.7152G + 0.0722B`, 0..1 — on the
   * sRGB-encoded values, **not linearised**. The encoding is close to how
   * light a colour looks, which is the question; linear luminance would call
   * a mid grey (#808080, 0.22) dark. `NaN` when no pixel is visible, which
   * `plateFor` reads as no plate.
   */
  readonly luminance: number;
  /** The measured pixels' mean chroma — `(max − min) / 255` — is at least `COLOURFUL_FROM`. */
  readonly colourful: boolean;
}

export type Plate = 'ring-in-dark' | 'ring-in-light' | 'plate-in-dark' | 'plate-in-light';

function onEdge(x: number, y: number, width: number, height: number): boolean {
  return x < EDGE_BAND || y < EDGE_BAND || x >= width - EDGE_BAND || y >= height - EDGE_BAND;
}

/**
 * What an image is, from its RGBA pixels (`width × height × 4`, as
 * `getImageData` gives them).
 *
 * **An opaque image is measured at its edge** — the outer `EDGE_BAND` — since
 * the border is what meets the page: a black square with a large white figure
 * is still a black tile where it touches the canvas. **A transparent one is
 * measured over its visible pixels**: it has no tile edge, and the page meets
 * the drawing itself. Either way a see-through pixel is never counted — the
 * clipped corners of a rounded logo are the page's colour, not the logo's.
 */
export function analyseMark(rgba: Uint8ClampedArray, width: number, height: number): MarkAnalysis {
  const pixels = width * height;
  let hidden = 0;
  for (let i = 3; i < pixels * 4; i += 4) {
    if ((rgba[i] ?? 0) < VISIBLE_ALPHA) hidden += 1;
  }
  const transparent = pixels > 0 && hidden >= pixels * TRANSPARENT_SHARE;

  let counted = 0;
  let light = 0;
  let chroma = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!transparent && !onEdge(x, y, width, height)) continue;
      const i = (y * width + x) * 4;
      if ((rgba[i + 3] ?? 0) < VISIBLE_ALPHA) continue;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      light += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
      counted += 1;
    }
  }
  if (counted === 0) return { transparent, luminance: Number.NaN, colourful: false };
  return {
    transparent,
    luminance: light / counted / 255,
    colourful: chroma / counted / 255 >= COLOURFUL_FROM,
  };
}

/** The ring or plate an image needs, or `null` when it reads on both themes as it is. */
export function plateFor(analysis: MarkAnalysis): Plate | null {
  if (analysis.colourful) return null;
  if (analysis.luminance < DARK_BELOW) {
    return analysis.transparent ? 'plate-in-dark' : 'ring-in-dark';
  }
  if (analysis.luminance > LIGHT_ABOVE) {
    return analysis.transparent ? 'plate-in-light' : 'ring-in-light';
  }
  return null;
}

/**
 * The part of an image the mark shows: its centred square, as `object-fit:
 * cover` crops it into the square box. Drawing that, not the whole image
 * squashed, means a wide logo is judged by the edge the page actually meets.
 */
export function coverSquare(
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly size: number } {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

const plates = new Map<string, Plate | null>();
const listeners = new Set<() => void>();

/**
 * The plate measured for an image URL: `null` when it needs none, `undefined`
 * when it has not been measured yet — and the mark draws none until it is.
 */
export function plateOf(url: string): Plate | null | undefined {
  return plates.get(url);
}

/** Remember what an image URL needs, and tell every mark drawing it. */
export function rememberPlate(url: string, plate: Plate | null): void {
  if (plates.has(url) && plates.get(url) === plate) return;
  plates.set(url, plate);
  for (const listener of listeners) listener();
}

/** Be told when a plate is measured; the answer stops telling. */
export function subscribePlates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget every measurement — between tests. */
export function forgetPlates(): void {
  if (plates.size === 0) return;
  plates.clear();
  for (const listener of listeners) listener();
}
