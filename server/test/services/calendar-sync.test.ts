import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import {
  calendarAway,
  calendarEvents,
  orgCalendarSource,
  orgTimeSettings,
  projectMemberships,
  projects,
  timeEntries,
  timeEntryRevisions,
  users,
  userTimeSettings,
} from '../../src/db/schema.ts';
import { encryptSecret } from '../../src/secrets.ts';
import {
  calendarSyncInFlight,
  type CalendarSyncOutcome,
  classify,
  runCalendarBackfill,
  runCalendarSync,
  type StoredRule,
  windowFor,
} from '../../src/services/calendar-sync.ts';
import { type GraphEvent } from '../../src/services/microsoft-graph.ts';
import { patchEntry, retireEntry } from '../../src/services/time-entries.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
  graphEvent,
  graphTime,
} from '../helpers/fake-graph.ts';

/**
 * The Outlook calendar sync (D-157, LAI-1316), against a fake Graph and a
 * real database: invitations not declined (LAI-1335) and organised Teams
 * meetings logged as the person's confirmed time, the rest left out, a
 * person's edit never overwritten, one run at a time, and a backfill of the
 * last N days (LAI-1335).
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
/** 18 November 2026, 14:00 in Johannesburg. */
const NOW = Date.UTC(2026, 10, 18, 12);
const ZONE = 'Africa/Johannesburg';
/** 09:00 in Johannesburg on a day of November 2026. */
const nineOn = (day: number): number => Date.UTC(2026, 10, day, 7);

let t: TestDb;
let s: Seed;
let ada: string;
let bea: string;
let fake: FakeGraph;

function person(name: string, email: string, zone: string | null = ZONE, active = true): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email,
      name,
      orgRole: 'member',
      isActive: active ? 1 : 0,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  if (zone !== null) {
    t.db.insert(userTimeSettings).values({ userId: id, place: zone, updatedAt: NOW }).run();
  }
  return id;
}

/** Make `userId` a member of a space, so its rules may send their meetings there. */
function join(userId: string, projectId: string): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role: 'member', createdAt: NOW })
    .run();
}

/** A saved connection, switched on unless said otherwise. */
function connect(opts: { enabled?: boolean; rules?: StoredRule[] } = {}): void {
  t.db
    .insert(orgCalendarSource)
    .values({
      orgId: s.orgId,
      tenantId: GRAPH_TENANT,
      clientId: GRAPH_CLIENT,
      secretEnc: encryptSecret(GRAPH_SECRET, SECRET, 'calendar_client_secret'),
      secretLast4: GRAPH_SECRET.slice(-4),
      enabled: opts.enabled === false ? 0 : 1,
      rulesJson: JSON.stringify(opts.rules ?? []),
      configuredBy: s.userId,
      configuredAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function timeOn(mode: 'off' | 'manual' = 'manual', closedThrough: string | null = null): void {
  t.db
    .insert(orgTimeSettings)
    .values({ orgId: s.orgId, mode, closedThrough, updatedAt: NOW })
    .onConflictDoUpdate({ target: orgTimeSettings.orgId, set: { mode, closedThrough } })
    .run();
}

function sync(now = NOW, f: FakeGraph = fake): Promise<CalendarSyncOutcome> {
  return runCalendarSync(t.db, SECRET, {
    fetchImpl: f.fetchImpl,
    now: () => now,
    sleep: () => Promise.resolve(),
    timeoutMs: 50,
  });
}

function backfill(days: number, now = NOW, f: FakeGraph = fake): Promise<CalendarSyncOutcome> {
  return runCalendarBackfill(t.db, SECRET, days, {
    fetchImpl: f.fetchImpl,
    now: () => now,
    sleep: () => Promise.resolve(),
    timeoutMs: 50,
  });
}

function entriesOf(userId: string) {
  return t.db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.userId, userId))
    .orderBy(asc(timeEntries.startedAt))
    .all();
}

function revisionsOf(entryId: string) {
  return t.db
    .select()
    .from(timeEntryRevisions)
    .where(eq(timeEntryRevisions.entryId, entryId))
    .orderBy(asc(timeEntryRevisions.revision))
    .all();
}

function awayOf(userId: string) {
  return t.db
    .select()
    .from(calendarAway)
    .where(eq(calendarAway.userId, userId))
    .orderBy(asc(calendarAway.startsAt))
    .all();
}

function sourceRow() {
  return t.db.select().from(orgCalendarSource).get();
}

function synced(outcome: CalendarSyncOutcome) {
  if (outcome.kind !== 'synced') throw new Error(`expected a sync, got ${JSON.stringify(outcome)}`);
  return outcome.result;
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  ada = person('Ada', 'Ada@Kvelld.example');
  bea = person('Bea', 'bea@kvelld.example');
  // The seeded owner has a calendar too, empty.
  fake = fakeGraph({
    calendars: { 'owner@example.test': [], 'ada@kvelld.example': [], 'bea@kvelld.example': [] },
  });
  timeOn();
});
afterEach(async () => {
  await calendarSyncInFlight(t.db);
  t.close();
});

describe('when it runs', () => {
  it('does nothing with no connection, the switch off, no secret, or Time off', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    expect(await sync()).toEqual({ kind: 'skipped' });

    connect({ enabled: false });
    expect(await sync()).toEqual({ kind: 'skipped' });

    t.db.update(orgCalendarSource).set({ enabled: 1 }).run();
    expect(await runCalendarSync(t.db, '', { fetchImpl: fake.fetchImpl, now: () => NOW })).toEqual({
      kind: 'skipped',
    });

    timeOn('off');
    expect(await sync()).toEqual({ kind: 'skipped' });

    expect(fake.requests).toHaveLength(0);
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
    expect(sourceRow()?.lastAttemptAt).toBeNull();
  });

  it('reads each active member by their lowercased email, in their own window', async () => {
    person('Cy', 'cy@kvelld.example', 'UTC', false);
    connect();
    synced(await sync());
    const asked = fake.of('calendarView');
    expect(asked.map((r) => r.user).sort()).toEqual([
      'ada@kvelld.example',
      'bea@kvelld.example',
      'owner@example.test',
    ]);
    const adaRead = asked.find((r) => r.user === 'ada@kvelld.example');
    // Yesterday 00:00 to the day after tomorrow 00:00, in Johannesburg.
    expect(adaRead?.url.searchParams.get('startDateTime')).toBe('2026-11-16T22:00:00.000Z');
    expect(adaRead?.url.searchParams.get('endDateTime')).toBe('2026-11-19T22:00:00.000Z');
    const ownerRead = asked.find((r) => r.user === 'owner@example.test');
    expect(ownerRead?.url.searchParams.get('startDateTime')).toBe('2026-11-17T00:00:00.000Z');
  });

  it('keeps a window three local days long across a clock change', () => {
    // Europe/London leaves summer time on 25 October 2026.
    const w = windowFor('Europe/London', Date.UTC(2026, 9, 25, 12));
    expect(new Date(w.from).toISOString()).toBe('2026-10-23T23:00:00.000Z');
    expect(new Date(w.to).toISOString()).toBe('2026-10-27T00:00:00.000Z');
    expect([...w.days]).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });
});

