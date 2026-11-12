import { and, between, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { TIME_ENTRY_KINDS, type TimeEntryKind } from '../db/enums.ts';
import { agentTimeDays, projects, tasks, timeDrafts, timeEntries, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { readLoggedMany } from './analytics-views.ts';
import { csvLine } from './activity-csv.ts';
import { type ProjectRef, type TaskRef } from './time-entries.ts';
import { stretch, type SummaryDayView } from './time-summary.ts';

/**
 * `GET /api/v1/time/report` (D-130, LAI-1135): where time went over a stretch
 * of at most 92 days — for the caller, for people, or for the spaces a space
 * admin leads — as JSON or a CSV file.
 *
 * ## The server decides the scope
 *
 * Nothing in the query asks for one. `members` naming exactly the caller is
 * `own`, under the caller's own time actions. Anything else is `people`, which
 * needs `time.report.read` for the whole organisation or
 * `people.analytics.read` for each person named — both *See everyone's
 * analytics*. A caller with neither who leads a space gets `space_totals`
 * under §3.2's `time.report.read_project`: one space, whole weeks, one
 * figure a week (D-136; see {@link spaceWeeks}). Anyone else is `403`.
 *
 * ## The same figures as `GET /me/time/summary`
 *
 * Live entries (`deleted_at IS NULL`) and, with `drafts=include`, pending
 * drafts — `untied` exactly as `summaryOf` sets it — summed in SQL rather than
 * read day by day, so a quarter of the organisation is a handful of grouped
 * reads. A test holds one person's report equal to their summary.
 *
 * ## Nothing hidden is named
 *
 * A space the reader cannot open is `project: null`, and a task in one is
 * `task: null`: the minutes are counted and nothing about them is said.
 *
 * ## Every person shown is a look
 *
 * In `people`, each person `members` names, and each person a row names —
 * the reader aside — is logged as a look at their time (`kind: 'time'`, no
 * day) in the read's transaction, through `readLoggedMany` and its
 * ten-minute dedupe (D-135): a person named and shown nothing was still
 * looked at, and so is everybody whose agent time `agent_minutes` holds. `own` and
 * `space_totals` name nobody else and log nothing.
 */

/** JSON rows at most; past it, `422 report_too_large` — the CSV has no cap. */
export const REPORT_MAX_ROWS = 5000;
/** People one `members` list may name. */
export const REPORT_MAX_MEMBERS = 200;
/** D-088 item 7: a week shown to a space admin covers at least three people. */
export const REPORT_FLOOR_PEOPLE = 3;

export const REPORT_DRAFTS = ['exclude', 'include'] as const;
export type ReportDrafts = (typeof REPORT_DRAFTS)[number];

/**
 * Which time by what it is on (D-142, LAI-1163): on a task, general (logged
 * on no task on purpose — every confirmed entry without one, and drafts marked
 * general), or a draft not on a task yet. Absent is all three. Decided on the
 * raw `task_id`, so a task in a space the reader cannot see is still *on a task*.
 */
export const REPORT_LINKS = ['task', 'general', 'untied'] as const;
export type ReportLink = (typeof REPORT_LINKS)[number];

export type TimeReportScope = 'own' | 'people' | 'space_totals';

export interface TimeReportQuery {
  from?: string | undefined;
  to?: string | undefined;
  /** Comma-separated space slugs. */
  spaces?: string | undefined;
  /** Comma-separated user ids. */
  members?: string | undefined;
  /** Comma-separated `TIME_ENTRY_KINDS`. */
  kinds?: string | undefined;
  drafts?: ReportDrafts | undefined;
  link?: ReportLink | undefined;
}

/** The person on a report row. */
export interface TimeReportPerson {
  id: string;
  name: string;
  deactivated: boolean;
}

/** The finest grain: the client groups any two of space, member, task and kind. */
export interface TimeReportRowView {
  project: ProjectRef | null;
  user: TimeReportPerson;
  task: TaskRef | null;
  /** Drafted time nobody has put on anything yet, as `summaryOf` says it. */
  untied: boolean;
  kind: TimeEntryKind | null;
  confirmed_minutes: number;
  drafted_minutes: number;
}

export interface TimeReportView {
  from: string;
  to: string;
  days: number;
  scope: 'own' | 'people';
  include_drafts: boolean;
  totals: {
    confirmed_minutes: number;
    drafted_minutes: number;
    /** Confirmed time of the meeting kind. */
    meeting_minutes: number;
    /** Confirmed time typed by hand or run on a timer. */
    manual_minutes: number;
    active_days: number;
    /** People with any time in the report. */
    people: number;
  };
  /**
   * The agent working (`cli`) for the people in the report, beside human time
   * and never added to it (D-088 item 8) — `null` when `spaces` or `kinds`
   * narrow the report, which agent time cannot be split by.
   */
  agent_minutes: number | null;
  /** Every day of the stretch. */
  by_day: SummaryDayView[];
  rows: TimeReportRowView[];
}

/** One ISO week of one space: its confirmed minutes, `null` when under the floor. */
export interface SpaceWeekView {
  /** The Monday. */
  from: string;
  /** The Sunday. */
  to: string;
  confirmed_minutes: number | null;
  /** People with confirmed time in the space that week — a count, always served. */
  people: number;
}

/** A space admin's report (D-136): one space, one figure a week, nothing else. */
export interface SpaceWeeksReportView {
  from: string;
  to: string;
  scope: 'space_totals';
  project: ProjectRef;
  weeks: SpaceWeekView[];
}

/** What `GET /time/report` answers, by the scope the server chose. */
export type TimeReportAnswer = TimeReportView | SpaceWeeksReportView;

/** One CSV line's figures: a row on one day. */
interface DayRow extends TimeReportRowView {
  day: string;
}

export interface TimeReportCsv {
  filename: string;
  lines: Generator<string, void, undefined>;
}

/** The columns of `own` and `people`, in order. SPEC §6.4. */
export const REPORT_CSV_COLUMNS = [
  'day',
  'space',
  'task_key',
  'task_title',
  'person',
  'kind',
  'confirmed_minutes',
  'drafted_minutes',
] as const;

/** A space admin's file: the weeks, and nothing else (D-136). SPEC §6.4. */
export const SPACE_WEEKS_CSV_COLUMNS = [
  'week_start',
  'week_end',
  'space',
  'people',
  'confirmed_minutes',
] as const;

// ---------------------------------------------------------------- the query

function listOf(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const items = [...new Set(value.split(',').map((s) => s.trim()))].filter((s) => s !== '');
  return items.length === 0 ? null : items;
}

function kindsOf(value: string | undefined): TimeEntryKind[] | null {
  const items = listOf(value);
  if (items === null) return null;
  const known: readonly string[] = TIME_ENTRY_KINDS;
  const unknown = items.filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    throw new ApiError('unprocessable', `kinds are ${TIME_ENTRY_KINDS.join(', ')}`, {
      field: 'kinds',
      unknown,
    });
  }
  return items as TimeEntryKind[];
}

/** A space this reader may open, or the `404` a slug naming nothing gets. */
function readableSpace(db: Db, actor: ResolvedActor, slug: string): string {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get();
  if (row !== undefined && can(withProject(actor, row.id), 'project.read', { projectId: row.id })) {
    return row.id;
  }
  throw ApiError.notFound(`No project with slug "${slug}"`);
}

/** Whether the reader is a space admin of `projectId` — §3.2's lead, implicit or held. */
function leads(actor: ResolvedActor, projectId: string): boolean {
  return can(withProject(actor, projectId), 'time.report.read_project', { projectId });
}

interface Plan {
  scope: TimeReportScope;
  /** `null` = everyone. */
  userIds: string[] | null;
  /** `null` = every space. */
  projectIds: string[] | null;
  kinds: TimeEntryKind[] | null;
  includeDrafts: boolean;
  /** `null` = all time, whatever it is on. */
  link: ReportLink | null;
}

/**
 * Who the caller is to this report, asked of a **session-equivalent** actor
 * so a token is sent down the path it would take signed in — and refused
 * there `403 session_required`, every action here being session only.
 */
function plan(db: Db, actor: ResolvedActor, query: TimeReportQuery): Plan {
  const members = listOf(query.members);
  const slugs = listOf(query.spaces);
  const kinds = kindsOf(query.kinds);
  const includeDrafts = query.drafts === 'include';
  const link = query.link ?? null;
  if (members !== null && members.length > REPORT_MAX_MEMBERS) {
    throw new ApiError(
      'unprocessable',
      `members names at most ${String(REPORT_MAX_MEMBERS)} people`,
      { field: 'members', reason: 'too_many_members', max: REPORT_MAX_MEMBERS },
    );
  }

  const session: ResolvedActor = { ...actor, token: null };
  const others = members?.filter((id) => id !== actor.userId) ?? null;

  // The caller's own time, and nobody else's.
  if (members !== null && others !== null && others.length === 0) {
    assertCan(actor, 'time_entries.read_own');
    if (includeDrafts) assertCan(actor, 'time_drafts.read_own');
    return {
      scope: 'own',
      userIds: [actor.userId],
      projectIds: slugs?.map((s) => readableSpace(db, actor, s)) ?? null,
      kinds,
      includeDrafts,
      link,
    };
  }

  const people =
    others === null
      ? can(session, 'time.report.read')
      : others.every((id) => can(session, 'people.analytics.read', { targetUserId: id }));
  const lead =
    !people &&
    db
      .select({ id: projects.id })
      .from(projects)
      .all()
      .some((p) => leads(session, p.id));

  if (!lead) {
    // Per person: the whole organisation, or each person named.
    if (others === null) assertCan(actor, 'time.report.read');
    else for (const id of others) assertCan(actor, 'people.analytics.read', { targetUserId: id });
    if (others !== null) {
      const found = new Set(
        db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, others))
          .all()
          .map((u) => u.id),
      );
      const missing = others.find((id) => !found.has(id));
      if (missing !== undefined) throw ApiError.notFound(`No user with id "${missing}"`);
    }
    return {
      scope: 'people',
      userIds: members,
      projectIds: slugs?.map((s) => readableSpace(db, actor, s)) ?? null,
      kinds,
      includeDrafts,
      link,
    };
  }

  // A space admin's weeks (D-136): exactly one space — the one asked for, or
  // the only one they lead — and no person, kind or draft to narrow it by.
  const projectIds =
    slugs === null
      ? db
          .select({ id: projects.id })
          .from(projects)
          .all()
          .map((p) => p.id)
          .filter((id) => leads(session, id))
      : slugs.map((s) => readableSpace(db, actor, s));
  for (const id of projectIds) {
    assertCan(withProject(actor, id), 'time.report.read_project', { projectId: id });
  }
  if (projectIds.length !== 1) {
    throw new ApiError('unprocessable', 'A space admin reads one space at a time; name it', {
      field: 'spaces',
      reason: 'one_space_only',
    });
  }
  const refuse = (field: string, reason: string, message: string): never => {
    throw new ApiError('unprocessable', message, { field, reason });
  };
  if (members !== null)
    refuse('members', 'members_not_allowed', 'A space admin reads totals, with no person in them');
  if (kinds !== null)
    refuse('kinds', 'kinds_not_allowed', 'A space admin reads all of a week, not a kind');
  if (includeDrafts)
    refuse('drafts', 'drafts_not_allowed', 'A space admin reads confirmed time only');
  // A narrower total beside the whole would let a reader subtract under the floor.
  if (link !== null)
    refuse('link', 'link_not_allowed', 'A space admin reads all of a week, whatever it is on');
  return {
    scope: 'space_totals',
    userIds: null,
    projectIds,
    kinds: null,
    includeDrafts: false,
    link: null,
  };
}

