import { statusTransition, type ActivityEvent } from '../../../api/activity.ts';
import { DAY_MS, isOverdue, startOfUtcDay } from '../../../api/date-only.ts';
import { PRIORITIES, type TaskSummary, type TaskPriority } from '../../../api/tasks.ts';
import { blockedTasks, type BlockedTask } from './dashboard-derive.ts';

/**
 * The summary's arithmetic (LAI-711, D-072) — the numbers Jira's project
 * Summary page shows, from the task list the dashboard already loads.
 *
 * Kept beside `dashboard-derive.ts` rather than in it: that module's tests pin
 * the feed's vocabulary and the blocked rule, and this is a different concern —
 * how the open work divides up.
 */

/** Work that still means something to do: not finished, not dropped. */
export function isOpen(task: Pick<TaskSummary, 'status'>): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

export interface WindowCounts {
  /**
   * Tasks whose `updated_at` is at or after the start of the range — **touched**,
   * not worked on (LAI-817): a sprint move, a reorder, a branch match or a PR
   * link bumps it as surely as an edit does.
   */
  readonly touched: number;
  /** Tasks created at or after the start of the range. */
  readonly created: number;
  /** Open work due from today through the next six days — a week, today included. */
  readonly dueSoon: number;
  /** Open work past its date ({@link isOverdue}, the board's own rule). */
  readonly overdue: number;
  /** All open work, whatever the range — what {@link dated} is a share of. */
  readonly open: number;
  /** Open work that has a due date at all (LAI-817: OnRoute had 2 of 301). */
  readonly dated: number;
}

/**
 * The stat cards beside "done".
 *
 * **Done is not here.** It is the server's answer — the sum of `/metrics`
 * throughput for the same window — so the card and the throughput chart can
 * never disagree. `since` of `undefined` is all time, and then touched and
 * created are simply every task.
 *
 * Due soon looks **forward** a week whatever the range: the range says how far
 * back to look, and nothing due in the past is "soon".
 */
