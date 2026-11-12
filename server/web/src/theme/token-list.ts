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

import { STEP_NAMES } from './type-roles.ts';

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
    note: 'The brand periwinkle since LAI-1126, picked once by the shared `--accent-source` (an owner decision; one line reverts it to purple). Base, a fill and a line mixed from it, and the text that sits on a solid fill.',
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
    note: 'Status blue is never the accent: sky, so it stays clear of the periwinkle accent (LAI-1126).',
    tokens: ['--chip-blue', '--chip-blue-bg', '--chip-blue-border'],
  },
  {
    title: 'Chip — pink (bug)',
    note: 'Text, 12% fill, 30% border.',
    tokens: ['--chip-pink', '--chip-pink-bg', '--chip-pink-border'],
  },
  {
    title: 'Chip — purple (agent, ai, to-do status)',
    note: 'A separate token so status never rides accent edits — which is why the periwinkle accent left it purple (LAI-1126).',
    tokens: ['--chip-purple', '--chip-purple-bg', '--chip-purple-border'],
  },
  {
    title: 'Chip — neutral (core, infra, audit, unknown tags)',
    note: 'Grey, with the same tinted anatomy as every other chip.',
    tokens: ['--chip-neutral', '--chip-neutral-bg', '--chip-neutral-border'],
  },
  {
    title: 'Brand-mark tile',
    note: 'The light tile an agent’s real logo sits on, in both themes, and the ink for single-colour marks (LAI-740).',
    tokens: ['--logo-tile', '--logo-tile-border', '--logo-ink'],
  },
  {
    title: 'Brand',
    note: 'The owner’s Cool & Non-Vibrant sheet (LAI-1126): the seven primitives the surfaces are mapped from, the two accents on offer, the mark’s glass gradient, rim and glow, the wordmark’s i-dot, the loaders’ track and active step, and the splash ground.',
    tokens: [
      '--brand-ink',
      '--brand-slate',
      '--brand-steel',
      '--brand-mist',
      '--brand-glacier',
      '--brand-fog',
      '--brand-paper',
      '--brand-periwinkle',
      '--brand-legacy-purple',
      '--brand-mark-1',
      '--brand-mark-2',
      '--brand-mark-3',
      '--brand-mark-rim',
      '--brand-glow',
      '--brand-dot',
      '--brand-track',
      '--brand-active',
      '--brand-splash-from',
      '--brand-splash-to',
      '--brand-splash-arc',
      '--brand-panel',
    ],
  },
  {
    title: 'Glass',
    note: 'The frosted surfaces (LAI-1132): three translucent levels — chrome, panels and cards, floating — each with the opaque step it falls back to, the solid surface a glass element inside glass uses, the hover wash, the hairline borders, the blue→lavender sheen and the darker scrim a modal floats over.',
    tokens: [
      '--glass-1',
      '--glass-2',
      '--glass-3',
      '--glass-1-solid',
      '--glass-2-solid',
      '--glass-3-solid',
      '--glass-solid',
      '--glass-hover',
      '--glass-border',
      '--glass-border-strong',
      '--glass-sheen',
      '--glass-scrim',
    ],
  },
  {
    title: 'Ambient',
    note: 'The fixed layer behind the shell (LAI-1132): a near-flat Ink (dark) or Paper (light) ground with one faint tonal lift, and its lightest (dark) or darkest (light) stop — the backdrop the glass AA pairs are measured against.',
    tokens: ['--ambient-base', '--ambient-peak'],
  },
  {
    title: 'Priority',
    note: 'The three dot colours.',
    tokens: ['--priority-high', '--priority-medium', '--priority-low'],
  },
  {
    title: 'Space colours',
    note: 'The eight a space may be painted (D-103), each solid under its white letter in both themes.',
    tokens: [
      '--space-black',
      '--space-violet',
      '--space-teal',
      '--space-blue',
      '--space-amber',
      '--space-magenta',
      '--space-red',
      '--space-green',
      '--on-space',
    ],
  },
  {
    title: 'Overlays',
    note: 'The modal scrim and its shadow.',
    tokens: ['--scrim', '--shadow-modal'],
  },
  {
    title: 'Activity heatmap',
    note: 'The profile’s daily grids (D-079): an empty step, then four of GitHub violet, Local amber and Board slate, lightness-matched so one step reads alike in each colour (LAI-751).',
    tokens: [
      '--heat-empty',
      '--heat-gh-1',
      '--heat-gh-2',
      '--heat-gh-3',
      '--heat-gh-4',
      '--heat-lo-1',
      '--heat-lo-2',
      '--heat-lo-3',
      '--heat-lo-4',
      '--heat-all-1',
      '--heat-all-2',
      '--heat-all-3',
      '--heat-all-4',
    ],
  },
  {
    title: 'Sky',
    note: 'Day and night behind the Timeline’s hours (LAI-895): the strip, the lanes, the sun and the moon.',
    tokens: ['--sky-day', '--sky-night', '--sky-night-body', '--sun', '--moon'],
  },
  {
    title: 'Entry kind',
    note: 'A typed entry’s colour on the Timeline (D-108, the design’s eight since LAI-516): ink, fill and border for work, meeting, thinking, research, pairing, review, support, admin.',
    tokens: [
      '--kind-work',
      '--kind-work-bg',
      '--kind-work-border',
      '--kind-meeting',
      '--kind-meeting-bg',
      '--kind-meeting-border',
      '--kind-thinking',
      '--kind-thinking-bg',
      '--kind-thinking-border',
      '--kind-research',
      '--kind-research-bg',
      '--kind-research-border',
      '--kind-pairing',
      '--kind-pairing-bg',
      '--kind-pairing-border',
      '--kind-review',
      '--kind-review-bg',
      '--kind-review-border',
      '--kind-support',
      '--kind-support-bg',
      '--kind-support-border',
      '--kind-admin',
      '--kind-admin-bg',
      '--kind-admin-border',
    ],
  },
];

