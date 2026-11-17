import { and, eq, inArray } from 'drizzle-orm';
import { type MicrosoftSso } from '../auth/sso.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { meetingAttendance, meetings, orgs, users } from '../db/schema.ts';
import { type GraphClient, type GraphDeps, GraphError, graphClient } from './microsoft-graph.ts';

/**
 * **Teams meetings, read through Graph** (LAI-1311): for every active Laika
 * member whose address Microsoft knows, the meetings on their calendar from
 * two weeks back to one week ahead; and for each online meeting that has
 * ended, Teams' attendance report — who joined, when, for how long — and
 * whether a transcript exists.
 *
 * - **Never the transcript.** Its existence is a flag (`has_transcript`);
 *   its words are fetched from Graph when a participant opens it
 *   (`services/meetings.ts`) and never written anywhere (D-005, D-056).
 * - **Read everything, then write in one transaction.** A run that fails
 *   reading the calendars changes nothing; a meeting is never deleted, only
 *   upserted by its calendar id, so one that leaves the window stays as it
 *   was last seen.
 * - **App permissions, admin-consented**: `Calendars.Read`,
 *   `OnlineMeetings.Read.All`, `OnlineMeetingArtifact.Read.All`,
 *   `OnlineMeetingTranscript.Read.All`, `User.Read.All` (to find an
 *   organiser's id), and a Teams application access policy for the app. A
 *   `403` becomes a code naming the grant that is missing.
 * - **Opt-in**: `LAIKA_MICROSOFT_MEETINGS_SYNC=true`, on top of Microsoft SSO.
 */

/** How often the scheduled run comes round (`jobs/scheduler.ts`). */
export const MEETINGS_SYNC_EVERY_MINUTES = 15;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** The calendar window: two weeks back, for attendance; one week ahead, for what is coming. */
export const MEETINGS_WINDOW_BACK_MS = 14 * DAY;
export const MEETINGS_WINDOW_AHEAD_MS = 7 * DAY;

/**
 * How far from an occurrence's scheduled times an attendance report or a
 * transcript may start and still be that occurrence's. A recurring Teams
 * meeting is **one** online meeting with a report and a transcript per
 * occurrence, so each is matched to the occurrence it began near; an hour
 * either side covers starting early and starting late without reaching the
 * next day's occurrence.
 */
export const OCCURRENCE_SLACK_MS = 60 * MINUTE;

export const FORBIDDEN = {
  calendars: 'graph_forbidden_grant_calendars_read',
  users: 'graph_forbidden_grant_user_read_all',
  meetings: 'graph_forbidden_grant_onlinemeetings_read_all',
  artifacts: 'graph_forbidden_grant_onlinemeetingartifact_read_all',
  transcripts: 'graph_forbidden_grant_onlinemeetingtranscript_read_all',
} as const;

/** The permissions the Entra app needs, for the settings page and the docs. */
export const MEETINGS_GRAPH_PERMISSIONS = [
  'Calendars.Read',
  'OnlineMeetings.Read.All',
  'OnlineMeetingArtifact.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'User.Read.All',
] as const;

export type MeetingsDeps = GraphDeps;

// ------------------------------------------------------------ reading Graph

interface GraphAddress {
  readonly name?: unknown;
  readonly address?: unknown;
}
interface GraphEvent {
  readonly id?: unknown;
  readonly iCalUId?: unknown;
  readonly subject?: unknown;
  readonly isCancelled?: unknown;
  readonly start?: { readonly dateTime?: unknown; readonly timeZone?: unknown };
  readonly end?: { readonly dateTime?: unknown; readonly timeZone?: unknown };
  readonly organizer?: { readonly emailAddress?: GraphAddress };
  readonly isOnlineMeeting?: unknown;
  readonly onlineMeeting?: { readonly joinUrl?: unknown } | null;
  readonly attendees?: readonly { readonly emailAddress?: GraphAddress }[];
}

/** One person on a meeting, as read. */
export interface ReadAttendee {
  readonly email: string;
  readonly name: string;
  readonly invited: boolean;
  /** From the attendance report; `null` when the report was not read or they did not join. */
  readonly joinedAt: number | null;
  readonly leftAt: number | null;
  readonly minutes: number;
}

/** One meeting, as read — before anything is written. */
export interface ReadMeeting {
  readonly graphEventId: string;
  readonly title: string;
  readonly organiserEmail: string;
  readonly joinUrl: string | null;
  readonly scheduledStart: number;
  readonly scheduledEnd: number;
  onlineMeetingId: string | null;
  actualStart: number | null;
  actualEnd: number | null;
  hasTranscript: boolean;
  /** Whether Teams' report was read, so an unread one leaves stored attendance alone. */
  attendanceRead: boolean;
  readonly attendees: Map<string, ReadAttendee>;
}

