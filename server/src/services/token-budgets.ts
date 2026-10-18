import { and, desc, eq, gte, inArray, isNull, lte, max, or, sql } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { type BudgetScope, type TokenAlertKind } from '../db/enums.ts';
import {
  activity,
  heartbeats,
  projects,
  pushedCommitKeys,
  sprints,
  taskEstimates,
  taskRounds,
  tasks,
  tokenAlertDismissals,
  tokenAlerts,
  tokenBudgets,
  tokenUsageDays,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { createLogger, type Logger } from '../log.ts';
import { assertCan, can } from '../policy/can.ts';
import { dayIn } from './calendar-days.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * Token budgets, soft alerts and the runaway-agent alert (LAI-773; the
 * estimation research's ideas 3 and 4).
 *
 * ## Budgets
 *
 * A lead sets one for a task, a sprint (its tasks' tokens on the sprint's
 * days) or a project (its tasks' tokens per calendar month, UTC) — on a web
 * session (`budget.set`, §3.2). **A task with none has the p80 of the token
 * forecast frozen at its claim** (§4.32), computed and never stored. Usage is
 * the headline, input + output + cache writes, the forecast's own unit
 * (D-084 item 8). **Soft**: crossing 80% or 100% raises an alert once and
 * refuses nothing to anybody, ever.
 *
 * ## Runaway
 *
 * A claimed task still on its first build — in progress, with an assignee and
 * no finished round — whose tokens pass the **p95** of its frozen forecast
 * while **nothing has landed for an hour**: no claim, no push GitHub reported
 * for the task, no commit key from the assignee's machine, and no session
 * arriving on the task. The p95 is the frozen range read as the log-normal the
 * model calibrates (§4.32): `p50 · (p80/p50)^(z95/z80)`.
 *
 * **A heartbeat is presence, not progress** (D-005 gives it a repo and a branch
 * and nothing else): an agent looping through tool calls heartbeats as
 * steadily as one doing good work. What a heartbeat *can* show is a session
 * arriving on the task — the first one after the presence window's silence —
 * and that counts: somebody sat down to it.
 *
 * **The hour** is measured: on this repository's history, 581 gaps between
 * consecutive commits of one task within a sitting have p90 31 minutes and
 * p95 47; a window shorter than that would flag ordinary work between
 * commits. Sixty minutes clears it and is six sync intervals, so one late
 * sync never raises an alert.
 *
 * **The assignee is told first, and only they**: the alert names them as its
 * one recipient. Owners and admins see how many a project had, never which
 * task or whose, and only once an alert is a day old (`runawayCounts`).
 *
 * ## Best effort
 *
 * Everything here that runs on a report runs after the report is stored, in a
 * savepoint, and a failure is logged (`token_alerts.failed`) and costs only
 * the alert: a report, a claim or a task save is never refused for it.
 */

let log: Logger = createLogger();

/** Report alert failures to this logger — `app.ts` passes the process's. */
export function setTokenAlertLogger(logger: Logger): void {
  log = logger;
}

/** The thresholds a budget alerts at, in percent. */
export const BUDGET_THRESHOLDS = [80, 100] as const;
/** Nothing has landed for this long before a runaway alert. */
export const RUNAWAY_QUIET_MS = 60 * 60_000;
/** A session is "arriving" on a task after this much silence: §9.3's presence window. */
const ARRIVAL_GAP_MS = 5 * 60_000;
/** Owners and admins count a runaway alert once it is this old: the assignee hears first. */
export const RUNAWAY_ADMIN_DELAY_MS = 24 * 3_600_000;

const Z80 = 0.8416212335729143;
const Z95 = 1.6448536269514722;

/** The p95 a frozen p50–p80 implies, read as a log-normal. */
export function p95From(p50: number, p80: number): number {
  if (!(p50 > 0) || !(p80 >= p50)) return Math.max(p50, p80);
  return Math.round(p50 * (p80 / p50) ** (Z95 / Z80));
}

const headline =
  sql<number>`coalesce(sum(${tokenUsageDays.input} + ${tokenUsageDays.output} + ${tokenUsageDays.cacheWrite}), 0)`.mapWith(
    Number,
  );

export type BudgetState = 'under' | 'warn' | 'over';

/** A budget, how much of it is spent, and the alerts it raised. */
export interface BudgetView {
  scope: BudgetScope;
  /** The task, sprint or project id. */
  id: string;
  project: { slug: string; name: string };
  /** A task's key and title, a sprint's name, or the project's name. */
  label: string;
  title: string | null;
  /** `set` by a lead, or a task's frozen `forecast` p80. */
  source: 'set' | 'forecast';
  tokens: number;
  /** The days counted, inclusive; `null` for a task (all its tokens). */
  period: { from: string; to: string } | null;
  used: number;
  share: number;
  state: BudgetState;
  crossed: { threshold: number; at: number }[];
}

export function stateOf(share: number): BudgetState {
  if (share >= 1) return 'over';
  if (share >= 0.8) return 'warn';
  return 'under';
}

/** The calendar month `now` is in, UTC, as days. */
export function monthOf(now: number): { period: string; from: string; to: string } {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, '0');
  return {
    period: `${String(y)}-${mm}`,
    from: `${String(y)}-${mm}-01`,
    to: `${String(y)}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

const sprintDays = (s: { startsOn: number; endsOn: number }) => ({
  from: dayIn('UTC', s.startsOn),
  to: dayIn('UTC', s.endsOn),
});

interface TaskFacts {
  id: string;
  projectId: string;
  number: number;
  title: string;
  status: string;
  assigneeId: string | null;
  sprintId: string | null;
  startedAt: number | null;
  prefix: string;
  slug: string;
  projectName: string;
  p50: number | null;
  p80: number | null;
}

function taskFacts(db: Db, ids: readonly string[]): TaskFacts[] {
  if (ids.length === 0) return [];
  return db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      sprintId: tasks.sprintId,
      startedAt: tasks.startedAt,
      prefix: projects.prefix,
      slug: projects.slug,
      projectName: projects.name,
      p50: taskEstimates.tokensP50,
      p80: taskEstimates.tokensP80,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(taskEstimates, eq(taskEstimates.id, tasks.estimateAtStartId))
    .where(inArray(tasks.id, [...ids]))
    .all();
}

/** Headline tokens tied to each task, all days — one range of the task index each. */
function taskUsed(db: Db, ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  for (const r of db
    .select({ taskId: tokenUsageDays.taskId, tokens: headline })
    .from(tokenUsageDays)
    .where(inArray(tokenUsageDays.taskId, [...ids]))
    .groupBy(tokenUsageDays.taskId)
    .all()) {
    if (r.taskId !== null) out.set(r.taskId, r.tokens);
  }
  return out;
}

function sprintUsed(db: Db, sprintId: string, from: string, to: string): number {
  return (
    db
      .select({ tokens: headline })
      .from(tokenUsageDays)
      .innerJoin(tasks, eq(tasks.id, tokenUsageDays.taskId))
      .where(
        and(
          eq(tasks.sprintId, sprintId),
          gte(tokenUsageDays.day, from),
          lte(tokenUsageDays.day, to),
        ),
      )
      .get()?.tokens ?? 0
  );
}

function projectUsed(db: Db, projectId: string, from: string, to: string): number {
  return (
    db
      .select({ tokens: headline })
      .from(tokenUsageDays)
      .where(
        and(
          eq(tokenUsageDays.projectId, projectId),
          gte(tokenUsageDays.day, from),
          lte(tokenUsageDays.day, to),
        ),
      )
      .get()?.tokens ?? 0
  );
}

/** The alerts a budget raised under the figure now in force. */
function crossedFor(
  db: Db,
  subjectIds: readonly string[],
): Map<string, { threshold: number; at: number; period: string; limit: number }[]> {
  const out = new Map<string, { threshold: number; at: number; period: string; limit: number }[]>();
  if (subjectIds.length === 0) return out;
  for (const a of db
    .select({
      subjectId: tokenAlerts.subjectId,
      threshold: tokenAlerts.threshold,
      period: tokenAlerts.period,
      limit: tokenAlerts.limitTokens,
      createdAt: tokenAlerts.createdAt,
    })
    .from(tokenAlerts)
    .where(and(eq(tokenAlerts.kind, 'budget'), inArray(tokenAlerts.subjectId, [...subjectIds])))
    .all()) {
    const list = out.get(a.subjectId) ?? [];
    list.push({ threshold: a.threshold, at: a.createdAt, period: a.period, limit: a.limit });
    out.set(a.subjectId, list);
  }
  return out;
}

function view(
  base: Omit<BudgetView, 'share' | 'state' | 'crossed'>,
  crossed: readonly { threshold: number; at: number; period: string; limit: number }[],
  period: string,
): BudgetView {
  const share = base.tokens > 0 ? base.used / base.tokens : 0;
  return {
    ...base,
    share,
    state: stateOf(share),
    crossed: crossed
      .filter((c) => c.period === period && c.limit === base.tokens)
      .map((c) => ({ threshold: c.threshold, at: c.at }))
      .sort((a, b) => a.threshold - b.threshold),
  };
}

/** Each task's budget in force — its own, else its frozen p80 — or none. */
export function taskBudgets(db: Db, ids: readonly string[]): BudgetView[] {
  const facts = taskFacts(db, ids);
  if (facts.length === 0) return [];
  const set = new Map(
    db
      .select({ taskId: tokenBudgets.taskId, tokens: tokenBudgets.tokens })
      .from(tokenBudgets)
      .where(
        inArray(
          tokenBudgets.taskId,
          facts.map((f) => f.id),
        ),
      )
      .all()
      .map((r) => [r.taskId ?? '', r.tokens]),
  );
  const used = taskUsed(
    db,
    facts.map((f) => f.id),
  );
  const crossed = crossedFor(
    db,
    facts.map((f) => f.id),
  );
  const out: BudgetView[] = [];
  for (const f of facts) {
    const own = set.get(f.id);
    const tokens = own ?? f.p80 ?? null;
    if (tokens === null || !(tokens > 0)) continue;
    out.push(
      view(
        {
          scope: 'task',
          id: f.id,
          project: { slug: f.slug, name: f.projectName },
          label: `${f.prefix}-${String(f.number)}`,
          title: f.title,
          source: own === undefined ? 'forecast' : 'set',
          tokens,
          period: null,
          used: used.get(f.id) ?? 0,
        },
        crossed.get(f.id) ?? [],
        '',
      ),
    );
  }
  return out;
}

function sprintBudgetViews(db: Db, projectIds: readonly string[]): BudgetView[] {
  if (projectIds.length === 0) return [];
  const rows = db
    .select({
      sprintId: sprints.id,
      name: sprints.name,
      startsOn: sprints.startsOn,
      endsOn: sprints.endsOn,
      status: sprints.status,
      tokens: tokenBudgets.tokens,
      slug: projects.slug,
      projectName: projects.name,
    })
    .from(tokenBudgets)
    .innerJoin(sprints, eq(sprints.id, tokenBudgets.sprintId))
    .innerJoin(projects, eq(projects.id, tokenBudgets.projectId))
    .where(and(eq(tokenBudgets.scope, 'sprint'), inArray(tokenBudgets.projectId, [...projectIds])))
    .all();
  const crossed = crossedFor(
    db,
    rows.map((r) => r.sprintId),
  );
  return rows
    .map((r) => {
      const period = sprintDays(r);
      return view(
        {
          scope: 'sprint',
          id: r.sprintId,
          project: { slug: r.slug, name: r.projectName },
          label: r.name,
          title: null,
          source: 'set',
          tokens: r.tokens,
          period,
          used: sprintUsed(db, r.sprintId, period.from, period.to),
        },
        crossed.get(r.sprintId) ?? [],
        '',
      );
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name) || a.label.localeCompare(b.label));
}

function projectBudgetViews(db: Db, projectIds: readonly string[], now: number): BudgetView[] {
  if (projectIds.length === 0) return [];
  const month = monthOf(now);
  const rows = db
    .select({
      projectId: tokenBudgets.projectId,
      tokens: tokenBudgets.tokens,
      slug: projects.slug,
      name: projects.name,
    })
    .from(tokenBudgets)
    .innerJoin(projects, eq(projects.id, tokenBudgets.projectId))
    .where(and(eq(tokenBudgets.scope, 'project'), inArray(tokenBudgets.projectId, [...projectIds])))
    .all();
  const crossed = crossedFor(
    db,
    rows.map((r) => r.projectId),
  );
  return rows
    .map((r) =>
      view(
        {
          scope: 'project',
          id: r.projectId,
          project: { slug: r.slug, name: r.name },
          label: r.name,
          title: null,
          source: 'set',
          tokens: r.tokens,
          period: { from: month.from, to: month.to },
          used: projectUsed(db, r.projectId, month.from, month.to),
        },
        crossed.get(r.projectId) ?? [],
        month.period,
      ),
    )
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** Open work with a budget in these projects — in progress or in review. */
function openTaskIds(db: Db, projectIds: readonly string[]): string[] {
  if (projectIds.length === 0) return [];
  return db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        inArray(tasks.projectId, [...projectIds]),
        inArray(tasks.status, ['in_progress', 'review']),
      ),
    )
    .all()
    .map((r) => r.id);
}

/**
 * The budgets a reader of these projects sees on the Usage page: each
 * project's and sprint's, then the open tasks at 80% of theirs or more, the
 * fullest first, at most `limit`.
 */
export function budgetsForUsage(
  db: Db,
  projectIds: readonly string[],
  now: number,
  limit = 20,
): BudgetView[] {
  const explicit = db
    .select({ taskId: tokenBudgets.taskId })
    .from(tokenBudgets)
    .where(and(eq(tokenBudgets.scope, 'task'), inArray(tokenBudgets.projectId, [...projectIds])))
    .all()
    .map((r) => r.taskId ?? '');
  const ids = [...new Set([...openTaskIds(db, projectIds), ...explicit])];
  const hot = taskBudgets(db, ids)
    .filter((b) => b.share >= 0.8)
    .sort((a, b) => b.share - a.share || a.label.localeCompare(b.label))
    .slice(0, limit);
  return [...projectBudgetViews(db, projectIds, now), ...sprintBudgetViews(db, projectIds), ...hot];
}

/** `GET /projects/:slug/budgets`. */
export interface ProjectBudgets {
  project_budget: BudgetView | null;
  sprints: BudgetView[];
  tasks: BudgetView[];
  can_set: boolean;
}

export function getProjectBudgets(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  now: number = Date.now(),
): ProjectBudgets {
  const project = requireProjectBySlug(db, slug);
  const scoped = withProject(actor, project.id);
  assertCan(scoped, 'usage.read_project', { projectId: project.id });
  const explicit = db
    .select({ taskId: tokenBudgets.taskId })
    .from(tokenBudgets)
    .where(and(eq(tokenBudgets.scope, 'task'), eq(tokenBudgets.projectId, project.id)))
    .all()
    .map((r) => r.taskId ?? '');
  const ids = [...new Set([...openTaskIds(db, [project.id]), ...explicit])];
  return {
    project_budget: projectBudgetViews(db, [project.id], now)[0] ?? null,
    sprints: sprintBudgetViews(db, [project.id]),
    tasks: taskBudgets(db, ids).sort((a, b) => b.share - a.share || a.label.localeCompare(b.label)),
    can_set: can(scoped, 'budget.set', { projectId: project.id }),
  };
}

function checkTokens(tokens: number | null): void {
  if (tokens === null) return;
  if (!Number.isInteger(tokens) || tokens <= 0 || tokens > 1_000_000_000_000) {
    throw new ApiError('unprocessable', 'A budget is a whole number of tokens above zero', {
      field: 'tokens',
    });
  }
}

function writeBudget(
  db: Db,
  actor: ResolvedActor,
  subject: { scope: BudgetScope; projectId: string; taskId?: string; sprintId?: string },
  tokens: number | null,
  now: number,
): void {
  assertCan(withProject(actor, subject.projectId), 'budget.set', { projectId: subject.projectId });
  checkTokens(tokens);
  const where =
    subject.scope === 'task'
      ? eq(tokenBudgets.taskId, subject.taskId ?? '')
      : subject.scope === 'sprint'
        ? eq(tokenBudgets.sprintId, subject.sprintId ?? '')
        : and(eq(tokenBudgets.scope, 'project'), eq(tokenBudgets.projectId, subject.projectId));
  db.transaction((tx) => {
    const held = tx.select({ id: tokenBudgets.id }).from(tokenBudgets).where(where).get();
    if (tokens === null) {
      if (held !== undefined) tx.delete(tokenBudgets).where(eq(tokenBudgets.id, held.id)).run();
      return;
    }
    if (held === undefined) {
      tx.insert(tokenBudgets)
        .values({
          id: newId(),
          projectId: subject.projectId,
          scope: subject.scope,
          taskId: subject.taskId ?? null,
          sprintId: subject.sprintId ?? null,
          tokens,
          setBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      tx.update(tokenBudgets)
        .set({ tokens, setBy: actor.userId, updatedAt: now })
        .where(eq(tokenBudgets.id, held.id))
        .run();
    }
  });
}

/** `PUT /tasks/:id/budget` — `null` goes back to the frozen forecast's p80. */
export function setTaskBudget(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  tokens: number | null,
  now: number = Date.now(),
): BudgetView | null {
  const task = db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  writeBudget(db, actor, { scope: 'task', projectId: task.projectId, taskId }, tokens, now);
  evaluateBudgets(db, [taskId], now);
  return taskBudgets(db, [taskId])[0] ?? null;
}

/** `PUT /sprints/:id/budget` — `null` removes it. */
export function setSprintBudget(
  db: Db,
  actor: ResolvedActor,
  sprintId: string,
  tokens: number | null,
  now: number = Date.now(),
): BudgetView | null {
  const sprint = db
    .select({ projectId: sprints.projectId })
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .get();
  if (sprint === undefined) throw ApiError.notFound(`No sprint with id "${sprintId}"`);
  writeBudget(db, actor, { scope: 'sprint', projectId: sprint.projectId, sprintId }, tokens, now);
  bestEffort('sprint', sprintId, () => {
    raiseSprint(db, sprintId, now);
  });
  return sprintBudgetViews(db, [sprint.projectId]).find((b) => b.id === sprintId) ?? null;
}

/** `PUT /projects/:slug/budget` — per calendar month, UTC; `null` removes it. */
export function setProjectBudget(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  tokens: number | null,
  now: number = Date.now(),
): BudgetView | null {
  const project = requireProjectBySlug(db, slug);
  writeBudget(db, actor, { scope: 'project', projectId: project.id }, tokens, now);
  bestEffort('project', project.id, () => {
    raiseProject(db, project.id, now);
  });
  return projectBudgetViews(db, [project.id], now)[0] ?? null;
}

// ------------------------------------------------------------- raising

function bestEffort(what: string, id: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    log.error('token_alerts.failed', {
      what,
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function raise(
  db: Db,
  alert: {
    kind: TokenAlertKind;
    scope: BudgetScope;
    projectId: string;
    taskId?: string | null;
    sprintId?: string | null;
    subjectId: string;
    period?: string;
    threshold: number;
    limitTokens: number;
    tokens: number;
    userId?: string | null;
  },
  now: number,
): void {
  db.insert(tokenAlerts)
    .values({
      id: newId(),
      kind: alert.kind,
      scope: alert.scope,
      projectId: alert.projectId,
      taskId: alert.taskId ?? null,
      sprintId: alert.sprintId ?? null,
      subjectId: alert.subjectId,
      period: alert.period ?? '',
      threshold: alert.threshold,
      limitTokens: alert.limitTokens,
      tokens: alert.tokens,
      userId: alert.userId ?? null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
}

function raiseThresholds(
  db: Db,
  base: {
    scope: BudgetScope;
    projectId: string;
    taskId?: string;
    sprintId?: string;
    subjectId: string;
    period?: string;
  },
  limit: number,
  used: number,
  now: number,
): void {
  for (const threshold of BUDGET_THRESHOLDS) {
    if (used * 100 < threshold * limit) continue;
    raise(db, { ...base, kind: 'budget', threshold, limitTokens: limit, tokens: used }, now);
  }
}

function raiseSprint(db: Db, sprintId: string, now: number): void {
  const row = db
    .select({
      projectId: tokenBudgets.projectId,
      tokens: tokenBudgets.tokens,
      startsOn: sprints.startsOn,
      endsOn: sprints.endsOn,
    })
    .from(tokenBudgets)
    .innerJoin(sprints, eq(sprints.id, tokenBudgets.sprintId))
    .where(eq(tokenBudgets.sprintId, sprintId))
    .get();
  if (row === undefined) return;
  const days = sprintDays(row);
  raiseThresholds(
    db,
    { scope: 'sprint', projectId: row.projectId, sprintId, subjectId: sprintId },
    row.tokens,
    sprintUsed(db, sprintId, days.from, days.to),
    now,
  );
}

function raiseProject(db: Db, projectId: string, now: number): void {
  const row = db
    .select({ tokens: tokenBudgets.tokens })
    .from(tokenBudgets)
    .where(and(eq(tokenBudgets.scope, 'project'), eq(tokenBudgets.projectId, projectId)))
    .get();
  if (row === undefined) return;
  const month = monthOf(now);
  raiseThresholds(
    db,
    { scope: 'project', projectId, subjectId: projectId, period: month.period },
    row.tokens,
    projectUsed(db, projectId, month.from, month.to),
    now,
  );
}

/**
 * After tokens for these tasks arrived: each task's budget, and its sprint's
 * and project's — an alert at each threshold crossed, once. Best effort.
 */
export function evaluateBudgets(db: Db, taskIds: readonly string[], now: number): void {
  if (taskIds.length === 0) return;
  bestEffort('budgets', taskIds.join(','), () => {
    db.transaction(() => {
      const budgets = taskBudgets(db, taskIds);
      const facts = new Map(taskFacts(db, taskIds).map((f) => [f.id, f]));
      for (const b of budgets) {
        const f = facts.get(b.id);
        if (f === undefined) continue;
        raiseThresholds(
          db,
          { scope: 'task', projectId: f.projectId, taskId: f.id, subjectId: f.id },
          b.tokens,
          b.used,
          now,
        );
      }
      const sprintIds = new Set(
        [...facts.values()].flatMap((f) => (f.sprintId === null ? [] : [f.sprintId])),
      );
      for (const id of sprintIds) raiseSprint(db, id, now);
      const projectIds = new Set([...facts.values()].map((f) => f.projectId));
      for (const id of projectIds) raiseProject(db, id, now);
    });
  });
}

/**
 * When anything last moved on this task, as Laika can see it: the claim, a
 * push GitHub reported for it, a commit key from the assignee's machine, or a
 * session arriving on it.
 */
export function lastProgress(db: Db, task: TaskFacts, now: number): number {
  let last = task.startedAt ?? 0;
  const pushed = db
    .select({ at: max(activity.createdAt) })
    .from(activity)
    .where(and(eq(activity.taskId, task.id), eq(activity.type, 'webhook.commit')))
    .get()?.at;
  if (pushed !== null && pushed !== undefined) last = Math.max(last, pushed);
  if (task.assigneeId !== null) {
    const key = db
      .select({ at: max(pushedCommitKeys.createdAt) })
      .from(pushedCommitKeys)
      .where(
        and(
          eq(pushedCommitKeys.userId, task.assigneeId),
          gte(pushedCommitKeys.day, dayIn('UTC', now - 2 * 86_400_000)),
        ),
      )
      .get()?.at;
    if (key !== null && key !== undefined) last = Math.max(last, key);
  }
  // Sessions arriving: the first heartbeat after the presence window's
  // silence, per token. Only the recent ones can matter.
  const since = now - RUNAWAY_QUIET_MS - ARRIVAL_GAP_MS;
  const beats = db
    .select({ tokenId: heartbeats.tokenId, at: heartbeats.createdAt })
    .from(heartbeats)
    .where(and(eq(heartbeats.matchedTaskId, task.id), gte(heartbeats.createdAt, since)))
    .orderBy(heartbeats.createdAt)
    .all();
  const seen = new Map<string, number>();
  for (const b of beats) {
    const token = b.tokenId ?? '';
    const before = seen.get(token);
    // The first in range counts only when nothing came just before it.
    if (before === undefined ? b.at - since >= ARRIVAL_GAP_MS : b.at - before >= ARRIVAL_GAP_MS) {
      last = Math.max(last, b.at);
    }
    seen.set(token, b.at);
  }
  return last;
}

/**
 * After tokens for these tasks arrived: a runaway alert for each that is past
 * its p95 with nothing landed for an hour — one per stall. Best effort.
 */
export function checkRunaway(db: Db, taskIds: readonly string[], now: number): void {
  if (taskIds.length === 0) return;
  bestEffort('runaway', taskIds.join(','), () => {
    const facts = taskFacts(db, taskIds).filter(
      (f) =>
        f.status === 'in_progress' && f.assigneeId !== null && f.p50 !== null && f.p80 !== null,
    );
    if (facts.length === 0) return;
    const finished = new Set(
      db
        .selectDistinct({ taskId: taskRounds.taskId })
        .from(taskRounds)
        .where(
          inArray(
            taskRounds.taskId,
            facts.map((f) => f.id),
          ),
        )
        .all()
        .map((r) => r.taskId),
    );
    const used = taskUsed(
      db,
      facts.map((f) => f.id),
    );
    for (const f of facts) {
      // The forecast is for the build: a task handed in once is past it.
      if (finished.has(f.id)) continue;
      const p95 = p95From(f.p50 ?? 0, f.p80 ?? 0);
      const spent = used.get(f.id) ?? 0;
      if (!(p95 > 0) || spent <= p95) continue;
      const last = lastProgress(db, f, now);
      if (now - last < RUNAWAY_QUIET_MS) continue;
      const already = db
        .select({ id: tokenAlerts.id })
        .from(tokenAlerts)
        .where(
          and(
            eq(tokenAlerts.subjectId, f.id),
            eq(tokenAlerts.kind, 'runaway'),
            gte(tokenAlerts.createdAt, last),
          ),
        )
        .get();
      if (already !== undefined) continue;
      raise(
        db,
        {
          kind: 'runaway',
          scope: 'task',
          projectId: f.projectId,
          taskId: f.id,
          subjectId: f.id,
          threshold: 95,
          limitTokens: p95,
          tokens: spent,
          userId: f.assigneeId,
        },
        now,
      );
    }
  });
}

// ------------------------------------------------------------- reading

/** One alert, as the person it is for sees it. */
export interface TokenAlertView {
  id: string;
  kind: TokenAlertKind;
  scope: BudgetScope;
  threshold: number;
  tokens: number;
  limit_tokens: number;
  created_at: number;
  project: { slug: string; name: string };
  task: { id: string; key: string; title: string } | null;
  sprint: { id: string; name: string } | null;
}

/** A runaway alert on a task, for its recipient's own view of the task. */
export interface RunawayView {
  alert_id: string;
  tokens: number;
  p95: number;
  since: number;
  last_progress_at: number;
}

const ALERTS_MAX = 50;

/**
 * `GET /me/token-alerts` — the caller's own, not put away: runaway alerts
 * addressed to them on work they still hold and nothing has moved on since;
 * budget alerts on tasks they hold that are still open; and for a project they
 * lead, its sprint and monthly budget alerts under the budget in force.
 */
export function getMyAlerts(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
): TokenAlertView[] {
  assertCan(actor, 'token_alerts.own');
  const dismissed = new Set(
    db
      .select({ id: tokenAlertDismissals.alertId })
      .from(tokenAlertDismissals)
      .where(eq(tokenAlertDismissals.userId, actor.userId))
      .all()
      .map((r) => r.id),
  );

  const candidates: (typeof tokenAlerts.$inferSelect)[] = [];
  // Runaway: addressed to me.
  candidates.push(
    ...db
      .select()
      .from(tokenAlerts)
      .where(and(eq(tokenAlerts.userId, actor.userId), eq(tokenAlerts.kind, 'runaway')))
      .orderBy(desc(tokenAlerts.createdAt))
      .limit(ALERTS_MAX)
      .all(),
  );
  // Budgets on tasks I hold that are open.
  const mine = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.assigneeId, actor.userId), inArray(tasks.status, ['in_progress', 'review'])),
    )
    .all()
    .map((r) => r.id);
  if (mine.length > 0) {
    candidates.push(
      ...db
        .select()
        .from(tokenAlerts)
        .where(and(eq(tokenAlerts.kind, 'budget'), inArray(tokenAlerts.subjectId, mine)))
        .all(),
    );
  }
  // Sprint and project budgets where I lead.
  const led = db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .all()
    .map((p) => p.id)
    // Whoever may set a project's budgets is who its budget alerts are for.
    .filter((id) => can(withProject(actor, id), 'budget.set', { projectId: id }));
  if (led.length > 0) {
    const month = monthOf(now).period;
    candidates.push(
      ...db
        .select()
        .from(tokenAlerts)
        .where(
          and(
            eq(tokenAlerts.kind, 'budget'),
            inArray(tokenAlerts.projectId, led),
            or(
              eq(tokenAlerts.scope, 'sprint'),
              and(eq(tokenAlerts.scope, 'project'), eq(tokenAlerts.period, month)),
            ),
          ),
        )
        .all(),
    );
  }

  const unique = new Map(candidates.filter((a) => !dismissed.has(a.id)).map((a) => [a.id, a]));
  if (unique.size === 0) return [];

  // Only alerts under the budget in force still speak.
  const budgets = db
    .select({
      scope: tokenBudgets.scope,
      taskId: tokenBudgets.taskId,
      sprintId: tokenBudgets.sprintId,
      projectId: tokenBudgets.projectId,
      tokens: tokenBudgets.tokens,
    })
    .from(tokenBudgets)
    .where(
      inArray(tokenBudgets.projectId, [...new Set([...unique.values()].map((a) => a.projectId))]),
    )
    .all();
  const budgetOf = (a: typeof tokenAlerts.$inferSelect): number | undefined => {
    if (a.scope === 'task') return budgets.find((b) => b.taskId === a.subjectId)?.tokens;
    if (a.scope === 'sprint') return budgets.find((b) => b.sprintId === a.subjectId)?.tokens;
    return budgets.find((b) => b.scope === 'project' && b.projectId === a.subjectId)?.tokens;
  };
  const taskIds = [
    ...new Set([...unique.values()].flatMap((a) => (a.taskId === null ? [] : [a.taskId]))),
  ];
  const facts = new Map(taskFacts(db, taskIds).map((f) => [f.id, f]));
  const sprintRows = new Map(
    db
      .select({ id: sprints.id, name: sprints.name })
      .from(sprints)
      .where(
        inArray(sprints.id, [
          ...new Set(
            [...unique.values()].flatMap((a) => (a.sprintId === null ? [] : [a.sprintId])),
          ),
        ]),
      )
      .all()
      .map((s) => [s.id, s]),
  );
  const projectRows = new Map(
    db
      .select({ id: projects.id, slug: projects.slug, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, [...new Set([...unique.values()].map((a) => a.projectId))]))
      .all()
      .map((p) => [p.id, p]),
  );

  const out: TokenAlertView[] = [];
  for (const a of unique.values()) {
    const task = a.taskId === null ? undefined : facts.get(a.taskId);
    if (a.kind === 'runaway') {
      if (task?.status !== 'in_progress' || task.assigneeId !== actor.userId) continue;
      if (lastProgress(db, task, now) > a.createdAt) continue;
    } else if (a.scope === 'task') {
      const inForce = budgetOf(a) ?? task?.p80 ?? undefined;
      if (inForce !== a.limitTokens) continue;
    } else if (budgetOf(a) !== a.limitTokens) {
      continue;
    }
    const project = projectRows.get(a.projectId);
    if (project === undefined) continue;
    const sprint = a.sprintId === null ? undefined : sprintRows.get(a.sprintId);
    out.push({
      id: a.id,
      kind: a.kind,
      scope: a.scope,
      threshold: a.threshold,
      tokens: a.tokens,
      limit_tokens: a.limitTokens,
      created_at: a.createdAt,
      project: { slug: project.slug, name: project.name },
      task:
        task === undefined
          ? null
          : { id: task.id, key: `${task.prefix}-${String(task.number)}`, title: task.title },
      sprint: sprint === undefined ? null : { id: sprint.id, name: sprint.name },
    });
  }
  // The newest first; a budget's 100% before its 80%.
  return out
    .sort((x, y) => y.created_at - x.created_at || y.threshold - x.threshold)
    .slice(0, ALERTS_MAX);
}

/** `POST /me/token-alerts/:id/dismiss` — only an alert the caller is shown. */
export function dismissAlert(
  db: Db,
  actor: ResolvedActor,
  alertId: string,
  now: number = Date.now(),
): void {
  const visible = getMyAlerts(db, actor, now).some((a) => a.id === alertId);
  if (!visible) throw ApiError.notFound(`No alert with id "${alertId}" for you`);
  db.insert(tokenAlertDismissals)
    .values({ alertId, userId: actor.userId, createdAt: now })
    .onConflictDoNothing()
    .run();
}

/** The open runaway alert on a task, if it is addressed to this reader on a session. */
export function runawayFor(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): RunawayView | null {
  if (!can(actor, 'token_alerts.own')) return null;
  const alert = getMyAlerts(db, actor, now).find(
    (a) => a.kind === 'runaway' && a.task?.id === taskId,
  );
  if (alert === undefined) return null;
  const task = taskFacts(db, [taskId])[0];
  return {
    alert_id: alert.id,
    tokens: alert.tokens,
    p95: alert.limit_tokens,
    since: alert.created_at,
    last_progress_at: task === undefined ? alert.created_at : lastProgress(db, task, now),
  };
}

/**
 * Runaway alerts per project, for owners and admins: **a count, never which
 * task or whose**, and only once an alert is a day old, so the assignee hears
 * first. In project name order — never ranked.
 */
export function runawayCounts(
  db: Db,
  scope: readonly { id: string; slug: string; name: string }[],
  range: { from: string; tz: string },
  now: number,
): { project: { slug: string; name: string }; alerts: number }[] {
  if (scope.length === 0) return [];
  // A day's worth either side of the range's first day, then read in the zone.
  const earliest = Date.parse(`${range.from}T00:00:00Z`) - 14 * 3_600_000;
  const counts = new Map<string, number>();
  for (const a of db
    .select({ projectId: tokenAlerts.projectId, createdAt: tokenAlerts.createdAt })
    .from(tokenAlerts)
    .where(
      and(
        eq(tokenAlerts.kind, 'runaway'),
        inArray(
          tokenAlerts.projectId,
          scope.map((p) => p.id),
        ),
        gte(tokenAlerts.createdAt, earliest),
        lte(tokenAlerts.createdAt, now - RUNAWAY_ADMIN_DELAY_MS),
      ),
    )
    .all()) {
    if (dayIn(range.tz, a.createdAt) < range.from) continue;
    counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1);
  }
  return scope
    .filter((p) => (counts.get(p.id) ?? 0) > 0)
    .map((p) => ({ project: { slug: p.slug, name: p.name }, alerts: counts.get(p.id) ?? 0 }))
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}
