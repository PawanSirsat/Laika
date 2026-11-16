import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type OrgRole } from '../db/enums.ts';
import { projectMemberships, timeDrafts, timeEntries, users } from '../db/schema.ts';
import { assertCan, can } from '../policy/can.ts';
import { readLoggedMany } from './analytics-views.ts';
import { zonesFor } from './availability.ts';
import { dayIn } from './calendar-days.ts';
import {
  DEFAULT_WORK_DAYS,
  offDaysFor,
  offEntries,
  type OffDayEntryView,
  workDaysFor,
} from './off-days.ts';
import { minutesByUserDay, REPORT_MAX_MEMBERS } from './time-report.ts';
import { stretch } from './time-summary.ts';

/**
 * `GET /api/v1/time/days` (D-148, LAI-1175): the Time logging grid — people
 * by calendar day over a stretch of at most 92 days, each cell the minutes
 * they logged that day, for the client to set against a flat eight hours.
 *
 * ## Who is shown to whom
 *
 * An owner, or a holder of *See everyone's analytics* (`time.report.read`),
 * reads everyone: `scope: 'people'`. A space admin with no such grant reads
 * the people of the spaces **a membership row says they lead** under §3.2's
 * `time.days.read_project` — themselves included, so their own row is on the
 * same grid — `scope: 'lead'`; the implicit lead an org grant confers over
 * every space does not open this door. Each person's cells hold their
 * **whole day, whichever spaces the time was on** — an eight-hour day is the
 * person's, not a space's. A member who leads nothing is `403`, by
 * `time.report.read`, as the Time report refuses them. Every action is
 * session only.
 *
 * ## The server sends facts, the client the verdict
 *
 * `threshold_minutes` is served, never assumed by the client. Each person
 * carries their zone, the day they joined and today in that zone, and their
 * working days — so a client needs no zone arithmetic to say which days were
 * due. **The day they joined is the earlier of the day their account was made
 * and their first day with any time** (LAI-1177): an account made by an import
 * carries months of earlier time, and that time was due when it was logged,
 * not only from the day the import ran. Days are each person's own filed days (`time_entries.day`), as every
 * time read counts them. Cells hold live entries and **pending** drafts,
 * apart, read through {@link minutesByUserDay} — the Time report's own two
 * WHEREs. Agent time is never read (D-088 item 8).
 *
 * Each person's working days are `off-days.ts`' `workDaysFor` — their own,
 * else Monday to Friday — the rule a run of leave steps over days by too
 * (LAI-1183), so the two cannot hold a person to different weeks.
 *
 * ## Days off are facts too
 *
 * Each person carries `off_days` — the days in the stretch a holiday covers
 * them or they are on leave (D-149, LAI-1183, `offDaysFor`), only the days
 * that have one. What such a day owes stays the client's verdict (D-149 item
 * 6): nothing here changes `threshold_minutes` or any cell. The type of leave
 * is the reader's to see or not — an owner, an admin or *See everyone's
 * analytics* sees it; a space lead reading their people's rows does not.
 *
 * ## Deactivated people, and the cap
 *
 * A deactivated person is listed only with minutes in the stretch, flagged,
 * and the client gives them no due days — `users` keeps no leaving date, so
 * their working days would otherwise count on for ever. People are A–Z by
 * name then id (D-088 item 1), at most {@link REPORT_MAX_MEMBERS}, and a cut
 * list says `truncated`.
 *
 * ## Every person shown is a look
 *
 * Each person on the grid, the reader aside, is one §4.59 `time` look with no
 * day, in the read's transaction and deduped over ten minutes (D-135) — the
 * Time report's `readLoggedMany`. A refusal rolls the transaction back, so a
 * refused read is not a look; and the people past the cap, never shown, are
 * never logged.
 */

/** D-148 item 2: a full working day, for the client's verdict — and nowhere else. */
export const TIME_LOGGING_THRESHOLD_MINUTES = 480;

export interface TimeLoggingQuery {
  from?: string | undefined;
  to?: string | undefined;
}

