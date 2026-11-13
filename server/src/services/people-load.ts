import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AvailabilityStatus, type ProjectRole } from '../db/enums.ts';
import { projectMemberships, projects, tasks, timeEntries, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { visibleProjectIds } from './activity.ts';
import { readLogged } from './analytics-views.ts';
import { availabilityAudienceOf, type AvailabilityReader } from './availability-audience.ts';
import { availabilityFor, type AvailabilityView, todaysFor } from './availability.ts';
import { addDays } from './calendar-days.ts';
import { type OnLeaveView } from './off-days.ts';
import { type ProjectRef } from './time-entries.ts';
import { summaryOf } from './time-summary.ts';

/**
 * Who has room, read by the people who decide where work goes (SPEC §6.4,
 * D-131, LAI-1130): one person's load, and the organisation's availability
 * list.
 *
 * ## Facts, never a score
 *
 * D-088 item 1 and D-131: **no free hours, no utilisation, no ranking**. The
 * load is hours by space, card counts, and this week's tracked minutes beside
 * the minutes the person set — two numbers, never one subtracted from the
 * other. The list is A–Z by name and has **no sort parameter**: the route's
 * query schema is strict, so `?sort=` is a `422`, not a quietly ignored ask.
 *
 * ## Hours are the person's, and every look at them is logged
 *
 * Minutes per person ride *See everyone's analytics* (`people.analytics.read`,
 * D-102), the owner always and an admin by default. Each read writes the
 * `analytics_views` row the person sees on `GET /me/analytics-views`, kind
 * `time`, in the read's transaction — through `readLogged`, as every other
 * people read logs today. (D-135's ten-minute dedupe is LAI-1129's.)
 */

/** How far back the load and the list count time: two weeks of the person's days. */
export const LOAD_WINDOW_DAYS = 14;
/** The most people one availability list answers; beyond it is a `422`. */
export const AVAILABILITY_LIST_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LoadProjectView {
  /** Null for time on no space, and for the folded row of spaces you cannot open. */
  project: ProjectRef | null;
  /** True on the one row that folds every space the reader cannot open. */
  hidden: boolean;
  /** Their role in the space; null where they are not a member. */
  role: ProjectRole | null;
  confirmed_minutes: number;
  drafted_minutes: number;
}

export interface LoadCardsView {
  in_progress: number;
  in_review: number;
  /** Open cards assigned to them due from the reader's UTC today through the next six days. */
  due_7d: number;
}

export interface LoadWeekView {
  /** Monday and Sunday of the person's current week, in their own dates. */
  from: string;
  to: string;
  confirmed_minutes: number;
  drafted_minutes: number;
  /** The working minutes the person set for a week; null when they set none. */
  set_minutes: number | null;
}

/** `GET /people/:id/load`. */
export interface PersonLoadView {
  availability: AvailabilityView | null;
  /** The last 14 of the person's days, every space they are in. */
  projects: LoadProjectView[];
  cards: LoadCardsView;
  week: LoadWeekView;
  /** Current and upcoming away periods. */
  away: { from: string; to: string }[];
}

/**
 * What a member sees of someone who shares a space with them (D-137): what
 * they said, and when they are back — never their hours, their working week
 * or their plans further out.
 */
export interface MemberAvailabilityView {
  status: AvailabilityStatus | null;
  note: string | null;
  tags: string[];
  /** The end of the period covering the person's today, or null. */
  away: { until: string } | null;
  /**
   * The HR system's leave covering their today (D-149 item 5, LAI-1183) —
   * *On leave* or *Leave requested*; its type only for a reader who may see
   * why, null for anyone else.
   */
  on_leave: OnLeaveView | null;
}

/**
 * What a space admin sees of someone in a space they lead (D-137): the
 * member's view, the hours a week the person offered, and their current and
 * upcoming away dates — no working week, no period ids.
 */
export interface LeadAvailabilityView extends MemberAvailabilityView {
  hours_per_week: number | null;
  away_periods: { from: string; to: string }[];
}

/** One person on `GET /people/availability`. */
export interface AvailabilityRowView {
  user: { id: string; name: string };
  /**
   * Narrowed to the reader (D-137): the whole record for *See everyone's
   * analytics*, `LeadAvailabilityView` for a space admin, and
   * `MemberAvailabilityView` for anyone else — for every row, the reader's own
   * included, whose whole record is `GET /me/availability`.
   */
  availability: AvailabilityView | LeadAvailabilityView | MemberAvailabilityView | null;
  /** The spaces they are in that the reader can open, A–Z. */
  spaces: ProjectRef[];
  /** Their `in_progress` cards — absent for a reader who leads no space. */
  in_progress?: number;
  /** Confirmed minutes over their last 14 days — present only with *See everyone's analytics*. */
  last_2_weeks_minutes?: number;
}

export interface AvailabilityListView {
  data: AvailabilityRowView[];
}

export interface AvailabilityListQuery {
  space?: string | undefined;
  tag?: string | undefined;
  open_only?: boolean | undefined;
}

// ------------------------------------------------------------------ shared

/** Tasks assigned to these people, per person, in the given spaces. */
function cardsOf(
  db: Db,
  userIds: readonly string[],
  projectIds: readonly string[],
): { assigneeId: string | null; status: string; dueOn: number | null }[] {
  if (userIds.length === 0 || projectIds.length === 0) return [];
  return db
    .select({ assigneeId: tasks.assigneeId, status: tasks.status, dueOn: tasks.dueOn })
    .from(tasks)
    .where(and(inArray(tasks.assigneeId, [...userIds]), inArray(tasks.projectId, [...projectIds])))
    .all();
}

function projectRefs(db: Db, ids: readonly string[]): Map<string, ProjectRef> {
  if (ids.length === 0) return new Map();
  return new Map(
    db
      .select({ id: projects.id, slug: projects.slug, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, [...ids]))
      .all()
      .map((p) => [p.id, p]),
  );
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }): number =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

