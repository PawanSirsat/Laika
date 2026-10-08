import { useEffect, useRef, useState } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { listTasks, type Task } from '../../../api/tasks.ts';
import { useLive } from '../../../components/space/SpaceLive.tsx';

export type SprintsLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly sprints: readonly Sprint[];
      /** `everyPage` hit its cap: there are more sprints than are drawn. */
      readonly truncated: boolean;
    };

/** One sprint's tasks, or the unscheduled ones (`none`). */
export type TasksLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly tasks: readonly Task[]; readonly truncated: boolean };

export interface UseTimeline {
  readonly sprints: SprintsLoad;
  /** The tasks for an open key; `undefined` for a key that is not open. */
  readonly tasks: (key: string) => TasksLoad | undefined;
  readonly reload: () => void;
}

/** At most this many task requests at once — *Expand all* on a long project. */
export const MAX_IN_FLIGHT = 3;

/** A burst of live frames settles into one refetch, as on the dashboard. */
const LIVE_SETTLE_MS = 500;

/**
 * The Timeline's data, **on demand** (LAI-721).
 *
 * The API is deliberately narrow: **which keys are open** goes in (a sprint id,
 * or `none` for the tray), **the tasks for a key** come out. Only the sprint
 * list loads up front, carrying `task_counts` so progress shows unopened; a
 * key's tasks are fetched with the tasks endpoint's `?sprint=` filter while it
 * is open, at most {@link MAX_IN_FLIGHT} at a time, and forgotten when it
 * closes — so a reopen is also the retry after an error.
 *
 * **Live**: every frame on the space's stream (`useLive().generation`) settles
 * into one refetch of the sprints and every open key, kept on screen while it
 * runs, so an edit in the drawer the Timeline opened lands on its row.
 *
 * **Not a cache, on purpose.** A shared per-project task store is being built
 * (build-perf-store); this hook should become a view over it —
 * `tasksWhere(task.sprint_id === key)` — and holds no more than the open keys
 * need until then.
 */
export function useTimeline(slug: string | undefined, open: ReadonlySet<string>): UseTimeline {
  const [sprints, setSprints] = useState<SprintsLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [tasks, setTasksState] = useState<ReadonlyMap<string, TasksLoad>>(new Map());
  /** The same map, readable synchronously — the effects below decide from it. */
  const tasksRef = useRef<ReadonlyMap<string, TasksLoad>>(new Map());
  const setTasks = (
    update: (map: ReadonlyMap<string, TasksLoad>) => ReadonlyMap<string, TasksLoad>,
  ) => {
    tasksRef.current = update(tasksRef.current);
    setTasksState(tasksRef.current);
  };

  /** Each key's request in flight. A key's own controller, so a stale one cannot clear a new one. */
  const inflight = useRef(new Map<string, AbortController>());
  /** Keys waiting for a free slot, oldest first. */
  const queue = useRef<string[]>([]);
  const slugRef = useRef(slug);
  slugRef.current = slug;

  // ------------------------------------------------------------- live
  const { generation } = useLive();
  const seenGeneration = useRef(generation);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (generation === seenGeneration.current) return;
    seenGeneration.current = generation;
    const timer = window.setTimeout(() => {
      setTick((n) => n + 1);
    }, LIVE_SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [generation]);

  // ----------------------------------------------------------- sprints
  const sprintsFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    // A new project starts from nothing; a live tick keeps what is on screen.
    if (sprintsFor.current !== slug) setSprints({ status: 'loading' });

    everyPage((cursor) =>
      listSprints(
        slug,
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items, truncated }) => {
        if (controller.signal.aborted) return;
        sprintsFor.current = slug;
        setSprints({ status: 'ready', sprints: items, truncated });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSprints({ status: 'error', error });
      });

    return () => {
      controller.abort();
    };
  }, [slug, attempt, tick]);

  // ------------------------------------------------------------- tasks
  const start = (key: string): void => {
    const current = slugRef.current;
    if (current === undefined) return;
    const controller = new AbortController();
    inflight.current.set(key, controller);

    everyPage((cursor) =>
      listTasks(
        current,
        cursor === undefined ? { sprint: key, limit: 200 } : { sprint: key, limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items, truncated }) => {
        if (controller.signal.aborted) return;
        setTasks((map) =>
          map.has(key) ? new Map(map).set(key, { status: 'ready', tasks: items, truncated }) : map,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTasks((map) => (map.has(key) ? new Map(map).set(key, { status: 'error', error }) : map));
      })
      .finally(() => {
        // Only its own: a reopen may already have put a newer request here.
        if (inflight.current.get(key) === controller) inflight.current.delete(key);
        pump();
      });
  };

  const pump = (): void => {
    while (inflight.current.size < MAX_IN_FLIGHT && queue.current.length > 0) {
      const key = queue.current.shift();
      if (key !== undefined) start(key);
    }
  };

  const fetchKey = (key: string): void => {
    inflight.current.get(key)?.abort();
    inflight.current.delete(key);
    if (!queue.current.includes(key)) queue.current.push(key);
    pump();
  };

  const openKey = [...open].sort().join('\u0000');

  // Open keys load; closed keys are dropped, with any request still running.
  useEffect(() => {
    const before = tasksRef.current;
    const fresh = [...open].filter((key) => !before.has(key));
    for (const key of before.keys()) {
      if (open.has(key)) continue;
      inflight.current.get(key)?.abort();
      inflight.current.delete(key);
      queue.current = queue.current.filter((k) => k !== key);
    }
    setTasks((map) => {
      const next = new Map<string, TasksLoad>();
      for (const key of open) next.set(key, map.get(key) ?? { status: 'loading' });
      return next;
    });
    for (const key of fresh) fetchKey(key);
  }, [openKey, slug]);

  // A live tick refetches every open key, in place.
  useEffect(() => {
    if (tick === 0) return;
    for (const key of open) fetchKey(key);
  }, [tick]);

  // A new project: nothing loaded belongs to it.
  useEffect(() => {
    const running = inflight.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
      queue.current = [];
      tasksRef.current = new Map();
      setTasksState(tasksRef.current);
    };
  }, [slug]);

  return {
    sprints,
    tasks: (key) => tasks.get(key),
    reload: () => {
      setAttempt((n) => n + 1);
    },
  };
}
