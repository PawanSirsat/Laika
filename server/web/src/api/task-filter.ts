import { PRIORITIES, type Task, type TaskFilter, type TaskPriority } from './tasks.ts';

/**
 * The board's filter, applied to the project's one task set (LAI-724).
 *
 * The board used to send this to the server and walk the answer — a second
 * walk beside the sprint strip's whole-project one, so the List walked the
 * project twice and every filter change walked it again. The set is now held
 * once per project (`task-store.ts`), and a filter is a reading of it.
 *
 * **It must mean exactly what `listTasks`'s `WHERE` means**
 * (`server/src/services/tasks.ts`), and `task-filter.test.ts` pins each clause:
 * equality on status, priority, assignee and sprint, with `none` for null as
 * over a query string; `ready` as the server served it, never recomputed
 * (§4.5); a tag by its normalised name (`normaliseTagName` trims and
 * lower-cases); `updated_at` at or after `updated_since`; children of `parent`.
 * Every field the type gains must be handled here, or it would be accepted and
 * ignored — LAI-069's failure, in memory instead of on the wire.
 *
 * Order is the set's own, which is the server's (`updated_at`, then id).
 */
export function matchesTaskFilter(task: Task, filter: TaskFilter): boolean {
  if (filter.status !== undefined && task.status !== filter.status) return false;
  if (filter.priority !== undefined && task.priority !== filter.priority) return false;
  if (filter.assignee !== undefined) {
    const want = filter.assignee === 'none' ? null : filter.assignee;
    if (task.assignee_id !== want) return false;
  }
  if (filter.sprint !== undefined) {
    const want = filter.sprint === 'none' ? null : filter.sprint;
    if (task.sprint_id !== want) return false;
  }
  if (filter.ready !== undefined && task.ready !== filter.ready) return false;
  if (filter.tag !== undefined && !task.tags.includes(filter.tag.trim().toLowerCase()))
    return false;
  if (filter.updated_since !== undefined && task.updated_at < filter.updated_since) return false;
  if (filter.parent !== undefined && task.parent_task_id !== filter.parent) return false;
  return true;
}

/** Fields that narrow the set, as opposed to paging it. */
const NARROWING = [
  'status',
  'priority',
  'assignee',
  'sprint',
  'ready',
  'tag',
  'updated_since',
  'parent',
] as const satisfies readonly (keyof TaskFilter)[];

/**
 * **A field added to `TaskFilter` and not listed above fails to compile here**,
 * so it cannot be accepted and silently ignored (LAI-069).
 */
type Unhandled = Exclude<keyof TaskFilter, 'limit' | 'cursor' | (typeof NARROWING)[number]>;
export const EVERY_FILTER_FIELD_HANDLED: [Unhandled] extends [never] ? true : never = true;

/** The tasks matching `filter`, in the set's order. No filter returns the set itself. */
export function applyTaskFilter(tasks: readonly Task[], filter: TaskFilter): readonly Task[] {
  if (NARROWING.every((key) => filter[key] === undefined)) return tasks;
  return tasks.filter((task) => matchesTaskFilter(task, filter));
}

/**
 * **The values the server accepts, so a bad one is said rather than drawn as
 * an empty board** (LAI-724 review, S4a). Sent to the server, an unknown
 * `?priority=` was a `400` and a malformed `?tag=` a `422`, and the board showed
 * the error; filtered in memory, the same URL matched nothing and looked like a
 * board with no work. `BoardScreen` checks both and says which value it is
 * ignoring.
 *
 * `TAG_NAME` is `server/src/services/tags.ts`'s, character for character —
 * `task-filter.test.ts` reads the server's and fails if they drift.
 */
export const TAG_NAME = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function isPriority(value: string): value is TaskPriority {
  return (PRIORITIES as readonly string[]).includes(value);
}

/** After the server's own normalisation: trimmed and lower-cased. */
export function isTagName(value: string): boolean {
  return TAG_NAME.test(value.trim().toLowerCase());
}
