import { and, asc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
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
 * - **A time, not `rowid`.** `activity` has a text key, so a VACUUM may renumber
 *   its rowids, and a stored rowid would then skip rows. The watermark is the
 *   newest `created_at` handled, and every run re-reads two minutes before it.
 * - **Every effect is idempotent**, so the re-read costs nothing: an instant
 *   mail is keyed by what it is about (`assignment:<activity>`,
 *   `mention:<comment>:<person>`), and a digest item is unique per person.
 * - **The first run starts at "now".** History is never mailed.
 *
 * ## The switch first
 *
 * While the organisation's switch is off, an instant mail is still written —
 * `suppressed` / `email_off`, the audit LAI-1312 promised — but **no digest
 * collects**: nothing piles up to flood people the morning it is turned on.
 */

const SYSTEM = systemPrincipal();

/** How far before the watermark each run reads again. */
export const NOTIFY_OVERLAP_MS = 2 * 60 * 1000;
/** Rows read from each source a run; the next run carries on from the watermark. */
export const NOTIFY_BATCH = 2000;
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
  /** Instant mails written to the outbox, queued or suppressed. */
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

  const activityFrom = readWatermark(db, 'activity', now);
  if (activityFrom !== null) {
    const rows = db
      .select({
        id: activity.id,
        type: activity.type,
        taskId: activity.taskId,
        projectId: activity.projectId,
        actorId: activity.actorId,
        payloadJson: activity.payloadJson,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .where(
        and(
          gte(activity.createdAt, activityFrom - NOTIFY_OVERLAP_MS),
          lte(activity.createdAt, now),
        ),
      )
      .orderBy(asc(activity.createdAt), asc(activity.id))
      .limit(NOTIFY_BATCH)
      .all();
    for (const row of rows) run.activityRow(row, result);
    writeWatermark(db, 'activity', Math.max(activityFrom, rows.at(-1)?.createdAt ?? 0), now);
  }

  const noticesFrom = readWatermark(db, 'member_notices', now);
  if (noticesFrom !== null) {
    const rows = db
      .select({
        id: memberNotices.id,
        userId: memberNotices.userId,
        createdAt: memberNotices.createdAt,
      })
      .from(memberNotices)
      .where(
        and(
          gte(memberNotices.createdAt, noticesFrom - NOTIFY_OVERLAP_MS),
          lte(memberNotices.createdAt, now),
        ),
      )
      .orderBy(asc(memberNotices.createdAt), asc(memberNotices.id))
      .limit(NOTIFY_BATCH)
      .all();
    for (const row of rows) {
      if (run.collect(row.userId, { noticeId: row.id }, row.createdAt)) result.collected += 1;
    }
    writeWatermark(db, 'member_notices', Math.max(noticesFrom, rows.at(-1)?.createdAt ?? 0), now);
  }

  result.digests += closeDueDigests(db, serverSecret, run, now);
  return result;
}

/** The newest `created_at` handled, or null on the first run — which records `now` and reads nothing. */
function readWatermark(db: Db, source: string, now: number): number | null {
  const row = db.select().from(emailWatermarks).where(eq(emailWatermarks.source, source)).get();
  if (row !== undefined) return row.readTo;
  db.insert(emailWatermarks).values({ source, readTo: now, updatedAt: now }).run();
  return null;
}

function writeWatermark(db: Db, source: string, readTo: number, now: number): void {
  db.update(emailWatermarks)
    .set({ readTo, updatedAt: now })
    .where(eq(emailWatermarks.source, source))
    .run();
}

/** One run's lookups, cached: a task, a person and their switches are each read once. */
class Run {
  private readonly tasks = new Map<string, TaskInfo | null>();
  private readonly people = new Map<string, Person | null>();
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
    const told = new Set<string>();

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
        this.instant('assignment', `assignment:${row.id}`, to, task, (brand) =>
          assignmentEmail({ brand, actorName: this.name(row.actorId), task: task.ref }),
        );
        result.instant += 1;
        told.add(to);
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
            this.instant('mention', `mention:${commentId}:${userId}`, userId, task, (brand) =>
              mentionEmail({
                brand,
                actorName: this.name(row.actorId),
                task: task.ref,
                excerpt: excerpt(comment.bodyMd),
              }),
            );
            result.instant += 1;
            told.add(userId);
          }
        }
      }
    }

    if (!DIGEST_VERBS.has(row.type) || !this.switchOn) return;
    if (row.type === 'task.updated' && payload.field === 'claim') return;
    for (const userId of watcherIdsOfTask(this.db, task.id, task.projectId)) {
      if (userId === row.actorId || told.has(userId)) continue;
      if (this.collect(userId, { activityId: row.id }, row.createdAt)) result.collected += 1;
    }
  }

  /**
   * Write one instant mail. The outbox decides whether it goes — the switch,
   * the settings, the address — and this adds the two reasons only it knows:
   * the person turned instant mail off, or may no longer read the project.
   */
  private instant(
    kind: 'assignment' | 'mention',
    key: string,
    userId: string,
    task: TaskInfo,
    render: (brand: { product: string; orgName: string }) => RenderedEmail,
  ): void {
    const person = this.person(userId);
    if (person === null) return;
    const prefs = emailPrefsFor(this.db, [userId]).get(userId);
    const refuse =
      !person.isActive || !canRead(this.db, userId, task.projectId)
        ? ('no_access' as const)
        : prefs?.instant === false
          ? ('pref_off' as const)
          : undefined;
    queueEmail(
      this.db,
      {
        kind,
        idempotencyKey: key,
        to: person.email,
        recipientUserId: userId,
        createdBy: null,
        rendered: render(this.brand),
        refuse,
      },
      this.serverSecret,
      this.now,
    );
  }

  /** Add one thing to a person's open digest, opening it if need be. False when it was not added. */
  collect(
    userId: string,
    source: { activityId: string } | { noticeId: string },
    occurredAt: number,
  ): boolean {
    if (!this.switchOn) return false;
    if (emailPrefsFor(this.db, [userId]).get(userId)?.digest === false) return false;
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
      const prefs = emailPrefsFor(db, [digest.userId]).get(digest.userId);
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
          }),
          refuse: !person.isActive ? 'no_access' : prefs?.digest === false ? 'pref_off' : undefined,
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

  const groups = new Map<string, DigestTask>();
  const notices: string[] = [];
  for (const item of items) {
    if (item.activityId !== null) {
      const row = byId.get(item.activityId);
      if (row?.taskId == null) continue;
      const task = run.task(row.taskId);
      if (task === null || !canRead(db, userId, task.projectId)) continue;
      const line = describe(run, row.type, row.actorId, asRecord(readPayload(row)));
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
      if (notice.projectId !== null && !canRead(db, userId, notice.projectId)) continue;
      notices.push(describeNotice(db, run, notice));
    }
  }

  const tasksOut = [...groups.values()];
  if (tasksOut.length === 0 && notices.length === 0) return null;
  return { tasks: tasksOut, notices };
}

/** One activity row in a sentence, or null for one not worth a line. */
export function describe(
  run: { name: (id: string | null) => string },
  type: string,
  actorId: string | null,
  payload: Record<string, unknown>,
): string | null {
  const who = run.name(actorId);
  switch (type) {
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
      return `${who} commented`;
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
