import { useEffect, useReducer } from 'react';
import type { TaskLiveClaim } from '../../api/tasks.ts';
import { startTicker } from '../../api/time-label.ts';
import { msUntilSuspect, pageClock } from './execution-derive.ts';

/**
 * The page's clock, for a screen that draws a live claim (LAI-597).
 *
 * **Heartbeats write no activity**, so nothing re-reads a task when its
 * session goes quiet. The card would say *Working* for ever. This re-renders
 * the caller **once, when the claim turns suspect** — `suspect_after_ms` less
 * its age, the server's age of the heartbeat plus what has elapsed on this
 * page ({@link msUntilSuspect}) — so *Working* becomes *Connection lost* with
 * no request. **Never the wall clock**: a browser whose clock is wrong turns
 * at the same moment as one whose clock is right (LAI-597 review). A claim
 * already served `suspect`, or none, sets no timer.
 *
 * `everyMs` adds a steady tick while a claim is held, for a *Last seen* that
 * must not say *just now* for ever.
 *
 * Returns {@link pageClock} as of this render: what the caller derives from.
 */
export function useClaimClock(claim: TaskLiveClaim | null | undefined, everyMs?: number): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const now = pageClock();
  const held = claim !== null && claim !== undefined;
  const left = held ? msUntilSuspect(claim, now) : undefined;
  useEffect(() => {
    if (left === undefined) return undefined;
    const id = setTimeout(tick, left);
    return () => {
      clearTimeout(id);
    };
    // Re-armed with what is left on each render; once it has passed, `left`
    // stays 0 and the effect does not run again.
  }, [left]);
  useEffect(
    () => (held && everyMs !== undefined ? startTicker(tick, everyMs) : undefined),
    [held, everyMs],
  );
  return now;
}
