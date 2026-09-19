import { statusLabel, type Lane } from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import type { Member, Task } from '../../../api/tasks.ts';

/**
 * Re-lane the board by something other than its columns (LAI-266).
 *
 * Returns the **same `Lane[]`** the column path returns, so there is one lane
 * type and one renderer. The synthetic `BoardColumn` each group carries is not
 * a real row and never reaches the API — `KanbanView` only reads `name`,
 * `statuses` and `id` from it.
 *
 * **These views are read-only, and that is a decision rather than an omission
 * (LAI-288).** A drop under group-by is not one operation: status goes through
 * `POST /tasks/:id/status` with its own validation, assignment through `PATCH`
 * or the compare-and-swap `POST /claim`, priority through `updateTask` — three
 * endpoints, three permission checks, three failure messages. And the keyboard
 * equivalent is unsolved: `.lane-move` is a select *of statuses*, so under
 * group-by-assignee a card would offer a keyboard move that lands somewhere
 * other than where the identical drag would. Shipping the pointer half alone is
 * what `board.css`'s existing rule forbids.
 */

export type GroupBy = 'column' | 'assignee' | 'priority' | 'sprint';

export function isGroupBy(value: string | undefined): value is GroupBy {
  return value === 'assignee' || value === 'priority' || value === 'sprint';
}

/** A lane that is not a column. `statuses` is empty — nothing drops here. */
function synthetic(id: string, name: string, position: number): BoardColumn {
  return {
    id: `group:${id}`,
    project_id: '',
    name,
    position,
    hidden: false,
    statuses: [],
    primary_status: null,
  };
}

export interface GroupOptions {
  readonly members: ReadonlyMap<string, Member>;
  readonly sprintLabels: ReadonlyMap<string, { readonly label: string; readonly active: boolean }>;
}

export function groupLanes(tasks: readonly Task[], by: GroupBy, options: GroupOptions): Lane[] {
  const buckets = new Map<string, { name: string; tasks: Task[] }>();
  const keyFor = (task: Task): { key: string; name: string } => {
    if (by === 'assignee') {
      if (task.assignee_id === null) return { key: '', name: 'Unassigned' };
      return {
        key: task.assignee_id,
        name: options.members.get(task.assignee_id)?.name ?? 'Someone else',
      };
    }
    if (by === 'priority') return { key: task.priority, name: task.priority.toUpperCase() };

    if (task.sprint_id === null) return { key: '', name: 'No sprint' };
    return {
      key: task.sprint_id,
      name: options.sprintLabels.get(task.sprint_id)?.label ?? 'Sprint',
    };
  };

  for (const task of tasks) {
    const { key, name } = keyFor(task);
    const found = buckets.get(key);
    if (found === undefined) buckets.set(key, { name, tasks: [task] });
    else found.tasks.push(task);
  }

  const entries = [...buckets.entries()];

  entries.sort(([leftKey, left], [rightKey, right]) => {
    // **Unassigned and No sprint lead**, because that is the pile somebody
    // opened this view to act on.
    if (leftKey === '' && rightKey !== '') return -1;
    if (rightKey === '' && leftKey !== '') return 1;
    // Priority sorts p1 → p3; everything else by name.
    if (by === 'priority') return leftKey.localeCompare(rightKey);
    return left.name.localeCompare(right.name);
  });

  return entries.map(([key, bucket], index) => ({
    column: synthetic(key === '' ? 'none' : key, bucket.name, index),
    tasks: [...bucket.tasks].sort(
      (a, b) => a.priority.localeCompare(b.priority) || a.number - b.number,
    ),
  }));
}

/** What the board says when a grouped view has switched drag off. */
export function groupNotice(by: GroupBy): string {
  return `Grouped by ${by === 'column' ? 'column' : by} — drag is off. Change a task from its card menu or the task panel.`;
}

/** Used by the empty-lane copy so a grouped lane does not talk about statuses. */
export function isSyntheticColumn(column: BoardColumn): boolean {
  return column.id.startsWith('group:');
}

export { statusLabel };
