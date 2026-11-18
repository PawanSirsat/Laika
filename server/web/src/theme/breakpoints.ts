/**
 * Every viewport width the UI changes layout at (LAI-1220). The single source:
 * `styles/breakpoints.css` repeats these as `--bp-*` custom properties, and
 * `test/breakpoint-tokens.test.ts` keeps the two in step by name, both ways.
 *
 * ## The CSS scheme
 *
 * A custom property cannot be read inside `@media`, and custom media needs a
 * PostCSS or lightningcss step this repo does not have. So a CSS media query
 * writes the width **literally**, and the guard checks that the literal is
 * one of these values in one of four forms:
 *
 * | form | meaning |
 * | --- | --- |
 * | `(max-width: Npx)` | at or below N — the usual form |
 * | `(max-width: N-1px)` | below N, the exact complement of `min-width: N` |
 * | `(min-width: Npx)` | at or above N |
 * | `(min-width: N+1px)` | above N, the exact complement of `max-width: N` |
 *
 * Range syntax says the same with the width named once: `(width <= Npx)`
 * is the first form, `(width < Npx)` the second, `(width >= Npx)` the
 * third and `(width > Npx)` the fourth, and the guard reads it as those.
 * `(width <= Npx)` with `(width > Npx)` is the pair that leaves no gap at a
 * fractional width (LAI-1345: 900.5px under zoom matched neither of
 * `max-width: 900px` and `min-width: 901px`).
 *
 * Widths are written in `px`. A `rem` inside `@media` is relative to the
 * browser's default font size, not the root's, so `40rem` and `640px` agree
 * only at the default; LAI-1220 moved every `rem` query onto `px`.
 *
 * Widths that genuinely differ from every value here are named, with a
 * reason, in the guard's exemption list rather than added as tokens.
 *
 * ## The names
 *
 * `phone`, `tablet`, `laptop`, `desktop`, `wide` and `ultra` are
 * `docs/ux/design-system/visual-language.md` §4.3's. The rest are the
 * validation widths of `responsive-accessibility.md` §1 (390, 768, 1024) and
 * the two phone widths the screens already used (480, 640).
 */
export const BREAKPOINTS = {
  /** The smallest phone the UI is checked at. */
  phoneSm: 390,
  /** A small phone in portrait: single-column forms, stacked rows. */
  phoneMd: 480,
  /** Phone: the bottom of most two-column layouts. */
  phone: 600,
  /** A large phone or a narrow window: profile and token screens fold here. */
  phablet: 640,
  /** Tablet portrait. */
  tabletSm: 768,
  /** Tablet: the sidebar goes off-canvas and drawers become sheets. */
  tablet: 900,
  /** Tablet landscape or a small laptop: Workroom's two-panel layout. */
  tabletLg: 1024,
  /** Laptop: below this the sidebar folds to its rail. */
  laptop: 1180,
  /** Desktop: Workroom's three panels; below it the task drawer overlays. */
  desktop: 1280,
  /** Wide desktop. */
  wide: 1440,
  /** Ultra-wide. */
  ultra: 1600,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** `(max-width: Npx)` — at or below the breakpoint. */
export const atOrBelow = (name: Breakpoint): string => `(max-width: ${BREAKPOINTS[name]}px)`;

/** `(max-width: N-1px)` — strictly below; the complement of {@link atOrAbove}. */
export const below = (name: Breakpoint): string => `(max-width: ${BREAKPOINTS[name] - 1}px)`;

/** `(min-width: Npx)` — at or above the breakpoint. */
export const atOrAbove = (name: Breakpoint): string => `(min-width: ${BREAKPOINTS[name]}px)`;
