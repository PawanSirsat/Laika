/**
 * The people and meetings the LAI-1311 tests share: Ada (the seeded owner),
 * Bo and Cy (members), a Viewer, and an outside organiser — with a Teams
 * standup that has run, a planning meeting tomorrow, a cancelled one and an
 * ended meeting organised outside the tenant.
 */
import { type Db } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { users } from '../../src/db/schema.ts';
import { type FakeMeeting } from './fake-graph.ts';

/** Tuesday 17 November 2026, 15:00 UTC. */
export const NOW = Date.UTC(2026, 10, 17, 15);
const at = (h: number, m: number, dayOffset = 0) => Date.UTC(2026, 10, 17 + dayOffset, h, m);

export const ADA = { name: 'Owner', email: 'owner@example.test' };
export const BO = { name: 'Bo Member', email: 'bo@example.test' };
export const CY = { name: 'Cy Member', email: 'cy@example.test' };
export const VI = { name: 'Vi Viewer', email: 'vi@example.test' };
export const EXT = { name: 'Outside Organiser', email: 'ext@other.example' };

export const USER_IDS = { [ADA.email]: 'oid-ada', [BO.email]: 'oid-bo' };

export const STANDUP_JOIN = 'https://teams.microsoft.com/l/meetup-join/standup';

/** The words only a transcript has — searched for everywhere they must not be. */
export const SECRET_WORDS = 'the quarterly figures are confidential';

export const STANDUP_VTT = `WEBVTT

0a1b2c3d-1
00:00:01.500 --> 00:00:04.000
<v Owner>Morning, everyone.</v>

0a1b2c3d-2
00:01:02.000 --> 00:01:06.250
<v Bo Member>I think ${SECRET_WORDS} &amp; should stay that way.</v>

NOTE nothing here is a cue

00:02:00.000 --> 00:02:01.000
no voice tag at all
`;

export const STANDUP: FakeMeeting = {
  iCalUId: 'ical-standup',
  subject: 'Daily standup',
  start: at(10, 0),
  end: at(10, 30),
  organizer: ADA,
  attendees: [BO, CY, VI],
  mailboxes: [ADA.email, BO.email],
  joinUrl: STANDUP_JOIN,
  onlineId: 'om-standup',
  reports: [
    {
      id: 'report-1',
      start: at(10, 2),
      records: [
        // 18 + 16 = 34 minutes over two intervals.
        {
          email: ADA.email,
          name: 'Owner',
          intervals: [
            [at(10, 2), at(10, 20)],
            [at(10, 25), at(10, 41)],
          ],
        },
        { email: BO.email.toUpperCase(), name: 'Bo Member', intervals: [[at(10, 5), at(10, 30)]] },
        // An anonymous guest has no address, so no row and nobody to show it to.
        { email: null, name: 'Guest', intervals: [[at(10, 3), at(10, 9)]] },
      ],
    },
  ],
  transcripts: [{ id: 'tr-1', created: at(10, 3), vtt: STANDUP_VTT }],
};

export const PLANNING: FakeMeeting = {
  iCalUId: 'ical-planning',
  subject: 'Planning',
  start: at(9, 0, 1),
  end: at(10, 0, 1),
  organizer: BO,
  attendees: [ADA],
  mailboxes: [ADA.email, BO.email],
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/planning',
  onlineId: 'om-planning',
};

export const CANCELLED: FakeMeeting = {
  iCalUId: 'ical-cancelled',
  subject: 'Cancelled',
  start: at(12, 0),
  end: at(12, 30),
  organizer: ADA,
  attendees: [BO],
  mailboxes: [ADA.email],
  cancelled: true,
};

export const OUTSIDE: FakeMeeting = {
  iCalUId: 'ical-outside',
  subject: 'Vendor call',
  start: at(8, 0),
  end: at(8, 30),
  organizer: EXT,
  attendees: [ADA],
  mailboxes: [ADA.email],
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/vendor',
};

export const ALL = [STANDUP, PLANNING, CANCELLED, OUTSIDE];

/** Bo, Cy and Vi as Laika members; Ada is the seed's owner. */
export function addPeople(db: Db, now = NOW): { bo: string; cy: string; vi: string } {
  const make = (p: { name: string; email: string }, orgRole: 'member' | 'viewer') => {
    const id = newId();
    db.insert(users)
      .values({
        id,
        email: p.email,
        name: p.name,
        orgRole,
        isActive: 1,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
    return id;
  };
  return { bo: make(BO, 'member'), cy: make(CY, 'member'), vi: make(VI, 'viewer') };
}
