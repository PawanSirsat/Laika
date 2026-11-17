import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  type ActivityEvent,
  latestActivitySeq,
  readActivityAfter,
  readPayload,
} from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  type TaskStatus,
  type TeamsPostEvent,
  type TeamsPostKind,
  type TeamsPostReason,
} from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  activity,
  comments,
  orgs,
  orgTeamsSettings,
  type OrgTeamsSettings,
  projectMemberships,
  projects,
  projectStatuses,
  projectTeamsChannels,
  type ProjectTeamsChannel,
  taskDependencies,
  tasks,
  teamsPosts,
  type TeamsPost,
  users,
} from '../db/schema.ts';
import { type Logger } from '../log.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { decryptSecret } from '../secrets.ts';
import {
  isRetryable,
  isTeamsWebhookUrl,
  sendToTeams,
  type TeamsClientDeps,
} from './teams-client.ts';
import {
  buildCommentNotice,
  buildDigest,
  buildStandup,
  buildTaskNotice,
  dayBefore,
  DIGEST_HOUR_SAST,
  type DigestData,
  isWeekend,
  istDay,
  OTHER_SPACE_BLOCKER,
  istInstant,
  sastDay,
  sastMidnight,
  type StandupData,
  type StandupRun,
  STANDUP_RUNS,
  type TaskEvent,
  type TeamsSpace,
  UPDATES_FETCHED,
  windowStart,
} from './teams-compose.ts';
import { type TeamsNotice } from './teams-message.ts';

/**
 * Teams posting (D-154, LAI-1314): KSage's stand-ups, nightly digest and
 * instant notices, posted to each space's own Power Automate flow by one job
 * that runs every minute.
 *
 * ## Off is how it ships
 *
 * Until an owner or admin turns *Teams posting on*, **nothing is posted**,
 * and every post that would have gone — a space with a channel, a slot that
 * came due, a change worth a notice — is recorded as suppressed,
 * `posting_off`. Turning it on is one switch; nothing has to be set up again.
 *
 * ## Scheduled posts: a slot, claimed before it is sent
 *
 * KSage's stand-up runs at 11:00 and 18:00 IST (05:30 and 12:30 UTC), Monday
 * to Friday, and its nightly digest at 09:00 SAST (07:00 UTC), every day. A
 * run is **due** from its time for {@link SLOT_GRACE_MS}: a server restarted
 * at 05:40 still sends the morning's, and one down until the afternoon does
 * not post a stand-up after the meeting it was for.
 *
 * Each space's run is a **slot** (`standup:morning:2026-11-18`), claimed in
 * `teams_posts` before it is posted — KSage's `digest_runs` guard — so two
 * ticks never both post it. A post that failed where nothing reached Teams
 * (`unreachable`, or Teams' *not now*) releases the slot and a later tick
 * tries again, **at most {@link MAX_SLOT_ATTEMPTS} times**; a refusal or a
 * post that may have arrived (`no_answer`) is final. No retry storm: a minute
 * apart, three at most, and never one that could post twice.
 *
 * ## Instant notices: read from `activity`, after the fact
 *
 * Nothing in a request posts to Teams — a task write never waits on a
 * webhook, and a slow flow can never fail one. The job reads `activity` past
 * the cursor `org_teams_settings.notice_cursor` keeps, decides which rows are
 * news (KSage's short list, in Laika's terms — `teams-compose.ts`), **moves
 * the cursor first**, then posts: a crash mid-tick loses a notice rather than
 * sending one twice. A notice is one attempt; it is never retried. A change
 * older than {@link NOTICE_HORIZON_MS} by the time it is read is not news,
 * and one tick posts at most {@link NOTICES_PER_TICK} — the rest recorded,
 * `burst`.
 *
 * ## The address is a credential
 *
 * Decrypted for the post and nowhere else; never logged, never in a row.
 * Teams' answer is never read: the record keeps its status code alone.
 */

/** How often the job runs. A notice is instant to within this. */
export const TEAMS_TICK_MS = 60 * 1000;
/** How long after its time a scheduled run may still go. */
export const SLOT_GRACE_MS = 2 * 60 * 60 * 1000;
/** The most attempts one slot gets, the first included. */
export const MAX_SLOT_ATTEMPTS = 3;
/** A change older than this when the job reads it is posted as nothing. */
export const NOTICE_HORIZON_MS = 60 * 60 * 1000;
/** The most notices one tick posts; any more are recorded, `burst`. */
export const NOTICES_PER_TICK = 20;
/** The most `activity` rows one tick reads. */
const ACTIVITY_PER_TICK = 500;
/** How long the record of posts is kept (§11.6). */
export const TEAMS_POSTS_KEPT_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** §3.4's principal: nobody posts, whoever's change it was. */
const SYSTEM = systemPrincipal();

