/**
 * "What this delivers" (§4.5, §11.4.2.1, LAI-1115, LAI-1117) — the pure half of
 * the panel: its progress line, what it says about the tasks this one blocks,
 * and the edits it sends. Nothing here invents a deliverable: a task the
 * server sent none for draws nothing (D-032).
 */

import type {
  Deliverable,
  DeliverableEdit,
  DeliverableState,
  TaskStatus,
  TaskSummary,
} from '../../../api/tasks.ts';

/** Whether the panel has anything to draw: a field absent or all three empty is nothing. */
export function hasDelivers(task: {
  readonly deliverables?: readonly Deliverable[];
  readonly solves?: readonly string[];
  readonly unlocks?: readonly string[];
}): boolean {
  return (
    (task.deliverables?.length ?? 0) > 0 ||
    (task.solves?.length ?? 0) > 0 ||
    (task.unlocks?.length ?? 0) > 0
  );
}

/**
 * The line beside *What this delivers*: `2 of 4 built · Parser in progress`,
 * `4 of 4 built · waiting for approval` while in review, `0 of 3 built · not
 * started` before any moved. `null` with no Ships items.
 */
export function progressLine(items: readonly Deliverable[], status: TaskStatus): string | null {
  if (items.length === 0) return null;
  const done = items.filter((d) => d.state === 'done').length;
  const head = `${String(done)} of ${String(items.length)} built`;
  if (done === items.length) return status === 'review' ? `${head} · waiting for approval` : head;
  const working = items.find((d) => d.state === 'in_progress');
  if (working !== undefined) return `${head} · ${working.title} in progress`;
  return done === 0 ? `${head} · not started` : head;
}

/** The words a state's mark carries for a reader who cannot see its colour. */
export const STATE_WORDS: Record<DeliverableState, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  done: 'Built',
};

export type BlocksLine =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'tasks';
      readonly tasks: readonly {
        readonly id: string;
        readonly key: string;
        readonly title: string;
      }[];
      /** Blocked tasks outside the set the board holds: counted, never guessed at. */
      readonly unknown: number;
    };

/** *Blocks no other tasks*, or the tasks this one blocks that the board knows. */
export function blocksLine(
  blocks: readonly string[],
  byId: ReadonlyMap<string, Pick<TaskSummary, 'id' | 'key' | 'title'>>,
): BlocksLine {
  if (blocks.length === 0) return { kind: 'none' };
  const tasks = blocks
    .map((id) => byId.get(id))
    .filter((t): t is Pick<TaskSummary, 'id' | 'key' | 'title'> => t !== undefined)
    .map((t) => ({ id: t.id, key: t.key, title: t.title }));
  return { kind: 'tasks', tasks, unknown: blocks.length - tasks.length };
}

/** The list as `PATCH` takes it back: every item keeps its id, and so its state. */
export function deliverableEdits(items: readonly Deliverable[]): DeliverableEdit[] {
  return items.map((d) => ({ id: d.id, title: d.title, detail: d.detail }));
}

/** Lines typed one per row, as a person edits Solves or Unlocks: trimmed, blanks dropped. */
export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
