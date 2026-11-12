import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useDialogFocus, type DialogFocus } from '../use-dialog-focus.ts';

/**
 * Which overlays are open, in the order they opened (LAI-1205).
 *
 * The audit found Escape closing the wrong thing: a menu's Escape shutting the
 * panel it sat in, a confirmation's shutting the dialog behind it, because
 * every overlay listened for Escape on its own and none knew what else was
 * open. This is the one list they all read. **Escape belongs to the top
 * entry**; everything under it lets the key pass.
 *
 * - `modal` — a Dialog or confirmation: blocks the page, locks its scroll.
 * - `panel` — the side panel: modal too, at the panel layer.
 * - `popover` / `menu` — non-modal: on the stack only so that the modal they
 *   opened from knows it is not on top. They neither lock scroll nor block.
 */
export type LayerKind = 'modal' | 'panel' | 'popover' | 'menu';

interface Layer {
  readonly id: number;
  readonly kind: LayerKind;
}

const layers: Layer[] = [];
let nextId = 1;

/** On `<html>` while a modal or panel is open: the page behind does not scroll. */
export const SCROLL_LOCK_CLASS = 'overlay-scroll-locked';
/**
 * Beside it, only when the page had a scrollbar to lose: keeps the gutter so
 * the page does not shift sideways when its scrollbar goes (`overlay.css`).
 */
export const SCROLL_GUTTER_CLASS = 'overlay-scroll-gutter';

function blocks(kind: LayerKind): boolean {
  return kind === 'modal' || kind === 'panel';
}

/** Whether a stack holding these kinds locks the page's scroll. */
export function locksScroll(kinds: readonly LayerKind[]): boolean {
  return kinds.some(blocks);
}

/** The open layers' kinds, bottom first. */
export function openLayers(): readonly LayerKind[] {
  return layers.map((layer) => layer.kind);
}

/**
 * How many modal layers are open now. A modal reads it as it opens, and sits
 * that many steps above the layer's base (`--overlay-depth`), so a
 * confirmation asked from a dialog is drawn over it whatever their CSS says.
 */
export function modalDepth(): number {
  return layers.filter((layer) => blocks(layer.kind)).length;
}

/**
 * The scroll lock is a class, not a style the script writes: under the CSP
 * (`style-src-elem 'self'`) a library that injects a `<style>` for this — Radix
 * Dialog does — is refused, silently, and the page scrolls anyway.
 */
function syncScrollLock(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const lock = locksScroll(openLayers());
  if (lock && !html.classList.contains(SCROLL_LOCK_CLASS)) {
    html.classList.toggle(SCROLL_GUTTER_CLASS, html.scrollHeight > html.clientHeight);
  }
  if (!lock) html.classList.remove(SCROLL_GUTTER_CLASS);
  html.classList.toggle(SCROLL_LOCK_CLASS, lock);
}

/** Open a layer on top; returns its id for {@link removeLayer}. */
export function pushLayer(kind: LayerKind): number {
  const id = nextId++;
  layers.push({ id, kind });
  syncScrollLock();
  return id;
}

/** Close a layer, wherever it is — an overlay under the top can unmount first. */
export function removeLayer(id: number): void {
  const at = layers.findIndex((layer) => layer.id === id);
  if (at !== -1) layers.splice(at, 1);
  syncScrollLock();
}

export function isTopLayer(id: number): boolean {
  return layers.at(-1)?.id === id;
}

export interface Layered {
  /** True while this overlay is the top of the stack: Escape is its to use. */
  readonly isTop: () => boolean;
  /** Modal layers already open beneath this one when it opened. */
  readonly depth: number;
}

/**
 * Put an overlay on the stack while it is open (`active`). Registered in a
 * layout effect, so it is on the stack before the browser paints it and
 * before any key can reach it.
 */
export function useLayer(kind: LayerKind, active = true): Layered {
  const id = useRef<number | undefined>(undefined);
  // Read once, as it opens: the modals that were there before it.
  const [depth] = useState(modalDepth);
  useLayoutEffect(() => {
    if (!active) return;
    const mine = pushLayer(kind);
    id.current = mine;
    return () => {
      removeLayer(mine);
      id.current = undefined;
    };
  }, [kind, active]);
  const isTop = useCallback(() => id.current !== undefined && isTopLayer(id.current), []);
  return { isTop, depth };
}

export interface ModalLayerOptions extends DialogFocus {
  /** `panel` for the side panel; every other modal is `modal`. */
  readonly kind?: 'modal' | 'panel';
  /**
   * What Escape does when this is the top layer. Absent — a dialog busy
   * saving — Escape is still spent here, so it never falls through to the
   * page behind, and nothing closes.
   */
  readonly onEscape?: (() => void) | undefined;
}

export interface ModalLayer {
  readonly depth: number;
  /** For the modal's own element: Escape, for the top layer only. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The whole contract a modal keeps (LAI-1205): on the stack, focus in on open,
 * held in, back on close (`useDialogFocus`), and Escape closing **only the top
 * layer**:
 *
 * 1. A control inside that used Escape itself — an open Dropdown, an editor
 *    discarding its draft — said so with `preventDefault`; that Escape is not
 *    this modal's.
 * 2. A key that came from outside the box reached it only through a React
 *    portal — a dialog opened from inside it that is not on the stack — and
 *    is that dialog's.
 * 3. A popover or menu opened above it is the top layer; the key passes on to
 *    whatever closes that.
 *
 * Otherwise the Escape is spent here — `preventDefault` and stopped, so a
 * window listener behind (the task drawer's) does not also close.
 */
export function useModalLayer(
  ref: RefObject<HTMLElement | null>,
  options: ModalLayerOptions,
): ModalLayer {
  const { isTop, depth } = useLayer(options.kind ?? 'modal');
  useDialogFocus(ref, options);
  const latest = useRef(options);
  latest.current = options;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!(event.target instanceof Node) || ref.current?.contains(event.target) !== true) return;
      if (!isTop()) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onEscape?.();
    },
    [isTop, ref],
  );

  return { depth, onKeyDown };
}

/**
 * A non-modal popover that closes on Escape (LAI-1205): on the stack while
 * `active`, and an Escape anywhere on the page closes it — unless something
 * already spent the key (`preventDefault`) or another layer is above it.
 * For a popover that has no Escape of its own; one that does keeps it and
 * guards it with `useLayer(...).isTop()`.
 */
export function usePopoverLayer(active: boolean, onEscape: () => void): Layered {
  const layer = useLayer('popover', active);
  const latest = useRef(onEscape);
  latest.current = onEscape;
  const { isTop } = layer;
  useLayoutEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTop()) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [active, isTop]);
  return layer;
}
