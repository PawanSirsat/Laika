import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { requireOrgId } from '../db/orgs.ts';
import {
  orgTimeSettings,
  projects,
  solidtimeEntries,
  solidtimePeople,
  solidtimeProjects,
  tasks,
  timeEntries,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addDays, dayIn, isCalendarDay, isTimeZone } from './calendar-days.ts';
import { requireProjectBySlug } from './projects.ts';
import { resolveKeys } from './token-usage.ts';
import {
  assertEntryDay,
  DAY_MINUTES,
  ENTRY_DAYS_BACK,
  insertEntry,
  retireEntry,
  syncEntry,
  taskRefOf,
  type EntryFields,
  type Target,
  type Tx,
} from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';

/**
 * The Solidtime bridge, the server's half (D-088 items 6 and 10, SPEC
 * §4.52–§4.54 and §6.4, LAI-788).
 *
 * **The server never calls Solidtime** (§13.4). The person's own CLI holds
 * their Solidtime key on their machine, reads and writes Solidtime itself,
 * and tells the board what it did: what to write comes out of the *outbox*,
 * what it wrote goes back as *links*, and what it read comes in as an
 * *import*. Every Solidtime fact here arrived in one of those requests.
 *
 * ## Signed in, never a token
 *
 * The outbox is the person's confirmed hours, and §3.1 serves those to no
 * token — so every function here is a `SESSION_ONLY_ACTIONS` row, and the CLI
 * signs in with the person's password for each run and keeps no session.
 *
 * ## No duplicates, either way
 *
 * Solidtime has no idempotency key, no external id, no `updated_at` and no
 * soft delete. `solidtime_entries` is what Laika last took from, or wrote to,
 * each Solidtime entry: one row per Solidtime id, at most one per Laika entry.
 * A pull re-reads a window whole and compares — a different `hash` is an
 * edit, an id missing is a delete — and an entry the person pushed comes back
 * as the same entry, whichever CLI reads it. The CLI's own sent-log and its
 * check of what Solidtime already holds cover the gap between its write and
 * this record.
 *
 * ## Once there, Solidtime is the record
 *
 * A Solidtime change Laika has not seen is taken over Laika's own, and an
 * edit the person made in Laika since is counted as a conflict, kept in the
 * entry's revisions. A Laika change goes out only while Solidtime still holds
 * what Laika last saw — the CLI compares before it writes, never after.
 *
 * ## A closed period is never rewritten
 *
 * On or before `org_time_settings.closed_through` nothing Solidtime changed
 * is taken — it is flagged, in the answer — and the outbox offers nothing
 * there, so the CLI never writes Solidtime there either (item 6). LAI-789's
 * month close sets the day.
 *
 * ## Agent minutes are never hours
 *
 * Only `time_entries` the person confirmed or typed go out (`draft` and
 * `manual`); `agent_time_days` is not read here at all (item 8).
 */

/** At most this many Solidtime entries in one import, and links in one record. */
export const SOLIDTIME_BATCH_MAX = 2000;
/** The longest window one import may re-read, in days. */
export const PULL_DAYS_MAX = 92;
/** An import's body: two thousand entries of under 300 bytes, and room. */
export const SOLIDTIME_BODY_MAX = 1_048_576;
/** A digest the CLI computes of a Solidtime entry: SHA-256, lower-case hex. */
export const SOLIDTIME_HASH = /^[0-9a-f]{64}$/;
/** Where a timeless entry starts in Solidtime: 09:00 on its day, in its zone. */
export const TIMELESS_START_MINUTE = 9 * 60;

export type PushAction = 'create' | 'update' | 'delete';
export type HeldReason = 'closed_period' | 'space_not_mapped' | 'space_has_several_projects';
export type FlagReason =
  'closed_period' | 'day_full' | 'day_out_of_range' | 'too_long' | 'member_linked_elsewhere';

/** One thing for the CLI to do in Solidtime (§6.4). */
export interface PushItem {
  entry_id: string;
  /** The entry's revision this item describes; the link records it. */
  revision: number;
  action: PushAction;
  day: string;
  tz: string;
  /** Its own start, unix ms — null for a timeless entry. */
  started_at: number | null;
  /**
   * For a timeless entry, the minutes of the day's earlier timeless entries:
   * the CLI starts it at {@link TIMELESS_START_MINUTE} plus this, so a day's
   * typed entries follow each other rather than overlap. 0 otherwise.
   */
  offset_minutes: number;
  minutes: number;
  task: { key: string; title: string } | null;
  project: { slug: string; name: string } | null;
  /** Where its space's time goes in Solidtime; null for *General*. */
  solidtime_project_id: string | null;
  note: string | null;
  /** The Solidtime entry, as Laika last saw it, when there is one. */
  solidtime: { id: string; hash: string; started_at: number } | null;
}

export interface HeldItem {
  entry_id: string;
  day: string;
  reason: HeldReason;
}

