import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type TimeDraftSource } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { projects, tasks, timeDrafts, timeEntries } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addDays, dayIn, isTimeZone } from './calendar-days.ts';
import { assertReportDays, latestReportZone } from './local-activity.ts';
import { resolveKeys } from './token-usage.ts';
import {
  entryById,
  insertEntry,
  projectRefOf,
  type ProjectRef,
  resolveTarget,
  type Target,
  type TaskRef,
  taskRefOf,
  type TimeEntryView,
  type Tx,
} from './time-entries.ts';
import { assertDrafting, assertTimeOn } from './time-settings.ts';

/**
 * Drafted time (D-088 items 3, 4, 11 and 13, SPEC §4.47, LAI-787): blocks a
 * person's own collector drafted on their machine, and entries an agent
 * proposed. **The person's, and nobody else's**: sending is a collector's or an
 * agent's (`time_drafts.send_own`, any `full` token of theirs), and reading,
 * editing and confirming are the person's on a web session
 * (`time_drafts.read_own`, `time_drafts.manage_own`) — there is no admin read
 * and no token reads a draft. Both switches are asked on every send.
 *
 * ## What a block carries
 *
 * Start, end, the local day and zone, the minutes, a task key or none, and
 * the **counts** of the signals behind it — prompts, replies, sessions,
 * commits, task claims. Nothing else can be sent: the body is a closed schema
 * of numbers, a zone and a key-shaped string, and the table has no column that
 * could hold a prompt, a path, a repository or a branch.
 *
 * ## An upload replaces, and is clipped around what is settled
 *
 * A collector's upload replaces **its own pending** blocks for each day it
 * carries — a retry changes nothing, and a block that grew since the last sync
 * is sent whole again. Each new block is then **clipped to the parts outside**
 * every span already settled that day: the person's live entries (time they
 * confirmed), drafts they dismissed, drafts they edited or split (held for
 * them), and another machine's blocks (so two machines working at once are a
 * union, not a sum). Its minutes shrink by the share of its span clipped. So a
 * confirmed or dismissed block never comes back, and a person's edit is never
 * overwritten by the next sync.
 */

/** A collector may report this many days back, as a snapshot can (§6.4). */
export const DRAFT_DAYS_BACK = 14;
/** At most this many blocks a day. */
export const BLOCKS_PER_DAY_MAX = 48;
/** The body limit: a collector chunks its days to it. */
export const TIME_DRAFTS_BODY_MAX = 16 * 1024;
/** A signal count above this is not a day's work. */
export const SIGNAL_MAX = 100_000;

const MINUTE_MS = 60_000;

export const SIGNAL_KINDS = ['prompts', 'replies', 'sessions', 'commits', 'marks'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export type Signals = Record<SignalKind, number>;

/** One draft, as its person sees it (§6.4). */
export interface TimeDraftView {
  id: string;
  source: TimeDraftSource;
  day: string;
  tz: string;
  started_at: number | null;
  ended_at: number | null;
  minutes: number;
  task: TaskRef | null;
  /** The key as it was sent, when it names no task this person can read. */
  task_key: string | null;
  project: ProjectRef | null;
  /** Put on no card and no project by the person, on purpose. */
  general: boolean;
  signals: Signals;
  note: string | null;
}

export interface DraftBlockInput {
  start: number;
  end: number;
  minutes: number;
  task: string | null;
  signals: Partial<Record<SignalKind, number | undefined>>;
}

export interface TimeDraftsReport {
  v: 1;
  collector_id: string;
  tz: string;
  days: { day: string; blocks: DraftBlockInput[] }[];
}

const zeroSignals = (): Signals => ({ prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 });

function readSignals(json: string): Signals {
  const out = zeroSignals();
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return out;
    for (const kind of SIGNAL_KINDS) {
      const n = (parsed as Record<string, unknown>)[kind];
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out[kind] = n;
    }
  } catch {
    // Written only here, so a bad one is a bug — shown as no evidence.
  }
  return out;
}

function invalid(message: string, extra: Record<string, unknown>): never {
  throw new ApiError('unprocessable', message, { reason: 'invalid_blocks', ...extra });
}

