import type { ProjectLook } from '../api/project-looks.ts';
import type { ProjectIcon } from '../api/projects.ts';
import { spaceColor, type SpaceColor } from '../theme/space-color.ts';

/**
 * What a space's mark draws (D-152, LAI-1311): its image, else its emoji,
 * else the first letter of its name on its colour. Pure, so the order is
 * tested here and `ProjectMark` only renders it.
 */

/** As much of a space as a mark needs. A site that holds only a slug and a name passes those. */
export interface MarkedSpace {
  readonly slug: string;
  /** Absent where a site knows only the slug: the name last read for it, else the slug. */
  readonly name?: string | undefined;
  /** Absent is "this site does not know", and what was last read for the slug is used. */
  readonly color?: string | null | undefined;
  readonly icon?: ProjectIcon | null | undefined;
}

export type Mark =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'emoji'; readonly emoji: string; readonly color: SpaceColor }
  | { readonly kind: 'letter'; readonly letter: string; readonly color: SpaceColor };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The name's first character, upper-cased — a whole grapheme, so an accent stays on its letter. */
export function markLetter(name: string, slug: string): string {
  const source = name.trim() === '' ? slug.trim() : name.trim();
  const first = graphemes.segment(source)[Symbol.iterator]().next().value?.segment ?? '?';
  return first.toLocaleUpperCase();
}

/** The name a mark says and takes its letter from: the site's, else the last read, else the slug. */
export function markName(space: MarkedSpace, look: ProjectLook | undefined): string {
  return space.name ?? look?.name ?? space.slug;
}

/**
 * The mark for a space.
 *
 * - **The icon** is what was last read for the slug (`look`) whenever there is
 *   one, over the site's own copy: the icon changes only in Space settings,
 *   which tells nobody but the look store, so a site's copy is the one that
 *   goes stale.
 * - **The colour** is the site's when it has one, and the look's only where it
 *   has none: a colour changes through a settings save, which hands the page
 *   the saved space — so the page's copy is the newest, and a list read just
 *   before the save must not paint over it.
 *
 * `brokenUrl` is an image that would not load — its letter shows instead.
 */
export function markOf(
  space: MarkedSpace,
  look: ProjectLook | undefined,
  brokenUrl: string | null = null,
): Mark {
  const icon = look !== undefined ? look.icon : (space.icon ?? null);
  const color = spaceColor({
    slug: space.slug,
    color: space.color !== undefined ? space.color : (look?.color ?? null),
  });
  const letter = markLetter(markName(space, look), space.slug);
  if (icon !== null && 'url' in icon && icon.url !== brokenUrl) {
    return { kind: 'image', url: icon.url };
  }
  if (icon !== null && 'emoji' in icon) return { kind: 'emoji', emoji: icon.emoji, color };
  return { kind: 'letter', letter, color };
}
