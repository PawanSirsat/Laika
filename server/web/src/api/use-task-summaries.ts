import { useCallback, useMemo } from 'react';
import type { TaskSummary } from './tasks.ts';
import type { TaskSetSnapshot } from './task-store.ts';
import { reloadProjectTasks, useProjectTasks } from './use-project-tasks.ts';

/**
 * A space's live tasks, as a screen that only lists them reads them (LAI-1128).
 *
 * Calendar and Activity each turned the task set into a list with the same
 * eight lines — and both turned a **failed read into an empty list**, so a
 * calendar with nothing on it, or "no stale tasks", was what a person saw
 * when the board could not be reached at all (the UX audit's B5). That is a
 * false statement on screen. This keeps the failure a failure:
 *
 * - `loading` until the first answer;
 * - `ok` with the tasks — deleted ones dropped, children kept;
 * - `error` with the cause, for `ApiErrorState`, and `retry` to read again.
 *
 * A refresh that fails after a good read stays `ok`: the set is still the last
 * answer, and the store's own retry on the next live frame covers it.
 */
export type TaskSummaries =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly tasks: readonly TaskSummary[] }
  | { readonly status: 'error'; readonly error: unknown };

/** The mapping, apart from React, so it can be tested on its own. */
export function taskSummariesOf(
  snapshot: Pick<TaskSetSnapshot, 'status' | 'tasks' | 'error'> | undefined,
): TaskSummaries {
  if (snapshot === undefined || snapshot.status === 'loading') return { status: 'loading' };
  if (snapshot.status === 'error') return { status: 'error', error: snapshot.error };
  return {
    status: 'ok',
    tasks: snapshot.tasks.filter((t): t is TaskSummary => !('deleted' in t)),
  };
}

export function useTaskSummaries(
  slug: string | undefined,
): TaskSummaries & { readonly retry: () => void } {
  const set = useProjectTasks(slug);
  const status = set?.status;
  const tasks = set?.tasks;
  const error = set?.error;
  // Keyed on the parts read, not the snapshot: a refresh flag flipping is not
  // a new list, and a new list is what re-renders every chip downstream.
  const summaries = useMemo(
    () =>
      status === undefined || tasks === undefined
        ? taskSummariesOf(undefined)
        : taskSummariesOf({ status, tasks, error }),
    [status, tasks, error],
  );
  const retry = useCallback(() => {
    reloadProjectTasks(slug);
  }, [slug]);
  return useMemo(() => ({ ...summaries, retry }), [summaries, retry]);
}