// ---------------------------------------------------------------- the reads

/** One grouped figure, before anything is named. */
interface Raw {
  day: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  untied: boolean;
  kind: TimeEntryKind | null;
  minutes: number;
  confirmed: boolean;
  manual: boolean;
}

/**
 * The live entries of `userIds` (everyone's when null) filed on a day of the
 * stretch: `deleted_at IS NULL`, `day BETWEEN from AND to` — the stretch is
 * what `time_entries_user_day_idx` is ranged on. The report's extra filters
 * are pushed on by its caller.
 */
function liveEntriesWhere(userIds: readonly string[] | null, from: string, to: string): SQL[] {
  const where: SQL[] = [isNull(timeEntries.deletedAt), between(timeEntries.day, from, to)];
  if (userIds !== null) where.push(inArray(timeEntries.userId, [...userIds]));
  return where;
}

/** The pending drafts of `userIds` on a day of the stretch — `summaryOf`'s drafts. */
function pendingDraftsWhere(userIds: readonly string[] | null, from: string, to: string): SQL[] {
  const where: SQL[] = [eq(timeDrafts.state, 'pending'), between(timeDrafts.day, from, to)];
  if (userIds !== null) where.push(inArray(timeDrafts.userId, [...userIds]));
  return where;
}

/** One person's minutes on one day: live entries and pending drafts apart. */
export interface UserDayMinutes {
  userId: string;
  day: string;
  confirmed_minutes: number;
  drafted_minutes: number;
}

