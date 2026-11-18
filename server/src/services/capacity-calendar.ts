import { and, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { calendarAway, orgCalendarSource, timeEntries } from '../db/schema.ts';
import { zonesFor } from './availability.ts';
import { addDays, dayIn } from './calendar-days.ts';

/**
 * What Capacity reads of the calendar (LAI-1331, D-157 amended): who Outlook
 * shows out of office now, and each person's meetings this week. **No `can()`
 * here** — `capacityNow` decides who may be told and logs the looks; these
 * only read, for the people it names.
 */

/** An Outlook out-of-office span covering now: the last day of it, in the person's own zone. */
export interface OutlookAwaySpan {
  until: string;
}

/** The furthest any zone is from UTC: fourteen hours, Kiribati's. */
const ZONE_REACH_MS = 14 * 3_600_000;

/**
 * How long a span the sync stopped seeing still counts: a day. The sync runs
 * every 15 minutes and stamps `last_seen_at` on every span it reads, so a
 * standing one is never older than that while it works. A mailbox it skips
 * (`403`, `404`, `400`) has nothing of its own retired, and a sync that keeps
 * failing retires nothing at all — past a day, Capacity stops saying so.
 */
export const OUTLOOK_AWAY_STALE_MS = 24 * 3_600_000;

/** The UTC calendar date of an instant: how an all-day span's midnights are read. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * For each of `userIds` that Outlook shows out of office **now** (§4.107: a
 * span standing), the last day of it as their own calendar day — the one
 * ending last when two cover now.
 *
 * **Only while the sync reads it**: nobody while the Outlook connection is
 * missing or switched off, and no span the sync has not seen for
 * {@link OUTLOOK_AWAY_STALE_MS}.
 *
 * - **Timed**: it covers now when it began and has not ended; its last day
 *   is the day, in their zone, of the instant before it ends.
 * - **All day**: its midnights stand for **dates** (the sync reads in UTC),
 *   so it covers now when their own today falls between its first and last
 *   date — never shifted by their zone, which would end a Friday's leave on
 *   Saturday for anyone east of UTC. **This assumes Graph returns an all-day
 *   event's start and end as UTC midnights under the sync's
 *   `Prefer: outlook.timezone="UTC"`** (§4.107); it is to be checked live on
 *   Ksage after release.
 */
export function outlookAwayFor(
  db: Db,
  userIds: readonly string[],
  now: number,
): Map<string, OutlookAwaySpan> {
  const out = new Map<string, OutlookAwaySpan>();
  if (userIds.length === 0) return out;
  const source = db.select({ enabled: orgCalendarSource.enabled }).from(orgCalendarSource).get();
  if (source?.enabled !== 1) return out;
  const zones = zonesFor(db, userIds);
  for (const span of db
    .select({
      userId: calendarAway.userId,
      startsAt: calendarAway.startsAt,
      endsAt: calendarAway.endsAt,
      allDay: calendarAway.allDay,
    })
    .from(calendarAway)
    .where(
      and(
        inArray(calendarAway.userId, [...userIds]),
        isNull(calendarAway.retiredAt),
        gt(calendarAway.lastSeenAt, now - OUTLOOK_AWAY_STALE_MS),
        // Wide enough for an all-day date that is today in any zone.
        lte(calendarAway.startsAt, now + ZONE_REACH_MS),
        gt(calendarAway.endsAt, now - ZONE_REACH_MS),
      ),
    )
    .all()) {
    const zone = zones.get(span.userId) ?? 'UTC';
    let until: string;
    if (span.allDay === 1) {
      const today = dayIn(zone, now);
      until = utcDay(span.endsAt - 1);
      if (today < utcDay(span.startsAt) || today > until) continue;
    } else {
      if (span.startsAt > now || span.endsAt <= now) continue;
      until = dayIn(zone, span.endsAt - 1);
    }
    const kept = out.get(span.userId);
    if (kept === undefined || until > kept.until) out.set(span.userId, { until });
  }
  return out;
}

/** Monday of the week `day` is in, and its Sunday: ISO weeks, by calendar day. */
export function weekOf(day: string): { from: string; to: string } {
  // 0 Sunday … 6 Saturday, for a date at its UTC midnight.
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const from = addDays(day, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/**
 * Each of `userIds`' meeting minutes this week — Monday to Sunday of the
 * week their own today is in, in their own zone — from what is logged
 * (`time_entries`, `kind` `meeting`, not deleted): the calendar's meetings and
 * any the person typed. No new Graph call. Everyone named gets a number, `0`
 * when they had none.
 */
export function meetingMinutesThisWeek(
  db: Db,
  userIds: readonly string[],
  now: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const zones = zonesFor(db, userIds);
  const weeks = new Map(
    [...zones].map(([userId, zone]) => [userId, weekOf(dayIn(zone, now))] as const),
  );
  const spans = [...weeks.values()];
  const from = spans.map((w) => w.from).sort()[0] ?? '';
  const to =
    spans
      .map((w) => w.to)
      .sort()
      .at(-1) ?? '';
  for (const id of userIds) out.set(id, 0);
  for (const row of db
    .select({
      userId: timeEntries.userId,
      day: timeEntries.day,
      minutes: sql<number>`sum(${timeEntries.minutes})`,
    })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.userId, [...userIds]),
        eq(timeEntries.kind, 'meeting'),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.day, from),
        lte(timeEntries.day, to),
      ),
    )
    .groupBy(timeEntries.userId, timeEntries.day)
    .all()) {
    const week = weeks.get(row.userId);
    if (week === undefined || row.day < week.from || row.day > week.to) continue;
    out.set(row.userId, (out.get(row.userId) ?? 0) + Number(row.minutes));
  }
  return out;
}
