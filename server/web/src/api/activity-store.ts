import type { ActivityEvent } from './activity.ts';
import type { Page } from './tasks.ts';

/**
 * The Dashboard's activity window (LAI-723, inside LAI-724, D-075).
 *
 * **The defect.** Once LAI-722 made `?limit=200` return a cursor, `useDashboard`
 * walked the whole range — up to 20 pages of 200 on "All time", ~4.3 s at
 * ~215 ms a round trip — **on every live frame**, and each frame aborted the
 * walk before it. Under frames more often than the walk took, "All time" never
 * finished and the numbers stayed stale.
 *
 * **Why incremental works.** Activity is append-only. A window read in full
 * is complete from its `since` on; adding the events at or after the newest one
 * held keeps it complete. So a live frame costs one small request
 * (`?since=<newest>`), and duplicates at the newest millisecond are dropped by
 * id. Nothing ever cancels a walk: a frame during one — the first walk of a
 * window included — queues one catch-up after it.
 *
 * **What is proved, and no more:** `activity-store.test.ts` compares the window
 * with a full walk after a frame on a held window (450 events, more than two
 * pages), after a burst, after frames during a long "All time" walk, and after
 * a frame that arrives between the first walk's pages (LAI-724 review, B2: the
 * first version dropped that one and ended at 450 of 451). It assumes what the
 * catch-up assumes: an event is never recorded with a `created_at` older than
 * one already read — see the note at the catch-up.
 *
 * Kept across tab switches for the current project only. A narrower window is
 * served from the one held; a wider one is walked. Walks are capped
 * (`pageCap` × 200) and a capped window says it is a floor (`truncated`).
 * `reset` drops everything on sign-out or a change of user.
 */

export interface ActivityWindow {
  readonly slug: string;
  readonly since: number | undefined;
  readonly status: 'loading' | 'ready' | 'error';
  /** Every event in the window, newest first. */
  readonly events: readonly ActivityEvent[];
  /** A walk hit the page cap: the window is a floor. */
  readonly truncated: boolean;
  readonly error: unknown;
  readonly refreshing: boolean;
  readonly refreshError: unknown;
  readonly asOf: number | null;
}

export type ActivityListener = (window: ActivityWindow) => void;

