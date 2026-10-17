import { createHash } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type EstimateSource, type SizeLevel, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  activity,
  projects,
  tags,
  taskDependencies,
  taskEstimates,
  taskRounds,
  tasks,
  taskTags,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { createLogger, type Logger } from '../log.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import {
  FORECAST_AFTER,
  fitModel,
  forecast,
  MIN_BUILD_MS,
  readSignals,
  rollUp,
  type Factor,
  type Fit,
  type ForecastMethod,
  type History,
  type Signals,
} from './estimate-model.ts';
import { requireProjectBySlug } from './projects.ts';
import { tagsForTasks } from './tags.ts';

/**
 * Sizes and build-time forecasts, stored (SPEC §4.32, D-085, LAI-771).
 *
 * The model is `estimate-model.ts`, pure; this module reads what it needs,
 * keeps each project's fitted model in memory, and writes the history.
 *
 * ## When an estimate is computed
 *
 * **Inline, in the write that changed what the model reads** — create, an
 * edit of the title, description, acceptance or tags, a dependency added or
 * removed, a subtask created, moved or cancelled — so the board never shows a
 * size older than the activity row that announced the change. Every input,
 * and the project's model version, is hashed onto the task: an edit that
 * changes none of them is a string comparison, and an edit the model does not
 * read (status, assignee, priority, sprint, dates, order) never calls in here.
 *
 * **A row only when the output moves**: another level, a forecast appearing
 * or going, or the p50 moving more than a tenth. Anything less updates the
 * hash and writes nothing, so the history stays the size of its decisions.
 *
 * **Refit nightly** (`refitEstimates`, §11.6), and lazily for a project the
 * process has not fitted yet. A cold project's typical task is its typical
 * *text*, which moves as it grows, so a cold fit is redone when the project
 * has grown by a tenth or crossed into having hours.
 *
 * ## What is never computed
 *
 * Anything about a person. The model reads the task's own signals; accuracy
 * is reported per project and per agent client with at least three people
 * behind it, and nothing here groups by who did the work (D-078 item 6, D-085
 * item 8).
 */

export { SIZE_LEVELS, type SizeLevel } from '../db/enums.ts';

/** Where an estimator failure is reported; the app's logger once `app.ts` wires it. */
let log: Logger = createLogger();

/** Report estimator failures to this logger — `app.ts` passes the process's. */
export function setEstimateLogger(logger: Logger): void {
  log = logger;
}

/** A client is reported on once this many people use it (D-085 item 8). */
export const MIN_CLIENT_PEOPLE = 3;

/** A forecast moves when its p50 moves more than this (×1.1). */
const P50_MOVES = Math.log(1.1);

/** History rows a task's estimate view carries. */
const HISTORY_LIMIT = 20;

/**
 * What a task carries on every read (`TaskView.size`): the size shown, the
 * one Laika computed, and the forecast. Null until one has been computed.
 */
export interface SizeView {
  /** What is shown: a person's size when one is set, else the computed one. */
  level: SizeLevel;
  /** What Laika computed — always visible, override or not. */
  computed: SizeLevel;
  overridden: boolean;
  /** Relative to the project's typical task: 1 is typical, 2 twice it. */
  weight: number;
  /** Build time, likely and pessimistic, in ms. Null until the project has history. */
  build_p50_ms: number | null;
  build_p80_ms: number | null;
  /** Subtasks rolled into it (D-085 item 7). */
  subtasks: number;
}

/** One line of the *why*. `levels` is log₂ of what it multiplies the size by. */
export interface EstimateFactor {
  key: Factor['key'];
  label: string;
  levels: number;
}

/** A finished task the forecast drew on, to link to. */
export interface SimilarTaskRef {
  task_id: string;
  key: string;
  title: string;
  build_ms: number;
  similarity: number;
}

/** The *why* of the estimate in force, as it was when it was computed. */
export interface EstimateWhy {
  /** A cold start: size only, no hours yet. */
  early: boolean;
  method: ForecastMethod;
  /** The project's typical task the weight is relative to. */
  typical: { words: number; build_ms: number | null };
  factors: EstimateFactor[];
  similar: SimilarTaskRef[];
  model_version: string;
  computed_at: number;
}

/** What actually happened, read from the task's own status history. */
export interface ActualTimes {
  /** First start to first finish (D-085 item 3). Null until it finished once. */
  build_ms: number | null;
  /** Time spent waiting in review, every round — a team property, not forecast. */
  review_wait_ms: number;
  /** Time from a send-back to the next finish. */
  rework_ms: number;
  /** How many times it was finished. */
  finishes: number;
  first_finish_at: number | null;
}

export interface EstimateHistoryEntry {
  source: EstimateSource;
  /** Null on a `person` row that cleared an override. */
  level: SizeLevel | null;
  build_p50_ms: number | null;
  build_p80_ms: number | null;
  /** The person, on a `person` row. */
  set_by: string | null;
  created_at: number;
}

