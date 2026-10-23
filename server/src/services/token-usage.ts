import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { type AgentClient } from '../auth/agent-clients.ts';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { requireOrgId } from '../db/orgs.ts';
import {
  projectMemberships,
  projects,
  taskReviews,
  taskRounds,
  tasks,
  tokens,
  tokenSessionDays,
  tokenUsageDays,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { createLogger, type Logger } from '../log.ts';
import { assertCan, can } from '../policy/can.ts';
import { addDays, daysBetween, dayIn, isTimeZone } from './calendar-days.ts';
import {
  agentKindOf,
  assertMaySendLocalActivity,
  assertReportDays,
  collectionView,
} from './local-activity.ts';
import {
  type DispatchedInput,
  type SessionTaskInput,
  storeDispatched,
  storeSessionTasks,
} from './agent-time.ts';
import { readableByOutsideId } from './outside-ids.ts';
import { readLogged } from './analytics-views.ts';
import { recordArrival } from './plan-limit.ts';
import { projectIdByKeyPrefix, requireProjectBySlug } from './projects.ts';
import {
  addCost,
  cacheSaving,
  costOf,
  emptyCost,
  type PriceBook,
  type TokenCounts,
  type UsageCost,
} from './model-prices.ts';
import { loadPriceBook } from './org-model-prices.ts';
import {
  budgetsForUsage,
  type BudgetView,
  checkRunaway,
  evaluateBudgets,
  runawayCounts,
  runawayFor,
  type RunawayView,
  taskBudgets,
} from './token-budgets.ts';
import {
  recomputeGap,
  type SessionFilesInput,
  storeExcluded,
  storeSessionFiles,
  storeZone,
  TELEMETRY_COLLECTOR,
} from './token-telemetry.ts';

/**
 * Agents' token usage (D-084, SPEC §4.33, §6.4, LAI-769): a collector's
 * per-day totals in, the Usage page and the profile card out.
 *
 * ## In: a third kind of collector report
 *
 * The same `PUT /me/local-activity` as the snapshot and the look-back, marked
 * `"usage": true`, under the same switch, body limit and report bucket
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
 *
 * ## Automated rows: the organisation's, the space's and the task's, nobody's own
 *
 * A row a collector marks `automated` is what an automated session on that
 * machine spent — an orchestrator's sub-agent, CI, `LAIKA_ACTIVITY_SKIP`
 * (D-091, amending D-086). It counts wherever the organisation, a space or a
 * task is counted — totals, trend, agents, models, top tasks, cost, cache,
 * rework, accepted cost, budgets and runaway alerts — and in **no per-person
 * figure**: `by_developer`, the profile card, the task panel's per-person part
 * and attributed share, and the plan-limit rate leave it out (`own`).
 */

let tokenUsageLog: Logger = createLogger();

/** Report best-effort failures to this logger — `app.ts` passes the process's. */
export function setTokenUsageLogger(logger: Logger): void {
  tokenUsageLog = logger;
}

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
  /**
   * Spent by an automated session (D-091): `true` or absent. A collector
   * from before LAI-815 never sends it, so every row it sends is the person's.
   */
  automated?: true | undefined;
}

export interface TokenUsageReport {
  v: 1;
  collector_id: string;
  tz: string;
  usage: true;
  /**
   * One-way keys of the Claude Code sessions whose telemetry is left out
   * (LAI-773): automated ones (D-086), whose tokens arrive as rows marked
   * `automated` (D-091), and those outside the developer's scope (D-079
   * item 4), whose tokens are not sent.
   */
  excluded?: string[] | undefined;
  /**
   * `backfill: true` on a day that carries tokens from before this collector
   * began counting — the last 30 days, sent once (D-084 item 11). Such a day
   * **replaces every collector's rows** for it and each agent it names, so a
   * machine whose collector started over (`laika activity off`, then `on`)
   * cannot count the same day twice (LAI-769 review 1).
   */
  days: {
    day: string;
    backfill?: true | undefined;
    rows: TokenUsageRowInput[];
    /**
     * The day's Claude Code rows split by one-way session key (LAI-773), so
     * telemetry for the same session fills only what the files miss. A day
     * without it leaves its file tokens unplaced, which keeps the match safe.
     */
    sessions?: SessionFilesInput[] | undefined;
    /**
     * How each Claude Code session's headline tokens split between tasks that
     * day (LAI-787): what ties its agent minutes to cards the way its tokens
     * are tied (D-088 item 8).
     */
    session_tasks?: SessionTaskInput[] | undefined;
    /**
     * The builders the owner dispatched through Omnigent that day (LAI-315):
     * their buckets for My day's AGENTS lane, read from their transcripts.
     */
    dispatched?: DispatchedInput[] | undefined;
  }[];
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
  /** API-equivalent, not your bill (D-084 item 10, LAI-773). */
  cost: UsageCost;
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
  /** Theirs, API-equivalent (LAI-773) — only ever beside their name for an admin. */
  cost: UsageCost;
}

export interface UsageAgentSlice extends UsageSlice {
  agent: AgentClient;
  /**
   * On the one row that folds together every agent fewer than three people
   * used, for a reader who may not see people (review B2): how many it holds.
   * Absent on an agent's own row. The row's `agent` is then `other`.
   */
  few_people?: number;
}

