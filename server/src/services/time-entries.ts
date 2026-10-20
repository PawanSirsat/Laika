import { and, asc, eq, gt, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type TimeEntrySource, type TimeRevisionChange } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { projects, tasks, timeEntries, timeEntryRevisions } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addDays, dayIn, isCalendarDay, isTimeZone } from './calendar-days.ts';
import { canSeeProject, requireProjectBySlug } from './projects.ts';
import { resolveTaskRef } from './tasks.ts';
import { assertTimeOn } from './time-settings.ts';
import { recordUndo, type OnUndo } from './time-undo-log.ts';

/**
 * Confirmed time (D-088 items 2, 6, 11 and 12, SPEC §4.48–§4.49, LAI-787) —
 * what a person confirmed from a draft, typed by hand, or imported. **The only
 * time anybody but the person will ever see**, and in this phase nobody else
 * does: every function here answers to the person's own
 * `time_entries.*_own`, which is web-session only (§3.1), and reads or writes
 * their own rows alone.
 *
 * ## History is append-only
 *
 * Every create, edit and delete writes a `time_entry_revisions` row holding
 * the entry as it stood after the change, numbered per entry, in the same
 * transaction. Triggers refuse an `UPDATE` or a replace of a revision and a
 * `DELETE` while its entry exists (`db/migrate.ts`). A delete is `deleted_at`
 * and a revision — the row stays three years, which a trigger also holds.
 *
 * ## A day never holds more than a day
 *
 * A person's live entries on one local day sum to at most 1440 minutes: their
 * confirmed time never exceeds their wall clock, however many agents ran
 * (the market report's split-never-multiply rule). Anything more is `422
 * day_full`.
 *
 * No `activity` row, for any of it (D-088): time is not a change to the board,
 * and a feed row would put a person's hours in front of the whole project.
 */

/** A day may be this far back; older is the period LAI-789 closes. */
export const ENTRY_DAYS_BACK = 365;
/** A day holds at most this many minutes of one person's time. */
export const DAY_MINUTES = 1440;

export interface TaskRef {
  id: string;
  key: string;
  title: string;
}

export interface ProjectRef {
  id: string;
  slug: string;
  name: string;
}

/** One confirmed entry (§6.4). */
export interface TimeEntryView {
  id: string;
  day: string;
  tz: string;
  started_at: number | null;
  ended_at: number | null;
  minutes: number;
  source: TimeEntrySource;
  task: TaskRef | null;
  project: ProjectRef | null;
  note: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
}

