import { and, desc, eq, gte, lte, min, sql } from 'drizzle-orm';
import { AGENT_CLIENTS, type AgentClient } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type LocalActivityScope } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { localActivityDays, orgs, pushedCommitKeys, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addDays, dayIn, isCalendarDay, isTimeZone } from './calendar-days.ts';

/**
 * Local activity counts from a developer's own machine (SPEC §6.4, §4.23,
 * §4.24, D-079, LAI-751) — the heatmap's *GitHub* and *Local* colours.
 *
 * ## Two switches, both on, before anything is kept
 *
 * The organisation's `developer_insights`, set by an owner or admin, and the
 * developer's own `share_local_activity`, set by them alone from a signed-in
 * web session (§3.1). Either off and a report is refused with
 * `local_activity_off` — read on every request, so turning one off stops
 * collection at once. Turning off deletes nothing; the developer deletes their
 * own history, and retention deletes it after 400 days (§11.6).
 *
 * ## Counts only, and nothing echoed
 *
 * A report carries per-day counts and one-way commit keys and nothing that
 * names a repository, a path, a branch or a prompt — the schema has no column
 * that could hold one. The answer to a report is how many days were accepted,
 * never the data. A report writes no `activity` row: it is not a change to the
 * board, and one row per sync would drown the feed (§4.8's heartbeat argument).
 *
 * ## A snapshot, not a sum
 *
 * Each (person, collector, day) is **replaced** by what was sent. A retry
 * cannot double-count, and a commit pushed after the last report leaves
 * `commits_local` on the next. Pushed keys are a set: added, never removed by a
 * report, each keeping the earliest day it was seen.
 */

/** How often a collector may sync, said to it in every sharing answer (§6.4). */
export const MIN_SYNC_INTERVAL_S = 600;

/** A report's days: at most this many, each within this far behind today. */
export const REPORT_DAYS_MAX = 14;
/** …and at most one day ahead, for a machine whose clock is past midnight first. */
const REPORT_DAYS_AHEAD = 1;

/** Per day, per §6.4. */
export const PROMPTS_PER_AGENT_MAX = 5000;
export const SESSIONS_MAX = 500;
export const COMMITS_LOCAL_MAX = 2000;
export const PUSHED_KEYS_MAX = 2000;

/** The ingest's body limit (§6.4) — under the general 1 MiB. */
export const LOCAL_ACTIVITY_BODY_MAX = 16 * 1024;

/** The preview's window: the days a report can still change. */
export const OWN_PREVIEW_DAYS_MAX = 14;

export { LOCAL_ACTIVITY_SCOPES } from '../db/enums.ts';

export interface ActivitySharingView {
  /** The organisation's switch. */
  org_enabled: boolean;
  /** The developer's own switch. */
  enabled: boolean;
  scope: LocalActivityScope;
  min_sync_interval_s: number;
}

export interface ReportDay {
  day: string;
  prompts: Record<string, number>;
  sessions: number;
  commits_local: number;
  pushed_keys: string[];
}

export interface LocalActivityReport {
  v: 1;
  collector_id: string;
  tz: string;
  days: ReportDay[];
}

export interface AcceptedReport {
  accepted_days: number;
}

/** One day the server holds for the caller, all their machines summed. */
export interface OwnLocalDay {
  day: string;
  prompts_by_agent: Partial<Record<AgentClient, number>>;
  sessions: number;
  commits_local: number;
  pushed_commits: number;
}

/** What the server holds for the caller — the consent preview (§6.4). */
export interface OwnLocalActivityView {
  /** The window, in `tz`: the last `days` days to today. */
  start: string;
  end: string;
  /** The zone of their most recent report, or `UTC` when there is none. */
  tz: string;
  /** Newest first; only days with something held. */
  days: OwnLocalDay[];
  /** Machines that reported in the window. */
  collectors: number;
  /** The oldest day held at all, or null when nothing is. */
  oldest_day: string | null;
}

// ------------------------------------------------------------------ sharing

interface Switches {
  org: boolean;
  user: boolean;
  scope: LocalActivityScope;
}

