import { readFileSync, existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { hrPeople, leaveDays, orgHrSource, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { decryptSecret } from '../../src/secrets.ts';
import {
  connectHr,
  disconnectHr,
  getHrSource,
  HR_PENDING_MS,
  setHrPeople,
  syncHrNow,
  verifyHr,
} from '../../src/services/hr-source.ts';
import { hrSyncInFlight, type HrSyncDeps } from '../../src/services/hr-sync.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  CLAN_BASE,
  CLAN_EMAIL,
  CLAN_PASSWORD,
  CLAN_TOKEN,
  employee,
  fakeClan,
  type FakeClan,
  leaveRow,
} from '../helpers/fake-clan.ts';

/**
 * The HR connection (D-149 items 1 and 4, LAI-1181): sign in once, keep only
 * the token, a second factor that waits ten minutes, sync now, disconnect,
 * and the people map.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 10, 13, 12);
const DAY = 24 * 60 * 60 * 1000;

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let adaId: string;
let beaId: string;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function person(name: string, email: string, orgRole: 'admin' | 'member' = 'member'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function deps(fake: FakeClan, now = NOW): HrSyncDeps {
  return {
    fetchImpl: fake.fetchImpl,
    now: () => now,
    sleep: () => Promise.resolve(),
    timeoutMs: 50,
  };
}

const LOGIN = { base_url: 'https://kvell.clan.biz/', email: CLAN_EMAIL, password: CLAN_PASSWORD };

async function caught(promise: Promise<unknown> | (() => unknown)): Promise<ApiError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a failure, and the call succeeded');
}

function reasonOf(err: ApiError): string | undefined {
  return (err.details as { reason?: string } | null)?.reason;
}

/** Connect with no second factor, and wait for the first sync. */
async function connected(fake: FakeClan) {
  const view = await connectHr(t.db, owner, SECRET, LOGIN, deps(fake));
  await hrSyncInFlight(t.db);
  // `syncSoon` starts the run after a turn of the loop; wait for that one too.
  await new Promise((done) => setTimeout(done, 0));
  await hrSyncInFlight(t.db);
  return view;
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  owner = load(s.userId);
  adaId = person('Ada', 'ada@example.test');
  beaId = person('Bea', 'bea@example.test');
});
afterEach(() => {
  t.close();
});

describe('who may', () => {
  it('refuses a member everything, and an admin nothing', async () => {
    const member = load(adaId);
    const fake = fakeClan();
    for (const call of [
      () => getHrSource(t.db, member, NOW),
      () => connectHr(t.db, member, SECRET, LOGIN, deps(fake)),
      () => verifyHr(t.db, member, SECRET, { method: 'email', code: '1' }, deps(fake)),
      () => disconnectHr(t.db, member),
      () => syncHrNow(t.db, member, SECRET, deps(fake)),
      () => setHrPeople(t.db, member, { people: [] }, NOW),
    ]) {
      const err = await caught(call);
      expect(err.code).toBe('forbidden');
      expect((err.details as { action: string }).action).toBe('org.hr.configure');
    }
    expect(fake.requests).toEqual([]);

    const admin = load(person('Adm', 'adm@example.test', 'admin'));
    expect(getHrSource(t.db, admin, NOW).status).toBe('off');
  });
});

describe('off', () => {
  it('reads as off, with nothing but the interval', () => {
    expect(getHrSource(t.db, owner, NOW)).toEqual({
      status: 'off',
      provider: null,
      base_url: null,
      account_email: null,
      token_last4: null,
      token_expires_at: null,
      expiring_soon: false,
      sync_every_minutes: 30,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_result: null,
      two_factor: null,
      people: [],
    });
  });
});