/** A person's size in force: who set it, and when. */
export interface SizeOverride {
  level: SizeLevel;
  set_by: string;
  set_at: number;
}

/** The estimate frozen when work first started — what accuracy measures. */
export interface FrozenEstimate {
  level: SizeLevel;
  build_p50_ms: number | null;
  build_p80_ms: number | null;
  estimated_at: number;
}

/** `GET /api/v1/tasks/:id/estimate` — the task panel's Forecast section (§6.4). */
export interface TaskEstimateView {
  task_id: string;
  size: SizeView | null;
  why: EstimateWhy | null;
  override: SizeOverride | null;
  at_start: FrozenEstimate | null;
  actual: ActualTimes;
  /** Newest first. */
  history: EstimateHistoryEntry[];
}

/** Typical error, bias and p80 hit rate over a set of tasks. */
export interface AccuracyFigures {
  n: number;
  /** The median ratio between forecast and actual, as `×1.7`. */
  typical_error: number | null;
  /** The median of actual ÷ forecast: above 1 means forecasts run short. */
  bias: number | null;
  /** Share of actuals at or under the p80. */
  p80_hit_rate: number | null;
}

/** The replay of the project's history against its plain median. */
export interface BacktestFigures {
  n: number;
  method_error: number;
  median_error: number;
  p80_hit_rate: number;
  beats_median: boolean;
}

/** One agent client's figures, where at least three people use it. */
export interface ClientAccuracy extends AccuracyFigures {
  client_name: string;
  /** A count, never who. */
  people: number;
}

/** `GET /api/v1/projects/:slug/estimates/accuracy` (§6.4). Never per person. */
export interface EstimateAccuracyView {
  project_id: string;
  /** Finished tasks with a measured build time — what the model learns from. */
  finished: number;
  /** Hours are shown once `finished` reaches this. */
  forecasts_after: number;
  /** Frozen-at-claim forecasts against what happened. */
  live: AccuracyFigures;
  backtest: BacktestFigures | null;
  /** Per agent client, only where at least three people use it. */
  by_client: ClientAccuracy[];
  model_version: string;
}

// -------------------------------------------------------------- fit caching

interface CachedFit {
  readonly fit: Fit;
  /** The project's task count when it was fitted, for a cold fit's staleness. */
  readonly tasks: number;
}

/** Per database, per project: one process, one database, one cache. */
const fits = new WeakMap<Db, Map<string, CachedFit>>();

function cacheFor(db: Db): Map<string, CachedFit> {
  let byProject = fits.get(db);
  if (byProject === undefined) {
    byProject = new Map();
    fits.set(db, byProject);
  }
  return byProject;
}

/** Every task's tags in one project, in one query. */
function projectTags(db: Db, projectId: string): Map<string, string[]> {
  const byTask = new Map<string, string[]>();
  const rows = db
    .select({ taskId: taskTags.taskId, name: tags.name })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(eq(tags.projectId, projectId))
    .all();
  for (const r of rows) {
    const list = byTask.get(r.taskId);
    if (list === undefined) byTask.set(r.taskId, [r.name]);
    else list.push(r.name);
  }
  return byTask;
}

/** How many tasks each task in one project is blocked by, in one query. */
function projectDeps(db: Db, projectId: string): Map<string, number> {
  return new Map(
    db
      .select({ taskId: taskDependencies.taskId, n: count() })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(tasks.projectId, projectId))
      .groupBy(taskDependencies.taskId)
      .all()
      .map((r) => [r.taskId, r.n] as const),
  );
}

/**
 * When each task in a project was first finished: its first move into review
 * or done at or after it started (D-085 item 3). One grouped query over the
 * project's status changes.
 */
function firstFinishes(db: Db, projectId: string): Map<string, number> {
  return new Map(
    db
      .select({ taskId: activity.taskId, at: sql<number>`min(${activity.createdAt})` })
      .from(activity)
      .innerJoin(tasks, eq(tasks.id, activity.taskId))
      .where(
        and(
          eq(activity.projectId, projectId),
          eq(activity.type, 'task.status_changed'),
          sql`json_extract(${activity.payloadJson}, '$.to') IN ('review', 'done')`,
          gte(activity.createdAt, tasks.startedAt),
        ),
      )
      .groupBy(activity.taskId)
      .all()
      .flatMap((r) => (r.taskId === null ? [] : [[r.taskId, r.at] as const])),
  );
}

/** First finish, or a done task's completion when no status change says it. */
function finishOf(
  task: { id: string; status: TaskStatus; startedAt: number | null; completedAt: number | null },
  finishes: ReadonlyMap<string, number>,
): number | null {
  if (task.startedAt === null) return null;
  const found = finishes.get(task.id);
  if (found !== undefined) return found;
  if (task.status === 'done' && task.completedAt !== null && task.completedAt >= task.startedAt) {
    return task.completedAt;
  }
  return null;
}

