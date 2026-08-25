import type { Sprint, SprintInput } from '../../../api/sprints.ts';
import type { Task } from '../../../api/tasks.ts';

/**
 * The sprints screen's pure logic (LAI-083).
 *
 * Everything here is a function of its arguments, so it is testable in a
 * package with no component renderer (CONVENTIONS §4). The screen and the hook
 * hold React; this holds the arithmetic and the calendar, which is where the
 * mistakes are.
 *
 * **Nothing here decides whether an operation is allowed.** Non-overlap and
 * one-active-sprint belong to the server, which enforces them under a write
 * lock and refuses with a `409` naming the conflict. A client-side copy would
 * disagree the moment two people act at once — the exact case the lock exists
 * for — and would then be wrong in the most confusing way available: refusing
 * something the server would have accepted.
 */

/**
 * A task, plus the field the client type is missing.
 *
 * The server's `TaskView` has carried `sprint_id` since LAI-011 and
 * `GET /projects/:slug/tasks` returns it on every row. `api/tasks.ts` never
 * declared it, because the board is the only screen that reads tasks and the
 * board does not care — so the gap has been invisible.
 *
 * That file is Builder-B's, so this is a local declaration rather than a fix,
 * and **LAI-121** is filed to move it where it belongs. It is a type over data
 * that really is there, not a widening: `readSprintId` checks at runtime rather
 * than asserting, so a server that stopped sending it degrades to "no sprint"
 * instead of `undefined` leaking through a cast.
 */
export interface SprintTask extends Task {
  readonly sprint_id: string | null;
}

/** Read `sprint_id` off a task without trusting the client type to have it. */
export function readSprintId(task: Task): string | null {
  const value = (task as { sprint_id?: unknown }).sprint_id;
  return typeof value === 'string' ? value : null;
}

/** The single boundary where tasks gain the field. */
export function withSprintIds(tasks: readonly Task[]): SprintTask[] {
  return tasks.map((task) => ({ ...task, sprint_id: readSprintId(task) }));
}

/**
 * `ends_on` is the **last day of the sprint**, not the morning after (§4.15).
 *
 * A sprint that ends on the 14th includes the 14th, which is what a person
 * filling in the field means. Everything below follows from that, and it is the
 * single most likely thing to get quietly wrong: an exclusive reading makes
 * every duration one short and every date label one day early.
 */
export const END_IS_INCLUSIVE = true;

/** Milliseconds in a day. Dates here are date-only, held at UTC midnight. */
const DAY = 24 * 60 * 60 * 1000;

/**
 * `LAI-003`'s `CHECK (ends_on > starts_on)` makes a same-day sprint impossible,
 * so the shortest one expressible is two days. The form must not offer a range
 * the database will refuse.
 */
export const MIN_SPRINT_DAYS = 2;

/** `YYYY-MM-DD` (what `<input type="date">` speaks) → unix-ms at UTC midnight. */
export function dateInputToMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** unix-ms → `YYYY-MM-DD`, read in UTC so it round-trips `dateInputToMs`. */
export function msToDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Inclusive day count: a sprint from the 1st to the 14th is 14 days.
 *
 * The `+ 1` is the inclusive end. Without it every sprint reads one day short,
 * and the two-day minimum would look like a one-day minimum.
 */
export function sprintDays(startsOn: number, endsOn: number): number {
  return Math.round((endsOn - startsOn) / DAY) + 1;
}

/**
 * Whole days remaining, **counting the last day**.
 *
 * `END_IS_INCLUSIVE`, so a sprint whose `ends_on` is today has one day left,
 * not zero — the day you are standing in is still a day you can work. Both
 * sides are normalised to UTC midnight first, because `ends_on` is a date and
 * `now` is an instant; subtracting them raw makes the answer depend on the time
 * of day the page happens to be open.
 *
 * Never negative: a finished sprint has no days left, it does not have -3.
 */
export function daysLeft(endsOn: number, now: number): number {
  const today = new Date(now);
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((endsOn - midnight) / DAY) + 1);
}

/** `4 Aug – 17 Aug 2026` — one year when they share it, two when they do not. */
export function formatRange(startsOn: number, endsOn: number): string {
  const start = new Date(startsOn);
  const end = new Date(endsOn);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  const day = (d: Date, withYear: boolean): string =>
    d.toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });

  return `${day(start, !sameYear)} – ${day(end, true)}`;
}

