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
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import {
  CLAIM_CONFIDENCES,
  SIZE_LEVELS,
  type ClaimConfidence,
  type EstimateSource,
  type SizeLevel,
  type TaskStatus,
} from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  activity,
  agents,
  projects,
  tags,
  taskClaimEstimates,
  taskDependencies,
  taskEstimates,
  taskReviews,
  taskRounds,
  tasks,
  taskTags,
  tokens,
  tokenUsageDays,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { createLogger, type Logger } from '../log.ts';
import { assertCan, can, systemPrincipal } from '../policy/can.ts';
import {
  blendAgent,
  buildSimilarIndex,
  FORECAST_AFTER,
  findSimilar,
  fitModel,
  forecast,
  levelOf,
  MIN_BUILD_MS,
  readSignals,
  rollUp,
  scoreAgentEstimates,
  type AgentSample,
  type AgentScore,
  type Factor,
  type Fit,
  type Forecast,
  type ForecastMethod,
  type History,
  type SimilarLookup,
  type Signals,
} from './estimate-model.ts';
import { TELEMETRY_COLLECTOR } from './local-activity.ts';
import { requireProjectBySlug } from './projects.ts';
import { tagsForTasks } from './tags.ts';
import {
  fitTokens,
  forecastTokens,
  MIN_TOKEN_COVERAGE,
  TOKEN_FORECAST_AFTER,
  usableSamples,
  type TokenFit,
  type TokenSample,
} from './token-model.ts';

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
 * ## Phase 2 (LAI-772)
 *
 * - **Tokens** beside the hours: build tokens, likely and pessimistic, from
 *   `token-model.ts`, calibrated on the project's **attributed** actuals only
 *   and stored on the same row — so they are frozen at claim with it.
 * - **The claimant's own estimate** (`start_working`'s `estimate`), kept in
 *   `task_claim_estimates` and blended in only once the agents' sizes have
 *   beaten the plain project median here (D-085 item 4).
 * - **Scope grew after start**, the **split suggestion** for XL, the **similar
 *   past tasks** an agent reads with why they were sent back, and the Review
 *   page's **fast-finish cue** — each read from what is stored here.
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
  /** Build tokens, likely and pessimistic, as forecast then (LAI-772). */
  tokens_p50: number | null;
  tokens_p80: number | null;
  estimated_at: number;
}

/** The token forecast in force, and how much history it stands on (LAI-772). */
export interface TokenForecastView {
  /** Build tokens — input, output and cache writes up to the first finish. Null until there is history. */
  p50: number | null;
  p80: number | null;
  /** Finished tasks with attributed token data the forecast learns from. */
  learned_from: number;
  /** Tokens are forecast once `learned_from` reaches this (D-085 item 6). */
  forecasts_after: number;
}

/**
 * What was spent on the task, as the forecast counts it: build tokens up to
 * the first finish (by calendar day, UTC), and what came after apart (rework).
 * A floor, as every token figure is (D-084 item 9).
 */
export interface ActualTokens {
  build: number;
  total: number;
  rework: number;
}

/**
 * What the one who claimed it said at claim (§4.34): never who said it.
 *
 * **What was said and nothing else** (LAI-772 review, N1). The row keeps when
 * it was said and the agent's own name, and neither is read back here: the
 * time matches the claim's own `task.status_changed` row, which names the
 * person, and the client is as good as a name wherever one person uses it.
 */
export interface ClaimEstimateView {
  level: SizeLevel | null;
  confidence: ClaimConfidence | null;
}

/** "Scope grew after start": the computed size rose a level or more after work began. */
export interface ScopeGrowth {
  from: SizeLevel;
  to: SizeLevel;
}

/** For an XL task: how many rounds XL tasks here took, to suggest splitting it. */
export interface SplitSuggestion {
  /** Finished XL tasks in the project. */
  xl_finished: number;
  /** Their mean number of rounds; null with fewer than three. */
  rounds_avg: number | null;
}

/** `GET /api/v1/tasks/:id/estimate` — the task panel's Forecast section (§6.4). */
export interface TaskEstimateView {
  task_id: string;
  size: SizeView | null;
  why: EstimateWhy | null;
  override: SizeOverride | null;
  at_start: FrozenEstimate | null;
  actual: ActualTimes;
  /** The token forecast in force (LAI-772). */
  tokens: TokenForecastView;
  /** Tokens spent on it; null for a reader who may not read usage, or with none yet. */
  actual_tokens: ActualTokens | null;
  /** What the claimant said at claim, or null. */
  claim_estimate: ClaimEstimateView | null;
  scope_grew: ScopeGrowth | null;
  split: SplitSuggestion | null;
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
  /**
   * The client: a registered agent's **harness** slug (`claude-code`), or a
   * legacy token's client name. Never a registered agent's name (D-120).
   */
  client_name: string;
  /** A count, never who. */
  people: number;
}

/** The token forecast's record, per project (LAI-772). */
export interface TokenAccuracy {
  learned_from: number;
  forecasts_after: number;
  /** Frozen-at-claim token forecasts against the build tokens spent. */
  live: AccuracyFigures;
  backtest: BacktestFigures | null;
}

/** How one confidence has fared: of the tasks claimed with it and decided, how many went back. */
export interface ConfidenceRecord {
  confidence: ClaimConfidence;
  n: number;
  sent_back: number;
}

