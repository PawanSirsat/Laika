import { and, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type TaskStatus } from '../db/enums.ts';
import { projects, sprints, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { bulkCompletions } from './bulk-moves.ts';
import { LEVEL_WEIGHTS } from './estimate-model.ts';
import { sizeViews } from './estimates.ts';
import { simulateSprint } from './sprint-forecast-model.ts';

/**
 * The sprint forecast (LAI-772, the R&D's idea 10): **"85% likely to finish
 * 18–23 of 26"**, for the Sprints page — `GET /api/v1/sprints/:id/forecast`.
 *
 * The pure half is `sprint-forecast-model.ts`; this reads what it needs:
 *
 * - **the work left**: the sprint's tasks not done or cancelled, closest to
 *   done first — review, then in progress, then to do, then backlog, each in
 *   board order — each weighing its size (a person's level when one is set,
 *   else Laika's computed weight; 1, a typical task, before it has one);
 * - **the throughput**: the size weight this project finished each calendar
 *   day over the last {@link THROUGHPUT_DAYS} days, quiet days included, from
 *   its first finish in that window;
 * - **the days left**, today included, to the end of `ends_on` (inclusive,
 *   §4.15).
 *
 * **Top-level tasks only** (LAI-823): a parent and its subtasks are one piece
 * of work, and counting both made a sprint of four tasks read as twelve. The
 * history is top-level too, so the two halves count the same thing.
 *
 * **Bulk moves teach it nothing** (D-093): a sweep into done or an import
 * straight into done is left out of the history, and `basis.bulk_excluded`
 * says how many were.
 *
 * **A whole-range answer is not a forecast.** When the range the draws leave
 * runs from what is already done to every task in the sprint — *"100% likely
 * 0–12 of 12"* — it says nothing anybody did not know, so the answer is
 * `null` with `reason: 'too_uncertain'`.
 *
 * **Still not story points** (§1.1 as D-085 amends it): nothing here is a
 * number anybody types. It is computed from sizes Laika computed and finishes
 * the board recorded, and it reads nothing about who did the work (D-078).
 *
 * **Bounded and cached.** The simulation draws a fixed number of times with a
 * seed from the sprint's id; its answer is kept per sprint against a key of
 * every input, so a re-read with nothing changed costs a few queries and no
 * simulation, and any change — a task done, a size moved, a day passing —
 * computes afresh.
 */

/** Throughput is read over this many recent days. */
export const THROUGHPUT_DAYS = 42;
/** A forecast needs at least this many tasks finished in that window. */
export const THROUGHPUT_MIN_TASKS = 10;
/** Fewer days than this since the first finish are read as this many. */
const MIN_POOL_DAYS = 7;
/** How many sprints' answers a process keeps. */
const CACHE_LIMIT = 500;

const DAY = 86_400_000;

/** The order work is finished in: closest to done first. */
const ORDER: Readonly<Partial<Record<TaskStatus, number>>> = {
  review: 0,
  in_progress: 1,
  todo: 2,
  backlog: 3,
};

export interface SprintForecastFigures {
  /** The share of draws inside `[low, high]`: at least 0.85 when it can be. */
  probability: number;
  /** Tasks done at the sprint's end, done ones included, inclusive. */
  low: number;
  high: number;
  median: number;
  /** Calendar days left, today included. */
  days_left: number;
}

/** What a forecast drew on: the window, and what the project finished in it. */
export interface SprintForecastBasis {
  days: number;
  tasks_done: number;
  weight_done: number;
  /** Top-level tasks finished in the window and left out as bulk moves. */
  bulk_excluded: number;
}

/** `GET /api/v1/sprints/:id/forecast` (§6.4). */
export interface SprintForecastView {
  sprint_id: string;
  /** Tasks in the sprint, not cancelled: the "of Z". */
  total: number;
  done: number;
  /** Null when there is nothing to forecast; `reason` says why. */
  forecast: SprintForecastFigures | null;
  reason: 'completed' | 'no_tasks' | 'not_enough_history' | 'too_uncertain' | null;
  basis: SprintForecastBasis;
}

/** For tests: how many simulations ran, so a cache hit can be counted rather than timed. */
export const sprintForecastCounters = { simulated: 0 };

const cache = new WeakMap<Db, Map<string, { key: string; view: SprintForecastView }>>();

function cacheFor(db: Db): Map<string, { key: string; view: SprintForecastView }> {
  let byId = cache.get(db);
  if (byId === undefined) {
    byId = new Map();
    cache.set(db, byId);
  }
  return byId;
}

/** A stable 32-bit seed from the sprint's id. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Each task's weight: a person's level, else Laika's computed weight, else 1. */
function weightsOf(
  db: Db,
  rows: readonly { id: string; estimateId: string | null; sizeOverrideId: string | null }[],
): Map<string, number> {
  const sizes = sizeViews(db, rows);
  return new Map(
    rows.map((r) => {
      const size = sizes.get(r.id);
      const w = size === undefined ? 1 : size.overridden ? LEVEL_WEIGHTS[size.level] : size.weight;
      return [r.id, w] as const;
    }),
  );
}

export function getSprintForecast(
  db: Db,
  actor: ResolvedActor,
  sprintId: string,
  now: number = Date.now(),
): SprintForecastView {
  const sprint = db.select().from(sprints).where(eq(sprints.id, sprintId)).get();
  if (sprint === undefined) throw ApiError.notFound(`No sprint with id "${sprintId}"`);
  const project = db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, sprint.projectId))
    .get();
  if (project === undefined) throw ApiError.notFound('That sprint belongs to no project');
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const COLUMNS = {
    id: tasks.id,
    status: tasks.status,
    position: tasks.position,
    number: tasks.number,
    estimateId: tasks.estimateId,
    sizeOverrideId: tasks.sizeOverrideId,
  } as const;
  const inSprint = db
    .select(COLUMNS)
    .from(tasks)
    .where(
      and(eq(tasks.sprintId, sprint.id), ne(tasks.status, 'cancelled'), isNull(tasks.parentTaskId)),
    )
    .all();
  const since = now - THROUGHPUT_DAYS * DAY;
  const history = db
    .select({ ...COLUMNS, completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, project.id),
        eq(tasks.status, 'done'),
        isNull(tasks.parentTaskId),
        gte(tasks.completedAt, since),
        lte(tasks.completedAt, now),
      ),
    )
    .all();
  const bulk = bulkCompletions(db, project.orgId, history);
  const finished = history.filter((r) => !bulk.has(r.id));
  const weights = weightsOf(db, [...inSprint, ...finished]);

  const done = inSprint.filter((r) => r.status === 'done').length;
  const left = inSprint
    .filter((r) => r.status !== 'done')
    .sort(
      (a, b) =>
        (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) ||
        (a.position ?? '').localeCompare(b.position ?? '') ||
        a.number - b.number,
    );

  // A day of throughput is what the project finished in that 24 hours.
  let oldest = 0;
  for (const r of finished) {
    oldest = Math.max(oldest, Math.floor((now - (r.completedAt ?? now)) / DAY));
  }
  const days = Math.min(THROUGHPUT_DAYS, Math.max(MIN_POOL_DAYS, oldest + 1));
  const pool = new Array<number>(days).fill(0);
  let weightDone = 0;
  for (const r of finished) {
    const index = Math.min(days - 1, Math.floor((now - (r.completedAt ?? now)) / DAY));
    const w = weights.get(r.id) ?? 1;
    pool[index]! += w;
    weightDone += w;
  }
  const basis = {
    days,
    tasks_done: finished.length,
    weight_done: Math.round(weightDone * 100) / 100,
    bulk_excluded: bulk.size,
  };

  const base = { sprint_id: sprint.id, total: inSprint.length, done, basis };
  if (sprint.status === 'completed') return { ...base, forecast: null, reason: 'completed' };
  if (inSprint.length === 0) return { ...base, forecast: null, reason: 'no_tasks' };
  if (finished.length < THROUGHPUT_MIN_TASKS) {
    return { ...base, forecast: null, reason: 'not_enough_history' };
  }

  // To the end of `ends_on`, which is inclusive (§4.15); from today, or from
  // the start of a sprint not yet begun.
  const daysLeft = Math.max(
    0,
    Math.ceil((sprint.endsOn + DAY - Math.max(now, sprint.startsOn)) / DAY),
  );
  const remaining = left.map((r) => weights.get(r.id) ?? 1);
  const key = JSON.stringify([
    sprint.id,
    done,
    inSprint.length,
    remaining.map((w) => Math.round(w * 1e4)),
    pool.map((w) => Math.round(w * 1e4)),
    daysLeft,
  ]);
  const byId = cacheFor(db);
  const hit = byId.get(sprint.id);
  if (hit?.key === key) return hit.view;

  sprintForecastCounters.simulated += 1;
  const r = simulateSprint({
    remaining,
    done,
    total: inSprint.length,
    throughput: pool,
    days: daysLeft,
    seed: seedOf(sprint.id),
  });
  // Every outcome from what is done to all of it: no forecast at all.
  const view: SprintForecastView =
    r.low <= done && r.high >= inSprint.length
      ? { ...base, forecast: null, reason: 'too_uncertain' }
      : {
          ...base,
          forecast: {
            probability: r.probability,
            low: r.low,
            high: r.high,
            median: r.median,
            days_left: daysLeft,
          },
          reason: null,
        };
  byId.delete(sprint.id);
  byId.set(sprint.id, { key, view });
  if (byId.size > CACHE_LIMIT) byId.delete(byId.keys().next().value!);
  return view;
}
