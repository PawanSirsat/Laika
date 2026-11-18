import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { readPayload } from '../db/activity.ts';
import { type EmailSuppressedReason } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { requireOrgId } from '../db/orgs.ts';
import {
  activity,
  agents,
  commentMentions,
  comments,
  emailDigestItems,
  emailDigests,
  emailOutbox,
  emailWatermarks,
  memberNotices,
  projects,
  tasks,
  users,
} from '../db/schema.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { zonesFor } from './availability.ts';
import { queueEmail } from './email-outbox.ts';
import { emailPrefsFor } from './email-prefs.ts';
import { emailBrand, emailSwitch } from './email-settings.ts';
import {
  assignmentEmail,
  type DigestTask,
  digestEmail,
  mentionEmail,
  type RenderedEmail,
  type TaskRef,
} from './email-templates.ts';
import { canRead, watcherIdsOfTask } from './watchers.ts';

/**
 * A person's notification mail (§11.6, D-153, LAI-1313): instant when they are
 * assigned or @mentioned, and one digest a morning for everything else on the
 * tasks they watch. Everything goes through the LAI-1312 outbox, so the
 * organisation's switch, the settings and the send rules are its.
 *
 * ## Read from what the board already records
 *
 * No writer was taught to send mail. This reads `activity` and `member_notices`
 * — the record every write already leaves — after a stored watermark, under
 * §3.4's `system.email.notify`, every 30 seconds:
 *
 * - **A keyset cursor that never stands still.** The watermark is the last
 *   row handled, `(created_at, rowid)`, and each run reads the rows after it
 *   — so a run always moves on, however many rows share one millisecond
 *   (CHIEF's LAI-1313 review: a time alone stalled for good once a batch's
 *   worth did). The rowid only breaks a tie inside a millisecond, because the
 *   indexes the reads ride end in it: **each read is an index range in index
 *   order**, never a scan or a sort of `activity` (§4.100 says why a VACUUM's
 *   renumbering loses nothing).
 * - **The two minutes behind it are read again**, for a row written late — a
 *   request that took its `now` before it wrote. **Every effect is
 *   idempotent**, so that costs a lookup: an instant mail is keyed by what it
 *   is about (`assignment:<activity>`, `mention:<comment>:<person>`) and is
 *   not written twice, and a digest item is unique per person.
 * - **The first run starts at "now".** History is never mailed — not even the
 *   two minutes before it: the first cursor has no row behind it, so nothing
 *   is looked behind until a row has been read. An instant mail for something
 *   more than an hour old when first read — the board was down, or the job
 *   was — is recorded `too_old` rather than sent; the digest still carries it.
 *
 * ## The switch first
 *
 * While the organisation's switch is off, an instant mail is still written —
 * `suppressed` / `email_off`, the audit LAI-1312 promised — but **no digest
 * collects**: nothing piles up to flood people the morning it is turned on.
 * So the reads go on while it is off; they cost an index range over what was
 * written since the last run, the same as when it is on.
 */

const SYSTEM = systemPrincipal();

/** How far behind the cursor each run reads again, for rows written late. */
export const NOTIFY_OVERLAP_MS = 2 * 60 * 1000;
/**
 * Rows read after the cursor from each source a run, and at most as many again
 * from behind it; the next run carries on from the last row read.
 */
export const NOTIFY_BATCH = 2000;
/** Older than this when first read, an instant mail is recorded `too_old`, not sent. */
export const INSTANT_LOOKBACK_MS = 60 * 60 * 1000;
/** The local hour a person's digest goes at, in their own zone. */
export const DIGEST_LOCAL_HOUR = 7;
/** Items older than this are left out of a digest. */
export const DIGEST_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Closed digests, and their items, are deleted this long after they closed. */
export const DIGEST_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** The longest comment excerpt a mail quotes. */
const EXCERPT_CHARS = 400;

/** What goes in a digest. Status, assignment, edits, comments, files and staleness — not claims, heartbeats or hand-offs. */
export const DIGEST_VERBS: ReadonlySet<string> = new Set([
  'task.status_changed',
  'task.assigned',
  'task.updated',
  'comment.added',
  'attachment.added',
  'task.stale_flagged',
]);

