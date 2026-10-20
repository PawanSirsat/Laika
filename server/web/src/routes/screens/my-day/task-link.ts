/**
 * Where a card opens from My day (LAI-810, the owner: *"everything must be
 * connected"*) — **the route LAI-755 opens a task by**: in its own space, by
 * id, so the board does not fall back to the last space it showed; by a key
 * search when the space is not known. `openTaskInItsSpace` in `ScreenOutlet`
 * navigates to the same two addresses. Here they are an `href`, so a
 * middle-click or *Open in new tab* works as it does on any link.
 */

export interface CardRef {
  readonly id: string;
  readonly key: string;
}

/** `/board?project=atlas&task=t1`, or `/board?q=LAI-1` when the space is not known. */
export function taskHref(task: CardRef, slug: string | undefined): string {
  if (slug === undefined) return `/board?q=${encodeURIComponent(task.key)}`;
  return `/board?project=${encodeURIComponent(slug)}&task=${encodeURIComponent(task.id)}`;
}

/** The modifiers and button a click carried — a mouse event's, or a test's. */
export interface ClickLike {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * A plain left click, which the app follows itself without reloading. Any
 * other — a modifier for a new tab or window, a middle button — stays the
 * browser's.
 */
export function plainClick(event: ClickLike): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A space the reader can read, as `GET /projects` lists it. */
export interface Space {
  readonly prefix: string;
  readonly slug: string;
  readonly name: string;
}

/**
 * The space a card's key belongs to, **among the spaces the reader can read**
 * — `GET /projects` lists only those, and a prefix is unique in an
 * organisation. `undefined` for a key no readable space owns: a card the
 * reader cannot read, which is never a link (LAI-810 review round 1).
 */
export function spaceOfKey(key: string, spaces: readonly Space[]): Space | undefined {
  const dash = key.lastIndexOf('-');
  if (dash <= 0) return undefined;
  const prefix = key.slice(0, dash);
  return spaces.find((space) => space.prefix === prefix);
}
