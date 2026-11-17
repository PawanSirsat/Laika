import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm';
import { type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { type Db } from '../db/client.ts';
import { readPayload } from '../db/activity.ts';
import { newId } from '../db/ids.ts';
import {
  activity,
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
 * - **A keyset cursor, not `rowid`.** `activity` has a text key, so a VACUUM
 *   may renumber its rowids, and a stored rowid would then skip rows. The
 *   watermark is the last row handled, `(created_at, id)`, and each run reads
 *   the rows after it — so a run always moves on, however many rows share one
 *   millisecond (CHIEF's LAI-1313 review: a time alone stalled for good once a
 *   batch's worth did).
 * - **The two minutes behind it are read again**, for a row written late — a
 *   request that took its `now` before it wrote. **Every effect is
 *   idempotent**, so that costs a lookup: an instant mail is keyed by what it
 *   is about (`assignment:<activity>`, `mention:<comment>:<person>`) and is
 *   not written twice, and a digest item is unique per person.
 * - **The first run starts at "now".** History is never mailed, and an instant
 *   mail for something more than an hour old when first read — the board was
 *   down, or the job was — is recorded `too_old` rather than sent; the digest
 *   still carries it.
 *
 * ## The switch first
 *
 * While the organisation's switch is off, an instant mail is still written —
 * `suppressed` / `email_off`, the audit LAI-1312 promised — but **no digest
 * collects**: nothing piles up to flood people the morning it is turned on.
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
    const columns = {
      id: activity.id,
      type: activity.type,
      taskId: activity.taskId,
      projectId: activity.projectId,
      actorId: activity.actorId,
      payloadJson: activity.payloadJson,
      createdAt: activity.createdAt,
    };
    const late = db
      .select(columns)
      .from(activity)
      .where(
        and(
          gte(activity.createdAt, activityMark.at - NOTIFY_OVERLAP_MS),
          atOrBefore(activity.createdAt, activity.id, activityMark),
        ),
      )
      .orderBy(desc(activity.createdAt), desc(activity.id))
      .limit(NOTIFY_BATCH)
      .all();
    const fresh = db
      .select(columns)
      .from(activity)
      .where(
        and(after(activity.createdAt, activity.id, activityMark), lte(activity.createdAt, now)),
      )
      .orderBy(asc(activity.createdAt), asc(activity.id))
      .limit(NOTIFY_BATCH)
      .all();
    for (const row of [...late.reverse(), ...fresh]) run.activityRow(row, result);
    const last = fresh.at(-1);
    if (last !== undefined) writeWatermark(db, 'activity', last.createdAt, last.id, now);
  }

  const noticesMark = readWatermark(db, 'member_notices', now);
  if (noticesMark !== null) {
    const columns = {
      id: memberNotices.id,
      userId: memberNotices.userId,
      createdAt: memberNotices.createdAt,
    };
    const late = db
      .select(columns)
      .from(memberNotices)
      .where(
        and(
          gte(memberNotices.createdAt, noticesMark.at - NOTIFY_OVERLAP_MS),
          atOrBefore(memberNotices.createdAt, memberNotices.id, noticesMark),
        ),
      )
      .orderBy(desc(memberNotices.createdAt), desc(memberNotices.id))
      .limit(NOTIFY_BATCH)
      .all();
    const fresh = db
      .select(columns)
      .from(memberNotices)
      .where(
        and(
          after(memberNotices.createdAt, memberNotices.id, noticesMark),
          lte(memberNotices.createdAt, now),
        ),
      )
      .orderBy(asc(memberNotices.createdAt), asc(memberNotices.id))
      .limit(NOTIFY_BATCH)
      .all();
    for (const row of [...late.reverse(), ...fresh]) {
      if (run.collect(row.userId, { noticeId: row.id }, row.createdAt)) result.collected += 1;
    }
    const last = fresh.at(-1);
    if (last !== undefined) writeWatermark(db, 'member_notices', last.createdAt, last.id, now);
  }

  result.digests += closeDueDigests(db, serverSecret, run, now);
  return result;
}

/** The last row handled: its `created_at` and `id`. */
interface Mark {
  at: number;
  id: string;
}

/** Rows after the cursor, in `(created_at, id)` order. */
function after(createdAt: AnySQLiteColumn, id: AnySQLiteColumn, mark: Mark): SQL | undefined {
  return or(gt(createdAt, mark.at), and(eq(createdAt, mark.at), gt(id, mark.id)));
}

/** Rows at or before the cursor. */
function atOrBefore(createdAt: AnySQLiteColumn, id: AnySQLiteColumn, mark: Mark): SQL | undefined {
  return or(lt(createdAt, mark.at), and(eq(createdAt, mark.at), lte(id, mark.id)));
}

/**
 * The cursor, or null on the first run — which records `now` and reads
 * nothing. `''` sorts before every id, so the first cursor is "everything
 * from now on".
 */
function readWatermark(db: Db, source: string, now: number): Mark | null {
  const row = db.select().from(emailWatermarks).where(eq(emailWatermarks.source, source)).get();
  if (row !== undefined) return { at: row.readTo, id: row.readToId };
  db.insert(emailWatermarks).values({ source, readTo: now, readToId: '', updatedAt: now }).run();
  return null;
}

function writeWatermark(db: Db, source: string, readTo: number, readToId: string, now: number) {
  db.update(emailWatermarks)
    .set({ readTo, readToId, updatedAt: now })
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
  reason: string | null;
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
    // this row is about but was not mailed (instant off, or too old to send):
    // they hear it in the digest instead, watching the task or not.
    const told = new Set<string>();
    const owed = new Set<string>();
    const tooOld = this.now - row.createdAt > INSTANT_LOOKBACK_MS;
    const settle = (userId: string, sent: Instant): void => {
      if (sent.inserted) result.instant += 1;
      if (sent.queued) told.add(userId);
      else if (sent.reason !== 'no_access') owed.add(userId);
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
      if (to !== null && to !== row.actorId) {
        settle(
          to,
          this.instant('assignment', `assignment:${row.id}`, to, task, tooOld, (brand) =>
            assignmentEmail({
              brand,
              actorName: this.name(row.actorId),
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
            if (userId === row.actorId) continue;
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
                    actorName: this.name(row.actorId),
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
      if (userId === row.actorId || told.has(userId)) continue;
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
      const line = describe(namer, row.type, row.actorId, payload, {
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

/** One activity row in a sentence, or null for one not worth a line. */
export function describe(
  run: { name: (id: string | null) => string },
  type: string,
  actorId: string | null,
  payload: Record<string, unknown>,
  reader: DigestReader = { assigned: false, mentioned: false },
): string | null {
  const who = run.name(actorId);
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