export interface NotifyResult {
  /** Instant mails this run wrote to the outbox, queued or suppressed — none for a re-read. */
  instant: number;
  /** Digest items collected. */
  collected: number;
  /** Digests closed: sent or found empty. */
  digests: number;
}

/** Everything one run needs to know about a task, read once. */
interface TaskInfo {
  id: string;
  projectId: string;
  ref: TaskRef;
  assigneeId: string | null;
}

interface Person {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

/** One run. Pure DB work — the outbox's own job sends. */
export function notifyEmail(
  db: Db,
  serverSecret: string,
  publicUrl: string,
  now: number,
): NotifyResult {
  assertCan(SYSTEM, 'system.email.notify');
  const result: NotifyResult = { instant: 0, collected: 0, digests: 0 };
  const run = new Run(db, serverSecret, publicUrl.replace(/\/+$/, ''), now);

  const activityMark = readWatermark(db, 'activity', now);
  if (activityMark !== null) {
    const reads = activityReads(db, requireOrgId(db), activityMark, now);
    const late = reads.late?.all() ?? [];
    const fresh = reads.fresh.all();
    for (const row of [...late.reverse(), ...fresh]) run.activityRow(row, result);
    const last = fresh.at(-1);
    if (last !== undefined) writeWatermark(db, 'activity', last, now);
  }

  const noticesMark = readWatermark(db, 'member_notices', now);
  if (noticesMark !== null) {
    const reads = noticeReads(db, noticesMark, now);
    const late = reads.late?.all() ?? [];
    const fresh = reads.fresh.all();
    for (const row of [...late.reverse(), ...fresh]) {
      if (run.collect(row.userId, { noticeId: row.id }, row.createdAt)) result.collected += 1;
    }
    const last = fresh.at(-1);
    if (last !== undefined) writeWatermark(db, 'member_notices', last, now);
  }

  result.digests += closeDueDigests(db, serverSecret, run, now);
  return result;
}

/**
 * The last row handled: its `created_at`, and its rowid to break a tie inside
 * one millisecond. Rowid 0 is the first run's cursor — "now", no row yet.
 */
export interface NotifyMark {
  at: number;
  rowid: number;
}

/**
 * The rowid: the last column of every SQLite index, so ordering by
 * `(created_at, rowid)` is the order the `created_at` indexes already hold —
 * an `id` tiebreak made SQLite sort what it read (CHIEF's LAI-1313 review).
 */
const ROWID = sql<number>`rowid`;

/**
 * The two reads of `activity` a run makes — built here, run by
 * {@link notifyEmail}, and EXPLAINed by its tests. **Every read names the
 * organisation**, so it is a range on `activity_org_created_at_idx`
 * `(org_id, created_at)`, in that index's order, never a scan of the board's
 * largest table: `fresh`, up to a batch after the cursor; `late`, up to a
 * batch from the two minutes behind it, for rows written late — none while
 * the cursor is still the first run's "now", which has nothing behind it.
 */
export function activityReads(db: Db, orgId: string, mark: NotifyMark, now: number) {
  const columns = {
    id: activity.id,
    type: activity.type,
    taskId: activity.taskId,
    projectId: activity.projectId,
    actorId: activity.actorId,
    actorKind: activity.actorKind,
    agentId: activity.agentId,
    payloadJson: activity.payloadJson,
    createdAt: activity.createdAt,
    rowid: ROWID,
  };
  const late =
    mark.rowid === 0
      ? null
      : db
          .select(columns)
          .from(activity)
          .where(
            and(
              eq(activity.orgId, orgId),
              gte(activity.createdAt, mark.at - NOTIFY_OVERLAP_MS),
              lte(activity.createdAt, mark.at),
              or(lt(activity.createdAt, mark.at), lte(ROWID, mark.rowid)),
            ),
          )
          .orderBy(desc(activity.createdAt), desc(ROWID))
          .limit(NOTIFY_BATCH);
  const fresh = db
    .select(columns)
    .from(activity)
    .where(
      and(
        eq(activity.orgId, orgId),
        gte(activity.createdAt, mark.at),
        lte(activity.createdAt, now),
        or(gt(activity.createdAt, mark.at), gt(ROWID, mark.rowid)),
      ),
    )
    .orderBy(asc(activity.createdAt), asc(ROWID))
    .limit(NOTIFY_BATCH);
  return { late, fresh };
}

/** The same two reads of `member_notices`, on `member_notices_created_at_idx`. */
export function noticeReads(db: Db, mark: NotifyMark, now: number) {
  const columns = {
    id: memberNotices.id,
    userId: memberNotices.userId,
    createdAt: memberNotices.createdAt,
    rowid: ROWID,
  };
  const late =
    mark.rowid === 0
      ? null
      : db
          .select(columns)
          .from(memberNotices)
          .where(
            and(
              gte(memberNotices.createdAt, mark.at - NOTIFY_OVERLAP_MS),
              lte(memberNotices.createdAt, mark.at),
              or(lt(memberNotices.createdAt, mark.at), lte(ROWID, mark.rowid)),
            ),
          )
          .orderBy(desc(memberNotices.createdAt), desc(ROWID))
          .limit(NOTIFY_BATCH);
  const fresh = db
    .select(columns)
    .from(memberNotices)
    .where(
      and(
        gte(memberNotices.createdAt, mark.at),
        lte(memberNotices.createdAt, now),
        or(gt(memberNotices.createdAt, mark.at), gt(ROWID, mark.rowid)),
      ),
    )
    .orderBy(asc(memberNotices.createdAt), asc(ROWID))
    .limit(NOTIFY_BATCH);
  return { late, fresh };
}

/** The cursor, or null on the first run — which records `now`, rowid 0, and reads nothing. */
function readWatermark(db: Db, source: string, now: number): NotifyMark | null {
  const row = db.select().from(emailWatermarks).where(eq(emailWatermarks.source, source)).get();
  if (row !== undefined) return { at: row.readTo, rowid: row.readToRowid };
  db.insert(emailWatermarks).values({ source, readTo: now, readToRowid: 0, updatedAt: now }).run();
  return null;
}

function writeWatermark(
  db: Db,
  source: string,
  last: { createdAt: number; rowid: number },
  now: number,
): void {
  db.update(emailWatermarks)
    .set({ readTo: last.createdAt, readToRowid: last.rowid, updatedAt: now })
    .where(eq(emailWatermarks.source, source))
    .run();
}

/** What became of one instant mail. */
interface Instant {
  /** This call wrote the row; false when it was there already (a re-read) or nobody to write it for. */
  inserted: boolean;
  /** The mail is queued, going or gone — the person is told, so the digest leaves it out. */
  queued: boolean;
  /** Why not, when it is not queued. */
  reason: EmailSuppressedReason | null;
}

/**
 * One run's lookups, cached: a task, a person, their switches, a task's
 * watchers and whether a person may read a space are each asked once a run
 * (CHIEF's LAI-1313 review). A run is one synchronous pass over the database,
 * so nothing it cached can change under it.
 */
class Run {
  private readonly tasks = new Map<string, TaskInfo | null>();
  private readonly people = new Map<string, Person | null>();
  private readonly prefs = new Map<string, { instant: boolean; digest: boolean }>();
  private readonly watchers = new Map<string, string[]>();
  private readonly reads = new Map<string, boolean>();
  private readonly agents = new Map<string, string | null>();
  readonly switchOn: boolean;
  readonly brand: { product: string; orgName: string };

