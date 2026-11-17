/**
 * Teams meetings through Graph (LAI-1311): what the sync reads, what it
 * stores, and how a missing grant is said.
 *
 * Graph is the fake in `helpers/fake-graph.ts`: it answers the calendar,
 * user, online-meeting, attendance and transcript endpoints from fixtures
 * and records every URL, so the request shape is asserted, not assumed.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meetingAttendance, meetings, users } from '../../src/db/schema.ts';
import { readEnv } from '../../src/env.ts';
import {
  lastMeetingsRun,
  MEETINGS_WINDOW_AHEAD_MS,
  MEETINGS_WINDOW_BACK_MS,
  meetingOf,
  resetMeetingsRun,
  runMeetingsSync,
} from '../../src/services/meetings-sync.ts';
import { GraphError } from '../../src/services/microsoft-graph.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  fakeGraph,
  type FakeGraphOptions,
  type FakeMeeting,
  MEETINGS_SSO as SSO,
} from '../helpers/fake-graph.ts';
import {
  ADA,
  addPeople,
  ALL,
  BO,
  CY,
  NOW,
  STANDUP,
  USER_IDS,
} from '../helpers/meetings-fixture.ts';

let t: TestDb;
let s: Seed;
let people: { bo: string; cy: string; vi: string };

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  people = addPeople(t.db);
  resetMeetingsRun();
});
afterEach(() => {
  t.close();
});

function sync(list: readonly FakeMeeting[] = ALL, options: FakeGraphOptions = {}) {
  const graph = fakeGraph(list, { userIds: USER_IDS, ...options });
  return {
    graph,
    run: runMeetingsSync(t.db, SSO, { fetch: graph.fetchImpl, now: () => NOW }),
  };
}

const meetingBy = (key: string) =>
  t.db.select().from(meetings).where(eq(meetings.graphEventId, key)).get();

const attendanceOf = (meetingId: string) =>
  t.db
    .select()
    .from(meetingAttendance)
    .where(eq(meetingAttendance.meetingId, meetingId))
    .all()
    .sort((a, b) => a.email.localeCompare(b.email));

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GraphError);
    return (err as GraphError).code;
  }
  throw new Error('expected the sync to fail');
}

describe('LAIKA_MICROSOFT_MEETINGS_SYNC', () => {
  const base = {
    NODE_ENV: 'test',
    LAIKA_SECRET: 'x'.repeat(40),
    LAIKA_PUBLIC_URL: 'http://localhost:3000',
    LAIKA_MICROSOFT_CLIENT_ID: SSO.clientId,
    LAIKA_MICROSOFT_CLIENT_SECRET: SSO.clientSecret,
    LAIKA_MICROSOFT_TENANT_ID: SSO.tenantId,
  };

  it('is off unless it says true, and independent of directory sync', () => {
    expect(readEnv(base).sso?.meetingsSync).toBe(false);
    expect(readEnv({ ...base, LAIKA_MICROSOFT_MEETINGS_SYNC: 'false' }).sso?.meetingsSync).toBe(
      false,
    );
    const on = readEnv({ ...base, LAIKA_MICROSOFT_MEETINGS_SYNC: 'True' }).sso;
    expect(on?.meetingsSync).toBe(true);
    expect(on?.directorySync).toBe(false);
  });

  it('refuses anything else, and refuses to run without SSO', () => {
    expect(() => readEnv({ ...base, LAIKA_MICROSOFT_MEETINGS_SYNC: 'on' })).toThrow(
      /LAIKA_MICROSOFT_MEETINGS_SYNC.*true or false/,
    );
    expect(() =>
      readEnv({
        NODE_ENV: 'test',
        LAIKA_SECRET: 'x'.repeat(40),
        LAIKA_PUBLIC_URL: 'http://localhost:3000',
        LAIKA_MICROSOFT_MEETINGS_SYNC: 'true',
      }),
    ).toThrow(/LAIKA_MICROSOFT_MEETINGS_SYNC.*needs Microsoft SSO/);
  });
});

describe('reading Graph', () => {
  it('asks each active member’s calendar for −14…+7 days, in UTC', async () => {
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, people.cy)).run();
    const { graph, run } = sync();
    await run;

    const calendars = graph.calls.filter((u) => u.includes('/calendarView'));
    const asked = calendars.map((u) => decodeURIComponent(new URL(u).pathname.split('/')[3] ?? ''));
    // Cy is switched off: their calendar is not read.
    expect(asked.sort()).toEqual([BO.email, ADA.email, 'vi@example.test'].sort());
    const url = new URL(calendars[0] ?? '');
    expect(url.searchParams.get('startDateTime')).toBe(
      new Date(NOW - MEETINGS_WINDOW_BACK_MS).toISOString(),
    );
    expect(url.searchParams.get('endDateTime')).toBe(
      new Date(NOW + MEETINGS_WINDOW_AHEAD_MS).toISOString(),
    );
    expect(url.searchParams.get('$select')).toContain('attendees');
    expect(url.searchParams.get('$select')).toContain('onlineMeeting');
  });

  it('resolves an ended online meeting by its join URL, under its organiser', async () => {
    const { graph, run } = sync();
    await run;
    const lookup = graph.calls.find((u) => u.includes('/onlineMeetings?'));
    expect(new URL(lookup ?? '').pathname).toBe('/v1.0/users/oid-ada/onlineMeetings');
    expect(new URL(lookup ?? '').searchParams.get('$filter')).toBe(
      `JoinWebUrl eq '${STANDUP.joinUrl ?? ''}'`,
    );
    // Upcoming meetings have no report yet: nothing asked for the planning one.
    expect(graph.calls.some((u) => u.includes('om-planning'))).toBe(false);
  });

  it('keeps out a cancelled event, and keys a meeting by iCalUId across calendars', () => {
    expect(meetingOf({ iCalUId: 'x', isCancelled: true })).toBeNull();
    const m = meetingOf({
      id: 'mailbox-local-id',
      iCalUId: 'shared',
      subject: '  Standup ',
      start: { dateTime: '2026-11-17T10:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-17T10:30:00.0000000', timeZone: 'UTC' },
      organizer: { emailAddress: { name: 'Ada', address: 'Ada@Example.Test' } },
      attendees: [{ emailAddress: { name: 'Bo', address: 'BO@example.test' } }],
    });
    expect(m?.graphEventId).toBe('shared');
    expect(m?.title).toBe('Standup');
    expect(m?.scheduledStart).toBe(Date.UTC(2026, 10, 17, 10));
    expect([...(m?.attendees.keys() ?? [])]).toEqual(['ada@example.test', 'bo@example.test']);
  });
});

describe('what it stores', () => {
  it('meetings, invites, real join and leave, and whether a transcript exists', async () => {
    const counts = await sync().run;
    expect(counts).toEqual({ meetings: 3, added: 3 });
    expect(meetingBy('ical-cancelled')).toBeUndefined();

    const standup = meetingBy('ical-standup');
    expect(standup).toMatchObject({
      title: 'Daily standup',
      organiserEmail: ADA.email,
      joinUrl: STANDUP.joinUrl,
      onlineMeetingId: 'om-standup',
      scheduledStart: STANDUP.start,
      scheduledEnd: STANDUP.end,
      actualStart: Date.UTC(2026, 10, 17, 10, 2),
      actualEnd: Date.UTC(2026, 10, 17, 10, 41),
      hasTranscript: 1,
      orgId: s.orgId,
      projectId: null,
    });

    const rows = attendanceOf(standup?.id ?? '');
    expect(rows.map((r) => r.email)).toEqual([BO.email, CY.email, ADA.email, 'vi@example.test']);
    const ada = rows.find((r) => r.email === ADA.email);
    expect(ada).toMatchObject({
      userId: s.userId,
      invited: 1,
      joinedAt: Date.UTC(2026, 10, 17, 10, 2),
      leftAt: Date.UTC(2026, 10, 17, 10, 41),
      // Two intervals: 18 + 16, not the span's 39.
      minutes: 34,
    });
    expect(rows.find((r) => r.email === BO.email)).toMatchObject({
      userId: people.bo,
      minutes: 25,
    });
    // Invited, never joined.
    expect(rows.find((r) => r.email === CY.email)).toMatchObject({
      invited: 1,
      joinedAt: null,
      minutes: 0,
    });

    // An outside organiser's meeting is kept from the calendar; its artifacts
    // are not this tenant's to read.
    const outside = meetingBy('ical-outside');
    expect(outside).toMatchObject({ onlineMeetingId: null, hasTranscript: 0, actualStart: null });
  });

  it('a second run changes no ids and keeps a linked space and a logged entry', async () => {
    await sync().run;
    const first = meetingBy('ical-standup');
    t.db
      .update(meetings)
      .set({ projectId: s.projectId })
      .where(eq(meetings.id, first?.id ?? ''))
      .run();
    const before = t.db.select().from(meetingAttendance).all();
    resetMeetingsRun();

    const again = await sync().run;
    expect(again).toEqual({ meetings: 3, added: 0 });
    expect(t.db.select().from(meetings).all()).toHaveLength(3);
    const second = meetingBy('ical-standup');
    expect(second?.id).toBe(first?.id);
    expect(second?.projectId).toBe(s.projectId);
    const after = t.db.select().from(meetingAttendance).all();
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it('follows the calendar’s pages', async () => {
    const { graph, run } = sync(ALL, { pageSize: 1 });
    expect(await run).toEqual({ meetings: 3, added: 3 });
    expect(graph.calls.some((u) => u.includes('calendarView?page=1'))).toBe(true);
  });

  it('gives each occurrence of a recurring meeting its own attendance', async () => {
    const day = 24 * 60 * 60 * 1000;
    const series = (n: number, joined: number): FakeMeeting => ({
      ...STANDUP,
      iCalUId: `ical-series-${String(n)}`,
      start: STANDUP.start - n * day,
      end: STANDUP.end - n * day,
      // One online meeting for the whole series, a report per occurrence.
      reports: [
        {
          id: `report-series-${String(n)}`,
          start: STANDUP.start - n * day,
          records: [
            {
              email: ADA.email,
              name: 'Owner',
              intervals: [[STANDUP.start - n * day, STANDUP.start - n * day + joined * 60_000]],
            },
          ],
        },
      ],
      transcripts: n === 1 ? [{ id: 'tr-series', created: STANDUP.start - day, vtt: '' }] : [],
    });
    await sync([series(1, 10), series(2, 20)]).run;
    const minutes = (key: string) =>
      t.db
        .select({ minutes: meetingAttendance.minutes })
        .from(meetingAttendance)
        .innerJoin(meetings, eq(meetings.id, meetingAttendance.meetingId))
        .where(and(eq(meetings.graphEventId, key), eq(meetingAttendance.email, ADA.email)))
        .get()?.minutes;
    expect(minutes('ical-series-1')).toBe(10);
    expect(minutes('ical-series-2')).toBe(20);
    expect(meetingBy('ical-series-1')?.hasTranscript).toBe(1);
    expect(meetingBy('ical-series-2')?.hasTranscript).toBe(0);
  });

  it('has no column a transcript could be written to', () => {
    const columns = (table: string) =>
      t.sqlite
        .prepare(`SELECT name FROM pragma_table_info(?)`)
        .all(table)
        .map((r) => (r as { name: string }).name);
    for (const table of ['meetings', 'meeting_attendance']) {
      const suspicious = columns(table).filter(
        (c) => c !== 'has_transcript' && /transcript|vtt|content|text|body/.test(c),
      );
      expect(suspicious).toEqual([]);
    }
    expect(columns('meetings')).toContain('has_transcript');
  });
});

describe('failures, as codes naming the grant', () => {
  it('a refused calendar changes nothing and says Calendars.Read', async () => {
    const { run } = sync(ALL, { status: { calendar: 403 } });
    expect(await failureCode(run)).toBe('graph_forbidden_grant_calendars_read');
    expect(t.db.select().from(meetings).all()).toEqual([]);
    expect(lastMeetingsRun()).toMatchObject({
      at: NOW,
      ok: false,
      meetings: 0,
      error: 'graph_forbidden_grant_calendars_read',
    });
  });

  it('a refused attendance report still writes the calendars, and says why it is incomplete', async () => {
    const { run } = sync(ALL, { status: { reports: 403 } });
    expect(await failureCode(run)).toBe('graph_forbidden_grant_onlinemeetingartifact_read_all');
    expect(t.db.select().from(meetings).all()).toHaveLength(3);
    const standup = meetingBy('ical-standup');
    expect(standup?.actualStart).toBeNull();
    expect(attendanceOf(standup?.id ?? '').every((r) => r.joinedAt === null)).toBe(true);
    expect(lastMeetingsRun()).toMatchObject({
      ok: false,
      meetings: 3,
      error: 'graph_forbidden_grant_onlinemeetingartifact_read_all',
    });
  });

  it('names each permission: online meetings, transcripts, users', async () => {
    expect(await failureCode(sync(ALL, { status: { onlineMeetings: 403 } }).run)).toBe(
      'graph_forbidden_grant_onlinemeetings_read_all',
    );
    resetMeetingsRun();
    expect(await failureCode(sync(ALL, { status: { transcripts: 403 } }).run)).toBe(
      'graph_forbidden_grant_onlinemeetingtranscript_read_all',
    );
    resetMeetingsRun();
    expect(await failureCode(sync(ALL, { status: { user: 403 } }).run)).toBe(
      'graph_forbidden_grant_user_read_all',
    );
  });

  it('a stored attendance survives a run that could not read the report', async () => {
    await sync().run;
    resetMeetingsRun();
    await failureCode(sync(ALL, { status: { reports: 500 } }).run);
    const standup = meetingBy('ical-standup');
    expect(standup?.hasTranscript).toBe(1);
    const ada = attendanceOf(standup?.id ?? '').find((r) => r.email === ADA.email);
    expect(ada?.minutes).toBe(34);
  });
});

describe('the run', () => {
  it('does nothing at all, and calls nobody, unless meetings sync is on', async () => {
    const graph = fakeGraph(ALL, { userIds: USER_IDS });
    await runMeetingsSync(t.db, { ...SSO, meetingsSync: false }, { fetch: graph.fetchImpl });
    await runMeetingsSync(t.db, null, { fetch: graph.fetchImpl });
    expect(graph.calls).toEqual([]);
    expect(lastMeetingsRun()).toBeNull();
  });

  it('records a good run, and joins one already going rather than doubling it', async () => {
    const graph = fakeGraph(ALL, { userIds: USER_IDS });
    const deps = { fetch: graph.fetchImpl, now: () => NOW };
    const first = runMeetingsSync(t.db, SSO, deps);
    const second = runMeetingsSync(t.db, SSO, deps);
    expect(second).toBe(first);
    await first;
    expect(graph.calls.filter((u) => u.includes('/oauth2/v2.0/token'))).toHaveLength(1);
    expect(lastMeetingsRun()).toEqual({ at: NOW, ok: true, meetings: 3, error: null });
  });
});