/** One day with time on it; a day with none has no row. */
export interface TimeLoggingDayView {
  day: string;
  confirmed_minutes: number;
  drafted_minutes: number;
}

/** The person on a grid row — their role beside their name, as the design's rows carry it. */
export interface TimeLoggingUser {
  id: string;
  name: string;
  org_role: OrgRole;
  deactivated: boolean;
}

export interface TimeLoggingPersonView {
  user: TimeLoggingUser;
  /** The person's place's IANA zone; `UTC` when they set none. */
  zone: string;
  /** The day they accepted their invite, in their zone: nothing is due before it. */
  joined_day: string;
  /** Today in their zone: nothing is due on or after it. */
  today_day: string;
  /** ISO weekdays, 1 Monday to 7 Sunday — their own, or Monday to Friday. */
  work_days: number[];
  /** Ascending. */
  days: TimeLoggingDayView[];
  /** The stretch's days a holiday covers them or they are on leave, ascending; no other day (D-149). */
  off_days: OffDayEntryView[];
}

export interface TimeLoggingView {
  from: string;
  to: string;
  /** Everyone, or the people of the spaces the reader leads. */
  scope: 'people' | 'lead';
  threshold_minutes: number;
  /** A–Z by name, then id. */
  people: TimeLoggingPersonView[];
  /** More people than {@link REPORT_MAX_MEMBERS} had a row; the list was cut A–Z. */
  truncated: boolean;
}

interface Scope {
  scope: TimeLoggingView['scope'];
  /** `null` = everyone. */
  candidates: string[] | null;
}

/**
 * Who the reader is to this grid, asked of a **session-equivalent** actor so
 * a token is sent down the path it would take signed in and refused there
 * `403 session_required` — `time-report.ts`' `plan()`, for one answer.
 */
function scopeOf(db: Db, actor: ResolvedActor): Scope {
  const session: ResolvedActor = { ...actor, token: null };
  if (can(session, 'time.report.read')) {
    assertCan(actor, 'time.report.read');
    return { scope: 'people', candidates: null };
  }
  // "The spaces they lead" (D-148 item 4) are the ones a membership row says
  // they lead — never the implicit lead an org grant confers over every
  // space, which would hand an admin whose role lost *See everyone's
  // analytics* everybody's days by another door. `can()` is still asked, so
  // a token is refused there as `session_required`.
  const led = actor.memberships
    .filter((m) => m.role === 'lead')
    .map((m) => m.projectId)
    .filter((id) => can(withProject(session, id), 'time.days.read_project', { projectId: id }));
  // A lead of nothing is a member: the Time report's own refusal.
  if (led.length === 0) assertCan(actor, 'time.report.read');
  for (const id of led) {
    assertCan(withProject(actor, id), 'time.days.read_project', { projectId: id });
  }
  return { scope: 'lead', candidates: ledPeople(db, led) };
}

/**
 * The distinct members of `led`. The reader is among them without being
 * added: `led` holds only spaces the reader has a lead membership row in, so
 * their own row is on the grid with their people's by construction.
 */
function ledPeople(db: Db, led: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const m of db
    .select({ userId: projectMemberships.userId })
    .from(projectMemberships)
    .where(inArray(projectMemberships.projectId, [...led]))
    .all()) {
    ids.add(m.userId);
  }
  return [...ids];
}

interface Candidate {
  id: string;
  name: string;
  orgRole: OrgRole;
  deactivated: boolean;
  createdAt: Date;
}