/** The claimants' own estimates, as one source, per project (D-085 item 4). */
export interface AgentAccuracy {
  /** Their sizes against the build times, the median and the model; and the weight earned. */
  size: AgentScore;
  /** Their confidence against send-backs. */
  confidence: ConfidenceRecord[];
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
  tokens: TokenAccuracy;
  agent: AgentAccuracy;
  model_version: string;
}

/** A finished task like this one, for `get_task_context` (LAI-772): never who did it. */
export interface SimilarPastTask {
  task_id: string;
  key: string;
  title: string;
  status: TaskStatus;
  similarity: number;
  /** How many times it was finished. */
  rounds: number;
  /** Why it was sent back, each time, oldest first. */
  send_backs: { round: number | null; reason: string }[];
}

/** The Review page's cue (LAI-772): finished far faster than forecast. */
export interface FastFinishCue {
  kind: 'fast';
  /** Round 1's build: first start to the finish. */
  build_ms: number;
  /**
   * Laika's own build-time p50 frozen when work started — before a claimant's
   * size was blended in, so a claimant's own small size cannot hide a fast
   * finish (LAI-772 review, N2).
   */
  forecast_p50_ms: number;
}

// -------------------------------------------------------------- fit caching

/**
 * A project's fitted model: the size and hours (`estimate-model.ts`), the
 * token calibration (`token-model.ts`), the claimants' record, and the index
 * similar past tasks are looked up in. Cached together and versioned
 * together, so an estimate names one model however many parts it used.
 */
interface Model {
  readonly fit: Fit;
  readonly tokens: TokenFit | null;
  /** Finished tasks with attributed token data — what `tokens` learned from. */
  readonly tokenSamples: number;
  readonly agent: AgentScore;
  /** Every finished task, for `get_task_context`'s similar tasks at any size of project. */
  readonly lookup: SimilarLookup;
  readonly version: string;
}

interface CachedFit {
  readonly model: Model;
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

const headline = sql`${tokenUsageDays.input} + ${tokenUsageDays.output} + ${tokenUsageDays.cacheWrite}`;

/** `YYYY-MM-DD` in UTC: the day a finish falls on, for comparing with token days. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** What a task spent: build (up to its first finish's day), the whole, and how much of its people's work was attributed. */
interface TokenActual {
  readonly build: number;
  readonly total: number;
  /** Of its people's tokens on its build days, the share tied to a task. */
  readonly coverage: number;
}

/**
 * Each task's tokens, as the forecast counts them (LAI-772): **build tokens**
 * are those on days up to its first finish's (UTC) day; **coverage** is, of
 * what the people who spent them spent on those days, the share tied to any
 * task — how much of the work Laika could place. Two grouped queries for the
 * whole project, whatever its size: the project's attributed rows, then those
 * people's totals per day over the same range.
 *
 * A day is read in UTC, as the server has no zone for a collector's day: a
 * finish near midnight may count that day's tokens to either side.
 */
function tokenActuals(
  db: Db,
  projectId: string,
  finishOfTask: ReadonlyMap<string, number | null>,
): Map<string, TokenActual> {
  const out = new Map<string, TokenActual>();
  if (finishOfTask.size === 0) return out;
  const rows = db
    .select({
      taskId: tokenUsageDays.taskId,
      userId: tokenUsageDays.userId,
      day: tokenUsageDays.day,
      tokens: sql<number>`coalesce(sum(${headline}), 0)`.mapWith(Number),
    })
    .from(tokenUsageDays)
    .where(and(eq(tokenUsageDays.projectId, projectId), isNotNull(tokenUsageDays.taskId)))
    .groupBy(tokenUsageDays.taskId, tokenUsageDays.userId, tokenUsageDays.day)
    .all();
  if (rows.length === 0) return out;

  const people = new Set<string>();
  let first = '9999-12-31';
  let last = '0000-01-01';
  for (const r of rows) {
    people.add(r.userId);
    if (r.day < first) first = r.day;
    if (r.day > last) last = r.day;
  }
  const perDay = new Map<string, { total: number; attributed: number }>();
  const ids = [...people];
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db
      .select({
        userId: tokenUsageDays.userId,
        day: tokenUsageDays.day,
        total: sql<number>`coalesce(sum(${headline}), 0)`.mapWith(Number),
        attributed:
          sql<number>`coalesce(sum(CASE WHEN ${tokenUsageDays.taskId} IS NOT NULL THEN ${headline} ELSE 0 END), 0)`.mapWith(
            Number,
          ),
      })
      .from(tokenUsageDays)
      .where(
        and(
          inArray(tokenUsageDays.userId, ids.slice(i, i + 500)),
          gte(tokenUsageDays.day, first),
          lte(tokenUsageDays.day, last),
          // Coverage is how much of the work *could* be tied to a task: the
          // side calls telemetry adds (LAI-773) never can be, and counting
          // them would push tasks under the 70% the threshold was set by.
          ne(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
        ),
      )
      .groupBy(tokenUsageDays.userId, tokenUsageDays.day)
      .all()) {
      perDay.set(`${r.userId}\u0000${r.day}`, { total: r.total, attributed: r.attributed });
    }
  }

