import { useCallback, useEffect, useState } from 'react';
import { getReviewQueue } from './review.ts';

/** A minute is fresh enough for a badge; the Review page itself reads sooner. */
const REFRESH_MS = 60_000;

export interface ReviewCount {
  /** Tasks waiting for a person, or `undefined` — not asked yet, or the read failed. */
  readonly waiting: number | undefined;
  /** Read again now — after an accept or a send-back changed the answer. */
  readonly refresh: () => void;
}

/**
 * The review queue's count, for the sidebar's badge (D-082, LAI-758).
 *
 * **Called once, by the shell**, as `useUnlistedCount` is. Every signed-in
 * person has a queue — it lists review work on the projects they can act on —
 * so it is asked for anyone signed in. A failed read keeps the last count:
 * `0` would claim nothing is waiting.
 */
export function useReviewCount(enabled: boolean): ReviewCount {
  const [waiting, setWaiting] = useState<number | undefined>(undefined);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setWaiting(undefined);
      return;
    }
    const controller = new AbortController();
    const read = (): void => {
      getReviewQueue(controller.signal)
        .then((queue) => {
          if (!controller.signal.aborted) setWaiting(queue.tasks.length);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, asked]);

  const refresh = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  return { waiting, refresh };
}
