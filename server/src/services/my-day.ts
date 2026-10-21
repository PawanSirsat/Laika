import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { timeDrafts, timeEntries } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { agentDay, type AgentDayView } from './agent-time.ts';
import { addDays, dayIn, isCalendarDay, isTimeZone } from './calendar-days.ts';
import { breaksOn, type TimeBreakView } from './time-breaks.ts';
import {
  draftsOn,
  draftZone,
  heldDrafts,
  signalTimesOn,
  type SignalTimesView,
  type TimeDraftView,
} from './time-drafts.ts';
import { entriesOn, type TimeEntryView } from './time-entries.ts';
import { getTimeSettings, type TimeSettingsView } from './time-settings.ts';

/**
 * My day (D-088 items 3, 8 and 12, SPEC §6.4, LAI-787): one person's own day —
 * the blocks their machine drafted and what agents proposed, the time they
 * confirmed, their agents' minutes, and the week around it. **Theirs alone, on
 * a web session**: `time_drafts.read_own` and `time_entries.read_own` refuse
 * every token, and nothing here takes a parameter that could name anybody else.
 *
 * ## One indexed query per section
 *
 * The drafts, the entries and the breaks are one range of `(user_id, day)`
 * each, the first two joined to their task and project by primary key; the
 * signal times one more range of the drafts' `(user_id, day)`, every state; the
 * drafts held on every day one range of `(user_id)`; the week is one grouped range of
 * each of the same two indexes; the agent minutes are two ranges of primary
 * keys that lead with `(user_id, day)`; the switches are two primary-key
 * reads. `my-day.test.ts` holds that with the work it counts.
 *
 * ## A day with nothing is *no signal*, never zero hours
 *
 * Nothing drafted and nothing confirmed says nothing reached Laika — the
 * collector was off, the machine asleep, the work was off-screen — not that
 * the person did no work. The day says so (the market report's rule), and the
 * page offers to add time by hand.
 */

export type DayState = 'confirmed' | 'drafted' | 'no_signal' | 'future';

/** One day of the week strip. */
export interface WeekDayView {
  day: string;
  confirmed_minutes: number;
  drafted_minutes: number;
  state: DayState;
}

/** `GET /me/time` (§6.4). */
export interface MyDayView {
  day: string;
  tz: string;
  /** Today in `tz`. */
  today: string;
  settings: TimeSettingsView;
  /** Pending drafts, in the order they happened. */
  drafts: TimeDraftView[];
  /** Live confirmed entries, in the order they happened. */
  entries: TimeEntryView[];
  /** Gaps the person waved away (LAI-831) — never time, never counted. */
  breaks: TimeBreakView[];
  /**
   * When the day's prompts and commits happened, by five minutes (D-096,
   * LAI-834): the SIGNALS lane. Empty for a day drafted without them.
   */
  signal_times: SignalTimesView;
  /**
   * Every pending draft the person holds, on every day (LAI-831): what turning
   * *Draft my time* off would delete, said before it is asked.
   */
  drafts_held: { count: number; minutes: number };
  /** Agent minutes — the agent's, never the person's hours (D-088 item 8). */
  agent: AgentDayView;
  state: DayState;
  /** Monday to Sunday around `day`. */
  week: WeekDayView[];
}

function stateOf(day: string, today: string, confirmed: number, drafted: number): DayState {
  if (drafted > 0) return 'drafted';
  if (confirmed > 0) return 'confirmed';
  return day > today ? 'future' : 'no_signal';
}

/** The Monday on or before a calendar day. */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * `GET /me/time?day=&tz=`: the caller's own day. Without `tz`, the zone their
 * drafts were made in; without `day`, today there.
 */
export function getMyDay(
  db: Db,
  actor: ResolvedActor,
  query: { day?: string | undefined; tz?: string | undefined },
  now: number = Date.now(),
): MyDayView {
  assertCan(actor, 'time_drafts.read_own');
  assertCan(actor, 'time_entries.read_own');
  const tz = query.tz ?? draftZone(db, actor.userId);
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const today = dayIn(tz, now);
  const day = query.day ?? today;
  if (!isCalendarDay(day)) {
    throw new ApiError('unprocessable', 'day is a calendar date, YYYY-MM-DD', { field: 'day' });
  }

  const settings = getTimeSettings(db, actor);
  const drafts = draftsOn(db, actor.userId, day);
  const entries = entriesOn(db, actor.userId, day);
  const breaks = breaksOn(db, actor.userId, day);
  const signalTimes = signalTimesOn(db, actor.userId, day);
  const held = heldDrafts(db, actor.userId);
  const agent = agentDay(db, actor.userId, day, tz);

  const monday = mondayOf(day);
  const sunday = addDays(monday, 6);
  const drafted = new Map(
    db
      .select({
        day: timeDrafts.day,
        minutes: sql<number>`coalesce(sum(${timeDrafts.minutes}), 0)`.mapWith(Number),
      })
      .from(timeDrafts)
      .where(
        and(
          eq(timeDrafts.userId, actor.userId),
          gte(timeDrafts.day, monday),
          lte(timeDrafts.day, sunday),
          eq(timeDrafts.state, 'pending'),
        ),
      )
      .groupBy(timeDrafts.day)
      .all()
      .map((r) => [r.day, r.minutes]),
  );
  const confirmed = new Map(
    db
      .select({
        day: timeEntries.day,
        minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`.mapWith(Number),
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, actor.userId),
          gte(timeEntries.day, monday),
          lte(timeEntries.day, sunday),
          isNull(timeEntries.deletedAt),
        ),
      )
      .groupBy(timeEntries.day)
      .all()
      .map((r) => [r.day, r.minutes]),
  );

  const week: WeekDayView[] = [];
  for (let d = monday; d <= sunday; d = addDays(d, 1)) {
    const c = confirmed.get(d) ?? 0;
    const p = drafted.get(d) ?? 0;
    week.push({ day: d, confirmed_minutes: c, drafted_minutes: p, state: stateOf(d, today, c, p) });
  }

  return {
    day,
    tz,
    today,
    settings,
    drafts,
    entries,
    breaks,
    signal_times: signalTimes,
    drafts_held: held,
    agent,
    state: stateOf(
      day,
      today,
      entries.reduce((n, e) => n + e.minutes, 0),
      drafts.reduce((n, d) => n + d.minutes, 0),
    ),
    week,
  };
}
