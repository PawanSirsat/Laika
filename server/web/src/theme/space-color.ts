/**
 * A space's colour (D-103 item 4, LAI-978).
 *
 * The server stores one of eight palette names per space (LAI-976) and this
 * file turns a name into the token that paints it. The values live in
 * `styles/theme.css` as `--space-<name>`, so the letter avatar on the Spaces
 * page and the one in space settings are the same paint, and a theme edit is a
 * token edit rather than a hunt through components.
 *
 * Every fill carries a white letter (`--on-space`) in both themes, as the
 * avatars do (LAI-606); `space-color.test.ts` holds each pair to WCAG AA.
 */

export const SPACE_COLORS = [
  'black',
  'violet',
  'teal',
  'blue',
  'amber',
  'magenta',
  'red',
  'green',
] as const;

export type SpaceColor = (typeof SPACE_COLORS)[number];

export function isSpaceColor(value: unknown): value is SpaceColor {
  return typeof value === 'string' && (SPACE_COLORS as readonly string[]).includes(value);
}

/** FNV-1a, as `avatar-color.ts` uses: stable across runtimes and bundlers. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The colour a space is painted: the one it stores, or — for a space that has
 * none, or a value this client does not know — one derived from its slug, so
 * it does not change between page loads.
 */
export function spaceColor(space: {
  readonly slug: string;
  readonly color?: string | null | undefined;
}): SpaceColor {
  if (isSpaceColor(space.color)) return space.color;
  return SPACE_COLORS[hash(space.slug) % SPACE_COLORS.length] ?? 'violet';
}

/** The CSS value for a colour's fill. */
export function spaceColorVar(color: SpaceColor): string {
  return `var(--space-${color})`;
}
