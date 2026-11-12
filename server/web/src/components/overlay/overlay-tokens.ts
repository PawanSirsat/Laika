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
 * **One ladder** (merge train, with LAI-1132): `sticky`, `header`, `panel`,
 * `popover`, `dialog` and `toast` are `theme.css`'s and declared there; the
 * rest are this module's and declared in `overlay.css`, placed on that ladder.
 *
 * - `sticky` 5, `header` 10 — page chrome and the task drawer's frame.
 * - `sheet` 40, `sheetContent` 41 — off-canvas sidebar, My day's drawer.
 * - `panelScrim` 59, `panel` 60 — the details side panel and its scrim.
 * - `nestedScrim` 62, `nested` 63 — a question asked from inside a panel.
 * - `catcher` 64, `popover` 65 — a popover and the click-away layer under it.
 *   (The board's own popovers keep their local 30/31, as `theme.css` says.)
 * - `dropdown` 70 — a picker opened from any of the above (`--layer-menu`).
 *   **A popover always outranks whatever it opened from** — that is B16 — and
 *   a Dropdown inside a modal is portaled into the modal, so it rides the
 *   modal's own layer.
 * - `dialog` 80 — every modal Dialog and the confirmation. A modal opened
 *   over another modal sits `2 × depth` above it (`overlay.css`), so a
 *   confirmation asked from a dialog is always on top of it.
 * - `toast` 90 — above every surface, never blocking it.
 * - `tooltip` 95 — above the dialog and the toast (LAI-1209): a tooltip on a
 *   dialog's control drew under the dialog at 75.
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
  // theme.css's ladder (LAI-1132): declared there, mirrored here.
  sticky: 5,
  header: 10,
  panel: 60,
  popover: 65,
  dialog: 80,
  toast: 90,
  // Above the dialog (LAI-1209): a tooltip on a dialog's control must draw over it.
  tooltip: 95,
  // The overlays' own (LAI-1205), declared in overlay.css, placed on that ladder.
  catcher: 64,
  sheet: 40,
  sheetContent: 41,
  panelScrim: 59,
  nestedScrim: 62,
  nested: 63,
  dropdown: 70,
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
  'overlay-in': 'var(--duration-base)',
  'overlay-scrim-in': 'var(--duration-base)',
  'overlay-menu-in': 'var(--duration-fast)',
  'overlay-sheet-in': 'var(--duration-slow)',
  'overlay-ease-out': 'var(--ease-enter)',
  'overlay-ease-sheet': 'var(--ease-drawer)',
  'overlay-rise': '0.5rem',
  'overlay-scale': '0.98',
  'overlay-menu-scale': '0.97',
  'overlay-slide': '1.5rem',
  'overlay-sheet-rise': '2rem',
} as const;