export interface UsageModelSlice extends UsageSlice {
  model: string;
  /** USD at list price; `null` when the model has no price — never 0 (LAI-773). */
  cost: number | null;
  /** As `UsageAgentSlice.few_people`, for models; the row's `model` is then `other`. */
  few_people?: number;
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
  /**
   * Each space the reader may read, most tokens first (LAI-814) — on the
   * organisation only, `null` for a space. `totals.tokens` less these rows is
   * what no space the reader may read holds.
   */
  by_project: UsageProjectTotal[] | null;
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
  /**
   * What Claude Code's own telemetry added over the files (LAI-773): the side
   * calls a transcript never shows. `cost_usd_reported` is Claude Code's own
   * cost figure for the telemetered sessions, for a reader of the
   * organisation's figures. `null` for a space: telemetry ties to no task.
   */
  telemetry: { tokens: number; cost_usd_reported: number | null } | null;
  /**
   * Cache efficiency (LAI-773): of every input-side token (input, cache
   * writes, cache reads) the share served from the cache, and what those
   * reads saved against fresh input at list price.
   */
  cache: { share: number | null; saving_usd: number | null };
  /** The same per project the reader may read, by name. */
  cache_by_project: UsageCacheProject[];
  /** What tasks accepted in the range cost, per project and per agent (LAI-773). */
  accepted: UsageAccepted;
  /** Each space's and sprint's budget, then open tasks at 80% of theirs or more (LAI-773). */
  budgets: BudgetView[];
  /**
   * Runaway-agent alerts per project, a day after the assignee heard: a
   * count, never which task or whose — for a reader holding `usage.read_org`,
   * `null` otherwise (LAI-773).
   */
  runaway: { project: { slug: string; name: string }; alerts: number }[] | null;
}

/** One project's cache efficiency (LAI-773). */
export interface UsageCacheProject {
  project: { slug: string; name: string };
  cache_read: number;
  /** input + cache writes + cache reads. */
  input_side: number;
  share: number | null;
  /** `null` when none of its models has a price. */
  saving_usd: number | null;
}

/**
 * One space's tokens over the range and what they cost (LAI-814): every row
 * tied to its tasks. A total per space names nobody, so it is a
 * `usage.read_project` figure and never a `usage.read_people` one.
 */
export interface UsageProjectTotal {
  project: { slug: string; name: string };
  /** input + output + cache_write — the headline (D-084 item 8). */
  tokens: number;
  cache_read: number;
  /** Priced per model as `totals.cost` is — API-equivalent, not your bill. */
  cost: UsageCost;
  /** Of the organisation's `totals.tokens`; `null` when those are 0. */
  share: number | null;
}

/** Tasks accepted in the range and what they cost — the cost of agent work (LAI-773). */
export interface UsageAccepted {
  by_project: {
    project: { slug: string; name: string };
    tasks: number;
    tokens: number;
    cost: UsageCost;
    /** `cost.usd / tasks` — the API-equivalent cost of one accepted task here. */
    cost_per_task: number;
  }[];
  /**
   * Per agent, over the accepted tasks it spent tokens on. For a reader who
   * may not see people, an agent fewer than three people used on them is
   * folded into one `other` row (review B2): with fewer, an agent's figure is
   * a person's. Owners and admins on a session see every agent.
   */
  by_agent: {
    agent: AgentClient;
    tasks: number;
    people: number;
    tokens: number;
    cost: UsageCost;
    cost_per_task: number;
    /** On the one folded row (review B2): how many agents it holds; its `agent` is `other`. */
    few_people?: number;
  }[];
  /** Agents folded into that row for having fewer than three people; 0 for a reader who sees people. */
  agents_withheld: number;
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
  /** Whether tokens can arrive at all: the organisation's switch, in D-079's shape (D-102 amended). */
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
  /** API-equivalent, not your bill (LAI-773). */
  cost: UsageCost;
}

export interface TaskUsagePerson extends UsageSlice {
  user_id: string;
  name: string;
  by_agent: UsageAgentSlice[];
  cost: UsageCost;
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
  /** The task's budget in force — its own, or its frozen p80 — or `null` (LAI-773). */
  budget: BudgetView | null;
  /** The open runaway alert on it, shown only to the person it is for (LAI-773). */
  runaway: RunawayView | null;
}

export interface UsageQuery {
  days?: number | undefined;
  project?: string | undefined;
  tz?: string | undefined;
}

// ------------------------------------------------------------------ ingest

const USAGE_WINDOW = { daysBack: TOKEN_USAGE_DAYS_BACK, maxDays: TOKEN_USAGE_DAYS_MAX };

