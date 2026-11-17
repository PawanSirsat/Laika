import type { MeetingSummary, TranscriptLine } from '../../../api/meetings.ts';
import { clockRange } from '../../../api/time-label.ts';

/**
 * What the Meetings page (LAI-1312) works out from the server's answers, kept
 * pure so `node --test` reaches it: the list's day groups, each row's chips,
 * the scheduled-versus-actual line, transcript stamps and search, and the
 * keyboard's next row. **Days are the reader's local days** — the server sends
 * unix ms and has no idea which evening is whose.
 */

export type MeetingGroupId = 'today' | 'yesterday' | 'week' | 'upcoming' | 'earlier';

export interface MeetingGroup {
  readonly id: MeetingGroupId;
  readonly label: string;
  readonly meetings: readonly MeetingSummary[];
}

const GROUP_LABELS: Readonly<Record<MeetingGroupId, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Earlier this week',
  upcoming: 'Upcoming',
  earlier: 'Earlier',
};

/**
 * The order the groups are drawn in: the plan's four, then *Earlier* for
 * what is older than this week. The sync reads two weeks back, so without it
 * last week's meetings — attendance still worth adding to a day — would be
 * dropped from the page rather than shown under a heading.
 */
export const GROUP_ORDER: readonly MeetingGroupId[] = [
  'today',
  'yesterday',
  'week',
  'upcoming',
  'earlier',
];

/** Local midnight of the day `at` falls on. */
export function startOfLocalDay(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `days` local days after the day `at` falls on — by the calendar, so a DST day is still one day. */
function shiftDays(dayStart: number, days: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Local midnight of the Monday that starts the week `at` is in. */
export function startOfLocalWeek(at: number): number {
  const day = startOfLocalDay(at);
  // getDay(): Sunday 0 … Saturday 6; a week starts on Monday.
  const back = (new Date(day).getDay() + 6) % 7;
  return shiftDays(day, -back);
}

/** Which group a meeting belongs to, by its scheduled start in the reader's day. */
export function groupOf(
  meeting: Pick<MeetingSummary, 'scheduled_start'>,
  now: number,
): MeetingGroupId {
  const today = startOfLocalDay(now);
  const tomorrow = shiftDays(today, 1);
  const yesterday = shiftDays(today, -1);
  const at = meeting.scheduled_start;
  if (at >= tomorrow) return 'upcoming';
  if (at >= today) return 'today';
  if (at >= yesterday) return 'yesterday';
  if (at >= startOfLocalWeek(now)) return 'week';
  return 'earlier';
}

/**
 * The list in its groups, empty groups left out. Today and Upcoming read
 * soonest first — what is next is at the top; the past reads newest first,
 * as the server sends it.
 */
export function groupMeetings(
  meetings: readonly MeetingSummary[],
  now: number,
): readonly MeetingGroup[] {
  const buckets = new Map<MeetingGroupId, MeetingSummary[]>();
  for (const meeting of meetings) {
    const id = groupOf(meeting, now);
    const bucket = buckets.get(id) ?? [];
    bucket.push(meeting);
    buckets.set(id, bucket);
  }
  return GROUP_ORDER.flatMap((id) => {
    const rows = buckets.get(id);
    if (rows === undefined) return [];
    const ascending = id === 'today' || id === 'upcoming';
    const sorted = [...rows].sort((a, b) =>
      ascending ? a.scheduled_start - b.scheduled_start : b.scheduled_start - a.scheduled_start,
    );
    return [{ id, label: GROUP_LABELS[id], meetings: sorted }];
  });
}

/** The rows in the order they are drawn, for the arrow keys. */
export function drawnOrder(groups: readonly MeetingGroup[]): readonly string[] {
  return groups.flatMap((g) => g.meetings.map((m) => m.id));
}

/**
 * The row an arrow key moves to: the next or previous id, staying put at
 * either end, and the first row when nothing is selected yet.
 */
export function stepSelection(
  ids: readonly string[],
  current: string | undefined,
  step: 1 | -1,
): string | undefined {
  if (ids.length === 0) return undefined;
  const at = current === undefined ? -1 : ids.indexOf(current);
  if (at === -1) return step === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))];
}

export type AttendanceChip =
  | { readonly kind: 'attended'; readonly text: string }
  | { readonly kind: 'missed'; readonly text: string };

/**
 * *Attended 10:04–10:41 AM*, *Missed* (invited, never joined, and it is
 * over), or nothing — a meeting still to come has not been missed yet.
 */
export function attendanceChip(
  meeting: Pick<MeetingSummary, 'my_attendance' | 'scheduled_end'>,
  now: number,
): AttendanceChip | undefined {
  const me = meeting.my_attendance;
  if (me.joined_at !== null) {
    return {
      kind: 'attended',
      text: me.left_at === null ? 'Attended' : `Attended ${clockRange(me.joined_at, me.left_at)}`,
    };
  }
  if (me.invited && meeting.scheduled_end < now) return { kind: 'missed', text: 'Missed' };
  return undefined;
}

/** *Scheduled 10:00–10:30 AM · ran 10:02–10:41 AM*, the second half only once Teams reported it. */
export function scheduleLine(
  meeting: Pick<
    MeetingSummary,
    'scheduled_start' | 'scheduled_end' | 'actual_start' | 'actual_end'
  >,
): string {
  const scheduled = `Scheduled ${clockRange(meeting.scheduled_start, meeting.scheduled_end)}`;
  if (meeting.actual_start === null || meeting.actual_end === null) return scheduled;
  return `${scheduled} · ran ${clockRange(meeting.actual_start, meeting.actual_end)}`;
}

/** Whether a meeting has not finished yet — when *Open in Teams* is worth offering. */
export function isUpcoming(meeting: Pick<MeetingSummary, 'scheduled_end'>, now: number): boolean {
  return meeting.scheduled_end > now;
}

/**
 * Whether *Add to My day* is offered: the reader was there, for some
 * minutes, and has not already added it (the server refuses a second with
 * `409 already_logged` anyway — this keeps the button from inviting it).
 */
export function canAddToDay(meeting: Pick<MeetingSummary, 'my_attendance'>): boolean {
  const me = meeting.my_attendance;
  return me.joined_at !== null && me.minutes > 0 && me.time_entry_id === null;
}

/** Who organised it: their name as the calendar gave it, else their address. */
export function organiserLabel(
  meeting: Pick<MeetingSummary, 'organiser_name' | 'organiser_email'>,
): string {
  const name = meeting.organiser_name?.trim() ?? '';
  return name === '' ? meeting.organiser_email : name;
}

/** A cue's offset as `4:07`, or `1:04:07` past the hour — the stamp Teams shows. */
export function transcriptStamp(atMs: number): string {
  const total = Math.max(0, Math.floor(atMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

/** The lines whose words or speaker contain the search, case-blind; all of them for a blank one. */
export function searchTranscript(
  lines: readonly TranscriptLine[],
  query: string,
): readonly TranscriptLine[] {
  const q = query.trim().toLowerCase();
  if (q === '') return lines;
  return lines.filter(
    (line) => line.text.toLowerCase().includes(q) || (line.speaker ?? '').toLowerCase().includes(q),
  );
}

/**
 * Where a meeting opens: the Meetings page with it selected — the address
 * My day's strip and Meeting review's origin line link to (LAI-1313).
 */
export function meetingHref(id: string): string {
  return `/meetings?meeting=${encodeURIComponent(id)}`;
}