function buildFit(db: Db, projectId: string): CachedFit {
  const prefix =
    db.select({ prefix: projects.prefix }).from(projects).where(eq(projects.id, projectId)).get()
      ?.prefix ?? '';
  const all = db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      descriptionMd: tasks.descriptionMd,
      acceptanceMd: tasks.acceptanceMd,
      status: tasks.status,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all();
  const finishes = firstFinishes(db, projectId);
  const tagMap = projectTags(db, projectId);
  const deps = projectDeps(db, projectId);
  const signalsOf = (t: (typeof all)[number]): Signals =>
    readSignals({
      title: t.title,
      description: t.descriptionMd,
      acceptance: t.acceptanceMd,
      tags: tagMap.get(t.id) ?? [],
      blockedBy: deps.get(t.id) ?? 0,
    });

  const history: History[] = [];
  for (const t of all) {
    if (t.status === 'cancelled' || t.startedAt === null) continue;
    const finish = finishOf(t, finishes);
    if (finish === null || finish - t.startedAt <= 0) continue;
    history.push({
      id: t.id,
      key: `${prefix}-${String(t.number)}`,
      title: t.title,
      signals: signalsOf(t),
      startedAt: t.startedAt,
      finishedAt: finish,
      buildMs: finish - t.startedAt,
    });
  }
  // A cold project's typical task is its typical text — every task's.
  const population = history.length < FORECAST_AFTER ? all.map(signalsOf) : [];
  return { fit: fitModel(history, population), tasks: all.length };
}

/**
 * The project's model: cached, fitted on first use, refitted nightly — and a
 * cold one refitted once the project has grown by a tenth, or has enough
 * finished tasks for hours, because a cold fit's "typical" is the project's
 * text as it stood.
 */
function fitFor(db: Db, projectId: string): Fit {
  const cache = cacheFor(db);
  const cached = cache.get(projectId);
  if (cached !== undefined && !cached.fit.early) return cached.fit;
  if (cached !== undefined) {
    const shape = db
      .select({
        total: count(),
        finished: sql<number>`coalesce(sum(case when ${tasks.startedAt} is not null and ${tasks.status} in ('review', 'done') then 1 else 0 end), 0)`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .get() ?? { total: 0, finished: 0 };
    const grown = Math.abs(shape.total - cached.tasks) >= Math.max(1, cached.tasks / 10);
    if (!grown && shape.finished < FORECAST_AFTER) return cached.fit;
  }
  const built = buildFit(db, projectId);
  cache.set(projectId, built);
  return built.fit;
}

// ---------------------------------------------------------------- recompute

const SUBJECT = {
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  descriptionMd: tasks.descriptionMd,
  acceptanceMd: tasks.acceptanceMd,
  status: tasks.status,
  parentTaskId: tasks.parentTaskId,
  estimateId: tasks.estimateId,
  estimateHash: tasks.estimateHash,
} as const;

interface Subject {
  id: string;
  projectId: string;
  title: string;
  descriptionMd: string | null;
  acceptanceMd: string | null;
  status: TaskStatus;
  parentTaskId: string | null;
  estimateId: string | null;
  estimateHash: string | null;
}

/** The figures of an estimate row the roll-up and the "did it move" test read. */
interface Figures {
  level: SizeLevel;
  weight: number;
  p50: number | null;
  p80: number | null;
  subtasks: number;
}

interface Child {
  id: string;
  estimateId: string | null;
  figures: Figures | undefined;
}

const FIGURES = {
  id: taskEstimates.id,
  level: taskEstimates.level,
  weight: taskEstimates.weight,
  p50: taskEstimates.buildP50Ms,
  p80: taskEstimates.buildP80Ms,
  subtasks: taskEstimates.subtasks,
} as const;

function figuresOf(row: {
  level: SizeLevel | null;
  weight: number | null;
  p50: number | null;
  p80: number | null;
  subtasks: number;
}): Figures | undefined {
  if (row.level === null || row.weight === null) return undefined;
  return {
    level: row.level,
    weight: row.weight,
    p50: row.p50,
    p80: row.p80,
    subtasks: row.subtasks,
  };
}

function figuresById(db: Db, ids: readonly string[]): Map<string, Figures> {
  const out = new Map<string, Figures>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db
      .select(FIGURES)
      .from(taskEstimates)
      .where(inArray(taskEstimates.id, chunk))
      .all()) {
      const f = figuresOf(r);
      if (f !== undefined) out.set(r.id, f);
    }
  }
  return out;
}

/** A done or cancelled task keeps the estimate it has: it is history now. */
function settled(s: Subject): boolean {
  return (s.status === 'done' || s.status === 'cancelled') && s.estimateId !== null;
}

