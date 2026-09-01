import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { tasks } from '../db/schema.ts';
import { assertCan } from '../policy/can.ts';
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
 */

/** A day of completions, `YYYY-MM-DD` in UTC. */
export interface ThroughputBucket {
  day: string;
  completed: number;
}

export interface CycleTime {
  /** Completed tasks that had a `started_at` to measure from. */
  measured: number;
  /** Completed tasks with no `started_at` — counted, not measured. */
  unmeasured: number;
  p50_ms: number;
  p75_ms: number;
  p90_ms: number;
}

export interface MetricsView {
  since: number;
  /** Days with no completions are present and zero, so a chart need not fill gaps. */
  throughput: ThroughputBucket[];
  /** `null` when nothing completed in the window — not a zeroed shape. */
  cycle_time: CycleTime | null;
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
 * looking for it.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;

  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
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

  const completed = db
    .select({ startedAt: tasks.startedAt, completedAt: tasks.completedAt })
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

  const perDay = new Map<string, number>();
  for (let at = since; at <= now; at += DAY_MS) perDay.set(utcDay(at), 0);
  perDay.set(utcDay(now), perDay.get(utcDay(now)) ?? 0);

  const durations: number[] = [];
  let unmeasured = 0;

  for (const task of completed) {
    const at = task.completedAt!;
    const day = utcDay(at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);

    if (task.startedAt === null) unmeasured += 1;
    else durations.push(at - task.startedAt);
  }

  durations.sort((a, b) => a - b);

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
          },
  };
}