export interface TeamsPostingDeps extends TeamsClientDeps {
  now?: (() => number) | undefined;
  /** Where a failed post is said — its space, kind and reason, never the address or Teams' words. */
  log?: Logger | undefined;
  /** `LAIKA_PUBLIC_URL`, for the posts' links back; absent, a post carries none. */
  publicUrl?: string | null | undefined;
}

/** What one tick did. */
export interface TeamsTickResult {
  sent: number;
  failed: number;
  suppressed: number;
  /** Records older than 90 days removed. */
  pruned: number;
}

// --------------------------------------------------------- the record

interface PostRecord {
  readonly projectId: string;
  readonly kind: TeamsPostKind;
  readonly event: TeamsPostEvent | null;
  readonly slot: string | null;
  readonly title: string;
  readonly attempt: number;
}

const TITLE_MAX = 300;

/** The headline, cut by code point — as a comment is — so an emoji at the cut stays whole. */
export function titleOf(notice: TeamsNotice): string {
  const points = [...notice.title.trim()];
  if (points.length === 0) return '(untitled)';
  return points.length > TITLE_MAX
    ? `${points.slice(0, TITLE_MAX - 1).join('')}…`
    : points.join('');
}

/**
 * Record a post that was not sent, and answer the row. A slot already
 * recorded is left as it is, and answers null.
 */
export function recordSuppressed(
  db: Db,
  record: PostRecord,
  reason: TeamsPostReason,
  now: number,
): TeamsPost | null {
  const id = newId();
  const written =
    db
      .insert(teamsPosts)
      .values({
        id,
        ...record,
        outcome: 'suppressed',
        reason,
        httpStatus: null,
        createdAt: now,
        finishedAt: now,
      })
      .onConflictDoNothing()
      .run().changes === 1;
  return written ? (db.select().from(teamsPosts).where(eq(teamsPosts.id, id)).get() ?? null) : null;
}

/** Whether the organisation's switch is on, read now. */
function postingOn(db: Db): boolean {
  return db.select({ on: orgTeamsSettings.postingEnabled }).from(orgTeamsSettings).get()?.on === 1;
}

/**
 * The address to post to, or null when it cannot be used: it would not
 * decrypt — `LAIKA_SECRET` changed, or the row was altered — or it is no
 * longer an address {@link isTeamsWebhookUrl} accepts.
 */