function hashOf(
  fit: Fit,
  s: Subject,
  tagNames: readonly string[],
  deps: number,
  children: readonly Child[],
): string {
  return createHash('sha1')
    .update(
      JSON.stringify([
        fit.version,
        s.title,
        s.descriptionMd,
        s.acceptanceMd,
        [...tagNames].sort(),
        deps,
        children.map((c) => [c.id, c.estimateId]),
      ]),
    )
    .digest('hex');
}

/** Another level, a forecast appearing or going, the p50 moving a tenth. */
function moved(current: Figures | undefined, f: Figures): boolean {
  if (current === undefined) return true;
  if (current.level !== f.level || current.subtasks !== f.subtasks) return true;
  if ((current.p50 === null) !== (f.p50 === null)) return true;
  return (
    current.p50 !== null && f.p50 !== null && Math.abs(Math.log(f.p50 / current.p50)) > P50_MOVES
  );
}

/**
 * Compute one task's estimate and write it if it moved. Returns the estimate
 * id in force and whether a row was written.
 */
function settle(
  db: Db,
  fit: Fit,
  s: Subject,
  inputs: { tags: readonly string[]; deps: number; children: readonly Child[] },
  current: Figures | undefined,
  now: number,
): { estimateId: string | null; figures: Figures | undefined; wrote: boolean } {
  const hash = hashOf(fit, s, inputs.tags, inputs.deps, inputs.children);
  if (hash === s.estimateHash && s.estimateId !== null) {
    return { estimateId: s.estimateId, figures: current, wrote: false };
  }

  let f = forecast(
    fit,
    readSignals({
      title: s.title,
      description: s.descriptionMd,
      acceptance: s.acceptanceMd,
      tags: inputs.tags,
      blockedBy: inputs.deps,
    }),
    { excludeId: s.id },
  );
  const kids = inputs.children.flatMap((c) =>
    c.figures === undefined
      ? []
      : [{ weight: c.figures.weight, p50Ms: c.figures.p50, p80Ms: c.figures.p80 }],
  );
  f = rollUp(f, kids);

  const figures: Figures = {
    level: f.level,
    weight: Math.round(f.weight * 10_000) / 10_000,
    p50: f.p50Ms,
    p80: f.p80Ms,
    subtasks: f.subtasks,
  };

  let estimateId = s.estimateId;
  const wrote = moved(current, figures);
  if (wrote) {
    estimateId = newId();
    const why = {
      early: f.early,
      method: f.method,
      typical: { words: f.typical.words, build_ms: f.typical.buildMs },
      factors: f.factors.map((x) => ({
        key: x.key,
        label: x.label,
        levels: Math.round(x.levels * 10_000) / 10_000,
      })),
      similar: f.similar.map((x) => ({
        task_id: x.id,
        key: x.key,
        title: x.title,
        build_ms: x.buildMs,
        similarity: x.similarity,
      })),
    };
    db.insert(taskEstimates)
      .values({
        id: estimateId,
        taskId: s.id,
        source: 'model',
        level: figures.level,
        weight: figures.weight,
        buildP50Ms: figures.p50,
        buildP80Ms: figures.p80,
        subtasks: figures.subtasks,
        inputsHash: hash,
        modelVersion: fit.version,
        factorsJson: JSON.stringify(why),
        setBy: null,
        createdAt: now,
      })
      .run();
  }
  // Derived, like `ready`: the pointer and the hash move, `updated_at` does not.
  db.update(tasks).set({ estimateId, estimateHash: hash }).where(eq(tasks.id, s.id)).run();
  return { estimateId, figures: wrote ? figures : current, wrote };
}

function childrenOf(db: Db, parentId: string): Child[] {
  const rows = db
    .select({ id: tasks.id, estimateId: tasks.estimateId, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentId))
    .all()
    .filter((r) => r.status !== 'cancelled');
  const figures = figuresById(
    db,
    rows.flatMap((r) => (r.estimateId === null ? [] : [r.estimateId])),
  );
  return rows.map((r) => ({
    id: r.id,
    estimateId: r.estimateId,
    figures: r.estimateId === null ? undefined : figures.get(r.estimateId),
  }));
}

/**
 * **Estimator work is best effort, and the write it rides on is not** (LAI-771
 * review, B1).
 *
 * Every inline call — the recompute on an edit, the freeze at a first start,
 * the parent following a child — runs in a savepoint (a nested
 * `db.transaction`, which better-sqlite3 makes a `SAVEPOINT` inside a caller's
 * transaction and a transaction of its own outside one). A failure takes back
 * only the estimator's own writes, is logged as `estimate.failed`, and returns
 * `fallback`; the task write around it carries on and writes its activity
 * row. The nightly refit computes what was missed, and retries a skipped
 * freeze (`freezeWhereMissed`).
 *
 * Before this, a failure here threw out of `createTask` with nothing saved,
 * out of `updateTask` after the edit was saved, and out of `changeStatus`
 * between the status write and its activity row — a move into work with no
 * `task.status_changed` behind it.
 */
