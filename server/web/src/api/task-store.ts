import { mergeTasks } from './board-merge.ts';
import { byIdIndex } from './board-derive.ts';
import { ApiError } from './errors.ts';
import { everyPage, EVERY_PAGE_CAP } from './every-page.ts';
import type { Page, Task } from './tasks.ts';

/**
 * The project's task set, one copy for every screen (LAI-724, D-075).
 *
 * **Why.** Board, List, the sprint strip, Timeline, Calendar, Sprints,
 * Dashboard, Capacity, Activity and Meeting review each walked
 * `GET /projects/:slug/tasks` to the end on their own, the List twice (the board
 * and the strip), on every mount and — for the board — on every live frame.
 * Measured on a 350-task project, that was ~1.5 MB per frame with the board open.
 *
 * **What this keeps.** One set per project, walked once with every page
 * (LAI-621, LAI-702 — a partial set shows *wrong*, not less), held across tab
 * switches. Only the current project is held: subscribing to another evicts
 * every set nobody is looking at.
 *
 * - **Stale-while-revalidate.** A revisit shows the set at once and walks again
 *   in the background only if it is older than `maxAgeMs` or something made it
 *   stale — a live frame nobody was looking at, or the stream closing.
 * - **One walk per burst.** Live frames reach the store in one place
 *   (`store.ts`), debounced; a frame during a walk queues **one** more walk and
 *   never aborts the running one — aborting under frequent frames is how
 *   LAI-723's dashboard stayed stale for ever. A `gap` reloads at once.
 * - **Abort only when nobody is looking**, after a grace, so a tab switch does
 *   not throw away the walk the next screen wants.
 * - **LAI-707's in-place refresh lives here now.** A refresh is merged so
 *   unchanged tasks keep their objects, and `changed` drives LAI-708's glow. A
 *   task with a write in flight, or written after the read began, keeps its
 *   local version. A hold (a drag) defers applying a refresh until released.
 * - **`reset`** drops every set and aborts every walk, and a late answer is
 *   never applied: the session calls it on sign-out and on a change of user.
 *
 * Framework-free and clock-injected, so all of it is unit-tested
 * (`task-store.test.ts`). The React side is `use-project-tasks.ts` and
 * `use-board.ts`.
 */

export interface TaskSetSnapshot {
  readonly slug: string;
  /** `loading` only until the first answer; a refresh keeps `ready`. */
  readonly status: 'loading' | 'ready' | 'error';
  /** In the server's order (`updated_at`, then id), children included. */
  readonly tasks: readonly Task[];
  /** Every task by id — every child too, so a parent's `n/m` can count them. */
  readonly byId: ReadonlyMap<string, Task>;
  /** The page cap was reached and the server had more: counts are a floor. */
  readonly truncated: boolean;
  readonly error: unknown;
  /** A walk is in flight; the set shown is the last answer. */
  readonly refreshing: boolean;
  /** Why the last refresh failed, or `null`. The set is kept and is stale. */
  readonly refreshError: unknown;
  /** When the set was last read from the server (unix ms). */
  readonly asOf: number | null;
}

export type TaskSetOrigin = 'load' | 'refresh' | 'local';

/** What a listener is told about a change — LAI-708's presenter keys on it. */
export interface TaskSetChange {
  readonly origin: TaskSetOrigin;
  /** Ids the change touched, when known (a merged refresh, a local write). */
  readonly changed?: ReadonlySet<string> | undefined;
  /** A drop the person already carried there. */
  readonly settled?: string | undefined;
  /** Present the change even though the set did not change (an optimistic reorder). */
  readonly moves?: boolean | undefined;
  /** State outside the set that must land in the same render (`movingId`). */
  readonly alongside?: (() => void) | undefined;
}

export type TaskSetListener = (snapshot: TaskSetSnapshot, change: TaskSetChange) => void;

export interface LocalWrite {
  readonly changed?: ReadonlySet<string> | undefined;
  readonly settled?: string | undefined;
  readonly moves?: boolean | undefined;
  readonly alongside?: (() => void) | undefined;
  /** The task the server has just written: a refresh read before now must not undo it. */
  readonly record?: string | undefined;
}

export type LiveSignal = 'activity' | 'gap' | 'closed';

export interface TaskStore {
  subscribe(slug: string, listener: TaskSetListener): () => void;
  peek(slug: string): TaskSetSnapshot | undefined;
  /** Walk again now — the Refresh control, a create, a conflict. */
  reload(slug: string): void;
  /** A live frame for the project, or its stream closing. */
  frame(slug: string, signal: LiveSignal): void;
  /** Defer applying refresh answers until the returned release is called. */
  hold(slug: string): () => void;
  beginWrite(slug: string, taskId: string): void;
  endWrite(slug: string, taskId: string): void;
  writeLocal(
    slug: string,
    update: (tasks: readonly Task[]) => readonly Task[],
    meta: LocalWrite,
  ): void;
  /** Sign-out, or a different user: drop everything. */
  reset(): void;
}

