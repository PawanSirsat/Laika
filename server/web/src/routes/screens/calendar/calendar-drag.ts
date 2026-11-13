import { ApiError } from '../../../api/errors.ts';
import { taskStore } from '../../../api/store.ts';
import { toSummary, updateTask, type TaskSummary } from '../../../api/tasks.ts';

/**
 * Moving a task to another day (LAI-1178): its `due_on`, through the task
 * edit every other surface uses (`PATCH /tasks/:id`), shown at once and put
 * back if the server refuses — the board's way of writing (`use-board.ts`'s
 * `place`), so a refresh read before the answer never undoes it.
 */

/** What a drag carries between a chip and a day. */
export const DRAG_TYPE = 'application/x-laika-task';

/**
 * Put `task` on `dueOn` (a date-only UTC midnight, D-066). Resolves with the
 * error message on a refusal, or undefined when the move landed.
 */
export async function moveDue(
  slug: string,
  task: TaskSummary,
  dueOn: number | null,
): Promise<string | undefined> {
  if (task.due_on === dueOn) return undefined;
  const replace = (next: TaskSummary, settled: boolean, record?: string): void => {
    taskStore.writeLocal(slug, (tasks) => tasks.map((t) => (t.id === next.id ? next : t)), {
      changed: new Set([task.id]),
      settled: settled ? task.id : undefined,
      record,
    });
  };
  taskStore.beginWrite(slug, task.id);
  replace({ ...task, due_on: dueOn }, false);
  try {
    const answer = await updateTask(task.id, { due_on: dueOn });
    replace(toSummary(answer), true, task.id);
    return undefined;
  } catch (cause) {
    replace(task, true);
    if (cause instanceof ApiError && cause.code === 'conflict') taskStore.reload(slug);
    return cause instanceof ApiError ? cause.message : 'That move could not be saved.';
  } finally {
    taskStore.endWrite(slug, task.id);
  }
}
