import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './drawer.css';

export const DRAWER_SLOT_ID = 'task-drawer-slot';

export interface TaskDrawerProps {
  readonly onClose: () => void;
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
export function TaskDrawer({ onClose }: TaskDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the panel so a keyboard reader is inside the thing that just
    // opened, rather than left where the card was.
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
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
