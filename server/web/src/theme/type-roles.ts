/**
 * The type system: one scale, sixteen roles, and nothing outside them (LAI-606,
 * LAI-828).
 *
 * ## The rule
 *
 * Every size is a step of `TYPE_SCALE` below. The board's card and lane apply
 * a role — `.t-body`, `.t-meta` — which fixes size, weight, leading, tracking
 * and colour together; every other stylesheet sets `font-size` to a scale
 * token, `var(--text-<step>)`, and nothing else (LAI-828). A screen that needs a
 * size the scale does not have is a change to the scale, decided once for the
 * whole app — not a local declaration.
 *
 * ## What this buys, stated as the tests that hold it
 *
 *  - Changing `TYPE_SCALE.body` changes every 14px text in the app, and
 *    changing `TYPE_ROLES.body.step` changes **every card title and nothing
 *    else**.
 *  - Swapping `--font-ui` restyles the whole app in one line.
 *
 * ## Why an object *and* CSS, rather than generating one from the other
 *
 * CSS cannot import TypeScript. So the scale and the roles are declared twice —
 * here, and as the `:root` tokens and `.t-*` classes in `styles/type.css`,
 * which `scripts/generate-type-css.ts` writes from this file — and
 * `type-roles.test.ts` fails when the two disagree on any field: the pair
 * cannot drift, because drifting is a red test.
 */

/**
 * The type scale (LAI-828): Atlassian's published sizes, which Jira uses.
 *
 * The owner, 2026-10-21: *"the text size is very small, we need to increase it
 * everywhere … I want the same as the Jira board."* Every `font-size` in a
 * stylesheet is one of these steps, as `var(--text-<step>)`, with its pair as
 * `var(--leading-<step>)`; `type-floor.test.ts` fails on a raw size. Seven
 * steps, and the reason a screen gets one rather than another is its role:
 *
 *  - `body` 14/20 — default UI text, table cells, card titles, form fields,
 *    buttons.
 *  - `reading` 16/24 — text read like a document: a task's description,
 *    acceptance and comments.
 *  - `small` 12/16 — secondary lines, meta, timestamps, chips, keys, field
 *    labels, uppercase section labels. The floor.
 *  - `tiny` 11/16 — **only** the badges and counters `type-floor.test.ts` names,
 *    where 12px truly cannot fit: avatar initials in a circle under 28px and the
 *    folded sidebar's count.
 *  - `heading-lg` 24/28 — a page title, the task panel's title.
 *  - `heading-md` 20/24 — a section heading, a dialog title.
 *  - `heading-sm` 16/20 — a card or panel heading.
 *
 * Emitted as `:root` custom properties at the top of `styles/type.css`, in rem,
 * so the scale honours the reader's browser setting.
 */
export const TYPE_SCALE = {
  tiny: { size: 11, leading: 16 },
  small: { size: 12, leading: 16 },
  body: { size: 14, leading: 20 },
  reading: { size: 16, leading: 24 },
  'heading-sm': { size: 16, leading: 20 },
  'heading-md': { size: 20, leading: 24 },
  'heading-lg': { size: 24, leading: 28 },
} as const satisfies Record<string, { readonly size: number; readonly leading: number }>;

export type StepName = keyof typeof TYPE_SCALE;

export const STEP_NAMES = Object.keys(TYPE_SCALE) as StepName[];

/** The semantic colour tokens a role may point at. */
export type RoleColor = 'text-primary' | 'text-secondary' | 'text-muted' | 'inherit';

export interface TypeRole {
  /** `ui` or `mono` — resolves to `--font-ui` / `--font-mono`. */
  readonly family: 'ui' | 'mono';
  /** The step of `TYPE_SCALE` this role is set in. Emitted as `var(--text-<step>)`. */
  readonly step: StepName;
  /**
   * The prototype leans on 700 and 800 — column heads, keys and initials are
   * heavy at small sizes (LAI-605). The variable fonts carry the whole axis,
   * so both are real faces, not synthesised bolds.
   */
  readonly weight: 400 | 500 | 600 | 700 | 800;
  /**
   * `'step'` — the step's own pair, `var(--leading-<step>)`, for text that can
   * wrap. Or a unitless ratio, for a single-line role whose box is sized by its
   * padding: `1` keeps a chip or a control exactly as tall as it was designed.
   */
  readonly leading: number | 'step';
  /** `em`, or 0. */
  readonly tracking: number;
  /**
   * `inherit` means **the element decides** — a chip supplies its own
   * `--chip-*`, a control its own state colour. It is not "unset": it is the
   * roles that deliberately do not own colour.
   */
  readonly color: RoleColor;
  readonly transform?: 'uppercase';
  /** Counts, dates and durations line up in columns. */
  readonly tabular?: true;
  /** Single-line roles truncate rather than wrap. */
  readonly truncate?: true;
}

