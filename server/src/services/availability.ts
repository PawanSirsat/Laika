import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { AVAILABILITY_STATUSES, type AvailabilityStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { userAvailability, userAwayPeriods, userTimeSettings } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { daysBetween, dayIn, isCalendarDay, isTimeZone } from './calendar-days.ts';

/**
 * A person's own availability (SPEC §4.85, §4.86, §6.4, D-131, LAI-1130):
 * whether they are open to more work, optional hours a week, a note, tags,
 * their working week and the days they are away.
 *
 * ## The person's declaration, and nobody else's
 *
 * Every write here is the caller's own row, under `availability.set_own` —
 * session only, so an agent cannot say its person has room. There is no
 * route, action or argument that names another person to write for.
 *
 * ## Nothing computed
 *
 * D-131 item 4 and D-088 item 1: **no free hours, no utilisation**. The
 * working week's `minutes` is the person's own declaration multiplied out —
 * days times the length of their day — never set against what they tracked.
 *
 * ## Away is derived
 *
 * There is no *away* status. `away` is the period covering **today in the
 * person's own zone** — their `place` (§4.46), UTC when they set none — so a
 * person in Auckland is back on their own Monday, not London's.
 */

export const AVAILABILITY_NOTE_MAX = 140;
export const AVAILABILITY_TAGS_MAX = 8;
export const AVAILABILITY_TAG_MAX = 32;
export const AVAILABILITY_HOURS_MIN = 1;
export const AVAILABILITY_HOURS_MAX = 80;
/** Current and upcoming away periods one person may hold. */
export const AWAY_PERIODS_MAX = 20;
/** The longest one away period runs, inclusive. */
export const AWAY_PERIOD_MAX_DAYS = 366;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The person's working week; `minutes` is days × the length of their day. */
export interface WorkWeekView {
  /** ISO weekdays, 1 Monday to 7 Sunday, ascending. */
  days: number[];
  start: string | null;
  end: string | null;
  /** Null until both start and end are set. */
  minutes: number | null;
}

export interface AwayPeriodView {
  id: string;
  from: string;
  to: string;
}

/** `GET /me/availability`, and the `availability` of every people read. */
export interface AvailabilityView {
  /** `open` or `capacity`; null until the person says either. */
  status: AvailabilityStatus | null;
  /** The period covering today in the person's zone, or null. */
  away: { until: string } | null;
  hours_per_week: number | null;
  note: string | null;
  tags: string[];
  work_week: WorkWeekView | null;
  /** Current and upcoming periods, earliest first. Past ones are not shown. */
  away_periods: AwayPeriodView[];
  /** When the person last changed any of it; null when they never have. */
  updated_at: number | null;
}

export interface WorkWeekInput {
  days: number[];
  start: string | null;
  end: string | null;
}

export interface AvailabilityInput {
  status?: AvailabilityStatus | null | undefined;
  hours_per_week?: number | null | undefined;
  note?: string | null | undefined;
  tags?: string[] | undefined;
  work_week?: WorkWeekInput | null | undefined;
}

const EMPTY: AvailabilityView = {
  status: null,
  away: null,
  hours_per_week: null,
  note: null,
  tags: [],
  work_week: null,
  away_periods: [],
  updated_at: null,
};

function invalid(field: string, reason: string, message: string): ApiError {
  return new ApiError('unprocessable', message, { field, reason });
}

function minutesOf(clock: string): number {
  const [h, m] = clock.split(':');
  return Number(h) * 60 + Number(m);
}

/** The person's today: their place's date, UTC's when they set none. */
function zoneOf(place: string | null | undefined): string {
  return place !== null && place !== undefined && isTimeZone(place) ? place : 'UTC';
}

/** Each person's today, by id — one read of their places. */
export function todaysFor(db: Db, userIds: readonly string[], now: number): Map<string, string> {
  const places = new Map(
    userIds.length === 0
      ? []
      : db
          .select({ userId: userTimeSettings.userId, place: userTimeSettings.place })
          .from(userTimeSettings)
          .where(inArray(userTimeSettings.userId, [...userIds]))
          .all()
          .map((r) => [r.userId, r.place]),
  );
  return new Map(userIds.map((id) => [id, dayIn(zoneOf(places.get(id)), now)]));
}

function workWeekView(
  days: number[],
  start: string | null,
  end: string | null,
): WorkWeekView | null {
  if (days.length === 0 && start === null) return null;
  const minutes =
    start !== null && end !== null ? days.length * (minutesOf(end) - minutesOf(start)) : null;
  return { days, start, end, minutes };
}

/**
 * Everyone's availability in `userIds`, by id — `null` for a person who has
 * set nothing and has no current or upcoming away period. Three reads,
 * whatever the number of people. **No `can()` here**: every caller asks its
 * own question first, as `summaryOf`'s do.
 */
export function availabilityFor(
  db: Db,
  userIds: readonly string[],
  now: number,
): Map<string, AvailabilityView | null> {
  const out = new Map<string, AvailabilityView | null>();
  if (userIds.length === 0) return out;
  const ids = [...userIds];
  const today = todaysFor(db, ids, now);
  const earliest = [...today.values()].sort()[0] ?? '';

  const rows = new Map(
    db
      .select()
      .from(userAvailability)
      .where(inArray(userAvailability.userId, ids))
      .all()
      .map((r) => [r.userId, r]),
  );
  const periods = new Map<string, AwayPeriodView[]>();
  for (const p of db
    .select()
    .from(userAwayPeriods)
    .where(and(inArray(userAwayPeriods.userId, ids), gte(userAwayPeriods.toDay, earliest)))
    .orderBy(asc(userAwayPeriods.fromDay), asc(userAwayPeriods.id))
    .all()) {
    if (p.toDay < (today.get(p.userId) ?? '')) continue;
    const list = periods.get(p.userId) ?? [];
    list.push({ id: p.id, from: p.fromDay, to: p.toDay });
    periods.set(p.userId, list);
  }

  for (const id of ids) {
    const row = rows.get(id);
    const own = periods.get(id) ?? [];
    if (row === undefined && own.length === 0) {
      out.set(id, null);
      continue;
    }
    const day = today.get(id) ?? '';
    const covering = own
      .filter((p) => p.from <= day && p.to >= day)
      .sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    out.set(id, {
      ...EMPTY,
      ...(row === undefined
        ? {}
        : {
            status: row.status,
            hours_per_week: row.hoursPerWeek,
            note: row.note,
            tags: row.tags,
            work_week: workWeekView(row.workDays, row.workStart, row.workEnd),
            updated_at: row.updatedAt,
          }),
      away: covering === undefined ? null : { until: covering.to },
      away_periods: own,
    });
  }
  return out;
}

/** One person's view, never null: a person who set nothing reads the empty view. */
function viewOf(db: Db, userId: string, now: number): AvailabilityView {
  return availabilityFor(db, [userId], now).get(userId) ?? EMPTY;
}

/** `GET /me/availability`. */
export function getMyAvailability(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
): AvailabilityView {
  assertCan(actor, 'availability.set_own');
  return viewOf(db, actor.userId, now);
}

// ------------------------------------------------------------- validation

function checkStatus(value: AvailabilityStatus | null): AvailabilityStatus | null {
  if (value !== null && !AVAILABILITY_STATUSES.includes(value)) {
    throw invalid('status', 'unknown_status', 'status is open or capacity');
  }
  return value;
}

function checkHours(value: number | null): number | null {
  if (value === null) return null;
  if (
    !Number.isInteger(value) ||
    value < AVAILABILITY_HOURS_MIN ||
    value > AVAILABILITY_HOURS_MAX
  ) {
    throw invalid(
      'hours_per_week',
      'out_of_range',
      `hours_per_week is a whole number from ${String(AVAILABILITY_HOURS_MIN)} to ${String(AVAILABILITY_HOURS_MAX)}`,
    );
  }
  return value;
}

/** A blank note is no note. */
function checkNote(value: string | null): string | null {
  if (value === null) return null;
  const note = value.trim();
  if (note.length === 0) return null;
  if (note.length > AVAILABILITY_NOTE_MAX) {
    throw invalid(
      'note',
      'too_long',
      `A note is at most ${String(AVAILABILITY_NOTE_MAX)} characters`,
    );
  }
  return note;
}

/** Trimmed, de-duplicated case-insensitively (the first spelling kept), at most eight. */
function checkTags(value: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    const tag = raw.trim();
    if (tag.length === 0 || tag.length > AVAILABILITY_TAG_MAX) {
      throw invalid(
        'tags',
        'tag_length',
        `A tag is 1 to ${String(AVAILABILITY_TAG_MAX)} characters`,
      );
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > AVAILABILITY_TAGS_MAX) {
    throw invalid('tags', 'too_many', `At most ${String(AVAILABILITY_TAGS_MAX)} tags`);
  }
  return tags;
}

function checkWorkWeek(value: WorkWeekInput | null): {
  days: number[];
  start: string | null;
  end: string | null;
} {
  if (value === null) return { days: [], start: null, end: null };
  for (const d of value.days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw invalid('work_week.days', 'not_a_weekday', 'A working day is 1 (Monday) to 7 (Sunday)');
    }
  }
  const days = [...new Set(value.days)].sort((a, b) => a - b);
  const { start, end } = value;
  if ((start === null) !== (end === null)) {
    throw invalid('work_week.end', 'start_and_end', 'Send both start and end, or neither');
  }
  if (start !== null && !CLOCK.test(start)) {
    throw invalid('work_week.start', 'not_a_time', 'start is HH:MM');
  }
  if (end !== null && !CLOCK.test(end)) {
    throw invalid('work_week.end', 'not_a_time', 'end is HH:MM');
  }
  if (start !== null && end !== null && end <= start) {
    throw invalid('work_week.end', 'end_before_start', 'end is after start');
  }
  return { days, start, end };
}