describe('connecting with no second factor', () => {
  it('keeps the token encrypted, shows its last four, and starts the first sync', async () => {
    const fake = fakeClan({
      employees: [employee(1, 'Ada Lovelace', 'ada@example.test')],
      leave: [leaveRow(100, 1, '2026-11-20')],
    });
    const view = await connected(fake);

    expect(view).toMatchObject({
      status: 'connected',
      provider: 'clan',
      base_url: CLAN_BASE,
      account_email: CLAN_EMAIL,
      token_last4: CLAN_TOKEN.slice(-4),
      token_expires_at: Date.parse('2027-11-13T12:00:00Z'),
      expiring_soon: false,
      two_factor: null,
    });
    const row = t.db.select().from(orgHrSource).get();
    expect(row?.tokenEnc).not.toContain(CLAN_TOKEN);
    expect(decryptSecret(row?.tokenEnc ?? '', SECRET, 'clan_api_token')).toBe(CLAN_TOKEN);
    expect(row?.connectedBy).toBe(s.userId);

    // The first sync ran in the background.
    expect(fake.to('/leave')).toHaveLength(1);
    const after = getHrSource(t.db, owner, NOW);
    expect(after.last_result).toMatchObject({ people: 1, matched: 1, leave_days: 1 });
    expect(after.people).toEqual([
      {
        external_id: '1',
        name: 'Ada Lovelace',
        user: { id: adaId, name: 'Ada' },
        matched_by: 'email',
      },
    ]);
  });

  it('never stores the password: not in the database file, nor its write-ahead log', async () => {
    await connected(fakeClan({ employees: [employee(1, 'Ada Lovelace', 'ada@example.test')] }));
    t.sqlite.pragma('wal_checkpoint(PASSIVE)');

    const files = [t.path, `${t.path}-wal`].filter((f) => existsSync(f));
    const bytes = Buffer.concat(files.map((f) => readFileSync(f)));
    // A positive control: the grep can see what was stored.
    expect(bytes.includes(Buffer.from(CLAN_EMAIL))).toBe(true);
    expect(bytes.includes(Buffer.from('Ada Lovelace'))).toBe(true);
    // And neither the password nor the plain token is anywhere in it.
    expect(bytes.includes(Buffer.from(CLAN_PASSWORD))).toBe(false);
    expect(bytes.includes(Buffer.from(CLAN_TOKEN))).toBe(false);
  });

  it('refuses a wrong password as 422 clan_login_failed and keeps nothing', async () => {
    const err = await caught(
      connectHr(t.db, owner, SECRET, { ...LOGIN, password: 'wrong' }, deps(fakeClan())),
    );
    expect(err.status).toBe(422);
    expect(reasonOf(err)).toBe('clan_login_failed');
    expect(t.db.select().from(orgHrSource).all()).toEqual([]);
  });

  it('refuses a non-https address before calling anybody', async () => {
    const fake = fakeClan();
    const err = await caught(
      connectHr(t.db, owner, SECRET, { ...LOGIN, base_url: 'http://kvell.clan.biz' }, deps(fake)),
    );
    expect(err.status).toBe(422);
    expect(reasonOf(err)).toBe('base_url_not_https');
    expect(fake.requests).toEqual([]);
  });

  it('says Clan could not be reached, and keeps nothing', async () => {
    const fake = fakeClan();
    fake.intercept = () => 'hang';
    const err = await caught(connectHr(t.db, owner, SECRET, LOGIN, deps(fake)));
    expect(err.code).toBe('unavailable');
    expect(reasonOf(err)).toBe('clan_unreachable');
    expect(t.db.select().from(orgHrSource).all()).toEqual([]);
  });

  it('will not store a token under no secret', async () => {
    const fake = fakeClan();
    const err = await caught(connectHr(t.db, owner, '', LOGIN, deps(fake)));
    expect(err.code).toBe('internal');
    expect(fake.requests).toEqual([]);
  });

  it('flags a token ending within 30 days', async () => {
    const fake = fakeClan({ expires: new Date(NOW + 29 * DAY).toISOString() });
    expect((await connected(fake)).expiring_soon).toBe(true);
    const later = fakeClan({ expires: new Date(NOW + 31 * DAY).toISOString() });
    expect((await connected(later)).expiring_soon).toBe(false);
  });
});