export const TYPE_ROLES = {
  display: {
    family: 'ui',
    step: 'heading-lg',
    weight: 800,
    leading: 'step',
    tracking: -0.024,
    color: 'text-primary',
  },
  title: {
    family: 'ui',
    step: 'heading-sm',
    weight: 600,
    leading: 'step',
    tracking: 0,
    color: 'text-primary',
  },
  /*
   * The board's column heads. Uppercase and heavy, so it is set in `small`,
   * as Jira sets its own column heads — 12px, a half pixel under the 12.5 it
   * was, and the one role LAI-828 did not lift.
   */
  heading: {
    family: 'ui',
    step: 'small',
    weight: 800,
    leading: 1,
    tracking: 0.07,
    color: 'text-primary',
    transform: 'uppercase',
  },
  tab: {
    family: 'ui',
    step: 'body',
    weight: 600,
    leading: 1,
    tracking: 0,
    color: 'text-secondary',
    truncate: true,
  },
  body: {
    family: 'ui',
    step: 'body',
    weight: 600,
    leading: 'step',
    tracking: -0.008,
    color: 'text-primary',
  },
  'body-sm': {
    family: 'ui',
    step: 'body',
    weight: 400,
    leading: 'step',
    tracking: 0,
    color: 'text-primary',
  },
  label: {
    family: 'ui',
    step: 'small',
    weight: 700,
    leading: 1,
    tracking: 0,
    color: 'inherit',
    truncate: true,
  },
  'field-label': {
    family: 'ui',
    step: 'small',
    weight: 400,
    leading: 'step',
    tracking: 0,
    color: 'text-secondary',
  },
  value: {
    family: 'ui',
    step: 'body',
    weight: 400,
    leading: 'step',
    tracking: 0,
    color: 'text-primary',
    tabular: true,
  },
  meta: {
    family: 'mono',
    step: 'small',
    weight: 700,
    leading: 1,
    tracking: 0,
    color: 'text-muted',
    tabular: true,
    truncate: true,
  },
  overline: {
    family: 'ui',
    step: 'small',
    weight: 800,
    leading: 1,
    tracking: 0.09,
    color: 'text-muted',
    transform: 'uppercase',
  },
  caption: {
    family: 'ui',
    step: 'small',
    weight: 700,
    leading: 'step',
    tracking: 0,
    color: 'inherit',
  },
  control: {
    family: 'ui',
    step: 'body',
    weight: 700,
    leading: 1,
    tracking: 0,
    color: 'inherit',
    truncate: true,
  },
  input: {
    family: 'ui',
    step: 'body',
    weight: 500,
    leading: 1,
    tracking: 0,
    color: 'text-primary',
  },
  code: {
    family: 'mono',
    step: 'small',
    weight: 800,
    leading: 1,
    tracking: 0.02,
    color: 'text-secondary',
    tabular: true,
    truncate: true,
  },
  'code-sm': {
    family: 'mono',
    step: 'small',
    weight: 700,
    leading: 1,
    tracking: 0,
    color: 'inherit',
  },
  /*
   * Initials in a circle — card avatar, the toolbar's assignee stack, the
   * sidebar's owner chip. Its colour is `inherit` because the circle supplies
   * a background *and* a matching foreground from `avatarColor()`; a role that
   * fixed the colour would make every avatar identical, which is the one thing
   * an avatar must not be. `tiny`, because the widest initials, "WM", are
   * 23.8px at 12px in this weight — wider than a 22px circle — and 21.8px at
   * 11px (LAI-828).
   */
  avatar: {
    family: 'ui',
    step: 'tiny',
    weight: 800,
    leading: 1,
    tracking: 0.02,
    color: 'inherit',
  },
} as const satisfies Record<string, TypeRole>;

export type RoleName = keyof typeof TYPE_ROLES;

/**
 * Density: the same roles, closer together (LAI-606).
 *
 * **Step and leading only — never weight, never colour.** A dense board is the
 * same information closer together, not a different emphasis; letting density
 * touch weight would give the compact view a type hierarchy of its own to
 * drift from the comfortable one.
 *
 * Since LAI-828 the dense board keeps every size and only tightens the card
 * title's leading: the scale has no step between `small` and `body`, and the
 * old dense sizes (10.5px meta and labels) are under the floor.
 *
 * Every key must name a real role — `type-roles.test.ts` enforces it, so a
 * renamed role cannot leave a dead override behind.
 */
export const DENSITY = {
  dense: {
    body: { leading: 1.3 },
  },
} as const satisfies Record<
  string,
  Partial<Record<RoleName, { step?: StepName; leading?: number | 'step' }>>
>;

export type DensityName = keyof typeof DENSITY;

/**
 * The same table, seen as `TypeRole`s.
 *
 * `as const satisfies` above is what catches a typo at the point of authoring —
 * but it also narrows each entry to its own literal shape, so `role.transform`
 * does not exist on the roles that happen not to set it. Reading through this
 * view restores the optional fields without giving up the authoring check.
 */
export const ROLES: Readonly<Record<RoleName, TypeRole>> = TYPE_ROLES;

export const ROLE_NAMES = Object.keys(TYPE_ROLES) as RoleName[];

/** `16px` → `1rem`, so a role honours the reader's browser setting. */
export function rem(px: number): string {
  return `${String(px / 16)}rem`;
}

/** A role's or density override's `line-height`, as CSS. */
export function leadingCss(leading: number | 'step', step: StepName): string {
  return leading === 'step' ? `var(--leading-${step})` : String(leading);
}