/**
 * `PUT /me/availability` — a merge: a field left out keeps its value, `null`
 * clears it. `updated_at` moves only when something changed, so a client
 * saving the same form twice does not tell anyone the person said something new.
 */
export function setMyAvailability(
  db: Db,
  actor: ResolvedActor,
  input: AvailabilityInput,
  now: number = Date.now(),
): AvailabilityView {
  assertCan(actor, 'availability.set_own');
  const before = db
    .select()
    .from(userAvailability)
    .where(eq(userAvailability.userId, actor.userId))
    .get();

  const status =
    input.status === undefined ? (before?.status ?? null) : checkStatus(input.status);
  const hoursPerWeek =
    input.hours_per_week === undefined
      ? (before?.hoursPerWeek ?? null)
      : checkHours(input.hours_per_week);
  const note = input.note === undefined ? (before?.note ?? null) : checkNote(input.note);
  const tags = input.tags === undefined ? (before?.tags ?? []) : checkTags(input.tags);
  const week =
    input.work_week === undefined
      ? {
          days: before?.workDays ?? [],
          start: before?.workStart ?? null,
          end: before?.workEnd ?? null,
        }
      : checkWorkWeek(input.work_week);

  const next = {
    status,
    hoursPerWeek,
    note,
    tags,
    workDays: week.days,
    workStart: week.start,
    workEnd: week.end,
  };
  const same =
    before !== undefined &&
    before.status === next.status &&
    before.hoursPerWeek === next.hoursPerWeek &&
    before.note === next.note &&
    JSON.stringify(before.tags) === JSON.stringify(next.tags) &&
    JSON.stringify(before.workDays) === JSON.stringify(next.workDays) &&
    before.workStart === next.workStart &&
    before.workEnd === next.workEnd;

  if (!same) {
    db.insert(userAvailability)
      .values({ userId: actor.userId, ...next, updatedAt: now })
      .onConflictDoUpdate({
        target: userAvailability.userId,
        set: { ...next, updatedAt: now },
      })
      .run();
  }
  return viewOf(db, actor.userId, now);
}

