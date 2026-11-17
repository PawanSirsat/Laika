import { useEffect, useState } from 'react';
import { request } from './client.ts';
import { ApiError } from './errors.ts';
import { UNDO_HEADER, type TimeEntry } from './time.ts';

/**
 * Teams meetings (LAI-1311 serves them, LAI-1312 reads them): the reader's own
 * meetings, who was in each, the transcript read live from Graph, a Meeting
 * review made from it, and *Add to My day*.
 *
 * Each type mirrors one of `server/src/services/meetings.ts`' views field for
 * field, under the same nesting, and `view-type-drift.test.ts` pairs every
 * one — so a field the server adds is a red test here, not a field nobody
 * sees. Times are unix ms throughout, as served.
 */

/** Mirrors `MeetingProjectView`: the linked space, when the reader may open it. */
export interface MeetingProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** Mirrors `MyAttendanceView`: the reader's own row on a meeting. */
export interface MyAttendance {
  readonly invited: boolean;
  /** First join; `null` when they did not join, or it has not run. */
  readonly joined_at: number | null;
  readonly left_at: number | null;
  readonly minutes: number;
  /** The entry their *Add to My day* made, while it is live. */
  readonly time_entry_id: string | null;
}

/** Mirrors `MeetingSummaryView`: one row of the list. */
export interface MeetingSummary {
  readonly id: string;
  readonly title: string;
  readonly organiser_email: string;
  readonly organiser_name: string | null;
  readonly scheduled_start: number;
  readonly scheduled_end: number;
  /** First join and last leave in Teams' report; `null` until it has run and been read. */
  readonly actual_start: number | null;
  readonly actual_end: number | null;
  readonly is_online: boolean;
  readonly join_url: string | null;
  readonly has_transcript: boolean;
  readonly project: MeetingProject | null;
  readonly my_attendance: MyAttendance;
}

/** Mirrors `MeetingListView`: `GET /me/meetings`. */
export interface MeetingList {
  /** Whether this instance syncs meetings — Microsoft SSO and meetings sync both on. */
  readonly enabled: boolean;
  readonly data: readonly MeetingSummary[];
  readonly next_cursor: string | null;
}

/** Mirrors `MeetingAttendeeView`: somebody on a meeting, invited or joined. */
export interface MeetingAttendee {
  readonly email: string;
  readonly name: string;
  readonly user_id: string | null;
  readonly invited: boolean;
  readonly joined_at: number | null;
  readonly left_at: number | null;
  readonly minutes: number;
  readonly is_organiser: boolean;
  readonly is_me: boolean;
}

/** Mirrors `MeetingReviewRefView`: the newest Meeting review made from the meeting. */
export interface MeetingReviewRef {
  readonly id: string;
  readonly status: string;
  readonly proposals: number;
  readonly created_at: number;
  readonly project_slug: string;
}

/** Mirrors `MeetingDetailView`: `GET /meetings/:id`. */
export interface MeetingDetail extends MeetingSummary {
  /** The reader first, then who joined, then who did not — the server's order. */
  readonly attendees: readonly MeetingAttendee[];
  readonly can_read_transcript: boolean;
  readonly review: MeetingReviewRef | null;
}

/** Mirrors `TranscriptLineView`: one cue. */
export interface TranscriptLine {
  /** From the start of the transcript. */
  readonly at_ms: number;
  readonly speaker: string | null;
  readonly text: string;
}

/** Mirrors `MeetingTranscriptView`: read from Graph now, kept nowhere. */
export interface MeetingTranscript {
  readonly meeting_id: string;
  readonly lines: readonly TranscriptLine[];
}

/** Mirrors `MeetingReviewStartedView`: `POST /meetings/:id/review`. */
export interface MeetingReviewStarted {
  readonly review_id: string;
  readonly proposals: number;
  readonly project_slug: string;
}

export const MEETING_FILTERS = ['all', 'attended', 'transcript'] as const;
export type MeetingFilter = (typeof MEETING_FILTERS)[number];