function addressOf(channel: ProjectTeamsChannel, serverSecret: string): string | null {
  if (serverSecret === '') return null;
  try {
    const url = decryptSecret(channel.webhookUrlEnc, serverSecret, 'teams_webhook_url');
    return isTeamsWebhookUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Claim a post, send it, and record what came of it.
 *
 * **The switch and the channel are read here, at the moment of posting**, not
 * once a tick: better-sqlite3 is synchronous, so from these reads to the claim
 * and the decryption nothing else can run. A tick that waits on a slow flow
 * for one space therefore never posts the next after posting was turned off,
 * to a channel that was removed, or to an address that was replaced — it uses
 * the row as it is now. Off, a scheduled post or a notice is recorded
 * `posting_off` and not sent; a test post goes either way.
 *
 * Answers the row written, or `null` when nothing was: the space has no
 * channel now, or the slot was already claimed by somebody else.
 */
export async function postAndRecord(
  db: Db,
  serverSecret: string,
  record: PostRecord,
  notice: TeamsNotice,
  deps: TeamsPostingDeps,
): Promise<TeamsPost | null> {
  const clock = deps.now ?? Date.now;
  const channel = db
    .select()
    .from(projectTeamsChannels)
    .where(eq(projectTeamsChannels.projectId, record.projectId))
    .get();
  // Removed since the tick began: the space is told nothing, and that is no post.
  if (channel === undefined) return null;
  if (record.kind !== 'test' && !postingOn(db)) {
    return recordSuppressed(db, record, 'posting_off', clock());
  }
  const id = newId();
  const claimed =
    db
      .insert(teamsPosts)
      .values({
        id,
        ...record,
        outcome: 'sending',
        reason: null,
        httpStatus: null,
        createdAt: clock(),
        finishedAt: null,
      })
      .onConflictDoNothing()
      .run().changes === 1;
  if (!claimed) return null;

  const url = addressOf(channel, serverSecret);
  const result =
    url === null
      ? ({ outcome: 'failed', reason: 'address_unusable', httpStatus: null } as const)
      : await sendToTeams(url, notice, deps);

  db.update(teamsPosts)
    .set({
      outcome: result.outcome,
      reason: result.outcome === 'sent' ? null : result.reason,
      httpStatus: result.httpStatus,
      finishedAt: clock(),
    })
    .where(eq(teamsPosts.id, id))
    .run();

  if (result.outcome === 'failed') {
    deps.log?.warn('teams.post_failed', {
      project_id: record.projectId,
      kind: record.kind,
      event: record.event,
      reason: result.reason,
      http_status: result.httpStatus,
    });
  }
  return db.select().from(teamsPosts).where(eq(teamsPosts.id, id)).get() ?? null;
}

// ------------------------------------------------------ the organisation

/**
 * The settings row, made the first time anything needs it — off, with the
 * cursor at the newest `activity` row, so nothing written before it existed
 * is ever posted.
 */
export function ensureTeamsSettings(db: Db, orgId: string, now: number): OrgTeamsSettings {
  const existing = db
    .select()
    .from(orgTeamsSettings)
    .where(eq(orgTeamsSettings.orgId, orgId))
    .get();
  if (existing !== undefined) return existing;
  db.insert(orgTeamsSettings)
    .values({
      orgId,
      postingEnabled: 0,
      noticeCursor: latestActivitySeq(db),
      updatedBy: null,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  return db.select().from(orgTeamsSettings).where(eq(orgTeamsSettings.orgId, orgId)).get()!;
}

/**
 * Every unarchived space that had a channel when the tick began — which spaces
 * to compose for. A space with none is told nothing. Whether its channel is
 * still there, and where it points, is read again at each post.
 */
function channelledSpaces(
  db: Db,
): Map<string, { readonly space: TeamsSpace & { readonly id: string } }> {
  const rows = db
    .select({ project: projects })
    .from(projectTeamsChannels)
    .innerJoin(projects, eq(projects.id, projectTeamsChannels.projectId))
    .where(isNull(projects.archivedAt))
    .all();
  return new Map(
    rows.map(({ project }) => [
      project.id,
      { space: { id: project.id, name: project.name, prefix: project.prefix, slug: project.slug } },
    ]),
  );
}

// ---------------------------------------------------------------- the tick

const inFlight = new WeakMap<Db, Promise<TeamsTickResult>>();

/**
 * Run one tick, or join the one already running against this database — the
 * HR sync's guard (`runHrSync`): a tick that waits on several slow flows must
 * not have the next minute's start beside it.
 */
export function runTeamsTick(
  db: Db,
  serverSecret: string,
  deps: TeamsPostingDeps = {},
): Promise<TeamsTickResult> {
  const running = inFlight.get(db);
  if (running !== undefined) return running;
  const run = teamsTick(db, serverSecret, deps).finally(() => {
    inFlight.delete(db);
  });
  inFlight.set(db, run);
  return run;
}

/** One tick. Use {@link runTeamsTick}, which keeps two from overlapping. */
export async function teamsTick(
  db: Db,
  serverSecret: string,
  deps: TeamsPostingDeps = {},
): Promise<TeamsTickResult> {
  assertCan(SYSTEM, 'system.teams.post');
  const clock = deps.now ?? Date.now;
  const now = clock();
  const result: TeamsTickResult = { sent: 0, failed: 0, suppressed: 0, pruned: 0 };

  result.pruned = db
    .delete(teamsPosts)
    .where(lt(teamsPosts.createdAt, now - TEAMS_POSTS_KEPT_MS))
    .run().changes;

  const org = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (org === undefined) return result;

  // The switch is not read here: `postAndRecord` reads it, and the channel,
  // at the moment of each post.
  const settings = ensureTeamsSettings(db, org.id, now);
  const spaces = channelledSpaces(db);
  const publicUrl = deps.publicUrl ?? null;

  /** Counts a post, and says whether it went out to Teams (sent or failed). */
  const count = (post: TeamsPost | null): boolean => {
    if (post?.outcome === 'sent') result.sent += 1;
    else if (post?.outcome === 'failed') result.failed += 1;
    else if (post?.outcome === 'suppressed') result.suppressed += 1;
    return post?.outcome === 'sent' || post?.outcome === 'failed';
  };

  // ---- instant notices, from the activity past the cursor
  const rows = readActivityAfter(db, settings.noticeCursor, ACTIVITY_PER_TICK);
  const last = rows.at(-1);
  if (last !== undefined) {
    // Moved first: a crash below loses a notice, never sends one twice.
    db.update(orgTeamsSettings)
      .set({ noticeCursor: last.seq })
      .where(eq(orgTeamsSettings.orgId, org.id))
      .run();
  }
  let posted = 0;
  for (const row of rows) {
    const where = row.projectId === null ? undefined : spaces.get(row.projectId);
    if (where === undefined) continue;
    for (const { event, notice } of noticesFor(db, row, where.space, publicUrl)) {
      const record: PostRecord = {
        projectId: where.space.id,
        kind: 'notice',
        event,
        slot: null,
        title: titleOf(notice),
        attempt: 1,
      };
      const held: TeamsPostReason | null =
        now - row.createdAt > NOTICE_HORIZON_MS
          ? 'too_old'
          : posted >= NOTICES_PER_TICK
            ? 'burst'
            : null;
      if (held !== null) {
        count(recordSuppressed(db, record, held, now));
        continue;
      }
      if (count(await postAndRecord(db, serverSecret, record, notice, deps))) posted += 1;
    }
  }

  // ---- the stand-ups and the digest that are due now
  for (const due of dueSlots(now)) {
    for (const { space } of spaces.values()) {
      const previous = db
        .select({ outcome: teamsPosts.outcome, reason: teamsPosts.reason })
        .from(teamsPosts)
        .where(and(eq(teamsPosts.projectId, space.id), eq(teamsPosts.slot, due.slot)))
        .all();
      // Sent, being sent, held back, refused, or tried enough: done with.
      if (previous.some((p) => p.outcome !== 'failed')) continue;
      if (previous.some((p) => !isRetryable(p.reason))) continue;
      if (previous.length >= MAX_SLOT_ATTEMPTS) continue;

      const notice =
        due.kind === 'standup'
          ? buildStandup(space, due.run, now, publicUrl, standupData(db, space.id, due.run, now))
          : buildDigest(space, due.day, publicUrl, digestData(db, space.id, due.day));
      // A quiet day sends no digest, and records none: nothing would have gone.
      if (notice === null) continue;

      const record: PostRecord = {
        projectId: space.id,
        kind: due.kind,
        event: due.kind === 'standup' ? due.run : null,
        slot: due.slot,
        title: titleOf(notice),
        attempt: previous.length + 1,
      };
      count(await postAndRecord(db, serverSecret, record, notice, deps));
    }
  }

  return result;
}

// ----------------------------------------------------------------- the slots

export type DueSlot =
  | { readonly kind: 'standup'; readonly run: StandupRun; readonly slot: string }
  | { readonly kind: 'digest'; readonly day: string; readonly slot: string };

/**
 * The scheduled posts due at `now`, each for {@link SLOT_GRACE_MS}: the
 * stand-ups from 11:00 and 18:00 IST, **Monday to Friday by India's
 * calendar** (KSage's schedule: an agenda on a weekend is how a channel gets
 * muted), and yesterday's digest from 09:00 SAST **every day, the weekend
 * included** (D-154 item 6) — `buildDigest` then sends it only when
 * something moved or is blocked.
 */
export function dueSlots(now: number): DueSlot[] {
  const due: DueSlot[] = [];
  const today = istDay(now);
  if (!isWeekend(today)) {
    for (const run of ['morning', 'evening'] as const) {
      const at = istInstant(today, STANDUP_RUNS[run].hourIst, STANDUP_RUNS[run].minuteIst);
      if (now >= at && now < at + SLOT_GRACE_MS) {
        due.push({ kind: 'standup', run, slot: `standup:${run}:${today}` });
      }
    }
  }
  const sast = sastDay(now);
  const at = sastMidnight(sast) + DIGEST_HOUR_SAST * 60 * 60 * 1000;
  if (now >= at && now < at + SLOT_GRACE_MS) {
    const day = dayBefore(sast);
    due.push({ kind: 'digest', day, slot: `digest:${day}` });
  }
  return due;
}

// ------------------------------------------------------------ the gathering

const OPEN: (status: TaskStatus) => boolean = (status) =>
  status !== 'done' && status !== 'cancelled';

interface TaskFacts {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly assigneeId: string | null;
  readonly completedAt: number | null;
}

function taskFacts(db: Db, taskId: string): TaskFacts | null {
  const row = db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      completedAt: tasks.completedAt,
      prefix: projects.prefix,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get();
  if (row === undefined) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    key: `${row.prefix}-${String(row.number)}`,
    title: row.title,
    status: row.status,
    assigneeId: row.assigneeId,
    completedAt: row.completedAt,
  };
}

function nameOf(db: Db, userId: string | null, nobody = 'nobody'): string {
  if (userId === null) return nobody;
  return (
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ?? nobody
  );
}

/** Who made a change, as a channel reads it: a person, a person's agent, or Laika. */
function actorName(db: Db, row: Pick<ActivityEvent, 'actorId' | 'actorKind'>): string {
  if (row.actorKind === 'system' || row.actorId === null) return 'Laika';
  const name = nameOf(db, row.actorId, 'somebody');
  return row.actorKind === 'agent' ? `${name} (agent)` : name;
}

/** The tasks a task waits on that are not done. */
function openBlockers(
  db: Db,
  taskId: string,
): { key: string; projectId: string; addedAt: number }[] {
  return db
    .select({
      number: tasks.number,
      prefix: projects.prefix,
      projectId: tasks.projectId,
      addedAt: taskDependencies.createdAt,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(taskDependencies.taskId, taskId), sql`${tasks.status} <> 'done'`))
    .orderBy(asc(taskDependencies.createdAt))
    .all()
    .map((b) => ({
      key: `${b.prefix}-${String(b.number)}`,
      projectId: b.projectId,
      addedAt: b.addedAt,
    }));
}

/**
 * What a space's post may say its task waits on: its own space's keys, in
 * order, and **any blocker in another space only as that** — never its key or
 * title (D-154 item 1). Several there are one entry, **last**, so the first
 * entry is always one blocker whenever there is more than one entry; and the
 * true number of blockers beside the words, because an entry may stand for
 * several (review of LAI-1314: *"and 1 more"* for three).
 */
function waitingWords(
  blockers: readonly { key: string; projectId: string }[],
  projectId: string,
): { words: string[]; total: number } {
  const own = blockers.filter((b) => b.projectId === projectId).map((b) => b.key);
  const elsewhere = blockers.length - own.length;
  if (elsewhere === 0) return { words: own, total: blockers.length };
  const phrase =
    elsewhere === 1 ? OTHER_SPACE_BLOCKER : `${String(elsewhere)} tasks in other spaces`;
  return { words: [...own, phrase], total: blockers.length };
}

/**
 * Whether a task was done at an instant: done now, and done since then.
 * `completed_at` is the latest arrival at `done` (§4.5), so a task finished,
 * reopened and finished again reads as done only from the second time — the
 * safe direction, since it can only make a notice say less.
 */
function doneAt(task: Pick<TaskFacts, 'status' | 'completedAt'>, at: number): boolean {
  return task.status === 'done' && task.completedAt !== null && task.completedAt <= at;
}

/** Whether a task was still open at an instant: not cancelled now, and not yet done then. */
function openAt(task: Pick<TaskFacts, 'status' | 'completedAt'>, at: number): boolean {
  return task.status !== 'cancelled' && !doneAt(task, at);
}

/**
 * The tasks a task waited on **at an instant** that were not done then.
 *
 * The job reads a change up to a minute after it was made, and by then the
 * board may have moved on — the blocker finished, the dependency removed. A
 * notice says what the change meant when it happened, so this reads the
 * dependencies as they stood: those added by then and still there, and those
 * there then and removed since (from their `task.dependency_removed` rows).
 */
function blockersAt(db: Db, taskId: string, at: number): string[] {
  const current = db
    .select({ on: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.taskId, taskId), lte(taskDependencies.createdAt, at)))
    .all()
    .map((d) => d.on);
  const removedSince = db
    .select({ payloadJson: activity.payloadJson })
    .from(activity)
    .where(
      and(
        eq(activity.taskId, taskId),
        eq(activity.type, 'task.dependency_removed'),
        gt(activity.createdAt, at),
      ),
    )
    .all()
    .map((row) => readPayload(row))
    .map((p) =>
      typeof p === 'object' && p !== null ? (p as Record<string, unknown>).depends_on : null,
    )
    .filter((on): on is string => typeof on === 'string')
    // There then only if it had been added by then.
    .filter(
      (on) =>
        db
          .select({ id: activity.id })
          .from(activity)
          .where(
            and(
              eq(activity.taskId, taskId),
              eq(activity.type, 'task.dependency_added'),
              lte(activity.createdAt, at),
              sql`json_extract(${activity.payloadJson}, '$.depends_on') = ${on}`,
            ),
          )
          .get() !== undefined,
    );
  return [...new Set([...current, ...removedSince])]
    .map((id) => taskFacts(db, id))
    .filter((b): b is TaskFacts => b !== null && !doneAt(b, at))
    .map((b) => b.key);
}

/** The tasks that waited on this one at an instant — still waiting, or since let go of it. */
function dependentsAt(db: Db, blockerId: string, at: number): string[] {
  const current = db
    .select({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .where(
      and(eq(taskDependencies.dependsOnTaskId, blockerId), lte(taskDependencies.createdAt, at)),
    )
    .all()
    .map((d) => d.taskId);
  const removedSince = db
    .select({ taskId: activity.taskId })
    .from(activity)
    .where(
      and(
        eq(activity.type, 'task.dependency_removed'),
        gt(activity.createdAt, at),
        sql`json_extract(${activity.payloadJson}, '$.depends_on') = ${blockerId}`,
      ),
    )
    .all()
    .map((row) => row.taskId)
    .filter((id): id is string => id !== null);
  return [...new Set([...current, ...removedSince])];
}

/** A status category as words, for a row written before status names were. */
function categoryWords(category: unknown): string {
  return typeof category === 'string' ? category.replaceAll('_', ' ') : 'another status';
}

function field(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The notices one `activity` row makes — none for most. KSage's list, mapped
 * (`teams-compose.ts`): handed to somebody by somebody else; into review; out
 * of review back to work; done; blocked by a task not done; unblocked when the
 * last thing in its way is done or removed; and a person's comment.
 *
 * **Not an agent's comment**: agents comment as they go, and a channel that
 * reads out every one of them is a channel everybody mutes. Not a bulk
 * reassignment either (`via: 'offboarding'`): one person leaving is forty
 * notices that say one thing.
 */
function noticesFor(
  db: Db,
  row: ActivityEvent,
  space: TeamsSpace,
  publicUrl: string | null,
): { event: TeamsPostEvent; notice: TeamsNotice }[] {
  if (row.taskId === null) return [];
  const raw = readPayload(row);
  const payload = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const task = taskFacts(db, row.taskId);
  if (task === null) return [];
  const notice = (event: TaskEvent, about: TaskFacts = task) => ({
    event: event.kind,
    notice: buildTaskNotice(about, space.name, publicUrl, event),
  });
  const assignee = (about: TaskFacts) => nameOf(db, about.assigneeId);

  switch (row.type) {
    case 'task.assigned': {
      const to = field(payload, 'to');
      if (to === null || to === row.actorId || payload.via === 'offboarding') return [];
      return [notice({ kind: 'assigned', to: nameOf(db, to), by: actorName(db, row) })];
    }

    case 'task.status_changed': {
      const from = payload.from;
      const to = payload.to;
      if (from === to) return [];
      const toName = field(payload, 'to_status_name') ?? categoryWords(to);
      const fromName = field(payload, 'from_status_name') ?? categoryWords(from);
      if (to === 'review') return [notice({ kind: 'in_review', to: toName })];
      if (from === 'review' && (to === 'in_progress' || to === 'todo' || to === 'backlog')) {
        return [
          notice({ kind: 'sent_back', from: fromName, to: toName, assignee: assignee(task) }),
        ];
      }
      if (to !== 'done') return [];
      // Done — and every task in this space that waited on it with nothing
      // else in its way, as things stood the moment it was done.
      const at = row.createdAt;
      const unblocked = dependentsAt(db, task.id, at)
        .map((id) => taskFacts(db, id))
        .filter(
          (d): d is TaskFacts =>
            d !== null &&
            d.projectId === task.projectId &&
            openAt(d, at) &&
            blockersAt(db, d.id, at).length === 0,
        )
        .map((d) => notice({ kind: 'unblocked', assignee: assignee(d) }, d));
      return [notice({ kind: 'done', to: toName, by: actorName(db, row) }), ...unblocked];
    }

    case 'task.dependency_added': {
      const on = field(payload, 'depends_on');
      const blocker = on === null ? null : taskFacts(db, on);
      const at = row.createdAt;
      if (blocker === null || doneAt(blocker, at) || !openAt(task, at)) return [];
      return [
        notice({
          kind: 'blocked',
          // Another space's task is named as that and nothing more (D-154 item 1).
          waitingOn:
            blocker.projectId === task.projectId
              ? `${blocker.key} ${blocker.title}`
              : OTHER_SPACE_BLOCKER,
          assignee: assignee(task),
        }),
      ];
    }

    case 'task.dependency_removed': {
      const on = field(payload, 'depends_on');
      const blocker = on === null ? null : taskFacts(db, on);
      const at = row.createdAt;
      // It was in the way only if it was not done; and the task is clear only
      // if nothing else was, then.
      if (blocker === null || doneAt(blocker, at) || !openAt(task, at)) return [];
      if (blockersAt(db, task.id, at).length > 0) return [];
      return [notice({ kind: 'unblocked', assignee: assignee(task) })];
    }

    case 'comment.added': {
      if (row.actorKind !== 'user' || row.actorId === null) return [];
      const id = field(payload, 'comment_id');
      const comment =
        id === null ? undefined : db.select().from(comments).where(eq(comments.id, id)).get();
      if (comment?.deletedAt !== null) return [];
      return [
        {
          event: 'commented',
          notice: buildCommentNotice(
            task,
            {
              name: nameOf(db, row.actorId, 'somebody'),
              role: roleOf(db, row.actorId, task.projectId),
            },
            comment.bodyMd,
            publicUrl,
          ),
        },
      ];
    }

    default:
      return [];
  }
}

/** A comment's author's role here: their space role, else their org role when it leads every space. */
function roleOf(db: Db, userId: string, projectId: string): string | null {
  const membership = db
    .select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
    .get();
  if (membership !== undefined) return membership.role;
  const org = db.select({ role: users.orgRole }).from(users).where(eq(users.id, userId)).get();
  return org?.role === 'owner' || org?.role === 'admin' ? org.role : null;
}

interface SpaceTask {
  readonly id: string;
  readonly key: string;
  readonly number: number;
  readonly title: string;
  readonly status: TaskStatus;
  readonly statusName: string;
  readonly assignee: string;
  readonly assigneeId: string | null;
  readonly dueOn: number | null;
  readonly staleFlaggedAt: number | null;
  readonly updatedAt: number;
}

/** Every task in a space with what a stand-up reads of it, by number. */
function spaceTasks(db: Db, projectId: string): SpaceTask[] {
  return db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      statusName: projectStatuses.name,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      dueOn: tasks.dueOn,
      staleFlaggedAt: tasks.staleFlaggedAt,
      updatedAt: tasks.updatedAt,
      prefix: projects.prefix,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tasks.statusId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.number))
    .all()
    .map((t) => ({
      id: t.id,
      key: `${t.prefix}-${String(t.number)}`,
      number: t.number,
      title: t.title,
      status: t.status,
      statusName: t.statusName,
      assignee: t.assigneeName ?? 'Unassigned',
      assigneeId: t.assigneeId,
      dueOn: t.dueOn,
      staleFlaggedAt: t.staleFlaggedAt,
      updatedAt: t.updatedAt,
    }));
}

/** Open tasks waiting on something not done, oldest wait first, with what they wait on. */
function blockedOf(
  db: Db,
  projectId: string,
  open: readonly SpaceTask[],
): { task: SpaceTask; waitingOn: string[]; waitingTotal: number; since: number }[] {
  return open
    .map((task) => {
      const blockers = openBlockers(db, task.id);
      const waiting = waitingWords(blockers, projectId);
      return {
        task,
        waitingOn: waiting.words,
        waitingTotal: waiting.total,
        since: Math.min(...blockers.map((b) => b.addedAt)),
      };
    })
    .filter((b) => b.waitingOn.length > 0)
    .sort((a, b) => a.since - b.since || a.task.number - b.task.number);
}

/** What a stand-up for one space reads — KSage's six queries. */
export function standupData(db: Db, projectId: string, run: StandupRun, now: number): StandupData {
  const all = spaceTasks(db, projectId);
  const open = all.filter((t) => OPEN(t.status));
  const waiting = blockedOf(db, projectId, open);
  const blocked = waiting.slice(0, 40);
  const blockedIds = new Set(waiting.map((b) => b.task.id));
  const today = istDay(now);
  const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

  const lead = db
    .select({ name: users.name })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.role, 'lead'),
        eq(users.isActive, 1),
      ),
    )
    .orderBy(asc(users.name))
    .get();

  return {
    blocked: blocked.map((b) => ({
      key: b.task.key,
      title: b.task.title,
      assignee: b.task.assignee,
      waitingOn: b.waitingOn,
      waitingTotal: b.waitingTotal,
      days: (now - b.since) / DAY_MS,
    })),
    stale: open
      .filter(
        (t) => t.status === 'in_progress' && t.staleFlaggedAt !== null && !blockedIds.has(t.id),
      )
      .map((t) => ({
        key: t.key,
        title: t.title,
        assignee: t.assignee,
        days: (now - t.updatedAt) / DAY_MS,
      })),
    overdue: open
      .filter((t): t is SpaceTask & { dueOn: number } => t.dueOn !== null)
      .map((t) => ({ task: t, due: new Date(t.dueOn).toISOString().slice(0, 10) }))
      .filter(({ due }) => due <= today)
      .sort((a, b) => a.task.dueOn - b.task.dueOn || a.task.number - b.task.number)
      .slice(0, 25)
      .map(({ task, due }) => ({
        key: task.key,
        title: task.title,
        assignee: task.assignee,
        late: Math.round((dayMs(today) - dayMs(due)) / DAY_MS),
      })),
    inFlight: open
      .filter((t) => t.status === 'in_progress' && !blockedIds.has(t.id))
      .sort((a, b) => a.assignee.localeCompare(b.assignee) || a.number - b.number)
      .slice(0, 40)
      .map((t) => ({ assignee: t.assignee, key: t.key })),
    inReview: open.filter((t) => t.status === 'review').length,
    lead: lead?.name ?? null,
    updates: keyUpdates(db, projectId, windowStart(run, now), now),
  };
}

