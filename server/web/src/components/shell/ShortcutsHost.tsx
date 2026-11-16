import { lazy, Suspense, useEffect } from 'react';
import { helpKeyOpensSheet } from './nav-shortcuts.ts';
import { openShortcuts, useShortcutsOpen } from './shortcuts-store.ts';

/** The sheet loads on first open (LAI-1219's budget): the shell carries this host and the store. */
const ShortcutsSheet = lazy(async () => {
  const module = await import('./ShortcutsSheet.tsx');
  return { default: module.ShortcutsSheet };
});

/**
 * Where the app's keyboard-shortcuts sheet mounts, and the `?` key that opens
 * it (LAI-1221). Rendered once by the shell for a signed-in session, beside
 * the palette's host.
 *
 * `?` is left to a screen that has a sheet of its own — My day marks its help
 * button `aria-keyshortcuts="?"` (`helpKeyOpensSheet`) — and never fires while
 * typing or over a modal. The header's ? button opens this sheet everywhere.
 */
export function ShortcutsHost() {
  const open = useShortcutsOpen();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!helpKeyOpensSheet({ ...pick(event), target }, document)) return;
      event.preventDefault();
      openShortcuts();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ShortcutsSheet />
    </Suspense>
  );
}

function pick(event: KeyboardEvent) {
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    defaultPrevented: event.defaultPrevented,
  };
}
