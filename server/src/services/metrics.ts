import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { readPayload } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { activity, tasks } from '../db/schema.ts';
import { assertCan } from '../policy/can.ts';
import { bulkCompletions } from './bulk-moves.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * Throughput and cycle time, in one request (LAI-124).
 *
 * LAI-085 filed this because the alternative is one request per task: on a
 * 200-task board, 200 requests to draw one number.
 *
 * ## It reads two columns, and that is LAI-126's doing
 *
 * Cycle time used to mean reconstructing a first move into `in_progress` from
 * `task.status_changed` history — which meant deciding what a task sent back and
 * picked up again did. `tasks.started_at` already answers it: **first entry,
 * never overwritten** (LAI-126), which is the same rule the reconstruction would
 * have had to implement, decided once. `completed_at` is the **latest** arrival
 * at `done` (LAI-146), and LAI-435 recovered both for tasks that predate them.
 *
 * ## Only tasks that are `done` now
 *
 * `completed_at` survives a reopen deliberately, so a task done, reopened and
 * still in progress carries a timestamp for a cycle it is **in the middle of**.
 * Counting it would report a finished cycle for unfinished work, and it is the
 * one place LAI-146's asymmetry can bite — so the filter is `status = 'done'`,
 * not `completed_at IS NOT NULL`.
 *
 * That also settles §5's `done → in_progress → done`: the row holds one
 * `completed_at`, so the task counts **once**, at its latest completion. A query
 * over `activity` would have counted it twice.
 *
 * ## Cancelled work is excluded, and named as excluded
 *
 * A task cancelled after two weeks in progress is not a two-week cycle time; it
 * is not a cycle. The sprint bar (LAI-083) and the dashboard's counts (LAI-085)
 * already make that call, and a third answer here would be the inconsistent one.
 * `status = 'done'` excludes it by construction rather than by a second rule.
 *
 * ## A completed task with no start is counted, and not measured
 *
 * A task moved straight to `done` has no `started_at` and no cycle. It is real
 * throughput — somebody finished something — so it counts there, and it is
 * reported separately rather than dropped, because a board where most work never
 * passes through `in_progress` is a fact about the board and not a gap in the
 * data.
 *
 * ## Bulk moves are left out, and counted as left out (D-093, LAI-823)
 *
 * A task whose completion was a bulk move — a sweep into done, or an import
 * straight into done (`bulk-moves.ts`) — is in neither figure, and
 * `bulk_excluded` says how many there were, so a chart can say so rather than
 * look like a quiet week.
 *
 * ## Building, and waiting for review
 *
 * The cycle splits at the task's **latest** entry into review before its
 * completion: `building` is start to that entry, `waiting_for_review` that
 * entry to done. Latest, so a round sent back and rebuilt is building time,
 * not waiting. A task that reached done without review is all building and has
 * no wait, so it is in `building` and not in `waiting_for_review`.
 */

/** A day of completions, `YYYY-MM-DD` in UTC. */
export interface ThroughputBucket {
  day: string;
  completed: number;
}

/** Percentiles over the tasks a part of the cycle could be measured on. */
export interface CycleSpan {
  measured: number;
  p50_ms: number;
  p75_ms: number;
  p90_ms: number;
}

export interface CycleTime {
  /** Completed tasks that had a `started_at` to measure from. */
  measured: number;
  /** Completed tasks with no `started_at` — counted, not measured. */
  unmeasured: number;
  p50_ms: number;
  p75_ms: number;
  p90_ms: number;
  /** Start to the latest entry into review — or to done, without review. */
  building: CycleSpan | null;
  /** The latest entry into review to done; `null` when nothing passed review. */
  waiting_for_review: CycleSpan | null;
}