export function windowCounts(
  tasks: readonly TaskSummary[],
  since: number | undefined,
  now: number,
): WindowCounts {
  const from = since ?? Number.NEGATIVE_INFINITY;
  const today = startOfUtcDay(now);
  const horizon = today + 7 * DAY_MS;

  let touched = 0;
  let created = 0;
  let dueSoon = 0;
  let overdue = 0;
  let open = 0;
  let dated = 0;
  for (const task of tasks) {
    if (task.updated_at >= from) touched += 1;
    if (task.created_at >= from) created += 1;
    if (isOpen(task)) {
      open += 1;
      if (task.due_on !== null) dated += 1;
    }
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
  return { touched, created, dueSoon, overdue, open, dated };
}

/**
 * **Few open tasks carry a date** — fewer than half — so "due soon" speaks for
 * a minority of the work and the tile says so (LAI-817).
 */
export function fewDated(counts: Pick<WindowCounts, 'open' | 'dated'>): boolean {
  return counts.open > 0 && counts.dated * 2 < counts.open;
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
  /**
   * Their **load**: to do and in progress, the work they have committed to —
   * what Capacity counts too (D-092 item 3). Review is not in it (item 2): it
   * waits on the reviewer. Nor is backlog (LAI-832): it is the pipeline.
   */
  readonly count: number;
  readonly byStatus: Readonly<Record<OpenStatus, number>>;
  /** Their work waiting for review — shown beside the row, never in {@link count}. */
  readonly review: number;
  /** Their backlog — shown beside the row, never in {@link count}. */
  readonly backlog: number;
  /** Of `count`, how many wait on unfinished work (the dashboard's blocked rule). */
  readonly blocked: number;
}

export interface Workload {
  readonly rows: readonly PersonLoad[];
  /**
   * Every open task — the donut's centre: the rows, plus {@link backlog}, plus
   * {@link waitingForReview}.
   */
  readonly open: number;
  /** Every open task in review, whoever holds it — the donut's own slice. */
  readonly waitingForReview: number;
  /** Every open task in backlog, whoever holds it — the pipeline, its own slice. */
  readonly backlog: number;
}

export interface WorkloadOptions {
  /**
   * The blocked tasks, judged from the **whole project** (LAI-732). A card's
   * filter can hide a blocker; judged from the filtered few it would read as
   * unknown, which counts as blocked. Without it, judged from `tasks`.
   */
  readonly blockedIds?: ReadonlySet<string> | undefined;
}

/** One person's (or nobody's) running counts while dividing the work. */
interface Slot {
  byStatus: Record<OpenStatus, number>;
  blocked: number;
}

/**
 * People shown by name before the rest fold into "Others" — one per chip hue
 * left once review has orange (LAI-817), so no two slices share a colour.
 */
export const MAX_PEOPLE = 4;

function emptyStatus(): Record<OpenStatus, number> {
  return { backlog: 0, todo: 0, in_progress: 0, review: 0 };
}

/** What they have committed to: to do and in progress (D-092 item 3). */
const committed = (byStatus: Readonly<Record<OpenStatus, number>>): number =>
  byStatus.todo + byStatus.in_progress;

const isCommitted = (status: TaskSummary['status']): boolean =>
  status === 'todo' || status === 'in_progress';

/**
 * **Open work now** (LAI-817, D-092 item 2) — the owner's "person-wise divide",
 * as of now and with no time range.
 *
 * The card this replaced counted open tasks **touched in the range**, review
 * included, by current assignee: Ashutosh's 24 on OnRoute was 14 tasks waiting
 * on a reviewer plus eight to do. So:
 *
 * - **No range.** Open work is a fact about now; a sample of what was touched
 *   this week is not anyone's workload. The caller passes every task.
 * - **Review is split out.** Their work in review is shown beside the count
 *   and drawn as one "waiting for review" share, because it waits on whoever
 *   reviews it.
 * - **Backlog is split out too** (LAI-832, D-092 item 3). A person's count is
 *   their load — to do and in progress, Capacity's rule — and their backlog is
 *   shown beside it and drawn as one "backlog" share: the pipeline. Counted
 *   in, it made 78 read as load where 50 of it was backlog, and the detail
 *   that said so was the first thing a phone cut off.
 *
 * Heaviest first, then most in review, then by name. Past {@link MAX_PEOPLE}
 * the rest fold into one **Others** row. **Unassigned** is always its own row
 * and always last: it is the work nobody holds, and it must not hide inside
 * "Others".
 */
export function workloadByPerson(
  tasks: readonly TaskSummary[],
  nameOf: (id: string) => string = (id) => id,
  max: number = MAX_PEOPLE,
  options: WorkloadOptions = {},
): Workload {
  const blocked = options.blockedIds ?? new Set(blockedTasks(tasks).map((row) => row.task.id));
  const byPerson = new Map<string, Slot>();
  const unassigned: Slot = { byStatus: emptyStatus(), blocked: 0 };
  let open = 0;
  let waitingForReview = 0;
  let backlog = 0;

  for (const task of tasks) {
    if (!isOpen(task)) continue;
    open += 1;
    if (task.status === 'review') waitingForReview += 1;
    if (task.status === 'backlog') backlog += 1;
    let slot = unassigned;
    if (task.assignee_id !== null) {
      slot = byPerson.get(task.assignee_id) ?? { byStatus: emptyStatus(), blocked: 0 };
      byPerson.set(task.assignee_id, slot);
    }
    slot.byStatus[task.status as OpenStatus] += 1;
    if (isCommitted(task.status) && blocked.has(task.id)) slot.blocked += 1;
  }

  const people: PersonLoad[] = [...byPerson]
    .map(([id, slot]) => ({
      kind: 'person' as const,
      id,
      people: [id],
      count: committed(slot.byStatus),
      byStatus: slot.byStatus,
      review: slot.byStatus.review,
      backlog: slot.byStatus.backlog,
      blocked: slot.blocked,
    }))
    .sort(
      (a, b) =>
        b.count - a.count || b.review - a.review || nameOf(a.id).localeCompare(nameOf(b.id)),
    );

  const rows: PersonLoad[] = people.slice(0, max);
  const rest = people.slice(max);
  if (rest.length > 0) {
    const byStatus = emptyStatus();
    for (const row of rest) for (const key of OPEN_STATUSES) byStatus[key] += row.byStatus[key];
    rows.push({
      kind: 'others',
      id: 'others',
      people: rest.map((row) => row.id),
      count: committed(byStatus),
      byStatus,
      review: byStatus.review,
      backlog: byStatus.backlog,
      blocked: rest.reduce((sum, row) => sum + row.blocked, 0),
    });
  }
  if (OPEN_STATUSES.some((key) => unassigned.byStatus[key] > 0)) {
    rows.push({
      kind: 'unassigned',
      id: 'unassigned',
      people: [],
      count: committed(unassigned.byStatus),
      byStatus: unassigned.byStatus,
      review: unassigned.byStatus.review,
      backlog: unassigned.byStatus.backlog,
      blocked: unassigned.blocked,
    });
  }
  return { rows, open, waitingForReview, backlog };
}

export interface PriorityCount {
  readonly priority: TaskPriority;
  readonly count: number;
}

/** Open work per priority, in the order the board ranks them. */
export function priorityBreakdown(tasks: readonly TaskSummary[]): PriorityCount[] {
  return PRIORITIES.map((priority) => ({
    priority,
    count: tasks.filter((t) => isOpen(t) && t.priority === priority).length,
  }));
}

/** Days in review before the wait is worth a line in Needs attention (D-092 item 4). */
export const REVIEW_WAIT_DAYS = 5;

export interface ReviewWait {
  readonly task: TaskSummary;
  /**
   * When it went into review. The move itself, from whichever of two places
   * holds it — the review queue's `waiting_since`, or the range's own
   * activity — the later of the two when both do. With neither, **at the
   * latest**: the earlier of the range's start and the task's last touch,
   * since the move was before both. So a wait is never overstated.
   */
  readonly since: number;
}

/**
 * **Waiting for review more than {@link REVIEW_WAIT_DAYS} days** (LAI-817,
 * D-092 item 4) — longest first.
 *
 * A long wait in review is the reviewer's, not the builder's: it used to
 * surface as "stale" against the person whose work was done.
 *
 * **It does not move with the range** (LAI-832). `queued` is `GET /review`'s
 * answer — when each task last moved into review, at any age — so a task ten
 * days in review and touched this morning stays on "Last 24 hours", where the
 * range's activity alone could see back only a day. The queue covers the
 * spaces where the reader may act (§6.4), and its oldest 200: anything else
 * falls back as above.
 */
export function waitingForReview(
  tasks: readonly TaskSummary[],
  events: readonly ActivityEvent[],
  rangeStart: number | undefined,
  now: number,
  queued: ReadonlyMap<string, number> = new Map(),
): ReviewWait[] {
  /** The latest move into review the range holds, per task. */
  const entered = new Map<string, number>();
  for (const event of events) {
    if (event.task_id === null) continue;
    const move = statusTransition(event);
    if (move?.to !== 'review' || move.from === 'review') continue;
    entered.set(event.task_id, Math.max(entered.get(event.task_id) ?? 0, event.created_at));
  }
  /** The later of the two exact times, when both are known. */
  const moved = (id: string): number | undefined => {
    const a = entered.get(id);
    const b = queued.get(id);
    return a === undefined ? b : b === undefined ? a : Math.max(a, b);
  };
  return tasks
    .filter((t) => t.status === 'review')
    .map((task) => ({
      task,
      since: moved(task.id) ?? Math.min(task.updated_at, rangeStart ?? task.updated_at),
    }))
    .filter((row) => now - row.since > REVIEW_WAIT_DAYS * DAY_MS)
    .sort((a, b) => a.since - b.since);
}

/**
 * **Blocked, as Needs attention counts it** (LAI-817, D-092 item 3): work
 * somebody has committed to — to do or in progress — that waits on unfinished
 * work. Backlog waiting on backlog is a pipeline, not a blockage, and is shown
 * apart with anything else not yet committed. On OnRoute, 19 of the 30 were.
 */
export function splitBlocked(rows: readonly BlockedTask[]): {
  readonly committed: BlockedTask[];
  readonly apart: BlockedTask[];
} {
  const isCommitted = (row: BlockedTask): boolean =>
    row.task.status === 'todo' || row.task.status === 'in_progress';
  return { committed: rows.filter(isCommitted), apart: rows.filter((row) => !isCommitted(row)) };
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
