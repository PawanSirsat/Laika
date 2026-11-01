import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type TimeEntryKind } from '../db/enums.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addDays, isCalendarDay } from './calendar-days.ts';
import { draftsOn } from './time-drafts.ts';
import { entriesOn, type ProjectRef, type TaskRef } from './time-entries.ts';

/** The longest stretch one summary covers: a quarter. */
export const SUMMARY_MAX_DAYS = 92;

/** One day of the stretch: what was confirmed and what is still drafted. */
export interface SummaryDayView {
  day: string;
  confirmed_minutes: number;
  drafted_minutes: number;
}

/** One project's time over the stretch; `project` null for time on none. */
export interface SummaryProjectView {
  project: ProjectRef | null;
  confirmed_minutes: number;
  drafted_minutes: number;
}

/**
 * One task's time over the stretch; `task` null for time on no task —
 * `untied` when it is drafted time nobody has put on anything yet (*No task
 * yet*), kept apart from time typed or confirmed on none (*No task*).
 */
export interface SummaryTaskView {
  task: TaskRef | null;
  project: ProjectRef | null;
  untied: boolean;
  confirmed_minutes: number;
  drafted_minutes: number;
}

/** One kind's confirmed and drafted time; `kind` null for time nobody named (Building's). */
export interface SummaryKindView {
  kind: TimeEntryKind | null;
  minutes: number;
}

/**
 * `GET /me/time/summary?from=&to=` (LAI-526): a person's time over a stretch
 * of days — what My day's Overview draws for a week or a picked range.
 * Confirmed entries and pending drafts, as the day view reads them.
 */
export interface TimeSummaryView {
  from: string;
  to: string;
  /** Calendar days in the stretch, and how many of them hold any time. */
  days: number;
  active_days: number;
  confirmed_minutes: number;
  drafted_minutes: number;
  /** Confirmed time of the meeting kind. */
  meeting_minutes: number;
  /** Confirmed time typed by hand or run on a timer — what Laika could not see. */
  manual_minutes: number;
  by_day: SummaryDayView[];
  by_project: SummaryProjectView[];
  by_task: SummaryTaskView[];
  by_kind: SummaryKindView[];
}

/** Days `from` to `to`, both kept, refused when out of order or longer than a quarter. */
function stretch(from: string | undefined, to: string | undefined): string[] {
  if (from === undefined || !isCalendarDay(from)) {
    throw new ApiError('unprocessable', 'from is a calendar date, YYYY-MM-DD', { field: 'from' });
  }
  if (to === undefined || !isCalendarDay(to)) {
    throw new ApiError('unprocessable', 'to is a calendar date, YYYY-MM-DD', { field: 'to' });
  }
  if (to < from) {
    throw new ApiError('unprocessable', 'to is on or after from', {
      field: 'to',
      reason: 'range_backwards',
    });
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > SUMMARY_MAX_DAYS) {
      throw new ApiError(
        'unprocessable',
        `A summary covers at most ${String(SUMMARY_MAX_DAYS)} days`,
        { field: 'to', reason: 'range_too_long', max_days: SUMMARY_MAX_DAYS },
      );
    }
  }
  return days;
}

const byMinutes = <T extends { confirmed_minutes: number; drafted_minutes: number }>(
  a: T,
  b: T,
): number => b.confirmed_minutes + b.drafted_minutes - (a.confirmed_minutes + a.drafted_minutes);

/**
 * One person's stretch of days — **no `can()` here**: each caller asks its own
 * question first, as `dayOf` does. Read day by day with the day view's own
 * readers (`entriesOn`, `draftsOn`), so a task the reader may not read is
 * never named here either: each is one indexed range, at most a quarter's.
 */
export function summaryOf(
  db: Db,
  userId: string,
  query: { from?: string | undefined; to?: string | undefined },
): TimeSummaryView {
  const days = stretch(query.from, query.to);
  const projects = new Map<string, SummaryProjectView>();
  const taskRows = new Map<string, SummaryTaskView>();
  const kinds = new Map<string, number>();
  const byDay: SummaryDayView[] = [];
  let meeting = 0;
  let manual = 0;

  const add = (
    task: TaskRef | null,
    project: ProjectRef | null,
    minutes: number,
    confirmed: boolean,
    untied = false,
  ): void => {
    const pKey = project?.id ?? '';
    const p = projects.get(pKey) ?? { project, confirmed_minutes: 0, drafted_minutes: 0 };
    const tKey = task?.id ?? `${untied ? 'untied' : 'none'}:${pKey}`;
    const t = taskRows.get(tKey) ?? {
      task,
      project,
      untied,
      confirmed_minutes: 0,
      drafted_minutes: 0,
    };
    if (confirmed) {
      p.confirmed_minutes += minutes;
      t.confirmed_minutes += minutes;
    } else {
      p.drafted_minutes += minutes;
      t.drafted_minutes += minutes;
    }
    projects.set(pKey, p);
    taskRows.set(tKey, t);
  };

  for (const day of days) {
    let confirmed = 0;
    let drafted = 0;
    for (const e of entriesOn(db, userId, day)) {
      confirmed += e.minutes;
      add(e.task, e.project, e.minutes, true);
      const kind = e.kind ?? '';
      kinds.set(kind, (kinds.get(kind) ?? 0) + e.minutes);
      if (e.kind === 'meeting') meeting += e.minutes;
      if (e.source === 'manual') manual += e.minutes;
    }
    for (const d of draftsOn(db, userId, day)) {
      drafted += d.minutes;
      add(d.task, d.project, d.minutes, false, d.task === null && !d.general);
      kinds.set('', (kinds.get('') ?? 0) + d.minutes);
    }
    byDay.push({ day, confirmed_minutes: confirmed, drafted_minutes: drafted });
  }

  return {
    from: days[0] ?? '',
    to: days.at(-1) ?? '',
    days: days.length,
    active_days: byDay.filter((d) => d.confirmed_minutes + d.drafted_minutes > 0).length,
    confirmed_minutes: byDay.reduce((n, d) => n + d.confirmed_minutes, 0),
    drafted_minutes: byDay.reduce((n, d) => n + d.drafted_minutes, 0),
    meeting_minutes: meeting,
    manual_minutes: manual,
    by_day: byDay,
    by_project: [...projects.values()].sort(byMinutes),
    by_task: [...taskRows.values()].sort(byMinutes),
    by_kind: [...kinds.entries()]
      .map(([kind, minutes]) => ({ kind: kind === '' ? null : (kind as TimeEntryKind), minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

/** `GET /me/time/summary?from=&to=`: the caller's own stretch, under the day view's questions. */
export function getMySummary(
  db: Db,
  actor: ResolvedActor,
  query: { from?: string | undefined; to?: string | undefined },
): TimeSummaryView {
  assertCan(actor, 'time_drafts.read_own');
  assertCan(actor, 'time_entries.read_own');
  return summaryOf(db, actor.userId, query);
}
