import { groupByColumn, type Lane } from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import type { Member, Task } from '../../../api/tasks.ts';

/**
 * Grouping the board into swimlanes (LAI-290).
 *
 * ## What this got wrong the first time
 *
 * LAI-266 shipped grouping that returned **one lane per group**, so choosing
 * "group by assignee" made the status columns disappear and replaced them with
 * a column per person. That is not what grouping means on a board.
 *
 * Jira — and every board that has this — keeps the columns and repeats them
 * inside a **row** per group. `Pawan Sirsat (14)` is a collapsible band, and
 * inside it are Backlog · To Do · In Progress · Done, holding only his cards.
 * The columns are the project's real columns in every row; only the tasks
 * differ.
 *
 * So this module returns rows, and the lanes inside each row come from the same
 * `groupByColumn` the ungrouped board uses. One renderer, one lane type, and
 * the grouped board cannot drift from the plain one.
 *
 * ## Dragging
 *
 * Between columns **inside** a swimlane: on, and it means status, exactly as
 * ungrouped. Between swimlanes: off — that would mean reassigning, which is a
 * different endpoint with a different permission and no keyboard equivalent
 * (LAI-288).
 */

export type GroupBy = 'assignee' | 'priority' | 'sprint';

export function isGroupBy(value: string | undefined): value is GroupBy {
  return value === 'assignee' || value === 'priority' || value === 'sprint';
}

export interface Swimlane {
  /** `''` for the Unassigned / No sprint row. Stable across renders. */
  readonly key: string;
  readonly name: string;
  /** A user id, when grouping by assignee, so the row can draw a face. */
  readonly avatarId?: string | undefined;
  /** Every card in this row, across all its columns. */
  readonly count: number;
  readonly lanes: readonly Lane[];
}

export interface GroupOptions {
  readonly members: ReadonlyMap<string, Member>;
  readonly sprintLabels: ReadonlyMap<string, { readonly label: string; readonly active: boolean }>;
}

interface Bucket {
  name: string;
  avatarId?: string | undefined;
  tasks: Task[];
}

function bucketFor(
  task: Task,
  by: GroupBy,
  options: GroupOptions,
): { key: string; bucket: Bucket } {
  if (by === 'assignee') {
    if (task.assignee_id === null) {
      return { key: '', bucket: { name: 'Unassigned', tasks: [] } };
    }
    return {
      key: task.assignee_id,
      bucket: {
        name: options.members.get(task.assignee_id)?.name ?? 'Someone else',
        avatarId: task.assignee_id,
        tasks: [],
      },
    };
  }

  if (by === 'priority') {
    return { key: task.priority, bucket: { name: task.priority.toUpperCase(), tasks: [] } };
  }

  if (task.sprint_id === null) return { key: '', bucket: { name: 'No sprint', tasks: [] } };
  return {
    key: task.sprint_id,
    bucket: { name: options.sprintLabels.get(task.sprint_id)?.label ?? 'Sprint', tasks: [] },
  };
}

/**
 * Split the board into rows, each holding the whole column set.
 *
 * A group with no cards does not appear — a board grouped by assignee should
 * not draw a row for everybody in the org who happens to have no work.
 */
export function groupSwimlanes(
  tasks: readonly Task[],
  by: GroupBy,
  columns: readonly BoardColumn[],
  options: GroupOptions,
): Swimlane[] {
  const buckets = new Map<string, Bucket>();

  for (const task of tasks) {
    const { key, bucket } = bucketFor(task, by, options);
    const found = buckets.get(key);
    if (found === undefined) buckets.set(key, { ...bucket, tasks: [task] });
    else found.tasks.push(task);
  }

  const entries = [...buckets.entries()];

  entries.sort(([leftKey, left], [rightKey, right]) => {
    /*
     * **Unassigned and No sprint go last** (LAI-296).
     *
     * They led until the owner asked for busiest-first, and leading was wrong
     * for a reason worth keeping: the `''` bucket is **not a person and its
     * pile is not a workload**. Sorted among people by count it would claim
     * nobody is busier than Ada, which is a sentence about a bucket. It is a
     * bucket, so it sits at the end whatever its size.
     */
    if (leftKey === '' && rightKey !== '') return 1;
    if (rightKey === '' && leftKey !== '') return -1;

    // Priority is an ordered vocabulary, so p1 → p3 beats any count ordering.
    if (by === 'priority') return leftKey.localeCompare(rightKey);

    /*
     * **Busiest first, and it follows the filter for free.** `tasks` here is
     * already the filtered set — the counts are of what the board is showing,
     * so narrowing to one sprint reorders the rows by that sprint's workload
     * without this function knowing a filter exists.
     */
    if (left.tasks.length !== right.tasks.length) return right.tasks.length - left.tasks.length;

    // Ties by name, so the order is stable rather than insertion-dependent.
    return left.name.localeCompare(right.name);
  });

  return entries.map(([key, bucket]) => ({
    key,
    name: bucket.name,
    avatarId: bucket.avatarId,
    count: bucket.tasks.length,
    // The same function the ungrouped board uses, against the same columns.
    lanes: groupByColumn(bucket.tasks, columns),
  }));
}

/** What the board says about dragging while grouped. */
export function groupNotice(by: GroupBy): string {
  return `Grouped by ${by}. Cards move between columns as usual; dragging between rows is not a move.`;
}