describe('what is logged', () => {
  it('logs an accepted meeting as the person’s confirmed meeting time', async () => {
    const meeting = graphEvent(nineOn(18), { subject: 'Sprint planning', minutes: 45 });
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();

    const result = synced(await sync());
    expect(result).toMatchObject({ people: 3, meetings: 1, created: 1, no_mailbox: 0 });

    const [entry] = entriesOf(ada);
    expect(entry).toMatchObject({
      source: 'calendar',
      sourceRef: meeting.id,
      kind: 'meeting',
      title: 'Sprint planning',
      day: '2026-11-18',
      tz: ZONE,
      startedAt: nineOn(18),
      endedAt: nineOn(18) + 45 * 60_000,
      minutes: 45,
      taskId: null,
      projectId: null,
      note: null,
      description: null,
      folder: null,
      revision: 1,
      deletedAt: null,
    });
    const [first] = revisionsOf(entry!.id);
    // The member's own: §4.49 wants a real person, and it is their time.
    expect(first).toMatchObject({ revision: 1, change: 'created', changedBy: ada });
    expect(t.db.select().from(calendarEvents).all()).toEqual([
      expect.objectContaining({
        userId: ada,
        eventId: meeting.id,
        icalUid: meeting.iCalUId,
        entryId: entry!.id,
        entryRevisionSynced: 1,
        lastSeenAt: NOW,
      }),
    ]);
    expect(sourceRow()).toMatchObject({
      lastAttemptAt: NOW,
      lastSuccessAt: NOW,
      lastErrorCode: null,
    });
    expect(JSON.parse(sourceRow()?.lastResultJson ?? 'null')).toEqual(result);
  });

  it('logs organised Teams meetings and invitations not declined — accepted, tentative, not answered — and leaves out declined, cancelled, free, out-of-office and all-day (LAI-1335)', async () => {
    const at = nineOn(18);
    const hour = 3_600_000;
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(at, {
        subject: 'Organised Teams meeting',
        responseStatus: { response: 'organizer' },
        isOrganizer: true,
        isOnlineMeeting: true,
      }),
      graphEvent(at + hour, {
        subject: 'Organised Teams, no response',
        responseStatus: { response: 'none' },
        isOrganizer: true,
        isOnlineMeeting: true,
      }),
      // Invited and accepted counts online or in person (the owner, 2026-11-18).
      graphEvent(at + 2 * hour, { subject: 'Accepted, in person', isOnlineMeeting: false }),
      // Invited and not declined counts too, as Graph spells the answers
      // (LAI-1335, the owner's choice of 2026-11-18).
      graphEvent(at + 3 * hour, {
        subject: 'Tentative',
        responseStatus: { response: 'tentativelyAccepted' },
        showAs: 'tentative',
      }),
      graphEvent(at + 4 * hour, {
        subject: 'Not answered',
        responseStatus: { response: 'notResponded' },
        showAs: 'tentative',
      }),
      graphEvent(at + 5 * hour, { subject: 'None', responseStatus: { response: 'none' } }),
      graphEvent(at + 6 * hour, { subject: 'Shown tentative', showAs: 'tentative' }),
      graphEvent(at, { subject: 'Declined', responseStatus: { response: 'declined' } }),
      graphEvent(at, { subject: 'Cancelled', isCancelled: true }),
      graphEvent(at, { subject: 'Free', showAs: 'free' }),
      graphEvent(at, {
        subject: 'Free, not answered',
        showAs: 'free',
        responseStatus: { response: 'notResponded' },
      }),
      graphEvent(at, { subject: 'Out of office', showAs: 'oof' }),
      graphEvent(Date.UTC(2026, 10, 18), { subject: 'All day', isAllDay: true, minutes: 1440 }),
      graphEvent(Date.UTC(2026, 10, 18), {
        subject: 'All day, not answered',
        isAllDay: true,
        minutes: 1440,
        responseStatus: { response: 'notResponded' },
      }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ meetings: 7, created: 7, not_a_meeting: 0 });
    expect(entriesOf(ada).map((e) => e.title)).toEqual([
      'Organised Teams meeting',
      'Organised Teams, no response',
      'Accepted, in person',
      'Tentative',
      'Not answered',
      'None',
      'Shown tentative',
    ]);
  });

  it('retires a meeting once it is declined, as before', async () => {
    const invite = graphEvent(nineOn(18), {
      subject: 'Invite',
      responseStatus: { response: 'notResponded' },
      showAs: 'tentative',
    });
    fake.calendars.set('ada@kvelld.example', [invite]);
    connect();
    expect(synced(await sync())).toMatchObject({ created: 1 });
    fake.calendars.set('ada@kvelld.example', [
      { ...invite, responseStatus: { response: 'declined' }, showAs: 'free' },
    ]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ removed: 1, meetings: 0 });
    expect(entriesOf(ada)).toEqual([expect.objectContaining({ deletedAt: NOW + 1 })]);
  });

  it('leaves off what the person organised that is not a Teams meeting, and counts it (D-157 item 3)', async () => {
    const at = nineOn(18);
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(at, {
        subject: 'Lunch',
        responseStatus: { response: 'organizer' },
        isOrganizer: true,
        isOnlineMeeting: false,
      }),
      // Graph's `none` for something organised, not online: the same.
      graphEvent(at + 3_600_000, {
        subject: 'Focus time',
        responseStatus: { response: 'none' },
        isOrganizer: true,
        isOnlineMeeting: false,
      }),
      graphEvent(at + 7_200_000, {
        subject: 'Doctor',
        responseStatus: { response: 'organizer' },
        isOrganizer: false,
        isOnlineMeeting: false,
      }),
      graphEvent(at + 10_800_000, {
        subject: 'Team sync',
        responseStatus: { response: 'organizer' },
        isOrganizer: true,
        isOnlineMeeting: true,
      }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ meetings: 1, created: 1, not_a_meeting: 3 });
    expect(entriesOf(ada).map((e) => e.title)).toEqual(['Team sync']);
  });

  it('retires one logged before it was known not to be a Teams meeting', async () => {
    const lunch = graphEvent(nineOn(18), {
      subject: 'Lunch',
      responseStatus: { response: 'organizer' },
      isOrganizer: true,
      isOnlineMeeting: true,
    });
    fake.calendars.set('ada@kvelld.example', [lunch]);
    connect();
    synced(await sync());
    // Teams taken off it: no longer a meeting Laika logs.
    fake.calendars.set('ada@kvelld.example', [{ ...lunch, isOnlineMeeting: false }]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ removed: 1, not_a_meeting: 1 });
    expect(entriesOf(ada)).toEqual([expect.objectContaining({ deletedAt: NOW + 1 })]);
  });

  it('logs a private or confidential meeting as Busy, and keeps no link, body or attendee', async () => {
    const secret = graphEvent(nineOn(18), {
      subject: 'Interview: Jo Bloggs',
      sensitivity: 'private',
      // Never asked for; the fake answers them anyway, as a careless Graph might.
      body: { content: 'BODY-NEVER-STORED' },
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/JOIN-NEVER-STORED' },
      attendees: [{ emailAddress: { address: 'ATTENDEE-NEVER-STORED@example.com' } }],
    });
    const confidential = graphEvent(nineOn(18) + 7_200_000, {
      subject: 'Board',
      sensitivity: 'confidential',
    });
    // Personal is private too (review F3): its subject and its place are its own.
    const personal = graphEvent(nineOn(18) + 10_800_000, {
      subject: 'Doctor (Interview room)',
      sensitivity: 'personal',
      location: { displayName: 'Laika Dev' },
    });
    fake.calendars.set('ada@kvelld.example', [secret, confidential, personal]);
    join(ada, s.projectId);
    connect({
      rules: [
        { kind: 'title', text: 'interview', project_id: s.projectId },
        // A channel rule never reads a private meeting's location either.
        { kind: 'channel', text: 'laika dev', project_id: s.projectId },
      ],
    });
    synced(await sync());

    const rows = entriesOf(ada);
    expect(rows.map((e) => [e.title, e.projectId])).toEqual([
      ['Busy', null],
      ['Busy', null],
      ['Busy', null],
    ]);
    const stored = JSON.stringify([
      t.db.select().from(timeEntries).all(),
      t.db.select().from(timeEntryRevisions).all(),
      t.db.select().from(calendarEvents).all(),
      t.db.select().from(orgCalendarSource).all(),
    ]);
    for (const never of [
      'Interview',
      'Board',
      'Doctor',
      'NEVER-STORED',
      'Room 4',
      'Laika Dev',
      'teams.microsoft.com',
    ]) {
      expect(stored).not.toContain(never);
    }
  });

  it('sends a meeting to the space of the first rule that matches, by subject or channel', async () => {
    const other = newId();
    t.db
      .insert(projects)
      .values({
        id: other,
        orgId: s.orgId,
        slug: 'ksage',
        name: 'Ksage',
        prefix: 'KSG',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    const at = nineOn(18);
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(at, { subject: 'Ksage weekly sync' }),
      graphEvent(at + 3_600_000, { subject: 'Daily', location: { displayName: 'Laika Dev' } }),
      graphEvent(at + 7_200_000, {
        subject: 'Ksage in Laika Dev',
        location: { displayName: 'laika dev' },
      }),
      graphEvent(at + 10_800_000, { subject: 'Lunch' }),
    ]);
    join(ada, other);
    join(ada, s.projectId);
    connect({
      rules: [
        { kind: 'title', text: 'KSAGE', project_id: other },
        { kind: 'channel', text: 'Laika Dev', project_id: s.projectId },
      ],
    });
    synced(await sync());
    expect(entriesOf(ada).map((e) => [e.title, e.projectId])).toEqual([
      ['Ksage weekly sync', other],
      ['Daily', s.projectId],
      ['Ksage in Laika Dev', other],
      ['Lunch', null],
    ]);
  });

  it('logs no space when the person cannot open the rule’s space (review F4)', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18), { subject: 'Sprint' })]);
    fake.calendars.set('bea@kvelld.example', [graphEvent(nineOn(18), { subject: 'Sprint' })]);
    // Ada is in the private space; Bea is not, and is a member, not an admin.
    join(ada, s.projectId);
    connect({ rules: [{ kind: 'title', text: 'sprint', project_id: s.projectId }] });
    synced(await sync());
    expect(entriesOf(ada).map((e) => e.projectId)).toEqual([s.projectId]);
    expect(entriesOf(bea).map((e) => e.projectId)).toEqual([null]);
  });

  it('logs no space for a rule whose space is gone', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18), { subject: 'Ksage' })]);
    connect({ rules: [{ kind: 'title', text: 'ksage', project_id: 'gone-project' }] });
    synced(await sync());
    expect(entriesOf(ada).map((e) => e.projectId)).toEqual([null]);
  });

  it('logs a meeting on the person’s own day, and ends one that runs past midnight there', async () => {
    // 23:00–01:00 in Johannesburg, the night of the 17th.
    const late = graphEvent(Date.UTC(2026, 10, 17, 21), { minutes: 120 });
    fake.calendars.set('ada@kvelld.example', [late]);
    connect();
    synced(await sync());
    expect(entriesOf(ada)).toEqual([
      expect.objectContaining({
        day: '2026-11-17',
        startedAt: Date.UTC(2026, 10, 17, 21),
        endedAt: Date.UTC(2026, 10, 17, 22),
        minutes: 60,
      }),
    ]);
  });

  it('logs yesterday to tomorrow and nothing that only overlaps the window', async () => {
    fake.calendars.set('ada@kvelld.example', [
      // Began on the 16th in Johannesburg, ends inside the window.
      graphEvent(Date.UTC(2026, 10, 16, 21), { subject: 'Before', minutes: 120 }),
      graphEvent(nineOn(17), { subject: 'Yesterday' }),
      graphEvent(nineOn(19), { subject: 'Tomorrow' }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ meetings: 2, created: 2 });
    expect(entriesOf(ada).map((e) => [e.title, e.day])).toEqual([
      ['Yesterday', '2026-11-17'],
      ['Tomorrow', '2026-11-19'],
    ]);
  });
});

