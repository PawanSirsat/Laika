import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './drawer.css';

export const DRAWER_SLOT_ID = 'task-drawer-slot';

export interface TaskDrawerProps {
  /** The task shown, so closing can find its card when the opener has gone. */
  readonly taskId: string;
  readonly onClose: () => void;
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
 */
export function TaskDrawer({ taskId, onClose }: TaskDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The task shown at close, not at open: a related-task link swaps it in place.
  const shown = useRef(taskId);
  shown.current = taskId;

  // Whatever held focus as the drawer opened is what opened it. Kept once, so
  // StrictMode's second run of the effect does not record the panel instead.
  const opener = useRef<Element | null | undefined>(undefined);

  useEffect(() => {
    opener.current ??= document.activeElement;
    // Focus the panel so a keyboard reader is inside the thing that just
    // opened, rather than left where the card was.
    panelRef.current?.focus();
    return () => {
      // After the drawer has left the DOM. Only when focus went with it: a
      // reader who closed it by clicking a sidebar link keeps that link.
      queueMicrotask(() => {
        const now = document.activeElement;
        if (now !== null && now !== document.body && now.isConnected) return;
        drawerReturnTarget(opener.current ?? null, shown.current)?.focus();
      });
    };
  }, []);

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
      <div className="drawer" tabIndex={-1} ref={panelRef}>
        {/* Where the view puts the task. The chrome knows the geometry; the
            screen knows the task — see `TaskDrawerContent`. */}
        <div id={DRAWER_SLOT_ID} className="drawer-slot" />
      </div>
    </>
  );
}

export interface TaskDrawerContentProps {
  readonly children: ReactNode;
}

/**
 * A view's task detail, rendered into the drawer the space layout opened.
 *
 * A portal for the same reason `SpaceSlot` is one: the chrome belongs to the
 * space and the content belongs to the screen that has the data, and passing a
 * node upward through state would mean an effect per render.
 *
 * Renders nothing when there is no drawer — a screen asked for a task the
 * layout is not showing has nowhere to put it, which is correct rather than an
 * error.
 */
export function TaskDrawerContent({ children }: TaskDrawerContentProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById(DRAWER_SLOT_ID));
  });

  if (host === null) return null;
  return createPortal(children, host);
}