/**
 * Confirmed and drafted minutes per `(user, day)` over the stretch, for
 * `userIds` or for everyone (`null`) — the Time logging grid's cells (D-148,
 * LAI-1175), read with the report's two WHEREs and nothing narrower: live
 * entries and pending drafts, each summed in SQL. Rows in no particular
 * order; a day with no time has no row.
 */
export function minutesByUserDay(
  db: Db,
  query: { userIds: readonly string[] | null; from: string; to: string },
): UserDayMinutes[] {
  const { userIds, from, to } = query;
  if (userIds !== null && userIds.length === 0) return [];
  const out = new Map<string, UserDayMinutes>();
  const at = (userId: string, day: string): UserDayMinutes => {
    const key = `${userId}|${day}`;
    const row = out.get(key) ?? { userId, day, confirmed_minutes: 0, drafted_minutes: 0 };
    out.set(key, row);
    return row;
  };
  for (const r of db
    .select({
      userId: timeEntries.userId,
      day: timeEntries.day,
      minutes: sql<number>`sum(${timeEntries.minutes})`,
    })
    .from(timeEntries)
    .where(and(...liveEntriesWhere(userIds, from, to)))
    .groupBy(timeEntries.userId, timeEntries.day)
    .all()) {
    at(r.userId, r.day).confirmed_minutes += Number(r.minutes);
  }
  for (const r of db
    .select({
      userId: timeDrafts.userId,
      day: timeDrafts.day,
      minutes: sql<number>`sum(${timeDrafts.minutes})`,
    })
    .from(timeDrafts)
    .where(and(...pendingDraftsWhere(userIds, from, to)))
    .groupBy(timeDrafts.userId, timeDrafts.day)
    .all()) {
    at(r.userId, r.day).drafted_minutes += Number(r.minutes);
  }
  return [...out.values()];
}

