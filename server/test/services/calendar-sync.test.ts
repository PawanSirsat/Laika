import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import {
  calendarEvents,
  orgCalendarSource,
  orgTimeSettings,
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
  runCalendarSync,
  type StoredRule,
  windowFor,
} from '../../src/services/calendar-sync.ts';
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
 * real database: accepted and organised meetings logged as the person's
 * confirmed time, the rest left out, a person's edit never overwritten, and
 * one run at a time.
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

  it('logs what they organised, and leaves out tentative, declined, cancelled, free, out-of-office and all-day', async () => {
    const at = nineOn(18);
    const organised = graphEvent(at, {
      subject: 'Organised',
      responseStatus: { response: 'organizer' },
      isOrganizer: true,
    });
    const organisedNone = graphEvent(at + 3_600_000, {
      subject: 'Organised, no response',
      responseStatus: { response: 'none' },
      isOrganizer: true,
    });
    fake.calendars.set('ada@kvelld.example', [
      organised,
      organisedNone,
      graphEvent(at, { responseStatus: { response: 'tentativelyAccepted' } }),
      graphEvent(at, { responseStatus: { response: 'declined' } }),
      graphEvent(at, { responseStatus: { response: 'notResponded' } }),
      graphEvent(at, { responseStatus: { response: 'none' } }),
      graphEvent(at, { isCancelled: true }),
      graphEvent(at, { showAs: 'free' }),
      graphEvent(at, { showAs: 'tentative' }),
      graphEvent(at, { showAs: 'oof' }),
      graphEvent(Date.UTC(2026, 10, 18), { isAllDay: true, minutes: 1440 }),
    ]);
    connect();
    expect(synced(await sync())).toMatchObject({ meetings: 2, created: 2 });
    expect(entriesOf(ada).map((e) => e.title)).toEqual(['Organised', 'Organised, no response']);
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
    fake.calendars.set('ada@kvelld.example', [secret, confidential]);
    connect({ rules: [{ kind: 'title', text: 'interview', project_id: s.projectId }] });
    synced(await sync());

    const rows = entriesOf(ada);
    expect(rows.map((e) => [e.title, e.projectId])).toEqual([
      ['Busy', null],
      ['Busy', null],
    ]);
    const stored = JSON.stringify([
      t.db.select().from(timeEntries).all(),
      t.db.select().from(timeEntryRevisions).all(),
      t.db.select().from(calendarEvents).all(),
      t.db.select().from(orgCalendarSource).all(),
    ]);
    for (const never of ['Interview', 'Board', 'NEVER-STORED', 'Room 4', 'teams.microsoft.com']) {
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
