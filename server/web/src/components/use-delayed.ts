import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Nothing shows before this. Under it, the work was never worth announcing. */
export const SHOW_AFTER_MS = 150;
/** Once shown, it stays at least this long, so it is read rather than glimpsed. */
export const HOLD_FOR_MS = 300;

/**
 * Whether a loading indicator should be on screen (LAI-293).
 *
 * **A skeleton that appears for 80ms and vanishes is worse than no skeleton** —
 * it reads as a flicker, and the screen looks broken rather than fast. Against
 * a local instance most calls return under 50ms, so every navigation would
 * blink.
 *
 * Two rules, and both are needed:
 *
 * - **Delay.** Work that finishes inside {@link SHOW_AFTER_MS} shows nothing at
 *   all. The fast path stays perfectly still.
 * - **Hold.** Once shown it stays for {@link HOLD_FOR_MS}, so a response
 *   arriving at 160ms does not produce a 10ms flash — which is the same defect
 *   the delay exists to prevent, moved ten milliseconds later.
 *
 * One hook rather than a convention, so *"do not flash"* is a property of the
 * app instead of something each caller has to remember.
 */
export function useDelayed(
  active: boolean,
  options: { readonly delay?: number; readonly hold?: number } = {},
): boolean {
  const { delay = SHOW_AFTER_MS, hold = HOLD_FOR_MS } = options;
  const [shown, setShown] = useState(false);
  /** When it went on screen, so the hold is measured from that, not from now. */
  const shownAt = useRef<number | null>(null);
  /**
   * `active` as of the last **commit**, which is what is on screen.
   *
   * **The timer must not show it over work that has already been drawn**
   * (LAI-727 CI). The timer is cleared by the effect below, and a `useEffect`
   * cleanup runs *after paint* — so a timer falling due between the commit
   * that drew the answer and that cleanup set `shown` anyway, and the skeleton
   * replaced the drawn List for its whole hold. Caught on GitHub's runner as a
   * List that rendered and then had no table. A layout effect runs in the
   * commit itself, before paint, so no timer can fall between the two.
   */
  const activeNow = useRef(active);
  useLayoutEffect(() => {
    activeNow.current = active;
  }, [active]);
  /*
   * **Stamped when it is committed, not when the timer fires** (LAI-715). On a
   * busy main thread the render after `setShown(true)` came tens of
   * milliseconds after the timer, and the hold, counted from the timer, ended
   * that much early on screen: measured on CI at 263ms of a 300ms hold.
   */
  useLayoutEffect(() => {
    if (shown && shownAt.current === null) shownAt.current = Date.now();
  }, [shown]);

  useEffect(() => {
    if (active) {
      if (shown) return;
      const timer = setTimeout(() => {
        if (!activeNow.current) return;
        setShown(true);
      }, delay);
      return () => {
        clearTimeout(timer);
      };
    }

    // Not active any more. Nothing on screen means nothing to hold.
    if (!shown) return;

    const elapsed = shownAt.current === null ? hold : Date.now() - shownAt.current;
    const remaining = Math.max(0, hold - elapsed);
    if (remaining === 0) {
      shownAt.current = null;
      setShown(false);
      return;
    }

    const timer = setTimeout(() => {
      shownAt.current = null;
      setShown(false);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [active, shown, delay, hold]);

  return shown;
}