function readRaw(db: Db, p: Plan, from: string, to: string): Raw[] {
  if (p.projectIds !== null && p.projectIds.length === 0) return [];
  const entryWhere = liveEntriesWhere(p.userIds, from, to);
  if (p.projectIds !== null) entryWhere.push(inArray(timeEntries.projectId, p.projectIds));
  if (p.kinds !== null) entryWhere.push(inArray(timeEntries.kind, p.kinds));
  // A confirmed entry is never *not on a task yet*: on one, or general.
  if (p.link === 'task') entryWhere.push(isNotNull(timeEntries.taskId));
  if (p.link === 'general') entryWhere.push(isNull(timeEntries.taskId));
  const minutes = sql<number>`sum(${timeEntries.minutes})`;
  const out: Raw[] = (
    p.link === 'untied'
      ? []
      : db
          .select({
            day: timeEntries.day,
            userId: timeEntries.userId,
            projectId: timeEntries.projectId,
            taskId: timeEntries.taskId,
            kind: timeEntries.kind,
            source: timeEntries.source,
            minutes,
          })
          .from(timeEntries)
          .where(and(...entryWhere))
          .groupBy(
            timeEntries.day,
            timeEntries.userId,
            timeEntries.projectId,
            timeEntries.taskId,
            timeEntries.kind,
            timeEntries.source,
          )
          .all()
  ).map((r) => ({
    day: r.day,
    userId: r.userId,
    projectId: r.projectId,
    taskId: r.taskId,
    untied: false,
    kind: r.kind,
    minutes: Number(r.minutes),
    confirmed: true,
    manual: r.source === 'manual',
  }));

  // A draft has no kind, so a report narrowed to kinds holds none.
  if (!p.includeDrafts || p.kinds !== null) return out;
  const draftWhere = pendingDraftsWhere(p.userIds, from, to);
  if (p.projectIds !== null) draftWhere.push(inArray(timeDrafts.projectId, p.projectIds));
  if (p.link === 'task') draftWhere.push(isNotNull(timeDrafts.taskId));
  if (p.link === 'general') draftWhere.push(isNull(timeDrafts.taskId), eq(timeDrafts.general, 1));
  if (p.link === 'untied') draftWhere.push(isNull(timeDrafts.taskId), eq(timeDrafts.general, 0));
  const drafted = sql<number>`sum(${timeDrafts.minutes})`;
  for (const r of db
    .select({
      day: timeDrafts.day,
      userId: timeDrafts.userId,
      projectId: timeDrafts.projectId,
      taskId: timeDrafts.taskId,
      general: timeDrafts.general,
      minutes: drafted,
    })
    .from(timeDrafts)
    .where(and(...draftWhere))
    .groupBy(
      timeDrafts.day,
      timeDrafts.userId,
      timeDrafts.projectId,
      timeDrafts.taskId,
      timeDrafts.general,
    )
    .all()) {
    out.push({
      day: r.day,
      userId: r.userId,
      projectId: r.projectId,
      taskId: r.taskId,
      // `summaryOf`'s rule: on no task, and not marked general.
      untied: r.taskId === null && r.general !== 1,
      kind: null,
      minutes: Number(r.minutes),
      confirmed: false,
      manual: false,
    });
  }
  return out;
}