export interface ActivityQuery {
  readonly since?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface ActivityStoreDeps {
  readonly fetchPage: (
    slug: string,
    query: ActivityQuery,
    signal: AbortSignal,
  ) => Promise<Page<ActivityEvent>>;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly pageCap?: number;
  readonly liveDebounceMs?: number;
  readonly maxAgeMs?: number;
  readonly abortGraceMs?: number;
}

export interface ActivityStore {
  subscribe(slug: string, since: number | undefined, listener: ActivityListener): () => void;
  peek(slug: string, since: number | undefined): ActivityWindow | undefined;
  /** Retry: catch up, or walk again after a failure. */
  reload(slug: string): void;
  frame(slug: string, signal: 'activity' | 'gap' | 'closed'): void;
  reset(): void;
}

/** What is held: every event from `from` on (all of them when `from` is undefined). */
interface Held {
  readonly from: number | undefined;
  /** The walk that read it hit the cap; anything older than `from` is unknown. */
  readonly capped: boolean;
  readonly events: readonly ActivityEvent[];
  readonly asOf: number;
}

type Work =
  { readonly kind: 'walk'; readonly since: number | undefined } | { readonly kind: 'catchup' };

interface Entry {
  held: Held | undefined;
  readonly listeners: Map<ActivityListener, number | undefined>;
  flight: { readonly controller: AbortController; readonly work: Work } | undefined;
  /** Work asked for while a flight was running. A walk outranks a catch-up. */
  next: Work | undefined;
  stale: boolean;
  error: unknown;
  refreshError: unknown;
  debounce: unknown;
  abortTimer: unknown;
}

const NEWEST_FIRST = (a: ActivityEvent, b: ActivityEvent): number =>
  b.created_at - a.created_at || b.seq - a.seq;

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/** Does the held window answer a question about `since`? */
function covers(held: Held | undefined, since: number | undefined): boolean {
  if (held === undefined) return false;
  if (held.from === undefined) return true;
  // A capped walk already read as far back as the cap allows; reading again
  // would stop at the same place. Answered, and marked as a floor.
  if (held.capped) return true;
  return since !== undefined && since >= held.from;
}

export function createActivityStore(deps: ActivityStoreDeps): ActivityStore {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const cap = deps.pageCap ?? 20;
  const debounceMs = deps.liveDebounceMs ?? 500;
  const maxAge = deps.maxAgeMs ?? 30_000;
  const grace = deps.abortGraceMs ?? 1_000;

  const entries = new Map<string, Entry>();
  let generation = 0;

  function view(slug: string, entry: Entry, since: number | undefined): ActivityWindow {
    const { held } = entry;
    const refreshing = entry.flight !== undefined;
    if (!covers(held, since) || held === undefined) {
      return {
        slug,
        since,
        status: entry.error === null ? 'loading' : 'error',
        events: [],
        truncated: false,
        error: entry.error,
        refreshing,
        refreshError: null,
        asOf: null,
      };
    }
    return {
      slug,
      since,
      status: 'ready',
      events: since === undefined ? held.events : held.events.filter((e) => e.created_at >= since),
      truncated:
        held.capped && (since === undefined || held.from === undefined || since < held.from),
      error: null,
      refreshing,
      refreshError: entry.refreshError,
      asOf: held.asOf,
    };
  }

  function emit(slug: string, entry: Entry): void {
    for (const [listener, since] of [...entry.listeners]) listener(view(slug, entry, since));
  }

  /** Read pages from newest back until the cursor ends or the cap. */
  async function read(
    slug: string,
    since: number | undefined,
    signal: AbortSignal,
  ): Promise<{ events: ActivityEvent[]; capped: boolean }> {
    const events: ActivityEvent[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < cap; page += 1) {
      const answer = await deps.fetchPage(slug, { since, cursor }, signal);
      events.push(...answer.data);
      if (answer.next_cursor === null) return { events, capped: false };
      cursor = answer.next_cursor;
    }
    return { events, capped: true };
  }

  /** The window every listener needs: the widest one asked for. */
  function widest(entry: Entry): number | undefined {
    let min: number | undefined;
    for (const since of entry.listeners.values()) {
      if (since === undefined) return undefined;
      if (min === undefined || since < min) min = since;
    }
    return min;
  }

  function run(slug: string, entry: Entry, work: Work): void {
    if (entry.flight !== undefined) {
      // A walk outranks a catch-up: it reads everything a catch-up would.
      if (work.kind === 'walk' || entry.next === undefined) entry.next = work;
      return;
    }
    const held = entry.held;
    // A catch-up with nothing held, or nothing in it, is a walk.
    const newest = held?.events[0]?.created_at;
    const actual: Work =
      work.kind === 'catchup' && (held === undefined || newest === undefined)
        ? { kind: 'walk', since: held?.from ?? widest(entry) }
        : work;

    const controller = new AbortController();
    const mine = generation;
    entry.flight = { controller, work: actual };
    entry.stale = false;
    emit(slug, entry);
    const current = (): boolean => mine === generation && entries.get(slug) === entry;

    /*
     * **The catch-up keys on `created_at`**, the only lower bound the endpoint
     * takes (§6.3's `since`). It is right while the server records events in
     * `created_at` order. An event written late with an older timestamp — a
     * clock step, a slow transaction — would fall below `newest` and be missed
     * until the next full walk. Catching up by `seq` (the stream's own cursor,
     * strictly increasing) would be sturdier; it needs an `after_seq` the
     * activity endpoint does not take today.
     */
    const since = actual.kind === 'walk' ? actual.since : newest;
    read(slug, since, controller.signal)
      .then(({ events, capped }) => {
        if (!current()) return;
        if (actual.kind === 'walk') {
          const oldest = events[events.length - 1]?.created_at;
          entry.held = {
            // A capped walk is complete only above its oldest millisecond.
            from: capped && oldest !== undefined ? oldest + 1 : actual.since,
            capped,
            events: [...events].sort(NEWEST_FIRST),
            asOf: now(),
          };
        } else if (held !== undefined) {
          if (capped) {
            // More arrived than one catch-up reads: the window has a hole. Walk.
            entry.next = { kind: 'walk', since: held.from };
          } else {
            const known = new Set(held.events.map((e) => e.id));
            const fresh = events.filter((e) => !known.has(e.id));
            entry.held = {
              ...held,
              events:
                fresh.length === 0 ? held.events : [...fresh, ...held.events].sort(NEWEST_FIRST),
              asOf: now(),
            };
          }
        }
        entry.error = null;
        entry.refreshError = null;
      })
      .catch((cause: unknown) => {
        if (isAbort(cause) || !current()) return;
        if (entry.held !== undefined) entry.refreshError = cause;
        else entry.error = cause;
      })
      .finally(() => {
        if (!current() || entry.flight?.controller !== controller) return;
        entry.flight = undefined;
        if (controller.signal.aborted) entry.stale = true;
        const queued = entry.next;
        entry.next = undefined;
        if (queued !== undefined && entry.listeners.size > 0) run(slug, entry, queued);
        else {
          if (queued !== undefined) entry.stale = true;
          emit(slug, entry);
        }
      });
  }

  function entryFor(slug: string): Entry {
    let entry = entries.get(slug);
    if (entry !== undefined) return entry;
    for (const [other, old] of entries) {
      if (other !== slug && old.listeners.size === 0) {
        old.flight?.controller.abort();
        if (old.debounce !== undefined) clearTimer(old.debounce);
        if (old.abortTimer !== undefined) clearTimer(old.abortTimer);
        entries.delete(other);
      }
    }
    entry = {
      held: undefined,
      listeners: new Map(),
      flight: undefined,
      next: undefined,
      stale: false,
      error: null,
      refreshError: null,
      debounce: undefined,
      abortTimer: undefined,
    };
    entries.set(slug, entry);
    return entry;
  }

  return {
    subscribe(slug, since, listener) {
      const entry = entryFor(slug);
      entry.listeners.set(listener, since);
      if (entry.abortTimer !== undefined) {
        clearTimer(entry.abortTimer);
        entry.abortTimer = undefined;
      }

      if (!covers(entry.held, since)) {
        const flying = entry.flight?.work;
        const enough =
          flying?.kind === 'walk' &&
          (flying.since === undefined || (since !== undefined && since >= flying.since));
        if (!enough) {
          // A narrower walk nobody wants any more is replaced, not queued behind.
          if (flying !== undefined) {
            entry.flight?.controller.abort();
            entry.flight = undefined;
          }
          entry.error = null;
          run(slug, entry, { kind: 'walk', since });
        }
      } else if (entry.held !== undefined && (entry.stale || now() - entry.held.asOf >= maxAge)) {
        run(slug, entry, { kind: 'catchup' });
      }
      listener(view(slug, entry, since));

      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size > 0 || entry.flight === undefined) return;
        entry.abortTimer = setTimer(() => {
          entry.abortTimer = undefined;
          if (entry.listeners.size === 0) entry.flight?.controller.abort();
        }, grace);
      };
    },

