import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const SLOT_ID = 'space-slot';

export interface SpaceSlotProps {
  /** A derived line about what this view is showing. Never a fixture. */
  readonly context?: ReactNode;
  /** The view's own controls, if it has any. */
  readonly children?: ReactNode;
}

/**
 * A view's own context line and controls, rendered up in the space bar
 * (LAI-251).
 *
 * The design has **one** bar per space, so a screen cannot draw its own header
 * — that is the double chrome this task exists to remove. But the lines those
 * headers carried are real derived data ("3 sprints · Jan–Mar", "5 people ·
 * updated every 30s"), and deleting them to match a mockup that never had
 * per-view context would lose information the mockup had no way to show.
 *
 * **A portal rather than a callback.** Passing a node up through state means an
 * effect per render and a dependency on node identity; a portal re-renders with
 * its owner and needs neither.
 *
 * Renders nothing when there is no slot — a space screen reached without the
 * space layout (a direct `/capacity` with no project) simply has nowhere to put
 * it, which is correct rather than an error.
 */
export function SpaceSlot({ context, children }: SpaceSlotProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // After mount, so the slot exists: the layout renders it in the same pass.
  useEffect(() => {
    setHost(document.getElementById(SLOT_ID));
  }, []);

  if (host === null) return null;

  return createPortal(
    <>
      {context !== undefined && <p className="space-context">{context}</p>}
      {children !== undefined && <div className="space-slot-actions">{children}</div>}
    </>,
    host,
  );
}