// -------------------------------------------------------------------- load

/** Monday of the week `day` falls in. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * `GET /people/:id/load` — under `people.analytics.read`, **never yourself**
 * (your own is `/me`'s), asked before the person is looked up so a caller who
 * may not ask cannot tell a real id from a made-up one. Logged `time`.
 */
export function getPersonLoad(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  now: number = Date.now(),
): PersonLoadView {
  assertCan(actor, 'people.analytics.read', { targetUserId: userId });
  const person = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (person === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
  return readLogged(
    db,
    actor,
    userId,
    'time',
    () => loadOf(db, actor, userId, now),
    () => null,
    now,
  );
}

function loadOf(db: Db, actor: ResolvedActor, userId: string, now: number): PersonLoadView {
  const today = todaysFor(db, [userId], now).get(userId) ?? '';
  const visible = new Set(visibleProjectIds(db, actor));

  // Hours by space: `summaryOf`'s by_project — the person's own My day
  // assembly — so the two cannot disagree.
  const window = summaryOf(db, userId, {
    from: addDays(today, -(LOAD_WINDOW_DAYS - 1)),
    to: today,
  });
  const roles = new Map(
    db
      .select({ projectId: projectMemberships.projectId, role: projectMemberships.role })
      .from(projectMemberships)
      .where(eq(projectMemberships.userId, userId))
      .all()
      .map((m) => [m.projectId, m.role]),
  );
  const minutes = new Map(window.by_project.map((p) => [p.project?.id ?? '', p]));
  const refs = projectRefs(db, [...roles.keys()]);

  const shown: LoadProjectView[] = [];
  const folded = { confirmed: 0, drafted: 0, any: false };
  for (const id of new Set([...roles.keys(), ...minutes.keys()])) {
    const spent = minutes.get(id);
    const confirmed = spent?.confirmed_minutes ?? 0;
    const drafted = spent?.drafted_minutes ?? 0;
    if (id === '') {
      shown.push({
        project: null,
        hidden: false,
        role: null,
        confirmed_minutes: confirmed,
        drafted_minutes: drafted,
      });
    } else if (visible.has(id)) {
      const project = spent?.project ?? refs.get(id);
      if (project === undefined || project === null) continue;
      shown.push({
        project: { id: project.id, slug: project.slug, name: project.name },
        hidden: false,
        role: roles.get(id) ?? null,
        confirmed_minutes: confirmed,
        drafted_minutes: drafted,
      });
    } else {
      folded.any = true;
      folded.confirmed += confirmed;
      folded.drafted += drafted;
    }
  }
  shown.sort(
    (a, b) =>
      Number(a.project === null) - Number(b.project === null) ||
      (a.project?.name ?? '').localeCompare(b.project?.name ?? ''),
  );
  if (folded.any) {
    shown.push({
      project: null,
      hidden: true,
      role: null,
      confirmed_minutes: folded.confirmed,
      drafted_minutes: folded.drafted,
    });
  }

  // Card counts over the spaces the reader can open. `due_7d` is the reader's
  // UTC day, as the board's due dates are UTC midnights (§4.5).
  const startOfDay = Math.floor(now / DAY_MS) * DAY_MS;
  const cards = cardsOf(db, [userId], [...visible]);
  const open = (s: string): boolean => s !== 'done' && s !== 'cancelled';

  const availability = availabilityFor(db, actor, [userId], now).get(userId) ?? null;
  const from = mondayOf(today);
  const to = addDays(from, 6);
  const week = summaryOf(db, userId, { from, to });

  return {
    availability,
    projects: shown,
    cards: {
      in_progress: cards.filter((c) => c.status === 'in_progress').length,
      in_review: cards.filter((c) => c.status === 'review').length,
      due_7d: cards.filter(
        (c) =>
          open(c.status) &&
          c.dueOn !== null &&
          c.dueOn >= startOfDay &&
          c.dueOn < startOfDay + 7 * DAY_MS,
      ).length,
    },
    week: {
      from,
      to,
      confirmed_minutes: week.confirmed_minutes,
      drafted_minutes: week.drafted_minutes,
      set_minutes: availability?.work_week?.minutes ?? null,
    },
    away: (availability?.away_periods ?? []).map((p) => ({ from: p.from, to: p.to })),
  };
}

// -------------------------------------------------------------------- list

type Reader = AvailabilityReader;

/**
 * Each reader's view of somebody else's availability (D-137), **built from an
 * allow-list**: a field added to `AvailabilityView` reaches nobody here until
 * it is named below.
 */
function memberView(a: AvailabilityView): MemberAvailabilityView {
  return { status: a.status, note: a.note, tags: a.tags, away: a.away, on_leave: a.on_leave };
}

function leadView(a: AvailabilityView): LeadAvailabilityView {
  return {
    ...memberView(a),
    hours_per_week: a.hours_per_week,
    away_periods: a.away_periods.map((p) => ({ from: p.from, to: p.to })),
  };
}

const PROJECTIONS: Readonly<
  Record<Reader, (a: AvailabilityView) => AvailabilityRowView['availability']>
> = {
  people: (a) => a,
  lead: leadView,
  member: memberView,
};

/**
 * `GET /people/availability?space=&tag=&open_only=` under `availability.read`
 * — every role, session only — in one of three shapes, decided by the reader:
 *
 *  - **`people`**, *See everyone's analytics*: every active person who is not
 *    an org viewer, with `in_progress` over the spaces the reader opens and
 *    `last_2_weeks_minutes`. Every person listed is logged as a look at their
 *    time, in the read's transaction.
 *  - **`lead`**, a space admin: the people in the spaces they lead, with
 *    `in_progress` counted in those spaces only, and `LeadAvailabilityView`.
 *    **No tracked hours** (D-130 item 3) and no working week (D-137).
 *  - **`member`**, anyone else: the people who share a space with them, with
 *    `MemberAvailabilityView` and `spaces` only (D-137).
 *
 * Deactivated people are never listed. A–Z by name, and no other order.
 */
export function listPeopleAvailability(
  db: Db,
  actor: ResolvedActor,
  query: AvailabilityListQuery,
  now: number = Date.now(),
): AvailabilityListView {
  assertCan(actor, 'availability.read');

  const people = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.isActive, 1), ne(users.orgRole, 'viewer')))
    .all();
  const memberships = db
    .select({
      projectId: projectMemberships.projectId,
      userId: projectMemberships.userId,
    })
    .from(projectMemberships)
    .all();
  const visible = new Set(visibleProjectIds(db, actor));

  // Who the reader sees is `availability-audience.ts`' one rule (D-137) —
  // the same answer every read carrying a person's leave gets (LAI-1183).
  // The list is `availability.read`, session only, so a token never reaches it.
  const { reader, led } = availabilityAudienceOf(db, actor);

  // Which spaces decide who is listed, and where cards are counted.
  const own = new Set(actor.memberships.map((m) => m.projectId));
  const scope = reader === 'people' ? visible : reader === 'lead' ? led : own;
  const spacesOf = new Map<string, Set<string>>();
  for (const m of memberships) {
    const set = spacesOf.get(m.userId) ?? new Set<string>();
    set.add(m.projectId);
    spacesOf.set(m.userId, set);
  }

  let only: string | null = null;
  if (query.space !== undefined) {
    const space = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, query.space))
      .get();
    if (space === undefined || !visible.has(space.id)) {
      throw ApiError.notFound(`No project with slug "${query.space}"`);
    }
    only = space.id;
  }

  let rows = people.filter((p) => {
    const theirs = spacesOf.get(p.id) ?? new Set<string>();
    if (only !== null && !theirs.has(only)) return false;
    return reader === 'people' || [...theirs].some((id) => scope.has(id));
  });

  const availability = availabilityFor(
    db,
    actor,
    rows.map((r) => r.id),
    now,
  );
  if (query.tag !== undefined) {
    const tag = query.tag.trim().toLowerCase();
    rows = rows.filter((r) =>
      (availability.get(r.id)?.tags ?? []).some((t) => t.toLowerCase() === tag),
    );
  }
  if (query.open_only === true) {
    rows = rows.filter((r) => {
      const a = availability.get(r.id);
      return a?.status === 'open' && a.away === null;
    });
  }
  if (rows.length > AVAILABILITY_LIST_MAX) {
    throw new ApiError(
      'unprocessable',
      `At most ${String(AVAILABILITY_LIST_MAX)} people in one list; narrow it by space or tag`,
      { reason: 'too_many_people', max: AVAILABILITY_LIST_MAX },
    );
  }
  rows.sort(byName);

  const ids = rows.map((r) => r.id);
  const refs = projectRefs(db, [...visible]);
  const inProgress = new Map<string, number>();
  if (reader !== 'member') {
    for (const card of cardsOf(db, ids, [...scope])) {
      if (card.status !== 'in_progress' || card.assigneeId === null) continue;
      inProgress.set(card.assigneeId, (inProgress.get(card.assigneeId) ?? 0) + 1);
    }
  }

  const narrow = PROJECTIONS[reader];
  const project = (a: AvailabilityView | null): AvailabilityRowView['availability'] =>
    a === null ? null : narrow(a);
  const build = (minutes: Map<string, number> | null): AvailabilityListView => ({
    data: rows.map((r) => {
      const row: AvailabilityRowView = {
        user: { id: r.id, name: r.name },
        availability: project(availability.get(r.id) ?? null),
        spaces: [...(spacesOf.get(r.id) ?? [])]
          .map((id) => refs.get(id))
          .filter((p): p is ProjectRef => p !== undefined)
          .sort(byName),
      };
      if (reader !== 'member') row.in_progress = inProgress.get(r.id) ?? 0;
      if (minutes !== null) row.last_2_weeks_minutes = minutes.get(r.id) ?? 0;
      return row;
    }),
  });

  if (reader !== 'people') return build(null);

  // Hours: one read for everyone, and one logged look per person, all in the
  // read's transaction — a list that cannot be logged is not answered.
  return db.transaction(() => {
    const view = build(confirmedLastTwoWeeks(db, ids, now));
    for (const id of ids)
      readLogged(
        db,
        actor,
        id,
        'time',
        () => null,
        () => null,
        now,
      );
    return view;
  });
}

/** Confirmed minutes over each person's last 14 of their own days. */
function confirmedLastTwoWeeks(
  db: Db,
  userIds: readonly string[],
  now: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const today = todaysFor(db, userIds, now);
  const fromOf = new Map([...today].map(([id, d]) => [id, addDays(d, -(LOAD_WINDOW_DAYS - 1))]));
  const earliest = [...fromOf.values()].sort()[0] ?? '';
  for (const e of db
    .select({ userId: timeEntries.userId, day: timeEntries.day, minutes: timeEntries.minutes })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.userId, [...userIds]),
        gte(timeEntries.day, earliest),
        isNull(timeEntries.deletedAt),
      ),
    )
    .all()) {
    if (e.day < (fromOf.get(e.userId) ?? '') || e.day > (today.get(e.userId) ?? '')) continue;
    out.set(e.userId, (out.get(e.userId) ?? 0) + e.minutes);
  }
  return out;
}