/**
 * `POST /me/availability/away` — a period the person is away, inclusive at
 * both ends, in their own dates. One that ended before their today is
 * refused, `away_in_past`: there is nobody to tell about it.
 */
export function addAwayPeriod(
  db: Db,
  actor: ResolvedActor,
  input: { from: string; to: string },
  now: number = Date.now(),
): AvailabilityView {
  assertCan(actor, 'availability.set_own');
  if (!isCalendarDay(input.from)) {
    throw invalid('from', 'not_a_date', 'from is a calendar date, YYYY-MM-DD');
  }
  if (!isCalendarDay(input.to)) {
    throw invalid('to', 'not_a_date', 'to is a calendar date, YYYY-MM-DD');
  }
  if (input.to < input.from) throw invalid('to', 'range_backwards', 'to is on or after from');
  if (daysBetween(input.from, input.to) + 1 > AWAY_PERIOD_MAX_DAYS) {
    throw invalid(
      'to',
      'range_too_long',
      `An away period is at most ${String(AWAY_PERIOD_MAX_DAYS)} days`,
    );
  }
  const today = todaysFor(db, [actor.userId], now).get(actor.userId) ?? '';
  if (input.to < today) throw invalid('to', 'away_in_past', 'That period has already ended');

  const held = db
    .select({ id: userAwayPeriods.id })
    .from(userAwayPeriods)
    .where(and(eq(userAwayPeriods.userId, actor.userId), gte(userAwayPeriods.toDay, today)))
    .all().length;
  if (held >= AWAY_PERIODS_MAX) {
    throw new ApiError(
      'unprocessable',
      `At most ${String(AWAY_PERIODS_MAX)} current and upcoming away periods`,
      { reason: 'too_many_away_periods', max: AWAY_PERIODS_MAX },
    );
  }

  db.insert(userAwayPeriods)
    .values({
      id: newId(),
      userId: actor.userId,
      fromDay: input.from,
      toDay: input.to,
      createdAt: now,
    })
    .run();
  return viewOf(db, actor.userId, now);
}

/**
 * `DELETE /me/availability/away/:id` — the caller's own period only. Anybody
 * else's is the `404` of one that does not exist.
 */
export function deleteAwayPeriod(db: Db, actor: ResolvedActor, id: string): void {
  assertCan(actor, 'availability.set_own');
  const gone = db
    .delete(userAwayPeriods)
    .where(and(eq(userAwayPeriods.id, id), eq(userAwayPeriods.userId, actor.userId)))
    .run();
  if (gone.changes === 0) throw ApiError.notFound(`No away period "${id}"`);
}
