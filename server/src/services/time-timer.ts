import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type TimeEntryKind } from '../db/enums.ts';
import { projects, tasks, timeTimers } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { dayIn, isTimeZone } from './calendar-days.ts';
import {
  createEntry,
  resolveTarget,
  type TaskRef,
  taskRefOf,
  type TimeEntryView,
} from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';
import { type OnUndo } from './time-undo-log.ts';

/**
 * A person's running timer (§4.61, D-110 item 1, LAI-500): the design's
 * *Start timer* — a task, a kind and a title, all optional; pause; resume;
 * stop. **One per person**, kept on the server so it survives a reload and
 * shows on every device; a row's existence is the timer's existence.
 *
 * **Stopping is `POST /me/time-entries` with the clock filled in.** The entry
 * goes through `createEntry`, `source: 'manual'`, with the same checks: on
 * its own day, never more than a day (`422 day_full`, and the timer stays so
 * the person can edit or discard). Over confirmed time it saves: time
 * recorded at the same time is allowed (LAI-528, D-113). A timer that ran past midnight in its zone saves as an
 * **untimed** entry on the day it started, the minutes it ran — the minutes
 * are what is known; a span over two days is not one entry — and the answer
 * says so (`crossed_midnight`).
 *
 * Every action is `time_entries.write_own`, session only: a timer is nothing
 * but an own entry in the making, and a new action would distinguish nothing.
 * The entry's `X-Undo-Id` undoes the entry only; the timer is not revived.
 */

export const TIMER_TITLE_MAX = 120;

export interface TimerView {
  /** The first start, unix ms — the entry's span begins here. */
  started_at: number;
  /** The start of the current running segment; `started_at` until the first resume. */
  resumed_at: number;
  /** Set while paused, null while running. */
  paused_at: number | null;
  /** Running milliseconds banked before the current segment. */
  accumulated_ms: number;
  tz: string;
  task: TaskRef | null;
  kind: TimeEntryKind | null;
  title: string | null;
}

export interface TimerStartInput {
  tz: string;
  task?: string | undefined;
  kind?: TimeEntryKind | undefined;
  title?: string | undefined;
}

const taskProject = alias(projects, 'task_project');

/**
 * The person's timer, or null — one primary-key read, the task joined by its
 * key. A helper of My day, which asks its own `can()` first.
 */
export function timerOf(db: Db, userId: string): TimerView | null {
  const r = db
    .select({
      startedAt: timeTimers.startedAt,
      resumedAt: timeTimers.resumedAt,
      pausedAt: timeTimers.pausedAt,
      accumulatedMs: timeTimers.accumulatedMs,
      tz: timeTimers.tz,
      kind: timeTimers.kind,
      title: timeTimers.title,
      taskId: tasks.id,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      taskPrefix: taskProject.prefix,
    })
    .from(timeTimers)
    .leftJoin(tasks, eq(tasks.id, timeTimers.taskId))
    .leftJoin(taskProject, eq(taskProject.id, tasks.projectId))
    .where(eq(timeTimers.userId, userId))
    .get();
  if (r === undefined) return null;
  return {
    started_at: r.startedAt,
    resumed_at: r.resumedAt,
    paused_at: r.pausedAt,
    accumulated_ms: r.accumulatedMs,
    tz: r.tz,
    task: taskRefOf(r.taskId, r.taskNumber, r.taskTitle, r.taskPrefix),
    kind: r.kind,
    title: r.title,
  };
}

function requireTimer(db: Db, userId: string): typeof timeTimers.$inferSelect {
  const row = db.select().from(timeTimers).where(eq(timeTimers.userId, userId)).get();
  if (row === undefined) {
    throw ApiError.notFound('No timer is running', { reason: 'no_timer' });
  }
  return row;
}

function viewOf(db: Db, userId: string): TimerView {
  const view = timerOf(db, userId);
  if (view === null) throw new Error('timer vanished under its own write');
  return view;
}

/** Running milliseconds as of `now`. */
export function elapsedMs(
  row: { accumulatedMs: number; pausedAt: number | null; resumedAt: number },
  now: number,
): number {
  return row.accumulatedMs + (row.pausedAt === null ? Math.max(0, now - row.resumedAt) : 0);
}

