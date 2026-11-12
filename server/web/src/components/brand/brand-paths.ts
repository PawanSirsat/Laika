/**
 * The Laika mark and wordmark as geometry, and nothing else (LAI-1126).
 *
 * Kept out of the components so three copies cannot drift: the React marks
 * read these constants, and `public/favicon.svg` and the pre-JS splash in
 * `index.html` — static files that cannot import anything — are asserted
 * against them by `test/components/brand/brand.test.ts`.
 *
 * No colour here: the components paint with CSS variables from
 * `styles/theme.css`, so a theme decides every hue (LAI-606).
 */

/**
 * The mark's box. Both slabs are drawn as polygons with a fat round-joined
 * stroke in their own fill, which is how the corners get their radius without
 * a hand-tuned arc per corner — `MARK_ROUND` is that stroke.
 */
export const MARK_VIEWBOX = '0 0 64 64';
export const MARK_ROUND = 8;

/** The tall slab, leaning ~15° like an italic stem. */
export const MARK_STEM = 'M25 9H37L27 47H15Z';
/** The base slab the stem folds onto, the same lean. */
export const MARK_BASE = 'M17 44H55L52 53H14Z';
/** The lighter inner edges that make the panels read as glass. */
export const MARK_STEM_EDGE = 'M24.6 12.5L17.4 41';
export const MARK_BASE_EDGE = 'M20 41.6H53';
/**
 * One gradient spans both slabs in user space, top-left ice blue to
 * bottom-right lavender, so the L shades as one piece of glass.
 */
export const MARK_GRADIENT = { x1: 12, y1: 6, x2: 58, y2: 58 } as const;

/** At or below this many pixels the flat mark is drawn: no rim, no glow. */
export const MARK_FLAT_MAX = 24;

/**
 * The wordmark, built rather than set: a geometric bold sans drawn as round-
 * capped strokes, so it needs no font and renders the same everywhere.
 * Baseline 28, x-height 13, cap height 4 in a 32-unit-tall box.
 */
export const WORDMARK_VIEWBOX = '0 0 85 32';
export const WORDMARK_WIDTH = 85;
export const WORDMARK_HEIGHT = 32;
export const WORDMARK_STROKE = 5;
/** Every stroked part, in reading order: L, a, i's stem, k, a. */
export const WORDMARK_STROKES: readonly string[] = [
  'M5 6.5V25.5H15',
  'M32.5 15.5V25.5',
  'M42 15.5V25.5',
  'M51.5 6.5V25.5',
  'M61 15.5L54 21',
  'M56.5 19.5L62 25.5',
  'M80 15.5V25.5',
];
/** The two bowls of the single-storey a. */
export const WORDMARK_BOWLS: readonly { readonly cx: number; readonly cy: number }[] = [
  { cx: 27.5, cy: 20.5 },
  { cx: 75, cy: 20.5 },
];
export const WORDMARK_BOWL_R = 5;
/** The dot of the i, filled in the brand's periwinkle. */
export const WORDMARK_DOT = { cx: 42, cy: 7.5, r: 3.1 } as const;

/** The product's name, the one string every brand surface must carry. */
export const BRAND_NAME = 'Laika';
/** The splash's tagline — the splash only, never the app's chrome. */
export const BRAND_TAGLINE = 'PLAN • COLLABORATE • DELIVER';
