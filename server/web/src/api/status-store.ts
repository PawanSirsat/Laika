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
 * Small and slow-changing, so the policy is simple: load on first subscribe,
 * re-read on a frame (debounced, and only for a project somebody is looking
 * at), and let a local write win over any read that began before it.
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
        // A local write landed while this was in flight: its answer predates
        // the write, so it is dropped rather than allowed to undo it.
        if (entry.epoch !== epoch) return;
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
    };
    entries.set(slug, entry);
    load(slug, entry);
    return entry;
  }

  return {
    subscribe(slug, listener) {
      const entry = ensure(slug);
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
      if (entry.debounce !== undefined) clearTimer(entry.debounce);
      entry.debounce = setTimer(() => {
        entry.debounce = undefined;
        if (entries.get(slug) === entry) load(slug, entry);
      }, debounceMs);
    },

    write(slug, update) {
      const entry = ensure(slug);
      entry.epoch += 1;
      publish(entry, {
        slug,
        status: 'ready',
        statuses: byPosition(update(entry.snapshot.statuses)),
        error: null,
      });
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
