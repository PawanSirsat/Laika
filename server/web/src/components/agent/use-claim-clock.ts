import { useEffect, useReducer } from 'react';
import type { TaskLiveClaim } from '../../api/tasks.ts';
import { startTicker } from '../../api/time-label.ts';
import { suspectAt } from './execution-derive.ts';

/**
 * The reader's clock, for a screen that draws a live claim (LAI-597).
 *
 * **Heartbeats write no activity**, so nothing re-reads a task when its
 * session goes quiet. The card would say *Working* for ever. This re-renders
 * the caller **once, at the moment the claim turns suspect** — its last
 * heartbeat plus `suspect_after_ms` — so *Working* becomes *Connection lost*
 * with no request. A claim already served `suspect`, or none, sets no timer.
 *
 * `everyMs` adds a steady tick while a claim is held, for a *Last seen* that
 * must not say *just now* for ever.
 *
 * Returns `Date.now()` as of this render: what the caller derives from.
 */
export function useClaimClock(claim: TaskLiveClaim | null | undefined, everyMs?: number): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const at = claim === null || claim === undefined ? undefined : suspectAt(claim);
  useEffect(() => {
    if (at === undefined) return undefined;
    const id = setTimeout(tick, Math.max(0, at - Date.now()));
    return () => {
      clearTimeout(id);
    };
  }, [at]);
  const held = claim !== null && claim !== undefined;
  useEffect(
    () => (held && everyMs !== undefined ? startTicker(tick, everyMs) : undefined),
    [held, everyMs],
  );
  return Date.now();
}
