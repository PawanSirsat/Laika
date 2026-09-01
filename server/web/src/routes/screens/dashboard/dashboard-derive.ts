import type { ActivityEvent } from '../../../api/activity.ts';
import type { Task, TaskStatus } from '../../../api/tasks.ts';

/**
 * The dashboard's arithmetic (SPEC §4.8, §11.4 — LAI-085).
 *
 * Everything here is a function of a task list or an event list, so it is
 * testable in a package with no component renderer (CONVENTIONS §4).
 *
 * **Nothing here aggregates history.** Cycle time and throughput-over-time need
 * status-change events grouped per task, which the activity endpoint returns but
 * does not aggregate — computing them client-side means walking every event for
 * every task, and the honest version is a server aggregation. That is explicitly
 * out of scope for this task and filed rather than smuggled in.
 */

/** §4.5's statuses, in board order — the order a reader expects to see them. */
export const STATUS_ORDER: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
];

export interface StatusCount {
  readonly status: TaskStatus;
  readonly count: number;
}

export interface StatusBreakdown {
  readonly counts: readonly StatusCount[];
  /** Everything except `cancelled` — work that still means something. */
  readonly live: number;
  readonly done: number;
  readonly total: number;
}

/**
 * Counts by status.
 *
 * `live` excludes `cancelled` for the same reason the sprint progress bar does:
 * work that will not happen should not sit in a denominator making a finished
 * project look unfinished for ever. `total` keeps it, so the two numbers
 * together still tell you cancellations happened.
 */
export function statusBreakdown(tasks: readonly Task[]): StatusBreakdown {
  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: tasks.filter((t) => t.status === status).length,
  }));

  const cancelled = counts.find((c) => c.status === 'cancelled')?.count ?? 0;
  const done = counts.find((c) => c.status === 'done')?.count ?? 0;

  return { counts, live: tasks.length - cancelled, done, total: tasks.length };
}

export interface BlockedTask {
  readonly task: Task;
  /** The entries in `blocked_by` that are not done yet — what actually holds it. */
  readonly blockedBy: readonly Task[];
  /** Dependency ids the task list did not contain. */
  readonly unknown: readonly string[];
}

/**
 * Work that cannot start because something it depends on is not finished.
 *
 * ## "Unmet" means "not `done`", including cancelled
 *
 * That is the server's rule verbatim — `isReady` in `task-lifecycle.ts` requires
 * every dependency to be `done`, so a **cancelled** dependency keeps a task
 * unready for ever. Treating cancelled as satisfied here would produce a
 * dashboard that disagrees with the `ready` flag on the board, and the board is
 * the one the server computes. If that rule is wrong it is wrong in
 * `task-lifecycle.ts`, and this should not paper over it.
 *
 * ## Blocked is narrower than `ready === false`
 *
 * Most unready tasks are unready because they are assigned or already moving,
 * which is not "stuck" — it is "being worked on". Only an unmet dependency makes
 * a task something nobody can pick up, which is the thing worth surfacing.
 * A `done` or `cancelled` task is never listed however much blocks it.
 */
export function blockedTasks(tasks: readonly Task[]): BlockedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return tasks
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
    .map((task) => {
      const blockedBy: Task[] = [];
      const unknown: string[] = [];

      for (const id of task.blocked_by) {
        const dep = byId.get(id);
        // Not in the page we loaded — reported rather than assumed satisfied,
        // which would understate the count and is the silent direction to be
        // wrong in.
        if (dep === undefined) unknown.push(id);
        else if (dep.status !== 'done') blockedBy.push(dep);
      }

      return { task, blockedBy, unknown };
    })
    .filter((row) => row.blockedBy.length > 0 || row.unknown.length > 0);
}

