import { ApiError } from '../../../api/errors.ts';

/**
 * How each Command Center section reads and re-reads (LAI-1202), framework-free
 * so the rules are unit-tested rather than trapped in a component this
 * package has no renderer for.
 *
 * **The shared approach, not a new one.** Review, Capacity and the reader's
 * agents each poll on an interval and read again when the tab comes back
 * (`ReviewScreen.tsx`, `CapacityScreen.tsx`, `use-my-agents.ts`). This is
 * that pattern once, for six sections: one read on start, a quiet re-read on
 * the interval **only while the tab is shown**, and one when it is shown
 * again. No `EventSource` is opened — the page rides the same GET cache
 * every screen does.
 */

/** A minute, as the review badge and presence re-read. */
export const HOME_POLL_MS = 60_000;

export interface PollDeps {
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly visible: () => boolean;
  /** Subscribe to the tab being shown again; returns the unsubscribe. */
  readonly onShown: (fn: () => void) => () => void;
}

/** The browser's timers and visibility. */
export function browserPollDeps(): PollDeps {
  return {
    setTimer: (fn, ms) => setInterval(fn, ms),
    clearTimer: (handle) => {
      clearInterval(handle as ReturnType<typeof setInterval>);
    },
    visible: () => document.visibilityState === 'visible',
    onShown: (fn) => {
      const listener = (): void => {
        if (document.visibilityState === 'visible') fn();
      };
      document.addEventListener('visibilitychange', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
      };
    },
  };
}

/**
 * Read now, then re-read quietly every `ms` while the tab is shown and once
 * each time it is shown again. A hidden tab asks for nothing. Returns stop.
 */
export function startPolling(
  read: (quiet: boolean) => void,
  ms: number,
  deps: PollDeps,
): () => void {
  read(false);
  const timer = deps.setTimer(() => {
    if (deps.visible()) read(true);
  }, ms);
  const unsubscribe = deps.onShown(() => {
    read(true);
  });
  return () => {
    deps.clearTimer(timer);
    unsubscribe();
  };
}

/**
 * Where one section stands.
 *
 * - `loading` — never answered: a skeleton.
 * - `ready` — the last good answer, with `failed` set when a later re-read
 *   did not arrive, so the section keeps its rows and says how old they are.
 * - `error` — the first read failed: the section's own error with Retry.
 * - `forbidden` — the server answered `403`: the section is absent, never an
 *   error (proposal §2.2, *Permission (403)*).
 */
export type SectionState<T> =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly data: T;
      readonly at: number;
      readonly failed?: string | undefined;
    }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'forbidden' };

export type Outcome<T> =
  | { readonly ok: true; readonly data: T; readonly at: number }
  | { readonly ok: false; readonly cause: unknown };

export function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'Something went wrong.';
}

/** The next state of a section, given the last one and what its read brought. */
export function settle<T>(was: SectionState<T>, outcome: Outcome<T>): SectionState<T> {
  if (outcome.ok) return { status: 'ready', data: outcome.data, at: outcome.at };
  const { cause } = outcome;
  if (cause instanceof ApiError && cause.status === 403) return { status: 'forbidden' };
  // A re-read that did not arrive keeps the rows it had (proposal §2.2).
  if (was.status === 'ready') return { ...was, failed: messageOf(cause) };
  return { status: 'error', message: messageOf(cause) };
}

/** `just now`, `3 min ago`, `2 h ago`, `4 d ago` — how old kept rows, or a feed row, are. */
export function ageLabel(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} d ago`;
}