describe('classify, value by value (D-157 item 3, amended by LAI-1335)', () => {
  /** An invitation, shown busy, in person — as Graph's answer reads once lowercased. */
  const invited: GraphEvent = {
    id: 'e1',
    icalUid: null,
    subject: 'Sprint planning',
    start: nineOn(18),
    end: nineOn(18) + 3_600_000,
    isAllDay: false,
    isCancelled: false,
    showAs: 'busy',
    sensitivity: 'normal',
    response: 'accepted',
    isOrganizer: false,
    isOnlineMeeting: false,
    location: null,
  };
  const organised: GraphEvent = { ...invited, response: 'organizer', isOrganizer: true };

  it('logs an invitation whatever its answer but declined — and an answer Graph adds later is not logged', () => {
    const by = (response: string) => classify({ ...invited, response });
    expect(
      Object.fromEntries(
        ['accepted', 'tentativelyaccepted', 'notresponded', 'none', 'declined', 'maybe'].map(
          (r) => [r, by(r)],
        ),
      ),
    ).toEqual({
      accepted: 'meeting',
      tentativelyaccepted: 'meeting',
      notresponded: 'meeting',
      none: 'meeting',
      declined: 'skip',
      maybe: 'skip',
    });
  });

  it('logs one shown busy, tentative, working elsewhere or unknown, and skips free and out of office', () => {
    for (const response of ['accepted', 'notresponded']) {
      const by = (showAs: string) => classify({ ...invited, response, showAs });
      expect(
        Object.fromEntries(
          ['busy', 'tentative', 'workingelsewhere', 'unknown', 'free', 'oof'].map((v) => [
            v,
            by(v),
          ]),
        ),
        response,
      ).toEqual({
        busy: 'meeting',
        tentative: 'meeting',
        workingelsewhere: 'meeting',
        unknown: 'meeting',
        free: 'skip',
        oof: 'skip',
      });
    }
  });

  it('skips a cancelled or all-day one, whatever its answer', () => {
    for (const response of ['accepted', 'tentativelyaccepted', 'notresponded', 'none']) {
      expect(classify({ ...invited, response, isCancelled: true }), response).toBe('skip');
      expect(classify({ ...invited, response, isAllDay: true }), response).toBe('skip');
    }
  });

  it('counts what the person organised only as a Teams meeting, as before', () => {
    expect(classify({ ...organised, isOnlineMeeting: true })).toBe('meeting');
    expect(classify({ ...organised, isOnlineMeeting: true, showAs: 'tentative' })).toBe('meeting');
    expect(classify(organised)).toBe('not_a_meeting');
    // Graph's `none` on their own event, and `organizer` without the flag: the same.
    expect(classify({ ...organised, response: 'none' })).toBe('not_a_meeting');
    expect(classify({ ...invited, response: 'organizer' })).toBe('not_a_meeting');
    expect(classify({ ...organised, isOnlineMeeting: true, showAs: 'free' })).toBe('skip');
    expect(classify({ ...organised, isOnlineMeeting: true, showAs: 'oof' })).toBe('skip');
    expect(classify({ ...organised, isOnlineMeeting: true, isCancelled: true })).toBe('skip');
  });
});

