import { useCallback, useEffect, useState } from 'react';
import { decidableCount, getReviewQueue, type ReviewQueueItem } from './review.ts';

/** A minute is fresh enough for a badge; the Review page itself reads sooner. */
const REFRESH_MS = 60_000;

export interface ReviewCount {
  /** Tasks waiting for a person, or `undefined` — not asked yet, or the read failed. */
  readonly waiting: number | undefined;
  /**
   * Of those, the ones this reader may accept or send back (`can_decide`,
   * D-146): what the Inbox badge and the Review tab count. `waiting` stays
   * for Capacity's tile, which is about the whole queue. `undefined` until
   * read.
   */
  readonly decidable: number | undefined;
  /**
   * The server stopped at its 200 and more wait (`truncated`, §6.4), so
   * `waiting` is a floor: a count shown from it says "200+" (LAI-818, D-092
   * item 5). `undefined` until read.
   */
  readonly capped: boolean | undefined;
  /**
   * The queue the count was read from (LAI-796): My day's *Waiting on your
   * review* lists it, so that page asks for nothing the badge has not already
   * fetched. `undefined` until read.
   */
  readonly queue: readonly ReviewQueueItem[] | undefined;
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
  const [queue, setQueue] = useState<readonly ReviewQueueItem[] | undefined>(undefined);
  const [capped, setCapped] = useState<boolean | undefined>(undefined);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setQueue(undefined);
      setCapped(undefined);
      return;
    }
    const controller = new AbortController();
    const read = (): void => {
      getReviewQueue(controller.signal)
        .then((queue) => {
          if (controller.signal.aborted) return;
          setQueue(queue.tasks);
          setCapped(queue.truncated);
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

  return {
    waiting: queue?.length,
    decidable: queue === undefined ? undefined : decidableCount(queue),
    capped,
    queue,
    refresh,
  };
}