/** The tasks the figures name, with their space — read by primary key, in chunks. */
function tasksById(
  db: Db,
  ids: readonly string[],
): Map<string, { ref: TaskRef; projectId: string }> {
  const out = new Map<string, { ref: TaskRef; projectId: string }>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const t of db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        projectId: tasks.projectId,
        prefix: projects.prefix,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(inArray(tasks.id, ids.slice(i, i + 500)))
      .all()) {
      out.set(t.id, {
        ref: { id: t.id, key: `${t.prefix}-${String(t.number)}`, title: t.title },
        projectId: t.projectId,
      });
    }
  }
  return out;
}

/**
 * The agent's working minutes for these people over the stretch, as My day
 * shows them: each person's day rounded, then summed — and whose they are, so
 * every person in the figure is logged as a look (LAI-1135 review round 2).
 */
function agentMinutes(
  db: Db,
  userIds: string[] | null,
  from: string,
  to: string,
): { minutes: number; people: string[] } {
  const where: SQL[] = [eq(agentTimeDays.kind, 'cli'), between(agentTimeDays.day, from, to)];
  if (userIds !== null) where.push(inArray(agentTimeDays.userId, userIds));
  const people = new Set<string>();
  let minutes = 0;
  for (const r of db
    .select({ userId: agentTimeDays.userId, seconds: sql<number>`sum(${agentTimeDays.seconds})` })
    .from(agentTimeDays)
    .where(and(...where))
    .groupBy(agentTimeDays.userId, agentTimeDays.day)
    .all()) {
    const day = Math.round(Number(r.seconds) / 60);
    if (day <= 0) continue;
    minutes += day;
    people.add(r.userId);
  }
  return { minutes, people: [...people] };
}