describe('out of office (D-157 amended, LAI-1331)', () => {
  /** Monday 16 to the end of Friday 20 November, all day: begun two days before the window. */
  const week = (extra: Record<string, unknown> = {}) =>
    graphEvent(Date.UTC(2026, 10, 16), {
      subject: 'Leave',
      isAllDay: true,
      minutes: 5 * 1440,
      showAs: 'oof',
      responseStatus: { response: 'organizer' },
      isOrganizer: true,
      ...extra,
    });

  it('keeps out-of-office spans as away — all day, timed, or begun days ago — and never as time', async () => {
    const leave = week();
    const afternoon = graphEvent(Date.UTC(2026, 10, 18, 12), {
      subject: 'Dentist',
      minutes: 180,
      showAs: 'oof',
      responseStatus: { response: 'organizer' },
      isOrganizer: true,
    });
    const offsite = graphEvent(Date.UTC(2026, 10, 19, 6), {
      subject: 'Team offsite',
      minutes: 480,
      showAs: 'oof',
    });
    fake.calendars.set('ada@kvelld.example', [
      leave,
      afternoon,
      // An invitation accepted that shows them out of office counts too.
      offsite,
      // Declined, unanswered or cancelled: not theirs to be away for.
      graphEvent(Date.UTC(2026, 10, 18, 7), {
        showAs: 'oof',
        responseStatus: { response: 'declined' },
      }),
      graphEvent(Date.UTC(2026, 10, 18, 7), {
        showAs: 'oof',
        responseStatus: { response: 'none' },
      }),
      graphEvent(Date.UTC(2026, 10, 18, 7), {
        showAs: 'oof',
        isCancelled: true,
        isOrganizer: true,
      }),
      // A meeting beside it is logged as before.
      graphEvent(nineOn(18), { subject: 'Standup' }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ away: 3, meetings: 1, created: 1 });

    expect(
      awayOf(ada).map((a) => [
        a.eventId,
        a.startsAt,
        a.endsAt,
        a.allDay,
        a.lastSeenAt,
        a.retiredAt,
      ]),
    ).toEqual([
      [leave.id, Date.UTC(2026, 10, 16), Date.UTC(2026, 10, 21), 1, NOW, null],
      [afternoon.id, Date.UTC(2026, 10, 18, 12), Date.UTC(2026, 10, 18, 15), 0, NOW, null],
      [offsite.id, Date.UTC(2026, 10, 19, 6), Date.UTC(2026, 10, 19, 14), 0, NOW, null],
    ]);
    // Never time: the one entry is the meeting.
    expect(entriesOf(ada).map((e) => e.title)).toEqual(['Standup']);
    // Each person's own: Bea's calendar has none.
    expect(awayOf(bea)).toEqual([]);
    // Nothing of the event but its id and span is kept.
    expect(Object.keys(awayOf(ada)[0]!).sort()).toEqual(
      [
        'allDay',
        'createdAt',
        'endsAt',
        'eventId',
        'lastSeenAt',
        'retiredAt',
        'startsAt',
        'userId',
      ].sort(),
    );
  });

  it('retires a span gone from a complete read, brings it back when it returns, and follows it when it moves', async () => {
    const leave = week();
    fake.calendars.set('ada@kvelld.example', [leave]);
    connect();
    synced(await sync());

    fake.calendars.set('ada@kvelld.example', []);
    expect(synced(await sync(NOW + 1))).toMatchObject({ away: 0 });
    expect(awayOf(ada)).toEqual([
      expect.objectContaining({ eventId: leave.id, retiredAt: NOW + 1 }),
    ]);

    // Back: the same row, standing again.
    fake.calendars.set('ada@kvelld.example', [leave]);
    expect(synced(await sync(NOW + 2))).toMatchObject({ away: 1 });
    expect(awayOf(ada)).toEqual([
      expect.objectContaining({ eventId: leave.id, retiredAt: null, lastSeenAt: NOW + 2 }),
    ]);

    // Shortened to end on Thursday: as Outlook has it now.
    fake.calendars.set('ada@kvelld.example', [week({ id: leave.id, minutes: 4 * 1440 })]);
    synced(await sync(NOW + 3));
    expect(awayOf(ada)).toEqual([
      expect.objectContaining({
        eventId: leave.id,
        endsAt: Date.UTC(2026, 10, 20),
        retiredAt: null,
      }),
    ]);
    expect(entriesOf(ada)).toEqual([]);
  });

  it('retires none that a read could not have seen: a span outside its window stays', async () => {
    // Read on the 10th: two days away on the 11th and 12th.
    const earlier = graphEvent(Date.UTC(2026, 10, 11), {
      isAllDay: true,
      minutes: 2 * 1440,
      showAs: 'oof',
      isOrganizer: true,
      responseStatus: { response: 'organizer' },
    });
    fake.calendars.set('ada@kvelld.example', [earlier]);
    connect();
    synced(await sync(Date.UTC(2026, 10, 10, 12)));
    expect(awayOf(ada)).toHaveLength(1);

    // On the 18th it is long past and out of the window: absent, and left standing.
    synced(await sync());
    expect(awayOf(ada)).toEqual([
      expect.objectContaining({ eventId: earlier.id, retiredAt: null }),
    ]);
  });

  it('keeps nothing for a person whose mailbox was skipped, and each span under its own person', async () => {
    fake.calendars.set('ada@kvelld.example', [week()]);
    fake.calendars.delete('bea@kvelld.example');
    connect();
    synced(await sync());
    expect(awayOf(ada)).toHaveLength(1);
    expect(awayOf(bea)).toEqual([]);
  });
});

describe('meetings that change', () => {
  it('updates a changed meeting, as the next revision by the person, and leaves an unchanged one', async () => {
    const meeting = graphEvent(nineOn(18), { subject: 'Planning' });
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    expect(synced(await sync(NOW + 900_000))).toMatchObject({ unchanged: 1, updated: 0 });
    const [entry] = entriesOf(ada);
    expect(entry?.revision).toBe(1);

    fake.calendars.set('ada@kvelld.example', [
      { ...meeting, subject: 'Planning (moved)', ...{ start: graphTime(nineOn(18) + 1_800_000) } },
    ]);
    expect(synced(await sync(NOW + 1_800_000))).toMatchObject({ updated: 1 });
    expect(entriesOf(ada)).toEqual([
      expect.objectContaining({
        id: entry!.id,
        title: 'Planning (moved)',
        startedAt: nineOn(18) + 1_800_000,
        minutes: 30,
        revision: 2,
      }),
    ]);
    expect(revisionsOf(entry!.id).at(-1)).toMatchObject({
      revision: 2,
      change: 'edited',
      changedBy: ada,
    });
    expect(t.db.select().from(calendarEvents).get()?.entryRevisionSynced).toBe(2);
  });

  it('retires a meeting cancelled or declined since, and brings it back when it returns', async () => {
    const meeting = graphEvent(nineOn(18));
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    const [entry] = entriesOf(ada);

    fake.calendars.set('ada@kvelld.example', [{ ...meeting, isCancelled: true }]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ removed: 1 });
    expect(entriesOf(ada)[0]).toMatchObject({ deletedAt: NOW + 1, revision: 2 });
    expect(revisionsOf(entry!.id).at(-1)).toMatchObject({ change: 'deleted', changedBy: ada });

    // Accepted again: the same entry, live — never a second one, which the
    // `time_entries_no_replace` trigger would refuse.
    fake.calendars.set('ada@kvelld.example', [meeting]);
    expect(synced(await sync(NOW + 2))).toMatchObject({ updated: 1 });
    expect(entriesOf(ada)).toEqual([
      expect.objectContaining({ id: entry!.id, deletedAt: null, revision: 3 }),
    ]);
  });

  it('retires a meeting gone from a complete read, and none outside the window', async () => {
    // Tomorrow: still inside the window two days on.
    const gone = graphEvent(nineOn(19), { subject: 'Gone' });
    const kept = graphEvent(nineOn(17), { subject: 'Yesterday' });
    fake.calendars.set('ada@kvelld.example', [gone, kept]);
    connect();
    synced(await sync());

    // Two days on, yesterday's meeting is out of the window: absent, and left.
    fake.calendars.set('ada@kvelld.example', []);
    const later = NOW + 2 * 86_400_000;
    expect(synced(await sync(later))).toMatchObject({ removed: 1 });
    expect(entriesOf(ada).map((e) => [e.title, e.deletedAt])).toEqual([
      ['Yesterday', null],
      ['Gone', later],
    ]);
  });
});