  const acc = new Map<string, { build: number; total: number; of: number; tied: number }>();
  for (const r of rows) {
    if (r.taskId === null || !finishOfTask.has(r.taskId)) continue;
    const finish = finishOfTask.get(r.taskId) ?? null;
    const entry = acc.get(r.taskId) ?? { build: 0, total: 0, of: 0, tied: 0 };
    entry.total += r.tokens;
    if (finish === null || r.day <= utcDay(finish)) {
      entry.build += r.tokens;
      const day = perDay.get(`${r.userId}\u0000${r.day}`);
      if (day !== undefined) {
        entry.of += day.total;
        entry.tied += day.attributed;
      }
    }
    acc.set(r.taskId, entry);
  }
  for (const [taskId, e] of acc) {
    out.set(taskId, { build: e.build, total: e.total, coverage: e.of === 0 ? 0 : e.tied / e.of });
  }
  return out;
}

/** What `factors_json` keeps when a claimant's size was blended in. */
interface StoredAgent {
  level: SizeLevel;
  weight: number;
  /** The model's own weight and p50, before the blend — what scoring compares. */
  model_weight: number;
  model_p50_ms: number | null;
}

/**
 * The claimants' sizes against what happened, for {@link scoreAgentEstimates}:
 * each finished task whose claim carried a size, with the model's own p50 and
 * weight frozen at its start (unblended), and the project's plain median build
 * time when it started. Two queries: the project's claim estimates, and the
 * frozen rows of the tasks they name.
 */
function agentSamples(
  db: Db,
  projectId: string,
  history: readonly History[],
  frozenOf: ReadonlyMap<string, string>,
): AgentSample[] {
  const claims = db
    .select({
      taskId: taskClaimEstimates.taskId,
      level: taskClaimEstimates.level,
      createdAt: taskClaimEstimates.createdAt,
    })
    .from(taskClaimEstimates)
    .innerJoin(tasks, eq(tasks.id, taskClaimEstimates.taskId))
    .where(and(eq(tasks.projectId, projectId), isNotNull(taskClaimEstimates.level)))
    .orderBy(desc(taskClaimEstimates.createdAt))
    .all();
  if (claims.length === 0) return [];

  const said = new Map<string, SizeLevel>();
  const started = new Map(history.map((h) => [h.id, h.startedAt] as const));
  for (const c of claims) {
    const at = started.get(c.taskId);
    // The estimate in force when work started: the newest at or before it.
    if (at === undefined || said.has(c.taskId) || c.createdAt > at || c.level === null) continue;
    said.set(c.taskId, c.level);
  }
  const frozenIds = [...said.keys()].flatMap((id) => {
    const f = frozenOf.get(id);
    return f === undefined ? [] : [f];
  });
  const frozen = new Map<string, { weight: number | null; p50: number | null; why: string }>();
  for (let i = 0; i < frozenIds.length; i += 500) {
    for (const r of db
      .select({
        id: taskEstimates.id,
        weight: taskEstimates.weight,
        p50: taskEstimates.buildP50Ms,
        why: taskEstimates.factorsJson,
      })
      .from(taskEstimates)
      .where(inArray(taskEstimates.id, frozenIds.slice(i, i + 500)))
      .all()) {
      frozen.set(r.id, r);
    }
  }

  // The plain median when each started: builds finished by then, kept sorted.
  const byFinish = [...history].sort((a, b) => a.finishedAt - b.finishedAt);
  const byStart = [...history].sort((a, b) => a.startedAt - b.startedAt);
  const builds: number[] = [];
  let next = 0;
  const out: AgentSample[] = [];
  for (const h of byStart) {
    while (next < byFinish.length && byFinish[next]!.finishedAt <= h.startedAt) {
      const b = byFinish[next]!.buildMs;
      let at = builds.length;
      while (at > 0 && builds[at - 1]! > b) at -= 1;
      builds.splice(at, 0, b);
      next += 1;
    }
    const level = said.get(h.id);
    const row = frozen.get(frozenOf.get(h.id) ?? '');
    if (level === undefined || row === undefined || builds.length === 0) continue;
    if (row.weight === null || row.p50 === null) continue;
    const stored = (JSON.parse(row.why) as { agent?: StoredAgent }).agent;
    const modelWeight = stored?.model_weight ?? row.weight;
    const modelP50 = stored?.model_p50_ms ?? row.p50;
    if (modelP50 === null) continue;
    out.push({
      buildMs: h.buildMs,
      level,
      modelP50Ms: modelP50,
      modelWeight,
      medianMs: builds[Math.max(0, Math.ceil(0.5 * builds.length) - 1)]!,
    });
  }
  return out;
}

