import { DAY_MS, isOverdue, startOfUtcDay } from '../../../api/date-only.ts';
import { PRIORITIES, type Task, type TaskPriority } from '../../../api/tasks.ts';
import { blockedTasks } from './dashboard-derive.ts';

/**
 * The summary's arithmetic (LAI-711, D-072) — the numbers Jira's project
 * Summary page shows, from the task list the dashboard already loads.
 *
 * Kept beside `dashboard-derive.ts` rather than in it: that module's tests pin
 * the feed's vocabulary and the blocked rule, and this is a different concern —
 * how the open work divides up.
 */

/** Work that still means something to do: not finished, not dropped. */
export function isOpen(task: Pick<Task, 'status'>): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

export interface WindowCounts {
  /** Tasks changed at or after the start of the range. */
  readonly updated: number;
  /** Tasks created at or after the start of the range. */
  readonly created: number;
  /** Open work due from today through the next six days — a week, today included. */
  readonly dueSoon: number;
  /** Open work past its date ({@link isOverdue}, the board's own rule). */
  readonly overdue: number;
}

/**
 * The stat cards beside "done".
 *
 * **Done is not here.** It is the server's answer — the sum of `/metrics`
 * throughput for the same window — so the card and the throughput chart can
 * never disagree. `since` of `undefined` is all time, and then updated and
 * created are simply every task.
 *
 * Due soon looks **forward** a week whatever the range: the range says how far
 * back to look, and nothing due in the past is "soon".
 */
export function windowCounts(
  tasks: readonly Task[],
  since: number | undefined,
  now: number,
): WindowCounts {
  const from = since ?? Number.NEGATIVE_INFINITY;
  const today = startOfUtcDay(now);
  const horizon = today + 7 * DAY_MS;

  let updated = 0;
  let created = 0;
  let dueSoon = 0;
  let overdue = 0;
  for (const task of tasks) {
    if (task.updated_at >= from) updated += 1;
    if (task.created_at >= from) created += 1;
    if (isOverdue(task, now)) overdue += 1;
    else if (
      isOpen(task) &&
      task.due_on !== null &&
      task.due_on >= today &&
      task.due_on < horizon
    ) {
      dueSoon += 1;
    }
  }
  return { updated, created, dueSoon, overdue };
}

/** What `/metrics` says was finished in the window. */
export function completedIn(throughput: readonly { readonly completed: number }[]): number {
  return throughput.reduce((sum, day) => sum + day.completed, 0);
}

export const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'review'] as const;
export type OpenStatus = (typeof OPEN_STATUSES)[number];

export interface PersonLoad {
  /** A person, everyone past the cut folded together, or nobody. */
  readonly kind: 'person' | 'others' | 'unassigned';
  /** The user id, or `others` / `unassigned`. */
  readonly id: string;
  /** Who the row stands for: the one person, or everyone folded into Others. */
  readonly people: readonly string[];
  readonly count: number;
  readonly byStatus: Readonly<Record<OpenStatus, number>>;
  /** Of `count`, how many wait on unfinished work ({@link blockedTasks}). */
  readonly blocked: number;
}

export interface Workload {
  readonly rows: readonly PersonLoad[];
  /** All open work — the donut's centre, and the sum of every row. */
  readonly open: number;
}

/** People shown by name before the rest fold into "Others". */
export const MAX_PEOPLE = 5;

function emptyStatus(): Record<OpenStatus, number> {
  return { backlog: 0, todo: 0, in_progress: 0, review: 0 };
}

/**
 * **Open work, divided by who holds it** — the owner's "person-wise divide",
 * Jira's Team workload.
 *
 * Open work rather than every task: a person with forty finished tasks is not
 * carrying forty tasks. The old panel counted `in_progress` alone, so 346 tasks
 * read as "two people, one each" — the opposite mistake.
 *
 * Heaviest first, by name on a tie so the order is stable. Past
 * {@link MAX_PEOPLE} the rest fold into one **Others** row rather than a
 * rainbow of slivers. **Unassigned** is always its own row and always last: it
 * is the work nobody holds, and it must not hide inside "Others".
 */
