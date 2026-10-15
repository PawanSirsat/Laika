import { useCallback, useEffect, useState } from 'react';
import { everyPage } from './every-page.ts';
import { listUnlisted, openUnlistedCount } from './unlisted.ts';

/** Agents log notes while you browse; a minute is fresh enough for a badge. */
const REFRESH_MS = 60_000;

export interface UnlistedCount {
  /** Notes still waiting, or `undefined` — not allowed, not asked yet, or the read failed. */
  readonly open: number | undefined;
  /** Read again now — after a promote or a dismiss changed the answer. */
  readonly refresh: () => void;
}

/**
 * The open unlisted-work count, for the sidebar's badge and Capacity's link
 * (LAI-754).
 *
 * **Called once, by the shell**, so the rail and the Capacity screen show one
 * number from one request. Only for a reader who may triage the queue: the
 * endpoint answers `403` to everyone else, and asking anyway would be a
 * refusal on every page load.
 *
 * A failed read keeps the last count rather than showing zero: no badge, or an
 * old one, is honest; `0` would claim the queue is empty.
 */
export function useUnlistedCount(enabled: boolean): UnlistedCount {
  const [open, setOpen] = useState<number | undefined>(undefined);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setOpen(undefined);
      return;
    }
    const controller = new AbortController();
    const read = (): void => {
      everyPage((cursor) => listUnlisted({ cursor, limit: 200 }, controller.signal))
        .then(({ items }) => {
          if (!controller.signal.aborted) setOpen(openUnlistedCount(items));
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

  return { open, refresh };
}