function candidatesOf(db: Db, ids: readonly string[] | null): Candidate[] {
  if (ids !== null && ids.length === 0) return [];
  const q = db
    .select({
      id: users.id,
      name: users.name,
      orgRole: users.orgRole,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users);
  return (ids === null ? q.all() : q.where(inArray(users.id, [...ids])).all()).map((u) => ({
    id: u.id,
    name: u.name,
    orgRole: u.orgRole,
    deactivated: u.isActive === 0,
    createdAt: u.createdAt,
  }));
}

/**
 * Each shown person's first filed day across all time — a live entry or a
 * pending draft, whichever is earlier — or nothing when they never logged.
 * Two grouped reads, over all days, never the stretch: the stretch decides
 * what is shown, not when somebody started.
 */
function firstDaysFor(db: Db, ids: readonly string[]): Map<string, string> {
  const first = new Map<string, string>();
  if (ids.length === 0) return first;
  const take = (userId: string, day: string | null): void => {
    if (day === null) return;
    const had = first.get(userId);
    if (had === undefined || day < had) first.set(userId, day);
  };
  for (const r of db
    .select({ userId: timeEntries.userId, day: sql<string | null>`min(${timeEntries.day})` })
    .from(timeEntries)
    .where(and(isNull(timeEntries.deletedAt), inArray(timeEntries.userId, [...ids])))
    .groupBy(timeEntries.userId)
    .all()) {
    take(r.userId, r.day);
  }
  for (const r of db
    .select({ userId: timeDrafts.userId, day: sql<string | null>`min(${timeDrafts.day})` })
    .from(timeDrafts)
    .where(and(eq(timeDrafts.state, 'pending'), inArray(timeDrafts.userId, [...ids])))
    .groupBy(timeDrafts.userId)
    .all()) {
    take(r.userId, r.day);
  }
  return first;
}

/** The earlier of two `YYYY-MM-DD` days; the one given when the other is missing. */
function earlierDay(a: string, b: string | undefined): string {
  return b !== undefined && b < a ? b : a;
}

function build(db: Db, actor: ResolvedActor, days: string[], now: number): TimeLoggingView {
  const from = days[0] ?? '';
  const to = days.at(-1) ?? '';
  const { scope, candidates } = scopeOf(db, actor);

  // Candidates → minutes → drop the deactivated with nothing to show → A–Z →
  // the cap. The names are needed for the order, so the people are read
  // before the cut; the per-person facts only for those left after it.
  const byPerson = new Map<string, TimeLoggingDayView[]>();
  for (const r of minutesByUserDay(db, { userIds: candidates, from, to })) {
    if (r.confirmed_minutes + r.drafted_minutes <= 0) continue;
    const list = byPerson.get(r.userId) ?? [];
    list.push({
      day: r.day,
      confirmed_minutes: r.confirmed_minutes,
      drafted_minutes: r.drafted_minutes,
    });
    byPerson.set(r.userId, list);
  }
  const listed = candidatesOf(db, candidates)
    .filter((c) => !c.deactivated || byPerson.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const shown = listed.slice(0, REPORT_MAX_MEMBERS);
  const ids = shown.map((c) => c.id);
  const zones = zonesFor(db, ids);
  const workDays = workDaysFor(db, ids);
  const firstDays = firstDaysFor(db, ids);
  const off = offDaysFor(db, actor, ids, from, to);

  return {
    from,
    to,
    scope,
    threshold_minutes: TIME_LOGGING_THRESHOLD_MINUTES,
    people: shown.map((c) => {
      const zone = zones.get(c.id) ?? 'UTC';
      return {
        user: { id: c.id, name: c.name, org_role: c.orgRole, deactivated: c.deactivated },
        zone,
        joined_day: earlierDay(dayIn(zone, c.createdAt.getTime()), firstDays.get(c.id)),
        today_day: dayIn(zone, now),
        work_days: workDays.get(c.id) ?? [...DEFAULT_WORK_DAYS],
        days: (byPerson.get(c.id) ?? []).sort((a, b) => a.day.localeCompare(b.day)),
        off_days: offEntries(off, c.id),
      };
    }),
    truncated: listed.length > shown.length,
  };
}

/** `GET /time/days` — the grid, every person shown logged as a look. */
export function getTimeLogging(
  db: Db,
  actor: ResolvedActor,
  query: TimeLoggingQuery,
  now: number = Date.now(),
): TimeLoggingView {
  const days = stretch(query.from, query.to);
  return readLoggedMany(
    db,
    actor,
    'time',
    () => build(db, actor, days, now),
    (view) => view.people.map((p) => p.user.id),
    () => null,
    now,
  );
}
