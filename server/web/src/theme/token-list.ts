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
    tokens: ['--page', '--tub', '--card'],
  },
  {
    title: 'Borders',
    note: 'Default and strong.',
    tokens: ['--bd', '--bd2'],
  },
  {
    title: 'Text',
    note: 'Primary, secondary, tertiary.',
    tokens: ['--tx', '--tx2', '--tx3'],
  },
  {
    title: 'Accent — in progress, primary action',
    note: 'Base, subtle fill, border.',
    tokens: ['--acc', '--accs', '--accb'],
  },
  {
    title: 'Purple — agent, to-do',
    note: 'Base, subtle fill, border.',
    tokens: ['--pur', '--purs', '--purb'],
  },
  {
    title: 'Green — done, public, success',
    note: 'Base, subtle fill, border.',
    tokens: ['--grn', '--grns', '--grnb'],
  },
  {
    title: 'Amber — review, warning, stale',
    note: 'Base, subtle fill, border.',
    tokens: ['--amb', '--ambs', '--ambb'],
  },
  {
    title: 'Red — blocked, error, danger',
    note: 'Base, subtle fill, border.',
    tokens: ['--red', '--reds', '--redb'],
  },
];

/** Flat list of every themed colour token. */
export const ALL_COLOR_TOKENS: readonly string[] = COLOR_TOKENS.flatMap((g) => g.tokens);

/** Themed but not a colour, so it is listed separately. */
export const ELEVATION_TOKENS = ['--shadow'] as const;

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
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-pill',
] as const;

export const FAMILY_TOKENS = ['--font-ui', '--font-mono'] as const;

/**
 * Text-on-background pairs that must meet WCAG AA, checked in both themes by
 * `contrast.test.ts`.
 *
 * `--tx3` is deliberately absent: it is the design's tertiary tone, used for
 * de-emphasised metadata, and it does not reach AA for body text on any of our
 * surfaces. That is recorded as a finding for PM in LAI-018, not silently
 * "fixed" here — the design is the contract.
 */
export const CONTRAST_PAIRS: readonly { readonly text: string; readonly background: string }[] = [
  { text: '--tx', background: '--page' },
  { text: '--tx', background: '--tub' },
  { text: '--tx', background: '--card' },
  { text: '--tx2', background: '--page' },
  { text: '--tx2', background: '--tub' },
  { text: '--tx2', background: '--card' },
];