/** `GET /me/time/solidtime` (§6.4). */
export interface SolidtimeOutbox {
  closed_through: string | null;
  push: PushItem[];
  held: HeldItem[];
  /** Each space whose time has one place to go, and that place. */
  projects: { space: string; solidtime_project_id: string }[];
}

export interface LinkInput {
  entry_id: string;
  revision: number;
  solidtime_id: string;
  hash: string;
  started_at: number;
  /** The Solidtime entry was deleted, or found gone: forget the link. */
  removed?: boolean | undefined;
}

/** One Solidtime entry as the CLI read it — a key from its description, never the description. */
export interface ImportEntry {
  id: string;
  /** Required in an import of everyone; the person's own in theirs. */
  member_id?: string | undefined;
  start: number;
  end: number;
  project_id: string | null;
  key: string | null;
  hash: string;
}

interface ImportWindow {
  tz: string;
  /** Unix ms: the re-read covered entries starting from `from` to `to`. */
  from: number;
  to: number;
  /** Every page of the window was read: only then is an absent entry a delete. */
  complete: boolean;
  entries: ImportEntry[];
}

export interface OwnImport extends ImportWindow {
  member_id: string;
}

export interface AllImport extends ImportWindow {
  /** The Solidtime members whose entries the batch carries, all of them. */
  members: string[];
}

export interface ImportFlag {
  solidtime_id: string;
  day: string;
  reason: FlagReason;
}

/** What an import did (§6.4). */
export interface ImportResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  /** Shorter than half a minute: not time anybody could bill. */
  ignored: number;
  /** Changed in Laika and in Solidtime since they last agreed; Solidtime's kept. */
  conflicts: number;
  flagged: ImportFlag[];
}

export interface NotOnLaika {
  people: number;
  minutes: number;
}

export interface AllImportResult extends ImportResult {
  not_on_laika: NotOnLaika;
}

/** `GET /org/time/solidtime` (§6.4): owners and admins, signed in. */
export interface SolidtimeSetup {
  closed_through: string | null;
  projects: {
    solidtime_project_id: string;
    name: string;
    push: boolean;
    space: { slug: string; name: string };
  }[];
  people: {
    solidtime_member_id: string;
    user: { id: string; name: string; email: string };
    confirmed_by: { id: string; name: string };
    confirmed_at: number;
  }[];
  not_on_laika: NotOnLaika & {
    members: { member_id: string; minutes: number; entries: number }[];
  };
}

// ------------------------------------------------------------- shared

/**
 * Who may, asked before a body is judged — so a token is told
 * `session_required`, not that its body was odd — and whether the
 * organisation keeps time at all (`time_off`).
 */
export function assertSolidtimeAccess(
  db: Db,
  actor: ResolvedActor,
  action: 'time_sync.own' | 'time_sync.map' | 'time_sync.import_all',
): void {
  assertCan(actor, action);
  if (action !== 'time_sync.map') assertTimeOn(db);
}

/** The last day of the closed period, or null — nothing is closed. */
export function closedThrough(db: Db): string | null {
  const row = db
    .select({ day: orgTimeSettings.closedThrough })
    .from(orgTimeSettings)
    .where(eq(orgTimeSettings.orgId, requireOrgId(db)))
    .get();
  return row?.day ?? null;
}

const isClosed = (closed: string | null, ...days: string[]): boolean =>
  closed !== null && days.some((d) => d <= closed);

type PushTarget = { solidtimeProjectId: string } | 'several';

/** Each mapped space's push target: its one project, or the one marked `push`. */
function pushTargets(db: Db): Map<string, PushTarget & { slug?: string }> {
  const rows = db
    .select({
      solidtimeProjectId: solidtimeProjects.solidtimeProjectId,
      projectId: solidtimeProjects.projectId,
      push: solidtimeProjects.push,
      slug: projects.slug,
    })
    .from(solidtimeProjects)
    .innerJoin(projects, eq(projects.id, solidtimeProjects.projectId))
    .all();
  const bySpace = new Map<string, typeof rows>();
  for (const r of rows) bySpace.set(r.projectId, [...(bySpace.get(r.projectId) ?? []), r]);
  const out = new Map<string, PushTarget & { slug?: string }>();
  for (const [projectId, mapped] of bySpace) {
    const chosen = mapped.length === 1 ? mapped[0] : mapped.find((m) => m.push === 1);
    out.set(
      projectId,
      chosen === undefined
        ? 'several'
        : { solidtimeProjectId: chosen.solidtimeProjectId, slug: chosen.slug },
    );
  }
  return out;
}

/** The Solidtime project → space map, for an import. */
function spaceMap(db: Db | Tx): Map<string, string> {
  return new Map(
    db
      .select({ from: solidtimeProjects.solidtimeProjectId, to: solidtimeProjects.projectId })
      .from(solidtimeProjects)
      .all()
      .map((r) => [r.from, r.to]),
  );
}

