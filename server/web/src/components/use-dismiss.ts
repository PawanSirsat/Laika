import { useEffect, useRef } from 'react';
import { isInDropdownPanel } from './dropdown-model.ts';
import { useLayer } from './overlay/layer-stack.ts';

/** Why a popover closed: Escape, or a press somewhere outside it. */
export type DismissReason = 'escape' | 'outside';

/**
 * A popover that closes on Escape and on a press outside it (LAI-290, moved
 * here from `BoardToolbar` for the task panel's overflow menu, LAI-1190).
 *
 * Returns the ref for the box that counts as *inside*: the popover **and** the
 * button that opened it, so a click on the button toggles rather than closing
 * and re-opening.
 *
 * **An Escape this spends is marked spent** (`preventDefault`). Layers listen
 * for Escape on the document and the window, and the task drawer ignores an
 * Escape something inside already used (`TaskDrawer`, LAI-827). Without the
 * mark, Escape in the overflow menu closed the menu and the whole drawer with
 * it (B22). An Escape a dropdown already spent is not this one's either.
 *
 * **On the overlay stack while open** (LAI-1205): Escape is this popover's only
 * while nothing — a confirmation, a dialog — is open above it.
 */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  close: (reason: DismissReason) => void,
) {
  const box = useRef<T | null>(null);
  const latest = useRef(close);
  latest.current = close;
  const { isTop } = useLayer('popover', open);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      /*
       * **A dropdown's panel is not outside** (LAI-726). It is portalled to
       * `<body>`, so it is never inside `box` — without this, choosing an
       * option in the Filter popover would close the popover.
       */
      if (isInDropdownPanel(event.target)) return;
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        latest.current('outside');
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTop()) return;
      event.preventDefault();
      latest.current('escape');
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, isTop]);

  return box;
}
