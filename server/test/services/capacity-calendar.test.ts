import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { CALENDAR_AWAY_RETENTION_DAYS, pruneTime } from '../../src/jobs/jobs.ts';
import {
  calendarAway,
  orgCalendarSource,
  timeEntries,
  users,
  userTimeSettings,
} from '../../src/db/schema.ts';
import {
  meetingMinutesThisWeek,
  OUTLOOK_AWAY_STALE_MS,
  outlookAwayFor,
  weekOf,
} from '../../src/services/capacity-calendar.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * What Capacity reads of the calendar (LAI-1331): who Outlook shows out of
 * office now, until their own last day, and each person's meeting minutes in
 * their own week — Monday to Sunday, in their own zone.
 */

/** Wednesday 18 November 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 18, 12);
const H = 3_600_000;

let t: TestDb;
let s: Seed;

/** The Outlook connection, saved and switched on unless said otherwise. */
function connect(enabled = true): void {
  t.db
    .insert(orgCalendarSource)
    .values({
      orgId: s.orgId,
      tenantId: 'contoso.onmicrosoft.com',
      clientId: '00000000-0000-4000-8000-000000000000',
      secretEnc: 'not-a-secret',
      secretLast4: 'cret',
      enabled: enabled ? 1 : 0,
      configuredBy: s.userId,
      configuredAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function person(zone: string | null): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: id,
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  if (zone !== null) {
    t.db.insert(userTimeSettings).values({ userId: id, place: zone, updatedAt: NOW }).run();
  }
  return id;
}

function span(
  userId: string,
  startsAt: number,
  endsAt: number,
  extra: { allDay?: boolean; retiredAt?: number; lastSeenAt?: number } = {},
): void {
  t.db
    .insert(calendarAway)
    .values({
      userId,
      eventId: newId(),
      startsAt,
      endsAt,
      allDay: extra.allDay === true ? 1 : 0,
      lastSeenAt: extra.lastSeenAt ?? NOW,
      retiredAt: extra.retiredAt ?? null,
      createdAt: NOW,
    })
    .run();
}

function entry(
  userId: string,
  day: string,
  minutes: number,
  extra: { kind?: 'meeting' | 'work'; deletedAt?: number } = {},
): void {
  t.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      day,
      tz: 'UTC',
      minutes,
      source: 'manual',
      kind: extra.kind ?? 'meeting',
      deletedAt: extra.deletedAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
});
afterEach(() => {
  t.close();
});

describe('weekOf — Monday to Sunday, by calendar day', () => {
  it('names the week a day is in, whichever day of it', () => {
    for (const day of ['2026-11-16', '2026-11-18', '2026-11-22']) {
      expect(weekOf(day)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    }
    expect(weekOf('2026-11-23')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    // Across a month and a year.
    expect(weekOf('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('meetingMinutesThisWeek', () => {
  it('sums this week’s meetings, and nothing deleted, of another kind, or of another week', () => {
    const ada = person('UTC');
    entry(ada, '2026-11-16', 60);
    entry(ada, '2026-11-22', 30);
    entry(ada, '2026-11-17', 90, { deletedAt: NOW });
    entry(ada, '2026-11-17', 120, { kind: 'work' });
    entry(ada, '2026-11-15', 45);
    entry(ada, '2026-11-23', 15);
    expect(meetingMinutesThisWeek(t.db, [ada], NOW)).toEqual(new Map([[ada, 90]]));
  });

  it('gives everyone named a number: 0 with no meetings', () => {
    const bea = person(null);
    expect(meetingMinutesThisWeek(t.db, [bea], NOW)).toEqual(new Map([[bea, 0]]));
    expect(meetingMinutesThisWeek(t.db, [], NOW)).toEqual(new Map());
  });

  it('takes each person’s own week: Sunday afternoon in UTC is Monday in Auckland', () => {
    // Sunday 22 November, 13:00 UTC — 02:00 on Monday the 23rd in Auckland.
    const sunday = Date.UTC(2026, 10, 22, 13);
    const london = person('UTC');
    const auckland = person('Pacific/Auckland');
    for (const id of [london, auckland]) {
      entry(id, '2026-11-22', 60);
      entry(id, '2026-11-23', 25);
    }
    expect(meetingMinutesThisWeek(t.db, [london, auckland], sunday)).toEqual(
      new Map([
        [london, 60],
        [auckland, 25],
      ]),
    );
  });
});

describe('outlookAwayFor', () => {
  beforeEach(() => {
    connect();
  });

  it('names a timed span covering now by the day, in the person’s zone, it ends on', () => {
    // Ends at 23:30 UTC on the 18th: the 19th in Johannesburg.
    const ada = person('Africa/Johannesburg');
    span(ada, NOW - 2 * H, Date.UTC(2026, 10, 18, 23, 30));
    expect(outlookAwayFor(t.db, [ada], NOW)).toEqual(new Map([[ada, { until: '2026-11-19' }]]));
  });

  it('reads an all-day span as dates, never shifted by the zone', () => {
    // Leave Monday 16 to Friday 20: UTC midnights standing for those dates.
    const east = person('Pacific/Auckland');
    const west = person('America/Los_Angeles');
    // Saturday the 21st in Auckland is already past the leave there, while
    // Los Angeles is still on its Friday — and the sync saw both then.
    const late = Date.UTC(2026, 10, 20, 12);
    for (const id of [east, west]) {
      span(id, Date.UTC(2026, 10, 16), Date.UTC(2026, 10, 21), {
        allDay: true,
        lastSeenAt: late,
      });
    }
    expect(outlookAwayFor(t.db, [east, west], NOW)).toEqual(
      new Map([
        [east, { until: '2026-11-20' }],
        [west, { until: '2026-11-20' }],
      ]),
    );
    expect(outlookAwayFor(t.db, [east, west], late)).toEqual(
      new Map([[west, { until: '2026-11-20' }]]),
    );
  });

  it('leaves out a span retired, not begun, or over; takes the latest of two', () => {
    const ada = person('UTC');
    span(ada, NOW - H, NOW + H, { retiredAt: NOW - 1 });
    span(ada, NOW + H, NOW + 5 * H);
    span(ada, NOW - 5 * H, NOW - H);
    expect(outlookAwayFor(t.db, [ada], NOW)).toEqual(new Map());

    span(ada, NOW - H, Date.UTC(2026, 10, 19, 12));
    span(ada, NOW - H, Date.UTC(2026, 10, 25, 12));
    expect(outlookAwayFor(t.db, [ada], NOW)).toEqual(new Map([[ada, { until: '2026-11-25' }]]));
  });

  it('says nobody is away while the connection is switched off or missing (F1)', () => {
    const ada = person('UTC');
    span(ada, NOW - H, NOW + H);
    expect(outlookAwayFor(t.db, [ada], NOW).has(ada)).toBe(true);
    t.db.update(orgCalendarSource).set({ enabled: 0 }).run();
    expect(outlookAwayFor(t.db, [ada], NOW)).toEqual(new Map());
    t.db.delete(orgCalendarSource).run();
    expect(outlookAwayFor(t.db, [ada], NOW)).toEqual(new Map());
  });

  it('stops naming a span the sync has not seen for a day — a mailbox it now skips (F1)', () => {
    const fresh = person('UTC');
    const skipped = person('UTC');
    span(fresh, NOW - H, NOW + H, { lastSeenAt: NOW - OUTLOOK_AWAY_STALE_MS + 1 });
    span(skipped, NOW - H, NOW + H, { lastSeenAt: NOW - OUTLOOK_AWAY_STALE_MS });
    expect(outlookAwayFor(t.db, [fresh, skipped], NOW)).toEqual(
      new Map([[fresh, { until: '2026-11-18' }]]),
    );
  });
});

describe('retention (§4.107, §11.6)', () => {
  it('deletes a span 90 days after it ended, retired or not, and keeps a younger one', () => {
    const ada = person('UTC');
    const ended = NOW - CALENDAR_AWAY_RETENTION_DAYS * 24 * H;
    span(ada, ended - 2 * H, ended - 1);
    span(ada, ended - 2 * H, ended - 1, { retiredAt: ended - H });
    span(ada, ended - 2 * H, ended);
    expect(pruneTime(t.db, NOW).changed).toBe(2);
    expect(t.db.select({ endsAt: calendarAway.endsAt }).from(calendarAway).all()).toEqual([
      { endsAt: ended },
    ]);
  });
});