describe('a person’s edit wins', () => {
  it('never touches an entry the person changed, whatever the meeting does', async () => {
    const meeting = graphEvent(nineOn(18), { subject: 'Planning' });
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    const [entry] = entriesOf(ada);
    t.db.transaction((tx) => {
      patchEntry(tx, ada, entry!.id, { title: 'My words', minutes: 30 }, undefined, ada, NOW);
    });

    fake.calendars.set('ada@kvelld.example', [{ ...meeting, subject: 'Planning v2' }]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ kept_edits: 1, updated: 0 });
    fake.calendars.set('ada@kvelld.example', [{ ...meeting, isCancelled: true }]);
    expect(synced(await sync(NOW + 2))).toMatchObject({ removed: 0 });
    fake.calendars.set('ada@kvelld.example', []);
    expect(synced(await sync(NOW + 3))).toMatchObject({ removed: 0 });

    expect(entriesOf(ada)).toEqual([
      expect.objectContaining({ title: 'My words', minutes: 30, revision: 2, deletedAt: null }),
    ]);
  });

  it('never brings back an entry the person deleted', async () => {
    const meeting = graphEvent(nineOn(18));
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    const [entry] = entriesOf(ada);
    t.db.transaction((tx) => {
      retireEntry(tx, entry!.id, ada, NOW);
    });
    expect(synced(await sync(NOW + 1))).toMatchObject({ kept_edits: 1, created: 0, updated: 0 });
    expect(entriesOf(ada)).toEqual([expect.objectContaining({ deletedAt: NOW, revision: 2 })]);
  });
});