describe('connecting with a second factor', () => {
  it('waits, encrypted, for the code — and does not sync until it comes', async () => {
    const fake = fakeClan({ twoFactorMethods: ['email'], twoFactorCode: '123456' });
    const view = await connectHr(t.db, owner, SECRET, LOGIN, deps(fake));

    expect(view).toMatchObject({ status: 'pending_2fa', two_factor: { methods: ['email'] } });
    expect(t.db.select().from(orgHrSource).get()).toMatchObject({
      status: 'pending_2fa',
      pendingExpiresAt: NOW + HR_PENDING_MS,
    });
    expect(hrSyncInFlight(t.db)).toBeUndefined();
    // A read of a waiting sign-in: the methods were said once.
    expect(getHrSource(t.db, owner, NOW).two_factor).toEqual({ methods: [] });

    const wrong = await caught(
      verifyHr(t.db, owner, SECRET, { method: 'email', code: '000000' }, deps(fake)),
    );
    expect(reasonOf(wrong)).toBe('clan_login_failed');
    expect(t.db.select().from(orgHrSource).get()?.status).toBe('pending_2fa');

    const done = await verifyHr(
      t.db,
      owner,
      SECRET,
      { method: 'email', code: '123456' },
      deps(fake),
    );
    expect(done).toMatchObject({ status: 'connected', two_factor: null });
    expect(t.db.select().from(orgHrSource).get()?.pendingExpiresAt).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await hrSyncInFlight(t.db);
    expect(fake.to('/employee')).toHaveLength(1);
  });

  it('keeps the new token when the second factor answers one', async () => {
    const fake = fakeClan({
      twoFactorMethods: ['email'],
      twoFactorCode: '123456',
      twoFactorToken: '43|theNewTokenAfterTheCode9876',
    });
    await connectHr(t.db, owner, SECRET, LOGIN, deps(fake));
    const done = await verifyHr(
      t.db,
      owner,
      SECRET,
      { method: 'email', code: '123456' },
      deps(fake),
    );

    expect(done.token_last4).toBe('9876');
    const row = t.db.select().from(orgHrSource).get();
    expect(decryptSecret(row?.tokenEnc ?? '', SECRET, 'clan_api_token')).toBe(
      '43|theNewTokenAfterTheCode9876',
    );
  });

  it('gives up after ten minutes: 409 two_factor_expired, and the sign-in is gone', async () => {
    const fake = fakeClan({ twoFactorMethods: ['email'], twoFactorCode: '123456' });
    await connectHr(t.db, owner, SECRET, LOGIN, deps(fake));

    const late = deps(fake, NOW + HR_PENDING_MS);
    expect(getHrSource(t.db, owner, NOW + HR_PENDING_MS).status).toBe('off');
    const err = await caught(
      verifyHr(t.db, owner, SECRET, { method: 'email', code: '123456' }, late),
    );
    expect(err.status).toBe(409);
    expect(reasonOf(err)).toBe('two_factor_expired');
    expect(t.db.select().from(orgHrSource).all()).toEqual([]);
    expect(fake.to('/auth/two-factor')).toEqual([]);
  });

  it('answers 409 two_factor_expired when nothing is waiting', async () => {
    const err = await caught(
      verifyHr(t.db, owner, SECRET, { method: 'email', code: '1' }, deps(fakeClan())),
    );
    expect(reasonOf(err)).toBe('two_factor_expired');
  });
});

describe('sync now and disconnecting', () => {
  it('answers 409 hr_not_connected with no connection, or one still waiting', async () => {
    const fake = fakeClan({ twoFactorMethods: ['email'], twoFactorCode: '1' });
    expect(reasonOf(await caught(syncHrNow(t.db, owner, SECRET, deps(fake))))).toBe(
      'hr_not_connected',
    );
    await connectHr(t.db, owner, SECRET, LOGIN, deps(fake));
    expect(reasonOf(await caught(syncHrNow(t.db, owner, SECRET, deps(fake))))).toBe(
      'hr_not_connected',
    );
  });

  it('syncs and answers how it went', async () => {
    const fake = fakeClan({ employees: [employee(1, 'Ada Lovelace', 'ada@example.test')] });
    await connected(fake);
    fake.leave = [leaveRow(100, 1, '2026-11-20')];

    const view = await syncHrNow(t.db, owner, SECRET, deps(fake, NOW + 1_000));
    expect(view.last_success_at).toBe(NOW + 1_000);
    expect(view.last_result).toMatchObject({ created: 1, leave_days: 1 });
  });

  it('answers the failure on the view, in Laika’s words', async () => {
    const fake = fakeClan();
    await connected(fake);
    fake.token = 'reissued';
    const view = await syncHrNow(t.db, owner, SECRET, deps(fake, NOW + 1_000));
    expect(view.last_error).toEqual({
      code: 'token_rejected',
      message: 'Clan refused the stored token. Connect again to renew it.',
    });
  });

  it('forgets the token on disconnect, and keeps what was synced', async () => {
    const fake = fakeClan({
      employees: [employee(1, 'Ada Lovelace', 'ada@example.test')],
      leave: [leaveRow(100, 1, '2026-11-20')],
      holidays: [{ id: 10, date: '2026-09-24', occassion: 'Heritage Day' }],
    });
    await connected(fake);
    disconnectHr(t.db, owner);

    expect(t.db.select().from(orgHrSource).all()).toEqual([]);
    expect(t.db.select().from(leaveDays).get()?.removedAt).toBeNull();
    expect(getHrSource(t.db, owner, NOW)).toMatchObject({ status: 'off', token_last4: null });
    expect(getHrSource(t.db, owner, NOW).people).toHaveLength(1);
  });
});