export interface TaskStoreDeps {
  readonly fetchPage: (
    slug: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<Page<Task>>;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly pageCap?: number;
  /** How long a burst of frames settles before its one walk (the board's 300 ms). */
  readonly liveDebounceMs?: number;
  /** How old a set may be before a revisit revalidates it. */
  readonly maxAgeMs?: number;
  readonly abortGraceMs?: number;
}

interface Walk {
  readonly controller: AbortController;
}

interface Entry {
  snapshot: TaskSetSnapshot;
  readonly listeners: Set<TaskSetListener>;
  readonly pending: Set<string>;
  writeEpoch: number;
  readonly lastLocalWrite: Map<string, number>;
  holds: number;
  held: (() => void) | undefined;
  walk: Walk | undefined;
  /** A reason to walk arrived while one was running: walk once more after it. */
  again: boolean;
  /** Something may have changed that the set does not show. */
  stale: boolean;
  debounce: unknown;
  abortTimer: unknown;
}

/** Errors that mean the reader may no longer see this project: the set must go. */
function isFatal(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    (cause.code === 'unauthorized' || cause.code === 'forbidden' || cause.code === 'not_found')
  );
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function loading(slug: string): TaskSetSnapshot {
  return {
    slug,
    status: 'loading',
    tasks: [],
    byId: new Map(),
    truncated: false,
    error: null,
    refreshing: false,
    refreshError: null,
    asOf: null,
  };
}

export function createTaskStore(deps: TaskStoreDeps): TaskStore {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const cap = deps.pageCap ?? EVERY_PAGE_CAP;
  const debounceMs = deps.liveDebounceMs ?? 300;
  const maxAge = deps.maxAgeMs ?? 30_000;
  const grace = deps.abortGraceMs ?? 1_000;

  const entries = new Map<string, Entry>();
  /** Bumped by `reset`; a walk from an older generation never applies. */
  let generation = 0;

  function emit(entry: Entry, change: TaskSetChange): void {
    for (const listener of [...entry.listeners]) listener(entry.snapshot, change);
  }

  function stop(entry: Entry): void {
    entry.walk?.controller.abort();
    entry.walk = undefined;
    if (entry.debounce !== undefined) clearTimer(entry.debounce);
    if (entry.abortTimer !== undefined) clearTimer(entry.abortTimer);
    entry.debounce = undefined;
    entry.abortTimer = undefined;
  }

  function walk(slug: string, entry: Entry): void {
    if (entry.walk !== undefined) {
      entry.again = true;
      return;
    }
    const controller = new AbortController();
    const mine = generation;
    const startedEpoch = entry.writeEpoch;
    entry.walk = { controller };
    entry.stale = false;
    entry.again = false;

    if (entry.snapshot.status === 'ready' && !entry.snapshot.refreshing) {
      entry.snapshot = { ...entry.snapshot, refreshing: true };
      emit(entry, { origin: 'refresh' });
    }

    const current = (): boolean => mine === generation && entries.get(slug) === entry;

    everyPage((cursor) => deps.fetchPage(slug, cursor, controller.signal), cap)
      .then(({ items, truncated }) => {
        if (!current()) return;
        const apply = (): void => {
          if (!current()) return;
          const keep = new Set(entry.pending);
          for (const [id, at] of entry.lastLocalWrite) {
            if (at > startedEpoch) keep.add(id);
            // A write this read already includes no longer needs protecting.
            else entry.lastLocalWrite.delete(id);
          }
          const prev = entry.snapshot;
          const merged = mergeTasks(prev.tasks, items, keep);
          entry.snapshot = {
            slug,
            status: 'ready',
            tasks: merged.tasks,
            byId: merged.tasks === prev.tasks ? prev.byId : byIdIndex(merged.tasks),
            truncated,
            error: null,
            refreshing: false,
            refreshError: null,
            asOf: now(),
          };
          emit(entry, {
            origin: prev.status === 'ready' ? 'refresh' : 'load',
            changed: merged.changed,
          });
        };
        if (entry.snapshot.status === 'ready' && entry.holds > 0) entry.held = apply;
        else apply();
      })
      .catch((cause: unknown) => {
        if (isAbort(cause) || !current()) return;
        const prev = entry.snapshot;
        if (prev.status === 'ready' && !isFatal(cause)) {
          entry.snapshot = { ...prev, refreshing: false, refreshError: cause };
          emit(entry, { origin: 'refresh' });
          return;
        }
        entry.snapshot = { ...loading(slug), status: 'error', error: cause };
        emit(entry, { origin: 'load' });
      })
      .finally(() => {
        if (entry.walk?.controller !== controller) return;
        entry.walk = undefined;
        if (controller.signal.aborted) entry.stale = true;
        if (!entry.again || !current()) return;
        entry.again = false;
        if (entry.listeners.size > 0) walk(slug, entry);
        else entry.stale = true;
      });
  }

  function entryFor(slug: string): Entry {
    let entry = entries.get(slug);
    if (entry !== undefined) return entry;
    // Bounded memory: only the project being looked at is held.
    for (const [other, old] of entries) {
      if (other !== slug && old.listeners.size === 0) {
        stop(old);
        entries.delete(other);
      }
    }
    entry = {
      snapshot: loading(slug),
      listeners: new Set(),
      pending: new Set(),
      writeEpoch: 0,
      lastLocalWrite: new Map(),
      holds: 0,
      held: undefined,
      walk: undefined,
      again: false,
      stale: false,
      debounce: undefined,
      abortTimer: undefined,
    };
    entries.set(slug, entry);
    return entry;
  }

  function retryIfFailed(slug: string, entry: Entry): boolean {
    if (entry.snapshot.status !== 'error') return false;
    entry.snapshot = loading(slug);
    emit(entry, { origin: 'load' });
    walk(slug, entry);
    return true;
  }

  return {
    subscribe(slug, listener) {
      const entry = entryFor(slug);
      entry.listeners.add(listener);
      if (entry.abortTimer !== undefined) {
        clearTimer(entry.abortTimer);
        entry.abortTimer = undefined;
      }

      if (entry.walk === undefined && !retryIfFailed(slug, entry)) {
        const { status, asOf } = entry.snapshot;
        const old = asOf === null || now() - asOf >= maxAge;
        if (status === 'loading' || entry.stale || old) walk(slug, entry);
      }

      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size > 0 || entry.walk === undefined) return;
        entry.abortTimer = setTimer(() => {
          entry.abortTimer = undefined;
          if (entry.listeners.size === 0) entry.walk?.controller.abort();
        }, grace);
      };
    },