describe('what it cannot log', () => {
  it('skips a meeting on a day already full, and logs the rest', async () => {
    t.db
      .insert(timeEntries)
      .values({
        id: newId(),
        userId: ada,
        day: '2026-11-18',
        tz: ZONE,
        minutes: 1420,
        source: 'manual',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineOn(18), { subject: 'Too much' }),
      graphEvent(nineOn(19), { subject: 'Tomorrow' }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ meetings: 2, created: 1, skipped: 1 });
    expect(
      entriesOf(ada)
        .filter((e) => e.source === 'calendar')
        .map((e) => e.title),
    ).toEqual(['Tomorrow']);
  });

  it('skips the closed period', async () => {
    timeOn('manual', '2026-11-17');
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineOn(17), { subject: 'Closed' }),
      graphEvent(nineOn(18), { subject: 'Open' }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ created: 1, skipped: 1 });
    expect(entriesOf(ada).map((e) => e.title)).toEqual(['Open']);
  });

  it('counts somebody Microsoft has no calendar for, and syncs everyone else', async () => {
    fake.calendars.delete('bea@kvelld.example');
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    connect();
    expect(synced(await sync())).toMatchObject({ people: 3, no_mailbox: 1, created: 1 });
    expect(entriesOf(bea)).toEqual([]);
  });

  it('skips one person whose mailbox answers 403 or 400, syncs the rest, and retires nothing of theirs (review F1)', async () => {
    const beaMeeting = graphEvent(nineOn(18), { subject: 'Bea’s' });
    fake.calendars.set('bea@kvelld.example', [beaMeeting]);
    connect();
    synced(await sync());
    expect(entriesOf(bea)).toHaveLength(1);

    // An access policy now keeps Bea's mailbox from the app; the owner's is
    // not looked up; Ada's meeting is new.
    fake.denied.add('bea@kvelld.example');
    fake.refused.add('owner@example.test');
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18), { subject: 'Ada’s' })]);
    const result = synced(await sync(NOW + 900_000));
    expect(result).toMatchObject({
      people: 3,
      mailbox_denied: 1,
      mailbox_refused: 1,
      no_mailbox: 0,
      created: 1,
      removed: 0,
    });
    expect(entriesOf(ada).map((e) => e.title)).toEqual(['Ada’s']);
    // Not read is not gone: Bea's entry stands.
    expect(entriesOf(bea)).toEqual([expect.objectContaining({ title: 'Bea’s', deletedAt: null })]);
    expect(sourceRow()).toMatchObject({ lastErrorCode: null, lastSuccessAt: NOW + 900_000 });
  });

  it('holds back a retirement and an update in the closed period (review F8)', async () => {
    const retiring = graphEvent(nineOn(17), { subject: 'Cancelled later' });
    const moving = graphEvent(nineOn(17) + 7_200_000, { subject: 'Moved later' });
    fake.calendars.set('ada@kvelld.example', [retiring, moving]);
    connect();
    synced(await sync());
    timeOn('manual', '2026-11-17');

    fake.calendars.set('ada@kvelld.example', [
      { ...retiring, isCancelled: true },
      { ...moving, subject: 'Moved later (renamed)' },
    ]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ removed: 0, updated: 0, skipped: 2 });
    fake.calendars.set('ada@kvelld.example', [{ ...moving, subject: 'Moved later (renamed)' }]);
    expect(synced(await sync(NOW + 2))).toMatchObject({ removed: 0, updated: 0, skipped: 2 });
    expect(entriesOf(ada).map((e) => [e.title, e.deletedAt, e.revision])).toEqual([
      ['Cancelled later', null, 1],
      ['Moved later', null, 1],
    ]);
  });

  it('gives each occurrence of a recurring meeting its own entry (review F8)', async () => {
    const series = 'series-standup';
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineOn(17), { id: 'occ-17', iCalUId: series, subject: 'Standup', minutes: 15 }),
      graphEvent(nineOn(18), { id: 'occ-18', iCalUId: series, subject: 'Standup', minutes: 15 }),
      graphEvent(nineOn(19), { id: 'occ-19', iCalUId: series, subject: 'Standup', minutes: 15 }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ meetings: 3, created: 3 });
    expect(entriesOf(ada).map((e) => [e.sourceRef, e.day])).toEqual([
      ['occ-17', '2026-11-17'],
      ['occ-18', '2026-11-18'],
      ['occ-19', '2026-11-19'],
    ]);
    expect(
      t.db
        .select()
        .from(calendarEvents)
        .all()
        .map((l) => l.icalUid),
    ).toEqual([series, series, series]);
  });

  it('leaves a retired meeting retired when it comes back to a day now full (review F8)', async () => {
    const meeting = graphEvent(nineOn(18), { subject: 'Back again' });
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    fake.calendars.set('ada@kvelld.example', [{ ...meeting, isCancelled: true }]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ removed: 1 });
    // The person fills the day meanwhile.
    t.db
      .insert(timeEntries)
      .values({
        id: newId(),
        userId: ada,
        day: '2026-11-18',
        tz: ZONE,
        minutes: 1420,
        source: 'manual',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    fake.calendars.set('ada@kvelld.example', [meeting]);
    expect(synced(await sync(NOW + 2))).toMatchObject({ updated: 0, skipped: 1 });
    expect(
      entriesOf(ada)
        .filter((e) => e.source === 'calendar')
        .map((e) => [e.deletedAt, e.revision]),
    ).toEqual([[NOW + 1, 2]]);
  });
});

describe('an entry whose link was lost (review F6)', () => {
  function dropLinks(): void {
    t.db.delete(calendarEvents).run();
  }

  it('is linked again when the sync wrote it and nobody changed it, and kept in step', async () => {
    const meeting = graphEvent(nineOn(18), { subject: 'Planning' });
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    dropLinks();
    fake.calendars.set('ada@kvelld.example', [{ ...meeting, subject: 'Planning (moved)' }]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ updated: 1, created: 0 });
    expect(entriesOf(ada)).toEqual([
      expect.objectContaining({ title: 'Planning (moved)', revision: 2 }),
    ]);
    expect(t.db.select().from(calendarEvents).all()).toEqual([
      expect.objectContaining({ eventId: meeting.id, entryRevisionSynced: 2 }),
    ]);
  });

  it('is left alone, unlinked, when the person changed it', async () => {
    const meeting = graphEvent(nineOn(18), { subject: 'Planning' });
    fake.calendars.set('ada@kvelld.example', [meeting]);
    connect();
    synced(await sync());
    const [entry] = entriesOf(ada);
    t.db.transaction((tx) => {
      patchEntry(tx, ada, entry!.id, { title: 'Mine now' }, undefined, ada, NOW);
    });
    dropLinks();
    fake.calendars.set('ada@kvelld.example', [{ ...meeting, subject: 'Planning (moved)' }]);
    expect(synced(await sync(NOW + 1))).toMatchObject({ kept_edits: 1, updated: 0, created: 0 });
    expect(entriesOf(ada)).toEqual([expect.objectContaining({ title: 'Mine now', revision: 2 })]);
    expect(t.db.select().from(calendarEvents).all()).toEqual([]);
  });
});

describe('when Microsoft fails', () => {
  it('records why on the connection, in Laika’s words, and changes nothing', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    connect();
    for (const [setup, code] of [
      [() => (fake.roles = []), 'not_granted'],
      [
        () =>
          t.db
            .update(orgCalendarSource)
            .set({ secretEnc: encryptSecret('wrong', SECRET, 'calendar_client_secret') })
            .run(),
        'credentials_rejected',
      ],
    ] as const) {
      setup();
      expect(await sync()).toEqual({ kind: 'failed', code });
      expect(sourceRow()).toMatchObject({ lastErrorCode: code, lastSuccessAt: null });
      expect(sourceRow()?.lastError).not.toMatch(/MS-SECRET-WORDS|AADSTS/);
    }
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
  });

  it('writes nothing when one person’s read fails after another’s succeeded', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    fake.calendars.set('bea@kvelld.example', [graphEvent(nineOn(18))]);
    fake.intercept = (req) =>
      req.kind === 'calendarView' && req.user === 'bea@kvelld.example'
        ? new Response('{}', { status: 500 })
        : undefined;
    connect();
    expect(await sync()).toEqual({ kind: 'failed', code: 'unreachable' });
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
    expect(t.db.select().from(calendarEvents).all()).toEqual([]);
  });

  it('fails on a token without Calendars.Read before reading anyone, and asks for a new one next time', async () => {
    fake.roles = ['User.Read.All'];
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    connect();
    expect(await sync()).toEqual({ kind: 'failed', code: 'not_granted' });
    expect(fake.of('calendarView')).toEqual([]);
    // Granted since: the next run does not reuse the token minted before it.
    fake.roles = ['Calendars.Read'];
    expect(synced(await sync(NOW + 1))).toMatchObject({ created: 1 });
    expect(fake.of('token')).toHaveLength(2);
  });

  it('fails the run when Graph refuses the token itself', async () => {
    fake.intercept = (req) =>
      req.kind === 'calendarView' ? new Response('{}', { status: 401 }) : undefined;
    connect();
    expect(await sync()).toEqual({ kind: 'failed', code: 'credentials_rejected' });
  });

  it('records an unreadable stored secret as the credentials’ failure', async () => {
    connect();
    expect(
      await runCalendarSync(t.db, 'another-secret-that-is-long-enough-too', {
        fetchImpl: fake.fetchImpl,
        now: () => NOW,
      }),
    ).toEqual({ kind: 'failed', code: 'credentials_rejected' });
    expect(fake.requests).toHaveLength(0);
    expect(sourceRow()?.lastError).toMatch(/LAIKA_SECRET/);
  });
});

