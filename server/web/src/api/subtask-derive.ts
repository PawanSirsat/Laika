import type { Task } from './tasks.ts';

/**
 * Subtasks, read off the loaded page (D-066).
 *
 * A derive module, not a renderer (CONVENTIONS §4): which rows are a task's
 * children, which task is a child's parent, and how far along a parent is,
 * are decisions with edges — a cancelled child, a parent off the page — and
 * edges are what a test pins without a browser.
 */

/** This task's subtasks, in key order. */
export function childrenOf(taskId: string, byId: ReadonlyMap<string, Task>): readonly Task[] {
  return [...byId.values()]
    .filter((t) => t.parent_task_id === taskId)
    .sort((a, b) => a.number - b.number);
}

/** The parent, when it is on this page. A child's parent can be filtered off it. */
export function parentOf(task: Task, byId: ReadonlyMap<string, Task>): Task | undefined {
  return task.parent_task_id === null ? undefined : byId.get(task.parent_task_id);
}

export interface SubtaskProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * `n/m done` — the same rule as the server's `subtaskProgress`, so the bar in
 * the drawer and the figure `get_task_context` prints cannot disagree:
 * `done` counts the children at `done`, `total` leaves out `cancelled`
 * (dropped work is not undone work). `undefined` when there is nothing to
 * count, so a card draws no marker rather than `0/0`.
 */
export function subtaskProgress(children: readonly Task[]): SubtaskProgress | undefined {
  const counted = children.filter((t) => t.status !== 'cancelled');
  if (counted.length === 0) return undefined;
  return { done: counted.filter((t) => t.status === 'done').length, total: counted.length };
}
