/**
 * The overlay layers and their motion, in one place (LAI-1205).
 *
 * `theme.css` owns colour and is not this task's to change, so the stacking
 * order and the open/close timings live here and in `overlay.css`, which
 * declares the same numbers as `--layer-*` and `--overlay-*` custom
 * properties. `test/components/overlay/overlay-tokens.test.ts` holds the two
 * copies equal, so neither can drift on its own.
 *
 * ## The order, bottom to top
 *
 * The numbers are the ones the app already used (22 literals at the audit),
 * named rather than renumbered, so nothing that is not migrated moves:
 *
 * - `sticky` 10, `header` 20 — page chrome and the task drawer's frame.
 * - `catcher` 30, `popover` 31 — a popover over the page and the
 *   click-away layer under it.
 * - `sheet` 40, `sheetContent` 41 — off-canvas sidebar, My day's drawer.
 * - `panelScrim` 60, `panel` 61 — the details side panel and its scrim.
 * - `nestedScrim` 62, `nested` 63 — a question asked from inside a panel.
 * - `dropdown` 70 — a picker opened from any of the above. **A popover always
 *   outranks whatever it opened from** — that is B16 — and a Dropdown inside a
 *   modal is portaled into the modal, so it rides the modal's own layer.
 * - `dialog` 80 — every modal Dialog and the confirmation. A modal opened
 *   over another modal sits `2 × depth` above it (`overlay.css`), so a
 *   confirmation asked from a dialog is always on top of it.
 * - `toast` 90 — above everything, never blocking it.
 * - `tooltip` 95 — a control's name and shortcut (LAI-1209). Above the dialog
 *   whose controls it describes, however deep that dialog is stacked: a
 *   tooltip under its own dialog is a tooltip nobody sees.
 *
 * ## The motion
 *
 * A box a Dropdown can be portaled into (a Dialog, the side panel) only
 * fades; its rows carry the movement, so the box never becomes the list's
 * containing block mid-entrance (`overlay.css`).
 *
 * Entrances only: the parent unmounts an overlay the moment it closes, so an
 * exit is instant, which is also what hands focus back without a wait. The
 * values are LAI-1208's to absorb — when its motion tokens land, these map
 * onto them and this list shrinks to the overlay-specific distances.
 */
export const LAYER = {
  sticky: 10,
  header: 20,
  catcher: 30,
  popover: 31,
  sheet: 40,
  sheetContent: 41,
  panelScrim: 60,
  panel: 61,
  nestedScrim: 62,
  nested: 63,
  dropdown: 70,
  dialog: 80,
  toast: 90,
  tooltip: 95,
} as const;

export type LayerName = keyof typeof LAYER;

/** The CSS name of a layer: `panelScrim` → `--layer-panel-scrim`. */
export function layerVar(name: LayerName): string {
  return `--layer-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Open motion. Durations sit in the bands the motion review asks of each kind
 * of surface — a menu 120–200ms, a dialog 200–300ms, a sheet a little longer
 * because it travels further — and every curve is a strong ease-out: an
 * entrance starts fast, so the surface answers the click at once.
 */
export const MOTION = {
  /** A modal dialog's card: fade and rise. */
  'overlay-in': '200ms',
  /** The scrim under a modal: fade only, a beat quicker than the card. */
  'overlay-scrim-in': '160ms',
  /** A menu or popover: fade and a small scale from where it opened. */
  'overlay-menu-in': '140ms',
  /** A bottom sheet or the side panel: slide in from its edge. */
  'overlay-sheet-in': '240ms',
  'overlay-ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
  /** The iOS-like drawer curve, for surfaces that travel from an edge. */
  'overlay-ease-sheet': 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** How far a dialog's card rises as it fades in. */
  'overlay-rise': '0.5rem',
  /** Never from nothing: a dialog starts at 98%, a menu at 97%. */
  'overlay-scale': '0.98',
  'overlay-menu-scale': '0.97',
  /** How far the side panel's contents travel in on a desktop. */
  'overlay-slide': '1.5rem',
  /** How far a sheet's contents rise on a phone. */
  'overlay-sheet-rise': '2rem',
} as const;