export interface MetricsView {
  since: number;
  /** Days with no completions are present and zero, so a chart need not fill gaps. */
  throughput: ThroughputBucket[];
  /** `null` when nothing completed in the window — not a zeroed shape. */
  cycle_time: CycleTime | null;
  /** Completions in the window left out of both as bulk moves (D-093). */
  bulk_excluded: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * The `p`th percentile by nearest rank, on a sorted ascending array.
 *
 * Nearest rank rather than interpolation: a cycle time is an observation that
 * happened, and reporting a p90 no task actually took invites somebody to go
 * looking for it. Shared with the member profile's cycle time (LAI-743), so
 * the two cannot disagree about what a p75 is.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;

  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

function span(sorted: readonly number[]): CycleSpan | null {
  if (sorted.length === 0) return null;
  return {
    measured: sorted.length,
    p50_ms: percentile(sorted, 50),
    p75_ms: percentile(sorted, 75),
    p90_ms: percentile(sorted, 90),
  };
}

/** SQLite's bound-parameter limit is far above this; it keeps one query sane. */
const CHUNK = 500;

/**
 * Each task's latest entry into review from another category, from its start
 * to its completion — the point the cycle splits at.
 */
function reviewEntries(
  db: Db,
  measured: readonly { id: string; startedAt: number; completedAt: number }[],
): Map<string, number> {
  const bounds = new Map(measured.map((m) => [m.id, m]));
  const entries = new Map<string, number>();
  for (let i = 0; i < measured.length; i += CHUNK) {
    const ids = measured.slice(i, i + CHUNK).map((m) => m.id);
    for (const row of db
      .select()
      .from(activity)
      .where(and(inArray(activity.taskId, ids), eq(activity.type, 'task.status_changed')))
      .all()) {
      const task = bounds.get(row.taskId!)!;
      if (row.createdAt < task.startedAt || row.createdAt > task.completedAt) continue;
      const payload = readPayload(row) as { from?: unknown; to?: unknown } | null;
      if (payload?.to !== 'review' || payload.from === 'review') continue;
      entries.set(task.id, Math.max(entries.get(task.id) ?? 0, row.createdAt));
    }
  }
  return entries;
}

export function projectMetrics(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  since: number,
  now: number = Date.now(),
): MetricsView {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const all = db
    .select({ id: tasks.id, startedAt: tasks.startedAt, completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, project.id),
        eq(tasks.status, 'done'),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, since),
      ),
    )
    .all();

  const bulk = bulkCompletions(db, project.orgId, all);
  const completed = all.filter((task) => !bulk.has(task.id));

  const perDay = new Map<string, number>();
  for (let at = since; at <= now; at += DAY_MS) perDay.set(utcDay(at), 0);
  perDay.set(utcDay(now), perDay.get(utcDay(now)) ?? 0);

  const durations: number[] = [];
  const measured: { id: string; startedAt: number; completedAt: number }[] = [];
  let unmeasured = 0;

  for (const task of completed) {
    const at = task.completedAt!;
    const day = utcDay(at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);

    if (task.startedAt === null) unmeasured += 1;
    else {
      durations.push(at - task.startedAt);
      measured.push({ id: task.id, startedAt: task.startedAt, completedAt: at });
    }
  }

  const entries = reviewEntries(db, measured);
  const building: number[] = [];
  const waiting: number[] = [];
  for (const task of measured) {
    const entry = entries.get(task.id);
    if (entry === undefined) building.push(task.completedAt - task.startedAt);
    else {
      building.push(entry - task.startedAt);
      waiting.push(task.completedAt - entry);
    }
  }

  const ascending = (a: number, b: number) => a - b;
  durations.sort(ascending);
  building.sort(ascending);
  waiting.sort(ascending);

  return {
    since,
    throughput: [...perDay.entries()]
      .map(([day, count]) => ({ day, completed: count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    cycle_time:
      completed.length === 0
        ? null
        : {
            measured: durations.length,
            unmeasured,
            p50_ms: percentile(durations, 50),
            p75_ms: percentile(durations, 75),
            p90_ms: percentile(durations, 90),
            building: span(building),
            waiting_for_review: span(waiting),
          },
    bulk_excluded: bulk.size,
  };
}