export function workloadByPerson(
  tasks: readonly Task[],
  nameOf: (id: string) => string = (id) => id,
  max: number = MAX_PEOPLE,
): Workload {
  const blocked = new Set(blockedTasks(tasks).map((row) => row.task.id));
  const byPerson = new Map<string, { byStatus: Record<OpenStatus, number>; blocked: number }>();
  const unassigned = { byStatus: emptyStatus(), blocked: 0 };
  let open = 0;

  for (const task of tasks) {
    if (!isOpen(task)) continue;
    const status = task.status as OpenStatus;
    open += 1;
    let slot = unassigned;
    if (task.assignee_id !== null) {
      slot = byPerson.get(task.assignee_id) ?? { byStatus: emptyStatus(), blocked: 0 };
      byPerson.set(task.assignee_id, slot);
    }
    slot.byStatus[status] += 1;
    if (blocked.has(task.id)) slot.blocked += 1;
  }

  const total = (s: Record<OpenStatus, number>): number =>
    OPEN_STATUSES.reduce((sum, key) => sum + s[key], 0);

  const people: PersonLoad[] = [...byPerson]
    .map(([id, slot]) => ({
      kind: 'person' as const,
      id,
      people: [id],
      count: total(slot.byStatus),
      byStatus: slot.byStatus,
      blocked: slot.blocked,
    }))
    .sort((a, b) => b.count - a.count || nameOf(a.id).localeCompare(nameOf(b.id)));

  const rows: PersonLoad[] = people.slice(0, max);
  const rest = people.slice(max);
  if (rest.length > 0) {
    const byStatus = emptyStatus();
    for (const row of rest) for (const key of OPEN_STATUSES) byStatus[key] += row.byStatus[key];
    rows.push({
      kind: 'others',
      id: 'others',
      people: rest.map((row) => row.id),
      count: total(byStatus),
      byStatus,
      blocked: rest.reduce((sum, row) => sum + row.blocked, 0),
    });
  }
  const nobody = total(unassigned.byStatus);
  if (nobody > 0) {
    rows.push({
      kind: 'unassigned',
      id: 'unassigned',
      people: [],
      count: nobody,
      byStatus: unassigned.byStatus,
      blocked: unassigned.blocked,
    });
  }
  return { rows, open };
}

export interface PriorityCount {
  readonly priority: TaskPriority;
  readonly count: number;
}

/** Open work per priority, in the order the board ranks them. */
export function priorityBreakdown(tasks: readonly Task[]): PriorityCount[] {
  return PRIORITIES.map((priority) => ({
    priority,
    count: tasks.filter((t) => isOpen(t) && t.priority === priority).length,
  }));
}

/** Quiet for this many days and still open: the product's one definition of stale. */
export const STALE_DAYS = 5;

/**
 * **Every** stale task, oldest first.
 *
 * The old panel cut the list to five and then counted the cut, so its header
 * could never say more than 5. The count is the list's length; how many rows
 * to draw is the screen's business.
 */
export function staleTasks(tasks: readonly Task[], now: number): Task[] {
  return tasks
    .filter((t) => isOpen(t) && now - t.updated_at > STALE_DAYS * DAY_MS)
    .sort((a, b) => a.updated_at - b.updated_at);
}

function localDayStart(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The heading over a day's activity: `Today`, `Yesterday`, then the date.
 *
 * **The reader's own day**, not UTC's. Due dates are date-only and read in UTC
 * (D-066); activity is an instant, and "today" for something that happened at
 * 2am in Pune is Pune's today.
 */
export function dayHeading(ts: number, now: number): string {
  const today = localDayStart(now);
  const day = localDayStart(ts);
  if (day >= today) return 'Today';
  if (day >= localDayStart(today - 1)) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