/** Flat list of every themed colour token. */
export const ALL_COLOR_TOKENS: readonly string[] = COLOR_TOKENS.flatMap((g) => g.tokens);

/** Themed but not a colour, so it is listed separately. */
export const ELEVATION_TOKENS = [
  '--shadow-card',
  // LAI-1132: one shadow per elevation, the glass edge light and glow, and
  // the two-ring focus that holds on any glass level.
  '--shadow-panel',
  '--shadow-popover',
  '--shadow-toast',
  '--glass-highlight',
  '--glass-glow',
  '--focus-ring',
] as const;

/**
 * Theme-independent: the type scale's sizes and line-heights, one pair per step.
 * Declared in `styles/type.css`, not here in `theme.css` — generated from
 * `TYPE_SCALE` (LAI-828), so this list is derived rather than typed out.
 */
export const TYPE_TOKENS: readonly string[] = STEP_NAMES.map((step) => `--text-${step}`);
export const LEADING_TOKENS: readonly string[] = STEP_NAMES.map((step) => `--leading-${step}`);

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

/**
 * `--font-ui` points at one of the `--font-face-*` stacks (LAI-1125); the
 * picker previews each face through its token, so they are listed too.
 */
export const FAMILY_TOKENS = [
  '--font-ui',
  '--font-mono',
  '--font-face-plus-jakarta-sans',
  '--font-face-poppins',
  '--font-face-commissioner',
  '--font-face-average-sans',
  '--font-face-carter-one',
  '--font-face-short-stack',
] as const;

/**
 * Shared non-scale tokens: the chip framing lever (one place turns chip boxes
 * on and off), the app-wide transition, the one-line accent pick and the brand
 * loaders' durations (LAI-1126). Theme-independent by design.
 */
export const SHARED_MISC_TOKENS = [
  '--chip-padding',
  '--chip-border',
  '--chip-bg',
  '--transition',
  '--accent-source',
  '--motion-spin',
  '--motion-step',
] as const;

/** Glass, colour-free (LAI-1132): blur per level, capped at 32px, and saturation. */
export const GLASS_SHARED_TOKENS = [
  '--glass-blur-1',
  '--glass-blur-2',
  '--glass-blur-3',
  '--glass-blur-scrim',
  '--glass-saturate',
] as const;

/*
 * Motion tokens are not listed here: `theme/motion.ts` owns them and
 * `styles/motion.css` declares them (LAI-1208). LAI-1132 kept five of the same
 * names in theme.css; the merge train kept one copy.
 */

/**
 * The layer ladder (LAI-1132), low to high. Order is the contract — a
 * popover or menu opened from a panel must outrank it (B16) — and
 * `tokens.test.ts` asserts it strictly ascending in exactly this order.
 */
export const LAYER_TOKENS = [
  '--layer-sticky',
  '--layer-header',
  '--layer-sidebar',
  '--layer-drawer',
  '--layer-overlay',
  '--layer-panel',
  '--layer-popover',
  '--layer-menu',
  '--layer-tooltip',
  '--layer-dialog',
  '--layer-toast',
] as const;

/**
 * Text on glass, composited over the worst-case backdrop (LAI-1132).
 *
 * A glass level is translucent, so its effective colour depends on what is
 * behind it. The worst case is `--ambient-peak` — the lightest stop of the
 * dark ambient ground, the darkest of the light — and every level carrying
 * text must clear AA over it. Blur is ignored: it lowers local contrast and
 * can never be relied on to raise it.
 */
export const GLASS_CONTRAST_PAIRS: readonly {
  readonly text: string;
  readonly glass: string;
  readonly backdrop: string;
}[] = [
  ...(['--glass-1', '--glass-2', '--glass-3'] as const).flatMap((glass) =>
    (['--text-primary', '--text-secondary'] as const).flatMap((text) =>
      (['--ambient-peak', '--bg-canvas'] as const).map((backdrop) => ({ text, glass, backdrop })),
    ),
  ),
];

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
  // LAI-1126: the splash's wordmark and tagline on both ends of its gradient.
  { text: '--text-primary', background: '--brand-splash-from' },
  { text: '--text-primary', background: '--brand-splash-to' },
  { text: '--text-secondary', background: '--brand-splash-from' },
  { text: '--text-secondary', background: '--brand-splash-to' },
  // The accent is picked through a `var()`, so its hex is checked at source:
  // both candidates as text on a card, and the ink on each as a solid fill.
  { text: '--brand-periwinkle', background: '--bg-card' },
  { text: '--brand-legacy-purple', background: '--bg-card' },
  { text: '--on-accent', background: '--brand-periwinkle' },
  { text: '--on-accent', background: '--brand-legacy-purple' },
  // LAI-1132: the opaque steps glass falls back to, and solid-on-glass.
  ...(['--glass-1-solid', '--glass-2-solid', '--glass-3-solid', '--glass-solid'] as const).flatMap(
    (background) =>
      (['--text-primary', '--text-secondary'] as const).map((text) => ({ text, background })),
  ),
];
