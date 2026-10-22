import { and, desc, eq, gte, lte, min, ne, sql } from 'drizzle-orm';
import { AGENT_CLIENTS, type AgentClient } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type LocalActivityScope } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import {
  agentTimeBuckets,
  agentTimeDays,
  localActivityDays,
  orgs,
  projects,
  pushedCommitKeys,
  tokenArrivals,
  tokenSessionDays,
  tokenSessionSkips,
  tokenSessionTasks,
  tokenTelemetrySeries,
  tokenUsageZones,
  tokenUsageDays,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { addDays, dayIn, isCalendarDay, isTimeZone } from './calendar-days.ts';
import { outsideIdPrefixes } from './outside-ids.ts';
import { canSeeProject, keyPrefixesOf } from './projects.ts';

/**
 * Local activity counts from a developer's own machine (SPEC §6.4, §4.23,
 * §4.24, D-079, LAI-751) — the heatmap's *GitHub* and *Local* colours.
 *
 * ## One switch, the organisation's (D-102 amended, LAI-963)
 *
 * The organisation's `developer_insights`, set by an owner or admin, decides
 * alone: on, every connected machine's report is kept; off, every one is
 * refused with `local_activity_off` — read on every request, so turning it off
 * stops collection at once. The developer's own `share_local_activity` (D-079)
 * is no longer read: the column stays, holding what each person last chose,
 * and the person can no longer change it. Turning off deletes nothing; the
 * developer deletes their own history, and retention deletes it after 400
 * days (§11.6).
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
 *
 * ## A look-back adds keys and nothing else (D-080, LAI-757)
 *
 * A report marked `lookback` carries only pushed-commit keys, for days back to
 * retention's 400, and writes no snapshot row — so it can neither replace a
 * day's counts nor be counted twice: its keys join the same set.
 */

/** How often a collector may sync, said to it in every sharing answer (§6.4). */
/**
 * The `collector_id` of the rows OpenTelemetry adds to `token_usage_days`
 * (LAI-773, `token-telemetry.ts`): not a UUID, so never a machine's.
 */
export const TELEMETRY_COLLECTOR = 'telemetry';

export const MIN_SYNC_INTERVAL_S = 600;

/** A report's days: at most this many, each within this far behind today. */
export const REPORT_DAYS_MAX = 14;
/** …and at most one day ahead, for a machine whose clock is past midnight first. */
const REPORT_DAYS_AHEAD = 1;

/** Per day, per §6.4. */
export const PROMPTS_PER_AGENT_MAX = 5000;
export const SESSIONS_MAX = 500;
export const COMMITS_LOCAL_MAX = 2000;

/**
 * The ingest's body limit (§6.4) — under the general 1 MiB — for a snapshot
 * and a look-back alike (D-080): a collector chunks a look-back to it.
 *
 * **It is also the only bound on `pushed_keys`.** A key is 16 hex characters,
 * 19 bytes in the list with its quotes and comma, so a 16 KiB report holds
 * fewer than 900 of them however its days share them out. The per-day cap of
 * 2000 this had beside it could never be reached, and was removed rather
 * than kept as a limit that reads as real (LAI-751 review).
 */
export const LOCAL_ACTIVITY_BODY_MAX = 16 * 1024;

/** How far back a look-back day may be: retention's window (§11.6). */
export const LOOKBACK_DAYS_MAX = 400;

/** The preview's window: the days a report can still change. */
export const OWN_PREVIEW_DAYS_MAX = 14;

export { LOCAL_ACTIVITY_SCOPES } from '../db/enums.ts';

export interface ActivitySharingView {
  /** The organisation's switch. */
  org_enabled: boolean;
  /**
   * Whether this person's local activity is collected — the organisation's
   * switch, since D-102 (amended). Kept beside `org_enabled` so a collector
   * written against D-079's two switches syncs exactly when it may.
   */
  enabled: boolean;
  /** Always `false`: the person cannot stop collection (D-102 amended). */
  person_can_opt_out: false;
  scope: LocalActivityScope;
  min_sync_interval_s: number;
  /**
   * Asked with `?collector_id=`, by a caller who may send (D-084, LAI-769
   * review 1): the days in the usage window that **other** collectors of this
   * person already hold tokens for — dates only, never a count. The collector
   * leaves those days' older tokens out of a 30-day backfill, so a machine
   * counted under an earlier collector, or another machine, is not counted
   * again. Absent otherwise.
   */
  usage_days_elsewhere?: string[];
  /**
   * Asked the same way (D-084 item 5, LAI-770): the key prefixes of the
   * projects this person may read, and of the outside ids on their cards
   * (LAI-780), sorted. The collector ties a session to a task by a key in its
   * branch name only when the key's prefix is one of these, so `release-2026`
   * or `gpt-5` is never taken for a task. The collector keeps the last
   * answer. Absent otherwise.
   */
  task_prefixes?: string[];
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

/** A look-back report (D-080): keys per day, nothing else. */
export interface LookbackReport {
  v: 1;
  collector_id: string;
  tz: string;
  lookback: true;
  days: { day: string; pushed_keys: string[] }[];
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
  /** Their agents' tokens that day, cache reads apart (D-084 items 4 and 8). */
  tokens: number;
  cache_read: number;
}

/** What the server holds for the caller — the collection preview (§6.4). */
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

/**
 * Is local activity collected — the organisation's `developer_insights`, and
 * nothing else (D-102 amended). The one question every write here asks, and
 * every read that shows a person's local work: the heatmap, the profile and
 * the usage card hide it when this is off.
 */
export function collectionOn(db: Db): boolean {
  const org = db
    .select({ on: orgs.developerInsights })
    .from(orgs)
    .where(eq(orgs.id, requireOrgId(db)))
    .get();
  return org?.on === 1;
}

/**
 * What a reader is told of collection for any person: `{ org_enabled,
 * enabled }`, both the organisation's switch since D-102 (amended) — the
 * shape D-079's two switches gave, kept so a client reads it unchanged.
 */
export function collectionView(db: Db): { org_enabled: boolean; enabled: boolean } {
  const on = collectionOn(db);
  return { org_enabled: on, enabled: on };
}

function sharingView(db: Db, userId: string): ActivitySharingView {
  const user = db
    .select({ scope: users.localActivityScope })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (user === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
  return {
    ...collectionView(db),
    person_can_opt_out: false,
    scope: user.scope,
    min_sync_interval_s: MIN_SYNC_INTERVAL_S,
  };
}

/** How far back `usage_days_elsewhere` looks: the usage report's window, a day spare. */
const USAGE_HELD_DAYS_BACK = 32;

/**
 * `GET /me/activity-sharing`: a session or any token of theirs may ask. With
 * a collector id, from a caller who may send and with collection on, it also
 * names the days other collectors hold tokens for (see the view).
 */
export function getActivitySharing(
  db: Db,
  actor: ResolvedActor,
  collectorId?: string,
  now: number = Date.now(),
): ActivitySharingView {
  assertCan(actor, 'activity_sharing.read_own');
  const view = sharingView(db, actor.userId);
  if (collectorId === undefined || !view.org_enabled || !can(actor, 'local_activity.send_own')) {
    return view;
  }
  const from = addDays(dayIn('UTC', now), -USAGE_HELD_DAYS_BACK);
  const days = db
    .selectDistinct({ day: tokenUsageDays.day })
    .from(tokenUsageDays)
    .where(
      and(
        eq(tokenUsageDays.userId, actor.userId),
        gte(tokenUsageDays.day, from),
        ne(tokenUsageDays.collectorId, collectorId.toLowerCase()),
        // What telemetry adds (LAI-773) is no machine's: a day it fills is
        // not a day another collector holds.
        ne(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
      ),
    )
    .orderBy(tokenUsageDays.day)
    .all()
    .map((r) => r.day);
  // Filtered in code, as `listProjects` does: `can()` is the only authority.
  // Beside the projects' own, the prefixes of the outside ids their cards
  // carry (LAI-780), so a branch named for `LAI-780` counts too.
  // And every prefix a project carried before (D-103): a branch cut under the
  // old key is still that project's work.
  const prefixes = db
    .select({ id: projects.id, prefix: projects.prefix, formerPrefixes: projects.formerPrefixes })
    .from(projects)
    .all()
    .filter((p) => canSeeProject(actor, p.id))
    .flatMap((p) => keyPrefixesOf(p))
    .concat(outsideIdPrefixes(db, actor))
    .sort();
  return { ...view, usage_days_elsewhere: days, task_prefixes: [...new Set(prefixes)] };
}

export interface SetActivitySharingInput {
  enabled?: boolean | undefined;
  scope?: LocalActivityScope | undefined;
}

/**
 * `PUT /me/activity-sharing`: the developer's `scope`, from a web session only
 * (§3.1).
 *
 * **`enabled` is refused, not ignored** (D-102 amended, LAI-963): collection
 * is the organisation's, so a body carrying it — on or off, whatever the
 * organisation's switch — is `403` with `details.reason:
 * "organisation_controlled"` and writes nothing, its `scope` included. A
 * client still offering the old switch is told why it did nothing, instead of
 * a `200` that reads as consent given or withdrawn. The field stays in the
 * body's schema so that answer, not `422`'s unknown field, is what it gets.
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

  if (input.enabled !== undefined) {
    throw new ApiError(
      'forbidden',
      'Local activity is collected by your organisation; it is not yours to turn on or off',
      { reason: 'organisation_controlled', org_enabled: collectionOn(db) },
    );
  }
  if (input.scope !== undefined) {
    db.update(users)
      .set({ localActivityScope: input.scope })
      .where(eq(users.id, actor.userId))
      .run();
  }

  return sharingView(db, actor.userId);
}

// ------------------------------------------------------------------ ingest

/**
 * The names `laika connect` accepts for an agent beside its own slug (its
 * `ALIASES`), read the same way here. The collector (LAI-752) sends the slugs
 * themselves — `gemini-cli`, and `other` for Copilot CLI — so these only
 * catch a sender that used the short names people type.
 *
 * **A `Map`, not an object literal**: an id is the sender's text, and on a
 * plain object `constructor` finds `Object`'s own function — which was stored
 * as an agent's name (LAI-751 review). A `Map` holds only what is put in it.
 */
const AGENT_ALIASES: ReadonlyMap<string, AgentClient> = new Map([
  ['claude', 'claude-code'],
  ['gemini', 'gemini-cli'],
  ['copilot', 'vscode'],
  ['code', 'vscode'],
  ['agy', 'antigravity'],
]);

const KNOWN_AGENTS: ReadonlySet<string> = new Set(AGENT_CLIENTS);

/** An agent kind id → the board's slug; anything it does not know is `other`. */
export function agentKindOf(id: string): AgentClient {
  const lower = id.toLowerCase();
  if (KNOWN_AGENTS.has(lower)) return lower as AgentClient;
  return AGENT_ALIASES.get(lower) ?? 'other';
}

function refuse(reason: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ApiError('unprocessable', message, { reason, ...extra });
}

/**
 * The checks a schema cannot make: the time zone exists, and every day is a
 * real date inside the window, once (§6.4's `day_out_of_range`). A snapshot's
 * window is today − 14 to today + 1 and holds at most 14 days; a look-back's
 * reaches back `LOOKBACK_DAYS_MAX` and its count is bounded by the window and
 * the body limit.
 */
export function assertReportDays(
  report: { tz: string; days: readonly { day: string }[] },
  now: number,
  window: { daysBack: number; maxDays: number },
): void {
  if (!isTimeZone(report.tz)) {
    refuse('invalid_tz', 'tz is not a time zone this server knows', { field: 'tz' });
  }

  const today = dayIn(report.tz, now);
  const earliest = addDays(today, -window.daysBack);
  const latest = addDays(today, REPORT_DAYS_AHEAD);
  const outOfRange = (message: string, day?: string): never =>
    refuse('day_out_of_range', message, {
      earliest,
      latest,
      ...(day === undefined ? {} : { day }),
    });

  if (report.days.length < 1 || report.days.length > window.maxDays) {
    outOfRange(`days holds 1 to ${String(window.maxDays)} entries`);
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

const SNAPSHOT_WINDOW = { daysBack: REPORT_DAYS_MAX, maxDays: REPORT_DAYS_MAX };
// One entry per day of the window is the most the uniqueness rule allows.
const LOOKBACK_WINDOW = {
  daysBack: LOOKBACK_DAYS_MAX,
  maxDays: LOOKBACK_DAYS_MAX + 1 + REPORT_DAYS_AHEAD,
};

/** Each key once, at the earliest day these days have it on. */
function earliestDayPerKey(days: readonly { day: string; pushed_keys: string[] }[]) {
  const keys = new Map<string, string>();
  for (const day of days) {
    for (const raw of day.pushed_keys) {
      const key = raw.toLowerCase();
      const seen = keys.get(key);
      if (seen === undefined || day.day < seen) keys.set(key, day.day);
    }
  }
  return keys;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Pushed keys added to the person's set, each keeping the earliest day seen. */
function addPushedKeys(tx: Tx, userId: string, keys: Map<string, string>, now: number): void {
  if (keys.size === 0) return;
  // One prepared statement run per key: a look-back carries thousands, and a
  // statement rebuilt for every 500 of them cost more than the inserts did.
  const upsert = tx
    .insert(pushedCommitKeys)
    .values({
      userId,
      key: sql.placeholder('key'),
      day: sql.placeholder('day'),
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [pushedCommitKeys.userId, pushedCommitKeys.key],
      // A key keeps the earliest day it was seen on, from any machine.
      set: { day: sql`min(${pushedCommitKeys.day}, excluded.day)` },
    })
    .prepare();
  for (const [key, day] of keys) upsert.run({ key, day });
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
 * May this actor send a report at all: `can()`, then the organisation's
 * switch (§6.4's `local_activity_off`; D-102 amended — the person's own is
 * not asked). The route asks before it reads the body, so a collector is told
 * collection is off even when it sent something odd;
 * {@link recordLocalActivity} asks again for every other caller.
 */
export function assertMaySendLocalActivity(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'local_activity.send_own');

  if (!collectionOn(db)) {
    throw new ApiError('forbidden', 'Developer insights are off for this organisation', {
      reason: 'local_activity_off',
      ...collectionView(db),
    });
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
  assertReportDays(report, now, SNAPSHOT_WINDOW);
  const collectorId = report.collector_id.toLowerCase();
  const keys = earliestDayPerKey(report.days);

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

    addPushedKeys(tx, actor.userId, keys, now);
  });

  return { accepted_days: report.days.length };
}

/**
 * `PUT /me/local-activity` with `lookback: true` (D-080): a developer's own
 * pushed commits from before the snapshot window, as keys per day. The same
 * permission, switch and report budget as a snapshot; days back to
 * retention's window; no snapshot row written or replaced.
 */
export function recordLookback(
  db: Db,
  actor: ResolvedActor,
  report: LookbackReport,
  now: number = Date.now(),
): AcceptedReport {
  assertMaySendLocalActivity(db, actor);
  assertReportDays(report, now, LOOKBACK_WINDOW);
  const keys = earliestDayPerKey(report.days);
  db.transaction((tx) => {
    addPushedKeys(tx, actor.userId, keys, now);
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
 * their last days — the collection screen's preview (§6.4). Their own rows
 * only, whatever the switch says: what was kept before collection was turned
 * off is still theirs to see and to delete.
 */
export function getOwnLocalActivity(
  db: Db,
  actor: ResolvedActor,
  days: number = OWN_PREVIEW_DAYS_MAX,
  now: number = Date.now(),
): OwnLocalActivityView {
  assertCan(actor, 'local_activity.read_own');
  return localActivityOf(db, actor.userId, days, now);
}

/**
 * One person's held local activity, as `GET /me/local-activity` answers it —
 * **no `can()` here**: the person's read asks `local_activity.read_own`, an
 * owner's or admin's `people.analytics.read` (D-102 rule 1, LAI-957).
 */
export function localActivityOf(
  db: Db,
  userId: string,
  days: number = OWN_PREVIEW_DAYS_MAX,
  now: number = Date.now(),
): OwnLocalActivityView {
  const span = Math.min(Math.max(Math.trunc(days), 1), OWN_PREVIEW_DAYS_MAX);
  const tz = latestReportZone(db, userId);
  const end = dayIn(tz, now);
  const start = addDays(end, -(span - 1));

  const rows = db
    .select()
    .from(localActivityDays)
    .where(
      and(
        eq(localActivityDays.userId, userId),
        gte(localActivityDays.day, start),
        lte(localActivityDays.day, end),
      ),
    )
    .all();
  const pushed = pushedPerDay(db, userId, start, end);

  const byDay = new Map<string, OwnLocalDay>();
  const at = (day: string): OwnLocalDay => {
    let entry = byDay.get(day);
    if (entry === undefined) {
      entry = {
        day,
        prompts_by_agent: {},
        sessions: 0,
        commits_local: 0,
        pushed_commits: 0,
        tokens: 0,
        cache_read: 0,
      };
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
  // Their token totals (D-084 item 4): the collection screen names what is
  // held.
  for (const row of db
    .select({
      day: tokenUsageDays.day,
      tokens: sql<number>`sum(${tokenUsageDays.input} + ${tokenUsageDays.output} + ${tokenUsageDays.cacheWrite})`,
      cacheRead: sql<number>`sum(${tokenUsageDays.cacheRead})`,
    })
    .from(tokenUsageDays)
    .where(
      and(
        eq(tokenUsageDays.userId, userId),
        gte(tokenUsageDays.day, start),
        lte(tokenUsageDays.day, end),
      ),
    )
    .groupBy(tokenUsageDays.day)
    .all()) {
    const entry = at(row.day);
    entry.tokens = Number(row.tokens);
    entry.cache_read = Number(row.cacheRead);
  }

  const oldest = db
    .select({ day: min(localActivityDays.day) })
    .from(localActivityDays)
    .where(eq(localActivityDays.userId, userId))
    .get();
  const oldestKey = db
    .select({ day: min(pushedCommitKeys.day) })
    .from(pushedCommitKeys)
    .where(eq(pushedCommitKeys.userId, userId))
    .get();
  // Token rows are held too (D-084): someone with only those can still see
  // that something is kept, and delete it.
  const oldestTokens = db
    .select({ day: min(tokenUsageDays.day) })
    .from(tokenUsageDays)
    .where(eq(tokenUsageDays.userId, userId))
    .get();
  const oldestDay = [oldest?.day, oldestKey?.day, oldestTokens?.day]
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

/**
 * `DELETE /me/local-activity`: every local row and key of theirs, now — and
 * their token usage too (D-084 item 4): it came from the same collector, under
 * the same organisation switch, so *delete my history* reaches it.
 */
export function deleteOwnLocalActivity(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'local_activity.delete_own');
  db.transaction((tx) => {
    tx.delete(localActivityDays).where(eq(localActivityDays.userId, actor.userId)).run();
    tx.delete(pushedCommitKeys).where(eq(pushedCommitKeys.userId, actor.userId)).run();
    tx.delete(tokenUsageDays).where(eq(tokenUsageDays.userId, actor.userId)).run();
    // And what came with them (LAI-773): the sessions matched against
    // telemetry, the series state, the excluded keys, the arrival rate, and
    // the zone the reports stated. The plan limit is a setting, not history,
    // and stays.
    tx.delete(tokenSessionDays).where(eq(tokenSessionDays.userId, actor.userId)).run();
    tx.delete(tokenTelemetrySeries).where(eq(tokenTelemetrySeries.userId, actor.userId)).run();
    tx.delete(tokenSessionSkips).where(eq(tokenSessionSkips.userId, actor.userId)).run();
    tx.delete(tokenArrivals).where(eq(tokenArrivals.userId, actor.userId)).run();
    tx.delete(tokenUsageZones).where(eq(tokenUsageZones.userId, actor.userId)).run();
    // And agent minutes with the split that ties them to cards (LAI-787):
    // the same collection's figures. Time the person confirmed is a record,
    // not collected history, and stays.
    tx.delete(agentTimeDays).where(eq(agentTimeDays.userId, actor.userId)).run();
    tx.delete(agentTimeBuckets).where(eq(agentTimeBuckets.userId, actor.userId)).run();
    tx.delete(tokenSessionTasks).where(eq(tokenSessionTasks.userId, actor.userId)).run();
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
