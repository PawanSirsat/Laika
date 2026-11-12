/**
 * The keys of a tab strip (LAI-1193), as the WAI-ARIA Authoring Practices
 * *Tabs* pattern gives them: Left and Right move one tab and wrap at the ends,
 * Home and End jump to the first and the last.
 *
 * Pure, so the one rule every strip in the app follows is tested without a
 * browser. `undefined` means *"not a tab key — leave the event alone"*, which
 * is how Tab, Enter and every printable key keep their usual meaning.
 */
export function tabKeyTarget(key: string, at: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  const last = count - 1;
  // Focus outside the strip's tabs (-1) enters at the end the key points to.
  const from = at < 0 || at > last ? -1 : at;
  switch (key) {
    case 'ArrowRight':
      return from === -1 || from === last ? 0 : from + 1;
    case 'ArrowLeft':
      return from === -1 || from === 0 ? last : from - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}

/** How far a strip that scrolls is from each of its ends, in CSS pixels. */
export interface StripScroll {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/**
 * Which edges of a horizontally scrolling strip hide a tab (LAI-1193): the
 * fade is drawn on that edge, and only there, so a strip that fits shows none.
 *
 * One pixel of slack: browsers report fractional widths rounded either way,
 * and a strip scrolled fully home must not keep a fade over nothing.
 */
export function stripOverflow(scroll: StripScroll): { start: boolean; end: boolean } {
  const room = scroll.scrollWidth - scroll.clientWidth;
  if (room <= 1) return { start: false, end: false };
  return { start: scroll.scrollLeft > 1, end: scroll.scrollLeft < room - 1 };
}

/** One tab's box against its strip's visible window, in the strip's own coordinates. */
export interface TabBox {
  readonly left: number;
  readonly width: number;
}

/**
 * The `scrollLeft` that brings a tab fully into view, or `undefined` when it
 * already is (LAI-1193). Moves the least distance, and leaves `inset` pixels
 * past the tab so the edge fade does not sit on top of it.
 */
export function scrollToReveal(
  tab: TabBox,
  scroll: StripScroll,
  inset: number,
): number | undefined {
  const viewStart = scroll.scrollLeft;
  const viewEnd = scroll.scrollLeft + scroll.clientWidth;
  const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  if (tab.left - inset < viewStart) return Math.max(0, tab.left - inset);
  if (tab.left + tab.width + inset > viewEnd) {
    return Math.min(max, tab.left + tab.width + inset - scroll.clientWidth);
  }
  return undefined;
}