export interface RangeOption {
  readonly id: string;
  readonly label: string;
  /** Milliseconds back from now, or `null` for everything. */
  readonly ms: number | null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RANGES: readonly RangeOption[] = [
  { id: '24h', label: 'Last 24 hours', ms: DAY },
  { id: '7d', label: 'Last 7 days', ms: 7 * DAY },
  { id: '30d', label: 'Last 30 days', ms: 30 * DAY },
  { id: 'all', label: 'All time', ms: null },
];

export const DEFAULT_RANGE = '7d';

export function rangeById(id: string | undefined): RangeOption {
  return RANGES.find((r) => r.id === id) ?? RANGES.find((r) => r.id === DEFAULT_RANGE)!;
}

/** The `?since=` value for a range, or `undefined` for all time. */
export function sinceFor(range: RangeOption, now: number): number | undefined {
  return range.ms === null ? undefined : now - range.ms;
}

/**
 * Human wording for an event, **from the project's point of view**.
 *
 * `describeEvent` in `api/activity.ts` says "created this task" — correct in a
 * task detail panel, wrong in a project feed where each row already names a
 * different task. So this is a different sentence rather than a duplicate map,
 * and it covers the whole §4.8 vocabulary rather than the task subset.
 *
 * An unknown type degrades to itself. New server-side verbs then read as
 * `sprint.created` until somebody adds a line — legible, and obviously
 * incomplete, which is the right failure.
 */
const PROJECT_LABELS: Readonly<Record<string, string>> = {
  'task.created': 'created a task',
  'task.updated': 'edited a task',
  'task.status_changed': 'moved a task',
  'task.assigned': 'reassigned a task',
  'task.dependency_added': 'added a dependency',
  'task.dependency_removed': 'removed a dependency',
  'comment.added': 'commented',
  'comment.edited': 'edited a comment',
  'comment.deleted': 'deleted a comment',
  'project.created': 'created this project',
  'project.updated': 'changed project settings',
  'project.archived': 'archived this project',
  'member.added': 'joined the project',
  'member.role_changed': 'changed a member’s role',
  'member.removed': 'removed a member',
  'org.created': 'created the organisation',
  'token.created': 'created a token',
  'token.revoked': 'revoked a token',
  'heartbeat.session': 'reported a session',
  'webhook.commit': 'pushed a commit',
  'webhook.received': 'received a webhook',
  'meeting.applied': 'applied a meeting proposal',
  'unlisted.logged': 'logged unlisted work',
  'sprint.created': 'planned a sprint',
  'sprint.updated': 'changed a sprint',
  'sprint.deleted': 'deleted a sprint',
  'sprint.tasks_changed': 'moved tasks between sprints',
  'project.context_updated': 'edited the project context',
  'unlisted.promoted': 'promoted unlisted work into a task',
  'unlisted.dismissed': 'dismissed unlisted work',
  'user.deactivated': 'deactivated a member',
  'user.reactivated': 'reactivated a member',
};

/**
 * Verbs the project feed deliberately does not show, and **why**.
 *
 * Every one of these still has wording above, because the decision is about
 * *display*, not vocabulary — and because a verb that is silently absent and a
 * verb that is deliberately declined **look identical to the next reader, and
 * only one of them is a decision.** The same distinction `clientOmits` carries
 * in the drift check: an exemption with a reason is a choice; a missing entry is
 * an oversight nobody can tell from a choice.
 *
 * Anything listed here is still rendered anywhere else that names activity —
 * this is the project feed's editorial line, not a global mute.
 */
export const FEED_SILENT: Readonly<Record<string, string>> = {
  'sprint.tasks_changed':
    'one row per task moved is noise in a feed whose job is saying what changed about the project, not narrating every drag',
};

/** Does this verb belong in the project feed a person reads? */
export function shownInFeed(type: string): boolean {
  return !(type in FEED_SILENT);
}

export function describeProjectEvent(event: ActivityEvent): string {
  return PROJECT_LABELS[event.type] ?? event.type;
}

/** `{from, to}` for a status change, when the payload carries it. */
export function statusChange(event: ActivityEvent): { from: string; to: string } | undefined {
  if (event.type !== 'task.status_changed') return undefined;

  const payload = event.payload as { from?: unknown; to?: unknown } | null;
  if (typeof payload?.from !== 'string' || typeof payload.to !== 'string') return undefined;

  return { from: payload.from, to: payload.to };
}

/**
 * How many events each actor kind contributed.
 *
 * `actor_kind` is on every row precisely so agent work is distinguishable from
 * human work (§4.8, D-022), and this is the summary that makes the badge worth
 * having rather than decorative.
 */
export type ActorKindCounts = Record<ActivityEvent['actor_kind'], number>;

export function byActorKind(events: readonly ActivityEvent[]): ActorKindCounts {
  // Every kind starts at zero and the type is closed over the three §4.8 allows,
  // so a caller reads `counts.agent` as a number rather than checking for
  // `undefined` on a key that is always present.
  const counts: ActorKindCounts = { user: 0, agent: 0, system: 0 };

  for (const event of events) {
    counts[event.actor_kind] += 1;
  }

  return counts;
}

/**
 * `2 minutes ago`, `3 hours ago`, `5 days ago` — coarse on purpose.
 *
 * The clamp is not redundant with the first branch, though it looks it: a
 * negative elapsed falls into `< 60_000` today and reads as "just now" either
 * way, but only because the branches are unguarded. The moment someone makes the
 * first one `elapsed >= 0 && …` — the obvious tidy-up — an unclamped value falls
 * through and renders "-1 minutes ago". Server and browser clocks do disagree,
 * so the guarantee is worth holding independently of branch order. Proved by
 * breaking both together.
 */
export function relativeTime(then: number, now: number): string {
  const elapsed = Math.max(0, now - then);

  if (elapsed < 60_000) return 'just now';
  if (elapsed < HOUR) return plural(Math.floor(elapsed / 60_000), 'minute');
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour');

  return plural(Math.floor(elapsed / DAY), 'day');
}

function plural(n: number, unit: string): string {
  return `${String(n)} ${unit}${n === 1 ? '' : 's'} ago`;
}
