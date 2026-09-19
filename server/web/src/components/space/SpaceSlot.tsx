import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const SLOT_ID = 'space-slot';

/**
 * The band between the space bar and WORKING NOW.
 *
 * The design's order is **tabs → sprints → working now → the view**, and the
 * sprint strip belongs to the board while the presence strip belongs to the
 * space — so without a slot here the board's strip could only render *below*
 * presence, which is where it wrongly sat.
 */
export const BAND_SLOT_ID = 'space-band-slot';

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

export interface SpaceBandProps {
  readonly children: ReactNode;
}

/**
 * A full-width band a view contributes above WORKING NOW — the sprint strip is
 * the one the design has.
 *
 * A portal for the same reason `SpaceSlot` is one: the band belongs to the
 * space's layout and its contents belong to the screen that has the data.
 */
export function SpaceBand({ children }: SpaceBandProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById(BAND_SLOT_ID));
  });

  if (host === null) return null;
  return createPortal(children, host);
}

/** Where a view puts its own control in the space bar (LAI-266). */
export const BAR_SLOT_ID = 'space-bar-actions';

/**
 * Portal a view-specific control into the space bar.
 *
 * Distinct from {@link SpaceSlot}, which renders the row *below* the bar and is
 * hidden when empty. Anything permanent belongs here, or that row stops
 * collapsing and the board grows a band the design does not have.
 */
export function SpaceBarSlot({ children }: { readonly children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById(BAR_SLOT_ID));
  }, []);

  if (host === null) return null;
  return createPortal(children, host);
}
