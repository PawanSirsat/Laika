import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { timeBreaks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { assertEntryDay, assertSpanOnDay } from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';

/**
 * Breaks (LAI-831, the owner's My day design, CHIEF's addition D): a gap in
 * a person's day they waved away, so My day stops counting it under *Gaps*
 * and stops offering to fill it. **A break is never time**: no entry, total,
 * report or export reads this table, and nothing here touches a draft or an
 * entry.
 *
 * The person's own, on a web session — `time_drafts.read_own` to read it with
 * their day, `time_drafts.manage_own` to add or remove one, both
 * `SESSION_ONLY_ACTIONS` — as private as a draft, and kept as long (§11.6).
 * Anybody else's break is not there for them: `404`.
 */

/** At most this many a day, as a collector's blocks (`BLOCKS_PER_DAY_MAX`). */
export const BREAKS_PER_DAY_MAX = 48;

export interface TimeBreakView {
  id: string;
  day: string;
  tz: string;
  started_at: number;
  ended_at: number;
}

export interface NewBreakInput {
  day: string;
  tz: string;
  started_at: number;
  ended_at: number;
}

function view(r: typeof timeBreaks.$inferSelect): TimeBreakView {
  return { id: r.id, day: r.day, tz: r.tz, started_at: r.startedAt, ended_at: r.endedAt };
}

/**
 * A person's breaks on one day, in the order they happened — one range of
 * `time_breaks_user_day_idx`. A helper of My day, which asks
 * `time_drafts.read_own` first.
 */
export function breaksOn(db: Db, userId: string, day: string): TimeBreakView[] {
  return db
    .select()
    .from(timeBreaks)
    .where(and(eq(timeBreaks.userId, userId), eq(timeBreaks.day, day)))
    .orderBy(asc(timeBreaks.startedAt), asc(timeBreaks.id))
    .all()
    .map(view);
}

/**
 * `POST /me/time-breaks`: a span on the person's own day, waved away. It stays
 * on its day, needs the organisation's *Time* not `off`, and overlaps no break
 * already there (`422 overlaps_break`) — My day offers only what is still a gap.
 */
export function addBreak(
  db: Db,
  actor: ResolvedActor,
  input: NewBreakInput,
  now: number = Date.now(),
): TimeBreakView {
  assertCan(actor, 'time_drafts.manage_own');
  assertTimeOn(db);
  assertEntryDay(input.day, input.tz, now);
  assertSpanOnDay(input.day, input.tz, input.started_at, input.ended_at);
  const id = newId();
  db.transaction((tx) => {
    const mine = and(eq(timeBreaks.userId, actor.userId), eq(timeBreaks.day, input.day));
    const overlap = tx
      .select({ id: timeBreaks.id })
      .from(timeBreaks)
      .where(
        and(
          mine,
          lt(timeBreaks.startedAt, input.ended_at),
          gt(timeBreaks.endedAt, input.started_at),
        ),
      )
      .get();
    if (overlap !== undefined) {
      throw new ApiError('unprocessable', 'A break is there already', {
        reason: 'overlaps_break',
        field: 'started_at',
      });
    }
    if (
      tx.select({ id: timeBreaks.id }).from(timeBreaks).where(mine).all().length >=
      BREAKS_PER_DAY_MAX
    ) {
      throw new ApiError('unprocessable', `At most ${String(BREAKS_PER_DAY_MAX)} breaks a day`, {
        reason: 'too_many_breaks',
      });
    }
    tx.insert(timeBreaks)
      .values({
        id,
        userId: actor.userId,
        day: input.day,
        tz: input.tz,
        startedAt: input.started_at,
        endedAt: input.ended_at,
        createdAt: now,
      })
      .run();
  });
  return {
    id,
    day: input.day,
    tz: input.tz,
    started_at: input.started_at,
    ended_at: input.ended_at,
  };
}

/** `DELETE /me/time-breaks/:id`: the gap counts again. */
export function removeBreak(db: Db, actor: ResolvedActor, id: string): void {
  assertCan(actor, 'time_drafts.manage_own');
  const gone = db
    .delete(timeBreaks)
    .where(and(eq(timeBreaks.id, id), eq(timeBreaks.userId, actor.userId)))
    .run();
  if (gone.changes === 0) throw ApiError.notFound(`No break "${id}"`);
}
