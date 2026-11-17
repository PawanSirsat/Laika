import type { MeetingSummary } from '../../../api/meetings.ts';
import { canAddToDay } from '../meetings/meetings-derive.ts';
import { clock, duration, span } from './format.ts';
import { dayIn } from './my-day-derive.ts';

/**
 * What My day's *Meetings today* strip (LAI-1313) works out from
 * `GET /me/meetings?filter=attended`, kept pure so `node --test` reaches it.
 *
 * **Today is My day's today**, counted in the page's zone (`view.tz`), not
 * the Meetings page's browser-local day: the strip sits on a day the page
 * already named, and a meeting it offers must land on that same day.
 */

/**
 * The meetings the strip offers: attended on `today` in `tz` and not yet
 * added — {@link canAddToDay}, the Meetings page's own rule, so the two
 * pages never disagree about what can be added. Soonest first, the order a
 * day reads in.
 */
export function meetingsToday(
  meetings: readonly MeetingSummary[],
  today: string,
  tz: string,
): readonly MeetingSummary[] {
  return meetings
    .filter((m) => {
      const joined = m.my_attendance.joined_at;
      return joined !== null && canAddToDay(m) && dayIn(tz, joined) === today;
    })
    .sort((a, b) => (a.my_attendance.joined_at ?? 0) - (b.my_attendance.joined_at ?? 0));
}

/**
 * *10:04–10:41 AM · 37 min* — when the reader was there, and how long
 * Teams counted. The minutes are Teams' own figure (what *Add to My day*
 * logs), not the gap between join and leave, which counts a drop-out as
 * time attended. No leave yet reads as the join alone.
 */
export function attendedLine(meeting: Pick<MeetingSummary, 'my_attendance'>, tz: string): string {
  const me = meeting.my_attendance;
  const minutes = duration(me.minutes);
  if (me.joined_at === null) return minutes;
  const when =
    me.left_at === null ? `from ${clock(me.joined_at, tz)}` : span(me.joined_at, me.left_at, tz);
  return `${when} · ${minutes}`;
}

/** Where a meeting opens on the Meetings page. */
export function meetingHref(id: string): string {
  return `/meetings?meeting=${encodeURIComponent(id)}`;
}