function bestEffort<T>(db: Db, what: string, id: string, fallback: T, fn: () => T): T {
  try {
    // `immediate`: take the write lock before the first read, so another
    // connection's commit cannot invalidate the snapshot halfway. Nested in a
    // caller's transaction it is a savepoint, and the behaviour is moot.
    return db.transaction(() => fn(), { behavior: 'immediate' });
  } catch (error) {
    log.error('estimate.failed', {
      what,
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function refresh(db: Db, taskId: string, now: number): boolean {
  const s = db.select(SUBJECT).from(tasks).where(eq(tasks.id, taskId)).get();
  if (s === undefined || settled(s)) return false;

  const fit = fitFor(db, s.projectId);
  const tagNames = tagsForTasks(db, [s.id]).get(s.id) ?? [];
  const deps =
    db.select({ n: count() }).from(taskDependencies).where(eq(taskDependencies.taskId, s.id)).get()
      ?.n ?? 0;
  const current =
    s.estimateId === null ? undefined : figuresById(db, [s.estimateId]).get(s.estimateId);
  const result = settle(
    db,
    fit,
    s,
    { tags: tagNames, deps, children: childrenOf(db, s.id) },
    current,
    now,
  );

  if (result.wrote && s.parentTaskId !== null) refresh(db, s.parentTaskId, now);
  return result.wrote;
}

/**
 * Recompute one task's estimate — inline, in the caller's write, best effort.
 * Returns whether a row was written; when one was, the parent follows, since
 * its figures come from its children.
 */
export function refreshEstimate(db: Db, taskId: string, now: number): boolean {
  return bestEffort(db, 'refresh', taskId, false, () => refresh(db, taskId, now));
}

/**
 * **The estimate work started under is the newest `model` row written at or
 * before `started_at`** — the one in force at that moment. Defined that way,
 * not as "whatever is current", so the freeze can be retried later without
 * hindsight: a row written after work started is never chosen, and a task
 * that started before any estimate existed for it (in flight when estimates
 * were deployed, or with every estimate write failing) is never frozen.
 */
function freezeWhereMissed(db: Db, where: SQL): number {
  const inForce = sql`(SELECT ${taskEstimates.id} FROM ${taskEstimates}
    WHERE ${taskEstimates.taskId} = ${tasks.id}
      AND ${taskEstimates.source} = 'model'
      AND ${taskEstimates.createdAt} <= ${tasks.startedAt}
    ORDER BY ${taskEstimates.createdAt} DESC, ${taskEstimates.id} DESC
    LIMIT 1)`;
  return db
    .update(tasks)
    .set({ estimateAtStartId: inForce })
    .where(
      and(
        where,
        isNotNull(tasks.startedAt),
        isNull(tasks.estimateAtStartId),
        sql`${inForce} IS NOT NULL`,
      ),
    )
    .run().changes;
}

/**
 * Freeze the estimate in force as the one work started under (D-085 item 5):
 * called when a task enters work **for the first time**, as `started_at` is
 * stamped then and never again. Best effort; a freeze skipped by a failure is
 * retried by the nightly refit. Never moves once set.
 */
export function freezeEstimateAtStart(db: Db, taskId: string, now: number): void {
  bestEffort(db, 'freeze', taskId, undefined, () => {
    refresh(db, taskId, now);
    freezeWhereMissed(db, eq(tasks.id, taskId));
  });
}

/**
 * A person's size, or `null` to go back to the computed one (D-085 item 4).
 * The caller has asked `task.write` — anyone who may edit the task may size
 * it — and writes the activity row from what this returns: `null` when the
 * size asked for is the one already set, so a repeat writes nothing.
 *
 * **The person's row is their write, not a derived figure**, so it is not best
 * effort: if it cannot be stored this throws, and the caller's transaction
 * takes the rest of the edit back with it. Only the computed size beside it —
 * the recompute — is best effort.
 */
export function setSizeOverride(
  db: Db,
  userId: string,
  taskId: string,
  level: SizeLevel | null,
  now: number,
): { from: SizeLevel | null; to: SizeLevel | null } | null {
  const task = db
    .select({ sizeOverrideId: tasks.sizeOverrideId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) return null;
  const from =
    task.sizeOverrideId === null
      ? null
      : (db
          .select({ level: taskEstimates.level })
          .from(taskEstimates)
          .where(eq(taskEstimates.id, task.sizeOverrideId))
          .get()?.level ?? null);
  if (from === level) return null;

  // The computed size stays visible under the override, so make sure there is one.
  refreshEstimate(db, taskId, now);
  const id = newId();
  db.insert(taskEstimates)
    .values({ id, taskId, source: 'person', level, setBy: userId, createdAt: now })
    .run();
  db.update(tasks)
    .set({ sizeOverrideId: level === null ? null : id, updatedAt: now })
    .where(eq(tasks.id, taskId))
    .run();
  return { from, to: level };
}

// --------------------------------------------------------------------- read

/**
 * `TaskView.size` for a page of tasks: one primary-key query for every row in
 * force, whatever the page size (LAI-091's rule).
 */
export function sizeViews(
  db: Db,
  rows: readonly { id: string; estimateId: string | null; sizeOverrideId: string | null }[],
): Map<string, SizeView> {
  const out = new Map<string, SizeView>();
  const models = rows.flatMap((r) => (r.estimateId === null ? [] : [r.estimateId]));
  if (models.length === 0) return out;
  const found = figuresById(db, models);
  // A person's row carries a level and nothing else.
  const overrides = rows.flatMap((r) => (r.sizeOverrideId === null ? [] : [r.sizeOverrideId]));
  const levels = new Map<string, SizeLevel>();
  for (let i = 0; i < overrides.length; i += 500) {
    for (const o of db
      .select({ id: taskEstimates.id, level: taskEstimates.level })
      .from(taskEstimates)
      .where(inArray(taskEstimates.id, overrides.slice(i, i + 500)))
      .all()) {
      if (o.level !== null) levels.set(o.id, o.level);
    }
  }
  for (const r of rows) {
    const model = r.estimateId === null ? undefined : found.get(r.estimateId);
    if (model === undefined) continue;
    const override = r.sizeOverrideId === null ? undefined : levels.get(r.sizeOverrideId);
    out.set(r.id, {
      level: override ?? model.level,
      computed: model.level,
      overridden: override !== undefined,
      weight: model.weight,
      build_p50_ms: model.p50,
      build_p80_ms: model.p80,
      subtasks: model.subtasks,
    });
  }
  return out;
}

/** The status changes of one task, in order: `from` and `to` categories. */
function statusMoves(db: Db, taskId: string): { at: number; from: string; to: string }[] {
  return db
    .select({ at: activity.createdAt, payload: activity.payloadJson })
    .from(activity)
    .where(and(eq(activity.taskId, taskId), eq(activity.type, 'task.status_changed')))
    .orderBy(asc(activity.createdAt), asc(sql`rowid`))
    .all()
    .flatMap((r) => {
      const p = JSON.parse(r.payload) as { from?: unknown; to?: unknown };
      return typeof p.from === 'string' && typeof p.to === 'string'
        ? [{ at: r.at, from: p.from, to: p.to }]
        : [];
    });
}

const WORK: ReadonlySet<string> = new Set(['backlog', 'todo', 'in_progress']);

/**
 * Build time, review wait and rework from a task's own moves (D-085 item 3):
 * build is first start to first finish; review wait is every stretch spent in
 * review; rework is every stretch from a send-back back into work to the next
 * finish. A stretch still open is counted up to `now`.
 */
export function actualTimes(
  moves: readonly { at: number; from: string; to: string }[],
  task: { status: TaskStatus; startedAt: number | null; completedAt: number | null },
  now: number,
): ActualTimes {
  let first: number | null = null;
  let reviewWait = 0;
  let rework = 0;
  let finishes = 0;
  let inReview: number | null = null;
  let reworking: number | null = null;

  for (const m of moves) {
    if (m.from === m.to || task.startedAt === null || m.at < task.startedAt) continue;
    if (m.from === 'review' && inReview !== null) {
      reviewWait += m.at - inReview;
      inReview = null;
      if (WORK.has(m.to)) reworking = m.at;
    }
    if (m.to === 'review' || m.to === 'done') {
      first ??= m.at;
      if (reworking !== null) {
        rework += m.at - reworking;
        reworking = null;
      }
    }
    if (m.to === 'review') {
      finishes += 1;
      inReview = m.at;
    }
  }
  if (inReview !== null) reviewWait += Math.max(0, now - inReview);
  if (reworking !== null) rework += Math.max(0, now - reworking);

  if (
    first === null &&
    task.status === 'done' &&
    task.startedAt !== null &&
    task.completedAt !== null &&
    task.completedAt >= task.startedAt
  ) {
    first = task.completedAt;
  }
  const build = first !== null && task.startedAt !== null ? first - task.startedAt : null;
  return {
    build_ms: build !== null && build > 0 ? build : null,
    review_wait_ms: reviewWait,
    rework_ms: rework,
    finishes: Math.max(finishes, first === null ? 0 : 1),
    first_finish_at: first,
  };
}

interface StoredWhy {
  early?: boolean;
  method?: ForecastMethod;
  typical?: { words: number; build_ms: number | null };
  factors?: EstimateFactor[];
  similar?: SimilarTaskRef[];
}

export function getTaskEstimate(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): TaskEstimateView {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  assertCan(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId });

  const history = db
    .select()
    .from(taskEstimates)
    .where(eq(taskEstimates.taskId, task.id))
    .orderBy(desc(taskEstimates.createdAt), desc(sql`rowid`))
    .limit(HISTORY_LIMIT)
    .all();
  const pointed = [task.estimateId, task.sizeOverrideId, task.estimateAtStartId].filter(
    (id): id is string => id !== null && !history.some((h) => h.id === id),
  );
  const rows = new Map(
    [
      ...history,
      ...(pointed.length === 0
        ? []
        : db.select().from(taskEstimates).where(inArray(taskEstimates.id, pointed)).all()),
    ].map((r) => [r.id, r] as const),
  );

  const model = task.estimateId === null ? undefined : rows.get(task.estimateId);
  const override = task.sizeOverrideId === null ? undefined : rows.get(task.sizeOverrideId);
  const atStart = task.estimateAtStartId === null ? undefined : rows.get(task.estimateAtStartId);
  const stored = model === undefined ? undefined : (JSON.parse(model.factorsJson) as StoredWhy);

  return {
    task_id: task.id,
    size: sizeViews(db, [task]).get(task.id) ?? null,
    why:
      model === undefined || stored === undefined
        ? null
        : {
            early: stored.early ?? model.buildP50Ms === null,
            method: stored.method ?? 'text',
            typical: stored.typical ?? { words: 0, build_ms: null },
            factors: stored.factors ?? [],
            similar: stored.similar ?? [],
            model_version: model.modelVersion ?? '',
            computed_at: model.createdAt,
          },
    override:
      override?.level === undefined || override.level === null || override.setBy === null
        ? null
        : { level: override.level, set_by: override.setBy, set_at: override.createdAt },
    at_start:
      atStart?.level === undefined || atStart.level === null
        ? null
        : {
            level: atStart.level,
            build_p50_ms: atStart.buildP50Ms,
            build_p80_ms: atStart.buildP80Ms,
            estimated_at: atStart.createdAt,
          },
    actual: actualTimes(statusMoves(db, task.id), task, now),
    history: history.map((h) => ({
      source: h.source,
      level: h.level,
      build_p50_ms: h.buildP50Ms,
      build_p80_ms: h.buildP80Ms,
      set_by: h.setBy,
      created_at: h.createdAt,
    })),
  };
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.5 * sorted.length) - 1))]!;
}

