import { useSyncExternalStore } from 'react';

/**
 * Whether the app's keyboard-shortcuts sheet is open, and what to give focus
 * back to (LAI-1221). A module store, as the palette's is: the header's ?
 * button, the `?` key and the palette's *Keyboard shortcuts* all open the one
 * sheet without a provider around the app, and the sheet itself loads lazily.
 */
let open = false;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openShortcuts(from?: Element | null): void {
  if (open) return;
  const target = from ?? (typeof document === 'undefined' ? null : document.activeElement);
  opener =
    typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && target.tagName !== 'BODY'
      ? target
      : null;
  open = true;
  emit();
}

export function closeShortcuts(): void {
  if (!open) return;
  open = false;
  emit();
}

/** What had focus when the sheet opened, if it is still on the page. */
export function shortcutsOpener(): HTMLElement | null {
  return opener?.isConnected === true ? opener : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether it is open, now. */
export function isShortcutsOpen(): boolean {
  return open;
}

export function useShortcutsOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
