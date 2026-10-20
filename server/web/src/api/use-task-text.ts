import { useCallback, useEffect, useState } from 'react';
import { getTask, type Task, type TaskSummary } from './tasks.ts';

/**
 * A task's description and acceptance, for the panel (LAI-795).
 *
 * Every list is slim, so the panel is the one place that holds a task in full.
 * It reads `GET /tasks/:id` when it opens, and again when the store's copy of
 * the task is newer than the one it holds: the texts change only by a `PATCH`,
 * and a `PATCH` always moves `updated_at`. Meanwhile it keeps drawing what it
 * has — a live frame about the task re-reads behind the text on screen and
 * never blanks it — and says it is `stale`, so the panel does not let it be
 * edited until the newer version is in hand.
 */

/** Read again: nothing is held for this task, or the store has a newer version. */
export function needsText(
  summary: Pick<TaskSummary, 'id' | 'updated_at'>,
  held: Task | undefined,
): boolean {
  return held?.id !== summary.id || held.updated_at < summary.updated_at;
}

/**
 * What the panel draws: the store's fields, which are live, with the texts
 * held. `undefined` while this task's texts are unread — never another task's.
 */
export function withText(summary: TaskSummary, held: Task | undefined): Task | undefined {
  if (held?.id !== summary.id) return undefined;
  return { ...summary, description_md: held.description_md, acceptance_md: held.acceptance_md };
}

export interface TaskText {
  /** The task with its texts, or `undefined` until this task's first answer. */
  readonly task: Task | undefined;
  /**
   * **The texts held are known to be out of date** — the store has a newer
   * version, and its read is under way or failed (LAI-795 review, B1). Never
   * edited while true: a save would send the old text over the newer one.
   */
  readonly stale: boolean;
  /** The `updated_at` of the texts held: the version an edit begins from. */
  readonly version: number | undefined;
  /** Why the last read of this task failed, or `null`. */
  readonly error: unknown;
  readonly retry: () => void;
  /** A write's answer: held as the newest texts, so they are not read again. */
  readonly accept: (task: Task) => void;
}

/**
 * @param listReadAt when the list was last read (`asOf`). After a failed read,
 *   every refresh is a reason to read again — **including one that did not
 *   move this task**, or a 5xx during a restart would leave the old text on
 *   screen for good (review B1).
 */
export function useTaskText(summary: TaskSummary, listReadAt: number | null): TaskText {
  const [held, setHeld] = useState<Task | undefined>(undefined);
  const [failed, setFailed] = useState<{ readonly id: string; readonly cause: unknown } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const stale = needsText(summary, held);
  const error = failed?.id === summary.id ? failed.cause : null;

  useEffect(() => {
    if (!stale) return undefined;
    const controller = new AbortController();
    setFailed(null);
    getTask(summary.id, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setHeld(found);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailed({ id: summary.id, cause });
      });
    return () => {
      controller.abort();
    };
    // `stale` stays true when an answer is older than the store's copy; the
    // deps then do not change, so it is not read again in a loop.
  }, [summary.id, summary.updated_at, stale, attempt]);

  // Its own effect, on the refresh alone: in the read's deps, the failure
  // itself would change them and read again at once.
  useEffect(() => {
    if (error !== null) setAttempt((n) => n + 1);
  }, [listReadAt]);

  const retry = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);
  const accept = useCallback((task: Task): void => {
    setHeld(task);
  }, []);

  return {
    task: withText(summary, held),
    stale,
    version: held?.id === summary.id ? held.updated_at : undefined,
    error,
    retry,
    accept,
  };
}
