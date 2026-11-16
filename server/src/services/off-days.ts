import { and, asc, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type LeavePart, type LeaveStatus } from '../db/enums.ts';
import { hrPeople, leaveDays, orgHolidays, userAvailability } from '../db/schema.ts';
import { availabilityVisibleAmong, seesEveryonesAnalytics } from './availability-audience.ts';
import { addDays } from './calendar-days.ts';

/**
 * Holidays and leave on the reads that draw days (D-149 items 2, 5, 6 and 8,
 * SPEC §4.90, §4.91, LAI-1183): one fact per person and day — *a holiday
 * covers them*, *they are on leave* — decided here once, for My day, its
 * Week/Month/Year days, the Time logging grid and availability.
 *
 * ## The server sends facts, the client the verdict
 *
 * Nothing here says what is due. The grid's verdict is the client's (D-148
 * item 7): a holiday or approved whole-day leave owes nothing, approved
 * half-day leave owes half the threshold, pending leave changes nothing
 * (D-149 item 6) — and the facts it needs to say so are these.
 *
 * ## Which holiday covers whom
 *
 * A **manual** holiday covers every member (item 8). A **synced** one covers a
 * person only when `hr_people` maps them, and then only when every list its
 * scope names — departments, designations, employment types — includes
 * theirs; a person with no department is not in a holiday that names some.
 * The HR system's holidays are its own people's (item 2): Kvell's Clan is
 * CodeSage India's, and its holidays never reach a member who is not in it.
 * A manual holiday wins over a synced one on the same day; two synced ones
 * on one day, the first by label.
 *
 * ## Who sees whose leave
 *
 * **Leave is read only for the people whose availability the reader sees**
 * (D-137, `availability-audience.ts`) — anybody else's leave rows are never
 * selected. Its **type** only for the person, an owner, an admin or a holder
 * of *See everyone's analytics* (item 5); for anyone else it is `null`. A day
 * with approved and pending leave is approved: approved wins.
 *
 * Holidays are the organisation's, every member sees them, and they are not
 * narrowed by the reader.
 *
 * ## Removed rows are never read
 *
 * Both reads ask `removed_at IS NULL`: a holiday or a leave day gone from the
 * HR system, rejected, cancelled or removed by an owner is history, not a day
 * off (item 7).
 */

/** The holiday covering the day. */
export interface OffHolidayView {
  label: string;
}

/** The person's leave on the day — approved when any of it is. */
export interface OffLeaveView {
  /** `full`, or the half; two halves of the same status are `full`. */
  part: LeavePart;
  status: LeaveStatus;
  /** *Annual*, *Sick*… — null unless the reader may see why (D-149 item 5), or none was sent. */
  type: string | null;
}

/** One person's day off — at least one of the two is set; a day with neither is not served. */
export interface OffDayView {
  holiday: OffHolidayView | null;
  leave: OffLeaveView | null;
}

/** A day off on a list of days: the Time logging grid's `off_days`. */
export interface OffDayEntryView extends OffDayView {
  /** `YYYY-MM-DD`. */
  day: string;
}

/** The leave covering the person's today, in their zone, beside `away`. */
export interface OnLeaveView {
  /** The last day of the unbroken run of leave of this status from today. */
  until: string;
  status: LeaveStatus;
  /** Today's leave type — null unless the reader may see why (D-149 item 5). */
  type: string | null;
}

/** Per person, per day: only days with a holiday or leave are present. */
export type OffDays = Map<string, Map<string, OffDayView>>;

/**
 * Whether `viewer` may see why `subjectId` is on leave (D-149 item 5): the
 * person themselves, an owner, an admin, or a holder of *See everyone's
 * analytics*. A co-worker or a space's lead never sees why.
 */
export function seesLeaveTypeOf(viewer: ResolvedActor, subjectId: string): boolean {
  return (
    viewer.userId === subjectId ||
    viewer.orgRole === 'owner' ||
    viewer.orgRole === 'admin' ||
    seesEveryonesAnalytics(viewer)
  );
}

interface HolidayScope {
  departments?: unknown;
  designations?: unknown;
  employment_types?: unknown;
}

interface Mapped {
  departmentRef: string | null;
  designationRef: string | null;
  employmentType: string | null;
}