describe('the people map', () => {
  async function withPeople() {
    const fake = fakeClan({
      employees: [
        employee(1, 'Ada Lovelace', 'ada@example.test'),
        employee(2, 'Bea Bell', 'bea@example.test'),
        employee(3, 'Dee Dot', 'dee@nowhere.test'),
      ],
      leave: [leaveRow(100, 1, '2026-11-20')],
    });
    await connected(fake);
    return fake;
  }

  function mapOf() {
    return Object.fromEntries(
      t.db
        .select()
        .from(hrPeople)
        .all()
        .map((p) => [p.externalId, [p.userId, p.matchedBy]]),
    );
  }

  it('maps a person, and “not on Laika”, as the owner’s — and the next sync keeps both', async () => {
    const fake = await withPeople();
    setHrPeople(
      t.db,
      owner,
      {
        people: [
          { external_id: '1', user_id: null },
          { external_id: '3', user_id: adaId },
        ],
      },
      NOW,
    );
    expect(mapOf()).toMatchObject({ '1': [null, 'owner'], '3': [adaId, 'owner'] });
    // Ada's day was Clan person 1's, who is no longer her: removed at once.
    expect(t.db.select().from(leaveDays).get()?.removedAt).toBe(NOW);

    await syncHrNow(t.db, owner, SECRET, deps(fake, NOW + 1_000));
    expect(mapOf()).toMatchObject({ '1': [null, 'owner'], '3': [adaId, 'owner'] });
  });

  it('takes a person from an email match, and refuses one an owner mapped elsewhere', async () => {
    await withPeople();
    // Bea is Clan person 2 by email; the owner says she is Clan person 3.
    setHrPeople(t.db, owner, { people: [{ external_id: '3', user_id: beaId }] }, NOW);
    expect(mapOf()).toMatchObject({ '2': [null, 'none'], '3': [beaId, 'owner'] });

    const err = await caught(() =>
      setHrPeople(t.db, owner, { people: [{ external_id: '2', user_id: beaId }] }, NOW),
    );
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ reason: 'user_mapped_elsewhere', external_id: '3' });
  });

  it('swaps two people in one request', async () => {
    await withPeople();
    setHrPeople(
      t.db,
      owner,
      {
        people: [
          { external_id: '1', user_id: beaId },
          { external_id: '2', user_id: adaId },
        ],
      },
      NOW,
    );
    expect(mapOf()).toMatchObject({ '1': [beaId, 'owner'], '2': [adaId, 'owner'] });
  });

  it('refuses unknown ids with 422, naming which, and changes nothing', async () => {
    await withPeople();
    const before = mapOf();
    for (const [people, reason] of [
      [[{ external_id: '99', user_id: null }], 'unknown_person'],
      [[{ external_id: '1', user_id: 'no-such-user' }], 'unknown_user'],
      [
        [
          { external_id: '1', user_id: null },
          { external_id: '1', user_id: null },
        ],
        'duplicate_person',
      ],
      [
        [
          { external_id: '1', user_id: adaId },
          { external_id: '2', user_id: adaId },
        ],
        'duplicate_user',
      ],
    ] as const) {
      const err = await caught(() =>
        setHrPeople(t.db, owner, { people: people.map((p) => ({ ...p })) }, NOW),
      );
      expect(err.status, reason).toBe(422);
      expect(reasonOf(err), reason).toBe(reason);
    }
    expect(mapOf()).toEqual(before);
  });

  it('refuses a deactivated person as unknown', async () => {
    await withPeople();
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, beaId)).run();
    const err = await caught(() =>
      setHrPeople(t.db, owner, { people: [{ external_id: '3', user_id: beaId }] }, NOW),
    );
    expect(reasonOf(err)).toBe('unknown_user');
  });
});
