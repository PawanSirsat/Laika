/**
 * A Microsoft Graph that answers the meetings sync's and the transcript's
 * requests from fixtures, and records every URL it was asked (LAI-1311).
 * **No test calls Microsoft**: this is the injected `fetch`.
 */
import { type MicrosoftSso } from '../../src/auth/sso.ts';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

export const MEETINGS_SSO: MicrosoftSso = {
  provider: 'microsoft',
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 'the-client-secret',
  tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
  directorySync: false,
  meetingsSync: true,
};

export interface FakePerson {
  readonly name: string;
  readonly email: string;
}

export interface FakeReport {
  readonly id: string;
  readonly start: number;
  readonly records: readonly {
    readonly email: string | null;
    readonly name: string;
    readonly intervals: readonly (readonly [number, number])[];
  }[];
}

export interface FakeTranscript {
  readonly id: string;
  readonly created: number;
  readonly vtt: string;
}

export interface FakeMeeting {
  readonly iCalUId: string;
  readonly subject: string;
  readonly start: number;
  readonly end: number;
  readonly organizer: FakePerson;
  readonly attendees: readonly FakePerson[];
  /** Whose calendars show it — lowercased addresses. */
  readonly mailboxes: readonly string[];
  readonly joinUrl?: string;
  readonly onlineId?: string;
  readonly reports?: readonly FakeReport[];
  readonly transcripts?: readonly FakeTranscript[];
  readonly cancelled?: boolean;
}

export type FakeStep =
  | 'token'
  | 'calendar'
  | 'user'
  | 'onlineMeetings'
  | 'reports'
  | 'records'
  | 'transcripts'
  | 'content';

export interface FakeGraphOptions {
  /** Graph user ids by address — anyone not here is 404, an outside organiser. */
  readonly userIds?: Readonly<Record<string, string>>;
  /** Answer this status instead, for a step. */
  readonly status?: Partial<Record<FakeStep, number>>;
  /** Events per calendar page; more come by `@odata.nextLink`. */
  readonly pageSize?: number;
}

