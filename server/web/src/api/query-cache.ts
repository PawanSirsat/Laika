/**
 * The shared GET cache (LAI-724, D-075).
 *
 * **Why there is one now.** Every screen fetched its own copy of the same small
 * lists — the project, its members, its sprints, the projects list, presence —
 * and a cold load asked for most of them twice, once from the space frame and
 * once from the screen. `tasks.ts` and `CapacityScreen.tsx` said there was
 * deliberately no client cache; the owner decided otherwise (D-075).
 *
 * **What it promises, and nothing more:**
 *
 * - The same key in flight is **one request**; every caller gets its answer.
 * - A settled answer is reused while it is younger than the caller's `maxAge`
 *   and nothing has invalidated it. `maxAge: 0` dedupes the flight only.
 * - An invalidated key is never joined: a read after a change does not ride a
 *   request that began before it.
 * - A request is aborted only when **no caller** still wants it, and only after
 *   a short grace — a tab switch unmounts one screen and mounts the next, and
 *   aborting in between would throw away the answer the next screen wants.
 * - **Nothing survives a change of user.** `setUser` drops every answer and
 *   aborts every request, and an answer to a request made for the previous user
 *   is never stored. With no user, nothing is cached at all.
 *
 * Framework-free and clock-injected so all of that is unit-tested
 * (`query-cache.test.ts`). The policy — which paths may be reused for how long —
 * is `client.ts`'s, next to the one `request` every call goes through.
 */

export interface QueryCacheDeps {
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** How long a request nobody wants lingers before it is aborted. */
  readonly abortGraceMs?: number;
}

export interface CacheRead {
  /** How long a settled answer may be reused, in ms. `0` dedupes the flight only. */
  readonly maxAge: number;
  /** The caller's own lifetime. Aborting it leaves the request to the others. */
  readonly signal?: AbortSignal | undefined;
}

export type Fetcher<T> = (signal: AbortSignal | undefined) => Promise<T>;

export interface QueryCache {
  read<T>(key: string, fetcher: Fetcher<T>, options: CacheRead): Promise<T>;
  /** The last answer for `key`, fresh or not — for display while revalidating. */
  peek<T>(key: string): T | undefined;
  /** Mark matching answers stale. Lazy: nothing is refetched until it is read. */
  invalidate(match: (key: string) => boolean): void;
  /** Whose answers these are. A different user — or none — drops everything. */
  setUser(userId: string | undefined): void;
  readonly user: string | undefined;
}

interface Flight {
  readonly promise: Promise<unknown>;
  readonly controller: AbortController;
  subscribers: number;
  abortTimer: unknown;
}

interface Entry {
  data: unknown;
  hasData: boolean;
  at: number;
  /** Bumped by every invalidation; an answer is fresh only for the epoch it began in. */
  epoch: number;
  freshEpoch: number;
  flight: Flight | undefined;
}

const ABORT_GRACE_MS = 1_000;

function abortError(): DOMException {
  return new DOMException('The request was aborted.', 'AbortError');
}

export function createQueryCache(deps: QueryCacheDeps = {}): QueryCache {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const grace = deps.abortGraceMs ?? ABORT_GRACE_MS;

  let user: string | undefined;
  /** Bumped on every change of user; an answer from an older generation is dropped. */
  let generation = 0;
  let entries = new Map<string, Entry>();
  /** Every flight still running, so a change of user can abort them all. */
  const flights = new Set<Flight>();

  function start<T>(key: string, entry: Entry, fetcher: Fetcher<T>): Flight {
    const controller = new AbortController();
    const mine = generation;
    const epoch = entry.epoch;
    const flight: Flight = {
      controller,
      subscribers: 0,
      abortTimer: undefined,
      promise: fetcher(controller.signal).then((data) => {
        // Stored only for the user and the entry it was asked for, and never
        // over an answer to a later question.
        if (mine === generation && entries.get(key) === entry && epoch >= entry.freshEpoch) {
          entry.data = data;
          entry.hasData = true;
          entry.at = now();
          entry.freshEpoch = epoch;
        }
        return data;
      }),
    };
    flights.add(flight);
    // Nobody may be listening when it fails (everyone left); never unhandled.
    flight.promise
      .catch(() => undefined)
      .finally(() => {
        flights.delete(flight);
        if (entry.flight === flight) entry.flight = undefined;
        if (flight.abortTimer !== undefined) clearTimer(flight.abortTimer);
      });
    return flight;
  }

  function join<T>(flight: Flight, signal: AbortSignal | undefined): Promise<T> {
    flight.subscribers += 1;
    if (flight.abortTimer !== undefined) {
      clearTimer(flight.abortTimer);
      flight.abortTimer = undefined;
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const leave = (): void => {
        flight.subscribers -= 1;
        if (flight.subscribers > 0) return;
        flight.abortTimer = setTimer(() => {
          flight.abortTimer = undefined;
          if (flight.subscribers === 0) flight.controller.abort();
        }, grace);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        reject(abortError());
        leave();
      };
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          flight.subscribers -= 1;
          resolve(value as T);
        },
        (cause: unknown) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          flight.subscribers -= 1;
          // Every rejection here is already an Error (`ApiError`, `NetworkError`,
          // an `AbortError` DOMException); anything else is wrapped, not dropped.
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        },
      );
    });
  }

  return {
    get user() {
      return user;
    },

    read<T>(key: string, fetcher: Fetcher<T>, options: CacheRead): Promise<T> {
      // No user, no cache: a signed-out page shares nothing with anyone.
      if (user === undefined) return fetcher(options.signal);

      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          data: undefined,
          hasData: false,
          at: 0,
          epoch: 0,
          freshEpoch: -1,
          flight: undefined,
        };
        entries.set(key, entry);
      }

      const fresh =
        entry.hasData && entry.freshEpoch === entry.epoch && now() - entry.at < options.maxAge;
      if (fresh) return Promise.resolve(entry.data as T);

      entry.flight ??= start(key, entry, fetcher);
      return join<T>(entry.flight, options.signal);
    },

    peek<T>(key: string): T | undefined {
      if (user === undefined) return undefined;
      const entry = entries.get(key);
      return entry?.hasData === true ? (entry.data as T) : undefined;
    },

    invalidate(match: (key: string) => boolean): void {
      for (const [key, entry] of entries) {
        if (!match(key)) continue;
        entry.epoch += 1;
        // Existing callers keep the request they joined; new ones do not join it.
        entry.flight = undefined;
      }
    },

    setUser(userId: string | undefined): void {
      if (userId !== undefined && userId === user) return;
      user = userId;
      generation += 1;
      entries = new Map();
      for (const flight of [...flights]) flight.controller.abort();
    },
  };
}

/** The app's one cache. `client.ts` reads through it; the session sets its user. */
export const sharedCache: QueryCache = createQueryCache();
