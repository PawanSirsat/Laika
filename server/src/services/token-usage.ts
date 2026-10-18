import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { type AgentClient } from '../auth/agent-clients.ts';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import {
  projectMemberships,
  projects,
  taskReviews,
  taskRounds,
  tasks,
  tokens,
  tokenUsageDays,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { addDays, daysBetween, dayIn, isTimeZone } from './calendar-days.ts';
import {
  agentKindOf,
  assertMaySendLocalActivity,
  assertReportDays,
  sharingOn,
} from './local-activity.ts';
import { readableByOutsideId } from './outside-ids.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * Agents' token usage (D-084, SPEC §4.33, §6.4, LAI-769): a collector's
 * per-day totals in, the Usage page and the profile card out.
 *
 * ## In: a third kind of collector report
 *
 * The same `PUT /me/local-activity` as the snapshot and the look-back, marked
 * `"usage": true`, under the same two switches, body limit and report bucket
 * (D-084 item 4). Per day, rows of agent × model × task key-or-null with the
 * four counts — nothing that could hold text (the route's schema is strict
 * and every string is a pattern). Each (person, collector, day) the report
 * carries is **replaced** by its rows, so a retry never counts twice.
 *
 * A task key is kept only when it names a task in a project the sender may
 * read (D-084 item 5): a key for anything else is stored as unattributed, so
 * no client can credit tokens to work it cannot see.
 *
 * ## Out: totals, and people only for the people allowed them
 *
 * D-084 item 7: owners and admins see everyone, a developer their own, a
 * member a project's totals and never a per-person split. `by_developer` is
 * `null` — not empty — for a reader who may not see it, and a token never may
 * (§3.1's `usage.read_people` is session only). People are listed **by name,
 * never ranked by volume**: tokens never feed a rating or a ranking (item 7).
 *
 * The headline is input + output + cache writes; cache reads — 98% of raw
 * tokens on the measured machine — are always beside it, never in it
 * (item 8). Every figure is a floor (item 9): the client labels it *at least*.
 */

/** A report's days: back to today − 31 in the sender's zone (D-084 item 11's 30, and today). */
export const TOKEN_USAGE_DAYS_BACK = 31;
/** …so at most this many in one report: the window, today and one ahead. */
const TOKEN_USAGE_DAYS_MAX = TOKEN_USAGE_DAYS_BACK + 2;
/** Rows one day may carry (agent × model × task). */
export const TOKEN_USAGE_ROWS_PER_DAY_MAX = 200;
/** No count above this is believed: a trillion tokens a day for one row. */
export const TOKEN_COUNT_MAX = 1_000_000_000_000;
/** A model id as the collector sends it: lower case, `[1m]`-style suffixes removed. */
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
/**
 * A report row's task: a Laika key — a project prefix (§4.3, 2–8 characters)
 * and a number — or a card's outside id (LAI-780), whose shape is wider: a
 * prefix of 1–16 letters, digits and `_`, and 1–9 digits. Upper case, as the
 * collector sends both. Every board key has this shape too.
 */
export const TASK_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/;

/** The Usage page's longest range, in days. */
export const USAGE_RANGE_DAYS_MAX = 92;
export const USAGE_RANGE_DAYS_DEFAULT = 30;
/** The profile card's window: this week and the eleven before it (D-078's twelve). */
export const PERSON_WEEKS = 12;
/** How many tasks the page lists. */
export const TOP_TASKS = 10;

/**
 * The agents whose own session files the collector reads (D-084 item 1). Any
 * other agent a person connects keeps no token count Laika can read — Copilot
 * CLI, Cursor and Windsurf among them — and is shown as *no token data*.
 */
export const TOKEN_SOURCES: ReadonlySet<AgentClient> = new Set<AgentClient>([
  'claude-code',
  'codex',
  'gemini-cli',
]);

/**
 * Clients that are not themselves agents spending tokens: an orchestrator
 * runs one of the agents above, and `other` says nothing.
 */
const NOT_A_TOKEN_SPENDER: ReadonlySet<string> = new Set(['omnigent', 'hermes', 'other']);

export interface TokenUsageRowInput {
  agent: string;
  model: string;
  task: string | null;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface TokenUsageReport {
  v: 1;
  collector_id: string;
  tz: string;
  usage: true;
  /**
   * `backfill: true` on a day that carries tokens from before this collector
   * began counting — the last 30 days, sent once (D-084 item 11). Such a day
   * **replaces every collector's rows** for it and each agent it names, so a
   * machine whose collector started over (`laika activity off`, then `on`)
   * cannot count the same day twice (LAI-769 review 1).
   */
  days: { day: string; backfill?: true | undefined; rows: TokenUsageRowInput[] }[];
}

/** The four counts, the headline (without cache reads) and how much of it a task holds. */
export interface UsageFigures {
  /** input + output + cache_write — the headline (D-084 item 8). */
  tokens: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  /** The part of `tokens` tied to a task (D-084 item 6). */
  attributed_tokens: number;
}

export interface UsageSlice {
  tokens: number;
  cache_read: number;
}

export interface UsageDayPoint extends UsageSlice {
  day: string;
}

export interface UsageDeveloper extends UsageSlice {
  user_id: string;
  name: string;
  attributed_tokens: number;
}

export interface UsageAgentSlice extends UsageSlice {
  agent: AgentClient;
}

export interface UsageModelSlice extends UsageSlice {
  model: string;
}

export interface UsageTaskSlice extends UsageSlice {
  task_id: string;
  key: string;
  title: string;
  project_slug: string;
}

/** The project a rework figure is for. */
export interface ReworkProject {
  slug: string;
  name: string;
}

/**
 * What send-backs cost one project over the range (LAI-772, the R&D's idea
 * 1) — the cost of a false done, in tokens and time. **Per project, never per
 * person** (D-078): no field names or counts anybody.
 */
export interface ReworkCost {
  project: ReworkProject;
  /** Send-backs decided in the range. */
  send_backs: number;
  /** The tasks they sent back. */
  tasks: number;
  /** Tokens tied to those tasks on days after the round sent back, within the range — headline, without cache reads. */
  tokens: number;
  cache_read: number;
  /** From each send-back to the next finish, or to now for one not finished again yet. */
  time_ms: number;
  /** Send-backs not finished again yet. */
  open: number;
  /** Of the project's tokens over the range, the share that was rework; null with none. */
  share: number | null;
}

/** `GET /usage` — the Usage page (§6.4, §11.4.2). */
export interface UsageView {
  /** The range, inclusive, as calendar days in `tz`. */
  from: string;
  to: string;
  tz: string;
  days: number;
  /** The space read, or `null` for the whole organisation. */
  project: { slug: string; name: string } | null;
  totals: UsageFigures;
  /** Every day of the range, oldest first, zeros included. */
  trend: UsageDayPoint[];
  /** In name order; `null` for a reader who may not see people (D-084 item 7). */
  by_developer: UsageDeveloper[] | null;
  by_agent: UsageAgentSlice[];
  by_model: UsageModelSlice[];
  /** The tasks that cost most, where a key was sent (phase 2 sends them). */
  top_tasks: UsageTaskSlice[];
  /** Agents people here connect that keep no token count Laika can read. */
  no_token_data: AgentClient[];
  /**
   * A space holds only tokens tied to its tasks, so beside one the page says
   * what no space can hold: the organisation's totals over the same range —
   * for a reader who may read them (`usage.read_org`), `null` otherwise and
   * for the organisation itself.
   */
  org_totals: UsageFigures | null;
  /** Rework cost per project the reader may read, by name; empty with no send-back in the range. */
  rework: ReworkCost[];
}

export interface UsageWeek extends UsageSlice {
  /** The Monday the week starts on. */
  start: string;
}

/** `GET /users/:id/usage` — the profile card (§6.4, §11.4.2). */
export interface PersonUsageView {
  user_id: string;
  from: string;
  to: string;
  /** This week and the eleven before it, oldest first. */
  weeks: UsageWeek[];
  totals: UsageFigures;
  by_agent: UsageAgentSlice[];
  by_model: UsageModelSlice[];
  no_token_data: AgentClient[];
  /** D-079's two switches for them: whether tokens can arrive at all. */
  sharing: { org_enabled: boolean; enabled: boolean };
}

/** A task's counts: every one of them tied to it, so no attributed part of its own. */
export interface UsageCounts {
  /** input + output + cache_write — the headline (D-084 item 8). */
  tokens: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface TaskUsagePerson extends UsageSlice {
  user_id: string;
  name: string;
  by_agent: UsageAgentSlice[];
}

export interface TaskUsageRound extends UsageSlice {
  /** 1 for the work up to the first finish, 2 for the work up to the next. */
  number: number;
  /** The day it was handed in, in `tz`; `null` for the round still open. */
  finished_on: string | null;
}

/** `GET /tasks/:id/usage` — the task panel's Tokens section (§6.4, LAI-770). */
export interface TaskUsageView {
  task_id: string;
  key: string;
  tz: string;
  /** The first and last day it has tokens on; `null` for none. */
  first_day: string | null;
  last_day: string | null;
  totals: UsageCounts;
  /**
   * Whose part this reader sees (D-084 item 7): `everyone` for an owner or
   * admin, `own` for anyone else on a web session, `none` for a token.
   */
  people: 'everyone' | 'own' | 'none';
  /** In name order, never ranked; `null` when `people` is `none`. */
  by_person: TaskUsagePerson[] | null;
  /** Every finished round in order, then the open one when it has tokens. */
  by_round: TaskUsageRound[];
  /**
   * D-084 item 6: of what the people this reader may see spent on the days
   * this task has tokens, the part tied to a task — this one or another. How
   * much of their work Laika could place, so the task's figure is never taken
   * for the whole story. `null` when the reader sees nobody's part.
   */
  attributed: { tokens: number; of: number } | null;
}

export interface UsageQuery {
  days?: number | undefined;
  project?: string | undefined;
  tz?: string | undefined;
}

// ------------------------------------------------------------------ ingest

const USAGE_WINDOW = { daysBack: TOKEN_USAGE_DAYS_BACK, maxDays: TOKEN_USAGE_DAYS_MAX };

interface ResolvedTask {
  taskId: string;
  projectId: string;
}

/**
 * Each key in the report → the task it names, when the sender may read that
 * task's project. One indexed lookup a key (prefix, then number); a report
 * names a handful.
 *
 * **A key that names no task is tried as an outside id** (LAI-780): the card
 * that carries it, among the projects the sender may read. A board key always
 * wins, and an id two readable cards carry is left unattributed — nobody is
 * here to be asked which, and a report is never refused for it.
 */
function resolveKeys(
  db: Db,
  actor: ResolvedActor,
  keys: ReadonlySet<string>,
): Map<string, ResolvedTask> {
  const resolved = new Map<string, ResolvedTask>();
  for (const key of keys) {
    const dash = key.lastIndexOf('-');
    const found = db
      .select({ taskId: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(eq(projects.prefix, key.slice(0, dash)), eq(tasks.number, Number(key.slice(dash + 1)))),
      )
      .get();
    if (found === undefined) {
      const outside = readableByOutsideId(db, actor, key);
      if (outside.length === 1 && outside[0] !== undefined) {
        resolved.set(key, { taskId: outside[0].taskId, projectId: outside[0].projectId });
      }
      continue;
    }
    if (!can(withProject(actor, found.projectId), 'project.read', { projectId: found.projectId })) {
      continue;
    }
    resolved.set(key, found);
  }
  return resolved;
}

/**
 * `PUT /me/local-activity` with `usage: true`: one machine's token totals for
 * the days it carries, each day replaced whole (D-084 items 3–5).
 */
export function recordTokenUsage(
  db: Db,
  actor: ResolvedActor,
  report: TokenUsageReport,
  now: number = Date.now(),
): { accepted_days: number } {
  assertMaySendLocalActivity(db, actor);
  assertReportDays(report, now, USAGE_WINDOW);
  const collectorId = report.collector_id.toLowerCase();

  const keys = new Set<string>();
  for (const day of report.days) {
    for (const row of day.rows) if (row.task !== null) keys.add(row.task);
  }
  const resolved = resolveKeys(db, actor, keys);

  // Folded per (day, agent, model, task): an alias and its slug, or two keys
  // that both turned out unattributed, are one row.
  const rows: (typeof tokenUsageDays.$inferInsert)[] = [];
  for (const day of report.days) {
    const folded = new Map<string, typeof tokenUsageDays.$inferInsert>();
    for (const row of day.rows) {
      const agent = agentKindOf(row.agent);
      const task = row.task === null ? undefined : resolved.get(row.task);
      const id = `${agent}\u0000${row.model}\u0000${task?.taskId ?? ''}`;
      const existing = folded.get(id);
      if (existing === undefined) {
        folded.set(id, {
          userId: actor.userId,
          collectorId,
          day: day.day,
          agent,
          model: row.model,
          taskId: task?.taskId ?? null,
          projectId: task?.projectId ?? null,
          input: row.input,
          output: row.output,
          cacheWrite: row.cache_write,
          cacheRead: row.cache_read,
          updatedAt: now,
        });
      } else {
        existing.input = (existing.input ?? 0) + row.input;
        existing.output = (existing.output ?? 0) + row.output;
        existing.cacheWrite = (existing.cacheWrite ?? 0) + row.cache_write;
        existing.cacheRead = (existing.cacheRead ?? 0) + row.cache_read;
      }
    }
    // Zeros say nothing; a day of them is an empty day.
    for (const row of folded.values()) {
      if ((row.input ?? 0) + (row.output ?? 0) + (row.cacheWrite ?? 0) + (row.cacheRead ?? 0) > 0) {
        rows.push(row);
      }
    }
  }

  db.transaction((tx) => {
    // A live day replaces this machine's rows for it. A backfilled day also
    // takes the rows of every other collector of this person for the agents
    // it names: the same machine under an earlier collector id is the case it
    // exists for — the collector skips days other machines hold (the sharing
    // answer's `usage_days_elsewhere`), so a second machine's live day is
    // only ever taken by a client that ignored it.
    const live = report.days.filter((d) => d.backfill !== true).map((d) => d.day);
    if (live.length > 0) {
      tx.delete(tokenUsageDays)
        .where(
          and(
            eq(tokenUsageDays.userId, actor.userId),
            eq(tokenUsageDays.collectorId, collectorId),
            inArray(tokenUsageDays.day, live),
          ),
        )
        .run();
    }
    for (const day of report.days) {
      if (day.backfill !== true) continue;
      const agents = [...new Set(day.rows.map((r) => agentKindOf(r.agent)))];
      tx.delete(tokenUsageDays)
        .where(
          and(
            eq(tokenUsageDays.userId, actor.userId),
            eq(tokenUsageDays.day, day.day),
            agents.length === 0
              ? eq(tokenUsageDays.collectorId, collectorId)
              : or(
                  eq(tokenUsageDays.collectorId, collectorId),
                  inArray(tokenUsageDays.agent, agents),
                ),
          ),
        )
        .run();
    }
    // Inserted in slices: SQLite caps a statement's bound parameters.
    for (let i = 0; i < rows.length; i += 50) {
      tx.insert(tokenUsageDays)
        .values(rows.slice(i, i + 50))
        .run();
    }
  });

  return { accepted_days: report.days.length };
}

// ------------------------------------------------------------------- reads

const t = tokenUsageDays;
const headline = sql`${t.input} + ${t.output} + ${t.cacheWrite}`;
const total = (expr: SQLWrapper) => sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number);
const sums = {
  tokens: total(headline),
  input: total(t.input),
  output: total(t.output),
  cacheWrite: total(t.cacheWrite),
  cacheRead: total(t.cacheRead),
  attributed: total(sql`CASE WHEN ${t.taskId} IS NOT NULL THEN ${headline} ELSE 0 END`),
};

function figuresOf(row: {
  tokens: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  attributed: number;
}): UsageFigures {
  return {
    tokens: row.tokens,
    input: row.input,
    output: row.output,
    cache_write: row.cacheWrite,
    cache_read: row.cacheRead,
    attributed_tokens: row.attributed,
  };
}

const NO_FIGURES = { tokens: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, attributed: 0 };

interface Breakdown {
  totals: typeof NO_FIGURES;
  perDay: Map<string, UsageSlice>;
  byAgent: UsageAgentSlice[];
  byModel: UsageModelSlice[];
}

/**
 * Totals, days, agents and models from **one** range of the index: grouped by
 * (day, agent, model) — at most a few hundred groups for a quarter — and
 * folded here. Four `GROUP BY`s over the same range read it four times, and
 * at 300 people that was the page's whole cost.
 */
function breakdown(db: Db, where: SQL | undefined): Breakdown {
  const totals = { ...NO_FIGURES };
  const perDay = new Map<string, UsageSlice>();
  const agents = new Map<string, UsageSlice>();
  const models = new Map<string, UsageSlice>();
  const add = (map: Map<string, UsageSlice>, key: string, tokens: number, cacheRead: number) => {
    const entry = map.get(key) ?? { tokens: 0, cache_read: 0 };
    entry.tokens += tokens;
    entry.cache_read += cacheRead;
    map.set(key, entry);
  };
  for (const r of db
    .select({ day: t.day, agent: t.agent, model: t.model, ...sums })
    .from(t)
    .where(where)
    .groupBy(t.day, t.agent, t.model)
    .all()) {
    totals.tokens += r.tokens;
    totals.input += r.input;
    totals.output += r.output;
    totals.cacheWrite += r.cacheWrite;
    totals.cacheRead += r.cacheRead;
    totals.attributed += r.attributed;
    add(perDay, r.day, r.tokens, r.cacheRead);
    add(agents, agentKindOf(r.agent), r.tokens, r.cacheRead);
    add(models, r.model, r.tokens, r.cacheRead);
  }
  // Most first, then by name, so equal figures keep one order.
  const ranked = (map: Map<string, UsageSlice>) =>
    [...map].sort(([a, x], [b, y]) => y.tokens - x.tokens || a.localeCompare(b));
  return {
    totals,
    perDay,
    byAgent: ranked(agents).map(([agent, v]) => ({ agent: agentKindOf(agent), ...v })),
    byModel: ranked(models).map(([model, v]) => ({ model, ...v })),
  };
}

/**
 * The agents these people connect (D-076's `last_client` on a live token)
 * that keep no token count the collector reads — *no token data*, said rather
 * than shown as zero.
 */
function agentsWithoutTokens(db: Db, userIds: readonly string[] | null): AgentClient[] {
  const rows = db
    .selectDistinct({ client: tokens.lastClient })
    .from(tokens)
    .where(
      and(
        isNull(tokens.revokedAt),
        isNotNull(tokens.lastClient),
        userIds === null ? undefined : inArray(tokens.userId, [...userIds]),
      ),
    )
    .all();
  return [
    ...new Set(
      rows
        .map((r) => agentKindOf(r.client ?? 'other'))
        .filter((a) => !TOKEN_SOURCES.has(a) && !NOT_A_TOKEN_SPENDER.has(a)),
    ),
  ].sort();
}

function zoneOf(tz: string | undefined): string {
  const zone = tz ?? 'UTC';
  if (!isTimeZone(zone)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  return zone;
}

function rangeFor(query: UsageQuery, now: number): { from: string; to: string; tz: string } {
  const tz = zoneOf(query.tz);
  const span = Math.min(
    Math.max(Math.trunc(query.days ?? USAGE_RANGE_DAYS_DEFAULT), 1),
    USAGE_RANGE_DAYS_MAX,
  );
  const to = dayIn(tz, now);
  return { from: addDays(to, -(span - 1)), to, tz };
}

/** `GET /usage?days=&project=&tz=` — the Usage page, as this reader may see it. */
export function getUsage(
  db: Db,
  actor: ResolvedActor,
  query: UsageQuery = {},
  now: number = Date.now(),
): UsageView {
  let project: typeof projects.$inferSelect | undefined;
  if (query.project === undefined) {
    assertCan(actor, 'usage.read_org');
  } else {
    project = requireProjectBySlug(db, query.project);
    assertCan(withProject(actor, project.id), 'usage.read_project', { projectId: project.id });
  }
  const { from, to, tz } = rangeFor(query, now);
  const inRange = and(gte(t.day, from), lte(t.day, to));
  const where = project === undefined ? inRange : and(eq(t.projectId, project.id), inRange);

  const { totals, perDay, byAgent, byModel } = breakdown(db, where);
  const trend: UsageDayPoint[] = [];
  for (let i = 0; i <= daysBetween(from, to); i += 1) {
    const day = addDays(from, i);
    const r = perDay.get(day);
    trend.push({ day, tokens: r?.tokens ?? 0, cache_read: r?.cache_read ?? 0 });
  }

  let byDeveloper: UsageDeveloper[] | null = null;
  if (can(actor, 'usage.read_people')) {
    const people = db
      .select({
        userId: t.userId,
        name: users.name,
        tokens: sums.tokens,
        cacheRead: sums.cacheRead,
        attributed: sums.attributed,
      })
      .from(t)
      .innerJoin(users, eq(users.id, t.userId))
      .where(where)
      .groupBy(t.userId)
      .all();
    byDeveloper = people
      .map((p) => ({
        user_id: p.userId,
        name: p.name,
        tokens: p.tokens,
        cache_read: p.cacheRead,
        attributed_tokens: p.attributed,
      }))
      // By name: a list of people, never a ranking of them (D-084 item 7).
      .sort((a, b) => a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id));
  }

  const topTasks = db
    .select({
      taskId: t.taskId,
      projectId: t.projectId,
      tokens: sums.tokens,
      cacheRead: sums.cacheRead,
    })
    .from(t)
    .where(and(where, isNotNull(t.taskId)))
    .groupBy(t.taskId)
    .orderBy(desc(sums.tokens))
    .limit(TOP_TASKS * 2)
    .all();
  const named = new Map(
    topTasks.length === 0
      ? []
      : db
          .select({
            id: tasks.id,
            number: tasks.number,
            title: tasks.title,
            prefix: projects.prefix,
            slug: projects.slug,
            projectId: projects.id,
          })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(
            inArray(
              tasks.id,
              topTasks.map((r) => r.taskId ?? ''),
            ),
          )
          .all()
          .map((r) => [r.id, r]),
  );
  const top: UsageTaskSlice[] = [];
  for (const r of topTasks) {
    const task = named.get(r.taskId ?? '');
    if (task === undefined) continue;
    // A token pinned to some projects reads the org's figure, not the names
    // of tasks in the others.
    if (!can(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId })) {
      continue;
    }
    top.push({
      task_id: task.id,
      key: `${task.prefix}-${String(task.number)}`,
      title: task.title,
      project_slug: task.slug,
      tokens: r.tokens,
      cache_read: r.cacheRead,
    });
    if (top.length === TOP_TASKS) break;
  }

  const memberIds =
    project === undefined
      ? null
      : db
          .select({ userId: projectMemberships.userId })
          .from(projectMemberships)
          .where(eq(projectMemberships.projectId, project.id))
          .all()
          .map((m) => m.userId);

  const orgTotals =
    project !== undefined && can(actor, 'usage.read_org')
      ? figuresOf(db.select(sums).from(t).where(inRange).get() ?? NO_FIGURES)
      : null;

  const scope =
    project === undefined
      ? db
          .select({ id: projects.id, slug: projects.slug, name: projects.name })
          .from(projects)
          .all()
          .filter((p) => can(withProject(actor, p.id), 'usage.read_project', { projectId: p.id }))
      : [{ id: project.id, slug: project.slug, name: project.name }];

  return {
    from,
    to,
    tz,
    days: daysBetween(from, to) + 1,
    project: project === undefined ? null : { slug: project.slug, name: project.name },
    totals: figuresOf(totals),
    trend,
    by_developer: byDeveloper,
    by_agent: byAgent,
    by_model: byModel,
    top_tasks: top,
    no_token_data: agentsWithoutTokens(db, memberIds),
    org_totals: orgTotals,
    rework: reworkCost(db, scope, { from, to, tz }, now),
  };
}

const DAY_MS = 86_400_000;

/**
 * What send-backs decided in the range cost each project (LAI-772): the
 * tokens tied to the task **after** the round that was sent back — on days
 * after that round's finish day, read in `tz` as the Tokens section reads
 * rounds, and within the range — and the time from each send-back to the
 * task's next finish, or to `now` while it is still being reworked.
 *
 * Bounded by the range: a handful of queries whatever the board's size — the
 * send-backs, their tasks' rounds, those tasks' days, and each project's
 * total for the share. Nothing is grouped by, or returned about, a person.
 */
function reworkCost(
  db: Db,
  scope: readonly { id: string; slug: string; name: string }[],
  range: { from: string; to: string; tz: string },
  now: number,
): ReworkCost[] {
  if (scope.length === 0) return [];
  const ids = scope.map((p) => p.id);
  // A day's worth either side, then read in the zone.
  const earliest = now - (daysBetween(range.from, range.to) + 2) * DAY_MS;
  const decided = db
    .select({
      taskId: taskReviews.taskId,
      roundId: taskReviews.roundId,
      createdAt: taskReviews.createdAt,
      projectId: tasks.projectId,
    })
    .from(taskReviews)
    .innerJoin(tasks, eq(tasks.id, taskReviews.taskId))
    .where(
      and(
        eq(taskReviews.decision, 'sent_back'),
        inArray(tasks.projectId, ids),
        gte(taskReviews.createdAt, earliest),
      ),
    )
    .all()
    .filter((d) => {
      const on = dayIn(range.tz, d.createdAt);
      return on >= range.from && on <= range.to;
    });
  if (decided.length === 0) return [];

  const taskIds = [...new Set(decided.map((d) => d.taskId))];
  const rounds = db
    .select({ id: taskRounds.id, taskId: taskRounds.taskId, createdAt: taskRounds.createdAt })
    .from(taskRounds)
    .where(inArray(taskRounds.taskId, taskIds))
    .all();

  const perProject = new Map<
    string,
    { sendBacks: number; tasks: Set<string>; time: number; open: number }
  >();
  /** Per task, the day after which its tokens are rework: the earliest sent-back round's. */
  const boundary = new Map<string, string>();
  for (const d of decided) {
    const entry = perProject.get(d.projectId) ?? {
      sendBacks: 0,
      tasks: new Set<string>(),
      time: 0,
      open: 0,
    };
    entry.sendBacks += 1;
    entry.tasks.add(d.taskId);
    let next: number | null = null;
    for (const r of rounds) {
      if (
        r.taskId === d.taskId &&
        r.createdAt > d.createdAt &&
        (next === null || r.createdAt < next)
      )
        next = r.createdAt;
    }
    entry.time += (next ?? Math.max(now, d.createdAt)) - d.createdAt;
    if (next === null) entry.open += 1;
    perProject.set(d.projectId, entry);

    const sentRound = rounds.find((r) => r.id === d.roundId);
    const after = dayIn(range.tz, sentRound?.createdAt ?? d.createdAt);
    const known = boundary.get(d.taskId);
    if (known === undefined || after < known) boundary.set(d.taskId, after);
  }

  const spent = new Map<string, { tokens: number; cacheRead: number }>();
  const projectOf = new Map(decided.map((d) => [d.taskId, d.projectId] as const));
  for (const r of db
    .select({
      taskId: t.taskId,
      day: t.day,
      tokens: sums.tokens,
      cacheRead: sums.cacheRead,
    })
    .from(t)
    .where(and(inArray(t.taskId, taskIds), gte(t.day, range.from), lte(t.day, range.to)))
    .groupBy(t.taskId, t.day)
    .all()) {
    if (r.taskId === null) continue;
    const after = boundary.get(r.taskId);
    if (after === undefined || r.day <= after) continue;
    const projectId = projectOf.get(r.taskId)!;
    const entry = spent.get(projectId) ?? { tokens: 0, cacheRead: 0 };
    entry.tokens += r.tokens;
    entry.cacheRead += r.cacheRead;
    spent.set(projectId, entry);
  }

  const totals = new Map(
    db
      .select({ projectId: t.projectId, tokens: sums.tokens })
      .from(t)
      .where(
        and(
          inArray(t.projectId, [...perProject.keys()]),
          gte(t.day, range.from),
          lte(t.day, range.to),
        ),
      )
      .groupBy(t.projectId)
      .all()
      .map((r) => [r.projectId, r.tokens] as const),
  );

  return scope
    .filter((p) => perProject.has(p.id))
    .map((p) => {
      const entry = perProject.get(p.id)!;
      const cost = spent.get(p.id) ?? { tokens: 0, cacheRead: 0 };
      const whole = totals.get(p.id) ?? 0;
      return {
        project: { slug: p.slug, name: p.name },
        send_backs: entry.sendBacks,
        tasks: entry.tasks.size,
        tokens: cost.tokens,
        cache_read: cost.cacheRead,
        time_ms: entry.time,
        open: entry.open,
        share: whole === 0 ? null : cost.tokens / whole,
      };
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** The Monday on or before `day`. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * `GET /users/:id/usage` — one person's twelve weeks, for the profile card.
 *
 * Their own, or anyone's for an owner or admin; a web session only (§3.1).
 * Permission is asked before the person is looked up, as the profile does.
 */
export function getPersonUsage(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  now: number = Date.now(),
): PersonUsageView {
  assertCan(actor, userId === actor.userId ? 'usage.read_own' : 'usage.read_people');
  const person = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (person === undefined) throw ApiError.notFound(`No user with id "${userId}"`);

  // A machine ahead of UTC is already on tomorrow; its day is still this week's.
  const today = dayIn('UTC', now);
  const thisWeek = mondayOf(today);
  const from = addDays(thisWeek, -7 * (PERSON_WEEKS - 1));
  const to = addDays(today, 1);
  const where = and(eq(t.userId, userId), gte(t.day, from), lte(t.day, to));

  const weeks: UsageWeek[] = Array.from({ length: PERSON_WEEKS }, (_, i) => ({
    start: addDays(from, 7 * i),
    tokens: 0,
    cache_read: 0,
  }));
  const { totals, perDay, byAgent, byModel } = breakdown(db, where);
  for (const [day, r] of perDay) {
    // Tomorrow's day from a machine ahead of UTC belongs to this week.
    const index = Math.min(Math.floor(daysBetween(from, mondayOf(day)) / 7), PERSON_WEEKS - 1);
    const week = weeks[index];
    if (week !== undefined) {
      week.tokens += r.tokens;
      week.cache_read += r.cache_read;
    }
  }

  const switches = sharingOn(db, userId);
  return {
    user_id: userId,
    from,
    to,
    weeks,
    totals: figuresOf(totals),
    by_agent: byAgent,
    by_model: byModel,
    no_token_data: agentsWithoutTokens(db, [userId]),
    sharing: { org_enabled: switches.org, enabled: switches.user },
  };
}

// ------------------------------------------------------- a task (LAI-770)

const NO_COUNTS = (): UsageCounts => ({
  tokens: 0,
  input: 0,
  output: 0,
  cache_write: 0,
  cache_read: 0,
});

/**
 * `GET /tasks/:id/usage?tz=` — the task panel's Tokens section: what every
 * person's agents spent on it, per person and agent for the readers allowed a
 * split, per review round, and how much of those people's work on those days
 * Laika could tie to a task at all (D-084 items 6–8).
 *
 * **Several people add up**: each person's collector reports its own tokens
 * under the key, and the rows sum here. Attribution follows who marked the
 * task in their own session, never `assignee_id`, so a reassignment changes
 * nothing already counted.
 *
 * **Rounds by day.** A round is one `finish_task` (§4.25). Tokens are kept per
 * day, so a day counts toward the first round handed in on or after it, read
 * in `tz` — the day a round was handed in counts toward that round, and what
 * comes after the last one is the open round. A round sent back and fixed the
 * same day it was handed in is the one case that reads early.
 *
 * Who sees whom is D-084 item 7, asked of `can()`: `usage.read_project` for
 * the totals, `usage.read_people` for everyone's part, `usage.read_own` — a web
 * session's — for the reader's own.
 */
export function getTaskUsage(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  query: { tz?: string | undefined } = {},
): TaskUsageView {
  const task = db
    .select({
      id: tasks.id,
      number: tasks.number,
      projectId: tasks.projectId,
      prefix: projects.prefix,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  assertCan(withProject(actor, task.projectId), 'usage.read_project', {
    projectId: task.projectId,
  });
  const tz = zoneOf(query.tz);
  const people: TaskUsageView['people'] = can(actor, 'usage.read_people')
    ? 'everyone'
    : can(actor, 'usage.read_own')
      ? 'own'
      : 'none';

  // A task's rows are a handful of people × days × agents × models: read
  // through its index and folded here.
  const rows = db
    .select({
      userId: t.userId,
      day: t.day,
      agent: t.agent,
      input: t.input,
      output: t.output,
      cacheWrite: t.cacheWrite,
      cacheRead: t.cacheRead,
    })
    .from(t)
    .where(eq(t.taskId, task.id))
    .all();

  const totals = NO_COUNTS();
  const days = new Set<string>();
  for (const r of rows) {
    totals.input += r.input;
    totals.output += r.output;
    totals.cache_write += r.cacheWrite;
    totals.cache_read += r.cacheRead;
    days.add(r.day);
  }
  totals.tokens = totals.input + totals.output + totals.cache_write;
  const sortedDays = [...days].sort();

  // ----- per person and agent, for the readers allowed it
  const visible = (userId: string): boolean =>
    people === 'everyone' || (people === 'own' && userId === actor.userId);
  let byPerson: TaskUsagePerson[] | null = null;
  if (people !== 'none') {
    const mine = new Map<string, { slice: UsageSlice; agents: Map<string, UsageSlice> }>();
    for (const r of rows) {
      if (!visible(r.userId)) continue;
      const tokens = r.input + r.output + r.cacheWrite;
      const entry = mine.get(r.userId) ?? {
        slice: { tokens: 0, cache_read: 0 },
        agents: new Map<string, UsageSlice>(),
      };
      entry.slice.tokens += tokens;
      entry.slice.cache_read += r.cacheRead;
      const agent = entry.agents.get(r.agent) ?? { tokens: 0, cache_read: 0 };
      agent.tokens += tokens;
      agent.cache_read += r.cacheRead;
      entry.agents.set(r.agent, agent);
      mine.set(r.userId, entry);
    }
    const names = new Map(
      mine.size === 0
        ? []
        : db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, [...mine.keys()]))
            .all()
            .map((u) => [u.id, u.name]),
    );
    byPerson = [...mine]
      .map(([userId, { slice, agents }]) => ({
        user_id: userId,
        name: names.get(userId) ?? '',
        ...slice,
        by_agent: [...agents]
          .sort(([a, x], [b, y]) => y.tokens - x.tokens || a.localeCompare(b))
          .map(([agent, v]) => ({ agent: agentKindOf(agent), ...v })),
      }))
      // By name: a list of people, never a ranking of them (D-084 item 7).
      .sort((a, b) => a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id));
  }

  // ----- the attributed share, over the people this reader may see
  let attributed: TaskUsageView['attributed'] = null;
  if (people !== 'none') {
    const daysOf = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!visible(r.userId)) continue;
      const set = daysOf.get(r.userId) ?? new Set<string>();
      set.add(r.day);
      daysOf.set(r.userId, set);
    }
    if (daysOf.size > 0) {
      attributed = { tokens: 0, of: 0 };
      // One range of the person's index each: a task has a few people.
      for (const [userId, set] of daysOf) {
        const r = db
          .select({ tokens: sums.tokens, attributed: sums.attributed })
          .from(t)
          .where(and(eq(t.userId, userId), inArray(t.day, [...set])))
          .get();
        attributed.tokens += r?.attributed ?? 0;
        attributed.of += r?.tokens ?? 0;
      }
    }
  }

  // ----- by review round, by day
  const finishes = db
    .select({ number: taskRounds.number, createdAt: taskRounds.createdAt })
    .from(taskRounds)
    .where(eq(taskRounds.taskId, task.id))
    .orderBy(taskRounds.number)
    .all()
    .map((r) => ({ number: r.number, day: dayIn(tz, r.createdAt) }));
  const byRound: TaskUsageRound[] =
    rows.length === 0
      ? []
      : finishes.map((f) => ({ number: f.number, finished_on: f.day, tokens: 0, cache_read: 0 }));
  if (rows.length > 0) {
    const open: TaskUsageRound = {
      number: (finishes.at(-1)?.number ?? 0) + 1,
      finished_on: null,
      tokens: 0,
      cache_read: 0,
    };
    for (const r of rows) {
      const at = finishes.findIndex((f) => f.day >= r.day);
      const bucket = at === -1 ? open : byRound[at];
      if (bucket === undefined) continue;
      bucket.tokens += r.input + r.output + r.cacheWrite;
      bucket.cache_read += r.cacheRead;
    }
    if (open.tokens + open.cache_read > 0) byRound.push(open);
  }

  return {
    task_id: task.id,
    key: `${task.prefix}-${String(task.number)}`,
    tz,
    first_day: sortedDays[0] ?? null,
    last_day: sortedDays.at(-1) ?? null,
    totals,
    people,
    by_person: byPerson,
    by_round: byRound,
    attributed,
  };
}
