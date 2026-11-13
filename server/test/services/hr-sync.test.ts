import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { hrPeople, leaveDays, orgHolidays, orgHrSource, users } from '../../src/db/schema.ts';
import { encryptSecret } from '../../src/secrets.ts';
import {
  type HrSyncOutcome,
  hrSyncInFlight,
  runHrSync,
  syncWindow,
} from '../../src/services/hr-sync.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  CLAN_ACCOUNT,
  CLAN_BASE,
  CLAN_TOKEN,
  employee,
  fakeClan,
  type FakeClan,
  leaveRow,
} from '../helpers/fake-clan.ts';

/**
 * The HR sync (D-149 item 7, LAI-1181), against a fake Clan and a real
 * database: read whole, reconcile once, never a hard delete, people by email
 * unless an owner said otherwise, and one run at a time.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
/** 13 November 2026: the window is 2025-01-01 to 2027-12-31. */
const NOW = Date.UTC(2026, 10, 13, 12);

let t: TestDb;
let s: Seed;
let ada: string;
let bea: string;

function person(name: string, email: string, active = true): string {
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
  return id;
}

/** A connected source holding the fake's token. */
function connect(token = CLAN_TOKEN): void {
  t.db
    .insert(orgHrSource)
    .values({
      orgId: s.orgId,
      provider: 'clan',
      baseUrl: CLAN_BASE,
      accountName: CLAN_ACCOUNT,
      tokenEnc: encryptSecret(token, SECRET, 'clan_api_token'),
      tokenLast4: token.slice(-4),
      tokenExpiresAt: null,
      seesEveryone: 0,
      seesDepartments: 0,
      connectedBy: s.userId,
      connectedAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function sync(fake: FakeClan, now = NOW): Promise<HrSyncOutcome> {
  return runHrSync(t.db, SECRET, {
    fetchImpl: fake.fetchImpl,
    now: () => now,
    sleep: () => Promise.resolve(),
    timeoutMs: 50,
  });
}

/** A sync that must succeed, and its counts. */
async function synced(fake: FakeClan, now = NOW) {
  const outcome = await sync(fake, now);
  if (outcome.kind !== 'synced') throw new Error(`expected a sync, got ${JSON.stringify(outcome)}`);
  return outcome.result;
}

function source() {
  const row = t.db.select().from(orgHrSource).get();
  if (row === undefined) throw new Error('no source');
  return row;
}

function leaveOf(sourceRef: string) {
  return t.db.select().from(leaveDays).where(eq(leaveDays.sourceRef, sourceRef)).get();
}

function holidayOf(sourceRef: string) {
  return t.db.select().from(orgHolidays).where(eq(orgHolidays.sourceRef, sourceRef)).get();
}

/** Ada and Bea are on Laika; Dee has no account; Cid's is deactivated. */
function staff() {
  return [
    employee(1, 'Ada Lovelace', 'ada@example.test'),
    employee(2, 'Bea Bell', 'BEA@Example.test'),
    employee(3, 'Dee Dot', 'dee@nowhere.test'),
    employee(4, 'Cid Cole', 'cid@example.test'),
  ];
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  ada = person('Ada', 'ada@example.test');
  bea = person('Bea', 'bea@example.test');
  person('Cid', 'cid@example.test', false);
});
afterEach(() => {
  t.close();
});

describe('the window', () => {
  it('is 1 January last year to 31 December next year', () => {
    expect(syncWindow(NOW)).toEqual({ from: '2025-01-01', to: '2027-12-31' });
    expect(syncWindow(Date.UTC(2027, 0, 1))).toEqual({ from: '2026-01-01', to: '2028-12-31' });
  });
});

describe('nothing to sync', () => {
  it('reads nothing and writes nothing with no connected source', async () => {
    const fake = fakeClan({ employees: staff() });
    expect(await sync(fake)).toEqual({ kind: 'skipped' });
    expect(fake.requests).toEqual([]);
  });

  it('does not decrypt under an empty secret', async () => {
    connect();
    const fake = fakeClan({ employees: staff() });
    expect(await runHrSync(t.db, '', { fetchImpl: fake.fetchImpl })).toEqual({ kind: 'skipped' });
    expect(fake.requests).toEqual([]);
  });
});

describe('people', () => {
  it('matches by exact lowercased email to an active person, and counts the rest', async () => {
    connect();
    const fake = fakeClan({
      employees: staff(),
      leave: [leaveRow(100, 1, '2026-11-20'), leaveRow(101, 3, '2026-11-20')],
    });
    const result = await synced(fake);

    expect(result).toMatchObject({ people: 4, matched: 2, unmatched: 2 });
    const rows = t.db.select().from(hrPeople).all();
    expect(
      Object.fromEntries(rows.map((r) => [r.externalId, [r.userId, r.matchedBy, r.name]])),
    ).toEqual({
      '1': [ada, 'email', 'Ada Lovelace'],
      '2': [bea, 'email', 'Bea Bell'],
      '3': [null, 'none', 'Dee Dot'],
      // Deactivated on Laika: never matched.
      '4': [null, 'none', 'Cid Cole'],
    });
    expect(rows[0]).toMatchObject({
      departmentRef: '3',
      designationRef: '7',
      employmentType: 'full_time',
      seenAt: NOW,
    });
  });

  it('counts a person with no Laika match, and stores none of their leave', async () => {
    connect();
    const fake = fakeClan({
      employees: staff(),
      leave: [leaveRow(100, 1, '2026-11-20'), leaveRow(101, 3, '2026-11-20')],
    });
    const result = await synced(fake);

    expect(result).toMatchObject({ unmatched: 2, leave_days: 1, created: 1 });
    expect(leaveOf('100')?.userId).toBe(ada);
    // Dee's day was read and is nowhere.
    expect(leaveOf('101')).toBeUndefined();
    expect(t.db.select().from(leaveDays).all()).toHaveLength(1);
  });

  it('keeps no email, either side’s', () => {
    const columns = t.db.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('hr_people')`,
    );
    expect(columns.map((c) => c.name)).not.toContain('email');
    expect(columns.map((c) => c.name)).toContain('external_id');
  });

  it('never lets the email match overwrite an owner’s “not on Laika”', async () => {
    connect();
    const fake = fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] });
    await synced(fake);
    // The owner says Clan's Ada is not Laika's Ada.
    t.db
      .update(hrPeople)
      .set({ userId: null, matchedBy: 'owner' })
      .where(eq(hrPeople.externalId, '1'))
      .run();

    const result = await synced(fake);

    expect(t.db.select().from(hrPeople).where(eq(hrPeople.externalId, '1')).get()).toMatchObject({
      userId: null,
      matchedBy: 'owner',
    });
    expect(result).toMatchObject({ matched: 1, unmatched: 3, leave_days: 0, removed: 1 });
    expect(leaveOf('100')?.removedAt).toBe(NOW);
  });

  it('never lets the email match take a person an owner mapped to someone else', async () => {
    connect();
    const fake = fakeClan({ employees: staff() });
    await synced(fake);
    // The owner says Clan's Dee is Laika's Ada; Clan's Ada still has Ada's email.
    t.db
      .update(hrPeople)
      .set({ userId: null, matchedBy: 'none' })
      .where(eq(hrPeople.externalId, '1'))
      .run();
    t.db
      .update(hrPeople)
      .set({ userId: ada, matchedBy: 'owner' })
      .where(eq(hrPeople.externalId, '3'))
      .run();

    await synced(fake);

    const byRef = Object.fromEntries(
      t.db
        .select()
        .from(hrPeople)
        .all()
        .map((r) => [r.externalId, [r.userId, r.matchedBy]]),
    );
    expect(byRef['3']).toEqual([ada, 'owner']);
    expect(byRef['1']).toEqual([null, 'none']);
  });

  it('moves an email match between people without meeting the one-person index', async () => {
    connect();
    const fake = fakeClan({ employees: staff() });
    await synced(fake);
    // Clan swaps the two addresses.
    fake.employees = [
      employee(1, 'Ada Lovelace', 'bea@example.test'),
      employee(2, 'Bea Bell', 'ada@example.test'),
    ];
    await synced(fake);

    const byRef = Object.fromEntries(
      t.db
        .select()
        .from(hrPeople)
        .all()
        .map((r) => [r.externalId, r.userId]),
    );
    expect(byRef).toMatchObject({ '1': bea, '2': ada, '3': null, '4': null });
  });
});

describe('leave', () => {
  it('keeps a half day each way, and a whole day', async () => {
    connect();
    const fake = fakeClan({
      employees: staff(),
      leave: [
        leaveRow(100, 1, '2026-11-20'),
        leaveRow(101, 1, '2026-11-23', { duration: 'half day', half_day_type: 'first_half' }),
        leaveRow(102, 2, '2026-11-24', { duration: 'half day', half_day_type: 'second_half' }),
      ],
    });
    await synced(fake);

    expect(leaveOf('100')).toMatchObject({ userId: ada, day: '2026-11-20', part: 'full' });
    expect(leaveOf('101')).toMatchObject({ userId: ada, part: 'first_half', typeName: 'Annual' });
    expect(leaveOf('102')).toMatchObject({ userId: bea, part: 'second_half', personRef: '2' });
    expect(leaveOf('100')?.applicationRef).toBe('app-100');
  });

  it('follows a pending day to approved, and leaves an unchanged day alone', async () => {
    connect();
    const fake = fakeClan({
      employees: staff(),
      leave: [
        leaveRow(100, 1, '2026-11-20', { status: 'pending' }),
        leaveRow(101, 1, '2026-11-21'),
      ],
    });
    await synced(fake);
    expect(leaveOf('100')?.status).toBe('pending');
    const before = leaveOf('101');

    fake.leave = [leaveRow(100, 1, '2026-11-20'), leaveRow(101, 1, '2026-11-21')];
    const result = await synced(fake, NOW + 1_000);

    expect(leaveOf('100')).toMatchObject({ status: 'approved', syncedAt: NOW + 1_000 });
    expect(result).toMatchObject({ updated: 1, unchanged: 1, created: 0, removed: 0 });
    // Equal hash: not written at all.
    expect(leaveOf('101')).toEqual(before);
  });

  it('stamps a day cancelled in Clan as removed, and keeps the row', async () => {
    connect();
    const fake = fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] });
    await synced(fake);

    fake.leave = [leaveRow(100, 1, '2026-11-20', { status: 'cancelled' })];
    const result = await synced(fake, NOW + 1_000);

    expect(result).toMatchObject({ removed: 1, leave_days: 0 });
    expect(leaveOf('100')).toMatchObject({ removedAt: NOW + 1_000, status: 'approved' });
  });

  it('stamps a day Clan stops sending as removed, and clears it when it comes back', async () => {
    connect();
    const fake = fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] });
    await synced(fake);

    fake.leave = [];
    expect(await synced(fake, NOW + 1_000)).toMatchObject({ removed: 1 });
    expect(leaveOf('100')?.removedAt).toBe(NOW + 1_000);
    expect(t.db.select().from(leaveDays).all()).toHaveLength(1);

    fake.leave = [leaveRow(100, 1, '2026-11-20')];
    expect(await synced(fake, NOW + 2_000)).toMatchObject({ updated: 1 });
    expect(leaveOf('100')?.removedAt).toBeNull();
  });

  it('leaves a day outside the window alone — it was not read, so it is not absent', async () => {
    connect();
    t.db
      .insert(hrPeople)
      .values({
        externalId: '1',
        userId: ada,
        name: 'Ada',
        matchedBy: 'email',
        seenAt: NOW,
        updatedAt: NOW,
      })
      .run();
    t.db
      .insert(leaveDays)
      .values({
        id: newId(),
        userId: ada,
        personRef: '1',
        day: '2024-12-31',
        part: 'full',
        typeName: null,
        status: 'approved',
        sourceRef: '9',
        applicationRef: null,
        hash: 'h',
        syncedAt: NOW,
        removedAt: null,
      })
      .run();
    await synced(fakeClan({ employees: staff() }));
    expect(leaveOf('9')?.removedAt).toBeNull();
  });
});

describe('holidays', () => {
  it('keeps a holiday for everyone Clan lists, and scoped ones with only the lists named', async () => {
    connect();
    const fake = fakeClan({
      holidays: [
        { id: 10, date: '2026-09-24', occassion: 'Heritage Day' },
        {
          id: 11,
          date: '2026-08-15T00:00:00.000000Z',
          occassion: 'Independence Day',
          department_id_json: '[5,4]',
          designation_id_json: null,
          employment_type_json: null,
        },
        {
          id: 12,
          date: '2026-10-02',
          occassion: 'Gandhi Jayanti',
          employment_type_json: '["full_time","part_time"]',
        },
      ],
    });
    const result = await synced(fake);

    expect(result).toMatchObject({ holidays: 3, created: 3 });
    expect(holidayOf('10')).toMatchObject({
      day: '2026-09-24',
      label: 'Heritage Day',
      source: 'clan',
      scopeJson: null,
      createdBy: null,
      removedAt: null,
    });
    expect(JSON.parse(holidayOf('11')?.scopeJson ?? 'null')).toEqual({ departments: ['4', '5'] });
    expect(JSON.parse(holidayOf('12')?.scopeJson ?? 'null')).toEqual({
      employment_types: ['full_time', 'part_time'],
    });
  });

  it('stamps a holiday Clan drops as removed, and clears it when it is back', async () => {
    connect();
    const fake = fakeClan({
      holidays: [{ id: 10, date: '2026-09-24', occassion: 'Heritage Day' }],
    });
    await synced(fake);

    fake.holidays = [];
    expect(await synced(fake, NOW + 1_000)).toMatchObject({ removed: 1, holidays: 0 });
    expect(holidayOf('10')?.removedAt).toBe(NOW + 1_000);

    fake.holidays = [{ id: 10, date: '2026-09-24', occassion: 'Heritage Day' }];
    expect(await synced(fake, NOW + 2_000)).toMatchObject({ updated: 1 });
    expect(holidayOf('10')?.removedAt).toBeNull();
    expect(t.db.select().from(orgHolidays).all()).toHaveLength(1);
  });

  it('never touches a manual holiday', async () => {
    connect();
    t.db
      .insert(orgHolidays)
      .values({
        id: newId(),
        day: '2026-09-24',
        label: 'Ours',
        source: 'manual',
        sourceRef: null,
        scopeJson: null,
        createdBy: s.userId,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    await synced(fakeClan());
    expect(t.db.select().from(orgHolidays).get()?.removedAt).toBeNull();
  });
});

describe('the record on the connection', () => {
  it('says again what the token reads, as each complete read found it', async () => {
    connect();
    const fake = fakeClan({
      employees: staff(),
      leave: [leaveRow(100, 1, '2026-11-20'), leaveRow(101, 2, '2026-11-20')],
    });
    await synced(fake);
    expect(source()).toMatchObject({ seesEveryone: 1, seesDepartments: 1 });

    // The account's role was narrowed: one person's leave, no departments.
    fake.employees = [employee(1, 'Ada Lovelace', 'ada@example.test', { department_id: null })];
    fake.leave = [leaveRow(100, 1, '2026-11-20')];
    await synced(fake, NOW + 1_000);
    expect(source()).toMatchObject({ seesEveryone: 0, seesDepartments: 0 });
  });

  it('writes the counts, the time, and clears the last error', async () => {
    connect();
    t.db
      .update(orgHrSource)
      .set({ lastErrorCode: 'unreachable', lastError: 'x', lastAttemptAt: NOW - 1 })
      .run();
    const result = await synced(
      fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] }),
    );

    expect(result).toEqual({
      people: 4,
      matched: 2,
      unmatched: 2,
      holidays: 0,
      leave_days: 1,
      created: 1,
      updated: 0,
      removed: 0,
      unchanged: 0,
    });
    expect(source()).toMatchObject({
      lastAttemptAt: NOW,
      lastSuccessAt: NOW,
      lastErrorCode: null,
      lastError: null,
    });
    expect(JSON.parse(source().lastResultJson ?? 'null')).toEqual(result);
  });

  it('records a 401 as token_rejected and changes nothing else', async () => {
    connect();
    const fake = fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] });
    await synced(fake);
    const before = t.db.select().from(leaveDays).all();

    fake.token = 'a-token-Clan-issued-later';
    fake.leave = [];
    expect(await sync(fake, NOW + 1_000)).toEqual({ kind: 'failed', code: 'token_rejected' });

    expect(source()).toMatchObject({
      lastAttemptAt: NOW + 1_000,
      lastSuccessAt: NOW,
      lastErrorCode: 'token_rejected',
    });
    expect(source().lastError).not.toContain('CLAN-SECRET-WORDS');
    expect(t.db.select().from(leaveDays).all()).toEqual(before);
  });

  it('records a timeout as unreachable', async () => {
    connect();
    const fake = fakeClan({ employees: staff() });
    fake.intercept = () => 'hang';
    expect(await sync(fake)).toEqual({ kind: 'failed', code: 'unreachable' });
    expect(source()).toMatchObject({ lastErrorCode: 'unreachable', lastAttemptAt: NOW });
  });

  it('records an answer it cannot read as bad_answer', async () => {
    connect();
    const fake = fakeClan();
    fake.intercept = (req) =>
      req.path === '/holiday'
        ? new Response(JSON.stringify({ data: { not: 'a list' } }), { status: 200 })
        : undefined;
    expect(await sync(fake)).toEqual({ kind: 'failed', code: 'bad_answer' });
  });

  it('records a token LAIKA_SECRET no longer opens as token_rejected, saying so', async () => {
    connect();
    const fake = fakeClan({ employees: staff() });
    const outcome = await runHrSync(t.db, 'a-different-secret-also-long-enough-for-it', {
      fetchImpl: fake.fetchImpl,
      now: () => NOW,
    });
    expect(outcome).toEqual({ kind: 'failed', code: 'token_rejected' });
    expect(source().lastError).toContain('LAIKA_SECRET');
    expect(fake.requests).toEqual([]);
  });
});

describe('an incomplete read changes nothing', () => {
  it('removes nothing and writes nothing when a later page of leave cannot be read', async () => {
    connect();
    const many = Array.from({ length: 1_500 }, (_, i) => leaveRow(1_000 + i, 1, '2026-11-20'));
    const fake = fakeClan({ employees: staff(), leave: many });
    await synced(fake);
    expect(t.db.select().from(leaveDays).all()).toHaveLength(1_500);
    const before = source();

    // The second page is not a list: a read of 1000 out of 1500.
    fake.intercept = (req) =>
      req.path === '/leave' && req.query.get('offset') === '1000'
        ? new Response(JSON.stringify({ data: 'not a list' }), { status: 200 })
        : undefined;
    expect(await sync(fake, NOW + 1_000)).toEqual({ kind: 'failed', code: 'bad_answer' });

    const live = t.db
      .select()
      .from(leaveDays)
      .all()
      .filter((r) => r.removedAt === null);
    expect(live).toHaveLength(1_500);
    expect(source()).toMatchObject({
      lastSuccessAt: before.lastSuccessAt,
      lastResultJson: before.lastResultJson,
      lastErrorCode: 'bad_answer',
    });
  });

  it('removes nothing when a later page fails outright', async () => {
    connect();
    const many = Array.from({ length: 1_200 }, (_, i) => leaveRow(1_000 + i, 1, '2026-11-20'));
    const fake = fakeClan({ employees: staff(), leave: many });
    await synced(fake);

    fake.intercept = (req) =>
      req.path === '/leave' && req.query.get('offset') === '1000'
        ? new Response('{}', { status: 500 })
        : undefined;
    expect(await sync(fake, NOW + 1_000)).toEqual({ kind: 'failed', code: 'unreachable' });
    expect(
      t.db
        .select()
        .from(leaveDays)
        .all()
        .filter((r) => r.removedAt !== null),
    ).toEqual([]);
  });
});

describe('one run at a time', () => {
  it('joins a run already going instead of starting a second', async () => {
    connect();
    const fake = fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] });
    const release = fake.hold();

    const first = sync(fake);
    const second = sync(fake);
    expect(hrSyncInFlight(t.db)).toBeDefined();
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(a.kind).toBe('synced');
    // One read of each list, not two.
    expect(fake.to('/employee')).toHaveLength(1);
    expect(fake.to('/leave')).toHaveLength(1);
    expect(hrSyncInFlight(t.db)).toBeUndefined();
  });

  it('starts a new run once the last has finished', async () => {
    connect();
    const fake = fakeClan({ employees: staff() });
    await sync(fake);
    await sync(fake);
    expect(fake.to('/employee')).toHaveLength(2);
  });

  it('writes nothing when the connection was replaced while it read', async () => {
    connect();
    const fake = fakeClan({ employees: staff(), leave: [leaveRow(100, 1, '2026-11-20')] });
    const release = fake.hold();
    const run = sync(fake);
    // The owner reconnects mid-read: a new token, a new row.
    t.db
      .update(orgHrSource)
      .set({ tokenEnc: encryptSecret('7|another', SECRET, 'clan_api_token') })
      .run();
    release();

    expect(await run).toEqual({ kind: 'skipped' });
    expect(t.db.select().from(leaveDays).all()).toEqual([]);
    expect(source().lastSuccessAt).toBeNull();
  });
});