/** `?filter=` as the page's address carries it; anything else is `all`. */
export function parseMeetingFilter(raw: string | null | undefined): MeetingFilter {
  return MEETING_FILTERS.find((f) => f === raw) ?? 'all';
}

export interface MeetingListQuery {
  readonly filter?: MeetingFilter | undefined;
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * The query `GET /me/meetings` is sent — `?…`, or nothing — leaving out what
 * is the server's default.
 */
export function meetingListQuery(query: MeetingListQuery): string {
  const params = new URLSearchParams();
  if (query.filter !== undefined && query.filter !== 'all') params.set('filter', query.filter);
  const q = query.q?.trim() ?? '';
  if (q !== '') params.set('q', q);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

const opts = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

export function listMyMeetings(
  query: MeetingListQuery,
  signal?: AbortSignal,
): Promise<MeetingList> {
  return request<MeetingList>(`/me/meetings${meetingListQuery(query)}`, opts(signal));
}

export function getMeeting(id: string, signal?: AbortSignal): Promise<MeetingDetail> {
  return request<MeetingDetail>(`/meetings/${encodeURIComponent(id)}`, opts(signal));
}

/** Link a space, or unlink with `null`; answers the meeting as it now is. */
export function linkMeetingSpace(id: string, projectId: string | null): Promise<MeetingDetail> {
  return request<MeetingDetail>(`/meetings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { project_id: projectId },
  });
}

export function getMeetingTranscript(id: string, signal?: AbortSignal): Promise<MeetingTranscript> {
  return request<MeetingTranscript>(`/meetings/${encodeURIComponent(id)}/transcript`, opts(signal));
}

export function reviewMeeting(id: string): Promise<MeetingReviewStarted> {
  return request<MeetingReviewStarted>(`/meetings/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: {},
  });
}

/**
 * *Add to My day*: a confirmed `meeting` entry of the minutes attended.
 * `onUndo` is told the `X-Undo-Id` the server answers with, which
 * `undo()` in `time.ts` takes back exactly.
 */
export function logMeetingTime(
  id: string,
  tz: string,
  onUndo?: (undoId: string) => void,
): Promise<TimeEntry> {
  return request<TimeEntry>(`/meetings/${encodeURIComponent(id)}/log-time`, {
    method: 'POST',
    body: { tz },
    ...(onUndo === undefined
      ? {}
      : {
          onHeaders: (headers: Headers) => {
            const undoId = headers.get(UNDO_HEADER);
            if (undoId !== null && undoId !== '') onUndo(undoId);
          },
        }),
  });
}

/**
 * The `reason` a refusal carries in its details — `not_attended`,
 * `no_transcript`, `meetings_sync_off`, `no_space`, `already_logged` … — or
 * `undefined`. What a screen branches on, since one code (`unavailable`)
 * covers several states that each want their own words.
 */
export function refusalReason(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * Whether the sidebar offers Meetings (LAI-1312). Meetings need Microsoft
 * SSO, so on any other instance the answer is `false` without asking; on an
 * SSO instance it is the list's own `enabled`, read once per page load with
 * the smallest page — it is deployment settings, the same for every reader
 * and changed only by a restart. A failed read is `false`: an entry that
 * would open on a page saying *not turned on* is worse than none.
 */
let enabledOnce: Promise<boolean> | undefined;

export function meetingsEnabled(read: () => Promise<MeetingList>): Promise<boolean> {
  enabledOnce ??= read().then(
    (list) => list.enabled,
    () => false,
  );
  return enabledOnce;
}

/** Forget the shared answer — for the unit test of {@link meetingsEnabled}. */
export function resetMeetingsEnabled(): void {
  enabledOnce = undefined;
}

/** {@link meetingsEnabled} as a hook; `false` until known, and always while `sso` is false. */
export function useMeetingsEnabled(sso: boolean): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!sso) return;
    let live = true;
    void meetingsEnabled(() => listMyMeetings({ limit: 1 })).then((on) => {
      if (live) setEnabled(on);
    });
    return () => {
      live = false;
    };
  }, [sso]);
  return sso && enabled;
}
