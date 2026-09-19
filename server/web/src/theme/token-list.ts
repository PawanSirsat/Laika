/**
 * The token inventory, in one place, so the reference page and the contrast
 * test cannot drift from each other — or from `tokens.css`.
 *
 * `token-list.test.ts` asserts every name here exists in `tokens.css` in both
 * blocks, and that `tokens.css` defines nothing this list has forgotten.
 */

export interface TokenGroup {
  readonly title: string;
  readonly note: string;
  readonly tokens: readonly string[];
}

export const COLOR_TOKENS: readonly TokenGroup[] = [
  {
    title: 'Surfaces',
    note: 'App background, recessed columns, card surface.',
    tokens: ['--bg-canvas', '--bg-column', '--bg-card'],
  },
  {
    title: 'Borders',
    note: 'Default and strong.',
    tokens: ['--border-subtle', '--border-default'],
  },
  {
    title: 'Text',
    note: 'Primary, secondary, tertiary.',
    tokens: ['--text-primary', '--text-secondary', '--text-muted'],
  },
  {
    title: 'Accent — in progress, primary action',
    note: 'Base, subtle fill, border.',
    tokens: ['--accent', '--accent-bg', '--accent-border'],
  },
  {
    title: 'Purple — agent, to-do',
    note: 'Base, subtle fill, border.',
    tokens: ['--chip-pink', '--chip-pink-bg', '--chip-pink-border'],
  },
  {
    title: 'Green — done, public, success',
    note: 'Base, subtle fill, border.',
    tokens: ['--chip-green', '--chip-green-bg', '--chip-green-border'],
  },
  {
    title: 'Amber — review, warning, stale',
    note: 'Base, subtle fill, border.',
    tokens: ['--chip-orange', '--chip-orange-bg', '--chip-orange-border'],
  },
  {
    title: 'Red — blocked, error, danger',
    note: 'Base, subtle fill, border.',
    tokens: ['--overdue', '--blocked-bg', '--overdue-border'],
  },
];

/** Flat list of every themed colour token. */
export const ALL_COLOR_TOKENS: readonly string[] = COLOR_TOKENS.flatMap((g) => g.tokens);

/** Themed but not a colour, so it is listed separately. */
export const ELEVATION_TOKENS = ['--shadow-card'] as const;

/** Theme-independent. */
export const TYPE_TOKENS = [
  '--text-xs',
  '--text-sm',
  '--text-base',
  '--text-md',
  '--text-lg',
  '--text-xl',
] as const;

export const WEIGHT_TOKENS = [
  '--weight-normal',
  '--weight-medium',
  '--weight-semibold',
  '--weight-bold',
  '--weight-heavy',
] as const;

export const SPACE_TOKENS = [
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
] as const;

export const RADIUS_TOKENS = [
  '--radius-chip',
  '--radius-card',
  '--radius-card',
  '--radius-pill',
] as const;

export const FAMILY_TOKENS = ['--font-ui', '--font-mono'] as const;

/**
 * Text-on-background pairs that must meet WCAG AA, checked in both themes by
 * `contrast.test.ts`.
 *
 * `--text-muted` is deliberately absent: it is the design's tertiary tone, used for
 * de-emphasised metadata, and it does not reach AA for body text on any of our
 * surfaces. That is recorded as a finding for PM in LAI-018, not silently
 * "fixed" here — the design is the contract.
 */
export const CONTRAST_PAIRS: readonly { readonly text: string; readonly background: string }[] = [
  { text: '--text-primary', background: '--bg-canvas' },
  { text: '--text-primary', background: '--bg-column' },
  { text: '--text-primary', background: '--bg-card' },
  { text: '--text-secondary', background: '--bg-canvas' },
  { text: '--text-secondary', background: '--bg-column' },
  { text: '--text-secondary', background: '--bg-card' },
];
