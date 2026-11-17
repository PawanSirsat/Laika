import { useEffect, useRef, type ReactNode } from 'react';
import { useDialogFocus } from '../use-dialog-focus.ts';
import './drawer.css';

export interface TaskDrawerProps {
  /**
   * The task shown, so closing can find its card when the opener has gone.
   * Empty for the new-task form, which has no card.
   */
  readonly taskId: string;
  readonly onClose: () => void;
  /**
   * The ids of what names the dialog — the task's key and title (LAI-1190,
   * B3). The content draws them; the frame only points at them.
   */
  readonly labelledBy: string;
  /** What the drawer shows: the task panel, its loading state, or the form. */
  readonly children: ReactNode;
}

/**
 * Where focus goes when the drawer closes (LAI-1021). The opener first — the
 * card's or the row's "open details" button — if it is still on the page; else
 * the shown task's own open control, if its card or row is on screen; else the
 * screen's `<main>`. Never `<body>`, which sent a keyboard reader back to the
 * top of the document to Tab through the sidebar and every lane.
 */
export function drawerReturnTarget(
  opener: Element | null,
  taskId: string,
  doc: Document = document,
): HTMLElement | null {
  if (opener instanceof HTMLElement && opener !== doc.body && opener.isConnected) return opener;
  const row = `[data-task-id="${CSS.escape(taskId)}"]`;
  return (
    doc.querySelector<HTMLElement>(`${row} .card-open, ${row} .list-open`) ??
    doc.querySelector<HTMLElement>('#main')
  );
}

/**
 * The task drawer's chrome (prototype lines 360–367; LAI-252).
 *
 * A drawer **over** the view, not instead of it: the board stays mounted
 * underneath with its scroll position and its data, which is the whole point of
 * the design's shape. `width: min(840px, 100%)`, a dimmed scrim you can click
 * away, and a 200ms slide.
 *
 * **The scrim covers the content pane, not the sidebar.** The prototype's does
 * the same (its overlay is `position: absolute; inset: 0` inside the content
 * column), and it means you can switch space with a task open rather than
 * having to dismiss it first.
 *
 * The chrome owns dismissal — Escape and the scrim — and the content owns its
 * own `×`, because the design draws that button inside the header beside the
 * task key. Both do the same thing: strip `?task=`.
 *
 * **A modal dialog, and the frame is the dialog** (LAI-1190, B3/B22): `role`,
 * `aria-modal` and the label are here, and Tab is held inside by the app's one
 * trap (`useDialogFocus`). The panel inside used to declare itself the dialog
 * with no trap, so Tab walked out of a "modal" into the board behind it.
 */
/** A swipe down the phone sheet's handle longer than this closes it (LAI-1122). */
const SWIPE_CLOSE_PX = 60;

export function TaskDrawer({ taskId, onClose, labelledBy, children }: TaskDrawerProps) {
  const dragFrom = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The task shown at close, not at open: a related-task link swaps it in place.
  const shown = useRef(taskId);
  shown.current = taskId;

  // Whatever held focus as the drawer opened is what opened it. Kept once, so
  // StrictMode's second run of the effect does not record the panel instead.
  const opener = useRef<Element | null | undefined>(undefined);

  useDialogFocus(panelRef, {
    // Focus the panel so a keyboard reader is inside the thing that just
    // opened, rather than left where the card was.
    initial: () => {
      opener.current ??= document.activeElement;
      return panelRef.current;
    },
    // After the drawer has left the DOM. Only when focus went with it: a
    // reader who closed it by clicking a sidebar link keeps that link.
    restore: () => {
      const now = document.activeElement;
      if (now !== null && now !== document.body && now.isConnected) return undefined;
      return drawerReturnTarget(opener.current ?? null, shown.current);
    },
  });

  useEffect(() => {
    /*
     * **An Escape something inside already spent is not ours** (LAI-827). The
     * task editor and the title field both cancel on Escape and say so with
     * `preventDefault`; closing the whole panel as well threw the reader out of
     * a task they only meant to stop editing.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panelRef}
      >
        {/*
          The phone sheet's handle (LAI-1122): drawn only below 600px. A tap
          closes the sheet, and so does a downward swipe of more than 60px.
          Escape, the scrim and Back close it as everywhere else.
        */}
        <button
          type="button"
          className="drawer-handle"
          aria-label="Close the task"
          onPointerDown={(event) => {
            dragFrom.current = event.clientY;
          }}
          onPointerUp={(event) => {
            const from = dragFrom.current;
            dragFrom.current = null;
            if (from !== null && event.clientY - from > SWIPE_CLOSE_PX) onClose();
          }}
          onClick={onClose}
        >
          <span className="drawer-handle-bar" aria-hidden="true" />
        </button>
        <div className="drawer-slot">{children}</div>
      </div>
    </>
  );
}