describe('one run at a time', () => {
  it('joins a run already going rather than starting a second', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    connect();
    const release = fake.hold();
    const first = sync();
    const second = sync();
    expect(calendarSyncInFlight(t.db)).toBeDefined();
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
    expect(synced(a)).toMatchObject({ created: 1 });
    expect(fake.of('calendarView')).toHaveLength(3);
    expect(calendarSyncInFlight(t.db)).toBeUndefined();
  });

  it('writes nothing when the switch went off while it was reading', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(18))]);
    connect();
    const release = fake.hold();
    const run = sync();
    await new Promise((done) => setTimeout(done, 0));
    t.db.update(orgCalendarSource).set({ enabled: 0 }).run();
    release();
    expect(await run).toEqual({ kind: 'skipped' });
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
  });

  it('asks Microsoft for one token across runs', async () => {
    connect();
    synced(await sync());
    synced(await sync(NOW + 900_000));
    expect(fake.of('token')).toHaveLength(1);
    expect(
      t.db
        .select()
        .from(calendarEvents)
        .where(and(eq(calendarEvents.userId, ada)))
        .all(),
    ).toEqual([]);
  });
});

describe('a backfill (LAI-1335)', () => {
  /** 09:00 in Johannesburg on a day of October 2026. */
  const nineInOctober = (day: number): number => Date.UTC(2026, 9, day, 7);
  const EMAILS = ['ada@kvelld.example', 'bea@kvelld.example', 'owner@example.test'];
  const starts = (): string[] =>
    fake.of('calendarView').map((r) => r.url.searchParams.get('startDateTime') ?? '');

  it('reads each member from the start of the day N before today to the end of tomorrow, in their zone, and logs what began in it', async () => {
    const leave = graphEvent(Date.UTC(2026, 9, 26), {
      subject: 'Leave',
      isAllDay: true,
      minutes: 2 * 1440,
      showAs: 'oof',
      isOrganizer: true,
      responseStatus: { response: 'organizer' },
    });
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineInOctober(18), { subject: 'Before the window' }),
      graphEvent(nineInOctober(19), {
        subject: 'First day',
        responseStatus: { response: 'notResponded' },
        showAs: 'tentative',
      }),
      graphEvent(nineOn(2), { subject: 'Two weeks ago' }),
      graphEvent(nineOn(19), { subject: 'Tomorrow' }),
      leave,
    ]);
    connect();
    const result = synced(await backfill(30));
    expect(result).toMatchObject({ people: 3, meetings: 3, created: 3, away: 1 });

    const asked = fake.of('calendarView');
    const adaRead = asked.find((r) => r.user === 'ada@kvelld.example');
    // 19 October 00:00 to 20 November 00:00, in Johannesburg.
    expect(adaRead?.url.searchParams.get('startDateTime')).toBe('2026-10-18T22:00:00.000Z');
    expect(adaRead?.url.searchParams.get('endDateTime')).toBe('2026-11-19T22:00:00.000Z');
    const ownerRead = asked.find((r) => r.user === 'owner@example.test');
    expect(ownerRead?.url.searchParams.get('startDateTime')).toBe('2026-10-19T00:00:00.000Z');

    expect(entriesOf(ada).map((e) => [e.title, e.day])).toEqual([
      ['First day', '2026-10-19'],
      ['Two weeks ago', '2026-11-02'],
      ['Tomorrow', '2026-11-19'],
    ]);
    expect(awayOf(ada).map((a) => a.eventId)).toEqual([leave.id]);
    // The connection's last sync, as any run's.
    expect(JSON.parse(sourceRow()?.lastResultJson ?? 'null')).toEqual(result);
    expect(sourceRow()).toMatchObject({ lastSuccessAt: NOW, lastErrorCode: null });
  });

  it('keeps its window whole local days across a clock change, and the regular one as it was', () => {
    const at = Date.UTC(2026, 10, 18, 12);
    // Europe/London left summer time on 25 October 2026.
    const month = windowFor('Europe/London', at, 30);
    expect(new Date(month.from).toISOString()).toBe('2026-10-18T23:00:00.000Z');
    expect(new Date(month.to).toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(month.days.size).toBe(32);
    expect([...month.days].at(0)).toBe('2026-10-19');
    expect([...month.days].at(-1)).toBe('2026-11-19');
    const most = windowFor('Europe/London', at, 90);
    expect(new Date(most.from).toISOString()).toBe('2026-08-19T23:00:00.000Z');
    expect(most.days.size).toBe(92);
    expect(windowFor('Europe/London', at, 1)).toEqual(windowFor('Europe/London', at));
  });

  it('holds back the closed period and a full day, and leaves a person’s edit and delete alone', async () => {
    timeOn('manual', '2026-10-31');
    t.db
      .insert(timeEntries)
      .values({
        id: newId(),
        userId: ada,
        day: '2026-11-03',
        tz: ZONE,
        minutes: 1420,
        source: 'manual',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    const closed = graphEvent(nineInOctober(27), { subject: 'Closed' });
    const full = graphEvent(nineOn(3), { subject: 'Full day' });
    const edited = graphEvent(nineOn(5), { subject: 'Planning' });
    const deleted = graphEvent(nineOn(6), { subject: 'Retro' });
    fake.calendars.set('ada@kvelld.example', [closed, full, edited, deleted]);
    connect();
    expect(synced(await backfill(30))).toMatchObject({ meetings: 4, created: 2, skipped: 2 });
    const [plan, retro] = entriesOf(ada).filter((e) => e.source === 'calendar');
    t.db.transaction((tx) => {
      patchEntry(tx, ada, plan!.id, { title: 'My words' }, undefined, ada, NOW);
      retireEntry(tx, retro!.id, ada, NOW);
    });

    fake.calendars.set('ada@kvelld.example', [
      closed,
      full,
      { ...edited, subject: 'Planning v2' },
      deleted,
    ]);
    expect(synced(await backfill(30, NOW + 1))).toMatchObject({
      created: 0,
      updated: 0,
      removed: 0,
      kept_edits: 2,
      skipped: 2,
    });
    expect(
      entriesOf(ada)
        .filter((e) => e.source === 'calendar')
        .map((e) => [e.title, e.day, e.deletedAt, e.revision]),
    ).toEqual([
      ['My words', '2026-11-05', null, 2],
      ['Retro', '2026-11-06', NOW, 2],
    ]);
  });

  it('adds nothing the second time, and leaves the regular run nothing to do', async () => {
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineInOctober(20)),
      graphEvent(nineOn(2), { responseStatus: { response: 'notResponded' }, showAs: 'tentative' }),
      graphEvent(nineOn(18)),
    ]);
    fake.calendars.set('bea@kvelld.example', [graphEvent(nineOn(10))]);
    connect();
    expect(synced(await backfill(30))).toMatchObject({ created: 4 });
    const entries = t.db.select().from(timeEntries).all();
    const revisions = t.db.select().from(timeEntryRevisions).all();

    expect(synced(await backfill(30, NOW + 1))).toMatchObject({
      meetings: 4,
      created: 0,
      updated: 0,
      removed: 0,
      unchanged: 4,
    });
    expect(t.db.select().from(timeEntries).all()).toEqual(entries);
    expect(t.db.select().from(timeEntryRevisions).all()).toEqual(revisions);
    expect(synced(await sync(NOW + 2))).toMatchObject({ created: 0, removed: 0, unchanged: 1 });
  });

  it('retires only inside the window it read completely', async () => {
    const away = graphEvent(Date.UTC(2026, 9, 26), {
      isAllDay: true,
      minutes: 1440,
      showAs: 'oof',
      isOrganizer: true,
      responseStatus: { response: 'organizer' },
    });
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineInOctober(25), { subject: 'Older' }),
      graphEvent(nineOn(1), { subject: 'Newer' }),
      away,
    ]);
    connect();
    expect(synced(await backfill(30))).toMatchObject({ created: 2, away: 1 });

    fake.calendars.set('ada@kvelld.example', []);
    // Ten days back is 8 November: neither is in it, so neither is gone.
    expect(synced(await backfill(10, NOW + 1))).toMatchObject({ removed: 0 });
    expect(synced(await sync(NOW + 2))).toMatchObject({ removed: 0 });
    expect(awayOf(ada)).toEqual([expect.objectContaining({ retiredAt: null })]);
    // Twenty days back is 29 October: 1 November's goes, 25 October's stays.
    expect(synced(await backfill(20, NOW + 3))).toMatchObject({ removed: 1 });
    expect(entriesOf(ada).map((e) => [e.title, e.deletedAt])).toEqual([
      ['Older', null],
      ['Newer', NOW + 3],
    ]);
    expect(awayOf(ada)).toEqual([expect.objectContaining({ retiredAt: null })]);
    // Thirty days back reads 26 October whole: the span goes too.
    expect(synced(await backfill(30, NOW + 4))).toMatchObject({ removed: 1 });
    expect(awayOf(ada)).toEqual([expect.objectContaining({ retiredAt: NOW + 4 })]);
  });

  it('waits for a regular run already going, then reads its own window — never beside it', async () => {
    fake.calendars.set('ada@kvelld.example', [
      graphEvent(nineOn(18), { subject: 'Today' }),
      graphEvent(nineOn(2), { subject: 'Two weeks ago' }),
    ]);
    connect();
    const release = fake.hold();
    const regular = sync();
    const back = backfill(30);
    await new Promise((done) => setTimeout(done, 0));
    // The regular run's first read, held; nothing of the backfill's.
    expect(starts()).toHaveLength(1);
    expect(starts()[0]).toMatch(/^2026-11-1[67]T/);
    release();
    const [r, b] = await Promise.all([regular, back]);
    expect(b).not.toBe(r);
    expect(synced(r)).toMatchObject({ created: 1 });
    expect(synced(b)).toMatchObject({ created: 1, unchanged: 1 });
    // Three regular reads, then the backfill's three.
    expect(starts().map((at) => at.startsWith('2026-10-'))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(calendarSyncInFlight(t.db)).toBeUndefined();
  });

  it('is joined by a regular run asked for while it goes', async () => {
    fake.calendars.set('ada@kvelld.example', [graphEvent(nineOn(2))]);
    connect();
    const release = fake.hold();
    const back = backfill(30);
    const tick = sync();
    expect(tick).toBe(calendarSyncInFlight(t.db));
    release();
    expect(await tick).toBe(await back);
    expect(synced(await back)).toMatchObject({ created: 1 });
    // One run, the backfill's: three reads, each of its window.
    expect(starts().map((at) => at.startsWith('2026-10-'))).toEqual([true, true, true]);
  });

  it('writes one person to a transaction, with the server’s turn between them; the regular run writes all at once', async () => {
    /** Every count of entries seen at a turn of the event loop while `run` goes. */
    const watch = async (run: () => Promise<CalendarSyncOutcome>): Promise<number[]> => {
      const counts = new Set<number>();
      let on = true;
      // Stopped before anything else looks: one still queued must not read
      // a database the test has closed.
      const look = (): void => {
        if (!on) return;
        counts.add(t.db.select().from(timeEntries).all().length);
        setImmediate(look);
      };
      setImmediate(look);
      const outcome = await run();
      on = false;
      synced(outcome);
      return [...counts].sort((a, b) => a - b);
    };
    for (const email of EMAILS) fake.calendars.set(email, [graphEvent(nineOn(2))]);
    connect();
    // The server had its turn with one person written, and with two.
    expect(await watch(() => backfill(30))).toEqual(expect.arrayContaining([1, 2]));
    expect(t.db.select().from(timeEntries).all()).toHaveLength(3);

    // The control: the regular run's one transaction is never seen half done.
    for (const email of EMAILS) fake.calendars.set(email, [graphEvent(nineOn(18))]);
    const regular = await watch(() => sync(NOW + 1));
    expect(regular.filter((n) => n !== 3 && n !== 6)).toEqual([]);
    expect(t.db.select().from(timeEntries).all()).toHaveLength(6);
  });

  it('stops at the switch turned off between two people, keeping who was written, and records no counts', async () => {
    for (const email of EMAILS) fake.calendars.set(email, [graphEvent(nineOn(2))]);
    connect();
    let on = true;
    const look = (): void => {
      if (!on) return;
      if (t.db.select().from(timeEntries).all().length === 1) {
        t.db.update(orgCalendarSource).set({ enabled: 0 }).run();
      }
      setImmediate(look);
    };
    setImmediate(look);
    const outcome = await backfill(30);
    on = false;
    expect(outcome).toEqual({ kind: 'skipped' });
    expect(t.db.select().from(timeEntries).all()).toHaveLength(1);
    expect(sourceRow()).toMatchObject({ lastResultJson: null, lastSuccessAt: null });
  });

  it('writes nothing when one person’s read fails, and records why', async () => {
    for (const email of EMAILS) fake.calendars.set(email, [graphEvent(nineOn(2))]);
    fake.intercept = (req) =>
      req.kind === 'calendarView' && req.user === 'bea@kvelld.example'
        ? new Response('{}', { status: 500 })
        : undefined;
    connect();
    expect(await backfill(30)).toEqual({ kind: 'failed', code: 'unreachable' });
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
    expect(sourceRow()).toMatchObject({ lastErrorCode: 'unreachable', lastSuccessAt: null });
  });
});
