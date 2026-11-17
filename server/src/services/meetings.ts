import { and, desc, eq, isNotNull, like, lt, or, sql } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type MicrosoftSso } from '../auth/sso.ts';
import { type Db } from '../db/client.ts';
import {
  meetingAttendance,
  meetingReviews,
  meetings,
  projects,
  timeEntries,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { dayIn, isTimeZone } from './calendar-days.ts';
import { storeTranscriptReview } from './meeting-reviews.ts';
import {
  FORBIDDEN,
  occurrenceTranscripts,
  organiserId,
  type MeetingsDeps,
} from './meetings-sync.ts';
import { GraphError, graphClient } from './microsoft-graph.ts';
import { type ProviderClient } from './provider.ts';
import { canSeeProject } from './projects.ts';
import { entryById, insertEntry, newEntryFields, type TimeEntryView } from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';
import { recordUndo, type OnUndo } from './time-undo-log.ts';
import { assertUnderTranscriptCap } from './webhooks.ts';

/**
 * The Meetings page's API (LAI-1311): the Teams meetings a person was in,
 * read from what `meetings.sync` stored, plus the two things only a live
 * Graph call can give — the transcript — and the two things a person may do
 * with a meeting: review it with AI, and add it to their day.
 *
 * ## Who sees a meeting
 *
 * **The people Graph listed on it, and nobody else** — not an owner, not an
 * admin. A meeting is visible to a person when one of its attendance rows
 * carries their user id or their (lowercased) address; any other meeting is
 * `not_found`, never `forbidden`, so its existence is not confirmed either.
 * Every path starts with `meeting.read_own` (§3.1, session only).
 *
 * ## The transcript is read, never kept (D-005, D-056)
 *
 * Fetched from Graph on each open, parsed, answered — and dropped. Nothing
 * here writes it to a row, a log line or an activity payload; a review keeps
 * only its hash (§4.12). Only people who **joined**, and the organiser, may
 * read it: being invited to a meeting is not having heard it.
 *
 * ## Time is the person's click (D-088)
 *
 * Nothing drafts time from a meeting. *Add to My day* is the person asking,
 * once per meeting, for a confirmed `meeting` entry of the minutes Teams says
 * they attended — through the same insert every own entry takes, with Undo.
 */

export interface MeetingProjectView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** The reader's own row on a meeting. */
export interface MyAttendanceView {
  readonly invited: boolean;
  /** First join, unix ms; `null` when they did not join (or the meeting has not run). */
  readonly joined_at: number | null;
  /** Last leave, unix ms. */
  readonly left_at: number | null;
  /** Minutes in the meeting, over every interval. */
  readonly minutes: number;
  /** The entry their *Add to My day* made, while it is live; `null` otherwise. */
  readonly time_entry_id: string | null;
}

/** One row of the Meetings list. */
export interface MeetingSummaryView {
  readonly id: string;
  readonly title: string;
  readonly organiser_email: string;
  /** As the calendar named them; `null` when it did not. */
  readonly organiser_name: string | null;
  readonly scheduled_start: number;
  readonly scheduled_end: number;
  /** First join and last leave in Teams' report; `null` until it has run and been read. */
  readonly actual_start: number | null;
  readonly actual_end: number | null;
  /** A Teams meeting — it has a join URL. */
  readonly is_online: boolean;
  readonly join_url: string | null;
  readonly has_transcript: boolean;
  /** The linked space, when the reader may open it. */
  readonly project: MeetingProjectView | null;
  readonly my_attendance: MyAttendanceView;
}

/** `GET /me/meetings`. */
export interface MeetingListView {
  /** Whether this instance syncs meetings (SSO and `LAIKA_MICROSOFT_MEETINGS_SYNC`). */
  readonly enabled: boolean;
  readonly data: MeetingSummaryView[];
  readonly next_cursor: string | null;
}

/** Somebody on a meeting, invited or joined. */
export interface MeetingAttendeeView {
  readonly email: string;
  readonly name: string;
  /** Their Laika account, when one has this address. */
  readonly user_id: string | null;
  readonly invited: boolean;
  readonly joined_at: number | null;
  readonly left_at: number | null;
  readonly minutes: number;
  readonly is_organiser: boolean;
  readonly is_me: boolean;
}

/** The newest Meeting review made from this meeting, when the reader may open it. */
export interface MeetingReviewRefView {
  readonly id: string;
  readonly status: string;
  readonly proposals: number;
  readonly created_at: number;
  readonly project_slug: string;
}

/** `GET /meetings/:id`. */
export interface MeetingDetailView extends MeetingSummaryView {
  /** The reader first, then who joined, then who did not, by name. */
  readonly attendees: MeetingAttendeeView[];
  /** Whether the reader may open the transcript — they joined, or organised it. */
  readonly can_read_transcript: boolean;
  readonly review: MeetingReviewRefView | null;
}

/** One cue of a transcript. */
export interface TranscriptLineView {
  /** From the start of the transcript. */
  readonly at_ms: number;
  readonly speaker: string | null;
  readonly text: string;
}

/** `GET /meetings/:id/transcript` — read from Graph now, kept nowhere. */
export interface MeetingTranscriptView {
  readonly meeting_id: string;
  readonly lines: TranscriptLineView[];
}

/** `POST /meetings/:id/review`. */
export interface MeetingReviewStartedView {
  readonly review_id: string;
  readonly proposals: number;
  readonly project_slug: string;
}

/** What a review from a meeting is stored as, in `meeting_reviews.source`. */
export const meetingReviewSource = (meetingId: string): string => `teams:${meetingId}`;

// ---------------------------------------------------------------- reading

type MeetingRow = typeof meetings.$inferSelect;
type AttendanceRow = typeof meetingAttendance.$inferSelect;

/** An attendance row is the reader's: their id, or their address. */
function mine(actor: ResolvedActor) {
  return or(
    eq(meetingAttendance.userId, actor.userId),
    eq(meetingAttendance.email, actor.email.toLowerCase()),
  );
}

/** The meeting and the reader's own row, or `not_found` — a meeting they were not on is not there. */
function requireMine(
  db: Db,
  actor: ResolvedActor,
  id: string,
): { meeting: MeetingRow; me: AttendanceRow } {
  assertCan(actor, 'meeting.read_own');
  const row = db
    .select({ meeting: meetings, me: meetingAttendance })
    .from(meetings)
    .innerJoin(meetingAttendance, eq(meetingAttendance.meetingId, meetings.id))
    .where(and(eq(meetings.id, id), mine(actor)))
    // A person on twice — by id under one address and by another address —
    // is shown the row that says the most: joined before not.
    .orderBy(sql`${meetingAttendance.joinedAt} IS NULL`)
    .limit(1)
    .get();
  if (row === undefined) throw ApiError.notFound(`No meeting "${id}"`);
  return row;
}

/** The entry an attendance row made, only while it is live. */
function liveEntryId(db: Db, entryId: string | null): string | null {
  if (entryId === null) return null;
  const row = db
    .select({ deletedAt: timeEntries.deletedAt })
    .from(timeEntries)
    .where(eq(timeEntries.id, entryId))
    .get();
  return row?.deletedAt === null ? entryId : null;
}

function projectFor(db: Db, actor: ResolvedActor, projectId: string | null) {
  if (projectId === null || !canSeeProject(actor, projectId)) return null;
  const row = db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return row ?? null;
}

function summaryOf(
  db: Db,
  actor: ResolvedActor,
  meeting: MeetingRow,
  me: AttendanceRow,
): MeetingSummaryView {
  const organiser = db
    .select({ name: meetingAttendance.displayName })
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.meetingId, meeting.id),
        eq(meetingAttendance.email, meeting.organiserEmail),
      ),
    )
    .get();
  return {
    id: meeting.id,
    title: meeting.title,
    organiser_email: meeting.organiserEmail,
    organiser_name: organiser?.name ?? null,
    scheduled_start: meeting.scheduledStart,
    scheduled_end: meeting.scheduledEnd,
    actual_start: meeting.actualStart,
    actual_end: meeting.actualEnd,
    is_online: meeting.joinUrl !== null,
    join_url: meeting.joinUrl,
    has_transcript: meeting.hasTranscript === 1,
    project: projectFor(db, actor, meeting.projectId),
    my_attendance: {
      invited: me.invited === 1,
      joined_at: me.joinedAt,
      left_at: me.leftAt,
      minutes: me.minutes,
      time_entry_id: liveEntryId(db, me.timeEntryId),
    },
  };
}

