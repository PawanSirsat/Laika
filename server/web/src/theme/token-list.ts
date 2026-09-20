/**
 * The token inventory, in one place, so the reference page and the contrast
 * test cannot drift from each other — or from `styles/theme.css`.
 *
 * Rebuilt for LAI-606: the token file moved (`theme/tokens.css` →
 * `styles/theme.css`), dark moved to the bare `:root`, and the names went
 * semantic. `tokens.test.ts` asserts every name here exists in both theme
 * blocks, and that the file declares nothing this list has forgotten — so a
 * token added to one place shows up as a failure in the other.
 */

export interface TokenGroup {
  readonly title: string;
  readonly note: string;
  readonly tokens: readonly string[];
}

export const COLOR_TOKENS: readonly TokenGroup[] = [
  {
    title: 'Surfaces',
    note: 'Canvas → column → card is the separation model; hover and pill sit beside it.',
    tokens: [
      '--bg-canvas',
      '--bg-column',
      '--bg-card',
      '--bg-card-hover',
      '--bg-pill',
      '--bg-input',
      '--sidebar-tint',
    ],
  },
  {
    title: 'Borders',
    note: 'Subtle and default, plus the per-surface pair themes decide (dark draws none).',
    tokens: ['--border-subtle', '--border-default', '--border-card', '--border-column'],
  },
  {
    title: 'Text',
    note: 'Primary, secondary, muted.',
    tokens: ['--text-primary', '--text-secondary', '--text-muted'],
  },
  {
    title: 'Accent — the only "this one" colour',
    note: 'Purple. Base, subtle fill, 60% border, and the text that sits on a solid fill.',
    tokens: ['--accent', '--accent-bg', '--accent-border', '--on-accent'],
  },
  {
    title: 'Overdue / blocked',
    note: 'The one warning family.',
    tokens: ['--overdue', '--overdue-border', '--blocked-bg'],
  },
  {
    title: 'Chip — orange (ui, review, medium priority)',
    note: 'Text, 12% fill, 30% border.',
    tokens: ['--chip-orange', '--chip-orange-bg', '--chip-orange-border'],
  },
  {
    title: 'Chip — green (done, ready, auth)',
    note: 'Text, 12% fill, 30% border.',
    tokens: ['--chip-green', '--chip-green-bg', '--chip-green-border'],
  },
  {
    title: 'Chip — blue (in-progress status, server, presence)',
    note: 'Status blue is never the accent — the accent is purple.',
    tokens: ['--chip-blue', '--chip-blue-bg', '--chip-blue-border'],
  },
  {
    title: 'Chip — pink (bug)',
    note: 'Text, 12% fill, 30% border.',
    tokens: ['--chip-pink', '--chip-pink-bg', '--chip-pink-border'],
  },
  {
    title: 'Chip — purple (agent, ai, to-do status)',
    note: 'Same hue as the accent by design; a separate token so status never rides accent edits.',
    tokens: ['--chip-purple', '--chip-purple-bg', '--chip-purple-border'],
  },
  {
    title: 'Chip — neutral (core, infra, audit, unknown tags)',
    note: 'Grey, with the same tinted anatomy as every other chip.',
    tokens: ['--chip-neutral', '--chip-neutral-bg', '--chip-neutral-border'],
  },
  {
    title: 'Priority',
    note: 'The three dot colours.',
    tokens: ['--priority-high', '--priority-medium', '--priority-low'],
  },
  {
    title: 'Overlays',
    note: 'The modal scrim and its shadow.',
    tokens: ['--scrim', '--shadow-modal'],
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
  '--text-ui',
  '--text-md',
  '--text-lg',
  '--text-xl',
  '--text-mono',
  '--leading-body',
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
  '--radius-xs',
  '--radius-card',
  '--radius-column',
  '--radius-control',
  '--radius-pill',
] as const;

export const FAMILY_TOKENS = ['--font-ui', '--font-mono'] as const;

/**
 * Shared non-scale tokens: the chip framing lever (one place turns chip boxes
 * on and off) and the app-wide transition. Theme-independent by design.
 */
export const SHARED_MISC_TOKENS = [
  '--chip-padding',
  '--chip-border',
  '--chip-bg',
  '--transition',
] as const;

/**
 * Text-on-background pairs that must meet WCAG AA, in both themes.
 *
 * `--text-muted` is deliberately absent: the brief holds it to 3:1 (de-emphasis,
 * not body text), which the AA suite's 4.5:1 would wrongly fail. Recorded rather
 * than silently "fixed" — the brief is the contract.
 */
export const CONTRAST_PAIRS: readonly { readonly text: string; readonly background: string }[] = [
  { text: '--text-primary', background: '--bg-canvas' },
  { text: '--text-primary', background: '--bg-column' },
  { text: '--text-primary', background: '--bg-card' },
  { text: '--text-secondary', background: '--bg-canvas' },
  { text: '--text-secondary', background: '--bg-column' },
  { text: '--text-secondary', background: '--bg-card' },
];