function switchesFor(db: Db, userId: string): Switches {
  const org = db
    .select({ on: orgs.developerInsights })
    .from(orgs)
    .where(eq(orgs.id, requireOrgId(db)))
    .get();
  const user = db
    .select({ on: users.shareLocalActivity, scope: users.localActivityScope })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (user === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
  return { org: org?.on === 1, user: user.on === 1, scope: user.scope };
}

/**
 * Both switches, for a person — the one question every read and write here
 * asks. Exported for the heatmap's read, which hides the local series when
 * either is off.
 */
export function sharingOn(db: Db, userId: string): { org: boolean; user: boolean } {
  const s = switchesFor(db, userId);
  return { org: s.org, user: s.user };
}

function sharingView(s: Switches): ActivitySharingView {
  return {
    org_enabled: s.org,
    enabled: s.user,
    scope: s.scope,
    min_sync_interval_s: MIN_SYNC_INTERVAL_S,
  };
}

/** `GET /me/activity-sharing`: a session or any token of theirs may ask. */
export function getActivitySharing(db: Db, actor: ResolvedActor): ActivitySharingView {
  assertCan(actor, 'activity_sharing.read_own');
  return sharingView(switchesFor(db, actor.userId));
}

export interface SetActivitySharingInput {
  enabled?: boolean | undefined;
  scope?: LocalActivityScope | undefined;
}

/**
 * `PUT /me/activity-sharing`: the developer's consent, from a web session only
 * (§3.1). Off stops collection at once and deletes nothing.
 *
 * No `activity` row: §4.8 has no verb for it, and a verb is an `activity`
 * rebuild — the same reason D-078 gave for the profile kind.
 */
export function setActivitySharing(
  db: Db,
  actor: ResolvedActor,
  input: SetActivitySharingInput,
): ActivitySharingView {
  assertCan(actor, 'activity_sharing.set_own');

  const set: { shareLocalActivity?: number; localActivityScope?: LocalActivityScope } = {};
  if (input.enabled !== undefined) set.shareLocalActivity = input.enabled ? 1 : 0;
  if (input.scope !== undefined) set.localActivityScope = input.scope;
  if (Object.keys(set).length > 0) {
    db.update(users).set(set).where(eq(users.id, actor.userId)).run();
  }

  return sharingView(switchesFor(db, actor.userId));
}

// ------------------------------------------------------------------ ingest

/**
 * The names `laika connect` accepts for an agent beside its own slug (its
 * `ALIASES`), read the same way here. The collector (LAI-752) sends the slugs
 * themselves — `gemini-cli`, and `other` for Copilot CLI — so these only
 * catch a sender that used the short names people type.
 */
const AGENT_ALIASES: Readonly<Record<string, AgentClient>> = {
  claude: 'claude-code',
  gemini: 'gemini-cli',
  copilot: 'vscode',
  code: 'vscode',
  agy: 'antigravity',
};

const KNOWN_AGENTS: ReadonlySet<string> = new Set(AGENT_CLIENTS);

/** An agent kind id → the board's slug; anything it does not know is `other`. */
export function agentKindOf(id: string): AgentClient {
  const lower = id.toLowerCase();
  if (KNOWN_AGENTS.has(lower)) return lower as AgentClient;
  return AGENT_ALIASES[lower] ?? 'other';
}

function refuse(reason: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ApiError('unprocessable', message, { reason, ...extra });
}

/**
 * The checks a schema cannot make: the time zone exists, and every day is a
 * real date inside the window, once (§6.4's `day_out_of_range`).
 */
function assertReportDays(report: LocalActivityReport, now: number): void {
  if (!isTimeZone(report.tz)) {
    refuse('invalid_tz', 'tz is not a time zone this server knows', { field: 'tz' });
  }

  const today = dayIn(report.tz, now);
  const earliest = addDays(today, -REPORT_DAYS_MAX);
  const latest = addDays(today, REPORT_DAYS_AHEAD);
  const outOfRange = (message: string, day?: string): never =>
    refuse('day_out_of_range', message, {
      earliest,
      latest,
      ...(day === undefined ? {} : { day }),
    });

  if (report.days.length < 1 || report.days.length > REPORT_DAYS_MAX) {
    outOfRange(`days holds 1 to ${String(REPORT_DAYS_MAX)} entries`);
  }

  const seen = new Set<string>();
  for (const { day } of report.days) {
    if (!isCalendarDay(day)) outOfRange('day is not a calendar date', day);
    if (seen.has(day)) outOfRange('each day appears once', day);
    seen.add(day);
    if (day < earliest || day > latest) {
      outOfRange(`each day is within ${earliest} to ${latest} in ${report.tz}`, day);
    }
  }
}

/** Prompts per agent, folded onto the board's slugs. Zeros are not kept. */
function foldPrompts(prompts: Record<string, number>): Map<AgentClient, number> {
  const folded = new Map<AgentClient, number>();
  for (const [id, n] of Object.entries(prompts)) {
    if (n === 0) continue;
    const kind = agentKindOf(id);
    folded.set(kind, (folded.get(kind) ?? 0) + n);
  }
  return folded;
}

/**
 * May this actor send a report at all: `can()`, then both switches (§6.4's
 * `local_activity_off`). The route asks before it reads the body, so a person
 * who stopped sharing is told so even when their collector sent something
 * odd; {@link recordLocalActivity} asks again for every other caller.
 */
export function assertMaySendLocalActivity(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'local_activity.send_own');

  const switches = switchesFor(db, actor.userId);
  if (!switches.org || !switches.user) {
    throw new ApiError(
      'forbidden',
      switches.org
        ? 'Local activity sharing is off for this account'
        : 'Developer insights are off for this organisation',
      { reason: 'local_activity_off', org_enabled: switches.org, enabled: switches.user },
    );
  }
}