export type MeetingFilter = 'all' | 'attended' | 'transcript';

export interface ListMeetingsOptions {
  readonly filter: MeetingFilter;
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** `(scheduled_start, id)`, newest first, as an opaque string. */
function encodeCursor(start: number, id: string): string {
  return Buffer.from(`${String(start)}:${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { start: number; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const at = text.indexOf(':');
  const start = Number(text.slice(0, at));
  const id = text.slice(at + 1);
  if (at < 1 || !Number.isSafeInteger(start) || id === '') {
    throw new ApiError('unprocessable', 'That cursor is not one this list gave', {
      field: 'cursor',
      reason: 'invalid_cursor',
    });
  }
  return { start, id };
}

/** `%`, `_` and the escape itself, made literal for `LIKE … ESCAPE '\'`. */
const likeLiteral = (text: string): string => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** `GET /me/meetings`: the reader's meetings, newest scheduled first. */
export function listMyMeetings(
  db: Db,
  actor: ResolvedActor,
  sso: MicrosoftSso | null,
  options: ListMeetingsOptions,
): MeetingListView {
  assertCan(actor, 'meeting.read_own');
  const after = options.cursor === undefined ? null : decodeCursor(options.cursor);
  const q = options.q?.trim() ?? '';

  const rows = db
    .select({ meeting: meetings, me: meetingAttendance })
    .from(meetings)
    .innerJoin(meetingAttendance, eq(meetingAttendance.meetingId, meetings.id))
    .where(
      and(
        mine(actor),
        options.filter === 'attended' ? isNotNull(meetingAttendance.joinedAt) : undefined,
        options.filter === 'transcript' ? eq(meetings.hasTranscript, 1) : undefined,
        q === '' ? undefined : like(meetings.title, `%${likeLiteral(q)}%`),
        after === null
          ? undefined
          : or(
              lt(meetings.scheduledStart, after.start),
              and(eq(meetings.scheduledStart, after.start), lt(meetings.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(meetings.scheduledStart), desc(meetings.id))
    // One more than a page, to know whether there is another; and the reader
    // may match a meeting twice (by id and by address), folded below.
    .limit(options.limit * 2 + 1)
    .all();

  const seen = new Set<string>();
  const data: MeetingSummaryView[] = [];
  let more = false;
  for (const row of rows) {
    if (seen.has(row.meeting.id)) continue;
    if (data.length === options.limit) {
      more = true;
      break;
    }
    seen.add(row.meeting.id);
    data.push(summaryOf(db, actor, row.meeting, row.me));
  }
  const last = data.at(-1);
  return {
    enabled: sso?.meetingsSync === true,
    data,
    next_cursor: more && last !== undefined ? encodeCursor(last.scheduled_start, last.id) : null,
  };
}

/** Whether this row may read what was said: joined, or organised it. */
function heardIt(meeting: MeetingRow, me: AttendanceRow): boolean {
  return me.joinedAt !== null || me.email === meeting.organiserEmail;
}

/** `GET /meetings/:id`. */
export function getMeeting(db: Db, actor: ResolvedActor, id: string): MeetingDetailView {
  const { meeting, me } = requireMine(db, actor, id);
  const rows = db
    .select()
    .from(meetingAttendance)
    .where(eq(meetingAttendance.meetingId, meeting.id))
    .all();
  const attendees = rows
    .map((r): MeetingAttendeeView => ({
      email: r.email,
      name: r.displayName,
      user_id: r.userId,
      invited: r.invited === 1,
      joined_at: r.joinedAt,
      left_at: r.leftAt,
      minutes: r.minutes,
      is_organiser: r.email === meeting.organiserEmail,
      is_me: r.userId === actor.userId || r.email === actor.email.toLowerCase(),
    }))
    .sort(
      (a, b) =>
        Number(b.is_me) - Number(a.is_me) ||
        Number(b.joined_at !== null) - Number(a.joined_at !== null) ||
        a.name.localeCompare(b.name),
    );

  return {
    ...summaryOf(db, actor, meeting, me),
    attendees,
    can_read_transcript: heardIt(meeting, me),
    review: latestReview(db, actor, meeting.id),
  };
}

function latestReview(db: Db, actor: ResolvedActor, meetingId: string) {
  const row = db
    .select({
      id: meetingReviews.id,
      status: meetingReviews.status,
      proposalsJson: meetingReviews.proposalsJson,
      createdAt: meetingReviews.createdAt,
      projectId: meetingReviews.projectId,
      projectSlug: projects.slug,
    })
    .from(meetingReviews)
    .innerJoin(projects, eq(projects.id, meetingReviews.projectId))
    .where(eq(meetingReviews.source, meetingReviewSource(meetingId)))
    .orderBy(desc(meetingReviews.createdAt), desc(meetingReviews.id))
    .limit(1)
    .get();
  // A review in a space the reader cannot open is not theirs to see, even of
  // a meeting they were in — the review's own reads say the same (§10.2).
  if (row === undefined || !canSeeProject(actor, row.projectId)) return null;
  let proposals = 0;
  try {
    const parsed: unknown = JSON.parse(row.proposalsJson);
    proposals = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    proposals = 0;
  }
  return {
    id: row.id,
    status: row.status,
    proposals,
    created_at: row.createdAt,
    project_slug: row.projectSlug,
  };
}

// ----------------------------------------------------------- linking a space

/** `PATCH /meetings/:id { project_id }`: link a space, or `null` to unlink. */
export function linkMeetingProject(
  db: Db,
  actor: ResolvedActor,
  id: string,
  projectId: string | null,
  now: number = Date.now(),
): MeetingDetailView {
  const { meeting } = requireMine(db, actor, id);
  if (projectId !== null) {
    const exists = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    // A space the reader cannot open is not there for them, as everywhere.
    if (exists === undefined || !canSeeProject(actor, projectId)) {
      throw new ApiError('unprocessable', 'No space with that id', {
        field: 'project_id',
        reason: 'unknown_project',
      });
    }
  }
  db.update(meetings).set({ projectId, updatedAt: now }).where(eq(meetings.id, meeting.id)).run();
  return getMeeting(db, actor, id);
}

// ------------------------------------------------------------- transcript

/**
 * WebVTT as Teams writes it — `<v Speaker>words</v>` under each cue's
 * timing — as lines. Anything that is not a cue (the header, notes, cue
 * ids) is skipped; a cue with no voice tag has no speaker.
 */
export function parseVtt(vtt: string): TranscriptLineView[] {
  const lines: TranscriptLineView[] = [];
  const blocks = vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const rows = block.split('\n');
    const timing = rows.findIndex((row) => row.includes('-->'));
    if (timing === -1) continue;
    const start = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/.exec(rows[timing] ?? '');
    if (start === null) continue;
    const [, h, m, s, frac] = start;
    const at =
      ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 +
      Number((frac ?? '0').padEnd(3, '0'));
    const raw = rows
      .slice(timing + 1)
      .join(' ')
      .trim();
    if (raw === '') continue;
    const voice = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(raw);
    const text = raw
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (text === '') continue;
    lines.push({ at_ms: at, speaker: voice?.[1]?.trim() ?? null, text });
  }
  return lines;
}

/** Graph is the only source, so a meetings-sync-off instance cannot answer. */
function requireSync(sso: MicrosoftSso | null): MicrosoftSso {
  if (sso?.meetingsSync !== true) {
    throw new ApiError('unavailable', 'Meetings sync is off on this instance', {
      reason: 'meetings_sync_off',
    });
  }
  return sso;
}

/** A Graph failure as §6.3 says one: unavailable, with the code — never Graph's words. */
function graphUnavailable(err: unknown): never {
  if (err instanceof GraphError) {
    throw new ApiError('unavailable', 'Microsoft Graph could not give the transcript', {
      reason: err.code,
    });
  }
  throw err;
}

/** The transcript's lines, from Graph, for a reader who heard the meeting. */
async function fetchTranscript(
  meeting: MeetingRow,
  me: AttendanceRow,
  sso: MicrosoftSso,
  deps: MeetingsDeps,
): Promise<TranscriptLineView[]> {
  if (!heardIt(meeting, me)) {
    throw new ApiError('forbidden', 'Only people who were in the meeting can read its transcript', {
      reason: 'not_attended',
    });
  }
  if (meeting.hasTranscript !== 1 || meeting.onlineMeetingId === null) {
    throw ApiError.notFound('This meeting has no transcript', { reason: 'no_transcript' });
  }
  try {
    const graph = await graphClient(sso, deps);
    const organiser = await organiserId(graph, meeting.organiserEmail);
    if (organiser === null) {
      throw ApiError.notFound('This meeting has no transcript', { reason: 'no_transcript' });
    }
    const found = await occurrenceTranscripts(graph, organiser, meeting.onlineMeetingId, meeting);
    if (found.length === 0) {
      throw ApiError.notFound('This meeting has no transcript', { reason: 'no_transcript' });
    }
    const lines: TranscriptLineView[] = [];
    for (const transcript of found) {
      const vtt = await graph.text(
        `/users/${encodeURIComponent(organiser)}/onlineMeetings/${encodeURIComponent(meeting.onlineMeetingId)}/transcripts/${encodeURIComponent(transcript.id)}/content?$format=text/vtt`,
        { forbidden: FORBIDDEN.transcripts },
      );
      if (vtt !== null) lines.push(...parseVtt(vtt));
    }
    return lines;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return graphUnavailable(err);
  }
}

/** `GET /meetings/:id/transcript`: read from Graph now; stored nowhere. */
export async function getMeetingTranscript(
  db: Db,
  actor: ResolvedActor,
  sso: MicrosoftSso | null,
  id: string,
  deps: MeetingsDeps = {},
): Promise<MeetingTranscriptView> {
  const { meeting, me } = requireMine(db, actor, id);
  const lines = await fetchTranscript(meeting, me, requireSync(sso), deps);
  return { meeting_id: meeting.id, lines };
}

// ----------------------------------------------------------------- review

/** §10.2's bound on what is sent to a paid provider, the webhook's. */
export const REVIEW_TRANSCRIPT_MAX = 200_000;

export interface ReviewMeetingDeps extends MeetingsDeps {
  /** The org's provider — `providerFor`, or a fake in the tests. */
  readonly provider: () => ProviderClient;
}

/**
 * `POST /meetings/:id/review`: the transcript, read live, into the same
 * pipeline the transcript webhook feeds (`storeTranscriptReview`) — the same
 * monthly cap, the same provider, a `meeting_reviews` row of proposals and
 * the transcript's hash, nothing else. The proposals are applied later, by a
 * person, through the review's own `apply` and its per-proposal `can()`.
 */
export async function reviewMeeting(
  db: Db,
  actor: ResolvedActor,
  sso: MicrosoftSso | null,
  id: string,
  deps: ReviewMeetingDeps,
  now: number = Date.now(),
): Promise<MeetingReviewStartedView> {
  const { meeting, me } = requireMine(db, actor, id);
  if (meeting.projectId === null) {
    throw new ApiError('unprocessable', 'Link the meeting to a space first', {
      field: 'project_id',
      reason: 'no_space',
    });
  }
  const project = db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, meeting.projectId))
    .get();
  if (project === undefined || !canSeeProject(actor, project.id)) {
    throw new ApiError('unprocessable', 'Link the meeting to a space first', {
      field: 'project_id',
      reason: 'no_space',
    });
  }
  // The right to act on a review's proposals in that space, asked before any
  // money is spent: proposing changes a reader could never apply helps nobody.
  assertCan(withProject(actor, project.id), 'meeting_proposal.apply', { projectId: project.id });
  const live = requireSync(sso);
  assertUnderTranscriptCap(db, now);
  const provider = deps.provider();

  const lines = await fetchTranscript(meeting, me, live, deps);
  const transcript = lines
    .map((line) => (line.speaker === null ? line.text : `${line.speaker}: ${line.text}`))
    .join('\n')
    .trim();
  if (transcript === '') {
    throw ApiError.notFound('This meeting has no transcript', { reason: 'no_transcript' });
  }
  if (transcript.length > REVIEW_TRANSCRIPT_MAX) {
    throw new ApiError('unprocessable', 'This transcript is longer than a review can take', {
      reason: 'transcript_too_long',
      max: REVIEW_TRANSCRIPT_MAX,
    });
  }

  const stored = await storeTranscriptReview(
    db,
    provider,
    { projectSlug: project.slug, transcript, source: meetingReviewSource(meeting.id) },
    now,
  );
  return { review_id: stored.id, proposals: stored.proposals, project_slug: project.slug };
}

// --------------------------------------------------------------- log time

/**
 * `POST /meetings/:id/log-time { tz }`: the person's own click (D-088) — a
 * confirmed `meeting` entry of the minutes Teams says they attended, titled
 * as the meeting, on the day they joined in their zone, timed from first join
 * to last leave when that stays on the day. The attendance row keeps the
 * entry's id, so it is made once: again while it is live is `409
 * already_logged`; after it is deleted (Undo, or by hand) it may be made
 * again. Answers the entry, with `X-Undo-Id` through `onUndo`.
 */
export function logMeetingTime(
  db: Db,
  actor: ResolvedActor,
  id: string,
  tz: string,
  now: number = Date.now(),
  onUndo?: OnUndo,
): TimeEntryView {
  const { meeting, me } = requireMine(db, actor, id);
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  if (me.joinedAt === null || me.leftAt === null || me.minutes < 1) {
    throw new ApiError('unprocessable', 'You did not attend this meeting', {
      reason: 'not_attended',
    });
  }
  const logged = liveEntryId(db, me.timeEntryId);
  if (logged !== null) {
    throw new ApiError('conflict', 'This meeting is already on your day', {
      reason: 'already_logged',
      entry_id: logged,
    });
  }
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }

  const day = dayIn(tz, me.joinedAt);
  const minutes = Math.min(1440, me.minutes);
  // Timed only when the span holds the minutes on one day; otherwise the
  // minutes are what is known, as a timer that crossed midnight saves.
  const timed =
    me.leftAt > me.joinedAt &&
    dayIn(tz, me.leftAt - 1) === day &&
    minutes <= Math.ceil((me.leftAt - me.joinedAt) / 60_000);
  const project = projectFor(db, actor, meeting.projectId);
  const fields = newEntryFields(
    db,
    actor,
    {
      day,
      tz,
      minutes,
      kind: 'meeting',
      title: meeting.title.slice(0, 120),
      project: project?.slug,
      ...(timed ? { started_at: me.joinedAt, ended_at: me.leftAt } : {}),
    },
    now,
  );

  const { entryId, undoId } = db.transaction((tx) => {
    const made = insertEntry(tx, actor.userId, fields, 'manual', null, now);
    tx.update(meetingAttendance)
      .set({ timeEntryId: made })
      .where(eq(meetingAttendance.id, me.id))
      .run();
    return {
      entryId: made,
      undoId: recordUndo(tx, actor.userId, made, { drafts: [], entriesMade: [made] }, now),
    };
  });
  onUndo?.(undoId);
  return entryById(db, actor.userId, entryId);
}
