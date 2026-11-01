/**
 * The address of a space's settings (D-103, LAI-977), on a tab or not. One
 * function, so the ⋯ menu, the Spaces cards' gear and the page's own tabs
 * cannot spell it three ways.
 */
export function spaceSettingsHref(slug: string, tab?: string): string {
  const base = `/spaces/${encodeURIComponent(slug)}/settings`;
  return tab === undefined ? base : `${base}?tab=${encodeURIComponent(tab)}`;
}