/** What changed in the window, newest first: KSage's audit-log read, from `activity`. */
function keyUpdates(db: Db, projectId: string, since: number, now: number): StandupData['updates'] {
  const rows = db
    .select({
      taskId: activity.taskId,
      type: activity.type,
      payloadJson: activity.payloadJson,
      actorId: activity.actorId,
      actorKind: activity.actorKind,
    })
    .from(activity)
    .where(
      and(
        eq(activity.projectId, projectId),
        isNotNull(activity.taskId),
        inArray(activity.type, [
          'task.created',
          'task.status_changed',
          'task.dependency_added',
          'task.dependency_removed',
          'task.stale_flagged',
        ]),
        gte(activity.createdAt, since),
        lt(activity.createdAt, now + 1),
      ),
    )
    .orderBy(desc(activity.createdAt))
    .limit(UPDATES_FETCHED)
    .all();

  return rows.map((row) => {
    const task = row.taskId === null ? null : taskFacts(db, row.taskId);
    const raw = readPayload(row);
    const payload = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    let change: string;
    switch (row.type) {
      case 'task.created':
        change = 'raised';
        break;
      case 'task.status_changed': {
        const from = field(payload, 'from_status_name') ?? categoryWords(payload.from);
        const to = field(payload, 'to_status_name') ?? categoryWords(payload.to);
        change = `${from} → ${to}`;
        break;
      }
      case 'task.dependency_added':
        change = 'blocked';
        break;
      case 'task.dependency_removed':
        change = 'a blocker removed';
        break;
      default:
        change = 'flagged stale';
    }
    return {
      key: task?.key ?? '—',
      title: task?.title ?? '(deleted)',
      change,
      who: actorName(db, row),
    };
  });
}

/** What the nightly digest for one space reads — KSage's three queries, for one SAST day. */
export function digestData(db: Db, projectId: string, day: string): DigestData {
  const all = spaceTasks(db, projectId);
  const open = all.filter((t) => OPEN(t.status));
  const from = sastMidnight(day);
  return {
    moved: all
      .filter((t) => t.updatedAt >= from && t.updatedAt < from + DAY_MS)
      .slice(0, 25)
      .map((t) => ({ key: t.key, title: t.title, status: t.statusName })),
    blocked: blockedOf(db, projectId, open)
      .slice(0, 25)
      .map((b) => ({ key: b.task.key, waitingOn: b.waitingOn })),
    inReview: open.filter((t) => t.status === 'review').length,
  };
}