export interface SprintProgress {
  readonly done: number;
  readonly total: number;
  /** 0–100, and `0` for an empty sprint rather than `NaN`. */
  readonly percent: number;
}

/**
 * Progress from the project's real tasks (§4.5 statuses).
 *
 * `cancelled` counts as neither done nor outstanding: it is work that will not
 * happen, so leaving it in the denominator makes a finished sprint read as
 * incomplete for ever. This is the one judgement call in the file, and it is
 * the reason `total` is not simply "tasks whose `sprint_id` is this one".
 */
export function progressFor(tasks: readonly Task[]): SprintProgress {
  const counted = tasks.filter((t) => t.status !== 'cancelled');
  const done = counted.filter((t) => t.status === 'done').length;
  const total = counted.length;

  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Tasks grouped by the sprint they are in. Unassigned tasks are under `null`. */
export function groupBySprint(tasks: readonly SprintTask[]): Map<string | null, SprintTask[]> {
  const bySprint = new Map<string | null, SprintTask[]>();

  for (const task of tasks) {
    const key = task.sprint_id;
    const bucket = bySprint.get(key);
    if (bucket === undefined) bySprint.set(key, [task]);
    else bucket.push(task);
  }

  return bySprint;
}

/**
 * Sprints in calendar order, matching the server's `ORDER BY (starts_on, id)`.
 *
 * The list is already ordered when it arrives; this exists so a locally-created
 * sprint lands in the right place without a refetch, and so the order is
 * asserted rather than assumed.
 */
export function inCalendarOrder(sprints: readonly Sprint[]): Sprint[] {
  return [...sprints].sort((a, b) => a.starts_on - b.starts_on || a.id.localeCompare(b.id));
}

export interface SprintFormValues {
  readonly name: string;
  readonly goal: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export type FormErrors = Partial<Record<keyof SprintFormValues, string>>;

/**
 * What the form can know is wrong **without asking the server**.
 *
 * Deliberately only the three things that are true of a single sprint in
 * isolation: a name, two parseable dates, and an end that is at least a day
 * after the start. Overlap with another sprint is **not** here — that depends
 * on rows this form cannot see and is the server's to refuse.
 */
export function validateSprintForm(values: SprintFormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.name.trim() === '') errors.name = 'Give the sprint a name.';
  else if (values.name.trim().length > 120) errors.name = 'Names are at most 120 characters.';

  if (values.goal.length > 500) errors.goal = 'Goals are at most 500 characters.';

  const startsOn = dateInputToMs(values.startsOn);
  const endsOn = dateInputToMs(values.endsOn);

  if (startsOn === null) errors.startsOn = 'Pick a start date.';
  if (endsOn === null) errors.endsOn = 'Pick an end date.';

  if (startsOn !== null && endsOn !== null && sprintDays(startsOn, endsOn) < MIN_SPRINT_DAYS) {
    // Not "end must be after start": the database refuses `ends_on = starts_on`,
    // so a same-day sprint is impossible and saying so is more use than a rule
    // the reader has to infer from a rejection.
    errors.endsOn = `The last day must be after the first — the shortest sprint is ${String(MIN_SPRINT_DAYS)} days.`;
  }

  return errors;
}

/** Form values → the request body. Only valid values reach this. */
export function toSprintInput(values: SprintFormValues): SprintInput | null {
  const startsOn = dateInputToMs(values.startsOn);
  const endsOn = dateInputToMs(values.endsOn);
  if (startsOn === null || endsOn === null) return null;

  const goal = values.goal.trim();

  return {
    name: values.name.trim(),
    // `null` clears it server-side; an empty string would be stored as one.
    goal: goal === '' ? null : goal,
    starts_on: startsOn,
    ends_on: endsOn,
  };
}

/** An existing sprint as form values, for the edit case. */
export function toFormValues(sprint: Sprint): SprintFormValues {
  return {
    name: sprint.name,
    goal: sprint.goal ?? '',
    startsOn: msToDateInput(sprint.starts_on),
    endsOn: msToDateInput(sprint.ends_on),
  };
}
