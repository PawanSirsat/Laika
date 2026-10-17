import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
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
import { requireProjectBySlug } from './projects.ts';

/**
 * Agents' token usage (D-084, SPEC §4.32, §6.4, LAI-769): a collector's
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
/** A Laika task key: a project prefix (§4.3, 2–8 characters) and a number. */
export const TASK_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8}$/;

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
  days: { day: string; rows: TokenUsageRowInput[] }[];
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
    if (found === undefined) continue;
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
    tx.delete(tokenUsageDays)
      .where(
        and(
          eq(tokenUsageDays.userId, actor.userId),
          eq(tokenUsageDays.collectorId, collectorId),
          inArray(
            tokenUsageDays.day,
            report.days.map((d) => d.day),
          ),
        ),
      )
      .run();
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

function rangeFor(query: UsageQuery, now: number): { from: string; to: string; tz: string } {
  const tz = query.tz ?? 'UTC';
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
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
  };
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