/** One revision of an entry, as it stood after the change (§6.4). */
export interface TimeRevisionView {
  revision: number;
  change: TimeRevisionChange;
  changed_by: string;
  day: string;
  tz: string;
  minutes: number;
  task_id: string | null;
  project_id: string | null;
  note: string | null;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Where time goes: a task (and its project), a project alone, or neither — *General*. */
export interface Target {
  taskId: string | null;
  projectId: string | null;
}

/**
 * A task reference and a project slug → the target, each readable by the
 * caller or `404` — a key on a card they cannot see is a card that is not
 * there for them. A task carries its own project; naming another one beside it
 * is `422`.
 */
export function resolveTarget(
  db: Db,
  actor: ResolvedActor,
  input: { task?: string | null | undefined; project?: string | null | undefined },
): Target {
  let target: Target = { taskId: null, projectId: null };
  if (typeof input.task === 'string') {
    const id = resolveTaskRef(db, input.task.trim(), actor);
    const row = db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();
    if (row === undefined || !canSeeProject(actor, row.projectId)) {
      throw ApiError.notFound(`No task "${input.task}"`);
    }
    target = { taskId: row.id, projectId: row.projectId };
  }
  if (typeof input.project === 'string') {
    let project: { id: string };
    try {
      project = requireProjectBySlug(db, input.project);
    } catch {
      throw ApiError.notFound(`No project "${input.project}"`);
    }
    if (!canSeeProject(actor, project.id)) throw ApiError.notFound(`No project "${input.project}"`);
    if (target.projectId !== null && target.projectId !== project.id) {
      throw new ApiError('unprocessable', 'That task is in another project', {
        field: 'project',
        reason: 'task_in_another_project',
      });
    }
    target = { taskId: target.taskId, projectId: project.id };
  }
  return target;
}

/** A zone this server knows, and a day in the window, or `422`. */
export function assertEntryDay(day: string, tz: string, now: number): void {
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const today = dayIn(tz, now);
  const earliest = addDays(today, -ENTRY_DAYS_BACK);
  const latest = addDays(today, 1);
  if (!isCalendarDay(day) || day < earliest || day > latest) {
    throw new ApiError('unprocessable', `day is a date from ${earliest} to ${latest} in ${tz}`, {
      reason: 'day_out_of_range',
      field: 'day',
      earliest,
      latest,
    });
  }
}

/**
 * A span on `day` in `tz` (LAI-831): it ends after it starts, and both ends
 * fall on that day — a block dragged past midnight is refused, not moved to
 * the next day. `422 invalid_span` or `422 outside_day`.
 */
export function assertSpanOnDay(day: string, tz: string, start: number, end: number): void {
  if (!(end > start)) {
    throw new ApiError('unprocessable', 'A span ends after it starts', {
      reason: 'invalid_span',
      field: 'ended_at',
    });
  }
  if (dayIn(tz, start) !== day || dayIn(tz, end - 1) !== day) {
    throw new ApiError('unprocessable', `A span stays on ${day} in ${tz}`, {
      reason: 'outside_day',
      field: 'started_at',
    });
  }
}

/**
 * A timed block holds no more minutes than its own span — whatever else is
 * confirmed (review round 2): `422 minutes_over_span`, before any stretch is
 * judged.
 */
export function assertWithinSpan(start: number, end: number, minutes: number): void {
  if (minutes > Math.ceil((end - start) / 60_000 - 1e-9)) {
    throw new ApiError('unprocessable', 'A block holds no more minutes than its span', {
      field: 'minutes',
      reason: 'minutes_over_span',
    });
  }
}

/**
 * The stretch `[start, end)` joins: it and every live timed entry of the
 * person that overlaps it, **transitively** — A meets B, B meets C, so A, B
 * and C are one stretch though A never meets C. Its extent, and the minutes
 * its entries hold. `except` is an entry being moved.
 */
function stretchAround(
  tx: Tx | Db,
  userId: string,
  start: number,
  end: number,
  except?: string,
): { from: number; to: number; held: number } {
  let from = start;
  let to = end;
  const held = new Map<string, number>();
  for (;;) {
    const overlapping = tx
      .select({
        id: timeEntries.id,
        startedAt: timeEntries.startedAt,
        endedAt: timeEntries.endedAt,
        minutes: timeEntries.minutes,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, userId),
          isNull(timeEntries.deletedAt),
          isNotNull(timeEntries.startedAt),
          lt(timeEntries.startedAt, to),
          gt(timeEntries.endedAt, from),
          ...(except === undefined ? [] : [ne(timeEntries.id, except)]),
        ),
      )
      .all();
    let grew = false;
    for (const e of overlapping) {
      if (held.has(e.id) || e.startedAt === null || e.endedAt === null) continue;
      held.set(e.id, e.minutes);
      if (e.startedAt < from) {
        from = e.startedAt;
        grew = true;
      }
      if (e.endedAt > to) {
        to = e.endedAt;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return { from, to, held: [...held.values()].reduce((n, m) => n + m, 0) };
}

/**
 * **Confirmed time is never counted twice, by the clock** (LAI-831 review
 * round 2) — the collector's own rule (`time-drafts.ts`): the stretch a block
 * joins holds no more minutes than it has of wall clock. `minutes` placed on
 * `[start, end)`, plus every live timed entry in its stretch, must fit the
 * stretch's length. Two tasks worked at once — the collector's blocks that
 * share a stretch, however unevenly — fit in any order; a block dragged over a
 * confirmed hour does not. `409 overlaps_confirmed`, naming the stretch, and
 * the draft when one is being confirmed.
 */
export function assertFitsTheClock(
  tx: Tx | Db,
  userId: string,
  start: number,
  end: number,
  minutes: number,
  options: { readonly except?: string; readonly draftId?: string } = {},
): void {
  const stretch = stretchAround(tx, userId, start, end, options.except);
  const clock = (stretch.to - stretch.from) / 60_000;
  const would = stretch.held + minutes;
  if (would > Math.ceil(clock - 1e-9)) {
    throw new ApiError(
      'conflict',
      `That would count confirmed time twice: the stretch it joins has ${String(Math.round(clock))} minutes of clock and would hold ${String(would)}`,
      {
        reason: 'overlaps_confirmed',
        ...(options.draftId === undefined ? {} : { draft_id: options.draftId }),
        started_at: start,
        ended_at: end,
        stretch_started_at: stretch.from,
        stretch_ended_at: stretch.to,
        stretch_minutes: Math.round(clock),
        would_hold: would,
      },
    );
  }
}

/**
 * What an entry moved or shortened leaves behind must fit too: every live
 * timed entry `[start, end)` met is judged on the stretch it stands in once
 * the edit is written. An entry that held a stretch open — its slack the room
 * two overlapping blocks share — cannot be moved off and leave them counting
 * twice.
 */
function assertLeftBehindFits(tx: Tx, userId: string, start: number, end: number): void {
  const met = tx
    .select({ startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNull(timeEntries.deletedAt),
        isNotNull(timeEntries.startedAt),
        lt(timeEntries.startedAt, end),
        gt(timeEntries.endedAt, start),
      ),
    )
    .all();
  for (const e of met) {
    if (e.startedAt !== null && e.endedAt !== null) {
      assertFitsTheClock(tx, userId, e.startedAt, e.endedAt, 0);
    }
  }
}

/** The minutes a person's live entries already hold on a day. */
function minutesOn(tx: Tx | Db, userId: string, day: string, except?: string): number {
  return (
    tx
      .select({ n: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`.mapWith(Number) })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, userId),
          eq(timeEntries.day, day),
          isNull(timeEntries.deletedAt),
          ...(except === undefined ? [] : [ne(timeEntries.id, except)]),
        ),
      )
      .get()?.n ?? 0
  );
}

function assertRoom(tx: Tx | Db, userId: string, day: string, minutes: number, except?: string) {
  const held = minutesOn(tx, userId, day, except);
  if (held + minutes > DAY_MINUTES) {
    throw new ApiError(
      'unprocessable',
      `That would put ${String(held + minutes)} minutes on ${day}; a day holds ${String(DAY_MINUTES)}`,
      { reason: 'day_full', field: 'minutes', day, held },
    );
  }
}

export interface EntryFields {
  target: Target;
  day: string;
  tz: string;
  startedAt: number | null;
  endedAt: number | null;
  minutes: number;
  note: string | null;
}

function revisionRow(
  entryId: string,
  revision: number,
  change: TimeRevisionChange,
  changedBy: string,
  f: EntryFields,
  now: number,
): typeof timeEntryRevisions.$inferInsert {
  return {
    id: newId(),
    entryId,
    revision,
    change,
    changedBy,
    taskId: f.target.taskId,
    projectId: f.target.projectId,
    day: f.day,
    tz: f.tz,
    startedAt: f.startedAt,
    endedAt: f.endedAt,
    minutes: f.minutes,
    note: f.note,
    createdAt: now,
  };
}

/**
 * Write an entry and its first revision, inside the caller's transaction —
 * the one way an entry comes to exist, whether a person typed it or confirmed
 * a draft. Refuses a day that would hold more than a day.
 */
export function insertEntry(
  tx: Tx,
  userId: string,
  fields: EntryFields,
  source: TimeEntrySource,
  sourceRef: string | null,
  now: number,
): string {
  assertRoom(tx, userId, fields.day, fields.minutes);
  const id = newId();
  tx.insert(timeEntries)
    .values({
      id,
      userId,
      taskId: fields.target.taskId,
      projectId: fields.target.projectId,
      day: fields.day,
      tz: fields.tz,
      startedAt: fields.startedAt,
      endedAt: fields.endedAt,
      minutes: fields.minutes,
      source,
      sourceRef,
      note: fields.note,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  tx.insert(timeEntryRevisions)
    .values(revisionRow(id, 1, 'created', userId, fields, now))
    .run();
  return id;
}

// ------------------------------------------------------------------ views

const taskProject = alias(projects, 'task_project');

const entrySelect = {
  id: timeEntries.id,
  day: timeEntries.day,
  tz: timeEntries.tz,
  startedAt: timeEntries.startedAt,
  endedAt: timeEntries.endedAt,
  minutes: timeEntries.minutes,
  source: timeEntries.source,
  note: timeEntries.note,
  revision: timeEntries.revision,
  createdAt: timeEntries.createdAt,
  updatedAt: timeEntries.updatedAt,
  taskId: tasks.id,
  taskNumber: tasks.number,
  taskTitle: tasks.title,
  taskPrefix: taskProject.prefix,
  projectId: projects.id,
  projectSlug: projects.slug,
  projectName: projects.name,
};

export function taskRefOf(
  id: string | null,
  number: number | null,
  title: string | null,
  prefix: string | null,
): TaskRef | null {
  if (id === null || number === null || title === null || prefix === null) return null;
  return { id, key: `${prefix}-${String(number)}`, title };
}

export function projectRefOf(
  id: string | null,
  slug: string | null,
  name: string | null,
): ProjectRef | null {
  return id === null || slug === null || name === null ? null : { id, slug, name };
}

function entryQuery(db: Db | Tx) {
  return db
    .select(entrySelect)
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .leftJoin(taskProject, eq(taskProject.id, tasks.projectId))
    .leftJoin(projects, eq(projects.id, timeEntries.projectId));
}

type EntryRow = ReturnType<ReturnType<typeof entryQuery>['all']>[number];

function entryView(r: EntryRow): TimeEntryView {
  return {
    id: r.id,
    day: r.day,
    tz: r.tz,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    minutes: r.minutes,
    source: r.source,
    task: taskRefOf(r.taskId, r.taskNumber, r.taskTitle, r.taskPrefix),
    project: projectRefOf(r.projectId, r.projectSlug, r.projectName),
    note: r.note,
    revision: r.revision,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

/**
 * A person's live entries on one day, in the order they happened — **one
 * query on `time_entries_user_day_idx`**, the joins by primary key.
 */
export function entriesOn(db: Db, userId: string, day: string): TimeEntryView[] {
  return entryQuery(db)
    .where(
      and(eq(timeEntries.userId, userId), eq(timeEntries.day, day), isNull(timeEntries.deletedAt)),
    )
    .orderBy(
      asc(sql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt})`),
      asc(timeEntries.id),
    )
    .all()
    .map(entryView);
}

/** One of the caller's live entries, or `404` — anybody else's is not there for them. */
export function entryById(db: Db | Tx, userId: string, id: string): TimeEntryView {
  const row = entryQuery(db)
    .where(
      and(eq(timeEntries.id, id), eq(timeEntries.userId, userId), isNull(timeEntries.deletedAt)),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No time entry "${id}"`);
  return entryView(row);
}

// ------------------------------------------------------------- the writes

export interface NewEntryInput {
  day: string;
  tz: string;
  minutes: number;
  task?: string | undefined;
  project?: string | undefined;
  note?: string | undefined;
  started_at?: number | undefined;
  ended_at?: number | undefined;
}

/**
 * `POST /me/time-entries`: time the person types — a meeting, a call —
 * on a card, a project or neither. Needs the organisation's *Time* not `off`.
 */
export function createEntry(
  db: Db,
  actor: ResolvedActor,
  input: NewEntryInput,
  now: number = Date.now(),
  onUndo?: OnUndo,
): TimeEntryView {
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  assertEntryDay(input.day, input.tz, now);
  const startedAt = input.started_at ?? null;
  const endedAt = input.ended_at ?? null;
  if ((startedAt === null) !== (endedAt === null) || (endedAt ?? 1) <= (startedAt ?? 0)) {
    throw new ApiError('unprocessable', 'started_at and ended_at go together, end after start', {
      field: 'ended_at',
    });
  }
  const target = resolveTarget(db, actor, input);
  const { id, undoId } = db.transaction((tx) => {
    if (startedAt !== null && endedAt !== null) {
      assertWithinSpan(startedAt, endedAt, input.minutes);
      assertFitsTheClock(tx, actor.userId, startedAt, endedAt, input.minutes);
    }
    const made = insertEntry(
      tx,
      actor.userId,
      {
        target,
        day: input.day,
        tz: input.tz,
        startedAt,
        endedAt,
        minutes: input.minutes,
        note: input.note?.trim() === '' ? null : (input.note?.trim() ?? null),
      },
      'manual',
      null,
      now,
    );
    // Undo takes it back (LAI-831).
    return {
      id: made,
      undoId: recordUndo(tx, actor.userId, made, { drafts: [], entriesMade: [made] }, now),
    };
  });
  onUndo?.(undoId);
  return entryById(db, actor.userId, id);
}

export interface EntryPatch {
  minutes?: number | undefined;
  task?: string | null | undefined;
  project?: string | null | undefined;
  note?: string | null | undefined;
  day?: string | undefined;
  /** A new start or end on the same day (LAI-831: an edge dragged), unix ms. */
  started_at?: number | undefined;
  ended_at?: number | undefined;
}

/**
 * One of the person's live entries, for them to change — never one that came
 * from Solidtime (LAI-788 review round 1). Once there, **Solidtime is the
 * record** (D-088 item 10): an import is changed in Solidtime and the next
 * pull brings the change here. Changing it here as well is how one hour came
 * to be deleted from both systems at once.
 */
function currentFields(tx: Tx, userId: string, id: string) {
  const row = tx
    .select()
    .from(timeEntries)
    .where(
      and(eq(timeEntries.id, id), eq(timeEntries.userId, userId), isNull(timeEntries.deletedAt)),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No time entry "${id}"`);
  if (row.source === 'import') {
    throw new ApiError(
      'forbidden',
      'This entry came from Solidtime: change it there, and the next laika time pull brings it here',
      { reason: 'imported_entry', entry_id: id },
    );
  }
  return row;
}

/**
 * `PATCH /me/time-entries/:id`: the person corrects their own entry. Every
 * field is optional; `task: null` and `project: null` move it to *General*.
 * A change writes the next revision; a patch that changes nothing writes none.
 *
 * `started_at` and `ended_at` move its edges on its own day (LAI-831): a drag
 * on My day's timeline is one patch, and so **one revision**, however far it
 * went. An entry with no set time takes both at once; a new day and a new
 * span are two edits, not one.
 */
export function updateEntry(
  db: Db,
  actor: ResolvedActor,
  id: string,
  patch: EntryPatch,
  now: number = Date.now(),
): TimeEntryView {
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  const touchesTarget = patch.task !== undefined || patch.project !== undefined;
  const resolved = touchesTarget
    ? resolveTarget(db, actor, { task: patch.task ?? null, project: patch.project ?? null })
    : undefined;

  const touchesSpan = patch.started_at !== undefined || patch.ended_at !== undefined;

  db.transaction((tx) => {
    const row = currentFields(tx, actor.userId, id);
    const moves = patch.day !== undefined && patch.day !== row.day;
    let startedAt = moves ? null : row.startedAt;
    let endedAt = moves ? null : row.endedAt;
    if (touchesSpan) {
      if (moves) {
        throw new ApiError('unprocessable', 'A new day and a new span are two edits', {
          reason: 'invalid_span',
          field: 'day',
        });
      }
      const start = patch.started_at ?? row.startedAt;
      const end = patch.ended_at ?? row.endedAt;
      if (start === null || end === null) {
        throw new ApiError('unprocessable', 'An entry with no set time takes a start and an end', {
          reason: 'no_span',
          field: 'started_at',
        });
      }
      assertSpanOnDay(row.day, row.tz, start, end);
      startedAt = start;
      endedAt = end;
    }
    const next: EntryFields = {
      target: resolved ?? { taskId: row.taskId, projectId: row.projectId },
      day: patch.day ?? row.day,
      tz: row.tz,
      startedAt,
      endedAt,
      minutes: patch.minutes ?? row.minutes,
      note:
        patch.note === undefined
          ? row.note
          : patch.note === null || patch.note.trim() === ''
            ? null
            : patch.note.trim(),
    };
    if (patch.day !== undefined) assertEntryDay(next.day, next.tz, now);
    if (
      next.startedAt !== null &&
      next.endedAt !== null &&
      (touchesSpan || patch.minutes !== undefined)
    ) {
      assertWithinSpan(next.startedAt, next.endedAt, next.minutes);
      assertFitsTheClock(tx, actor.userId, next.startedAt, next.endedAt, next.minutes, {
        except: id,
      });
    }
    const same =
      next.target.taskId === row.taskId &&
      next.target.projectId === row.projectId &&
      next.day === row.day &&
      next.startedAt === row.startedAt &&
      next.endedAt === row.endedAt &&
      next.minutes === row.minutes &&
      next.note === row.note;
    if (same) return;
    assertRoom(tx, actor.userId, next.day, next.minutes, id);
    const revision = row.revision + 1;
    tx.update(timeEntries)
      .set({
        taskId: next.target.taskId,
        projectId: next.target.projectId,
        day: next.day,
        startedAt: next.startedAt,
        endedAt: next.endedAt,
        minutes: next.minutes,
        note: next.note,
        revision,
        updatedAt: now,
      })
      .where(eq(timeEntries.id, id))
      .run();
    tx.insert(timeEntryRevisions)
      .values(revisionRow(id, revision, 'edited', actor.userId, next, now))
      .run();
    if (
      row.startedAt !== null &&
      row.endedAt !== null &&
      (next.startedAt !== row.startedAt || next.endedAt !== row.endedAt)
    ) {
      assertLeftBehindFits(tx, actor.userId, row.startedAt, row.endedAt);
    }
  });
  return entryById(db, actor.userId, id);
}

/**
 * `DELETE /me/time-entries/:id`: the person takes back an entry. It is kept,
 * with `deleted_at` and a `deleted` revision — a record for three years — and
 * no longer counts anywhere.
 */
export function deleteEntry(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
  onUndo?: OnUndo,
): void {
  assertCan(actor, 'time_entries.write_own');
  const undoId = db.transaction((tx) => {
    currentFields(tx, actor.userId, id);
    retireEntry(tx, id, actor.userId, now);
    // Undo makes it live again (LAI-831).
    return recordUndo(tx, actor.userId, id, { drafts: [], entriesRetired: [id] }, now);
  });
  onUndo?.(undoId);
}

/**
 * Delete an entry inside the caller's transaction: `deleted_at` and a
 * `deleted` revision by `changedBy`, the row kept. The person's own delete,
 * and Solidtime's when an entry there is gone (LAI-788). One already deleted
 * is left as it is. Returns its revision.
 */
export function retireEntry(tx: Tx, id: string, changedBy: string, now: number): number {
  const row = tx.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
  if (row === undefined) throw ApiError.notFound(`No time entry "${id}"`);
  if (row.deletedAt !== null) return row.revision;
  const revision = row.revision + 1;
  tx.update(timeEntries)
    .set({ deletedAt: now, revision, updatedAt: now })
    .where(eq(timeEntries.id, id))
    .run();
  tx.insert(timeEntryRevisions)
    .values(
      revisionRow(
        id,
        revision,
        'deleted',
        changedBy,
        {
          target: { taskId: row.taskId, projectId: row.projectId },
          day: row.day,
          tz: row.tz,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          minutes: row.minutes,
          note: row.note,
        },
        now,
      ),
    )
    .run();
  return revision;
}

/**
 * An entry changed from outside, inside the caller's transaction — by
 * Solidtime, which is the record once an entry is there (D-088 item 10,
 * LAI-788): the new fields as the next `edited` revision by `changedBy`, and
 * the entry live again if it had been deleted. Refuses a day that would hold
 * more than a day. Returns the new revision.
 */
export function syncEntry(
  tx: Tx,
  id: string,
  fields: EntryFields,
  changedBy: string,
  now: number,
): number {
  const row = tx.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
  if (row === undefined) throw ApiError.notFound(`No time entry "${id}"`);
  assertRoom(tx, row.userId, fields.day, fields.minutes, id);
  const revision = row.revision + 1;
  tx.update(timeEntries)
    .set({
      taskId: fields.target.taskId,
      projectId: fields.target.projectId,
      day: fields.day,
      tz: fields.tz,
      startedAt: fields.startedAt,
      endedAt: fields.endedAt,
      minutes: fields.minutes,
      note: fields.note,
      deletedAt: null,
      revision,
      updatedAt: now,
    })
    .where(eq(timeEntries.id, id))
    .run();
  tx.insert(timeEntryRevisions)
    .values(revisionRow(id, revision, 'edited', changedBy, fields, now))
    .run();
  return revision;
}

/**
 * An entry its person took back, live again as it stood (LAI-831: Undo of a
 * delete), inside the caller's transaction — its own fields as the next
 * `edited` revision, the way an entry Solidtime brings back is. History stays
 * append-only: the delete and the return are both in it.
 */
export function reviveEntry(tx: Tx, id: string, changedBy: string, now: number): number {
  const row = tx.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
  if (row === undefined) throw ApiError.notFound(`No time entry "${id}"`);
  if (row.startedAt !== null && row.endedAt !== null) {
    assertFitsTheClock(tx, row.userId, row.startedAt, row.endedAt, row.minutes, { except: id });
  }
  return syncEntry(
    tx,
    id,
    {
      target: { taskId: row.taskId, projectId: row.projectId },
      day: row.day,
      tz: row.tz,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      minutes: row.minutes,
      note: row.note,
    },
    changedBy,
    now,
  );
}

/**
 * `GET /me/time-entries/:id/revisions`: the history of one of the caller's
 * entries, oldest first — a deleted one's included, since its history is
 * theirs too.
 */
export function listRevisions(db: Db, actor: ResolvedActor, id: string): TimeRevisionView[] {
  assertCan(actor, 'time_entries.read_own');
  const owned = db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, actor.userId)))
    .get();
  if (owned === undefined) throw ApiError.notFound(`No time entry "${id}"`);
  return db
    .select()
    .from(timeEntryRevisions)
    .where(eq(timeEntryRevisions.entryId, id))
    .orderBy(asc(timeEntryRevisions.revision))
    .all()
    .map((r) => ({
      revision: r.revision,
      change: r.change,
      changed_by: r.changedBy,
      day: r.day,
      tz: r.tz,
      minutes: r.minutes,
      task_id: r.taskId,
      project_id: r.projectId,
      note: r.note,
      started_at: r.startedAt,
      ended_at: r.endedAt,
      created_at: r.createdAt,
    }));
}
