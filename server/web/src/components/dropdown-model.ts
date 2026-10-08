/**
 * The decisions `Dropdown` makes that do not need a DOM (LAI-726): which
 * options a search keeps, which part of a name to highlight, where type-ahead
 * lands, and where the panel goes. Pure, so `node --test` can reach them.
 */

/** What the model needs to know about an option — a subset of `DropdownOption`. */
export interface ModelOption {
  readonly value: string;
  readonly label: string;
  /** Matched by search alongside the label (a sprint's key, a person's email). */
  readonly keywords?: string | undefined;
  /** Drawn first and kept through a search — "Any", "Anyone", "Unassigned". */
  readonly pinned?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

/** A search box is offered on a list longer than this (the owner's brief: "more than 8"). */
export const SEARCH_THRESHOLD = 8;

const fold = (text: string): string => text.toLocaleLowerCase();

/**
 * The options a search keeps, in their original order.
 *
 * **Pinned options survive every search.** They are the way back to "no
 * filter", and a search that hid "Any" would leave nothing to undo it with
 * but the search box itself.
 */
export function filterOptions<T extends ModelOption>(options: readonly T[], query: string): T[] {
  const needle = fold(query.trim());
  if (needle === '') return [...options];
  return options.filter(
    (o) =>
      o.pinned === true ||
      fold(o.label).includes(needle) ||
      (o.keywords !== undefined && fold(o.keywords).includes(needle)),
  );
}

/** True when a search is under way and only pinned options are left. */
export function noMatches(options: readonly ModelOption[], query: string): boolean {
  return query.trim() !== '' && options.every((o) => o.pinned === true);
}

/** A label cut into runs, the matched ones marked — every occurrence, case-insensitively. */
export interface Run {
  readonly text: string;
  readonly match: boolean;
}

export function highlight(label: string, query: string): Run[] {
  const needle = fold(query.trim());
  if (needle === '') return [{ text: label, match: false }];
  const hay = fold(label);
  const runs: Run[] = [];
  let at = 0;
  for (;;) {
    const hit = hay.indexOf(needle, at);
    if (hit === -1) break;
    if (hit > at) runs.push({ text: label.slice(at, hit), match: false });
    runs.push({ text: label.slice(hit, hit + needle.length), match: true });
    at = hit + needle.length;
  }
  if (at < label.length) runs.push({ text: label.slice(at), match: false });
  return runs.length === 0 ? [{ text: label, match: false }] : runs;
}

/**
 * Where Up, Down, Home, End, PageUp and PageDown move the active option.
 * Disabled options are stepped over; the ends do not wrap, as the APG's
 * select-only combobox does not.
 */
export type Move = 'next' | 'previous' | 'first' | 'last' | 'page-down' | 'page-up';

export const PAGE = 10;

export function move(options: readonly ModelOption[], from: number, how: Move): number {
  const enabled = options.map((o, i) => (o.disabled === true ? -1 : i)).filter((i) => i !== -1);
  if (enabled.length === 0) return -1;
  const first = enabled[0]!;
  const last = enabled[enabled.length - 1]!;
  switch (how) {
    case 'first':
      return first;
    case 'last':
      return last;
    case 'next':
      return enabled.find((i) => i > from) ?? (from === -1 ? first : last);
    case 'previous':
      return [...enabled].reverse().find((i) => i < from) ?? first;
    case 'page-down':
      return enabled.find((i) => i >= from + PAGE) ?? last;
    case 'page-up':
      return [...enabled].reverse().find((i) => i <= from - PAGE) ?? first;
  }
}

/**
 * Type-ahead: the next option whose label starts with what was typed.
 *
 * Searches from the option **after** the current one, so pressing the same
 * letter again walks through every name starting with it — the way a native
 * select does. A buffer of one repeated letter is treated as that letter.
 */
export function typeahead(options: readonly ModelOption[], from: number, buffer: string): number {
  if (buffer === '') return -1;
  const repeated = [...buffer].every((c) => c === buffer[0]);
  const needle = fold(repeated ? buffer[0]! : buffer);
  const n = options.length;
  // A longer buffer refines the current match before moving past it.
  const start = repeated ? from + 1 : Math.max(from, 0);
  for (let k = 0; k < n; k += 1) {
    const i = (start + k) % n;
    const o = options[i]!;
    if (o.disabled !== true && fold(o.label).startsWith(needle)) return i;
  }
  return -1;
}

export interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

export interface Placement {
  readonly side: 'below' | 'above';
  /** From the viewport's top when below, from its bottom when above. */
  readonly top: number | undefined;
  readonly bottom: number | undefined;
  readonly left: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface PlaceOptions {
  /** Between the trigger and the panel. */
  readonly gap: number;
  /** Kept clear at every viewport edge. */
  readonly margin: number;
  /** The panel's own ceiling, about 18rem. */
  readonly cap: number;
  /** The narrowest the panel is drawn, whatever the trigger. */
  readonly floor: number;
}

/**
 * Below the trigger, or above it when there is not room below and there is
 * more above; never past the viewport on any side.
 *
 * `natural` is how tall the panel would be uncapped. Below is preferred: it
 * flips only when the panel would be cut short below **and** above has more
 * room, so a short list near the bottom still opens downward if it fits.
 *
 * Above is placed by `bottom`, not `top`, so a panel that shrinks while you
 * search stays attached to its trigger instead of floating up away from it.
 */
export function place(
  trigger: Rect,
  natural: number,
  viewport: { readonly width: number; readonly height: number },
  { gap, margin, cap, floor }: PlaceOptions,
): Placement {
  const want = Math.min(natural, cap);
  const below = viewport.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const side = below >= want || below >= above ? 'below' : 'above';
  const room = Math.max(0, side === 'below' ? below : above);

  const maxWidth = Math.max(0, viewport.width - 2 * margin);
  const minWidth = Math.min(Math.max(trigger.width, floor), maxWidth);
  // Left-aligned with the trigger, slid back in if it would overhang the right.
  const left = Math.max(margin, Math.min(trigger.left, viewport.width - margin - minWidth));

  return {
    side,
    top: side === 'below' ? trigger.bottom + gap : undefined,
    bottom: side === 'above' ? viewport.height - trigger.top + gap : undefined,
    left,
    minWidth,
    maxWidth: Math.max(minWidth, viewport.width - margin - left),
    maxHeight: Math.min(cap, room),
  };
}

/** The part of the layout viewport actually on screen, in its coordinates. */
export interface Area {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `place`, against the **visible** area rather than the whole layout viewport
 * (LAI-726 review, round 1).
 *
 * On a phone the visual viewport is smaller than the layout viewport and can
 * sit anywhere inside it — the on-screen keyboard takes the bottom, a pinch
 * zoom shows a corner. A panel placed against `innerHeight` then lands under
 * the keyboard. This places in the visible area's own coordinates and hands
 * back values for a `position: fixed` box, which are layout-viewport values:
 * `top` and `left` shifted by the area's offset, `bottom` measured from the
 * layout viewport's bottom edge (`layoutHeight`). With the area equal to the
 * layout viewport it is exactly `place`.
 */
export function placeWithin(
  trigger: Rect,
  natural: number,
  area: Area,
  layoutHeight: number,
  options: PlaceOptions,
): Placement {
  const local = place(
    {
      top: trigger.top - area.top,
      bottom: trigger.bottom - area.top,
      left: trigger.left - area.left,
      right: trigger.right - area.left,
      width: trigger.width,
    },
    natural,
    { width: area.width, height: area.height },
    options,
  );
  const below = layoutHeight - (area.top + area.height);
  return {
    ...local,
    top: local.top === undefined ? undefined : local.top + area.top,
    bottom: local.bottom === undefined ? undefined : local.bottom + below,
    left: local.left + area.left,
  };
}

/** True when no part of the trigger is inside the visible area. */
export function outOfView(trigger: Rect, area: Area): boolean {
  return (
    trigger.bottom <= area.top ||
    trigger.top >= area.top + area.height ||
    trigger.right <= area.left ||
    trigger.left >= area.left + area.width
  );
}

/**
 * True for an event target inside an open dropdown's panel.
 *
 * The panel is portalled to `<body>`, so it is outside every popover and
 * dialog that contains its trigger. An outside-click handler must ask this
 * before deciding a click was outside, or choosing an option closes the
 * popover the dropdown lives in.
 */
export function isInDropdownPanel(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    target.closest('[data-dropdown-panel]') !== null
  );
}