function figuresFor(pairs: readonly { log: number; hit: boolean }[]): AccuracyFigures {
  if (pairs.length === 0) return { n: 0, typical_error: null, bias: null, p80_hit_rate: null };
  return {
    n: pairs.length,
    typical_error: round(Math.exp(median(pairs.map((p) => Math.abs(p.log)))), 2),
    bias: round(Math.exp(median(pairs.map((p) => p.log))), 2),
    p80_hit_rate: round(pairs.filter((p) => p.hit).length / pairs.length, 3),
  };
}

/**
 * How good the forecasts have been, for one project (D-085 item 8).
 *
 * **Always the frozen copy against the actual** — the forecast in force when
 * work first started, never one recomputed since, so nothing is measured with
 * hindsight. Per agent client only where at least three people use the
 * client, so a client never stands in for a person; and nothing here is
 * grouped, filtered or labelled by person.
 */
export function getEstimateAccuracy(
  db: Db,
  actor: ResolvedActor,
  slug: string,
): EstimateAccuracyView {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const fit = fitFor(db, project.id);
  const finishes = firstFinishes(db, project.id);
  const frozen = db
    .select({
      id: tasks.id,
      status: tasks.status,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
      p50: taskEstimates.buildP50Ms,
      p80: taskEstimates.buildP80Ms,
    })
    .from(tasks)
    .innerJoin(taskEstimates, eq(taskEstimates.id, tasks.estimateAtStartId))
    .where(eq(tasks.projectId, project.id))
    .all();

  const pairs = new Map<string, { log: number; hit: boolean }>();
  for (const t of frozen) {
    if (t.status === 'cancelled' || t.p50 === null || t.p80 === null || t.startedAt === null)
      continue;
    const finish = finishOf(t, finishes);
    if (finish === null) continue;
    const actual = Math.max(finish - t.startedAt, MIN_BUILD_MS);
    pairs.set(t.id, { log: Math.log(actual / t.p50), hit: actual <= t.p80 });
  }

  // Per agent client: each **measured** task by the client that finished it
  // the first time, and the distinct people behind those tasks. **Only the
  // measured tasks count towards the three people** (D-078 item 6): a client
  // three people have used, of whom two are behind the figures, would report
  // what is in fact two people's work (LAI-771 review).
  const firstRounds = db
    .select({ taskId: taskRounds.taskId, client: taskRounds.clientName, by: taskRounds.finishedBy })
    .from(taskRounds)
    .innerJoin(tasks, eq(tasks.id, taskRounds.taskId))
    .where(and(eq(tasks.projectId, project.id), eq(taskRounds.number, 1)))
    .all();
  const clients = new Map<
    string,
    { people: Set<string>; pairs: { log: number; hit: boolean }[] }
  >();
  for (const r of firstRounds) {
    const pair = pairs.get(r.taskId);
    if (r.client === null || pair === undefined) continue;
    let entry = clients.get(r.client);
    if (entry === undefined) {
      entry = { people: new Set(), pairs: [] };
      clients.set(r.client, entry);
    }
    entry.people.add(r.by);
    entry.pairs.push(pair);
  }
  const byClient = [...clients.entries()]
    .filter(([, entry]) => entry.people.size >= MIN_CLIENT_PEOPLE)
    .map(([client, entry]) => ({
      client_name: client,
      people: entry.people.size,
      ...figuresFor(entry.pairs),
    }))
    .sort((a, b) => a.client_name.localeCompare(b.client_name));

  const bt = fit.backtest;
  return {
    project_id: project.id,
    finished: fit.n,
    forecasts_after: FORECAST_AFTER,
    live: figuresFor([...pairs.values()]),
    backtest:
      bt === null ||
      bt.n === 0 ||
      bt.methodError === null ||
      bt.medianError === null ||
      bt.p80Hit === null
        ? null
        : {
            n: bt.n,
            method_error: round(bt.methodError, 2),
            median_error: round(bt.medianError, 2),
            p80_hit_rate: round(bt.p80Hit, 3),
            beats_median: bt.beatsMedian,
          },
    by_client: byClient,
    model_version: fit.version,
  };
}

