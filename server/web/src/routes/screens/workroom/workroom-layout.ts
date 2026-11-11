/**
 * **The Workroom's frame, as numbers** (LAI-1199; Workroom spec §1.5): the
 * two side panels' widths and limits, how a separator moves under a key, the
 * breakpoints, the areas, and how widths are kept in this browser. Pure, so
 * every rule here is tested without a renderer.
 */

export type PanelSide = 'left' | 'right';

export interface PanelLimits {
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

/** In CSS pixels. The centre takes the rest and never goes below its own minimum. */
export const PANEL_LIMITS: Readonly<Record<PanelSide, PanelLimits>> = {
  left: { min: 200, max: 360, initial: 248 },
  right: { min: 280, max: 440, initial: 320 },
};

/** The centre's floor, in CSS pixels. */
export const CENTRE_MIN = 560;

/** One arrow press moves a separator this far; with Shift, `BIG_STEP`. */
export const STEP = 16;
export const BIG_STEP = 64;

/**
 * The layout's breakpoints, by the width of the Workroom itself (not the
 * window — the app sidebar takes its share first).
 *
 * - `three` — left, centre and right, each side resizable.
 * - `two` — centre and right; the left is behind a button.
 * - `one` — a single column with a section switcher.
 */
export type LayoutMode = 'three' | 'two' | 'one';

/** The window widths the spec names: ≥1280 three, ≥1024 two, below that one. */
export const THREE_PANEL_QUERY = '(min-width: 1280px)';
export const TWO_PANEL_QUERY = '(min-width: 1024px)';

export function layoutMode(matches: {
  readonly three: boolean;
  readonly two: boolean;
}): LayoutMode {
  if (matches.three) return 'three';
  if (matches.two) return 'two';
  return 'one';
}

export interface PanelPrefs {
  readonly left: number;
  readonly right: number;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
}

export const DEFAULT_PREFS: PanelPrefs = {
  left: PANEL_LIMITS.left.initial,
  right: PANEL_LIMITS.right.initial,
  leftCollapsed: false,
  rightCollapsed: false,
};

/** Where the preferences are kept. Widths only — never a credential. */
export const PREFS_KEY = 'laika.workroom.panels.v1';

export function clampWidth(side: PanelSide, width: number): number {
  const { min, max } = PANEL_LIMITS[side];
  if (!Number.isFinite(width)) return PANEL_LIMITS[side].initial;
  return Math.round(Math.min(max, Math.max(min, width)));
}

/**
 * What a key does to a separator (WAI-ARIA window splitter): ← → move it by
 * {@link STEP}, with Shift by {@link BIG_STEP}; Home and End go to the
 * panel's minimum and maximum; Enter collapses or expands. Anything else is
 * not the separator's, so `null`.
 *
 * **Direction follows the eye, not the panel.** → moves the line right: the
 * left panel grows and the right panel shrinks.
 */
export type SeparatorCommand =
  { readonly kind: 'width'; readonly width: number } | { readonly kind: 'toggle' };

export function separatorKey(
  side: PanelSide,
  width: number,
  key: { readonly key: string; readonly shiftKey?: boolean },
): SeparatorCommand | null {
  const step = key.shiftKey === true ? BIG_STEP : STEP;
  const grow = side === 'left' ? 1 : -1;
  switch (key.key) {
    case 'ArrowRight':
      return { kind: 'width', width: clampWidth(side, width + step * grow) };
    case 'ArrowLeft':
      return { kind: 'width', width: clampWidth(side, width - step * grow) };
    case 'Home':
      return { kind: 'width', width: PANEL_LIMITS[side].min };
    case 'End':
      return { kind: 'width', width: PANEL_LIMITS[side].max };
    case 'Enter':
      return { kind: 'toggle' };
    default:
      return null;
  }
}

/**
 * A drag's new width: the pointer moved `dx` pixels since the drag began at
 * `startWidth`. Same direction rule as the keys.
 */
export function dragWidth(side: PanelSide, startWidth: number, dx: number): number {
  return clampWidth(side, startWidth + (side === 'left' ? dx : -dx));
}

/**
 * The preferences in `raw`, clamped; anything unreadable is the default.
 * Storage written by an older build, or by hand, cannot break the layout.
 */
export function parsePrefs(raw: string | null): PanelPrefs {
  if (raw === null) return DEFAULT_PREFS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS;
  const v = value as Record<string, unknown>;
  return {
    left: typeof v.left === 'number' ? clampWidth('left', v.left) : DEFAULT_PREFS.left,
    right: typeof v.right === 'number' ? clampWidth('right', v.right) : DEFAULT_PREFS.right,
    leftCollapsed: v.leftCollapsed === true,
    rightCollapsed: v.rightCollapsed === true,
  };
}

/** Read the preferences; a storage that throws (private mode, blocked) is the default. */
export function readPrefs(storage: Pick<Storage, 'getItem'> | undefined): PanelPrefs {
  if (storage === undefined) return DEFAULT_PREFS;
  try {
    return parsePrefs(storage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Keep the preferences; a storage that throws keeps nothing and says nothing. */
export function writePrefs(storage: Pick<Storage, 'setItem'> | undefined, prefs: PanelPrefs): void {
  if (storage === undefined) return;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // The layout still works; it just will not be remembered.
  }
}

/** The Workroom's areas, in reading order: the centre's sections and the right panel. */
export const AREAS = [
  { id: 'overview', label: 'Overview' },
  { id: 'execution', label: 'Execution' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'agents', label: 'Agents & review' },
] as const;

export type AreaId = (typeof AREAS)[number]['id'];

/** `?area=`, or Overview for anything it does not name. */
export function areaOf(raw: string | null): AreaId {
  return AREAS.find((a) => a.id === raw)?.id ?? 'overview';
}

/**
 * The focus-mode key (LAI-1199): `.`. Checked against every page key the app
 * already binds — `/` search, `c` create, the Review dialog's `j` `k` `a`
 * `s`, ⌘K — and the Workroom's own Escape. Not while typing, not with a
 * modifier, and not while a dialog is open.
 */
export const FOCUS_KEY = '.';

export function isFocusKey(event: {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
}): boolean {
  return (
    event.key === FOCUS_KEY &&
    event.metaKey !== true &&
    event.ctrlKey !== true &&
    event.altKey !== true
  );
}
