/**
 * The type system: sixteen roles, and nothing outside them (LAI-606).
 *
 * ## The rule
 *
 * Every piece of text in Laika is assigned exactly one role. Components apply a
 * role — `.t-body`, `.t-meta` — and never set `font-size`, `font-weight`,
 * `line-height`, `letter-spacing` or a text colour themselves. A screen that
 * needs a size this list does not have gets a **new role here**, not a local
 * declaration; that is the whole mechanism, and the moment one component opts
 * out the guarantee below stops being true.
 *
 * ## What this buys, stated as the two tests that hold it
 *
 *  - Changing `TYPE_ROLES.body.size` changes **every card title and nothing
 *    else**.
 *  - Swapping `--font-ui` restyles the whole app in one line.
 *
 * ## Why an object *and* CSS, rather than generating one from the other
 *
 * CSS cannot import TypeScript, and a build step that emits stylesheets is a
 * second pipeline to keep alive. So the roles are declared twice — here, and as
 * `.t-*` classes in `styles/type.css` — and `type-roles.test.ts` fails when the
 * two disagree on any field. That is the same guarantee as generation, reached
 * without a generator: the pair cannot drift, because drifting is a red test.
 */

/** The semantic colour tokens a role may point at. */
export type RoleColor = 'text-primary' | 'text-secondary' | 'text-muted' | 'inherit';

export interface TypeRole {
  /** `ui` or `mono` — resolves to `--font-ui` / `--font-mono`. */
  readonly family: 'ui' | 'mono';
  /** Pixels, as the brief states them. Emitted as rem. */
  readonly size: number;
  readonly weight: 400 | 500 | 600;
  /**
   * A unitless ratio, or a CSS length such as `'20px'`.
   *
   * Both forms are kept because both are meant: a ratio scales with the size,
   * a length does not. The reference specifies several roles in px, and
   * converting those to a ratio would make them drift the moment a size moves
   * — which is the opposite of what a px line-height is chosen for.
   */
  readonly leading: number | `${number}px`;
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
    size: 22,
    weight: 600,
    leading: 1.2,
    tracking: -0.01,
    color: 'text-primary',
  },
  title: { family: 'ui', size: 16, weight: 600, leading: 1.3, tracking: 0, color: 'text-primary' },
  heading: {
    family: 'ui',
    size: 14,
    weight: 600,
    leading: '20px',
    tracking: 0,
    color: 'text-primary',
  },
  tab: {
    family: 'ui',
    size: 14,
    weight: 500,
    leading: 1,
    tracking: 0,
    color: 'text-secondary',
    truncate: true,
  },
  body: { family: 'ui', size: 14, weight: 400, leading: '20px', tracking: 0, color: 'text-primary' },
  'body-sm': {
    family: 'ui',
    size: 14,
    weight: 400,
    leading: 1.45,
    tracking: 0,
    color: 'text-primary',
  },
  label: {
    family: 'ui',
    size: 12,
    weight: 400,
    leading: '16px',
    tracking: 0,
    color: 'inherit',
    truncate: true,
  },
  'field-label': {
    family: 'ui',
    size: 12,
    weight: 400,
    leading: 1.3,
    tracking: 0,
    color: 'text-secondary',
  },
  value: {
    family: 'ui',
    size: 13,
    weight: 400,
    leading: 1.3,
    tracking: 0,
    color: 'text-primary',
    tabular: true,
  },
  meta: {
    family: 'ui',
    size: 13,
    weight: 400,
    leading: 1.3,
    tracking: 0,
    color: 'text-muted',
    tabular: true,
    truncate: true,
  },
  overline: {
    family: 'ui',
    size: 11,
    weight: 600,
    leading: 1,
    tracking: 0.06,
    color: 'text-muted',
    transform: 'uppercase',
  },
  caption: {
    family: 'ui',
    size: 13,
    weight: 400,
    leading: 1.45,
    tracking: 0,
    color: 'text-secondary',
  },
  control: {
    family: 'ui',
    size: 14,
    weight: 500,
    leading: 1,
    tracking: 0,
    color: 'inherit',
    truncate: true,
  },
  input: { family: 'ui', size: 14, weight: 400, leading: 1, tracking: 0, color: 'text-primary' },
  code: {
    family: 'mono',
    size: 14,
    weight: 400,
    leading: '20px',
    tracking: 0,
    color: 'text-secondary',
    tabular: true,
    truncate: true,
  },
  'code-sm': {
    family: 'mono',
    size: 12,
    weight: 400,
    leading: 1,
    tracking: 0,
    color: 'text-muted',
  },
  /*
   * Initials in a circle — card avatar, the toolbar's assignee stack, the
   * sidebar's owner chip. Its colour is `inherit` because the circle supplies
   * a background *and* a matching foreground from `avatarColor()`; a role that
   * fixed the colour would make every avatar identical, which is the one thing
   * an avatar must not be.
   */
  avatar: {
    family: 'ui',
    size: 11,
    weight: 600,
    leading: 1,
    tracking: 0.02,
    color: 'inherit',
  },
} as const satisfies Record<string, TypeRole>;

export type RoleName = keyof typeof TYPE_ROLES;

/**
 * Density: the same roles, smaller (LAI-606).
 *
 * **Size and leading only — never weight, never colour.** A dense board is the
 * same information closer together, not a different emphasis; letting density
 * touch weight would give the compact view a type hierarchy of its own to
 * drift from the comfortable one.
 *
 * Every key must name a real role — `type-roles.test.ts` enforces it, so a
 * renamed role cannot leave a dead override behind.
 */
export const DENSITY = {
  dense: {
    body: { size: 13, leading: '18px' },
    meta: { size: 12 },
    label: { size: 11 },
  },
} as const satisfies Record<
  string,
  Partial<Record<RoleName, { size?: number; leading?: number | `${number}px` }>>
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
