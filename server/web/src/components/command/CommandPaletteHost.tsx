import { lazy, Suspense, useEffect } from 'react';
import { typingIn } from '../typing-in.ts';
import { isPaletteShortcut } from './palette-model.ts';
import { closePalette, isPaletteOpen, openPalette, usePaletteOpen } from './palette-store.ts';
// The layer's styles ship with the shell, so the loading frame is styled too.
import './command-palette.css';

/**
 * The palette itself, and cmdk with it, load on first open (LAI-1192): the
 * main bundle carries this host, the trigger and the store, and nothing of
 * the library.
 */
const CommandPalette = lazy(async () => {
  const module = await import('./CommandPalette.tsx');
  return { default: module.CommandPalette };
});

/**
 * The one global shortcut, ⌘K / Ctrl+K, and where the palette mounts.
 * Rendered once by the shell for a signed-in session.
 *
 * The key is ignored while somebody is typing in a field or an editor; the
 * palette's own input is the exception, where a second ⌘K closes it.
 */
export function CommandPaletteHost() {
  const open = usePaletteOpen();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isPaletteShortcut(event)) return;
      if (isPaletteOpen()) {
        event.preventDefault();
        closePalette();
        return;
      }
      // The shared rule every single-key shortcut uses (`typing-in.ts`).
      if (typingIn(event.target instanceof Element ? event.target : null)) return;
      event.preventDefault();
      openPalette();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;
  return (
    <Suspense
      fallback={
        <div className="cmdk-layer" data-palette-loading>
          <div className="cmdk-scrim" aria-hidden="true" />
          <p className="cmdk-panel cmdk-panel-loading" role="status">
            Opening the command palette…
          </p>
        </div>
      }
    >
      <CommandPalette />
    </Suspense>
  );
}