  constructor(
    readonly db: Db,
    readonly serverSecret: string,
    readonly publicUrl: string,
    readonly now: number,
  ) {
    this.switchOn = emailSwitch(db).enabled;
    this.brand = emailBrand(db);
  }

  task(id: string): TaskInfo | null {
    if (!this.tasks.has(id)) this.tasks.set(id, readTask(this.db, id, this.publicUrl));
    return this.tasks.get(id) ?? null;
  }

  person(id: string): Person | null {
    if (!this.people.has(id)) {
      const row = this.db
        .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, id))
        .get();
      this.people.set(id, row === undefined ? null : { ...row, isActive: row.isActive === 1 });
    }
    return this.people.get(id) ?? null;
  }

  name(id: string | null): string {
    if (id === null) return 'Laika';
    return this.person(id)?.name ?? 'Someone';
  }

  /**
   * Who did it, as a mail says it (LAI-1341, the owner's decision): a person
   * by their name, and **an agent as its owner's, never as its owner** —
   * `Ada's agent`, or `<the agent's display name> (Ada's agent)` when the row
   * names a registered agent. A token acts as its owner, so `actor_id` is the
   * owner either way; `actor_kind` is what tells the two apart.
   */
  actorName(row: { actorId: string | null; actorKind: string; agentId: string | null }): string {
    if (row.actorKind !== 'agent') return this.name(row.actorId);
    const owner = `${this.name(row.actorId)}'s agent`;
    if (row.agentId === null) return owner;
    let display = this.agents.get(row.agentId);
    if (display === undefined) {
      display =
        this.db
          .select({ displayName: agents.displayName })
          .from(agents)
          .where(eq(agents.id, row.agentId))
          .get()?.displayName ?? null;
      this.agents.set(row.agentId, display);
    }
    return display === null ? owner : `${display} (${owner})`;
  }

  /** The person's own switches (§4.97): both on with no row. */
  prefsOf(userId: string): { instant: boolean; digest: boolean } {
    let prefs = this.prefs.get(userId);
    if (prefs === undefined) {
      prefs = emailPrefsFor(this.db, [userId]).get(userId) ?? { instant: true, digest: true };
      this.prefs.set(userId, prefs);
    }
    return prefs;
  }

  /** Whether the person may read the space — on their own authority, as `canRead` asks it. */
  canRead(userId: string, projectId: string): boolean {
    const key = `${userId} ${projectId}`;
    let reads = this.reads.get(key);
    if (reads === undefined) {
      reads = canRead(this.db, userId, projectId);
      this.reads.set(key, reads);
    }
    return reads;
  }

  watchersOf(task: TaskInfo): string[] {
    let ids = this.watchers.get(task.id);
    if (ids === undefined) {
      ids = watcherIdsOfTask(this.db, task.id, task.projectId);
      this.watchers.set(task.id, ids);
    }
    return ids;
  }

  /** Where a person changes what Laika emails them: their own profile. */
  prefsUrl(userId: string): string | null {
    return this.publicUrl === ''
      ? null
      : `${this.publicUrl}/people?user=${encodeURIComponent(userId)}`;
  }

  /** One `activity` row: the instant mails it causes, then the digest items. */
  activityRow(
    row: {
      id: string;
      type: string;
      taskId: string | null;
      projectId: string | null;
      actorId: string | null;
      actorKind: string;
      agentId: string | null;
      payloadJson: string;
      createdAt: number;
    },
    result: NotifyResult,
  ): void {
    if (row.taskId === null) return;
    const task = this.task(row.taskId);
    if (task === null) return;
    const payload = asRecord(readPayload(row));
    // Who was mailed at once, and so is not told again in the digest — and who
    // this row is about but was not mailed because their instant mail is off
    // or it was too old to send (§4.99): they hear it in the digest instead,
    // watching the task or not. Any other reason — no access, email off or not
    // set up — owes them nothing.
    const told = new Set<string>();
    const owed = new Set<string>();
    const tooOld = this.now - row.createdAt > INSTANT_LOOKBACK_MS;
    // Nobody is told what they did themselves — **in person**. What their
    // agent did on their behalf they are told, as their agent's (LAI-1341).
    const ownDoing = (userId: string): boolean =>
      row.actorKind !== 'agent' && userId === row.actorId;
    const actorName = this.actorName(row);
    const settle = (userId: string, sent: Instant): void => {
      if (sent.inserted) result.instant += 1;
      if (sent.queued) told.add(userId);
      else if (sent.reason === 'pref_off' || sent.reason === 'too_old') owed.add(userId);
    };

    if (row.type === 'task.assigned' || row.type === 'task.created') {
      // A task created with an assignee writes no `task.assigned` (LAI-1313
      // exploration), so the creation row stands for it — unless the assignee
      // has changed since, by a reassignment or a claim, when those rows speak
      // and the task's assignee now is not the one it was created with.
      const to =
        row.type === 'task.assigned'
          ? stringOf(payload.to)
          : assigneeChangedSince(this.db, task.id)
            ? null
            : task.assigneeId;
      if (to !== null && !ownDoing(to)) {
        settle(
          to,
          this.instant('assignment', `assignment:${row.id}`, to, task, tooOld, (brand) =>
            assignmentEmail({
              brand,
              actorName,
              task: task.ref,
              prefsUrl: this.prefsUrl(to),
            }),
          ),
        );
      }
    }

    if (row.type === 'comment.added' || row.type === 'comment.edited') {
      const commentId = stringOf(payload.comment_id);
      if (commentId !== null) {
        const comment = this.db
          .select({ bodyMd: comments.bodyMd, deletedAt: comments.deletedAt })
          .from(comments)
          .where(eq(comments.id, commentId))
          .get();
        if (comment?.deletedAt === null) {
          for (const { userId } of this.db
            .select({ userId: commentMentions.userId })
            .from(commentMentions)
            .where(eq(commentMentions.commentId, commentId))
            .all()) {
            if (ownDoing(userId)) continue;
            settle(
              userId,
              this.instant(
                'mention',
                `mention:${commentId}:${userId}`,
                userId,
                task,
                tooOld,
                (brand) =>
                  mentionEmail({
                    brand,
                    actorName,
                    task: task.ref,
                    excerpt: excerpt(comment.bodyMd),
                    prefsUrl: this.prefsUrl(userId),
                  }),
              ),
            );
          }
        }
      }
    }

    if (!this.switchOn) return;
    const news =
      DIGEST_VERBS.has(row.type) && !(row.type === 'task.updated' && payload.field === 'claim');
    const readers = new Set([...(news ? this.watchersOf(task) : []), ...owed]);
    for (const userId of readers) {
      if (ownDoing(userId) || told.has(userId)) continue;
      if (this.collect(userId, { activityId: row.id }, row.createdAt)) result.collected += 1;
    }
  }

  /**
   * Write one instant mail, once. The outbox decides whether it goes — the
   * switch, the settings, the address — and this adds the reasons only it
   * knows: the person may no longer read the space, turned instant mail off,
   * or it happened too long ago to be news. A key already in the outbox is a
   * re-read: nothing is rendered or written, and what the row says stands.
   */
  private instant(
    kind: 'assignment' | 'mention',
    key: string,
    userId: string,
    task: TaskInfo,
    tooOld: boolean,
    render: (brand: { product: string; orgName: string }) => RenderedEmail,
  ): Instant {
    const existing = this.db
      .select({ state: emailOutbox.state, reason: emailOutbox.suppressedReason })
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, key))
      .get();
    if (existing !== undefined) {
      return {
        inserted: false,
        queued: existing.state !== 'suppressed',
        reason: existing.reason,
      };
    }
    const person = this.person(userId);
    if (person === null) return { inserted: false, queued: false, reason: 'no_access' };
    const refuse =
      !person.isActive || !this.canRead(userId, task.projectId)
        ? ('no_access' as const)
        : !this.prefsOf(userId).instant
          ? ('pref_off' as const)
          : tooOld
            ? ('too_old' as const)
            : undefined;
    const view = queueEmail(
      this.db,
      {
        kind,
        idempotencyKey: key,
        to: person.email,
        recipientUserId: userId,
        createdBy: null,
        rendered: render(this.brand),
        refuse,
        taskId: task.id,
      },
      this.serverSecret,
      this.now,
    );
    return { inserted: true, queued: view.queued, reason: view.reason };
  }

  /**
   * Add one thing to a person's open digest, opening it if need be. False when
   * it was not added — the switch is off, their digest is off, or it is in one
   * of their digests already (a re-read), which opens nothing.
   */
  collect(
    userId: string,
    source: { activityId: string } | { noticeId: string },
    occurredAt: number,
  ): boolean {
    if (!this.switchOn) return false;
    if (!this.prefsOf(userId).digest) return false;
    const already = this.db
      .select({ id: emailDigestItems.id })
      .from(emailDigestItems)
      .where(
        and(
          eq(emailDigestItems.userId, userId),
          'activityId' in source
            ? eq(emailDigestItems.activityId, source.activityId)
            : eq(emailDigestItems.noticeId, source.noticeId),
        ),
      )
      .get();
    if (already !== undefined) return false;
    const digestId = openDigestFor(this.db, userId, this.now);
    const inserted = this.db
      .insert(emailDigestItems)
      .values({
        id: newId(),
        digestId,
        userId,
        activityId: 'activityId' in source ? source.activityId : null,
        noticeId: 'noticeId' in source ? source.noticeId : null,
        occurredAt,
        createdAt: this.now,
      })
      .onConflictDoNothing()
      .run();
    return inserted.changes > 0;
  }
}

