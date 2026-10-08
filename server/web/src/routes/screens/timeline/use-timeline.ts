import { useCallback, useEffect, useRef, useState } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { listTasks, type Task } from '../../../api/tasks.ts';

export type SprintsLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly sprints: readonly Sprint[] };

/** One sprint's tasks, or the unscheduled ones (`none`), fetched on demand. */
export type TasksLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly tasks: readonly Task[] };

export interface UseTimeline {
  readonly sprints: SprintsLoad;
  /** A sprint id, or `none` for tasks in no sprint; `undefined` until asked for. */
  readonly tasks: (key: string) => TasksLoad | undefined;
  /** Fetch that key's tasks once. Asking again while loaded or loading is a no-op. */
  readonly load: (key: string) => void;
  readonly reload: () => void;
}

/**
 * The Timeline's data, **on demand** (LAI-721).
 *
 * Only the sprint list loads up front. A sprint's tasks are fetched with the
 * tasks endpoint's existing `?sprint=` filter when that sprint is opened, and
 * the unscheduled tray's with `?sprint=none` when it is. The screen this
 * replaces read `useSprints`, which walks every task in the project, with full
 * markdown, before drawing anything — for a chart that, by the owner's own
 * ask, shows sprints and not tasks.
 *
 * The cost is that a sprint's progress is known only once it has been opened:
 * sprints carry no counts and the tasks endpoint has no count or field
 * projection. *Expand all* is an explicit request for every sprint's tasks.
 */
export function useTimeline(slug: string | undefined): UseTimeline {
  const [sprints, setSprints] = useState<SprintsLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [tasks, setTasks] = useState<ReadonlyMap<string, TasksLoad>>(new Map());
  /** Requests in flight, aborted when the project changes or the screen goes. */
  const inflight = useRef(new Map<string, AbortController>());
  /** What `load` has already been asked for, read synchronously. */
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    setSprints({ status: 'loading' });
    setTasks(new Map());
    asked.current = new Set();

    everyPage((cursor) =>
      listSprints(
        slug,
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        setSprints({ status: 'ready', sprints: items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSprints({ status: 'error', error });
      });

    const pending = inflight.current;
    return () => {
      controller.abort();
      for (const request of pending.values()) request.abort();
      pending.clear();
    };
  }, [slug, attempt]);

  const load = useCallback(
    (key: string): void => {
      if (slug === undefined || asked.current.has(key)) return;
      asked.current.add(key);
      const controller = new AbortController();
      inflight.current.set(key, controller);
      setTasks((current) => new Map(current).set(key, { status: 'loading' }));

      everyPage((cursor) =>
        listTasks(
          slug,
          cursor === undefined ? { sprint: key, limit: 200 } : { sprint: key, limit: 200, cursor },
          controller.signal,
        ),
      )
        .then(({ items }) => {
          setTasks((current) => new Map(current).set(key, { status: 'ready', tasks: items }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // Forget it, so opening the sprint again is a retry.
          asked.current.delete(key);
          setTasks((current) => new Map(current).set(key, { status: 'error', error }));
        })
        .finally(() => {
          inflight.current.delete(key);
        });
    },
    [slug],
  );

  return {
    sprints,
    tasks: (key) => tasks.get(key),
    load,
    reload: () => {
      setAttempt((n) => n + 1);
    },
  };
}