    peek(slug) {
      return entries.get(slug)?.snapshot;
    },

    reload(slug) {
      const entry = entries.get(slug);
      if (entry === undefined) return;
      if (!retryIfFailed(slug, entry)) walk(slug, entry);
    },

    frame(slug, signal) {
      const entry = entries.get(slug);
      if (entry === undefined) return;
      entry.stale = true;
      if (signal === 'closed' || entry.listeners.size === 0) return;
      if (entry.debounce !== undefined) clearTimer(entry.debounce);
      entry.debounce = undefined;
      if (signal === 'gap') {
        // Frames were missed. A full read is a superset of any catch-up, so it
        // cannot miss a deletion a delta would omit (BoardScreen's old rule).
        walk(slug, entry);
        return;
      }
      entry.debounce = setTimer(() => {
        entry.debounce = undefined;
        if (entry.listeners.size > 0) walk(slug, entry);
      }, debounceMs);
    },

    hold(slug) {
      const entry = entryFor(slug);
      entry.holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.holds = Math.max(0, entry.holds - 1);
        if (entry.holds === 0 && entry.held !== undefined) {
          const apply = entry.held;
          entry.held = undefined;
          apply();
        }
      };
    },

    beginWrite(slug, taskId) {
      entries.get(slug)?.pending.add(taskId);
    },

    endWrite(slug, taskId) {
      entries.get(slug)?.pending.delete(taskId);
    },

    writeLocal(slug, update, meta) {
      const entry = entries.get(slug);
      if (entry === undefined) return;
      if (meta.record !== undefined) {
        entry.writeEpoch += 1;
        entry.lastLocalWrite.set(meta.record, entry.writeEpoch);
      }
      const prev = entry.snapshot;
      const tasks = update(prev.tasks);
      if (tasks !== prev.tasks) entry.snapshot = { ...prev, tasks, byId: byIdIndex(tasks) };
      emit(entry, {
        origin: 'local',
        changed: meta.changed,
        settled: meta.settled,
        moves: meta.moves,
        alongside: meta.alongside,
      });
    },

    reset() {
      generation += 1;
      const orphaned = [...entries.values()];
      for (const entry of orphaned) stop(entry);
      entries.clear();
      // Nothing of the previous user stays on a screen that is still mounted.
      for (const entry of orphaned) {
        entry.snapshot = loading(entry.snapshot.slug);
        emit(entry, { origin: 'load' });
      }
    },
  };
}
