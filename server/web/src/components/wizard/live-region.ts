import { useEffect, useMemo, useState } from 'react';

/**
 * A throttled `aria-live` announcer (LAI-1048, plan §A3).
 *
 * Developer access V3 has screens whose state moves by itself — a journey
 * that advances when a tool first reaches the board, later a verification
 * checklist that polls. Writing every change into a live region makes a
 * screen reader talk over itself, so this speaks **at most once per
 * `minGapMs`**, and a message that arrives inside the gap replaces any other
 * still waiting: the reader hears the newest state, never a backlog.
 *
 * The same message twice in a row is said once — a poll that answers the
 * same thing is not news.
 *
 * The clock and the timer are passed in, so `node --test` can drive it.
 */
export interface Announcer {
  /** Ask for `message` to be said; it may wait, or be replaced by a newer one. */
  readonly announce: (message: string) => void;
  /** Drop anything still waiting. Call on unmount. */
  readonly dispose: () => void;
}

export interface AnnouncerClock {
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

const REAL_CLOCK: AnnouncerClock = {
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** The default gap: long enough that a polite region finishes a short sentence. */
export const LIVE_REGION_GAP_MS = 2_000;

export function createAnnouncer(
  speak: (message: string) => void,
  minGapMs: number = LIVE_REGION_GAP_MS,
  clock: AnnouncerClock = REAL_CLOCK,
): Announcer {
  let lastAt: number | undefined;
  let lastSaid: string | undefined;
  let waiting: string | undefined;
  let timer: unknown;

  const say = (message: string): void => {
    lastAt = clock.now();
    if (message === lastSaid) return;
    lastSaid = message;
    speak(message);
  };

  const flush = (): void => {
    timer = undefined;
    const next = waiting;
    waiting = undefined;
    if (next !== undefined) say(next);
  };

  return {
    announce(message) {
      const since = lastAt === undefined ? Infinity : clock.now() - lastAt;
      if (timer === undefined && since >= minGapMs) {
        say(message);
        return;
      }
      waiting = message;
      timer ??= clock.setTimer(flush, Math.max(0, minGapMs - since));
    },
    dispose() {
      if (timer !== undefined) clock.clearTimer(timer);
      timer = undefined;
      waiting = undefined;
    },
  };
}

/**
 * The hook form: `[message, announce]`. Render `message` inside a polite live
 * region — `<LiveRegion message={message} />` — that is **in the page before
 * the first message**, since a region that mounts with its text is not
 * announced by every screen reader.
 */
export function useLiveRegion(
  minGapMs: number = LIVE_REGION_GAP_MS,
): readonly [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  const announcer = useMemo(() => createAnnouncer(setMessage, minGapMs), [minGapMs]);
  useEffect(
    () => () => {
      announcer.dispose();
    },
    [announcer],
  );
  return [message, announcer.announce] as const;
}
