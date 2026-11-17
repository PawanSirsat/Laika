/**
 * Holidays and leave on the reads that draw days (D-149, LAI-1183's contract,
 * LAI-1184 and LAI-1185's screens). Mirrors `services/off-days.ts`; each of
 * the five views is paired in `test/api/view-type-drift.test.ts`.
 *
 * **The server sends facts, the client the verdict** (D-148 item 7): nothing
 * served says what a day owes. A holiday covering the person, or approved
 * whole-day leave, owes nothing; approved half-day leave owes half; pending
 * leave changes nothing (D-149 item 6) — {@link offOwes} says so once, for My
 * day and the Time logging grid alike.
 *
 * **No server colour is ever drawn** (D-149's consequences): Clan's leave-type
 * colours never reach Laika, and both screens paint holidays and leave in
 * their own tokens, `--holiday*` and `--leave*`, chosen by {@link offKind}.
 */

/** Leave's part of the day: the whole of it, or a half. */
export const LEAVE_PARTS = ['full', 'first_half', 'second_half'] as const;
export type LeavePart = (typeof LEAVE_PARTS)[number];

/** Approved in the HR system, or still waiting there. Rejected and cancelled leave is never sent. */
export const LEAVE_STATUSES = ['approved', 'pending'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** The holiday covering the day (`OffHolidayView`). */
export interface OffHoliday {
  readonly label: string;
}

/** The person's leave on the day — approved when any of it is (`OffLeaveView`). */
export interface OffLeave {
  /** `full`, or the half; two halves of the same status are `full`. */
  readonly part: LeavePart;
  readonly status: LeaveStatus;
  /** *Annual*, *Sick*… — null unless the reader may see why (D-149 item 5), or none was sent. */
  readonly type: string | null;
}

/** One person's day off — at least one of the two is set (`OffDayView`). */
export interface OffDay {
  readonly holiday: OffHoliday | null;
  readonly leave: OffLeave | null;
}

/** A day off on a list of days: the Time logging grid's `off_days` (`OffDayEntryView`). */
export interface OffDayEntry extends OffDay {
  /** `YYYY-MM-DD`. */
  readonly day: string;
}

/** The leave covering the person's today, beside `away` (`OnLeaveView`). */
export interface OnLeave {
  /** The last day of the unbroken run of leave of this status from today. */
  readonly until: string;
  readonly status: LeaveStatus;
  /** Today's leave type — null unless the reader may see why (D-149 item 5). */
  readonly type: string | null;
}

/**
 * Which tone a day off is drawn in: **a holiday wins**, then approved leave,
 * then pending leave, which is only *requested* — a dashed outline, never the
 * fill. Null for a day with neither.
 */
export type OffKind = 'holiday' | 'leave' | 'requested';

export function offKind(off: OffDay | null | undefined): OffKind | null {
  if (off === null || off === undefined) return null;
  if (off.holiday !== null) return 'holiday';
  if (off.leave === null) return null;
  return off.leave.status === 'approved' ? 'leave' : 'requested';
}

/** The half a part names, as a person says it; null for the whole day. */
export function leaveHalf(part: LeavePart): 'morning' | 'afternoon' | null {
  if (part === 'first_half') return 'morning';
  if (part === 'second_half') return 'afternoon';
  return null;
}

/**
 * The leave on its own, in words: *On leave*, *On leave · Annual*,
 * *On leave · morning*, *Leave requested*. The type only when it was sent —
 * the server sends it only to a reader who may see why.
 */
export function leaveLabel(leave: OffLeave): string {
  const head = leave.status === 'approved' ? 'On leave' : 'Leave requested';
  return [head, leave.type, leaveHalf(leave.part)]
    .filter((p): p is string => p !== null && p !== '')
    .join(' · ');
}

/**
 * The day off's label where there is room for one: the holiday's name when a
 * holiday covers the day — it wins, as in {@link offKind} — or the leave's.
 * Null for a day with neither.
 */
export function offLabel(off: OffDay | null | undefined): string | null {
  if (off === null || off === undefined) return null;
  if (off.holiday !== null) return off.holiday.label;
  if (off.leave !== null) return leaveLabel(off.leave);
  return null;
}

/**
 * Every fact about the day off, for a `title` or an accessible name: the
 * holiday, then the leave — *Heritage Day · On leave* — so nothing the server
 * sent is lost behind the winner. Null for a day with neither.
 */
export function offDescription(off: OffDay | null | undefined): string | null {
  if (off === null || off === undefined) return null;
  const parts = [off.holiday?.label ?? null, off.leave === null ? null : leaveLabel(off.leave)];
  const said = parts.filter((p): p is string => p !== null && p !== '');
  return said.length === 0 ? null : said.join(' · ');
}

/**
 * What a day off leaves owing (D-149 item 6): **nothing** under a holiday or
 * approved whole-day leave, **half** under approved half-day leave, **all** of
 * it otherwise — pending leave changes nothing.
 */
export type OffOwes = 'nothing' | 'half' | 'all';

export function offOwes(off: OffDay | null | undefined): OffOwes {
  if (off === null || off === undefined) return 'all';
  if (off.holiday !== null) return 'nothing';
  if (off.leave?.status !== 'approved') return 'all';
  return off.leave.part === 'full' ? 'nothing' : 'half';
}
