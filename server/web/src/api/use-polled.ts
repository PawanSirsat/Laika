import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A read that repeats on a timer, and says honestly how the last one went
 * (LAI-1128, the UX audit's B6).
 *
 * Capacity and Unlisted each hand-rolled this and each got recovery wrong in
 * its own way: an error set by a failed read was never cleared by the next
 * good one, so the page stayed on *Could not load* while the data behind it
 * was fine again, and neither offered a way to ask once more. This is the
 * one place that rule lives:
 *
 * - **A good read clears every error.** Whatever failed before is history.
 * - **A failed re-read keeps the last good data** (`keepOnError`) and marks it
 *   `stale`, rather than swapping a page of real rows for an error. Only a
 *   read with nothing to show yet becomes an error page.
 * - **`retry` asks again now**, from either state.
 * - **A hidden tab is not polled** (`pauseWhenHidden`). It is read again as
 *   soon as it is shown, unless the last read is only moments old — a focus
 *   and a visibility change arrive together, and one read answers both.
 *
 * Answers arrive in any order; only the newest read's answer is applied.
 *
 * The timing lives in {@link createPoller}, which takes its clock and its
 * page as arguments so a unit test can drive it without a browser. The hook
 * below is the React wrapper and nothing more.
 */

export interface PolledOptions {
  /** How often to re-read, in milliseconds. */
  readonly ms: number;
  /** Keep the last good data through a failed re-read, marked stale. */
  readonly keepOnError?: boolean | undefined;
  /** Skip the timer while the tab is hidden, and re-read when it is shown. */
  readonly pauseWhenHidden?: boolean | undefined;
  /** A read younger than this is not repeated when the tab comes back. Default 2 s. */
  readonly refocusGapMs?: number | undefined;
}

export interface PolledState<T> {
  /**
   * `loading` until the first answer; `ok` while there is data to show (even
   * stale data); `error` when a read failed and there is nothing to show.
   */
  readonly status: 'loading' | 'ok' | 'error';
  readonly data: T | undefined;
  /** Why the last read failed, or `null` once one succeeds. */
  readonly error: unknown;
  /** The data on screen is older than the last read, which failed. */
  readonly stale: boolean;
  /** When the data on screen was read (unix ms), or `null` before any. */
  readonly readAt: number | null;
}

/** What the poller needs from the page — the real one, or a test's. */
export interface PollerEnvironment {
  readonly now: () => number;
  readonly every: (ms: number, run: () => void) => () => void;
  readonly hidden: () => boolean;
  /** Call `back` when the tab is shown or focused; returns the unsubscribe. */
  readonly onReturn: (back: () => void) => () => void;
}

export interface Poller<T> {
  readonly snapshot: () => PolledState<T>;
  readonly subscribe: (listener: () => void) => () => void;
  /** Begin: one read now, then the timer. */
  readonly start: () => void;
  /** Ask again now. */
  readonly retry: () => void;
  /** Stop the timer, drop the listeners, and abort what is in flight. */
  readonly stop: () => void;
}

const LOADING = {
  status: 'loading',
  data: undefined,
  error: null,
  stale: false,
  readAt: null,
} as const satisfies PolledState<never>;

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export function createPoller<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PolledOptions,
  env: PollerEnvironment,
): Poller<T> {
  const keepOnError = options.keepOnError ?? true;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const gap = options.refocusGapMs ?? 2_000;
  const controller = new AbortController();
  const listeners = new Set<() => void>();
  let state: PolledState<T> = LOADING;
  /** Bumped per read: an answer for an older one is dropped. */
  let latest = 0;
  let lastAsked = Number.NEGATIVE_INFINITY;
  let stopped = false;
  const cleanups: (() => void)[] = [];

  const publish = (next: PolledState<T>): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  const read = (): void => {
    if (stopped) return;
    latest += 1;
    const mine = latest;
    lastAsked = env.now();
    let answer: Promise<T>;
    try {
      answer = fetcher(controller.signal);
    } catch (cause) {
      answer = Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
    answer.then(
      (data) => {
        if (stopped || mine !== latest) return;
        publish({ status: 'ok', data, error: null, stale: false, readAt: env.now() });
      },
      (cause: unknown) => {
        if (stopped || mine !== latest || isAbort(cause)) return;
        if (keepOnError && state.data !== undefined) {
          publish({ ...state, status: 'ok', error: cause, stale: true });
        } else {
          publish({ status: 'error', data: undefined, error: cause, stale: false, readAt: null });
        }
      },
    );
  };

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      read();
      cleanups.push(
        env.every(options.ms, () => {
          if (pauseWhenHidden && env.hidden()) return;
          read();
        }),
      );
      if (pauseWhenHidden) {
        cleanups.push(
          env.onReturn(() => {
            if (env.hidden()) return;
            if (env.now() - lastAsked < gap) return;
            read();
          }),
        );
      }
    },
    retry() {
      // From an error page, show the loading state while asking: the button
      // was pressed, and the page should say something is happening.
      if (state.status === 'error') publish(LOADING);
      read();
    },
    stop() {
      stopped = true;
      controller.abort();
      for (const cleanup of cleanups.splice(0)) cleanup();
      listeners.clear();
    },
  };
}

/** The browser's clock, timers and tab. */
export const BROWSER_ENVIRONMENT: PollerEnvironment = {
  now: () => Date.now(),
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    return () => {
      clearInterval(timer);
    };
  },
  hidden: () => document.visibilityState === 'hidden',
  onReturn: (back) => {
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  },
};

export interface Polled<T> extends PolledState<T> {
  readonly retry: () => void;
}

/**
 * {@link createPoller} for a component. `key` names what is being read: when
 * it changes (a filter that changes the request), the poller starts again
 * from `loading`, because the old answer is not stale data for the new
 * question — it is the answer to a different one.
 *
 * `fetcher` is read through a ref, so a new function each render does not
 * restart anything; change `key` for that.
 */
export function usePolled<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PolledOptions & { readonly key?: string | undefined },
): Polled<T> {
  const fetcherRef = useRef(fetcher);
  // Declared before the poller's effect, so it has run when the first read asks.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [state, setState] = useState<PolledState<T>>(LOADING);
  const pollerRef = useRef<Poller<T> | undefined>(undefined);
  const { ms, keepOnError, pauseWhenHidden, refocusGapMs, key } = options;

  useEffect(() => {
    const poller = createPoller<T>(
      (signal) => fetcherRef.current(signal),
      { ms, keepOnError, pauseWhenHidden, refocusGapMs },
      BROWSER_ENVIRONMENT,
    );
    pollerRef.current = poller;
    setState(LOADING);
    const unsubscribe = poller.subscribe(() => {
      setState(poller.snapshot());
    });
    poller.start();
    return () => {
      unsubscribe();
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = undefined;
    };
  }, [ms, keepOnError, pauseWhenHidden, refocusGapMs, key]);

  const retry = useCallback(() => {
    pollerRef.current?.retry();
  }, []);
  return { ...state, retry };
}