/** The checks a schema cannot make, per day: the span, the day, the minutes. */
function assertBlocks(report: TimeDraftsReport): void {
  for (const { day, blocks } of report.days) {
    if (blocks.length > BLOCKS_PER_DAY_MAX) {
      invalid(`at most ${String(BLOCKS_PER_DAY_MAX)} blocks a day`, { day });
    }
    let total = 0;
    blocks.forEach((b, index) => {
      if (!(b.end > b.start)) invalid('a block ends after it starts', { day, index });
      if (dayIn(report.tz, b.start) !== day) {
        invalid(`a block starts on its own day in ${report.tz}`, { day, index });
      }
      const span = Math.ceil((b.end - b.start) / MINUTE_MS);
      if (b.minutes > span) {
        invalid('a block holds no more minutes than its span', { day, index });
      }
      total += b.minutes;
    });
    if (total > 1440) invalid('a day holds at most 1440 minutes', { day });
  }
}

type Interval = [number, number];

/** `[start, end)` less every interval in `cuts`, in order. */
export function clip(start: number, end: number, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [[start, end]];
  for (const [cs, ce] of cuts) {
    const next: Interval[] = [];
    for (const [s, e] of pieces) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    pieces = next;
  }
  return pieces;
}

/** The settled spans of a person's day that a collector's new blocks go around. */
function settledSpans(tx: Tx, userId: string, day: string, collectorId: string): Interval[] {
  const spans: Interval[] = [];
  for (const r of tx
    .select({ s: timeEntries.startedAt, e: timeEntries.endedAt })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.day, day),
        isNull(timeEntries.deletedAt),
        isNotNull(timeEntries.startedAt),
      ),
    )
    .all()) {
    if (r.s !== null && r.e !== null) spans.push([r.s, r.e]);
  }
  for (const r of tx
    .select({ s: timeDrafts.startedAt, e: timeDrafts.endedAt })
    .from(timeDrafts)
    .where(
      and(
        eq(timeDrafts.userId, userId),
        eq(timeDrafts.day, day),
        isNotNull(timeDrafts.startedAt),
        // Everything but this collector's own pending blocks, which the
        // upload replaces — and a confirmed draft is its entry, above.
        sql`NOT (${timeDrafts.collectorId} = ${collectorId} AND ${timeDrafts.state} = 'pending')`,
        ne(timeDrafts.state, 'confirmed'),
      ),
    )
    .all()) {
    if (r.s !== null && r.e !== null) spans.push([r.s, r.e]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

const REPORT_WINDOW = { daysBack: DRAFT_DAYS_BACK, maxDays: DRAFT_DAYS_BACK + 1 };

/**
 * `PUT /me/time-drafts`: one collector's blocks for the days it carries, each
 * day's pending blocks replaced and clipped around what is settled.
 */
export function recordTimeDrafts(
  db: Db,
  actor: ResolvedActor,
  report: TimeDraftsReport,
  now: number = Date.now(),
): { accepted_days: number; stored_blocks: number } {
  assertCan(actor, 'time_drafts.send_own');
  assertDrafting(db, actor);
  assertReportDays(report, now, REPORT_WINDOW);
  assertBlocks(report);
  const collectorId = report.collector_id.toLowerCase();

  const keys = new Set<string>();
  for (const day of report.days) {
    for (const b of day.blocks) if (b.task !== null) keys.add(b.task);
  }
  const resolved = resolveKeys(db, actor, keys);

  let stored = 0;
  db.transaction((tx) => {
    for (const { day, blocks } of report.days) {
      tx.delete(timeDrafts)
        .where(
          and(
            eq(timeDrafts.userId, actor.userId),
            eq(timeDrafts.day, day),
            eq(timeDrafts.collectorId, collectorId),
            eq(timeDrafts.state, 'pending'),
          ),
        )
        .run();
      const settled = settledSpans(tx, actor.userId, day, collectorId);
      const rows: (typeof timeDrafts.$inferInsert)[] = [];
      for (const b of blocks) {
        const span = b.end - b.start;
        const task = b.task === null ? undefined : resolved.get(b.task);
        const signals = zeroSignals();
        for (const kind of SIGNAL_KINDS) signals[kind] = b.signals[kind] ?? 0;
        for (const [s, e] of clip(b.start, b.end, settled)) {
          const minutes =
            s === b.start && e === b.end ? b.minutes : Math.round((b.minutes * (e - s)) / span);
          if (minutes < 1) continue;
          rows.push({
            id: newId(),
            userId: actor.userId,
            source: 'collector',
            collectorId,
            day,
            tz: report.tz,
            startedAt: s,
            endedAt: e,
            minutes,
            taskKey: b.task !== null && task === undefined ? b.task : null,
            taskId: task?.taskId ?? null,
            projectId: task?.projectId ?? null,
            signals: JSON.stringify(signals),
            state: 'pending',
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      for (let i = 0; i < rows.length; i += 50) {
        tx.insert(timeDrafts)
          .values(rows.slice(i, i + 50))
          .run();
      }
      stored += rows.length;
    }
  });
  return { accepted_days: report.days.length, stored_blocks: stored };
}

// --------------------------------------------------------------- proposals

export interface ProposalInput {
  minutes: number;
  task?: string | undefined;
  day?: string | undefined;
  tz?: string | undefined;
  note?: string | undefined;
}

/** The zone a person's drafts are read in when an agent names none. */
function zoneOf(db: Db, userId: string): string {
  const row = db
    .select({ tz: timeDrafts.tz })
    .from(timeDrafts)
    .where(eq(timeDrafts.userId, userId))
    .orderBy(desc(timeDrafts.day))
    .limit(1)
    .get();
  return row !== undefined && isTimeZone(row.tz) ? row.tz : latestReportZone(db, userId);
}

/**
 * `POST /me/time-drafts` and §7.1's `propose_time_entry` (D-088 item 13): an
 * agent proposes time into its person's drafts — **never an entry**. Only the
 * person, signed in, confirms it. Both switches must be on.
 */
export function proposeTimeDraft(
  db: Db,
  actor: ResolvedActor,
  input: ProposalInput,
  now: number = Date.now(),
): TimeDraftView {
  assertCan(actor, 'time_drafts.send_own');
  assertDrafting(db, actor);
  const tz = input.tz ?? zoneOf(db, actor.userId);
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const day = input.day ?? dayIn(tz, now);
  assertReportDays({ tz, days: [{ day }] }, now, REPORT_WINDOW);
  const target = resolveTarget(db, actor, { task: input.task });
  const id = newId();
  db.insert(timeDrafts)
    .values({
      id,
      userId: actor.userId,
      source: 'agent',
      collectorId: '',
      day,
      tz,
      startedAt: null,
      endedAt: null,
      minutes: input.minutes,
      taskId: target.taskId,
      projectId: target.projectId,
      signals: JSON.stringify(zeroSignals()),
      note: input.note?.trim() === '' ? null : (input.note?.trim() ?? null),
      state: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return draftById(db, actor.userId, id);
}

// ------------------------------------------------------------------- views

const taskProject = alias(projects, 'draft_task_project');

function draftQuery(db: Db | Tx) {
  return db
    .select({
      id: timeDrafts.id,
      source: timeDrafts.source,
      collectorId: timeDrafts.collectorId,
      day: timeDrafts.day,
      tz: timeDrafts.tz,
      startedAt: timeDrafts.startedAt,
      endedAt: timeDrafts.endedAt,
      minutes: timeDrafts.minutes,
      taskKey: timeDrafts.taskKey,
      general: timeDrafts.general,
      signals: timeDrafts.signals,
      note: timeDrafts.note,
      state: timeDrafts.state,
      taskId: tasks.id,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      taskPrefix: taskProject.prefix,
      projectId: projects.id,
      projectSlug: projects.slug,
      projectName: projects.name,
    })
    .from(timeDrafts)
    .leftJoin(tasks, eq(tasks.id, timeDrafts.taskId))
    .leftJoin(taskProject, eq(taskProject.id, tasks.projectId))
    .leftJoin(projects, eq(projects.id, timeDrafts.projectId));
}

type DraftRow = ReturnType<ReturnType<typeof draftQuery>['all']>[number];

function draftView(r: DraftRow): TimeDraftView {
  return {
    id: r.id,
    source: r.source,
    day: r.day,
    tz: r.tz,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    minutes: r.minutes,
    task: taskRefOf(r.taskId, r.taskNumber, r.taskTitle, r.taskPrefix),
    task_key: r.taskKey,
    project: projectRefOf(r.projectId, r.projectSlug, r.projectName),
    general: r.general === 1,
    signals: readSignals(r.signals),
    note: r.note,
  };
}

/**
 * A person's pending drafts on one day, in the order they happened — **one
 * query on `time_drafts_user_day_idx`**, the joins by primary key. A helper of
 * My day, which asks `time_drafts.read_own` first.
 */
export function draftsOn(db: Db, userId: string, day: string): TimeDraftView[] {
  return draftQuery(db)
    .where(
      and(eq(timeDrafts.userId, userId), eq(timeDrafts.day, day), eq(timeDrafts.state, 'pending')),
    )
    .orderBy(
      asc(sql`coalesce(${timeDrafts.startedAt}, ${timeDrafts.createdAt})`),
      asc(timeDrafts.id),
    )
    .all()
    .map(draftView);
}

function draftById(db: Db | Tx, userId: string, id: string): TimeDraftView {
  const row = draftQuery(db)
    .where(
      and(eq(timeDrafts.id, id), eq(timeDrafts.userId, userId), eq(timeDrafts.state, 'pending')),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No draft "${id}"`);
  return draftView(row);
}

/** The caller's own pending draft, or `404` — anybody else's is not there for them. */
function pendingRow(tx: Db | Tx, userId: string, id: string) {
  const row = tx
    .select()
    .from(timeDrafts)
    .where(
      and(eq(timeDrafts.id, id), eq(timeDrafts.userId, userId), eq(timeDrafts.state, 'pending')),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No draft "${id}"`);
  return row;
}

// ----------------------------------------------------- the person's hands

export interface DraftPatch {
  task?: string | null | undefined;
  project?: string | null | undefined;
  general?: boolean | undefined;
  minutes?: number | undefined;
}

/**
 * `PATCH /me/time-drafts/:id`: the person puts a block on a card, on a
 * project or on *General*, or changes its minutes. An edited block is **held
 * for them** — taken out of its collector's replace set — so the next sync
 * neither overwrites nor duplicates it.
 */
export function updateDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  patch: DraftPatch,
  now: number = Date.now(),
): TimeDraftView {
  assertCan(actor, 'time_drafts.manage_own');
  const general = patch.general === true;
  const touches = general || patch.task !== undefined || patch.project !== undefined;
  const target: Target | undefined = !touches
    ? undefined
    : general
      ? { taskId: null, projectId: null }
      : resolveTarget(db, actor, { task: patch.task ?? null, project: patch.project ?? null });
  pendingRow(db, actor.userId, id);
  db.update(timeDrafts)
    .set({
      ...(target === undefined
        ? {}
        : {
            taskId: target.taskId,
            projectId: target.projectId,
            taskKey: null,
            general: general ? 1 : 0,
          }),
      ...(patch.minutes === undefined ? {} : { minutes: patch.minutes }),
      collectorId: '',
      updatedAt: now,
    })
    .where(eq(timeDrafts.id, id))
    .run();
  return draftById(db, actor.userId, id);
}

/**
 * `POST /me/time-drafts/:id/split`: one block becomes two at a minute inside
 * it, each holding its share of the minutes, both held for the person. The
 * evidence describes the block they came from, so each keeps it.
 */
export function splitDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  at: number,
  now: number = Date.now(),
): [TimeDraftView, TimeDraftView] {
  assertCan(actor, 'time_drafts.manage_own');
  const cut = Math.round(at / MINUTE_MS) * MINUTE_MS;
  const ids = db.transaction((tx) => {
    const row = pendingRow(tx, actor.userId, id);
    if (row.startedAt === null || row.endedAt === null) {
      throw new ApiError('unprocessable', 'Only a block with a start and an end can be split', {
        field: 'at',
        reason: 'no_span',
      });
    }
    if (!(cut > row.startedAt && cut < row.endedAt) || row.minutes < 2) {
      throw new ApiError('unprocessable', 'Split at a minute inside the block', {
        field: 'at',
        reason: 'outside_block',
      });
    }
    const first = Math.min(
      row.minutes - 1,
      Math.max(
        1,
        Math.round((row.minutes * (cut - row.startedAt)) / (row.endedAt - row.startedAt)),
      ),
    );
    const base = { ...row, collectorId: '', updatedAt: now };
    const a = { ...base, id: newId(), endedAt: cut, minutes: first };
    const b = { ...base, id: newId(), startedAt: cut, minutes: row.minutes - first };
    tx.delete(timeDrafts).where(eq(timeDrafts.id, id)).run();
    tx.insert(timeDrafts).values([a, b]).run();
    return [a.id, b.id] as const;
  });
  return [draftById(db, actor.userId, ids[0]), draftById(db, actor.userId, ids[1])];
}

/**
 * `POST /me/time-drafts/:id/dismiss`: not work, or not worth keeping. Kept as
 * a tombstone until retention, so the collector's next upload is clipped
 * around it and the block does not come back.
 */
export function dismissDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): void {
  assertCan(actor, 'time_drafts.manage_own');
  pendingRow(db, actor.userId, id);
  db.update(timeDrafts)
    .set({ state: 'dismissed', updatedAt: now })
    .where(eq(timeDrafts.id, id))
    .run();
}

function confirmRow(
  tx: Tx,
  userId: string,
  row: typeof timeDrafts.$inferSelect,
  now: number,
): string {
  const entryId = insertEntry(
    tx,
    userId,
    {
      // An untied block is confirmed as General: the person confirmed it.
      target: { taskId: row.taskId, projectId: row.projectId },
      day: row.day,
      tz: row.tz,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      minutes: row.minutes,
      note: row.note,
    },
    'draft',
    row.id,
    now,
  );
  tx.update(timeDrafts)
    .set({ state: 'confirmed', entryId, updatedAt: now })
    .where(eq(timeDrafts.id, row.id))
    .run();
  return entryId;
}

/** `POST /me/time-drafts/:id/confirm`: one block becomes confirmed time. */
export function confirmDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): TimeEntryView {
  assertCan(actor, 'time_drafts.manage_own');
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  const entryId = db.transaction((tx) =>
    confirmRow(tx, actor.userId, pendingRow(tx, actor.userId, id), now),
  );
  return entryById(db, actor.userId, entryId);
}

/**
 * `POST /me/time/days/:day/confirm` — *Confirm day*: every pending draft of
 * the day becomes confirmed time, in one transaction. A day that would then
 * hold more than 1440 minutes confirms nothing (`422 day_full`).
 */
export function confirmDay(
  db: Db,
  actor: ResolvedActor,
  day: string,
  now: number = Date.now(),
): TimeEntryView[] {
  assertCan(actor, 'time_drafts.manage_own');
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  const ids = db.transaction((tx) =>
    tx
      .select()
      .from(timeDrafts)
      .where(
        and(
          eq(timeDrafts.userId, actor.userId),
          eq(timeDrafts.day, day),
          eq(timeDrafts.state, 'pending'),
        ),
      )
      .orderBy(asc(sql`coalesce(${timeDrafts.startedAt}, ${timeDrafts.createdAt})`))
      .all()
      .map((row) => confirmRow(tx, actor.userId, row, now)),
  );
  return ids.map((id) => entryById(db, actor.userId, id));
}

/**
 * `DELETE /me/time-drafts` (D-088 item 11): every draft the person has not
 * confirmed, now — pending and dismissed alike. What they confirmed is a
 * record, and stays.
 */
export function deleteOwnDrafts(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'time_drafts.manage_own');
  db.delete(timeDrafts)
    .where(
      and(eq(timeDrafts.userId, actor.userId), inArray(timeDrafts.state, ['pending', 'dismissed'])),
    )
    .run();
}

/** Today in the zone the person's drafts are read in — for My day's default. */
export function draftZone(db: Db, userId: string): string {
  return zoneOf(db, userId);
}

/** Days `from`..`to` inclusive. */
export function daySpan(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