// --------------------------------------------------------------------- job

/** §3.4's principal: the refit is org-wide maintenance with no person behind it. */
const SYSTEM = systemPrincipal();

/**
 * The nightly refit (§11.6, D-085 item 7): every live project's model fitted
 * again from its history, and every open task — and any task that has no
 * estimate yet — recomputed against it, children before parents. A task whose
 * inputs and model are unchanged is a hash comparison; only an estimate that
 * moved writes a row. Writes no `activity` row: the figures are derived, like
 * `ready`, and a verb for them would be an `activity` rebuild for a line
 * saying nothing a person did.
 *
 * Runs once at boot too (`atStart`), so a deploy — which restarts the server —
 * starts with fitted models and every task estimated. It also freezes any task
 * whose freeze at its first start was skipped by a failure, from the estimate
 * in force then (`freezeWhereMissed`) — never one written since.
 */
export function refitEstimates(db: Db, now: number): { changed: number } {
  assertCan(SYSTEM, 'system.estimate.refit');

  const cache = cacheFor(db);
  let changed = 0;
  const live = db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .all();
  for (const { id: projectId } of live) {
    // One project at a time, each best effort: a project the model cannot
    // fit is logged and the others are still refitted.
    changed += bestEffort(db, 'refit', projectId, 0, () => {
      const built = buildFit(db, projectId);
      cache.set(projectId, built);
      // Estimates for what was missed, then any freeze a failure skipped.
      return (
        settleProject(db, built.fit, projectId, now) +
        freezeWhereMissed(db, eq(tasks.projectId, projectId))
      );
    });
  }
  return { changed };
}