// ------------------------------------------------------------ the assembly

const total = (r: { confirmed_minutes: number; drafted_minutes: number }): number =>
  r.confirmed_minutes + r.drafted_minutes;

function rowKey(r: TimeReportRowView, day = ''): string {
  return [
    day,
    r.user.id,
    r.project?.id ?? '',
    r.task?.id ?? '',
    r.untied ? 'u' : '',
    r.kind ?? '',
  ].join('|');
}

function addTo<T extends TimeReportRowView>(
  rows: Map<string, T>,
  key: string,
  shape: T,
  minutes: number,
  confirmed: boolean,
): void {
  const row = rows.get(key) ?? shape;
  if (confirmed) row.confirmed_minutes += minutes;
  else row.drafted_minutes += minutes;
  rows.set(key, row);
}

function ordered<T extends TimeReportRowView>(rows: Iterable<T>): T[] {
  return [...rows].sort(
    (a, b) =>
      total(b) - total(a) ||
      a.user.name.localeCompare(b.user.name) ||
      (a.project?.slug ?? '').localeCompare(b.project?.slug ?? '') ||
      (a.task?.key ?? '').localeCompare(b.task?.key ?? '') ||
      (a.kind ?? '').localeCompare(b.kind ?? ''),
  );
}

interface Built {
  view: TimeReportView;
  dayRows: DayRow[];
  /** Whose agent time `agent_minutes` holds — looks, as the rows' people are. */
  agentPeople: string[];
}

function build(db: Db, actor: ResolvedActor, p: Plan, days: string[]): Built {
  const from = days[0] ?? '';
  const to = days.at(-1) ?? '';
  const raw = readRaw(db, p, from, to);

  const projectRows = db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .all();
  const projectRef = new Map<string, ProjectRef>(projectRows.map((r) => [r.id, r]));
  const visible = new Set(
    projectRows
      .map((r) => r.id)
      .filter((id) => can(withProject(actor, id), 'project.read', { projectId: id })),
  );
  const taskOf = tasksById(db, [
    ...new Set(raw.map((r) => r.taskId).filter((id): id is string => id !== null)),
  ]);
  const people = new Map(
    db
      .select({ id: users.id, name: users.name, isActive: users.isActive })
      .from(users)
      .all()
      .map((u) => [u.id, { id: u.id, name: u.name, deactivated: u.isActive === 0 }]),
  );

  // Named only where the reader may look: a hidden space or task is null.
  const shaped = raw.map((r) => {
    const project =
      r.projectId !== null && visible.has(r.projectId)
        ? (projectRef.get(r.projectId) ?? null)
        : null;
    const t = r.taskId === null ? undefined : taskOf.get(r.taskId);
    const task = t !== undefined && visible.has(t.projectId) ? t.ref : null;
    return { ...r, project, task };
  });

  const byDay = new Map<string, SummaryDayView>(
    days.map((day) => [day, { day, confirmed_minutes: 0, drafted_minutes: 0 }]),
  );
  let meeting = 0;
  let manual = 0;
  const contributors = new Set<string>();
  for (const r of shaped) {
    const d = byDay.get(r.day);
    if (d !== undefined) {
      if (r.confirmed) d.confirmed_minutes += r.minutes;
      else d.drafted_minutes += r.minutes;
    }
    if (r.confirmed && r.kind === 'meeting') meeting += r.minutes;
    if (r.confirmed && r.manual) manual += r.minutes;
    if (r.minutes > 0) contributors.add(r.userId);
  }
  const dayList = [...byDay.values()];

  const rows = new Map<string, TimeReportRowView>();
  const perDay = new Map<string, DayRow>();
  for (const r of shaped) {
    const shape: TimeReportRowView = {
      project: r.project,
      user: people.get(r.userId) ?? { id: r.userId, name: '', deactivated: true },
      task: r.task,
      untied: r.untied,
      kind: r.kind,
      confirmed_minutes: 0,
      drafted_minutes: 0,
    };
    addTo(rows, rowKey(shape), { ...shape }, r.minutes, r.confirmed);
    addTo(perDay, rowKey(shape, r.day), { ...shape, day: r.day }, r.minutes, r.confirmed);
  }

  const narrowed = p.projectIds !== null || p.kinds !== null || p.link !== null;
  const agent = narrowed ? null : agentMinutes(db, p.userIds, from, to);
  const view: TimeReportView = {
    from,
    to,
    days: days.length,
    scope: p.scope === 'own' ? 'own' : 'people',
    include_drafts: p.includeDrafts,
    totals: {
      confirmed_minutes: dayList.reduce((n, d) => n + d.confirmed_minutes, 0),
      drafted_minutes: dayList.reduce((n, d) => n + d.drafted_minutes, 0),
      meeting_minutes: meeting,
      manual_minutes: manual,
      active_days: dayList.filter((d) => total(d) > 0).length,
      people: contributors.size,
    },
    agent_minutes: agent?.minutes ?? null,
    by_day: dayList,
    rows: ordered(rows.values()),
  };
  const dayRows = [...perDay.values()].sort(
    (a, b) => a.day.localeCompare(b.day) || total(b) - total(a),
  );
  return { view, dayRows, agentPeople: agent?.people ?? [] };
}

