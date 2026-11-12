import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { dayIn, isTimeZone } from './calendar-days.ts';
import { stateOf, type DayState } from './my-day.ts';
import { draftsOn, draftZone } from './time-drafts.ts';
import { entriesOn, type ProjectRef, type TaskRef } from './time-entries.ts';
import { stretch } from './time-summary.ts';

/**
 * `GET /me/time/days?from=&to=&tz=` (LAI-1173): a person's days over a
 * stretch, one row each — what My day's Week, Month and Year views draw.
 *
 * ## Each day as the day view reads it
 *
 * Read day by day with `GET /me/time`'s own readers (`entriesOn`,
 * `draftsOn`), as `GET /me/time/summary` is, so a task the reader cannot read
 * is named here no more than there; and each day's `state` is `stateOf`, the
 * day view's own, so a day with nothing is *no signal*, never zero hours.
 *
 * ## Bounded as the summary is
 *
 * `stretch()`: at most 92 days (`422 range_too_long`), never backwards
 * (`422 range_backwards`). A year is four reads.
 */

/** How many of a day's tasks it names: what a month cell has room for. */
export const DAYS_TOP_TASKS = 3;

/**
 * One task's time on a day; `task` null for time on no task — `untied` when
 * it is drafted time nobody has put on anything yet (*No task yet*), as the
 * summary's task rows.
 */
export interface DaysTaskView {
  task: TaskRef | null;
  project: ProjectRef | null;
  untied: boolean;
  confirmed_minutes: number;
  drafted_minutes: number;
}

/** One day of the stretch. */
export interface DaysDayView {
  day: string;
  state: DayState;
  confirmed_minutes: number;
  drafted_minutes: number;
  /** Of `drafted_minutes`, the part on nothing yet. */
  untied_minutes: number;
  /** The day's largest tasks, at most `DAYS_TOP_TASKS`, largest first. */
  top_tasks: DaysTaskView[];
}

export interface TimeDaysView {
  from: string;
  to: string;
  tz: string;
  /** Today in `tz`: a later day is `future`. */
  today: string;
  days: DaysDayView[];
}

const largest = (a: DaysTaskView, b: DaysTaskView): number =>
  b.confirmed_minutes + b.drafted_minutes - (a.confirmed_minutes + a.drafted_minutes);

/**
 * One person's days — **no `can()` here**: each caller asks its own question
 * first, as `summaryOf` and `dayOf` do.
 */
export function daysOf(
  db: Db,
  userId: string,
  query: { from?: string | undefined; to?: string | undefined; tz?: string | undefined },
  now: number = Date.now(),
): TimeDaysView {
  const days = stretch(query.from, query.to);
  const tz = query.tz ?? draftZone(db, userId);
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const today = dayIn(tz, now);

  const rows: DaysDayView[] = days.map((day) => {
    const tasks = new Map<string, DaysTaskView>();
    const add = (
      task: TaskRef | null,
      project: ProjectRef | null,
      minutes: number,
      confirmed: boolean,
      untied = false,
    ): void => {
      const key = task?.id ?? `${untied ? 'untied' : 'none'}:${project?.id ?? ''}`;
      const row = tasks.get(key) ?? {
        task,
        project,
        untied,
        confirmed_minutes: 0,
        drafted_minutes: 0,
      };
      if (confirmed) row.confirmed_minutes += minutes;
      else row.drafted_minutes += minutes;
      tasks.set(key, row);
    };

    let confirmed = 0;
    let drafted = 0;
    let untied = 0;
    for (const e of entriesOn(db, userId, day)) {
      confirmed += e.minutes;
      add(e.task, e.project, e.minutes, true);
    }
    for (const d of draftsOn(db, userId, day)) {
      drafted += d.minutes;
      const loose = d.task === null && !d.general;
      if (loose) untied += d.minutes;
      add(d.task, d.project, d.minutes, false, loose);
    }
    return {
      day,
      state: stateOf(day, today, confirmed, drafted),
      confirmed_minutes: confirmed,
      drafted_minutes: drafted,
      untied_minutes: untied,
      top_tasks: [...tasks.values()].sort(largest).slice(0, DAYS_TOP_TASKS),
    };
  });

  return { from: days[0] ?? '', to: days.at(-1) ?? '', tz, today, days: rows };
}

/** `GET /me/time/days?from=&to=&tz=`: the caller's own days, under the day view's questions. */
export function getMyDays(
  db: Db,
  actor: ResolvedActor,
  query: { from?: string | undefined; to?: string | undefined; tz?: string | undefined },
  now: number = Date.now(),
): TimeDaysView {
  assertCan(actor, 'time_drafts.read_own');
  assertCan(actor, 'time_entries.read_own');
  return daysOf(db, actor.userId, query, now);
}
