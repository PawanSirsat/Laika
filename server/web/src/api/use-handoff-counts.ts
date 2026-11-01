import { useCallback, useEffect, useState } from 'react';
import { listPersonHandoffs, type PersonInboxCounts } from './handoffs.ts';

/** Hand-offs expire in minutes (§4.74); a minute is fresh enough for a badge. */
const REFRESH_MS = 60_000;

export interface HandoffCounts {
  /** Each view's live, unexpired count, or `undefined` — not asked yet, or the read failed. */
  readonly counts: PersonInboxCounts | undefined;
  /** Read again now — after an approve or a withdraw changed the answer. */
  readonly refresh: () => void;
}

/**
 * A person's hand-off counts (`GET /handoff-offers`'s `counts`, LAI-1009), for
 * the sidebar's Inbox badge and the Hand-offs tab (LAI-550).
 *
 * **Called once, by the shell**, as the review and unlisted counts are. The
 * counts are the server's, live and unexpired only, so an offer that expired,
 * was declined, withdrawn or accepted is never counted. One row is asked for:
 * every view's count comes with any page. Skipped while the page is hidden. A
 * failed read keeps the last counts — `0` would claim nothing waits.
 */
export function useHandoffCounts(enabled: boolean): HandoffCounts {
  const [counts, setCounts] = useState<PersonInboxCounts | undefined>(undefined);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCounts(undefined);
      return;
    }
    const controller = new AbortController();
    const read = (): void => {
      listPersonHandoffs({ view: 'received', limit: 1 }, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted) setCounts(page.counts);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, asked]);

  const refresh = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  return { counts, refresh };
}