/**
 * A member is the caller's own to sync: refused `409
 * member_linked_elsewhere` when an admin confirmed it as somebody else, or
 * confirmed the caller as another member.
 */
function assertOwnMember(db: Db, actor: ResolvedActor, memberId: string): void {
  const linked = db
    .select()
    .from(solidtimePeople)
    .where(
      or(eq(solidtimePeople.solidtimeMemberId, memberId), eq(solidtimePeople.userId, actor.userId)),
    )
    .all();
  if (linked.every((l) => l.solidtimeMemberId === memberId && l.userId === actor.userId)) return;
  throw new ApiError(
    'conflict',
    'An admin confirmed this Solidtime member as somebody else, or you as another member',
    { reason: 'member_linked_elsewhere', member_id: memberId },
  );
}

// ------------------------------------------------------------- outbox

const taskProject = alias(projects, 'task_project');

const outboxSelect = {
  id: timeEntries.id,
  revision: timeEntries.revision,
  day: timeEntries.day,
  tz: timeEntries.tz,
  startedAt: timeEntries.startedAt,
  minutes: timeEntries.minutes,
  note: timeEntries.note,
  deletedAt: timeEntries.deletedAt,
  projectId: timeEntries.projectId,
  taskId: tasks.id,
  taskNumber: tasks.number,
  taskTitle: tasks.title,
  taskPrefix: taskProject.prefix,
  projectSlug: projects.slug,
  projectName: projects.name,
};

function outboxQuery(db: Db) {
  return db
    .select({
      ...outboxSelect,
      stId: solidtimeEntries.solidtimeId,
      stHash: solidtimeEntries.hash,
      stStartedAt: solidtimeEntries.startedAt,
      stDay: solidtimeEntries.day,
    })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .leftJoin(taskProject, eq(taskProject.id, tasks.projectId))
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(solidtimeEntries, eq(solidtimeEntries.entryId, timeEntries.id));
}

/**
 * `GET /me/time/solidtime?since=`: what the person's CLI writes to Solidtime.
 *
 * - **create** — a confirmed or typed entry on or after `since` that Solidtime
 *   has not got, never one imported from it;
 * - **update** — one it has, changed in Laika since they last agreed;
 * - **delete** — one it has, deleted in Laika.
 *
 * **Held**, and said why: anything in the closed period, and an entry on a
 * space no Solidtime project is mapped to, or several are and none is marked
 * `push`. *General* goes with no project.
 */
