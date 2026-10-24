import { useEffect, useRef, type ReactNode } from 'react';

/** What the drawer holds: the editor for what is in hand, or the two side cards. */
export type DrawerMode = 'editor' | 'cards';

/**
 * Below this the drawer is the design's bottom sheet — the same width at which
 * the shell's sidebar is off-canvas (`app-shell.css`), so a phone never has a
 * side column and a desktop never has a sheet.
 */
export const SHEET_QUERY = '(max-width: 900px)';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The drawer beside the page (the owner's `MyDay.dc.html`, LAI-511): a 400px
 * column the height of the window with its own scroll and a rule at its left
 * on a desktop; the design's bottom sheet — a handle, a scrim, 86% of the
 * height at most — on a phone. It is on the page only while something is in
 * it: the editor for a block, a gap, a stretch, a tray item or Add time, or
 * Agent time and On your plate from the header's button. `Escape` is the
 * page's (`shortcuts.ts`); the scrim and the × are here.
 *
 * On a phone the sheet is modal: focus moves into it, Tab cycles inside it,
 * and closing hands focus back to where it was.
 */
export function MyDayDrawer({
  mode,
  label,
  onClose,
  children,
}: {
  readonly mode: DrawerMode;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !window.matchMedia(SHEET_QUERY).matches) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === el)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      previous?.focus({ preventScroll: true });
    };
  }, [mode]);

  return (
    <>
      <div className="myday-scrim" aria-hidden="true" data-myday-scrim onClick={onClose} />
      <aside
        ref={ref}
        className="myday-drawer"
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        data-myday-drawer
        data-drawer={mode}
      >
        <div className="myday-drawer-grab" aria-hidden="true">
          <span />
        </div>
        <div className="myday-drawer-body">{children}</div>
      </aside>
    </>
  );
}