// ------------------------------------------------ a space admin's weeks (D-136)

/** Whether `days` is whole ISO weeks: it starts on a Monday and is 7 × n long. */
function wholeWeeks(days: readonly string[]): boolean {
  const first = days[0];
  if (first === undefined) return false;
  return new Date(`${first}T00:00:00Z`).getUTCDay() === 1 && days.length % 7 === 0;
}

/**
 * A space admin's report (D-136, amending D-130 item 3): one space, whole ISO
 * weeks, and **one figure a week** — the space's confirmed minutes, `null`
 * unless at least three people **other than the reader** put time on it that
 * week — with the week's full head count. No range total, no task, kind or
 * day, no agent time.
 *
 * Why no subtraction gets under the floor. Every figure this can publish is
 * one `(space, ISO week)` cell, and a cell's value and its withholding are
 * decided by that cell's own entries and who is reading — never by the range,
 * the request or any other cell. So the same cell reads the same in every
 * answer that reader gets, and two cells never share an entry: they are
 * disjoint. A difference only isolates something when one published figure
 * contains another, and no published figure contains another, nor a sum of
 * others, because there is no total. A withheld cell is withheld in every
 * answer, and nothing it is part of is published, so it cannot be recovered
 * either. **The one thing a reader can always subtract is their own time**
 * (B5): a lead who logs in the space knows their own minutes, so a week they
 * worked in with two others would give those two away. Counting the floor
 * without the reader closes that — what is left after taking their own time
 * out still covers three people. The weeks are each entry's filed day,
 * Monday to Sunday — the person's own calendar day — so they do not move
 * with anybody's zone.
 */
function spaceWeeks(db: Db, p: Plan, days: string[], readerId: string): SpaceWeeksReportView {
  if (!wholeWeeks(days)) {
    throw new ApiError('unprocessable', 'A space admin reads whole weeks, Monday to Sunday', {
      field: 'from',
      reason: 'range_not_whole_weeks',
    });
  }
  const projectId = p.projectIds?.[0] ?? '';
  const project = db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (project === undefined) throw ApiError.notFound(`No project with id "${projectId}"`);

  const weekOf = new Map<string, number>(days.map((day, i) => [day, Math.floor(i / 7)]));
  const cells = Array.from({ length: days.length / 7 }, () => ({
    minutes: 0,
    people: new Set<string>(),
  }));
  for (const r of readRaw(db, p, days[0] ?? '', days.at(-1) ?? '')) {
    const cell = cells[weekOf.get(r.day) ?? -1];
    if (cell === undefined || !r.confirmed || r.minutes <= 0) continue;
    cell.minutes += r.minutes;
    cell.people.add(r.userId);
  }
  return {
    from: days[0] ?? '',
    to: days.at(-1) ?? '',
    scope: 'space_totals',
    project,
    weeks: cells.map((cell, i) => ({
      from: days[i * 7] ?? '',
      to: days[i * 7 + 6] ?? '',
      confirmed_minutes:
        [...cell.people].filter((id) => id !== readerId).length < REPORT_FLOOR_PEOPLE
          ? null
          : cell.minutes,
      people: cell.people.size,
    })),
  };
}

