import { useCallback, useEffect, useState } from 'react';
import { everyPage } from '../../api/every-page.ts';
import { getProject } from '../../api/projects.ts';
import { listSprints, type Sprint } from '../../api/sprints.ts';
import { changeStatus, getTask, type TaskSummary } from '../../api/tasks.ts';
import { reloadProjectTasks } from '../../api/use-project-tasks.ts';
import { useAction } from '../toast/use-action.ts';

/*
 * **The space reads a task's panel needs when no view offers them**
 * (LAI-1190), shared by the drawer host and the Workroom page (LAI-1199) so
 * the two frames read a task the same way. Moved here unchanged from
 * `TaskDrawerHost.tsx`.
 */

/** Every sprint in the space, for the panel's sprint control. */
export function useSprints(slug: string | undefined): readonly Sprint[] {
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  useEffect(() => {
    setSprints([]);
    if (slug === undefined) return;
    const controller = new AbortController();
    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) setSprints(items);
      })
      .catch(() => {
        // No sprints to offer rather than wrong ones.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  return sprints;
}

/** The space's `agents_allowed`; `undefined` (allowed) until it answers. */
export function useAgentsAllowed(slug: string | undefined): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setAllowed(undefined);
    if (slug === undefined) return;
    const controller = new AbortController();
    getProject(slug, controller.signal)
      .then((project) => {
        if (!controller.signal.aborted) setAllowed(project.agents_allowed);
      })
      .catch(() => {
        // The Agent row then reads as allowed, and the server still decides.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  return allowed;
}

/** `GET /tasks/:id` for a task the set does not hold. */
export function useTaskRead(taskId: string | undefined): {
  readonly task: TaskSummary | undefined;
  readonly error: unknown;
  readonly retry: () => void;
} {
  const [state, setState] = useState<{
    readonly id: string;
    readonly task?: TaskSummary;
    readonly error?: unknown;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (taskId === undefined) return;
    const controller = new AbortController();
    setState({ id: taskId });
    getTask(taskId, controller.signal)
      .then((task) => {
        if (!controller.signal.aborted) setState({ id: taskId, task });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ id: taskId, error });
      });
    return () => {
      controller.abort();
    };
  }, [taskId, attempt]);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const current = taskId !== undefined && state?.id === taskId ? state : undefined;
  return { task: current?.task, error: current?.error, retry };
}

/**
 * Moving a task from the drawer when the view offers no store of its own: the
 * same `POST /tasks/:id/status` the board's move makes, then the shared set
 * is read again so the view under the drawer follows.
 *
 * It ends in a toast (LAI-1310): *LAI-12 moved to Review*, with Undo back to
 * the status it left when the caller says which — the same call, so the
 * server really reverses it — or the server's refusal, which used to be a
 * banner above the description.
 */
export function useLocalMoves(slug: string | undefined) {
  const [movingId, setMovingId] = useState<string | undefined>(undefined);
  const { run } = useAction();
  const onMove = useCallback(
    (taskId: string, toStatusId: string, fromStatusId?: string): void => {
      setMovingId(taskId);
      void run({
        do: () => changeStatus(taskId, { status_id: toStatusId }),
        success: (moved) => `${moved.key} moved to ${moved.status_name}`,
        failure: 'Couldn’t move the task',
        undo:
          fromStatusId === undefined
            ? undefined
            : async () => {
                const back = await changeStatus(taskId, { status_id: fromStatusId });
                reloadProjectTasks(slug);
                return `${back.key} back in ${back.status_name}`;
              },
      }).then((moved) => {
        setMovingId(undefined);
        if (moved !== undefined) reloadProjectTasks(slug);
      });
    },
    [slug, run],
  );
  return { movingId, onMove };
}