export interface ResolvedTask {
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
export function resolveKeys(
  db: Db,
  actor: ResolvedActor,
  keys: ReadonlySet<string>,
): Map<string, ResolvedTask> {
  const resolved = new Map<string, ResolvedTask>();
  // With the organisation the prefix is `projects_org_prefix_unique` and the
  // task `tasks_project_number_unique`: two searches. Without it SQLite has no
  // index that leads with the prefix and walks `tasks` (LAI-787).
  const orgId = keys.size === 0 ? '' : requireOrgId(db);
  for (const key of keys) {
    const dash = key.lastIndexOf('-');
    // The current prefix or one the project carried before (D-103).
    const projectId = projectIdByKeyPrefix(db, key.slice(0, dash), orgId);
    const found =
      projectId === undefined
        ? undefined
        : db
            .select({ taskId: tasks.id, projectId: tasks.projectId })
            .from(tasks)
            .where(
              and(eq(tasks.projectId, projectId), eq(tasks.number, Number(key.slice(dash + 1)))),
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
    for (const split of day.session_tasks ?? []) keys.add(split.task);
    for (const builder of day.dispatched ?? [])
      if (builder.task !== undefined) keys.add(builder.task);
  }
  const resolved = resolveKeys(db, actor, keys);

  // Today and yesterday in the sender's zone, as they stood: what the report
  // adds to them is what just arrived (the plan-limit rate). A backfilled day
  // is old tokens, not new ones.
  const today = dayIn(report.tz, now);
  const near = report.days
    .filter((d) => d.backfill !== true && d.day >= addDays(today, -1))
    .map((d) => d.day);
  let before = 0;
  try {
    before = headlineOver(db, actor.userId, near);
  } catch {
    before = Number.POSITIVE_INFINITY;
  }

  // Folded per (day, agent, model, task, automated): an alias and its slug,
  // or two keys that both turned out unattributed, are one row; a person's
  // tokens and an automated session's never are (D-091).
  const rows: (typeof tokenUsageDays.$inferInsert)[] = [];
  for (const day of report.days) {
    const folded = new Map<string, typeof tokenUsageDays.$inferInsert>();
    for (const row of day.rows) {
      const agent = agentKindOf(row.agent);
      const task = row.task === null ? undefined : resolved.get(row.task);
      const automated = row.automated === true;
      const id = `${agent}\u0000${row.model}\u0000${task?.taskId ?? ''}\u0000${automated ? 1 : 0}`;
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
          automated,
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
            // What telemetry adds is recomputed below, never taken here.
            ne(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
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

    // Each session's split between tasks (LAI-787), replaced with the day.
    storeSessionTasks(tx, actor.userId, collectorId, report.days, resolved, now);
    storeDispatched(tx, actor.userId, collectorId, report.tz, report.days, resolved, now);

    // The telemetry match (LAI-773), best effort: the zone, this machine's
    // sessions for the days it sent, the sessions it left out, and the gap.
    telemetryMatch(tx, actor.userId, collectorId, report, now);
  });

  // Best effort from here: what arrived, and the alerts it may raise. None of
  // it can cost the report (LAI-773).
  afterUsage(db, actor.userId, near, before, [...resolvedTaskIds(resolved)], now);
  return { accepted_days: report.days.length };
}

const resolvedTaskIds = (resolved: ReadonlyMap<string, ResolvedTask>): Set<string> =>
  new Set([...resolved.values()].map((r) => r.taskId));

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The report's part in the telemetry match, **in a savepoint** (review): the
 * zone it states, its per-session file totals, the sessions it excluded, and
 * the gap on every day they reach. A failure anywhere here takes back only
 * these writes, drops the person's telemetry gap — an under-count until the
 * next report, never a double one — is logged, and costs the report nothing.
 */
function telemetryMatch(
  tx: Tx,
  userId: string,
  collectorId: string,
  report: TokenUsageReport,
  now: number,
): void {
  try {
    tx.transaction((inner) => {
      storeZone(inner, userId, report.tz, now);
      storeSessionFiles(inner, userId, collectorId, report.days, now);
      const dispatched = report.days.flatMap((d) => (d.dispatched ?? []).map((b) => b.key));
      const moved = storeExcluded(inner, userId, report.excluded ?? [], now, dispatched);
      recomputeGap(inner, userId, [...new Set([...report.days.map((d) => d.day), ...moved])], now);
    });
  } catch (error) {
    tokenUsageLog.error('token_usage.telemetry_match_failed', {
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      tx.delete(t)
        .where(and(eq(t.userId, userId), eq(t.collectorId, TELEMETRY_COLLECTOR)))
        .run();
    } catch {
      // Nothing more to take back: the report's own rows stand.
    }
  }
}

/**
 * A person's own headline tokens over some days, every collector and
 * telemetry: the plan-limit rate is theirs alone (D-087), so an automated
 * session's are not in it (D-091).
 */
function headlineOver(db: Db, userId: string, days: readonly string[]): number {
  if (days.length === 0) return 0;
  return (
    db
      .select({ tokens: sums.tokens })
      .from(t)
      .where(and(eq(t.userId, userId), inArray(t.day, [...days]), own))
      .get()?.tokens ?? 0
  );
}

/**
 * After a report: what it added to today's and yesterday's tokens (the
 * plan-limit rate, §4.42), and the budget and runaway alerts for the tasks it
 * named. Each step best effort, logged and never thrown.
 */
function afterUsage(
  db: Db,
  userId: string,
  near: readonly string[],
  before: number,
  taskIds: readonly string[],
  now: number,
): void {
  try {
    const arrived = headlineOver(db, userId, near) - before;
    if (arrived > 0) recordArrival(db, userId, arrived, now);
  } catch (error) {
    tokenUsageLog.error('token_usage.arrival_failed', {
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  evaluateBudgets(db, taskIds, now);
  checkRunaway(db, taskIds, now);
}

// ------------------------------------------------------------------- reads

const t = tokenUsageDays;
/** A person's own rows: what an automated session spent is never in a per-person figure (D-091). */
const own = eq(t.automated, false);
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

function figuresOf(
  row: {
    tokens: number;
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    attributed: number;
  },
  cost: UsageCost,
): UsageFigures {
  return {
    tokens: row.tokens,
    input: row.input,
    output: row.output,
    cache_write: row.cacheWrite,
    cache_read: row.cacheRead,
    attributed_tokens: row.attributed,
    cost,
  };
}

const NO_FIGURES = { tokens: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, attributed: 0 };

/** The four counts of one model, to price. */
interface ModelCounts extends TokenCounts {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

const noCounts = (): ModelCounts => ({ input: 0, output: 0, cache_write: 0, cache_read: 0 });

/** What a set of per-model counts costs, and what their cache reads saved. */
function priced(
  book: PriceBook,
  models: ReadonlyMap<string, ModelCounts>,
): { cost: UsageCost; saving: number | null } {
  const cost = emptyCost();
  let saving: number | null = null;
  for (const [model, counts] of models) {
    addCost(cost, costOf(book, model, counts));
    const saved = cacheSaving(book, model, counts.cache_read);
    if (saved !== null) saving = (saving ?? 0) + saved;
  }
  return { cost, saving };
}

function addCounts(
  map: Map<string, ModelCounts>,
  key: string,
  r: { input: number; output: number; cacheWrite: number; cacheRead: number },
): void {
  const held = map.get(key) ?? noCounts();
  held.input += r.input;
  held.output += r.output;
  held.cache_write += r.cacheWrite;
  held.cache_read += r.cacheRead;
  map.set(key, held);
}

interface Breakdown {
  totals: typeof NO_FIGURES;
  perDay: Map<string, UsageSlice>;
  byAgent: UsageAgentSlice[];
  byModel: UsageModelSlice[];
  cost: UsageCost;
  /** What the cache reads saved at list price; `null` with no priced model. */
  saving: number | null;
  /** Each model's four counts, to price a folded row. */
  counts: Map<string, ModelCounts>;
}

/**
 * Totals, days, agents and models from **one** range of the index: grouped by
 * (day, agent, model) — at most a few hundred groups for a quarter — and
 * folded here. Four `GROUP BY`s over the same range read it four times, and
 * at 300 people that was the page's whole cost. The groups carry each count,
 * so pricing them by model (LAI-773) costs no query.
 */
function breakdown(db: Db, where: SQL | undefined, book: PriceBook): Breakdown {
  const totals = { ...NO_FIGURES };
  const perDay = new Map<string, UsageSlice>();
  const agents = new Map<string, UsageSlice>();
  const models = new Map<string, UsageSlice>();
  const counts = new Map<string, ModelCounts>();
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
    addCounts(counts, r.model, r);
  }
  // Most first, then by name, so equal figures keep one order.
  const ranked = (map: Map<string, UsageSlice>) =>
    [...map].sort(([a, x], [b, y]) => y.tokens - x.tokens || a.localeCompare(b));
  const { cost, saving } = priced(book, counts);
  return {
    totals,
    perDay,
    byAgent: ranked(agents).map(([agent, v]) => ({ agent: agentKindOf(agent), ...v })),
    byModel: ranked(models).map(([model, v]) => ({
      model,
      ...v,
      cost:
        book.price(model) === undefined
          ? null
          : costOf(book, model, counts.get(model) ?? noCounts()).usd,
    })),
    cost,
    saving,
    counts,
  };
}

/** An agent or model is shown on its own once this many people used it (review B2). */
export const MIN_AGENT_PEOPLE = 3;

/**
 * Who used each agent and each model within the response's scope — one range
 * of the same index, grouped by agent, model and person (review B2).
 */
function peopleIn(
  db: Db,
  where: SQL | undefined,
): { agents: Map<string, number>; models: Map<string, number> } {
  const agents = new Map<string, Set<string>>();
  const models = new Map<string, Set<string>>();
  for (const r of db
    .select({ agent: t.agent, model: t.model, userId: t.userId })
    .from(t)
    .where(where)
    .groupBy(t.agent, t.model, t.userId)
    .all()) {
    const a = agentKindOf(r.agent);
    agents.set(a, (agents.get(a) ?? new Set<string>()).add(r.userId));
    models.set(r.model, (models.get(r.model) ?? new Set<string>()).add(r.userId));
  }
  const sizes = (m: Map<string, Set<string>>) =>
    new Map([...m].map(([k, v]) => [k, v.size] as const));
  return { agents: sizes(agents), models: sizes(models) };
}

/**
 * For a reader who may not see people (review B2): every agent fewer than
 * {@link MIN_AGENT_PEOPLE} people used in the scope is folded into one row,
 * `other` with `few_people`, last — so no row, and no total less the listed
 * rows, is one person's agent.
 */
function foldAgents(
  rows: UsageAgentSlice[],
  people: ReadonlyMap<string, number>,
): UsageAgentSlice[] {
  const kept = rows.filter((r) => (people.get(r.agent) ?? 0) >= MIN_AGENT_PEOPLE);
  const few = rows.filter((r) => (people.get(r.agent) ?? 0) < MIN_AGENT_PEOPLE);
  if (few.length === 0) return kept;
  return [
    ...kept,
    {
      agent: 'other',
      tokens: few.reduce((n, r) => n + r.tokens, 0),
      cache_read: few.reduce((n, r) => n + r.cache_read, 0),
      few_people: few.length,
    },
  ];
}

/** As {@link foldAgents}, for models: the folded row priced as the models in it. */
function foldModels(
  rows: UsageModelSlice[],
  people: ReadonlyMap<string, number>,
  counts: ReadonlyMap<string, ModelCounts>,
  book: PriceBook,
): UsageModelSlice[] {
  const kept = rows.filter((r) => (people.get(r.model) ?? 0) >= MIN_AGENT_PEOPLE);
  const few = rows.filter((r) => (people.get(r.model) ?? 0) < MIN_AGENT_PEOPLE);
  if (few.length === 0) return kept;
  const cost = priced(
    book,
    new Map(few.map((r) => [r.model, counts.get(r.model) ?? noCounts()] as const)),
  ).cost;
  return [
    ...kept,
    {
      model: 'other',
      tokens: few.reduce((n, r) => n + r.tokens, 0),
      cache_read: few.reduce((n, r) => n + r.cache_read, 0),
      // Any of them priced: the priced part; none: no price, never 0.
      cost: few.some((r) => r.cost !== null) ? cost.usd : null,
      few_people: few.length,
    },
  ];
}

/** Of every input-side token, the share read from the cache; `null` with none. */
function cacheShare(input: number, cacheWrite: number, cacheRead: number): number | null {
  const side = input + cacheWrite + cacheRead;
  return side === 0 ? null : cacheRead / side;
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

  const book = loadPriceBook(db);
  const { totals, perDay, byAgent, byModel, cost, saving, counts } = breakdown(db, where, book);
  const seesPeople = can(actor, 'usage.read_people');
  // Who used each agent and model here — only for a reader whose rows fold.
  const people = seesPeople ? null : peopleIn(db, where);
  const trend: UsageDayPoint[] = [];
  for (let i = 0; i <= daysBetween(from, to); i += 1) {
    const day = addDays(from, i);
    const r = perDay.get(day);
    trend.push({ day, tokens: r?.tokens ?? 0, cache_read: r?.cache_read ?? 0 });
  }

  let byDeveloper: UsageDeveloper[] | null = null;
  if (seesPeople) {
    // By person and model, so each person's figure can be priced (LAI-773);
    // folded to one row a person here. Their own tokens only (D-091).
    const people = new Map<
      string,
      {
        name: string;
        tokens: number;
        cacheRead: number;
        attributed: number;
        models: Map<string, ModelCounts>;
      }
    >();
    for (const p of db
      .select({
        userId: t.userId,
        model: t.model,
        name: users.name,
        ...sums,
      })
      .from(t)
      .innerJoin(users, eq(users.id, t.userId))
      .where(and(where, own))
      .groupBy(t.userId, t.model)
      .all()) {
      const held = people.get(p.userId) ?? {
        name: p.name,
        tokens: 0,
        cacheRead: 0,
        attributed: 0,
        models: new Map<string, ModelCounts>(),
      };
      held.tokens += p.tokens;
      held.cacheRead += p.cacheRead;
      held.attributed += p.attributed;
      addCounts(held.models, p.model, p);
      people.set(p.userId, held);
    }
    byDeveloper = [...people]
      .map(([userId, p]) => ({
        user_id: userId,
        name: p.name,
        tokens: p.tokens,
        cache_read: p.cacheRead,
        attributed_tokens: p.attributed,
        cost: priced(book, p.models).cost,
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

  let orgTotals: UsageFigures | null = null;
  if (project !== undefined && can(actor, 'usage.read_org')) {
    const whole = { ...NO_FIGURES };
    const models = new Map<string, ModelCounts>();
    for (const r of db
      .select({ model: t.model, ...sums })
      .from(t)
      .where(inRange)
      .groupBy(t.model)
      .all()) {
      whole.tokens += r.tokens;
      whole.input += r.input;
      whole.output += r.output;
      whole.cacheWrite += r.cacheWrite;
      whole.cacheRead += r.cacheRead;
      whole.attributed += r.attributed;
      addCounts(models, r.model, r);
    }
    orgTotals = figuresOf(whole, priced(book, models).cost);
  }

  const scope =
    project === undefined
      ? db
          .select({ id: projects.id, slug: projects.slug, name: projects.name })
          .from(projects)
          .all()
          .filter((p) => can(withProject(actor, p.id), 'usage.read_project', { projectId: p.id }))
      : [{ id: project.id, slug: project.slug, name: project.name }];
  // One range of the project index serves the cache card and By space.
  const perProject = projectModels(db, scope, { from, to });

  return {
    from,
    to,
    tz,
    days: daysBetween(from, to) + 1,
    project: project === undefined ? null : { slug: project.slug, name: project.name },
    totals: figuresOf(totals, cost),
    trend,
    by_developer: byDeveloper,
    by_agent: people === null ? byAgent : foldAgents(byAgent, people.agents),
    by_model: people === null ? byModel : foldModels(byModel, people.models, counts, book),
    by_project:
      project === undefined ? usageByProject(book, scope, perProject, totals.tokens) : null,
    top_tasks: top,
    no_token_data: agentsWithoutTokens(db, memberIds),
    org_totals: orgTotals,
    rework: reworkCost(db, scope, { from, to, tz }, now),
    telemetry: project === undefined ? telemetryShare(db, actor, { from, to }) : null,
    cache: {
      share: cacheShare(totals.input, totals.cacheWrite, totals.cacheRead),
      saving_usd: saving,
    },
    cache_by_project: cacheByProject(book, scope, perProject),
    accepted: acceptedCost(db, book, scope, { from, to, tz }, now, seesPeople),
    budgets: budgetsForUsage(
      db,
      scope.map((p) => p.id),
      now,
    ),
    runaway: can(actor, 'usage.read_org') ? runawayCounts(db, scope, { from, tz }, now) : null,
  };
}

/**
 * What telemetry added over the range (LAI-773): one range of its own partial
 * index — a few rows a person a day — and Claude Code's own cost figure for
 * the telemetered sessions, from the per-session table's day index.
 */
function telemetryShare(
  db: Db,
  actor: ResolvedActor,
  range: { from: string; to: string },
): UsageView['telemetry'] {
  const added =
    db
      .select({ tokens: sums.tokens })
      .from(t)
      .where(
        and(eq(t.collectorId, TELEMETRY_COLLECTOR), gte(t.day, range.from), lte(t.day, range.to)),
      )
      .get()?.tokens ?? 0;
  const reported = can(actor, 'usage.read_org')
    ? (db
        .select({
          usd: sql<number | null>`sum(${tokenSessionDays.costUsd})`,
        })
        .from(tokenSessionDays)
        .where(
          and(
            eq(tokenSessionDays.source, 'telemetry'),
            gte(tokenSessionDays.day, range.from),
            lte(tokenSessionDays.day, range.to),
          ),
        )
        .get()?.usd ?? null)
    : null;
  return { tokens: added, cost_usd_reported: reported };
}

/**
 * Each project the reader may read, its four counts per model over the range
 * (LAI-773, LAI-814): one range of the project index, grouped by project and
 * model so every figure drawn from it is priced. A project with no rows in the
 * range is absent.
 */
function projectModels(
  db: Db,
  scope: readonly { id: string }[],
  range: { from: string; to: string },
): Map<string, Map<string, ModelCounts>> {
  const per = new Map<string, Map<string, ModelCounts>>();
  if (scope.length === 0) return per;
  for (const r of db
    .select({ projectId: t.projectId, model: t.model, ...sums })
    .from(t)
    .where(
      and(
        inArray(
          t.projectId,
          scope.map((p) => p.id),
        ),
        gte(t.day, range.from),
        lte(t.day, range.to),
      ),
    )
    .groupBy(t.projectId, t.model)
    .all()) {
    if (r.projectId === null) continue;
    const models = per.get(r.projectId) ?? new Map<string, ModelCounts>();
    addCounts(models, r.model, r);
    per.set(r.projectId, models);
  }
  return per;
}

/**
 * Each space's tokens and cost over the range (LAI-814), most tokens first,
 * then by name: priced per model with the same book as `totals.cost`, so a
 * space's caveats — a model with no price, a price inferred — travel with it.
 * `share` is of `whole`, the organisation's headline.
 */
function usageByProject(
  book: PriceBook,
  scope: readonly { id: string; slug: string; name: string }[],
  per: ReadonlyMap<string, ReadonlyMap<string, ModelCounts>>,
  whole: number,
): UsageProjectTotal[] {
  return scope
    .filter((p) => per.has(p.id))
    .map((p) => {
      const models = per.get(p.id)!;
      let tokens = 0;
      let cacheRead = 0;
      for (const c of models.values()) {
        tokens += c.input + c.output + c.cache_write;
        cacheRead += c.cache_read;
      }
      return {
        project: { slug: p.slug, name: p.name },
        tokens,
        cache_read: cacheRead,
        cost: priced(book, models).cost,
        share: whole === 0 ? null : tokens / whole,
      };
    })
    .sort((a, b) => b.tokens - a.tokens || a.project.name.localeCompare(b.project.name));
}

/** Cache efficiency per project the reader may read (LAI-773), from {@link projectModels}. */
function cacheByProject(
  book: PriceBook,
  scope: readonly { id: string; slug: string; name: string }[],
  per: ReadonlyMap<string, ReadonlyMap<string, ModelCounts>>,
): UsageCacheProject[] {
  return scope
    .filter((p) => per.has(p.id))
    .map((p) => {
      const models = per.get(p.id)!;
      let input = 0;
      let cacheWrite = 0;
      let cacheRead = 0;
      for (const c of models.values()) {
        input += c.input;
        cacheWrite += c.cache_write;
        cacheRead += c.cache_read;
      }
      return {
        project: { slug: p.slug, name: p.name },
        cache_read: cacheRead,
        input_side: input + cacheWrite + cacheRead,
        share: cacheShare(input, cacheWrite, cacheRead),
        saving_usd: priced(book, models).saving,
      };
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/**
 * What the tasks accepted in the range cost (LAI-773, the estimation R&D's
 * idea 2): each task's tokens, all of them — build and rework — priced, per
 * project and per agent. Bounded by the decisions in the range: a handful of
 * queries whatever the board's size. **Never per person**, and an agent is
 * listed only when at least three people spent its tokens on those tasks.
 */
function acceptedCost(
  db: Db,
  book: PriceBook,
  scope: readonly { id: string; slug: string; name: string }[],
  range: { from: string; to: string; tz: string },
  now: number,
  seesPeople: boolean,
): UsageAccepted {
  const none: UsageAccepted = { by_project: [], by_agent: [], agents_withheld: 0 };
  if (scope.length === 0) return none;
  const earliest = now - (daysBetween(range.from, range.to) + 2) * DAY_MS;
  const accepted = new Map<string, string>();
  for (const d of db
    .select({
      taskId: taskReviews.taskId,
      createdAt: taskReviews.createdAt,
      projectId: tasks.projectId,
    })
    .from(taskReviews)
    .innerJoin(tasks, eq(tasks.id, taskReviews.taskId))
    .where(
      and(
        eq(taskReviews.decision, 'accepted'),
        inArray(
          tasks.projectId,
          scope.map((p) => p.id),
        ),
        gte(taskReviews.createdAt, earliest),
      ),
    )
    .all()) {
    const on = dayIn(range.tz, d.createdAt);
    if (on >= range.from && on <= range.to) accepted.set(d.taskId, d.projectId);
  }
  if (accepted.size === 0) return none;

  const perTask = new Map<string, { tokens: number; models: Map<string, ModelCounts> }>();
  const perAgent = new Map<
    string,
    { tasks: Set<string>; people: Set<string>; tokens: number; models: Map<string, ModelCounts> }
  >();
  const ids = [...accepted.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db
      .select({ taskId: t.taskId, agent: t.agent, model: t.model, userId: t.userId, ...sums })
      .from(t)
      .where(inArray(t.taskId, ids.slice(i, i + 500)))
      .groupBy(t.taskId, t.agent, t.model, t.userId)
      .all()) {
      if (r.taskId === null) continue;
      const task = perTask.get(r.taskId) ?? { tokens: 0, models: new Map<string, ModelCounts>() };
      task.tokens += r.tokens;
      addCounts(task.models, r.model, r);
      perTask.set(r.taskId, task);
      const agent = agentKindOf(r.agent);
      const a = perAgent.get(agent) ?? {
        tasks: new Set<string>(),
        people: new Set<string>(),
        tokens: 0,
        models: new Map<string, ModelCounts>(),
      };
      a.tasks.add(r.taskId);
      a.people.add(r.userId);
      a.tokens += r.tokens;
      addCounts(a.models, r.model, r);
      perAgent.set(agent, a);
    }
  }

  const perProject = new Map<string, { tasks: number; tokens: number; cost: UsageCost }>();
  for (const [taskId, projectId] of accepted) {
    const task = perTask.get(taskId);
    const entry = perProject.get(projectId) ?? { tasks: 0, tokens: 0, cost: emptyCost() };
    entry.tasks += 1;
    if (task !== undefined) {
      entry.tokens += task.tokens;
      addCost(entry.cost, priced(book, task.models).cost);
    }
    perProject.set(projectId, entry);
  }
  let withheld = 0;
  const byAgent: UsageAccepted['by_agent'] = [];
  const folded = {
    tasks: new Set<string>(),
    people: new Set<string>(),
    tokens: 0,
    cost: emptyCost(),
  };
  for (const [agent, a] of [...perAgent].sort(([x], [y]) => x.localeCompare(y))) {
    const cost = priced(book, a.models).cost;
    if (!seesPeople && a.people.size < MIN_AGENT_PEOPLE) {
      // Folded, never dropped (review B2): dropping it let the card's total,
      // less the listed agents, be read as one person's spend.
      withheld += 1;
      for (const id of a.tasks) folded.tasks.add(id);
      for (const id of a.people) folded.people.add(id);
      folded.tokens += a.tokens;
      addCost(folded.cost, cost);
      continue;
    }
    byAgent.push({
      agent: agentKindOf(agent),
      tasks: a.tasks.size,
      people: a.people.size,
      tokens: a.tokens,
      cost,
      cost_per_task: cost.usd / a.tasks.size,
    });
  }
  if (withheld > 0) {
    byAgent.push({
      agent: 'other',
      tasks: folded.tasks.size,
      people: folded.people.size,
      tokens: folded.tokens,
      cost: folded.cost,
      cost_per_task: folded.cost.usd / folded.tasks.size,
      few_people: withheld,
    });
  }
  return {
    by_project: scope
      .filter((p) => perProject.has(p.id))
      .map((p) => {
        const e = perProject.get(p.id)!;
        return {
          project: { slug: p.slug, name: p.name },
          tasks: e.tasks,
          tokens: e.tokens,
          cost: e.cost,
          cost_per_task: e.cost.usd / e.tasks,
        };
      })
      .sort((a, b) => a.project.name.localeCompare(b.project.name)),
    by_agent: byAgent,
    agents_withheld: withheld,
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

  // Somebody else's tokens are a logged read; their own are not (D-102 rule 3, LAI-957).
  return readLogged(
    db,
    actor,
    userId,
    'usage',
    () => personUsageOf(db, userId, now),
    () => null,
    now,
  );
}

function personUsageOf(db: Db, userId: string, now: number): PersonUsageView {
  // A machine ahead of UTC is already on tomorrow; its day is still this week's.
  const today = dayIn('UTC', now);
  const thisWeek = mondayOf(today);
  const from = addDays(thisWeek, -7 * (PERSON_WEEKS - 1));
  const to = addDays(today, 1);
  // Their own tokens: an automated session's are not their work (D-091).
  const where = and(eq(t.userId, userId), gte(t.day, from), lte(t.day, to), own);

  const weeks: UsageWeek[] = Array.from({ length: PERSON_WEEKS }, (_, i) => ({
    start: addDays(from, 7 * i),
    tokens: 0,
    cache_read: 0,
  }));
  const { totals, perDay, byAgent, byModel, cost } = breakdown(db, where, loadPriceBook(db));
  for (const [day, r] of perDay) {
    // Tomorrow's day from a machine ahead of UTC belongs to this week.
    const index = Math.min(Math.floor(daysBetween(from, mondayOf(day)) / 7), PERSON_WEEKS - 1);
    const week = weeks[index];
    if (week !== undefined) {
      week.tokens += r.tokens;
      week.cache_read += r.cache_read;
    }
  }

  return {
    user_id: userId,
    from,
    to,
    weeks,
    totals: figuresOf(totals, cost),
    by_agent: byAgent,
    by_model: byModel,
    no_token_data: agentsWithoutTokens(db, [userId]),
    sharing: collectionView(db),
  };
}

// ------------------------------------------------------- a task (LAI-770)

const NO_COUNTS = (): UsageCounts => ({
  tokens: 0,
  input: 0,
  output: 0,
  cache_write: 0,
  cache_read: 0,
  cost: emptyCost(),
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
  now: number = Date.now(),
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
      model: t.model,
      input: t.input,
      output: t.output,
      cacheWrite: t.cacheWrite,
      cacheRead: t.cacheRead,
      automated: t.automated,
    })
    .from(t)
    .where(eq(t.taskId, task.id))
    .all();

  const book = loadPriceBook(db);
  const totals = NO_COUNTS();
  const days = new Set<string>();
  const models = new Map<string, ModelCounts>();
  for (const r of rows) {
    totals.input += r.input;
    totals.output += r.output;
    totals.cache_write += r.cacheWrite;
    totals.cache_read += r.cacheRead;
    days.add(r.day);
    addCounts(models, r.model, r);
  }
  totals.tokens = totals.input + totals.output + totals.cache_write;
  totals.cost = priced(book, models).cost;
  const sortedDays = [...days].sort();

  // ----- per person and agent, for the readers allowed it: each person's own
  // tokens, never an automated session's (D-091), which the totals hold.
  const visible = (r: { userId: string; automated: boolean }): boolean =>
    !r.automated && (people === 'everyone' || (people === 'own' && r.userId === actor.userId));
  let byPerson: TaskUsagePerson[] | null = null;
  if (people !== 'none') {
    const mine = new Map<
      string,
      { slice: UsageSlice; agents: Map<string, UsageSlice>; models: Map<string, ModelCounts> }
    >();
    for (const r of rows) {
      if (!visible(r)) continue;
      const tokens = r.input + r.output + r.cacheWrite;
      const entry = mine.get(r.userId) ?? {
        slice: { tokens: 0, cache_read: 0 },
        agents: new Map<string, UsageSlice>(),
        models: new Map<string, ModelCounts>(),
      };
      entry.slice.tokens += tokens;
      entry.slice.cache_read += r.cacheRead;
      addCounts(entry.models, r.model, r);
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
      .map(([userId, { slice, agents, models: theirs }]) => ({
        user_id: userId,
        name: names.get(userId) ?? '',
        ...slice,
        by_agent: [...agents]
          .sort(([a, x], [b, y]) => y.tokens - x.tokens || a.localeCompare(b))
          .map(([agent, v]) => ({ agent: agentKindOf(agent), ...v })),
        cost: priced(book, theirs).cost,
      }))
      // By name: a list of people, never a ranking of them (D-084 item 7).
      .sort((a, b) => a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id));
  }

  // ----- the attributed share, over the people this reader may see
  let attributed: TaskUsageView['attributed'] = null;
  if (people !== 'none') {
    const daysOf = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!visible(r)) continue;
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
          .where(and(eq(t.userId, userId), inArray(t.day, [...set]), own))
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
    budget: taskBudgets(db, [task.id])[0] ?? null,
    runaway: runawayFor(db, actor, task.id, now),
  };
}