const lower = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * A Graph date-time as unix ms. Asked for in UTC (`Prefer:
 * outlook.timezone="UTC"`), Graph answers `2026-11-17T10:00:00.0000000` with
 * no offset; one with an offset or a `Z` is read as written.
 */
export function graphTime(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const iso = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** A calendar event as a meeting, or `null` when it is not one to keep. */
export function meetingOf(event: GraphEvent): ReadMeeting | null {
  if (event.isCancelled === true) return null;
  // `iCalUId` is the same in every attendee's calendar, and differs per
  // occurrence of a series; the mailbox-local `id` would make one meeting a
  // row per person.
  const key =
    typeof event.iCalUId === 'string' && event.iCalUId !== ''
      ? event.iCalUId
      : typeof event.id === 'string'
        ? event.id
        : '';
  const start = graphTime(event.start?.dateTime);
  const end = graphTime(event.end?.dateTime);
  const organiser = lower(event.organizer?.emailAddress?.address);
  if (key === '' || start === null || end === null || !organiser.includes('@')) return null;

  const title =
    typeof event.subject === 'string' && event.subject.trim() !== ''
      ? event.subject.trim().slice(0, 255)
      : '(no title)';
  const joinUrl =
    typeof event.onlineMeeting?.joinUrl === 'string' &&
    event.onlineMeeting.joinUrl.startsWith('https://')
      ? event.onlineMeeting.joinUrl
      : null;

  const attendees = new Map<string, ReadAttendee>();
  const invite = (address: GraphAddress | undefined) => {
    const email = lower(address?.address);
    if (!email.includes('@') || attendees.has(email)) return;
    const name =
      typeof address?.name === 'string' && address.name.trim() !== ''
        ? address.name.trim()
        : (email.split('@')[0] ?? email);
    attendees.set(email, { email, name, invited: true, joinedAt: null, leftAt: null, minutes: 0 });
  };
  invite(event.organizer?.emailAddress);
  for (const attendee of event.attendees ?? []) invite(attendee.emailAddress);

  return {
    graphEventId: key,
    title,
    organiserEmail: organiser,
    joinUrl,
    scheduledStart: start,
    scheduledEnd: Math.max(end, start),
    onlineMeetingId: null,
    actualStart: null,
    actualEnd: null,
    hasTranscript: false,
    attendanceRead: false,
    attendees,
  };
}

/** Whether a report or transcript that began at `at` belongs to this occurrence. */
/** The scheduled times an attendance report or transcript is matched against. */
export interface Occurrence {
  readonly scheduledStart: number;
  readonly scheduledEnd: number;
}

export function inOccurrence(at: number | null, meeting: Occurrence): boolean {
  return (
    at !== null &&
    at >= meeting.scheduledStart - OCCURRENCE_SLACK_MS &&
    at <= meeting.scheduledEnd + OCCURRENCE_SLACK_MS
  );
}

/** An OData string literal: a quote is doubled. */
const odataString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * An organiser's Graph object id, which the online-meetings API takes, or
 * `null` when the address is not a user of this tenant (an outside
 * organiser — whose meeting's artifacts are not this tenant's to read).
 */
export async function organiserId(
  graph: GraphClient,
  email: string,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  const cached = cache?.get(email);
  if (cached !== undefined) return cached;
  const body = (await graph.get(`/users/${encodeURIComponent(email)}?$select=id`, {
    forbidden: FORBIDDEN.users,
  })) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : null;
  cache?.set(email, id);
  return id;
}

/** The online meeting a join URL names, under its organiser, or `null`. */
export async function onlineMeetingByJoinUrl(
  graph: GraphClient,
  organiser: string,
  joinUrl: string,
): Promise<string | null> {
  const query = new URLSearchParams({ $filter: `JoinWebUrl eq ${odataString(joinUrl)}` });
  const found = await graph.list(
    `/users/${encodeURIComponent(organiser)}/onlineMeetings?${query.toString()}`,
    { forbidden: FORBIDDEN.meetings },
  );
  const first = found[0] as { id?: unknown } | undefined;
  return typeof first?.id === 'string' ? first.id : null;
}

interface GraphTranscript {
  readonly id?: unknown;
  readonly createdDateTime?: unknown;
}

/** This occurrence's transcripts, oldest first. */
export async function occurrenceTranscripts(
  graph: GraphClient,
  organiser: string,
  onlineMeetingId: string,
  meeting: Occurrence,
): Promise<{ id: string; createdAt: number }[]> {
  const listed = (await graph.list(
    `/users/${encodeURIComponent(organiser)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts`,
    { forbidden: FORBIDDEN.transcripts },
  )) as GraphTranscript[];
  return listed
    .map((t) => ({
      id: typeof t.id === 'string' ? t.id : '',
      createdAt: graphTime(t.createdDateTime),
    }))
    .filter(
      (t): t is { id: string; createdAt: number } =>
        t.id !== '' && inOccurrence(t.createdAt, meeting),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

interface GraphReport {
  readonly id?: unknown;
  readonly meetingStartDateTime?: unknown;
}
interface GraphRecord {
  readonly emailAddress?: unknown;
  readonly identity?: { readonly displayName?: unknown };
  readonly attendanceIntervals?: readonly {
    readonly joinDateTime?: unknown;
    readonly leaveDateTime?: unknown;
    readonly durationInSeconds?: unknown;
  }[];
  readonly totalAttendanceInSeconds?: unknown;
}

/**
 * Fold Teams' attendance into the meeting: each person's first join, last
 * leave and minutes over every interval, across this occurrence's reports.
 */
export function applyAttendance(meeting: ReadMeeting, records: readonly GraphRecord[]): void {
  const seen = new Map<string, { name: string; join: number; leave: number; seconds: number }>();
  for (const record of records) {
    const email = lower(record.emailAddress);
    // No address, no person to show it to: an anonymous or outside guest.
    if (!email.includes('@')) continue;
    let join = Number.POSITIVE_INFINITY;
    let leave = Number.NEGATIVE_INFINITY;
    let seconds = 0;
    for (const interval of record.attendanceIntervals ?? []) {
      const joined = graphTime(interval.joinDateTime);
      const left = graphTime(interval.leaveDateTime);
      if (joined === null || left === null || left < joined) continue;
      join = Math.min(join, joined);
      leave = Math.max(leave, left);
      seconds +=
        typeof interval.durationInSeconds === 'number' && interval.durationInSeconds >= 0
          ? interval.durationInSeconds
          : (left - joined) / 1000;
    }
    if (!Number.isFinite(join)) continue;
    const name =
      typeof record.identity?.displayName === 'string' && record.identity.displayName.trim() !== ''
        ? record.identity.displayName.trim()
        : (email.split('@')[0] ?? email);
    const prior = seen.get(email);
    seen.set(email, {
      name: prior?.name ?? name,
      join: Math.min(prior?.join ?? join, join),
      leave: Math.max(prior?.leave ?? leave, leave),
      seconds: (prior?.seconds ?? 0) + seconds,
    });
  }

  meeting.attendanceRead = true;
  for (const [email, s] of seen) {
    const invited = meeting.attendees.get(email);
    meeting.attendees.set(email, {
      email,
      name: invited?.name ?? s.name,
      invited: invited?.invited ?? false,
      joinedAt: s.join,
      leftAt: s.leave,
      // A day at most, as an entry can hold (§4.48); at least one for anyone who joined.
      minutes: Math.min(1440, Math.max(1, Math.round(s.seconds / 60))),
    });
    meeting.actualStart = Math.min(meeting.actualStart ?? s.join, s.join);
    meeting.actualEnd = Math.max(meeting.actualEnd ?? s.leave, s.leave);
  }
}

/** Attendance and transcript availability for one ended online meeting. */
async function readArtifacts(
  graph: GraphClient,
  meeting: ReadMeeting,
  ids: Map<string, string | null>,
): Promise<void> {
  if (meeting.joinUrl === null) return;
  const organiser = await organiserId(graph, meeting.organiserEmail, ids);
  if (organiser === null) return;
  const onlineId = await onlineMeetingByJoinUrl(graph, organiser, meeting.joinUrl);
  if (onlineId === null) return;
  meeting.onlineMeetingId = onlineId;

  const base = `/users/${encodeURIComponent(organiser)}/onlineMeetings/${encodeURIComponent(onlineId)}`;
  const reports = (await graph.list(`${base}/attendanceReports`, {
    forbidden: FORBIDDEN.artifacts,
  })) as GraphReport[];
  const records: GraphRecord[] = [];
  for (const report of reports) {
    if (typeof report.id !== 'string') continue;
    if (!inOccurrence(graphTime(report.meetingStartDateTime), meeting)) continue;
    records.push(
      ...((await graph.list(
        `${base}/attendanceReports/${encodeURIComponent(report.id)}/attendanceRecords`,
        { forbidden: FORBIDDEN.artifacts },
      )) as GraphRecord[]),
    );
  }
  applyAttendance(meeting, records);

  meeting.hasTranscript =
    (await occurrenceTranscripts(graph, organiser, onlineId, meeting)).length > 0;
}

export interface ReadMeetingsResult {
  readonly meetings: ReadMeeting[];
  /**
   * The first artifact failure, if any. Calendars are the run; attendance
   * and transcripts are extra — a missing artifact grant must not hide the
   * calendar, so what was read is still written and the run says why it is
   * incomplete.
   */
  readonly artifactError: string | null;
}

/** Every meeting on these people's calendars in the window, with what Teams adds. */
export async function readMeetings(
  sso: MicrosoftSso,
  emails: readonly string[],
  now: number,
  deps: MeetingsDeps = {},
): Promise<ReadMeetingsResult> {
  const graph = await graphClient(sso, deps);
  const from = new Date(now - MEETINGS_WINDOW_BACK_MS).toISOString();
  const to = new Date(now + MEETINGS_WINDOW_AHEAD_MS).toISOString();
  const query = new URLSearchParams({
    startDateTime: from,
    endDateTime: to,
    $select:
      'id,iCalUId,subject,start,end,organizer,isOnlineMeeting,onlineMeeting,attendees,isCancelled',
    $top: '100',
  });

  const byKey = new Map<string, ReadMeeting>();
  for (const email of emails) {
    const events = (await graph.list(
      `/users/${encodeURIComponent(email)}/calendarView?${query.toString()}`,
      { forbidden: FORBIDDEN.calendars, headers: { Prefer: 'outlook.timezone="UTC"' } },
    )) as GraphEvent[];
    for (const event of events) {
      const meeting = meetingOf(event);
      if (meeting === null) continue;
      const known = byKey.get(meeting.graphEventId);
      if (known === undefined) {
        byKey.set(meeting.graphEventId, meeting);
        continue;
      }
      // The same meeting from another attendee's calendar: one invite list.
      for (const [address, attendee] of meeting.attendees) {
        if (!known.attendees.has(address)) known.attendees.set(address, attendee);
      }
    }
  }

  let artifactError: string | null = null;
  const ids = new Map<string, string | null>();
  for (const meeting of byKey.values()) {
    if (meeting.joinUrl === null || meeting.scheduledEnd > now) continue;
    try {
      await readArtifacts(graph, meeting, ids);
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      artifactError ??= err.code;
      // A missing grant fails every meeting the same way: asking again for
      // each would only spend the run.
      if (err.code.startsWith('graph_forbidden_')) break;
    }
  }
  return { meetings: [...byKey.values()], artifactError };
}

// ------------------------------------------------------------------ writing

export interface MeetingsSyncCounts {
  /** Meetings read this run (new and existing). */
  readonly meetings: number;
  /** Meetings Laika had not seen before. */
  readonly added: number;
}

/**
 * Upsert what was read, in one transaction. A meeting's link to a space,
 * its id and when it was first seen stay; a person's row keeps its
 * `time_entry_id` and, when this run did not read Teams' report, its
 * attendance. Addresses are matched to people by lowercased email.
 */
export function storeMeetings(
  db: Db,
  read: readonly ReadMeeting[],
  now: number,
): MeetingsSyncCounts {
  const org = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (org === undefined) return { meetings: 0, added: 0 };

  const people = new Map(
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .all()
      .map((u) => [u.email.toLowerCase(), u.id] as const),
  );

  let added = 0;
  db.transaction((tx) => {
    for (const m of read) {
      const existing = tx
        .select()
        .from(meetings)
        .where(eq(meetings.graphEventId, m.graphEventId))
        .get();
      let meetingId: string;
      if (existing === undefined) {
        meetingId = newId();
        added += 1;
        tx.insert(meetings)
          .values({
            id: meetingId,
            orgId: org.id,
            graphEventId: m.graphEventId,
            onlineMeetingId: m.onlineMeetingId,
            title: m.title,
            organiserEmail: m.organiserEmail,
            joinUrl: m.joinUrl,
            scheduledStart: m.scheduledStart,
            scheduledEnd: m.scheduledEnd,
            actualStart: m.actualStart,
            actualEnd: m.actualEnd,
            hasTranscript: m.hasTranscript ? 1 : 0,
            projectId: null,
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      } else {
        meetingId = existing.id;
        // What Teams said last time stands when this run could not ask it.
        const artifacts = m.attendanceRead
          ? {
              onlineMeetingId: m.onlineMeetingId,
              actualStart: m.actualStart,
              actualEnd: m.actualEnd,
              hasTranscript: m.hasTranscript ? 1 : 0,
            }
          : {};
        tx.update(meetings)
          .set({
            title: m.title,
            organiserEmail: m.organiserEmail,
            joinUrl: m.joinUrl,
            scheduledStart: m.scheduledStart,
            scheduledEnd: m.scheduledEnd,
            ...artifacts,
            syncedAt: now,
            updatedAt: now,
          })
          .where(eq(meetings.id, meetingId))
          .run();
      }

      const stored = new Map(
        tx
          .select()
          .from(meetingAttendance)
          .where(
            and(
              eq(meetingAttendance.meetingId, meetingId),
              inArray(meetingAttendance.email, [...m.attendees.keys(), '']),
            ),
          )
          .all()
          .map((row) => [row.email, row] as const),
      );
      for (const a of m.attendees.values()) {
        const row = stored.get(a.email);
        const userId = people.get(a.email) ?? null;
        if (row === undefined) {
          tx.insert(meetingAttendance)
            .values({
              id: newId(),
              meetingId,
              email: a.email,
              userId,
              displayName: a.name,
              invited: a.invited ? 1 : 0,
              joinedAt: a.joinedAt,
              leftAt: a.leftAt,
              minutes: a.minutes,
              timeEntryId: null,
            })
            .run();
          continue;
        }
        tx.update(meetingAttendance)
          .set({
            userId: userId ?? row.userId,
            displayName: a.name,
            // Once on the invite, always invited: an attendee who was removed
            // from the invite after joining still attended.
            invited: a.invited || row.invited === 1 ? 1 : 0,
            ...(m.attendanceRead
              ? { joinedAt: a.joinedAt, leftAt: a.leftAt, minutes: a.minutes }
              : {}),
          })
          .where(eq(meetingAttendance.id, row.id))
          .run();
      }
    }
  });
  return { meetings: read.length, added };
}

// --------------------------------------------------------------- the runs

/** How the last run went, for the SSO settings page. */
export interface MeetingsRun {
  readonly at: number;
  readonly ok: boolean;
  readonly meetings: number;
  /** A Graph code when it failed or was incomplete; never a token or Graph's body. */
  readonly error: string | null;
}

/**
 * The last run, in memory — the directory sync's reasoning: the job runs at
 * boot, so a restart has an answer within moments, and a stale "last synced"
 * would describe a process that no longer exists.
 */
let lastRun: MeetingsRun | null = null;
/** A run still going: *Sync now* and a tick join it rather than doubling it. */
let running: Promise<MeetingsSyncCounts> | null = null;

export function lastMeetingsRun(): MeetingsRun | null {
  return lastRun;
}

/** For the tests, which each start from no run. */
export function resetMeetingsRun(): void {
  lastRun = null;
  running = null;
}

/** The people whose calendars are read: active, with an address. */
function activeEmails(db: Db): string[] {
  return db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.isActive, 1))
    .all()
    .map((u) => u.email.toLowerCase())
    .filter((email) => email.includes('@'));
}

/** The scheduled run, and *Sync now*: nothing unless meetings sync is on. */
export function runMeetingsSync(
  db: Db,
  sso: MicrosoftSso | null,
  deps: MeetingsDeps = {},
): Promise<MeetingsSyncCounts> {
  if (sso?.meetingsSync !== true) return Promise.resolve({ meetings: 0, added: 0 });
  if (running !== null) return running;
  const now = (deps.now ?? Date.now)();
  const run = (async () => {
    let recorded = false;
    try {
      const read = await readMeetings(sso, activeEmails(db), now, deps);
      const counts = storeMeetings(db, read.meetings, now);
      lastRun = {
        at: now,
        ok: read.artifactError === null,
        meetings: counts.meetings,
        error: read.artifactError,
      };
      recorded = true;
      // Written, and still a failure to report: the log and the page say
      // which grant is missing.
      if (read.artifactError !== null)
        throw new GraphError(read.artifactError, 'microsoft meetings');
      return counts;
    } catch (err) {
      if (!recorded) {
        const code = err instanceof GraphError ? err.code : 'sync_failed';
        lastRun = { at: now, ok: false, meetings: 0, error: code };
      }
      throw err;
    }
  })();
  running = run;
  void run
    .finally(() => {
      if (running === run) running = null;
    })
    .catch(() => undefined);
  return run;
}