/** The person's one open digest, made if they have none. The partial unique index keeps it one. */
function openDigestFor(db: Db, userId: string, now: number): string {
  const open = db
    .select({ id: emailDigests.id })
    .from(emailDigests)
    .where(and(eq(emailDigests.userId, userId), eq(emailDigests.state, 'open')))
    .get();
  if (open !== undefined) return open.id;
  const id = newId();
  db.insert(emailDigests).values({ id, userId, state: 'open', openedAt: now }).run();
  return id;
}

function readTask(db: Db, id: string, publicUrl: string): TaskInfo | null {
  const row = db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
      projectId: tasks.projectId,
      prefix: projects.prefix,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, id))
    .get();
  if (row === undefined) return null;
  const key = `${row.prefix}-${String(row.number)}`;
  return {
    id: row.id,
    projectId: row.projectId,
    assigneeId: row.assigneeId,
    ref: {
      key,
      title: row.title,
      projectName: row.projectName,
      url: publicUrl === '' ? null : `${publicUrl}/task/${encodeURIComponent(key)}`,
    },
  };
}

/** The comment as a mail quotes it: trimmed, and cut at a word near the limit. */
export function excerpt(bodyMd: string): string {
  const text = bodyMd.replace(/\r\n/g, '\n').trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The person's local hour now, and the instant their local 07:00 began today.
 * The offset is taken from `now`, which is exact except across a DST change in
 * the small hours — a digest that day goes an hour early or late.
 */
export function localMorning(now: number, zone: string): { hour: number; morning: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  const offset = asUtc - (now - (now % 1000));
  const morning =
    Date.UTC(part('year'), part('month') - 1, part('day'), DIGEST_LOCAL_HOUR, 0, 0) - offset;
  return { hour: part('hour'), morning };
}

/**
 * Close every open digest whose morning has come: at or after 07:00 in the
 * person's own zone, opened before that morning. Its items from the last seven
 * days that the person may still read become one message; none, and it closes
 * without one.
 */
function closeDueDigests(db: Db, serverSecret: string, run: Run, now: number): number {
  const open = db
    .select({ id: emailDigests.id, userId: emailDigests.userId, openedAt: emailDigests.openedAt })
    .from(emailDigests)
    .where(eq(emailDigests.state, 'open'))
    .all();
  if (open.length === 0) return 0;
  const zones = zonesFor(
    db,
    open.map((d) => d.userId),
  );

  let closed = 0;
  for (const digest of open) {
    const { hour, morning } = localMorning(now, zones.get(digest.userId) ?? 'UTC');
    if (hour < DIGEST_LOCAL_HOUR || digest.openedAt >= morning) continue;

    const person = run.person(digest.userId);
    const content = person === null ? null : digestContent(db, run, digest.id, digest.userId, now);
    let outboxId: string | null = null;
    if (person !== null && content !== null) {
      const key = `digest:${digest.id}`;
      queueEmail(
        db,
        {
          kind: 'digest',
          idempotencyKey: key,
          to: person.email,
          recipientUserId: person.id,
          createdBy: null,
          rendered: digestEmail({
            brand: run.brand,
            userName: person.name,
            tasks: content.tasks,
            notices: content.notices,
            prefsUrl: run.prefsUrl(person.id),
          }),
          refuse: !person.isActive
            ? 'no_access'
            : !run.prefsOf(person.id).digest
              ? 'pref_off'
              : undefined,
        },
        serverSecret,
        now,
      );
      outboxId =
        db
          .select({ id: emailOutbox.id })
          .from(emailOutbox)
          .where(eq(emailOutbox.idempotencyKey, key))
          .get()?.id ?? null;
    }
    db.update(emailDigests)
      .set({ state: 'closed', closedAt: now, outboxId })
      .where(eq(emailDigests.id, digest.id))
      .run();
    closed += 1;
  }
  return closed;
}

/** A digest's items as words, grouped by task — or null when nothing is left to say. */
function digestContent(
  db: Db,
  run: Run,
  digestId: string,
  userId: string,
  now: number,
): { tasks: DigestTask[]; notices: string[] } | null {
  const items = db
    .select()
    .from(emailDigestItems)
    .where(
      and(
        eq(emailDigestItems.digestId, digestId),
        gte(emailDigestItems.occurredAt, now - DIGEST_HORIZON_MS),
      ),
    )
    .orderBy(asc(emailDigestItems.occurredAt), asc(emailDigestItems.id))
    .all();

  const activityIds = items.flatMap((i) => (i.activityId === null ? [] : [i.activityId]));
  const rows =
    activityIds.length === 0
      ? []
      : db.select().from(activity).where(inArray(activity.id, activityIds)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));

  // The reader is "you" in their own digest: "Ada assigned it to you".
  const namer = { name: (id: string | null) => (id === userId ? 'you' : run.name(id)) };
  const groups = new Map<string, DigestTask>();
  const notices: string[] = [];
  for (const item of items) {
    if (item.activityId !== null) {
      const row = byId.get(item.activityId);
      if (row?.taskId == null) continue;
      const task = run.task(row.taskId);
      if (task === null || !run.canRead(userId, task.projectId)) continue;
      const payload = asRecord(readPayload(row));
      const line = describe(namer, row.type, run.actorName(row), payload, {
        assigned: task.assigneeId === userId,
        mentioned: mentions(db, stringOf(payload.comment_id), userId),
      });
      if (line === null) continue;
      const group = groups.get(task.id) ?? { task: task.ref, lines: [] };
      group.lines.push(line);
      groups.set(task.id, group);
    } else if (item.noticeId !== null) {
      const notice = db
        .select()
        .from(memberNotices)
        .where(eq(memberNotices.id, item.noticeId))
        .get();
      if (notice === undefined) continue;
      if (notice.projectId !== null && !run.canRead(userId, notice.projectId)) continue;
      notices.push(describeNotice(db, run, notice));
    }
  }

  const tasksOut = [...groups.values()];
  if (tasksOut.length === 0 && notices.length === 0) return null;
  return { tasks: tasksOut, notices };
}