/**
 * Plan, read and log — the one path JSON and CSV share. A cap refused inside
 * the read rolls the transaction back, so a refused read is not a look.
 */
function report(
  db: Db,
  actor: ResolvedActor,
  query: TimeReportQuery,
  now: number,
  maxRows: number | null,
): Built | SpaceWeeksReportView {
  const days = stretch(query.from, query.to);
  const p = plan(db, actor, query);
  if (p.scope === 'space_totals') return spaceWeeks(db, p, days, actor.userId);
  const read = (): Built => {
    const built = build(db, actor, p, days);
    if (maxRows !== null && built.view.rows.length > maxRows) {
      throw new ApiError(
        'unprocessable',
        `The report has more than ${String(maxRows)} rows; narrow it, or ask for format=csv`,
        { reason: 'report_too_large', max_rows: maxRows, rows: built.view.rows.length },
      );
    }
    return built;
  };
  if (p.scope !== 'people') return read();
  // Everybody named is looked at, shown time or not; everybody shown; and
  // everybody whose agent time is in `agent_minutes`.
  const named = p.userIds ?? [];
  return readLoggedMany(
    db,
    actor,
    'time',
    read,
    (built) => [...named, ...built.view.rows.map((r) => r.user.id), ...built.agentPeople],
    () => null,
    now,
  );
}

/** `GET /time/report` — the JSON answer, at most {@link REPORT_MAX_ROWS} rows. */
export function getTimeReport(
  db: Db,
  actor: ResolvedActor,
  query: TimeReportQuery,
  now: number = Date.now(),
  maxRows: number = REPORT_MAX_ROWS,
): TimeReportAnswer {
  const answer = report(db, actor, query, now, maxRows);
  return 'weeks' in answer ? answer : answer.view;
}

/**
 * `GET /time/report?format=csv` — the same report as a file, one line per day
 * and row, no row cap. Planned, read and logged **before** the file starts,
 * so a refusal is an ordinary JSON error, never a `200` with an error inside.
 */
export function timeReportCsv(
  db: Db,
  actor: ResolvedActor,
  query: TimeReportQuery,
  now: number = Date.now(),
): TimeReportCsv {
  const answer = report(db, actor, query, now, null);
  if ('weeks' in answer) {
    const weeks = answer;
    function* weekLines(): Generator<string, void, undefined> {
      yield csvLine(SPACE_WEEKS_CSV_COLUMNS);
      for (const w of weeks.weeks) {
        yield csvLine([w.from, w.to, weeks.project.name, w.people, w.confirmed_minutes]);
      }
    }
    return { filename: `laika-time-${weeks.from}-${weeks.to}.csv`, lines: weekLines() };
  }
  const { view, dayRows } = answer;
  function* lines(): Generator<string, void, undefined> {
    yield csvLine(REPORT_CSV_COLUMNS);
    for (const r of dayRows) {
      yield csvLine([
        r.day,
        r.project?.name ?? null,
        r.task?.key ?? null,
        r.task?.title ?? null,
        r.user.name,
        r.kind,
        r.confirmed_minutes,
        r.drafted_minutes,
      ]);
    }
  }
  return { filename: `laika-time-${view.from}-${view.to}.csv`, lines: lines() };
}