export function solidtimeOutbox(
  db: Db,
  actor: ResolvedActor,
  input: { since: string },
  now: number = Date.now(),
): SolidtimeOutbox {
  assertCan(actor, 'time_sync.own');
  assertTimeOn(db);
  const earliest = addDays(dayIn('UTC', now), -ENTRY_DAYS_BACK - 1);
  if (!isCalendarDay(input.since) || input.since < earliest) {
    throw new ApiError('unprocessable', `since is a date from ${earliest}`, {
      field: 'since',
      reason: 'day_out_of_range',
      earliest,
    });
  }
  const closed = closedThrough(db);
  const targets = pushTargets(db);

  const order = [
    asc(timeEntries.day),
    asc(sql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt})`),
    asc(timeEntries.createdAt),
    asc(timeEntries.id),
  ];
  const creates = outboxQuery(db)
    .where(
      and(
        eq(timeEntries.userId, actor.userId),
        gte(timeEntries.day, input.since),
        isNull(timeEntries.deletedAt),
        inArray(timeEntries.source, ['draft', 'manual']),
        isNull(solidtimeEntries.solidtimeId),
      ),
    )
    .orderBy(...order)
    .all();
  const changed = outboxQuery(db)
    .where(
      and(
        eq(solidtimeEntries.userId, actor.userId),
        or(
          isNotNull(timeEntries.deletedAt),
          gt(timeEntries.revision, solidtimeEntries.entryRevision),
        ),
      ),
    )
    .orderBy(...order)
    .all();

  const offsets = timelessOffsets(
    db,
    actor.userId,
    [...creates, ...changed].filter((r) => r.startedAt === null).map((r) => r.day),
  );

  const push: PushItem[] = [];
  const held: HeldItem[] = [];
  for (const r of [...creates, ...changed]) {
    const action: PushAction =
      r.stId === null ? 'create' : r.deletedAt !== null ? 'delete' : 'update';
    if (isClosed(closed, r.day, ...(r.stDay === null ? [] : [r.stDay]))) {
      held.push({ entry_id: r.id, day: r.day, reason: 'closed_period' });
      continue;
    }
    let solidtimeProjectId: string | null = null;
    if (action !== 'delete' && r.projectId !== null) {
      const target = targets.get(r.projectId);
      if (target === undefined || target === 'several') {
        held.push({
          entry_id: r.id,
          day: r.day,
          reason: target === undefined ? 'space_not_mapped' : 'space_has_several_projects',
        });
        continue;
      }
      solidtimeProjectId = target.solidtimeProjectId;
    }
    const task = taskRefOf(r.taskId, r.taskNumber, r.taskTitle, r.taskPrefix);
    push.push({
      entry_id: r.id,
      revision: r.revision,
      action,
      day: r.day,
      tz: r.tz,
      started_at: r.startedAt,
      offset_minutes: r.startedAt === null ? (offsets.get(r.id) ?? 0) : 0,
      minutes: r.minutes,
      task: task === null ? null : { key: task.key, title: task.title },
      project:
        r.projectSlug === null || r.projectName === null
          ? null
          : { slug: r.projectSlug, name: r.projectName },
      solidtime_project_id: solidtimeProjectId,
      note: r.note,
      solidtime:
        r.stId === null || r.stHash === null || r.stStartedAt === null
          ? null
          : { id: r.stId, hash: r.stHash, started_at: r.stStartedAt },
    });
  }

  const projectsOut: SolidtimeOutbox['projects'] = [];
  for (const target of targets.values()) {
    if (target !== 'several' && target.slug !== undefined) {
      projectsOut.push({ space: target.slug, solidtime_project_id: target.solidtimeProjectId });
    }
  }
  projectsOut.sort((a, b) => a.space.localeCompare(b.space));
  return { closed_through: closed, push, held, projects: projectsOut };
}

/**
 * For each live timeless entry of the person on these days, the minutes of
 * the day's timeless entries before it — in the order they were made — one
 * query on `time_entries_user_day_idx`.
 */
function timelessOffsets(db: Db, userId: string, days: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (days.length === 0) return out;
  const rows = db
    .select({ id: timeEntries.id, day: timeEntries.day, minutes: timeEntries.minutes })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        inArray(timeEntries.day, [...new Set(days)]),
        isNull(timeEntries.deletedAt),
        isNull(timeEntries.startedAt),
      ),
    )
    .orderBy(asc(timeEntries.day), asc(timeEntries.createdAt), asc(timeEntries.id))
    .all();
  const sums = new Map<string, number>();
  for (const r of rows) {
    const before = sums.get(r.day) ?? 0;
    out.set(r.id, before);
    sums.set(r.day, before + r.minutes);
  }
  return out;
}

// -------------------------------------------------------------- links

/**
 * `PUT /me/time/solidtime/links`: what the CLI wrote, recorded — an entry
 * created or updated in Solidtime, with the digest of what Solidtime now
 * holds and the revision it carried; or one deleted there, forgotten.
 *
 * A Solidtime entry already held as the person's *imported* entry — an
 * admin's pull got to it between the CLI's write and this record — is that
 * entry's duplicate: it is deleted (`retired`) and the link moves to the
 * entry that was pushed. Anything else already holding the Solidtime id is
 * `409`.
 */
export function recordSolidtimeLinks(
  db: Db,
  actor: ResolvedActor,
  input: { member_id: string; links: LinkInput[] },
  now: number = Date.now(),
): { linked: number; removed: number; retired: number } {
  assertCan(actor, 'time_sync.own');
  assertTimeOn(db);
  assertOwnMember(db, actor, input.member_id);
  const counts = { linked: 0, removed: 0, retired: 0 };
  db.transaction((tx) => {
    for (const link of input.links) {
      const entry = tx
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.id, link.entry_id), eq(timeEntries.userId, actor.userId)))
        .get();
      if (entry === undefined) throw ApiError.notFound(`No time entry "${link.entry_id}"`);
      if (link.removed === true) {
        const gone = tx
          .delete(solidtimeEntries)
          .where(
            and(
              eq(solidtimeEntries.solidtimeId, link.solidtime_id),
              eq(solidtimeEntries.entryId, entry.id),
            ),
          )
          .run();
        counts.removed += gone.changes;
        continue;
      }
      if (link.revision > entry.revision) {
        throw new ApiError('unprocessable', 'That revision is newer than the entry', {
          field: 'revision',
          entry_id: entry.id,
        });
      }
      const held = tx
        .select()
        .from(solidtimeEntries)
        .where(eq(solidtimeEntries.solidtimeId, link.solidtime_id))
        .get();
      if (held?.entryId != null && held.entryId !== entry.id) {
        const other = tx.select().from(timeEntries).where(eq(timeEntries.id, held.entryId)).get();
        if (other?.userId !== actor.userId || other.source !== 'import') {
          throw new ApiError('conflict', 'That Solidtime entry is another entry’s', {
            reason: 'solidtime_entry_taken',
            solidtime_id: link.solidtime_id,
          });
        }
        retireEntry(tx, other.id, actor.userId, now);
        counts.retired += 1;
      }
      // An entry pushed again after its Solidtime twin went has one twin, the new one.
      tx.delete(solidtimeEntries).where(eq(solidtimeEntries.entryId, entry.id)).run();
      tx.delete(solidtimeEntries).where(eq(solidtimeEntries.solidtimeId, link.solidtime_id)).run();
      tx.insert(solidtimeEntries)
        .values({
          solidtimeId: link.solidtime_id,
          memberId: input.member_id,
          userId: actor.userId,
          entryId: entry.id,
          entryRevision: link.revision,
          hash: link.hash,
          startedAt: link.started_at,
          day: entry.day,
          minutes: entry.minutes,
          projectId: entry.projectId,
          taskId: entry.taskId,
          updatedAt: now,
        })
        .run();
      counts.linked += 1;
    }
  });
  return counts;
}

// ------------------------------------------------------------- import

function assertWindow(input: ImportWindow, now: number): void {
  if (!isTimeZone(input.tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  if (
    input.to <= input.from ||
    input.to - input.from > PULL_DAYS_MAX * 86_400_000 ||
    input.to > now + 86_400_000
  ) {
    throw new ApiError(
      'unprocessable',
      `A window runs forwards, ends by tomorrow and is at most ${String(PULL_DAYS_MAX)} days`,
      { reason: 'invalid_window', field: 'from' },
    );
  }
  const ids = new Set<string>();
  for (const e of input.entries) {
    if (e.end <= e.start || e.start < input.from || e.start > input.to) {
      throw new ApiError('unprocessable', 'Every entry ends after it starts, inside the window', {
        reason: 'entry_outside_window',
        solidtime_id: e.id,
      });
    }
    if (ids.has(e.id)) {
      throw new ApiError('unprocessable', 'An entry appears twice', {
        reason: 'duplicate_entry',
        solidtime_id: e.id,
      });
    }
    ids.add(e.id);
  }
}

interface Scope {
  /** The Laika person a member is, or null for people not on Laika. */
  userFor: (memberId: string) => string | null;
  /** Members a re-read covers: only their entries may be inferred deleted. */
  covered: ReadonlySet<string>;
  /** An own pull: a twin of another person's is not this caller's to touch. */
  ownUser: string | null;
}

function reconcile(
  db: Db,
  actor: ResolvedActor,
  input: ImportWindow,
  scope: Scope,
  memberOf: (e: ImportEntry) => string,
  now: number,
): ImportResult {
  const closed = closedThrough(db);
  const keys = resolveKeys(
    db,
    actor,
    new Set(input.entries.flatMap((e) => (e.key === null ? [] : [e.key]))),
  );
  const result: ImportResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    ignored: 0,
    conflicts: 0,
    flagged: [],
  };
  const flag = (solidtimeId: string, day: string, why: FlagReason) =>
    result.flagged.push({ solidtime_id: solidtimeId, day, reason: why });

  db.transaction((tx) => {
    const spaces = spaceMap(tx);
    const seen = new Set<string>();
    for (const e of input.entries) {
      seen.add(e.id);
      const memberId = memberOf(e);
      const minutes = Math.round((e.end - e.start) / 60_000);
      if (minutes < 1) {
        result.ignored += 1;
        continue;
      }
      const resolved = e.key === null ? undefined : keys.get(e.key);
      const target: Target =
        resolved === undefined
          ? {
              taskId: null,
              projectId: e.project_id === null ? null : (spaces.get(e.project_id) ?? null),
            }
          : { taskId: resolved.taskId, projectId: resolved.projectId };
      const row = tx
        .select()
        .from(solidtimeEntries)
        .where(eq(solidtimeEntries.solidtimeId, e.id))
        .get();

      // ---- a Laika person's twin
      if (row?.entryId != null && row.userId !== null) {
        if (scope.ownUser !== null && row.userId !== scope.ownUser) {
          flag(e.id, row.day, 'member_linked_elsewhere');
          continue;
        }
        if (row.hash === e.hash) {
          result.unchanged += 1;
          continue;
        }
        const twin = tx.select().from(timeEntries).where(eq(timeEntries.id, row.entryId)).get();
        if (twin === undefined) continue;
        const day = dayIn(twin.tz, e.start);
        if (minutes > DAY_MINUTES) {
          flag(e.id, day, 'too_long');
          continue;
        }
        if (isClosed(closed, twin.day, day)) {
          flag(e.id, day, 'closed_period');
          continue;
        }
        const laikaChanged =
          twin.deletedAt !== null || twin.revision > (row.entryRevision ?? twin.revision);
        let revision: number;
        try {
          revision = syncEntry(
            tx,
            twin.id,
            {
              target,
              day,
              tz: twin.tz,
              startedAt: e.start,
              endedAt: e.end,
              minutes,
              note: twin.note,
            },
            twin.userId,
            now,
          );
        } catch (err) {
          if (isDayFull(err)) {
            flag(e.id, day, 'day_full');
            continue;
          }
          throw err;
        }
        tx.update(solidtimeEntries)
          .set({
            memberId,
            entryRevision: revision,
            hash: e.hash,
            startedAt: e.start,
            day,
            minutes,
            projectId: target.projectId,
            taskId: target.taskId,
            updatedAt: now,
          })
          .where(eq(solidtimeEntries.solidtimeId, e.id))
          .run();
        result.updated += 1;
        if (laikaChanged) result.conflicts += 1;
        continue;
      }

      const day = dayIn(input.tz, e.start);
      if (minutes > DAY_MINUTES) {
        flag(e.id, day, 'too_long');
        continue;
      }
      const userId = scope.userFor(memberId);

      // ---- a member not on Laika, already held
      if (row !== undefined && userId === null) {
        if (row.hash === e.hash) {
          result.unchanged += 1;
          continue;
        }
        if (isClosed(closed, row.day, day)) {
          flag(e.id, day, 'closed_period');
          continue;
        }
        tx.update(solidtimeEntries)
          .set({
            memberId,
            hash: e.hash,
            startedAt: e.start,
            day,
            minutes,
            projectId: target.projectId,
            taskId: target.taskId,
            updatedAt: now,
          })
          .where(eq(solidtimeEntries.solidtimeId, e.id))
          .run();
        result.updated += 1;
        continue;
      }

      // ---- new to Laika, or a member who has since been confirmed
      if (isClosed(closed, day, ...(row === undefined ? [] : [row.day]))) {
        flag(e.id, day, 'closed_period');
        continue;
      }
      if (userId === null) {
        tx.insert(solidtimeEntries)
          .values({
            solidtimeId: e.id,
            memberId,
            userId: null,
            entryId: null,
            entryRevision: null,
            hash: e.hash,
            startedAt: e.start,
            day,
            minutes,
            projectId: target.projectId,
            taskId: target.taskId,
            updatedAt: now,
          })
          .run();
        result.created += 1;
        continue;
      }
      try {
        assertEntryDay(day, input.tz, now);
      } catch {
        flag(e.id, day, 'day_out_of_range');
        continue;
      }
      const fields: EntryFields = {
        target,
        day,
        tz: input.tz,
        startedAt: e.start,
        endedAt: e.end,
        minutes,
        note: null,
      };
      let entryId: string;
      let revision: number;
      try {
        ({ entryId, revision } = takeImport(tx, userId, e.id, fields, now));
      } catch (err) {
        if (isDayFull(err)) {
          flag(e.id, day, 'day_full');
          continue;
        }
        throw err;
      }
      if (row !== undefined) {
        tx.delete(solidtimeEntries).where(eq(solidtimeEntries.solidtimeId, e.id)).run();
      }
      tx.insert(solidtimeEntries)
        .values({
          solidtimeId: e.id,
          memberId,
          userId,
          entryId,
          entryRevision: revision,
          hash: e.hash,
          startedAt: e.start,
          day,
          minutes,
          projectId: target.projectId,
          taskId: target.taskId,
          updatedAt: now,
        })
        .run();
      result.created += 1;
    }

    if (!input.complete) return;
    // ---- deletes: what the window held and the re-read did not find
    const held = tx
      .select()
      .from(solidtimeEntries)
      .where(
        and(
          inArray(solidtimeEntries.memberId, [...scope.covered]),
          gte(solidtimeEntries.startedAt, input.from),
          lte(solidtimeEntries.startedAt, input.to),
        ),
      )
      .all()
      .filter((r) => !seen.has(r.solidtimeId));
    for (const r of held) {
      if (scope.ownUser !== null && r.userId !== null && r.userId !== scope.ownUser) continue;
      if (isClosed(closed, r.day)) {
        flag(r.solidtimeId, r.day, 'closed_period');
        continue;
      }
      if (r.entryId !== null && r.userId !== null) retireEntry(tx, r.entryId, r.userId, now);
      tx.delete(solidtimeEntries).where(eq(solidtimeEntries.solidtimeId, r.solidtimeId)).run();
      result.deleted += 1;
    }
  });
  return result;
}

function isDayFull(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.details as { reason?: string } | null)?.reason === 'day_full'
  );
}

/**
 * The person's imported entry for a Solidtime id: a new one, or the one they
 * already had — deleted when the link that brought it was undone — made live
 * again. `time_entries` keeps one `import` row per `(user, source_ref)`.
 */
function takeImport(
  tx: Tx,
  userId: string,
  solidtimeId: string,
  fields: EntryFields,
  now: number,
): { entryId: string; revision: number } {
  const had = tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.source, 'import'),
        eq(timeEntries.sourceRef, solidtimeId),
      ),
    )
    .get();
  if (had !== undefined) {
    return { entryId: had.id, revision: syncEntry(tx, had.id, fields, userId, now) };
  }
  return { entryId: insertEntry(tx, userId, fields, 'import', solidtimeId, now), revision: 1 };
}

/**
 * `PUT /me/time/solidtime/import`: the person's own Solidtime entries in a
 * window, as their CLI re-read them, brought into their own time.
 */
export function importOwnSolidtime(
  db: Db,
  actor: ResolvedActor,
  input: OwnImport,
  now: number = Date.now(),
): ImportResult {
  assertCan(actor, 'time_sync.own');
  assertTimeOn(db);
  assertWindow(input, now);
  for (const e of input.entries) {
    if (e.member_id !== undefined && e.member_id !== input.member_id) {
      throw new ApiError('unprocessable', 'An own pull carries the person’s own entries only', {
        reason: 'member_not_covered',
        solidtime_id: e.id,
      });
    }
  }
  assertOwnMember(db, actor, input.member_id);
  return reconcile(
    db,
    actor,
    input,
    { userFor: () => actor.userId, covered: new Set([input.member_id]), ownUser: actor.userId },
    () => input.member_id,
    now,
  );
}

/**
 * `PUT /org/time/solidtime/import`: everyone's, as an owner's or admin's CLI
 * re-read them with a Solidtime key that sees everyone. A member an admin
 * confirmed is that person's time; anyone else's is kept as *people not on
 * Laika*.
 */
export function importAllSolidtime(
  db: Db,
  actor: ResolvedActor,
  input: AllImport,
  now: number = Date.now(),
): AllImportResult {
  assertCan(actor, 'time_sync.import_all');
  assertTimeOn(db);
  assertWindow(input, now);
  const covered = new Set(input.members);
  for (const e of input.entries) {
    if (e.member_id === undefined || !covered.has(e.member_id)) {
      throw new ApiError('unprocessable', 'Every entry is of a member the batch covers', {
        reason: 'member_not_covered',
        solidtime_id: e.id,
      });
    }
  }
  const people = new Map(
    db
      .select({ member: solidtimePeople.solidtimeMemberId, user: solidtimePeople.userId })
      .from(solidtimePeople)
      .all()
      .map((p) => [p.member, p.user]),
  );
  const result = reconcile(
    db,
    actor,
    input,
    { userFor: (m) => people.get(m) ?? null, covered, ownUser: null },
    (e) => e.member_id ?? '',
    now,
  );
  const bucket = notOnLaika(db);
  return { ...result, not_on_laika: { people: bucket.people, minutes: bucket.minutes } };
}

function notOnLaika(db: Db): SolidtimeSetup['not_on_laika'] {
  const members = db
    .select({
      member_id: solidtimeEntries.memberId,
      minutes: sql<number>`sum(${solidtimeEntries.minutes})`.mapWith(Number),
      entries: sql<number>`count(*)`.mapWith(Number),
    })
    .from(solidtimeEntries)
    .where(isNull(solidtimeEntries.userId))
    .groupBy(solidtimeEntries.memberId)
    .orderBy(asc(solidtimeEntries.memberId))
    .all();
  return {
    people: members.length,
    minutes: members.reduce((n, m) => n + m.minutes, 0),
    members,
  };
}

// ------------------------------------------------------------ mapping

/** `GET /org/time/solidtime`: the map, the people confirmed, and who is not on Laika. */
export function solidtimeSetup(db: Db, actor: ResolvedActor): SolidtimeSetup {
  assertCan(actor, 'time_sync.map');
  const confirmer = alias(users, 'confirmer');
  return {
    closed_through: closedThrough(db),
    projects: db
      .select({
        solidtime_project_id: solidtimeProjects.solidtimeProjectId,
        name: solidtimeProjects.name,
        push: solidtimeProjects.push,
        slug: projects.slug,
        spaceName: projects.name,
      })
      .from(solidtimeProjects)
      .innerJoin(projects, eq(projects.id, solidtimeProjects.projectId))
      .orderBy(asc(projects.slug), asc(solidtimeProjects.name))
      .all()
      .map((p) => ({
        solidtime_project_id: p.solidtime_project_id,
        name: p.name,
        push: p.push === 1,
        space: { slug: p.slug, name: p.spaceName },
      })),
    people: db
      .select({
        member: solidtimePeople.solidtimeMemberId,
        userId: users.id,
        userName: users.name,
        email: users.email,
        byId: confirmer.id,
        byName: confirmer.name,
        at: solidtimePeople.confirmedAt,
      })
      .from(solidtimePeople)
      .innerJoin(users, eq(users.id, solidtimePeople.userId))
      .innerJoin(confirmer, eq(confirmer.id, solidtimePeople.confirmedBy))
      .orderBy(asc(users.name))
      .all()
      .map((p) => ({
        solidtime_member_id: p.member,
        user: { id: p.userId, name: p.userName, email: p.email },
        confirmed_by: { id: p.byId, name: p.byName },
        confirmed_at: p.at,
      })),
    not_on_laika: notOnLaika(db),
  };
}

/**
 * `PUT /org/time/solidtime/projects`: map Solidtime projects to spaces, or
 * `space: null` to unmap one. `push: true` makes it the one its space's time
 * goes to, and no other of that space.
 */
export function setSolidtimeProjects(
  db: Db,
  actor: ResolvedActor,
  input: {
    projects: {
      solidtime_project_id: string;
      name: string;
      space: string | null;
      push?: boolean | undefined;
    }[];
  },
  now: number = Date.now(),
): SolidtimeSetup['projects'] {
  assertCan(actor, 'time_sync.map');
  const spaces = new Map<string, string>();
  for (const p of input.projects) {
    if (p.space !== null && !spaces.has(p.space)) {
      spaces.set(p.space, requireProjectBySlug(db, p.space).id);
    }
  }
  db.transaction((tx) => {
    for (const p of input.projects) {
      if (p.space === null) {
        tx.delete(solidtimeProjects)
          .where(eq(solidtimeProjects.solidtimeProjectId, p.solidtime_project_id))
          .run();
        continue;
      }
      const projectId = spaces.get(p.space) ?? '';
      if (p.push === true) {
        tx.update(solidtimeProjects)
          .set({ push: 0, updatedAt: now })
          .where(eq(solidtimeProjects.projectId, projectId))
          .run();
      }
      const values = {
        projectId,
        name: p.name,
        updatedBy: actor.userId,
        updatedAt: now,
        ...(p.push === undefined ? {} : { push: p.push ? 1 : 0 }),
      };
      tx.insert(solidtimeProjects)
        .values({ solidtimeProjectId: p.solidtime_project_id, ...values })
        .onConflictDoUpdate({ target: solidtimeProjects.solidtimeProjectId, set: values })
        .run();
    }
  });
  return solidtimeSetup(db, actor).projects;
}

/**
 * `PUT /org/time/solidtime/people`: an owner or admin confirms which Laika
 * person a Solidtime member is — the match the CLI suggested by email, on
 * its machine — or undoes it with `user_id: null`.
 *
 * Undoing moves the hours that link brought in back to *people not on
 * Laika*: each imported entry is deleted from the person's time with a
 * revision, and its Solidtime row kept without them. Nothing in the closed
 * period moves. A confirmation takes effect at the next pull.
 */
export function setSolidtimePeople(
  db: Db,
  actor: ResolvedActor,
  input: { people: { solidtime_member_id: string; user_id: string | null }[] },
  now: number = Date.now(),
): SolidtimeSetup['people'] {
  assertCan(actor, 'time_sync.map');
  const closed = closedThrough(db);
  db.transaction((tx) => {
    for (const p of input.people) {
      const current = tx
        .select()
        .from(solidtimePeople)
        .where(eq(solidtimePeople.solidtimeMemberId, p.solidtime_member_id))
        .get();
      if (p.user_id === null) {
        if (current === undefined) continue;
        const twins = tx
          .select({ row: solidtimeEntries, source: timeEntries.source, day: timeEntries.day })
          .from(solidtimeEntries)
          .innerJoin(timeEntries, eq(timeEntries.id, solidtimeEntries.entryId))
          .where(
            and(
              eq(solidtimeEntries.memberId, p.solidtime_member_id),
              eq(solidtimeEntries.userId, current.userId),
            ),
          )
          .all();
        for (const { row, source, day } of twins) {
          if (source !== 'import' || row.entryId === null || isClosed(closed, day)) continue;
          retireEntry(tx, row.entryId, actor.userId, now);
          tx.update(solidtimeEntries)
            .set({ userId: null, entryId: null, entryRevision: null, updatedAt: now })
            .where(eq(solidtimeEntries.solidtimeId, row.solidtimeId))
            .run();
        }
        tx.delete(solidtimePeople)
          .where(eq(solidtimePeople.solidtimeMemberId, p.solidtime_member_id))
          .run();
        continue;
      }
      const person = tx
        .select({ id: users.id, active: users.isActive })
        .from(users)
        .where(eq(users.id, p.user_id))
        .get();
      if (person?.active !== 1) {
        throw ApiError.notFound(`No active person "${p.user_id}"`);
      }
      if (current !== undefined) {
        if (current.userId === p.user_id) continue;
        throw new ApiError('conflict', 'That member is confirmed as somebody else; undo it first', {
          reason: 'member_linked',
          solidtime_member_id: p.solidtime_member_id,
        });
      }
      const elsewhere = tx
        .select()
        .from(solidtimePeople)
        .where(eq(solidtimePeople.userId, p.user_id))
        .get();
      if (elsewhere !== undefined) {
        throw new ApiError('conflict', 'That person is confirmed as another Solidtime member', {
          reason: 'user_linked_elsewhere',
          solidtime_member_id: elsewhere.solidtimeMemberId,
        });
      }
      tx.insert(solidtimePeople)
        .values({
          solidtimeMemberId: p.solidtime_member_id,
          userId: p.user_id,
          confirmedBy: actor.userId,
          confirmedAt: now,
          updatedAt: now,
        })
        .run();
    }
  });
  return solidtimeSetup(db, actor).people;
}