/** Whether a comment @mentions this person. */
function mentions(db: Db, commentId: string | null, userId: string): boolean {
  if (commentId === null) return false;
  return (
    db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(and(eq(commentMentions.commentId, commentId), eq(commentMentions.userId, userId)))
      .get() !== undefined
  );
}

/** What a line needs to know about who reads it. */
export interface DigestReader {
  /** The task is theirs now. */
  assigned: boolean;
  /** The comment the row is about @mentions them. */
  mentioned: boolean;
}

/**
 * One activity row in a sentence, or null for one not worth a line. `who` is
 * the actor as {@link Run.actorName} says it; `run.name` names anybody else
 * the row mentions — the reader as "you".
 */
export function describe(
  run: { name: (id: string | null) => string },
  type: string,
  who: string,
  payload: Record<string, unknown>,
  reader: DigestReader = { assigned: false, mentioned: false },
): string | null {
  switch (type) {
    case 'task.created':
      return reader.assigned ? `${who} created it and assigned it to you` : `${who} created it`;
    case 'task.status_changed': {
      const to = stringOf(payload.to_status_name) ?? stringOf(payload.to);
      return to === null ? `${who} changed its status` : `${who} moved it to ${to}`;
    }
    case 'task.assigned': {
      const to = stringOf(payload.to);
      return to === null ? `${who} unassigned it` : `${who} assigned it to ${run.name(to)}`;
    }
    case 'task.updated': {
      if (payload.field === 'claim') return null;
      if (payload.field === 'deliverables') return `${who} ticked off what it ships`;
      if (typeof payload.field === 'string') return `${who} changed its ${humanise(payload.field)}`;
      const changed = Array.isArray(payload.changed)
        ? payload.changed.filter((f): f is string => typeof f === 'string').map(humanise)
        : [];
      return changed.length === 0 ? `${who} edited it` : `${who} changed its ${changed.join(', ')}`;
    }
    case 'comment.added':
      return reader.mentioned ? `${who} mentioned you in a comment` : `${who} commented`;
    case 'comment.edited':
      return reader.mentioned ? `${who} mentioned you in a comment` : null;
    case 'attachment.added': {
      const name = stringOf(payload.filename);
      return name === null ? `${who} attached a file` : `${who} attached ${name}`;
    }
    case 'task.stale_flagged':
      return 'Flagged stale: no work seen on it for three days';
    default:
      return null;
  }
}