/** A Graph date-time as Graph writes one asked for UTC: no offset. */
const graphDate = (ms: number) => ({
  dateTime: new Date(ms).toISOString().replace('Z', '0000'),
  timeZone: 'UTC',
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

export function fakeGraph(meetingsList: readonly FakeMeeting[], options: FakeGraphOptions = {}) {
  const calls: string[] = [];
  const userIds = options.userIds ?? {};
  const pageSize = options.pageSize ?? 100;

  const fetchImpl = ((input: string | URL) => {
    const href = String(input);
    calls.push(href);
    const status = (step: FakeStep) => options.status?.[step];

    if (href.includes('/oauth2/v2.0/token')) {
      const s = status('token');
      if (s !== undefined) return json({}, s);
      return json({ access_token: 'graph-token' });
    }

    const url = new URL(href);
    const parts = url.pathname
      .replace(/^\/v1\.0\//, '')
      .split('/')
      .map(decodeURIComponent);
    // users/{x}/calendarView
    if (parts[0] === 'users' && parts[2] === 'calendarView') {
      const s = status('calendar');
      if (s !== undefined) return json({}, s);
      const mailbox = (parts[1] ?? '').toLowerCase();
      const events = meetingsList
        .filter((m) => m.mailboxes.includes(mailbox))
        .map((m) => ({
          id: `${mailbox}-${m.iCalUId}`,
          iCalUId: m.iCalUId,
          subject: m.subject,
          isCancelled: m.cancelled === true,
          start: graphDate(m.start),
          end: graphDate(m.end),
          organizer: { emailAddress: { name: m.organizer.name, address: m.organizer.email } },
          isOnlineMeeting: m.joinUrl !== undefined,
          onlineMeeting: m.joinUrl === undefined ? null : { joinUrl: m.joinUrl },
          attendees: m.attendees.map((a) => ({
            emailAddress: { name: a.name, address: a.email },
            type: 'required',
          })),
        }));
      const page = Number(url.searchParams.get('page') ?? '0');
      const slice = events.slice(page * pageSize, (page + 1) * pageSize);
      const more = (page + 1) * pageSize < events.length;
      return json({
        value: slice,
        ...(more
          ? {
              '@odata.nextLink': `${GRAPH}/users/${encodeURIComponent(mailbox)}/calendarView?page=${String(page + 1)}`,
            }
          : {}),
      });
    }
    // users/{email}  (?$select=id)
    if (parts[0] === 'users' && parts.length === 2) {
      const s = status('user');
      if (s !== undefined) return json({}, s);
      const id = userIds[(parts[1] ?? '').toLowerCase()];
      return id === undefined ? json({ error: {} }, 404) : json({ id });
    }
    // users/{oid}/onlineMeetings…
    if (parts[0] === 'users' && parts[2] === 'onlineMeetings') {
      const owner = parts[1];
      const ownMeetings = meetingsList.filter(
        (m) => userIds[m.organizer.email.toLowerCase()] === owner && m.onlineId !== undefined,
      );
      if (parts.length === 3) {
        const s = status('onlineMeetings');
        if (s !== undefined) return json({}, s);
        const filter = url.searchParams.get('$filter') ?? '';
        const wanted = /^JoinWebUrl eq '(.*)'$/.exec(filter)?.[1]?.replace(/''/g, "'");
        const found = ownMeetings.filter((m) => m.joinUrl === wanted);
        // One online meeting per join URL, whatever the occurrences.
        const ids = [...new Set(found.map((m) => m.onlineId))];
        return json({ value: ids.map((id) => ({ id })) });
      }
      const online = parts[3];
      const occurrences = ownMeetings.filter((m) => m.onlineId === online);
      if (occurrences.length === 0) return json({ error: {} }, 404);
      if (parts[4] === 'attendanceReports' && parts.length === 5) {
        const s = status('reports');
        if (s !== undefined) return json({}, s);
        const reports = occurrences.flatMap((m) => m.reports ?? []);
        return json({
          value: reports.map((r) => ({
            id: r.id,
            meetingStartDateTime: new Date(r.start).toISOString(),
          })),
        });
      }
      if (parts[4] === 'attendanceReports' && parts[6] === 'attendanceRecords') {
        const s = status('records');
        if (s !== undefined) return json({}, s);
        const report = occurrences.flatMap((m) => m.reports ?? []).find((r) => r.id === parts[5]);
        if (report === undefined) return json({ error: {} }, 404);
        return json({
          value: report.records.map((r) => ({
            emailAddress: r.email,
            identity: { displayName: r.name },
            totalAttendanceInSeconds: r.intervals.reduce(
              (sum, [a, b]) => sum + Math.round((b - a) / 1000),
              0,
            ),
            attendanceIntervals: r.intervals.map(([a, b]) => ({
              joinDateTime: new Date(a).toISOString(),
              leaveDateTime: new Date(b).toISOString(),
              durationInSeconds: Math.round((b - a) / 1000),
            })),
          })),
        });
      }
      if (parts[4] === 'transcripts' && parts.length === 5) {
        const s = status('transcripts');
        if (s !== undefined) return json({}, s);
        return json({
          value: occurrences
            .flatMap((m) => m.transcripts ?? [])
            .map((tr) => ({ id: tr.id, createdDateTime: new Date(tr.created).toISOString() })),
        });
      }
      if (parts[4] === 'transcripts' && parts[6] === 'content') {
        const s = status('content');
        if (s !== undefined) return Promise.resolve(new Response('', { status: s }));
        const transcript = occurrences
          .flatMap((m) => m.transcripts ?? [])
          .find((tr) => tr.id === parts[5]);
        if (transcript === undefined) return json({ error: {} }, 404);
        return Promise.resolve(
          new Response(transcript.vtt, { status: 200, headers: { 'Content-Type': 'text/vtt' } }),
        );
      }
    }
    return json({ error: { message: `unexpected ${href}` } }, 400);
  }) as typeof fetch;

  return { fetchImpl, calls };
}