/** `POST /me/time/timer`: start, running. A timer already there → `409 timer_running`. */
export function startTimer(
  db: Db,
  actor: ResolvedActor,
  input: TimerStartInput,
  now: number = Date.now(),
): TimerView {
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  if (!isTimeZone(input.tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const target = resolveTarget(db, actor, { task: input.task });
  const title = input.title?.trim() ?? '';
  if (timerOf(db, actor.userId) !== null) {
    throw new ApiError('conflict', 'A timer is already running — stop or discard it first', {
      reason: 'timer_running',
    });
  }
  db.insert(timeTimers)
    .values({
      userId: actor.userId,
      taskId: target.taskId,
      kind: input.kind ?? null,
      title: title === '' ? null : title,
      tz: input.tz,
      startedAt: now,
      resumedAt: now,
      pausedAt: null,
      accumulatedMs: 0,
      updatedAt: now,
    })
    .run();
  return viewOf(db, actor.userId);
}

/** `POST /me/time/timer/pause`: bank the running segment. Paused already → `409 timer_paused`. */
export function pauseTimer(db: Db, actor: ResolvedActor, now: number = Date.now()): TimerView {
  assertCan(actor, 'time_entries.write_own');
  const row = requireTimer(db, actor.userId);
  if (row.pausedAt !== null) {
    throw new ApiError('conflict', 'The timer is already paused', { reason: 'timer_paused' });
  }
  db.update(timeTimers)
    .set({ accumulatedMs: elapsedMs(row, now), pausedAt: now, updatedAt: now })
    .where(eq(timeTimers.userId, actor.userId))
    .run();
  return viewOf(db, actor.userId);
}

/** `POST /me/time/timer/resume`: a new running segment from now. Running → `409 timer_running`. */
export function resumeTimer(db: Db, actor: ResolvedActor, now: number = Date.now()): TimerView {
  assertCan(actor, 'time_entries.write_own');
  const row = requireTimer(db, actor.userId);
  if (row.pausedAt === null) {
    throw new ApiError('conflict', 'The timer is running', { reason: 'timer_running' });
  }
  db.update(timeTimers)
    .set({ resumedAt: now, pausedAt: null, updatedAt: now })
    .where(eq(timeTimers.userId, actor.userId))
    .run();
  return viewOf(db, actor.userId);
}

/** `DELETE /me/time/timer`: gone, nothing written. */
export function discardTimer(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'time_entries.write_own');
  requireTimer(db, actor.userId);
  db.delete(timeTimers).where(eq(timeTimers.userId, actor.userId)).run();
}

export interface TimerStopped {
  entry: TimeEntryView;
  /**
   * The timer ran past midnight in its zone, so the entry is on the day it
   * started with the minutes it ran and **no set time** (D-110 item 1).
   */
  crossed_midnight: boolean;
}

/**
 * `POST /me/time/timer/stop`: the time run becomes a confirmed entry, and the
 * timer is gone. Under a minute → `422 timer_too_short`, timer kept. Every
 * refusal `createEntry` makes — `422 day_full` — passes through with the
 * timer still there.
 */
export function stopTimer(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
  onUndo?: OnUndo,
): TimerStopped {
  assertCan(actor, 'time_entries.write_own');
  const row = requireTimer(db, actor.userId);
  const endedAt = row.pausedAt ?? now;
  const minutes = Math.floor(elapsedMs(row, now) / 60_000);
  if (minutes < 1) {
    throw new ApiError(
      'unprocessable',
      'A timer under a minute saves nothing — discard it instead',
      {
        reason: 'timer_too_short',
      },
    );
  }
  const day = dayIn(row.tz, row.startedAt);
  const crossedMidnight = dayIn(row.tz, endedAt - 1) !== day;
  const said = {
    day,
    tz: row.tz,
    minutes,
    task: row.taskId ?? undefined,
    kind: row.kind ?? undefined,
    title: row.title ?? undefined,
  };
  const entry = crossedMidnight
    ? createEntry(db, actor, said, now, onUndo)
    : createEntry(
        db,
        actor,
        { ...said, started_at: row.startedAt, ended_at: endedAt },
        now,
        onUndo,
      );
  // Two statements, not one transaction: `createEntry` owns its own, and a
  // row left behind by a crash between them is a timer the person stops again.
  db.delete(timeTimers).where(eq(timeTimers.userId, actor.userId)).run();
  return { entry, crossed_midnight: crossedMidnight };
}