    peek(slug, since) {
      const entry = entries.get(slug);
      if (entry === undefined || !covers(entry.held, since)) return undefined;
      return view(slug, entry, since);
    },

    reload(slug) {
      const entry = entries.get(slug);
      if (entry === undefined) return;
      entry.error = null;
      if (entry.held === undefined) run(slug, entry, { kind: 'walk', since: widest(entry) });
      else run(slug, entry, { kind: 'catchup' });
    },

    frame(slug, signal) {
      const entry = entries.get(slug);
      if (entry === undefined) return;
      entry.stale = true;
      if (signal === 'closed' || entry.listeners.size === 0) return;
      if (entry.flight !== undefined) {
        // **A walk is running — the first one included** (LAI-724 review,
        // B2). Its pages read backwards from what it saw first, so an event
        // after that is in none of them: queue one catch-up behind it.
        entry.next ??= { kind: 'catchup' };
        return;
      }
      // Nothing held and nothing running: the next subscribe walks in full.
      if (entry.held === undefined) return;
      if (entry.debounce !== undefined) clearTimer(entry.debounce);
      entry.debounce = setTimer(() => {
        entry.debounce = undefined;
        if (entry.listeners.size > 0) run(slug, entry, { kind: 'catchup' });
      }, debounceMs);
    },

    reset() {
      generation += 1;
      const orphaned = [...entries];
      for (const [, entry] of orphaned) {
        entry.flight?.controller.abort();
        if (entry.debounce !== undefined) clearTimer(entry.debounce);
        if (entry.abortTimer !== undefined) clearTimer(entry.abortTimer);
      }
      entries.clear();
      for (const [slug, entry] of orphaned) {
        entry.held = undefined;
        entry.flight = undefined;
        emit(slug, entry);
      }
    },
  };
}
