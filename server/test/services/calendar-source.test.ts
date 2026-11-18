import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  orgCalendarSource,
  orgTimeSettings,
  projects,
  timeEntries,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { decryptSecret } from '../../src/secrets.ts';
import {
  disconnectCalendar,
  getCalendarSource,
  saveCalendarSource,
  syncCalendarNow,
  testCalendarSource,
} from '../../src/services/calendar-source.ts';
import { calendarSyncInFlight, type CalendarSyncDeps } from '../../src/services/calendar-sync.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
  graphEvent,
} from '../helpers/fake-graph.ts';

/**
 * The Outlook calendar connection (§4.101, D-157, LAI-1316): the app's
 * credentials kept as ciphertext and never served, the rules, the switch that
 * starts off, a test of the grant that works while it is off, sync now, and
 * disconnect.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 10, 18, 12);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let fake: FakeGraph;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function person(email: string, orgRole: 'admin' | 'member'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({ id, email, name: email, orgRole, createdAt: new Date(NOW), updatedAt: new Date(NOW) })
    .run();
  return id;
}

function deps(f: FakeGraph = fake, now = NOW): CalendarSyncDeps {
  return { fetchImpl: f.fetchImpl, now: () => now, sleep: () => Promise.resolve(), timeoutMs: 50 };
}

const SAVE = {
  tenant_id: GRAPH_TENANT,
  client_id: GRAPH_CLIENT,
  client_secret: GRAPH_SECRET,
  enabled: false,
  rules: [] as { kind: 'title' | 'channel'; text: string; project: string }[],
};

async function caught(promise: Promise<unknown> | (() => unknown)): Promise<ApiError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a failure, and the call succeeded');
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  owner = load(s.userId);
  fake = fakeGraph({ calendars: { 'owner@example.test': [] } });
  t.db.insert(orgTimeSettings).values({ orgId: s.orgId, mode: 'manual', updatedAt: NOW }).run();
});
afterEach(async () => {
  await calendarSyncInFlight(t.db);
  t.close();
});

describe('reading it', () => {
  it('reads as not configured and off before anything is saved', () => {
    expect(getCalendarSource(t.db, owner)).toEqual({
      configured: false,
      enabled: false,
      tenant_id: null,
      client_id: null,
      secret_last4: null,
      rules: [],
      sync_every_minutes: 15,
      last_test: null,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_result: null,
    });
  });

  it('is an owner’s or an admin’s, never a member’s', async () => {
    const admin = load(person('admin@example.test', 'admin'));
    const member = load(person('member@example.test', 'member'));
    expect(getCalendarSource(t.db, admin).configured).toBe(false);
    expect((await caught(() => getCalendarSource(t.db, member))).code).toBe('forbidden');
    expect((await caught(() => saveCalendarSource(t.db, member, SECRET, SAVE))).code).toBe(
      'forbidden',
    );
    expect((await caught(testCalendarSource(t.db, member, SECRET, deps()))).code).toBe('forbidden');
    expect((await caught(syncCalendarNow(t.db, member, SECRET, deps()))).code).toBe('forbidden');
    expect((await caught(() => disconnectCalendar(t.db, member))).code).toBe('forbidden');
  });
});

describe('saving it', () => {
  it('keeps the secret as ciphertext, serves its last four, and stays off', () => {
    const view = saveCalendarSource(t.db, owner, SECRET, SAVE, deps());
    expect(view).toMatchObject({
      configured: true,
      enabled: false,
      tenant_id: GRAPH_TENANT,
      client_id: GRAPH_CLIENT,
      secret_last4: GRAPH_SECRET.slice(-4),
      last_test: null,
    });
    expect(JSON.stringify(view)).not.toContain(GRAPH_SECRET);
    const row = t.db.select().from(orgCalendarSource).get();
    expect(row?.secretEnc).not.toContain(GRAPH_SECRET);
    expect(decryptSecret(row!.secretEnc, SECRET, 'calendar_client_secret')).toBe(GRAPH_SECRET);
    expect(row?.enabled).toBe(0);
    // Saving reads nothing from Microsoft.
    expect(fake.requests).toHaveLength(0);
  });

  it('keeps the stored secret when none is typed, and needs one the first time', async () => {
    const { client_secret: _omit, ...withoutSecret } = SAVE;
    const first = await caught(() => saveCalendarSource(t.db, owner, SECRET, withoutSecret));
    expect(first.details).toMatchObject({ field: 'client_secret', reason: 'secret_required' });

    saveCalendarSource(t.db, owner, SECRET, SAVE);
    const before = t.db.select().from(orgCalendarSource).get()?.secretEnc;
    saveCalendarSource(t.db, owner, SECRET, { ...withoutSecret, client_secret: '  ' });
    expect(t.db.select().from(orgCalendarSource).get()?.secretEnc).toBe(before);
  });

  it('refuses a tenant that is not a GUID or a domain, and a client id that is not a GUID', async () => {
    for (const [input, field, reason] of [
      [{ tenant_id: 'common' }, 'tenant_id', 'tenant_invalid'],
      [{ tenant_id: 'https://evil.example/' }, 'tenant_id', 'tenant_invalid'],
      [{ client_id: 'KSage' }, 'client_id', 'client_invalid'],
    ] as const) {
      const err = await caught(() =>
        saveCalendarSource(t.db, owner, SECRET, { ...SAVE, ...input }),
      );
      expect(err.details).toMatchObject({ field, reason });
    }
    expect(t.db.select().from(orgCalendarSource).all()).toEqual([]);
  });

  it('takes a domain tenant and upper-case ids, kept lowercase', () => {
    const view = saveCalendarSource(t.db, owner, SECRET, {
      ...SAVE,
      tenant_id: 'Kvelld.OnMicrosoft.com',
      client_id: GRAPH_CLIENT.toUpperCase(),
    });
    expect(view).toMatchObject({
      tenant_id: 'kvelld.onmicrosoft.com',
      client_id: GRAPH_CLIENT,
    });
  });

  it('keeps rules by space, serves each with its space, and refuses one it cannot find', async () => {
    const view = saveCalendarSource(t.db, owner, SECRET, {
      ...SAVE,
      rules: [
        { kind: 'title', text: '  Sprint  ', project: 'laika' },
        { kind: 'channel', text: 'Laika Dev', project: 'laika' },
      ],
    });
    expect(view.rules).toEqual([
      { kind: 'title', text: 'Sprint', project: { id: s.projectId, slug: 'laika', name: 'Laika' } },
      {
        kind: 'channel',
        text: 'Laika Dev',
        project: { id: s.projectId, slug: 'laika', name: 'Laika' },
      },
    ]);
    const stored = JSON.parse(t.db.select().from(orgCalendarSource).get()!.rulesJson) as unknown;
    expect(stored).toEqual([
      { kind: 'title', text: 'Sprint', project_id: s.projectId },
      { kind: 'channel', text: 'Laika Dev', project_id: s.projectId },
    ]);

    const err = await caught(() =>
      saveCalendarSource(t.db, owner, SECRET, {
        ...SAVE,
        rules: [{ kind: 'title', text: 'x', project: 'nowhere' }],
      }),
    );
    expect(err.details).toMatchObject({
      field: 'rules',
      reason: 'unknown_project',
      project: 'nowhere',
    });
  });

  it('serves a rule whose space is gone with no space', () => {
    const doomed = newId();
    t.db
      .insert(projects)
      .values({
        id: doomed,
        orgId: s.orgId,
        slug: 'doomed',
        name: 'Doomed',
        prefix: 'DOO',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    saveCalendarSource(t.db, owner, SECRET, {
      ...SAVE,
      rules: [{ kind: 'title', text: 'x', project: 'doomed' }],
    });
    t.db.delete(projects).run();
    expect(getCalendarSource(t.db, owner).rules).toEqual([
      { kind: 'title', text: 'x', project: null },
    ]);
  });

  it('starts a sync when the switch is turned on, and not when saved off', async () => {
    fake.calendars.set('owner@example.test', [graphEvent(Date.UTC(2026, 10, 18, 9))]);
    saveCalendarSource(t.db, owner, SECRET, SAVE, deps());
    expect(calendarSyncInFlight(t.db)).toBeUndefined();

    saveCalendarSource(t.db, owner, SECRET, { ...SAVE, enabled: true }, deps());
    await new Promise((done) => setTimeout(done, 0));
    await calendarSyncInFlight(t.db);
    expect(t.db.select().from(timeEntries).all()).toHaveLength(1);
    const view = getCalendarSource(t.db, owner);
    expect(view).toMatchObject({ enabled: true, last_success_at: NOW });
    expect(view.last_result).toMatchObject({ created: 1 });
  });

  it('forgets the last test when the credentials change, and keeps it when only the rules do', async () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    await testCalendarSource(t.db, owner, SECRET, deps());
    expect(getCalendarSource(t.db, owner).last_test).not.toBeNull();

    saveCalendarSource(t.db, owner, SECRET, { ...SAVE, client_secret: undefined });
    expect(getCalendarSource(t.db, owner).last_test).not.toBeNull();

    saveCalendarSource(t.db, owner, SECRET, { ...SAVE, client_secret: `${GRAPH_SECRET}x` });
    expect(getCalendarSource(t.db, owner).last_test).toBeNull();
  });
});

describe('testing it', () => {
  it('says Calendars.Read is granted, with the switch off, and reads no calendar', async () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    const view = await testCalendarSource(t.db, owner, SECRET, deps());
    expect(view.enabled).toBe(false);
    expect(view.last_test).toEqual({ at: NOW, calendars_read: true, roles: ['Calendars.Read'] });
    expect(fake.of('token')).toHaveLength(1);
    expect(fake.of('calendarView')).toHaveLength(0);
  });

  it('says it is not granted yet, and asks again each time', async () => {
    fake.roles = ['User.Read.All'];
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    expect((await testCalendarSource(t.db, owner, SECRET, deps())).last_test).toEqual({
      at: NOW,
      calendars_read: false,
      roles: ['User.Read.All'],
    });
    // The admin consents; the next test sees it, never a cached token.
    fake.roles = ['Calendars.Read', 'User.Read.All'];
    expect(
      (await testCalendarSource(t.db, owner, SECRET, deps(fake, NOW + 60_000))).last_test,
    ).toEqual({
      at: NOW + 60_000,
      calendars_read: true,
      roles: ['Calendars.Read', 'User.Read.All'],
    });
    expect(fake.of('token')).toHaveLength(2);
  });

  it('answers refused credentials as such, keeps nothing, and needs a connection', async () => {
    expect((await caught(testCalendarSource(t.db, owner, SECRET, deps()))).details).toMatchObject({
      reason: 'calendar_not_configured',
    });
    saveCalendarSource(t.db, owner, SECRET, { ...SAVE, client_secret: 'wrong-secret' });
    const err = await caught(testCalendarSource(t.db, owner, SECRET, deps()));
    expect(err.code).toBe('unprocessable');
    expect(err.details).toMatchObject({ reason: 'graph_credentials_refused' });
    expect(JSON.stringify(err.details)).not.toMatch(/AADSTS|MS-SECRET-WORDS/);
    expect(getCalendarSource(t.db, owner).last_test).toBeNull();
  });

  it('answers an unreachable Microsoft 503', async () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    fake.intercept = () => new Response('{}', { status: 500 });
    const err = await caught(testCalendarSource(t.db, owner, SECRET, deps()));
    expect(err.code).toBe('unavailable');
    expect(err.details).toMatchObject({ reason: 'graph_unreachable' });
  });
});

describe('with the organisation’s Time off (review F11)', () => {
  it('refuses sync now and turning the switch on, and still saves with the switch off', async () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    t.db.update(orgTimeSettings).set({ mode: 'off' }).run();
    const on = await caught(() =>
      saveCalendarSource(t.db, owner, SECRET, { ...SAVE, client_secret: undefined, enabled: true }),
    );
    expect(on.code).toBe('forbidden');
    expect(on.details).toMatchObject({ reason: 'time_off' });
    expect(t.db.select().from(orgCalendarSource).get()?.enabled).toBe(0);
    // Off is always allowed, rules and all.
    expect(
      saveCalendarSource(t.db, owner, SECRET, { ...SAVE, client_secret: undefined }).enabled,
    ).toBe(false);

    t.db.update(orgCalendarSource).set({ enabled: 1 }).run();
    const now = await caught(syncCalendarNow(t.db, owner, SECRET, deps()));
    expect(now.code).toBe('forbidden');
    expect(now.details).toMatchObject({ reason: 'time_off' });
    expect(fake.requests).toEqual([]);
  });
});

describe('a secret this server can no longer read', () => {
  it('answers the test 409 secret_unreadable, and asks Microsoft nothing', async () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    const err = await caught(
      testCalendarSource(t.db, owner, 'another-secret-that-is-long-enough-too', deps()),
    );
    expect(err.code).toBe('conflict');
    expect(err.details).toEqual({ reason: 'secret_unreadable' });
    expect(fake.requests).toEqual([]);
  });
});

describe('sync now and disconnect', () => {
  it('refuses sync now while the switch is off, and syncs when it is on', async () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    expect((await caught(syncCalendarNow(t.db, owner, SECRET, deps()))).details).toEqual({
      reason: 'calendar_off',
    });
    t.db.update(orgCalendarSource).set({ enabled: 1 }).run();
    const view = await syncCalendarNow(t.db, owner, SECRET, deps());
    expect(view).toMatchObject({ last_success_at: NOW, last_error: null });
    expect(view.last_result).toMatchObject({ people: 1, no_mailbox: 0 });
  });

  it('serves a result stored before LAI-1331 with no out-of-office count as 0, and a new one as counted', () => {
    saveCalendarSource(t.db, owner, SECRET, SAVE);
    const old = { people: 2, no_mailbox: 0, mailbox_denied: 0, mailbox_refused: 0, meetings: 3 };
    t.db
      .update(orgCalendarSource)
      .set({ lastResultJson: JSON.stringify(old) })
      .run();
    expect(getCalendarSource(t.db, owner).last_result).toEqual({ ...old, away: 0 });
    t.db
      .update(orgCalendarSource)
      .set({ lastResultJson: JSON.stringify({ ...old, away: 2 }) })
      .run();
    expect(getCalendarSource(t.db, owner).last_result).toEqual({ ...old, away: 2 });
  });

  it('forgets the credentials and keeps the meetings already logged', async () => {
    fake.calendars.set('owner@example.test', [graphEvent(Date.UTC(2026, 10, 18, 9))]);
    saveCalendarSource(t.db, owner, SECRET, { ...SAVE, enabled: true }, deps());
    await new Promise((done) => setTimeout(done, 0));
    await calendarSyncInFlight(t.db);
    disconnectCalendar(t.db, owner);
    expect(getCalendarSource(t.db, owner).configured).toBe(false);
    expect(t.db.select().from(orgCalendarSource).all()).toEqual([]);
    expect(t.db.select().from(timeEntries).all()).toHaveLength(1);
  });
});