function settleProject(db: Db, fit: Fit, projectId: string, now: number): number {
  const all: Subject[] = db.select(SUBJECT).from(tasks).where(eq(tasks.projectId, projectId)).all();
  const due = all.filter((s) => !settled(s));
  if (due.length === 0) return 0;

  const tagMap = projectTags(db, projectId);
  const deps = projectDeps(db, projectId);
  const figures = figuresById(
    db,
    all.flatMap((s) => (s.estimateId === null ? [] : [s.estimateId])),
  );
  const byId = new Map(all.map((s) => [s.id, s] as const));
  const kids = new Map<string, Subject[]>();
  for (const s of all) {
    if (s.parentTaskId === null || s.status === 'cancelled') continue;
    const list = kids.get(s.parentTaskId);
    if (list === undefined) kids.set(s.parentTaskId, [s]);
    else list.push(s);
  }

  let changed = 0;
  // Children first, so a parent rolls up what its children are now.
  const ordered = [...due].sort(
    (a, b) => Number(b.parentTaskId !== null) - Number(a.parentTaskId !== null),
  );
  for (const s of ordered) {
    const children = (kids.get(s.id) ?? []).map((c) => {
      const latest = byId.get(c.id)!;
      return {
        id: c.id,
        estimateId: latest.estimateId,
        figures: latest.estimateId === null ? undefined : figures.get(latest.estimateId),
      };
    });
    const current = s.estimateId === null ? undefined : figures.get(s.estimateId);
    const result = settle(
      db,
      fit,
      s,
      { tags: tagMap.get(s.id) ?? [], deps: deps.get(s.id) ?? 0, children },
      current,
      now,
    );
    if (result.wrote) {
      changed += 1;
      byId.set(s.id, { ...s, estimateId: result.estimateId });
      if (result.estimateId !== null && result.figures !== undefined) {
        figures.set(result.estimateId, result.figures);
      }
    }
  }
  return changed;
}