/** `due_on` → `due date`, `acceptance_md` → `acceptance`: a field as a person says it. */
function humanise(field: string): string {
  const named: Record<string, string> = {
    due_on: 'due date',
    acceptance_md: 'acceptance',
    description_md: 'description',
    sprint_id: 'sprint',
    parent_task_id: 'parent',
  };
  return named[field] ?? field.replace(/_/g, ' ');
}

/** One member notice in a sentence (§4.87). */
function describeNotice(db: Db, run: Run, notice: typeof memberNotices.$inferSelect): string {
  const who = run.name(notice.actorUserId);
  const subject = notice.subject ?? '';
  switch (notice.kind) {
    case 'added_to_space': {
      const project =
        notice.projectId === null
          ? undefined
          : db
              .select({ name: projects.name })
              .from(projects)
              .where(eq(projects.id, notice.projectId))
              .get();
      const where = project?.name ?? 'a space';
      return notice.message === null
        ? `${who} added you to ${where}`
        : `${who} added you to ${where}: "${notice.message}"`;
    }
    case 'token_revoked':
      return `${who} revoked your token ${subject}`.trim();
    case 'tool_revoked':
      return `${who} revoked ${subject === '' ? 'a tool of yours' : subject}`;
    case 'device_unpaired':
      return `${who} unpaired your device ${subject}`.trim();
    case 'time_changed':
      return `${who} changed your logged time${subject === '' ? '' : ` (${subject})`}`;
    default:
      return `${who} did something that concerns you`;
  }
}

/** Closed digests 90 days after they closed, their items with them (§11.6). Under `system.email.prune`. */
export function pruneEmailDigests(db: Db, now: number): number {
  assertCan(SYSTEM, 'system.email.prune');
  return db
    .delete(emailDigests)
    .where(
      and(eq(emailDigests.state, 'closed'), lt(emailDigests.closedAt, now - DIGEST_RETENTION_MS)),
    )
    .run().changes;
}

/**
 * Whether anything has set the task's assignee since it was created: a
 * `task.assigned` row, or a claim's `task.status_changed`, which carries
 * `assignee_id` when a person takes the task for themselves.
 */
function assigneeChangedSince(db: Db, taskId: string): boolean {
  return db
    .select({ type: activity.type, payloadJson: activity.payloadJson })
    .from(activity)
    .where(
      and(
        eq(activity.taskId, taskId),
        inArray(activity.type, ['task.assigned', 'task.status_changed']),
      ),
    )
    .all()
    .some((row) => row.type === 'task.assigned' || 'assignee_id' in asRecord(readPayload(row)));
}