/** `PUT /me/local-activity`: one machine's snapshot of its last days (§6.4). */
export function recordLocalActivity(
  db: Db,
  actor: ResolvedActor,
  report: LocalActivityReport,
  now: number = Date.now(),
): AcceptedReport {
  assertMaySendLocalActivity(db, actor);
  assertReportDays(report, now);
  const collectorId = report.collector_id.toLowerCase();

  // Each key once, at the earliest day this report has it on.
  const keys = new Map<string, string>();
  for (const day of report.days) {
    for (const raw of day.pushed_keys) {
      const key = raw.toLowerCase();
      const seen = keys.get(key);
      if (seen === undefined || day.day < seen) keys.set(key, day.day);
    }
  }

  db.transaction((tx) => {
    tx.insert(localActivityDays)
      .values(
        report.days.map((day) => {
          const prompts = foldPrompts(day.prompts);
          return {
            userId: actor.userId,
            day: day.day,
            collectorId,
            prompts: [...prompts.values()].reduce((sum, n) => sum + n, 0),
            promptsByAgent: JSON.stringify(Object.fromEntries(prompts)),
            sessions: day.sessions,
            commitsLocal: day.commits_local,
            tz: report.tz,
            updatedAt: now,
          };
        }),
      )
      .onConflictDoUpdate({
        target: [localActivityDays.userId, localActivityDays.day, localActivityDays.collectorId],
        // The snapshot replaces the last one for this machine and day.
        set: {
          prompts: sql`excluded.prompts`,
          promptsByAgent: sql`excluded.prompts_by_agent`,
          sessions: sql`excluded.sessions`,
          commitsLocal: sql`excluded.commits_local`,
          tz: sql`excluded.tz`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();

    const entries = [...keys];
    // Far below SQLite's bound-variable limit per statement, whatever the body.
    for (let i = 0; i < entries.length; i += 500) {
      tx.insert(pushedCommitKeys)
        .values(
          entries
            .slice(i, i + 500)
            .map(([key, day]) => ({ userId: actor.userId, key, day, createdAt: now })),
        )
        .onConflictDoUpdate({
          target: [pushedCommitKeys.userId, pushedCommitKeys.key],
          // A key keeps the earliest day it was seen on, from any machine.
          set: { day: sql`min(${pushedCommitKeys.day}, excluded.day)` },
        })
        .run();
    }
  });

  return { accepted_days: report.days.length };
}

// ------------------------------------------------------------- own history

/**
 * The zone of the person's newest reported day, or `UTC`. One step down the
 * key: ordered by day alone, so no sort is built — two machines reporting the
 * same newest day in different zones is a tie either answer settles.
 */
export function latestReportZone(db: Db, userId: string): string {
  const row = db
    .select({ tz: localActivityDays.tz })
    .from(localActivityDays)
    .where(eq(localActivityDays.userId, userId))
    .orderBy(desc(localActivityDays.day))
    .limit(1)
    .get();
  return row !== undefined && isTimeZone(row.tz) ? row.tz : 'UTC';
}

/**
 * `GET /me/local-activity?days=`: what the server holds for the caller over
 * their last days — the consent screen's preview (§6.4). Their own rows only,
 * whatever the switches say: what was kept before sharing was turned off is
 * still theirs to see and to delete.
 */
export function getOwnLocalActivity(
  db: Db,
  actor: ResolvedActor,
  days: number = OWN_PREVIEW_DAYS_MAX,
  now: number = Date.now(),
): OwnLocalActivityView {
  assertCan(actor, 'local_activity.read_own');

  const span = Math.min(Math.max(Math.trunc(days), 1), OWN_PREVIEW_DAYS_MAX);
  const tz = latestReportZone(db, actor.userId);
  const end = dayIn(tz, now);
  const start = addDays(end, -(span - 1));

  const rows = db
    .select()
    .from(localActivityDays)
    .where(
      and(
        eq(localActivityDays.userId, actor.userId),
        gte(localActivityDays.day, start),
        lte(localActivityDays.day, end),
      ),
    )
    .all();
  const pushed = pushedPerDay(db, actor.userId, start, end);

  const byDay = new Map<string, OwnLocalDay>();
  const at = (day: string): OwnLocalDay => {
    let entry = byDay.get(day);
    if (entry === undefined) {
      entry = { day, prompts_by_agent: {}, sessions: 0, commits_local: 0, pushed_commits: 0 };
      byDay.set(day, entry);
    }
    return entry;
  };

  for (const row of rows) {
    const entry = at(row.day);
    entry.sessions += row.sessions;
    entry.commits_local += row.commitsLocal;
    for (const [kind, n] of Object.entries(readPrompts(row.promptsByAgent))) {
      const slug = agentKindOf(kind);
      entry.prompts_by_agent[slug] = (entry.prompts_by_agent[slug] ?? 0) + n;
    }
  }
  for (const [day, n] of pushed) at(day).pushed_commits = n;

  const oldest = db
    .select({ day: min(localActivityDays.day) })
    .from(localActivityDays)
    .where(eq(localActivityDays.userId, actor.userId))
    .get();
  const oldestKey = db
    .select({ day: min(pushedCommitKeys.day) })
    .from(pushedCommitKeys)
    .where(eq(pushedCommitKeys.userId, actor.userId))
    .get();
  const oldestDay = [oldest?.day, oldestKey?.day]
    .filter((d): d is string => d !== null && d !== undefined)
    .sort()[0];

  return {
    start,
    end,
    tz,
    days: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    collectors: new Set(rows.map((r) => r.collectorId)).size,
    oldest_day: oldestDay ?? null,
  };
}

/** `DELETE /me/local-activity`: every local row and key of theirs, now. */
export function deleteOwnLocalActivity(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'local_activity.delete_own');
  db.transaction((tx) => {
    tx.delete(localActivityDays).where(eq(localActivityDays.userId, actor.userId)).run();
    tx.delete(pushedCommitKeys).where(eq(pushedCommitKeys.userId, actor.userId)).run();
  });
}

// ----------------------------------------------------------------- readers

/**
 * A stored `prompts_by_agent`, or `{}` for anything that is not an object of
 * counts. Written only by {@link recordLocalActivity}, so a bad one is a bug —
 * shown as nothing rather than a crash on somebody's profile.
 */
export function readPrompts(json: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

/** Distinct pushed keys per day for one person — a covering range of its index. */
export function pushedPerDay(
  db: Db,
  userId: string,
  start: string,
  end: string,
): Map<string, number> {
  return new Map(
    db
      .select({ day: pushedCommitKeys.day, n: sql<number>`count(*)` })
      .from(pushedCommitKeys)
      .where(
        and(
          eq(pushedCommitKeys.userId, userId),
          gte(pushedCommitKeys.day, start),
          lte(pushedCommitKeys.day, end),
        ),
      )
      .groupBy(pushedCommitKeys.day)
      .all()
      .map((row) => [row.day, row.n]),
  );
}