function versionOf(fit: Fit, tokenFit: TokenFit | null, agent: AgentScore): string {
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return createHash('sha1')
    .update(
      JSON.stringify([
        fit.version,
        tokenFit === null
          ? null
          : [
              tokenFit.n,
              round(tokenFit.a),
              round(tokenFit.b),
              round(tokenFit.q50),
              round(tokenFit.q80),
              round(tokenFit.medianLog),
              round(tokenFit.p80Log),
              tokenFit.useModel,
            ],
        agent.weight,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
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
      estimateId: tasks.estimateId,
      estimateAtStartId: tasks.estimateAtStartId,
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
  const fit = fitModel(history, population);

  // Tokens (LAI-772): each finished task's build tokens against the weight it
  // was given when work started — the frozen copy, else the one it has.
  const frozenOf = new Map<string, string>();
  for (const t of all) {
    const ref = t.estimateAtStartId ?? t.estimateId;
    if (ref !== null) frozenOf.set(t.id, ref);
  }
  const finishOfTask = new Map(history.map((h) => [h.id, h.finishedAt] as const));
  const actuals = tokenActuals(db, projectId, finishOfTask);
  const weights = figuresById(db, [
    ...new Set(
      [...actuals.keys()].flatMap((id) => {
        const ref = frozenOf.get(id);
        return ref === undefined ? [] : [ref];
      }),
    ),
  ]);
  const samples: TokenSample[] = history.flatMap((h) => {
    const spent = actuals.get(h.id);
    const weight = weights.get(frozenOf.get(h.id) ?? '')?.weight;
    if (spent === undefined || weight === undefined || weight <= 0) return [];
    return [
      {
        id: h.id,
        startedAt: h.startedAt,
        finishedAt: h.finishedAt,
        logWeight: Math.log(weight),
        tokens: spent.build,
        coverage: spent.coverage,
      },
    ];
  });
  const tokenFit = fitTokens(samples);
  const agent = scoreAgentEstimates(agentSamples(db, projectId, history, frozenOf));
  const lookup =
    fit.index ?? buildSimilarIndex([...history].sort((a, b) => a.finishedAt - b.finishedAt));
  return {
    model: {
      fit,
      tokens: tokenFit,
      tokenSamples: usableSamples(samples).length,
      agent,
      lookup,
      version: versionOf(fit, tokenFit, agent),
    },
    tasks: all.length,
  };
}

/**
 * The project's model: cached, fitted on first use, refitted nightly — and a
 * cold one refitted once the project has grown by a tenth, or has enough
 * finished tasks for hours, because a cold fit's "typical" is the project's
 * text as it stood.
 */
function fitFor(db: Db, projectId: string): Model {
  const cache = cacheFor(db);
  const cached = cache.get(projectId);
  if (cached !== undefined && !cached.model.fit.early) return cached.model;
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
    if (!grown && shape.finished < FORECAST_AFTER) return cached.model;
  }
  const built = buildFit(db, projectId);
  cache.set(projectId, built);
  return built.model;
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
  tokensP50: number | null;
  tokensP80: number | null;
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
  tokensP50: taskEstimates.tokensP50,
  tokensP80: taskEstimates.tokensP80,
  subtasks: taskEstimates.subtasks,
} as const;

function figuresOf(row: {
  level: SizeLevel | null;
  weight: number | null;
  p50: number | null;
  p80: number | null;
  tokensP50: number | null;
  tokensP80: number | null;
  subtasks: number;
}): Figures | undefined {
  if (row.level === null || row.weight === null) return undefined;
  return {
    level: row.level,
    weight: row.weight,
    p50: row.p50,
    p80: row.p80,
    tokensP50: row.tokensP50,
    tokensP80: row.tokensP80,
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

/** The claimant's latest estimate of a task: what the blend reads. */
interface Claim {
  id: string;
  level: SizeLevel | null;
}

function hashOf(
  version: string,
  s: Subject,
  tagNames: readonly string[],
  deps: number,
  children: readonly Child[],
  claim: Claim | null,
): string {
  return createHash('sha1')
    .update(
      JSON.stringify([
        version,
        s.title,
        s.descriptionMd,
        s.acceptanceMd,
        [...tagNames].sort(),
        deps,
        children.map((c) => [c.id, c.estimateId]),
        claim?.id ?? null,
      ]),
    )
    .digest('hex');
}

/** Whether a p50 moved more than a tenth, or appeared, or went. */
function shifted(from: number | null, to: number | null): boolean {
  if ((from === null) !== (to === null)) return true;
  return from !== null && to !== null && Math.abs(Math.log(to / from)) > P50_MOVES;
}

/** Another level, a forecast — of hours or of tokens — appearing or going, a p50 moving a tenth. */
function moved(current: Figures | undefined, f: Figures): boolean {
  if (current === undefined) return true;
  if (current.level !== f.level || current.subtasks !== f.subtasks) return true;
  return shifted(current.p50, f.p50) || shifted(current.tokensP50, f.tokensP50);
}

const LN2 = Math.log(2);

/**
 * The claimant's size blended in (D-085 item 4) — only once the claimants'
 * sizes here have beaten the plain median, and by the weight they earned.
 * Moves the weight, the level and the hours together, in log space, and says
 * so in the *why*. Returns the model's own figures beside, for scoring.
 */
function withClaim(
  model: Model,
  f: Forecast,
  claim: Claim | null,
): { f: Forecast; agent: StoredAgent | null } {
  const level = claim?.level ?? null;
  const w = model.agent.weight;
  if (level === null || w <= 0) return { f, agent: null };
  const own = Math.log(f.weight);
  const shift = blendAgent(own, level, w) - own;
  const scale = Math.exp(shift);
  const factor: Factor = {
    key: 'agent',
    label: `The claimant’s own size at claim: ${level} (it weighs ${String(Math.round(w * 100))}% here, earned against the project median)`,
    levels: shift / LN2,
  };
  const weight = f.weight * scale;
  return {
    f: {
      ...f,
      weight,
      level: levelOf(weight),
      p50Ms: f.p50Ms === null ? null : Math.round(f.p50Ms * scale),
      p80Ms: f.p80Ms === null ? null : Math.round(f.p80Ms * scale),
      factors: [
        ...f.factors.filter((x) => x.key !== 'priority'),
        factor,
        ...f.factors.filter((x) => x.key === 'priority'),
      ],
    },
    agent: { level, weight: w, model_weight: f.weight, model_p50_ms: f.p50Ms },
  };
}

/**
 * Compute one task's estimate and write it if it moved. Returns the estimate
 * id in force and whether a row was written.
 */
function settle(
  db: Db,
  model: Model,
  s: Subject,
  inputs: {
    tags: readonly string[];
    deps: number;
    children: readonly Child[];
    claim: Claim | null;
  },
  current: Figures | undefined,
  now: number,
): { estimateId: string | null; figures: Figures | undefined; wrote: boolean } {
  const hash = hashOf(model.version, s, inputs.tags, inputs.deps, inputs.children, inputs.claim);
  if (hash === s.estimateHash && s.estimateId !== null) {
    return { estimateId: s.estimateId, figures: current, wrote: false };
  }

  let f = forecast(
    model.fit,
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
  const blended = withClaim(model, f, inputs.claim);
  f = blended.f;
  // Tokens from the size in force, blend and children included (LAI-772).
  const spend = forecastTokens(model.tokens, Math.log(f.weight));

  const figures: Figures = {
    level: f.level,
    weight: Math.round(f.weight * 10_000) / 10_000,
    p50: f.p50Ms,
    p80: f.p80Ms,
    tokensP50: spend?.p50 ?? null,
    tokensP80: spend?.p80 ?? null,
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
      ...(blended.agent === null ? {} : { agent: blended.agent }),
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
        tokensP50: figures.tokensP50,
        tokensP80: figures.tokensP80,
        subtasks: figures.subtasks,
        inputsHash: hash,
        modelVersion: model.version,
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

/** A task's latest claim estimate — one indexed lookup. */
function latestClaim(db: Db, taskId: string): Claim | null {
  return (
    db
      .select({ id: taskClaimEstimates.id, level: taskClaimEstimates.level })
      .from(taskClaimEstimates)
      .where(eq(taskClaimEstimates.taskId, taskId))
      .orderBy(desc(taskClaimEstimates.createdAt), desc(taskClaimEstimates.id))
      .limit(1)
      .get() ?? null
  );
}

function refresh(db: Db, taskId: string, now: number): boolean {
  const s = db.select(SUBJECT).from(tasks).where(eq(tasks.id, taskId)).get();
  if (s === undefined || settled(s)) return false;

  const model = fitFor(db, s.projectId);
  const tagNames = tagsForTasks(db, [s.id]).get(s.id) ?? [];
  const deps =
    db.select({ n: count() }).from(taskDependencies).where(eq(taskDependencies.taskId, s.id)).get()
      ?.n ?? 0;
  const current =
    s.estimateId === null ? undefined : figuresById(db, [s.estimateId]).get(s.estimateId);
  const result = settle(
    db,
    model,
    s,
    { tags: tagNames, deps, children: childrenOf(db, s.id), claim: latestClaim(db, s.id) },
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

/** `start_working`'s optional `estimate` (§7.1, D-085 item 4): the claimant's own. */
export interface ClaimEstimateInput {
  size?: SizeLevel | undefined;
  confidence?: ClaimConfidence | undefined;
}

/**
 * Keep what the claimant said at claim (§4.34) — inside the claim's
 * transaction, after its activity row, and **best effort**: an optional
 * estimate that cannot be stored is logged and the claim stands. Then the
 * task is recomputed, so a claimant whose estimates have earned weight here
 * moves the forecast the claim freezes. Nothing about who said it is kept.
 */
export function recordClaimEstimate(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: ClaimEstimateInput,
  now: number,
): void {
  if (input.size === undefined && input.confidence === undefined) return;
  bestEffort(db, 'claim', taskId, undefined, () => {
    const tokenId = actor.token?.id ?? null;
    // D-076's name for the client, else the token's own — as a round keeps it.
    const token =
      tokenId === null
        ? undefined
        : db
            .select({ client: tokens.lastClientName, name: tokens.name })
            .from(tokens)
            .where(eq(tokens.id, tokenId))
            .get();
    db.insert(taskClaimEstimates)
      .values({
        id: newId(),
        taskId,
        level: input.size ?? null,
        confidence: input.confidence ?? null,
        clientName: token === undefined ? null : (token.client ?? token.name),
        createdAt: now,
      })
      .run();
  });
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

/**
 * A task's tokens, as the forecast counts them: build up to the first
 * finish's (UTC) day, the rest after it as rework. Null with none tied to it.
 */
function spentOn(db: Db, taskId: string, firstFinishAt: number | null): ActualTokens | null {
  const days = db
    .select({
      day: tokenUsageDays.day,
      tokens: sql<number>`coalesce(sum(${headline}), 0)`.mapWith(Number),
    })
    .from(tokenUsageDays)
    .where(eq(tokenUsageDays.taskId, taskId))
    .groupBy(tokenUsageDays.day)
    .all();
  if (days.length === 0) return null;
  let total = 0;
  let build = 0;
  const cut = firstFinishAt === null ? null : utcDay(firstFinishAt);
  for (const d of days) {
    total += d.tokens;
    if (cut === null || d.day <= cut) build += d.tokens;
  }
  return { build, total, rework: total - build };
}

/** Finished XL tasks here, and how many rounds they took (LAI-772, the R&D's idea 9). */
function splitFor(db: Db, projectId: string, exceptId: string): SplitSuggestion {
  const sized = db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(
      taskEstimates,
      eq(taskEstimates.id, sql`coalesce(${tasks.estimateAtStartId}, ${tasks.estimateId})`),
    )
    .where(
      and(
        eq(tasks.projectId, projectId),
        inArray(tasks.status, ['review', 'done']),
        eq(taskEstimates.level, 'XL'),
        sql`${tasks.id} <> ${exceptId}`,
      ),
    )
    .all()
    .map((r) => r.id);
  if (sized.length === 0) return { xl_finished: 0, rounds_avg: null };
  const rounds = db
    .select({ taskId: taskRounds.taskId, n: sql<number>`max(${taskRounds.number})` })
    .from(taskRounds)
    .where(inArray(taskRounds.taskId, sized))
    .groupBy(taskRounds.taskId)
    .all();
  const MIN_XL = 3;
  return {
    xl_finished: sized.length,
    rounds_avg:
      rounds.length < MIN_XL
        ? null
        : Math.round((rounds.reduce((sum, r) => sum + r.n, 0) / rounds.length) * 10) / 10,
  };
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

  const fitted = fitFor(db, task.projectId);
  const size = sizeViews(db, [task]).get(task.id) ?? null;
  const actual = actualTimes(statusMoves(db, task.id), task, now);
  const claims = db
    .select()
    .from(taskClaimEstimates)
    .where(eq(taskClaimEstimates.taskId, task.id))
    .orderBy(desc(taskClaimEstimates.createdAt), desc(taskClaimEstimates.id))
    .all();
  // The estimate in force when work started, as the freeze reads it; else the latest.
  const startedAt = task.startedAt;
  const claim =
    startedAt === null ? claims[0] : (claims.find((c) => c.createdAt <= startedAt) ?? claims[0]);
  // "Scope grew after start": the computed size is a level or more above the
  // one frozen when work began (the R&D's idea 12). Laika's, not a person's.
  const levelIndex = (l: SizeLevel) => SIZE_LEVELS.indexOf(l);
  const scopeGrew: ScopeGrowth | null =
    atStart?.level == null ||
    model?.level == null ||
    levelIndex(model.level) < levelIndex(atStart.level) + 1
      ? null
      : { from: atStart.level, to: model.level };

  return {
    task_id: task.id,
    size,
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
            tokens_p50: atStart.tokensP50,
            tokens_p80: atStart.tokensP80,
            estimated_at: atStart.createdAt,
          },
    actual,
    tokens: {
      p50: model?.tokensP50 ?? null,
      p80: model?.tokensP80 ?? null,
      learned_from: fitted.tokenSamples,
      forecasts_after: TOKEN_FORECAST_AFTER,
    },
    actual_tokens: can(withProject(actor, task.projectId), 'usage.read_project', {
      projectId: task.projectId,
    })
      ? spentOn(db, task.id, actual.first_finish_at)
      : null,
    claim_estimate:
      claim === undefined ? null : { level: claim.level, confidence: claim.confidence },
    scope_grew: scopeGrew,
    split: size?.level === 'XL' ? splitFor(db, task.projectId, task.id) : null,
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

  const model = fitFor(db, project.id);
  const fit = model.fit;
  const finishes = firstFinishes(db, project.id);
  const frozen = db
    .select({
      id: tasks.id,
      status: tasks.status,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
      p50: taskEstimates.buildP50Ms,
      p80: taskEstimates.buildP80Ms,
      tokensP50: taskEstimates.tokensP50,
      tokensP80: taskEstimates.tokensP80,
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
  //
  // **A registered agent's round counts under its harness** — `claude-code`,
  // `omnigent` — never its client name, which for a registered agent is
  // usually its token's, i.e. its registered, name: the owner's alone (D-120,
  // LAI-1001). A legacy token keeps the name it was always grouped by.
  const firstRounds = db
    .select({
      taskId: taskRounds.taskId,
      clientName: taskRounds.clientName,
      harness: agents.harness,
      by: taskRounds.finishedBy,
    })
    .from(taskRounds)
    .innerJoin(tasks, eq(tasks.id, taskRounds.taskId))
    .leftJoin(tokens, eq(tokens.id, taskRounds.tokenId))
    .leftJoin(agents, eq(agents.id, tokens.agentId))
    .where(and(eq(tasks.projectId, project.id), eq(taskRounds.number, 1)))
    .all()
    .map((r) => ({ taskId: r.taskId, client: r.harness ?? r.clientName, by: r.by }));
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

  // Tokens (LAI-772): each frozen token forecast against the build tokens
  // spent, where its people's work was attributed enough to be believed.
  const finishOfTask = new Map<string, number | null>();
  for (const t of frozen) {
    if (t.status === 'cancelled' || t.tokensP50 === null || t.tokensP80 === null) continue;
    const finish = finishOf(t, finishes);
    if (finish !== null) finishOfTask.set(t.id, finish);
  }
  const spent = tokenActuals(db, project.id, finishOfTask);
  const tokenPairs: { log: number; hit: boolean }[] = [];
  for (const t of frozen) {
    const actual = spent.get(t.id);
    if (!finishOfTask.has(t.id) || actual === undefined) continue;
    if (actual.build <= 0 || actual.coverage < MIN_TOKEN_COVERAGE) continue;
    tokenPairs.push({
      log: Math.log(actual.build / t.tokensP50!),
      hit: actual.build <= t.tokensP80!,
    });
  }

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
    tokens: {
      learned_from: model.tokenSamples,
      forecasts_after: TOKEN_FORECAST_AFTER,
      live: figuresFor(tokenPairs),
      backtest: backtestOf(model.tokens?.backtest),
    },
    agent: { size: model.agent, confidence: confidenceRecord(db, project.id) },
    model_version: model.version,
  };
}

/** A replay's figures as the accuracy view sends them; null with nothing replayed. */
function backtestOf(
  bt:
    | {
        n: number;
        methodError: number | null;
        medianError: number | null;
        p80Hit: number | null;
        beatsMedian: boolean;
      }
    | null
    | undefined,
): BacktestFigures | null {
  if (bt === null || bt === undefined || bt.n === 0) return null;
  const { methodError, medianError, p80Hit } = bt;
  if (methodError === null || medianError === null || p80Hit === null) return null;
  return {
    n: bt.n,
    method_error: round(methodError, 2),
    median_error: round(medianError, 2),
    p80_hit_rate: round(p80Hit, 3),
    beats_median: bt.beatsMedian,
  };
}

/**
 * Each confidence the claimants gave against what the reviewer decided
 * (the R&D's idea 15): of the tasks claimed with it and decided at least
 * once, how many were sent back at least once. The estimate in force when
 * work started, as everywhere. Per project; nobody is named or counted apart.
 */
function confidenceRecord(db: Db, projectId: string): ConfidenceRecord[] {
  const said = new Map<string, ClaimConfidence>();
  for (const c of db
    .select({
      taskId: taskClaimEstimates.taskId,
      confidence: taskClaimEstimates.confidence,
      createdAt: taskClaimEstimates.createdAt,
      startedAt: tasks.startedAt,
    })
    .from(taskClaimEstimates)
    .innerJoin(tasks, eq(tasks.id, taskClaimEstimates.taskId))
    .where(and(eq(tasks.projectId, projectId), isNotNull(taskClaimEstimates.confidence)))
    .orderBy(desc(taskClaimEstimates.createdAt))
    .all()) {
    if (said.has(c.taskId) || c.confidence === null) continue;
    if (c.startedAt !== null && c.createdAt > c.startedAt) continue;
    said.set(c.taskId, c.confidence);
  }
  const decided = new Map<string, boolean>();
  if (said.size > 0) {
    const ids = [...said.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      for (const d of db
        .select({ taskId: taskReviews.taskId, decision: taskReviews.decision })
        .from(taskReviews)
        .where(inArray(taskReviews.taskId, ids.slice(i, i + 500)))
        .all()) {
        decided.set(d.taskId, (decided.get(d.taskId) ?? false) || d.decision === 'sent_back');
      }
    }
  }
  return CLAIM_CONFIDENCES.map((confidence) => {
    let n = 0;
    let back = 0;
    for (const [taskId, c] of said) {
      if (c !== confidence || !decided.has(taskId)) continue;
      n += 1;
      if (decided.get(taskId) === true) back += 1;
    }
    return { confidence, n, sent_back: back };
  });
}

// ------------------------------------------------- for agents and reviewers

/** How many similar tasks `get_task_context` names. */
export const SIMILAR_FOR_AGENTS = 5;
/** A send-back's reason, as an agent reads it: the first this many characters. */
const REASON_CHARS = 400;

/**
 * The finished tasks most like this one, closest first — up to five — and why
 * each was sent back, for `get_task_context` (LAI-772, the R&D's idea 8): the
 * agent about to start learns from the rework those tasks needed.
 *
 * **Send-back reasons only, and nobody's name**: no assignee, no finisher, no
 * reviewer — the key, the title, how many rounds it took and the reasons as
 * they were written (D-078). Asked under `project.read`, as the task is;
 * similar tasks are always the same project's.
 */
export function similarFinishedTasks(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  k: number = SIMILAR_FOR_AGENTS,
): SimilarPastTask[] {
  const task = db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      descriptionMd: tasks.descriptionMd,
      acceptanceMd: tasks.acceptanceMd,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  assertCan(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId });

  const model = fitFor(db, task.projectId);
  const signals = readSignals({
    title: task.title,
    description: task.descriptionMd,
    acceptance: task.acceptanceMd,
    tags: [],
    blockedBy: 0,
  });
  const found = findSimilar(model.lookup, signals.terms, task.id, k);
  if (found.length === 0) return [];
  const ids = found.map((f) => f.id);

  const status = new Map(
    db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .all()
      .map((r) => [r.id, r.status] as const),
  );
  const rounds = new Map<string, { id: string; number: number }[]>();
  for (const r of db
    .select({ id: taskRounds.id, taskId: taskRounds.taskId, number: taskRounds.number })
    .from(taskRounds)
    .where(inArray(taskRounds.taskId, ids))
    .all()) {
    rounds.set(r.taskId, [...(rounds.get(r.taskId) ?? []), { id: r.id, number: r.number }]);
  }
  const reasons = new Map<string, SimilarPastTask['send_backs']>();
  for (const d of db
    .select({
      taskId: taskReviews.taskId,
      roundId: taskReviews.roundId,
      reason: taskReviews.reasonMd,
    })
    .from(taskReviews)
    .where(and(inArray(taskReviews.taskId, ids), eq(taskReviews.decision, 'sent_back')))
    .orderBy(asc(taskReviews.createdAt), asc(taskReviews.id))
    .all()) {
    const text = (d.reason ?? '').trim();
    if (text === '') continue;
    const round = rounds.get(d.taskId)?.find((r) => r.id === d.roundId)?.number ?? null;
    reasons.set(d.taskId, [
      ...(reasons.get(d.taskId) ?? []),
      {
        round,
        reason: text.length > REASON_CHARS ? `${text.slice(0, REASON_CHARS - 1)}…` : text,
      },
    ]);
  }
  return found.flatMap((f) => {
    const s = status.get(f.id);
    if (s === undefined) return [];
    return [
      {
        task_id: f.id,
        key: f.key,
        title: f.title,
        status: s,
        similarity: f.similarity,
        rounds: Math.max(0, ...(rounds.get(f.id) ?? []).map((r) => r.number)),
        send_backs: reasons.get(f.id) ?? [],
      },
    ];
  });
}

/** Finished below this share of its frozen p50, a round is worth a second look (the R&D's idea 7). */
export const FAST_FINISH_RATIO = 0.25;

/**
 * The fast-finish cue for a page of the Review queue: a **first** round
 * finished in under a quarter of the build-time p50 frozen when work started.
 * The caller drops a round CI confirmed — the cue is for work nothing has
 * checked. A later round is rework, which nothing forecasts, so it has none;
 * nor has a task whose project had no hours when it started. One query for
 * the page's frozen rows.
 *
 * **Against Laika's own p50, not the blend** (LAI-772 review, N2). Once the
 * claimants' sizes have earned weight, the frozen row's p50 carries the
 * claimant's own size; a claimant who said XS and finished in minutes would
 * otherwise have set the bar they then cleared. The model's p50 before the
 * blend is kept in the row's *why* (`agent.model_p50_ms`) and is what the cue
 * measures; a row without a blend has only its own p50, which is the model's.
 */
export function fastFinishCues(
  db: Db,
  rows: readonly {
    id: string;
    startedAt: number | null;
    estimateAtStartId: string | null;
    firstRoundAt: number | null;
  }[],
): Map<string, FastFinishCue> {
  const out = new Map<string, FastFinishCue>();
  const ids = rows.flatMap((r) =>
    r.estimateAtStartId === null || r.firstRoundAt === null ? [] : [r.estimateAtStartId],
  );
  if (ids.length === 0) return out;
  const p50s = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const e of db
      .select({
        id: taskEstimates.id,
        p50: taskEstimates.buildP50Ms,
        why: taskEstimates.factorsJson,
      })
      .from(taskEstimates)
      .where(inArray(taskEstimates.id, ids.slice(i, i + 500)))
      .all()) {
      const own = (JSON.parse(e.why) as { agent?: Partial<StoredAgent> }).agent?.model_p50_ms;
      const p50 = typeof own === 'number' && own > 0 ? own : e.p50;
      if (p50 !== null) p50s.set(e.id, p50);
    }
  }
  for (const r of rows) {
    if (r.startedAt === null || r.firstRoundAt === null || r.estimateAtStartId === null) continue;
    const p50 = p50s.get(r.estimateAtStartId);
    const build = r.firstRoundAt - r.startedAt;
    if (p50 === undefined || build < 0 || build >= FAST_FINISH_RATIO * p50) continue;
    out.set(r.id, { kind: 'fast', build_ms: build, forecast_p50_ms: p50 });
  }
  return out;
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
        settleProject(db, built.model, projectId, now) +
        freezeWhereMissed(db, eq(tasks.projectId, projectId))
      );
    });
  }
  return { changed };
}

function settleProject(db: Db, model: Model, projectId: string, now: number): number {
  const all: Subject[] = db.select(SUBJECT).from(tasks).where(eq(tasks.projectId, projectId)).all();
  const due = all.filter((s) => !settled(s));
  if (due.length === 0) return 0;

  // Each task's latest claim estimate, in one query for the project.
  const claims = new Map<string, Claim>();
  for (const c of db
    .select({
      id: taskClaimEstimates.id,
      taskId: taskClaimEstimates.taskId,
      level: taskClaimEstimates.level,
    })
    .from(taskClaimEstimates)
    .innerJoin(tasks, eq(tasks.id, taskClaimEstimates.taskId))
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(taskClaimEstimates.createdAt), desc(taskClaimEstimates.id))
    .all()) {
    if (!claims.has(c.taskId)) claims.set(c.taskId, { id: c.id, level: c.level });
  }
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
      model,
      s,
      {
        tags: tagMap.get(s.id) ?? [],
        deps: deps.get(s.id) ?? 0,
        children,
        claim: claims.get(s.id) ?? null,
      },
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
