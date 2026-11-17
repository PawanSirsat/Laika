/**
 * Motion, from script (LAI-1208).
 *
 * The values live in `styles/motion.css`; this module is the one place script
 * asks the reduced-motion question, so a JS-driven animation (the board's
 * view-transition glide) and the CSS ones answer it the same way.
 * `test/motion-tokens.test.ts` fails if the media query is written anywhere
 * else in `src/`.
 */

/** The media query, spelled once. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the reader has asked for less motion. False where there is no `matchMedia`. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Every motion token `styles/motion.css` declares, in its order. The guard
 * asserts the stylesheet declares exactly these and nothing else, so a token
 * added in one place and forgotten in the other is a failure, not a drift.
 */
export const MOTION_TOKENS = [
  '--duration-instant',
  '--duration-fast',
  '--duration-base',
  '--duration-slow',
  '--duration-glide',
  '--duration-spinner',
  '--duration-blink',
  '--duration-shimmer',
  '--duration-pulse',
  '--duration-flash',
  '--ease-standard',
  '--ease-enter',
  '--ease-exit',
  '--ease-drawer',
  '--ease-emphasised',
] as const;

/**
 * The tokens that keep their value under reduced motion: the arrival glow's
 * 3.6s hold is the information, not travel, and the curves are inert once
 * every duration is zero.
 */
export const KEPT_UNDER_REDUCED_MOTION: readonly string[] = [
  '--duration-flash',
  '--ease-standard',
  '--ease-enter',
  '--ease-exit',
  '--ease-drawer',
  '--ease-emphasised',
];