/** `undefined` for a scope that is not JSON or not an object: such a holiday covers nobody. */
function scopeOf(json: string | null): HolidayScope | null | undefined {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    // Every field of `HolidayScope` is `unknown`, so any object is one.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/** A list the scope does not name lets everyone through; one it names, only who it lists. */
function fits(list: unknown, value: string | null): boolean {
  if (list === undefined || list === null) return true;
  if (!Array.isArray(list)) return false;
  if (list.length === 0) return true;
  return value !== null && (list as unknown[]).includes(value);
}

function covers(scope: HolidayScope | null | undefined, person: Mapped): boolean {
  if (scope === undefined) return false;
  if (scope === null) return true;
  return (
    fits(scope.departments, person.departmentRef) &&
    fits(scope.designations, person.designationRef) &&
    fits(scope.employment_types, person.employmentType)
  );
}

const PART_ORDER: Readonly<Record<LeavePart, number>> = {
  full: 0,
  first_half: 1,
  second_half: 2,
};

interface LeaveRow {
  id: string;
  userId: string;
  day: string;
  part: LeavePart;
  status: LeaveStatus;
  typeName: string | null;
}

interface Resolved {
  part: LeavePart;
  status: LeaveStatus;
  typeName: string | null;
}

/**
 * One day's live leave rows, as one fact: approved when any row is, and of
 * the winning rows the whole day when one is whole or both halves are there.
 * Its type is the first row's, whole before halves, then by id — stable.
 */
function resolve(rows: readonly LeaveRow[]): Resolved {
  const approved = rows.filter((r) => r.status === 'approved');
  const winning = [...(approved.length > 0 ? approved : rows)].sort(
    (a, b) => PART_ORDER[a.part] - PART_ORDER[b.part] || (a.id < b.id ? -1 : 1),
  );
  const first = winning[0];
  if (first === undefined) throw new Error('resolve() needs a row');
  const parts = new Set(winning.map((r) => r.part));
  const part: LeavePart =
    parts.has('full') || (parts.has('first_half') && parts.has('second_half'))
      ? 'full'
      : first.part;
  return { part, status: first.status, typeName: first.typeName };
}

/** Live leave of `userIds` in `from`–`to`, inclusive, by person and day. */
function leaveByPersonDay(
  db: Db,
  userIds: readonly string[],
  from: string,
  to: string,
): Map<string, Map<string, LeaveRow[]>> {
  const out = new Map<string, Map<string, LeaveRow[]>>();
  if (userIds.length === 0) return out;
  for (const r of db
    .select({
      id: leaveDays.id,
      userId: leaveDays.userId,
      day: leaveDays.day,
      part: leaveDays.part,
      status: leaveDays.status,
      typeName: leaveDays.typeName,
    })
    .from(leaveDays)
    .where(
      and(
        inArray(leaveDays.userId, [...userIds]),
        gte(leaveDays.day, from),
        lte(leaveDays.day, to),
        isNull(leaveDays.removedAt),
      ),
    )
    .all()) {
    const days = out.get(r.userId) ?? new Map<string, LeaveRow[]>();
    const list = days.get(r.day) ?? [];
    list.push(r);
    days.set(r.day, list);
    out.set(r.userId, days);
  }
  return out;
}

/**
 * The holiday covering each of `userIds` on each day of `from`–`to`, by
 * person and day — the label, and only days that have one. A manual one
 * covers everyone; a synced one only people the HR system maps, in its scope;
 * a manual one wins, and two synced ones the first by label. One read of the
 * `(day)` index, and one of the HR people only when a synced holiday falls in
 * the stretch. Holidays are the organisation's: no reader narrows them.
 */
function holidaysFor(
  db: Db,
  userIds: readonly string[],
  from: string,
  to: string,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  if (userIds.length === 0 || from > to) return out;

  // A manual one each day at most (§4.90's partial unique index), and the
  // synced ones first by label.
  const manual = new Map<string, string>();
  const synced = new Map<string, { label: string; scope: HolidayScope | null | undefined }[]>();
  for (const h of db
    .select({
      id: orgHolidays.id,
      day: orgHolidays.day,
      label: orgHolidays.label,
      source: orgHolidays.source,
      scopeJson: orgHolidays.scopeJson,
    })
    .from(orgHolidays)
    .where(and(isNull(orgHolidays.removedAt), gte(orgHolidays.day, from), lte(orgHolidays.day, to)))
    .orderBy(asc(orgHolidays.day), asc(orgHolidays.label), asc(orgHolidays.id))
    .all()) {
    if (h.source === 'manual') {
      if (!manual.has(h.day)) manual.set(h.day, h.label);
      continue;
    }
    const list = synced.get(h.day) ?? [];
    list.push({ label: h.label, scope: scopeOf(h.scopeJson) });
    synced.set(h.day, list);
  }

  const mapped = new Map<string, Mapped>();
  if (synced.size > 0) {
    for (const p of db
      .select({
        userId: hrPeople.userId,
        departmentRef: hrPeople.departmentRef,
        designationRef: hrPeople.designationRef,
        employmentType: hrPeople.employmentType,
      })
      .from(hrPeople)
      .where(and(isNotNull(hrPeople.userId), inArray(hrPeople.userId, [...userIds])))
      .all()) {
      if (p.userId !== null) mapped.set(p.userId, p);
    }
  }

  for (const id of userIds) {
    const days = new Map(manual);
    const person = mapped.get(id);
    if (person !== undefined) {
      for (const [day, list] of synced) {
        if (manual.has(day)) continue;
        const first = list.find((h) => covers(h.scope, person));
        if (first !== undefined) days.set(day, first.label);
      }
    }
    if (days.size > 0) out.set(id, days);
  }
  return out;
}

/** The working week the Time logging grid holds a person to when they set none: Monday to Friday. */
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Each person's working days, ISO weekdays 1 (Monday) to 7 — their own when
 * they set any, else {@link DEFAULT_WORK_DAYS}: the Time logging grid's rule,
 * and the days a run of leave does not step over. One read of their rows.
 */
export function workDaysFor(db: Db, userIds: readonly string[]): Map<string, number[]> {
  const set = new Map(
    userIds.length === 0
      ? []
      : db
          .select({ userId: userAvailability.userId, workDays: userAvailability.workDays })
          .from(userAvailability)
          .where(inArray(userAvailability.userId, [...userIds]))
          .all()
          .map((r) => [r.userId, r.workDays]),
  );
  return new Map(
    userIds.map((id) => {
      const own = set.get(id);
      return [id, own !== undefined && own.length > 0 ? [...own] : [...DEFAULT_WORK_DAYS]];
    }),
  );
}

/** A calendar day's ISO weekday, 1 Monday to 7 Sunday. */
function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * `offDaysFor(db, viewer, userIds, from, to)`: each person's days off in
 * `from`–`to`, inclusive, as `viewer` may see them — **no `can()` here**:
 * every caller asks its own question first, as `availabilityFor`'s do.
 *
 * At most four reads, whatever the number of people or days: the holidays
 * (the `(day)` index), the people the HR system maps — only when a synced
 * holiday falls in the stretch — who the reader sees, and their leave (the
 * `(user_id, day)` index).
 */
export function offDaysFor(
  db: Db,
  viewer: ResolvedActor,
  userIds: readonly string[],
  from: string,
  to: string,
): OffDays {
  const out: OffDays = new Map();
  const ids = [...new Set(userIds)];
  if (ids.length === 0 || from > to) return out;

  const put = (userId: string, day: string, patch: Partial<OffDayView>): void => {
    const days = out.get(userId) ?? new Map<string, OffDayView>();
    days.set(day, { ...(days.get(day) ?? { holiday: null, leave: null }), ...patch });
    out.set(userId, days);
  };

  for (const [userId, days] of holidaysFor(db, ids, from, to)) {
    for (const [day, label] of days) put(userId, day, { holiday: { label } });
  }

  // Leave: only of the people whose availability the reader sees.
  const visible = [...availabilityVisibleAmong(db, viewer, ids)];
  for (const [userId, days] of leaveByPersonDay(db, visible, from, to)) {
    const shown = seesLeaveTypeOf(viewer, userId);
    for (const [day, rows] of days) {
      const r = resolve(rows);
      put(userId, day, {
        leave: { part: r.part, status: r.status, type: shown ? r.typeName : null },
      });
    }
  }
  return out;
}

/** One person's day off from an {@link offDaysFor} answer, or null. */
export function offOn(off: OffDays, userId: string, day: string): OffDayView | null {
  return off.get(userId)?.get(day) ?? null;
}

/** One person's days off from an {@link offDaysFor} answer, ascending, for a list of days. */
export function offEntries(off: OffDays, userId: string): OffDayEntryView[] {
  return [...(off.get(userId) ?? new Map<string, OffDayView>())]
    .map(([day, v]) => ({ day, holiday: v.holiday, leave: v.leave }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** How far past today a run of leave is followed: a little over a year. */
export const ON_LEAVE_MAX_DAYS = 400;

/**
 * Each person's leave covering their today — `today` is each person's own
 * date, from `todaysFor` — as `viewer` may see it, or null. Approved leave
 * beats pending.
 *
 * **`until` is the last day of the run**: the next day with leave of the same
 * status continues it, and a day the person does not owe — not one of their
 * working days ({@link workDaysFor}), or a holiday covering them — is stepped
 * over without ending it. A working day with no leave, or leave of the other
 * status, ends it; `until` is always a day with leave, never a day stepped
 * over. The walk stops {@link ON_LEAVE_MAX_DAYS} days out.
 *
 * Leave is read only for the people whose availability `viewer` sees: one
 * read of the `(user_id, day)` index over the walk's window; the working
 * days and holidays only for the people on leave today.
 */
export function onLeaveFor(
  db: Db,
  viewer: ResolvedActor,
  today: ReadonlyMap<string, string>,
): Map<string, OnLeaveView | null> {
  const ids = [...today.keys()];
  const out = new Map<string, OnLeaveView | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return out;
  const visible = [...availabilityVisibleAmong(db, viewer, ids)];
  if (visible.length === 0) return out;
  const todays = visible.map((id) => today.get(id) ?? '').sort();
  const earliest = todays[0] ?? '';
  const last = addDays(todays.at(-1) ?? earliest, ON_LEAVE_MAX_DAYS);

  const leave = leaveByPersonDay(db, visible, earliest, last);
  const onToday = visible.filter((id) => leave.get(id)?.has(today.get(id) ?? '') === true);
  if (onToday.length === 0) return out;
  const workDays = workDaysFor(db, onToday);
  const holidays = holidaysFor(db, onToday, earliest, last);

  for (const userId of onToday) {
    const day = today.get(userId) ?? '';
    const days = leave.get(userId) ?? new Map<string, LeaveRow[]>();
    const rows = days.get(day);
    if (rows === undefined) continue;
    const now = resolve(rows);
    const working = new Set(workDays.get(userId) ?? DEFAULT_WORK_DAYS);
    const covered = holidays.get(userId) ?? new Map<string, string>();
    const end = addDays(day, ON_LEAVE_MAX_DAYS);
    let until = day;
    for (let next = addDays(day, 1); next <= end; next = addDays(next, 1)) {
      const more = days.get(next);
      if (more !== undefined) {
        if (resolve(more).status !== now.status) break;
        until = next;
        continue;
      }
      // Nothing owed that day: the run steps over it.
      if (!working.has(isoWeekday(next)) || covered.has(next)) continue;
      break;
    }
    out.set(userId, {
      until,
      status: now.status,
      type: seesLeaveTypeOf(viewer, userId) ? now.typeName : null,
    });
  }
  return out;
}

/**
 * Of the people in `today` — each person's own date — those on **approved
 * whole-day leave** that day, as `viewer` may see their leave: what
 * `GET /people/availability?open_only=true` leaves out (LAI-1183). Half a day
 * off or a request still pending does not count. Two approved halves are the
 * whole day, as {@link offDaysFor} has it. One read of the leave, for the
 * people the reader sees.
 */
export function onWholeDayLeaveToday(
  db: Db,
  viewer: ResolvedActor,
  today: ReadonlyMap<string, string>,
): Set<string> {
  const off = new Set<string>();
  const ids = [...today.keys()];
  if (ids.length === 0) return off;
  const visible = [...availabilityVisibleAmong(db, viewer, ids)];
  if (visible.length === 0) return off;
  const todays = visible.map((id) => today.get(id) ?? '').sort();
  const leave = leaveByPersonDay(db, visible, todays[0] ?? '', todays.at(-1) ?? '');
  for (const [userId, days] of leave) {
    const rows = days.get(today.get(userId) ?? '');
    if (rows === undefined) continue;
    const now = resolve(rows);
    if (now.status === 'approved' && now.part === 'full') off.add(userId);
  }
  return off;
}
