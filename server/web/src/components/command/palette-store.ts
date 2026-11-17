import { useSyncExternalStore } from 'react';

/**
 * Whether the command palette is open, and what had the focus when it opened
 * (LAI-1192).
 *
 * **A module store, not a context**, so a trigger anywhere (the sidebar, the
 * phone's header) opens it without a provider wrapped around the app, and so
 * the small shell-side half never imports the lazy palette chunk.
 */
let open = false;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the palette, remembering `from` (or the focused element) to return to. */
export function openPalette(from?: Element | null): void {
  if (open) return;
  const target = from ?? (typeof document === 'undefined' ? null : document.activeElement);
  opener = isFocusable(target) ? target : null;
  open = true;
  emit();
}

/** Close it. Focus goes back through {@link paletteOpener}. */
export function closePalette(): void {
  if (!open) return;
  open = false;
  emit();
}

/** Open it if closed, close it if open — what a second ⌘K does. */
export function togglePalette(from?: Element | null): void {
  if (open) closePalette();
  else openPalette(from);
}

export function isPaletteOpen(): boolean {
  return open;
}

/** What had the focus when the palette opened, if it can take it back. */
export function paletteOpener(): HTMLElement | null {
  return opener;
}

export function subscribePalette(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open state, kept live. */
export function usePaletteOpen(): boolean {
  return useSyncExternalStore(subscribePalette, isPaletteOpen, () => false);
}

/** Something `focus()` can be called on; `body` is not worth returning to. */
function isFocusable(target: Element | null | undefined): target is HTMLElement {
  if (target === null || target === undefined) return false;
  if (typeof (target as { focus?: unknown }).focus !== 'function') return false;
  return target.tagName !== 'BODY';
}
