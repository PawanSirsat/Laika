import type { ProjectStatus } from './statuses.ts';

/**
 * A project's statuses, held once for every screen (LAI-739).
 *
 * The board draws them as columns; the List, the task panel, the filter, the
 * bulk bar and the Timeline all name and pick from them. Each asking for its
 * own copy is how a column renamed on the board keeps its old name in the
 * List — so, like `task-store.ts`, there is one copy, and live frames keep it
 * current in one place (`store.ts`).
 *
 * Small and slow-changing, so the policy is simple, and `task-store.ts`'s:
 *
 * - **Load on first subscribe.** A frame for a project nobody is looking at
 *   reads nothing — it marks the copy **stale**, and the next subscribe reads
 *   it. The stream closes when the reader leaves, so that frame is often the
 *   only news there is (review round 1, B1: returning showed old columns).
 * - **Re-read on a frame** for a project somebody is looking at, debounced.
 * - **A local edit wins.** A read that answers while an edit is in flight —
 *   begun before it or during it — may predate the server applying it, so it
 *   is not applied; a re-read is owed and runs when the last edit ends.
 */

export interface StatusSnapshot {
  readonly slug: string;
  readonly status: 'loading' | 'ready' | 'error';
  /** In `position` order, hidden ones included. */
  readonly statuses: readonly ProjectStatus[];
  /** The first load's failure. A failed refresh keeps what was held. */
  readonly error: unknown;
}

export interface StatusStore {
  /** Listen, and load if nothing is held yet. Returns the unsubscribe. */
  subscribe(slug: string, listener: () => void): () => void;
  /** The current snapshot — the same object until something changes. */
  peek(slug: string): StatusSnapshot | undefined;
  /** Read again now. */
  reload(slug: string): void;
  /** A live frame about the project: one debounced re-read, if it is held. */
  frame(slug: string): void;
  /** A change made here, seen at once. A read already in flight cannot undo it. */
  write(
    slug: string,
    update: (statuses: readonly ProjectStatus[]) => readonly ProjectStatus[],
  ): void;
  /**
   * A write is in flight until the returned function is called. Reads that
   * answer meanwhile are held back — they may predate the server applying it —
   * and asked again once the last write ends.
   */
  begin(slug: string): () => void;
  /**
   * An edit, start to finish: the optimistic change at once, the request held
   * against re-reads for its life, and the hold released however it ends —
   * refused included.
   */
  transaction<T>(
    slug: string,
    optimistic: ((statuses: readonly ProjectStatus[]) => readonly ProjectStatus[]) | undefined,
    call: () => Promise<T>,
  ): Promise<T>;
  /** Forget everything — a different user, or none. */
  reset(): void;
}

export interface StatusStoreDeps {
  readonly fetch: (slug: string, signal: AbortSignal) => Promise<readonly ProjectStatus[]>;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly debounceMs?: number;
}

interface Entry {
  snapshot: StatusSnapshot;
  readonly listeners: Set<() => void>;
  /** Bumped by every local write; a read is applied only in the epoch it began in. */
  epoch: number;
  controller: AbortController | undefined;
  debounce: unknown;
  /** Writes in flight; while any are, a read's answer is not trusted. */
  writing: number;
  /** A read was held back during a write and is owed once it ends. */
  owed: boolean;
  /** A frame arrived while nobody was looking: the next subscribe reads. */
  stale: boolean;
}

function byPosition(statuses: readonly ProjectStatus[]): readonly ProjectStatus[] {
  return [...statuses].sort((a, b) => a.position - b.position);
}

export function createStatusStore(deps: StatusStoreDeps): StatusStore {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? 400;

  let entries = new Map<string, Entry>();

  function publish(entry: Entry, next: StatusSnapshot): void {
    entry.snapshot = next;
    for (const listener of [...entry.listeners]) listener();
  }

  function load(slug: string, entry: Entry): void {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    const epoch = entry.epoch;

    deps.fetch(slug, controller.signal).then(
      (statuses) => {
        if (entries.get(slug) !== entry || entry.controller !== controller) return;
        entry.controller = undefined;
        // A local write landed while this was in flight, or one is still in
        // flight: this answer may predate the server applying it, so it is
        // not applied. It may also carry someone else's change, so it is not
        // forgotten either — read again once no write is in flight.
        if (entry.epoch !== epoch || entry.writing > 0) {
          if (entry.writing > 0) entry.owed = true;
          else load(slug, entry);
          return;
        }
        entry.stale = false;
        publish(entry, { slug, status: 'ready', statuses: byPosition(statuses), error: null });
      },
      (cause: unknown) => {
        if (entries.get(slug) !== entry || entry.controller !== controller) return;
        entry.controller = undefined;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (entry.snapshot.status === 'ready') return;
        publish(entry, { slug, status: 'error', statuses: [], error: cause });
      },
    );
  }

  function ensure(slug: string): Entry {
    const found = entries.get(slug);
    if (found !== undefined) return found;
    const entry: Entry = {
      snapshot: { slug, status: 'loading', statuses: [], error: null },
      listeners: new Set(),
      epoch: 0,
      controller: undefined,
      debounce: undefined,
      writing: 0,
      owed: false,
      stale: false,
    };
    entries.set(slug, entry);
    load(slug, entry);
    return entry;
  }

  function write(
    slug: string,
    update: (statuses: readonly ProjectStatus[]) => readonly ProjectStatus[],
  ): void {
    const entry = ensure(slug);
    entry.epoch += 1;
    publish(entry, {
      slug,
      status: 'ready',
      statuses: byPosition(update(entry.snapshot.statuses)),
      error: null,
    });
  }

  function begin(slug: string): () => void {
    const entry = ensure(slug);
    entry.writing += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      entry.writing -= 1;
      if (entry.writing === 0 && entry.owed && entries.get(slug) === entry) {
        entry.owed = false;
        load(slug, entry);
      }
    };
  }

  return {
    write,
    begin,

    subscribe(slug, listener) {
      const entry = ensure(slug);
      if (entry.stale) {
        entry.stale = false;
        load(slug, entry);
      }
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },

    peek(slug) {
      return entries.get(slug)?.snapshot;
    },

    reload(slug) {
      const entry = entries.get(slug);
      if (entry === undefined) {
        ensure(slug);
        return;
      }
      if (entry.snapshot.status === 'error') {
        publish(entry, { slug, status: 'loading', statuses: [], error: null });
      }
      load(slug, entry);
    },

    frame(slug) {
      const entry = entries.get(slug);
      if (entry === undefined) return;
      // Nobody looking: no read now, one on the next visit.
      if (entry.listeners.size === 0) {
        entry.stale = true;
        return;
      }
      if (entry.debounce !== undefined) clearTimer(entry.debounce);
      entry.debounce = setTimer(() => {
        entry.debounce = undefined;
        if (entries.get(slug) === entry) load(slug, entry);
      }, debounceMs);
    },

    async transaction(slug, optimistic, call) {
      const end = begin(slug);
      try {
        if (optimistic !== undefined) write(slug, optimistic);
        return await call();
      } finally {
        end();
      }
    },

    reset() {
      const dropped = [...entries.values()];
      entries = new Map();
      for (const entry of dropped) {
        entry.controller?.abort();
        if (entry.debounce !== undefined) clearTimer(entry.debounce);
        // Told, so a screen still mounted reads `undefined` and asks again.
        for (const listener of [...entry.listeners]) listener();
      }
    },
  };
}
