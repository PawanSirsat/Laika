import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  orgCalendarSource,
  orgPeopleSync,
  projectMemberships,
  tasks,
  userDirectory,
  users,
} from '../../src/db/schema.ts';
import { encryptSecret } from '../../src/secrets.ts';
import { disconnectCalendar, saveCalendarSource } from '../../src/services/calendar-source.ts';
import {
  LEAVER_CONFIRM_MS,
  PHOTO_MAX_BYTES,
  type PeopleSyncOutcome,
  runPeopleSync,
} from '../../src/services/people-sync.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  type FakeDirectoryUser,
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
} from '../helpers/fake-graph.ts';
import { fakeAttachments, fakeS3, type FakeS3 } from '../helpers/fake-s3.ts';

/**
 * The people sync (D-161, LAI-1330), against a fake Graph and a fake store —
 * **no test calls Microsoft or a store**. What matters: each person is read
 * and kept on their own; a photo is fetched only when Microsoft's tag moved,
 * proved by its bytes, and removed when Microsoft removed it; and a leaver is
 * deactivated only past every guard.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 10, 18, 12);
const HOUR = 60 * 60 * 1000;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 9, 9, 9]);
/** An SVG that says it is a jpeg: its bytes say otherwise. */
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let graph: FakeGraph;
let s3: FakeS3;
let clock: number;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW - 60_000);
  owner = loadActor(t.db, s.userId)!;
  s3 = fakeS3();
  clock = NOW;
  graph = fakeGraph({ roles: ['Calendars.Read', 'User.Read.All'] });
  connect();
  switches(true, false);
});
afterEach(() => {
  t.close();
});

function connect(): void {
  t.db
    .insert(orgCalendarSource)
    .values({
      orgId: s.orgId,
      tenantId: GRAPH_TENANT,
      clientId: GRAPH_CLIENT,
      secretEnc: encryptSecret(GRAPH_SECRET, SECRET, 'calendar_client_secret'),
      secretLast4: GRAPH_SECRET.slice(-4),
      enabled: 0,
      configuredBy: s.userId,
      configuredAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function switches(profile: boolean, leavers: boolean): void {
  const values = {
    profileEnabled: profile ? 1 : 0,
    leaversEnabled: leavers ? 1 : 0,
    updatedAt: NOW,
  };
  t.db
    .insert(orgPeopleSync)
    .values({ orgId: s.orgId, ...values })
    .onConflictDoUpdate({ target: orgPeopleSync.orgId, set: values })
    .run();
}

function person(name: string, email: string, role: 'member' | 'admin' = 'member'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email,
      name,
      orgRole: role,
      isActive: 1,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

/** Someone in Microsoft's directory, by their address as their user principal name. */
function entra(upn: string, extra: Partial<FakeDirectoryUser> = {}): FakeDirectoryUser {
  const u: FakeDirectoryUser = { id: `oid-${upn}`, upn, mail: upn, accountEnabled: true, ...extra };
  graph.directory.set(upn.toLowerCase(), u);
  return u;
}

/**
 * `n` more members, each found in the directory: one leaver is then not
 * more than a tenth of the members, and the breaker stays out of the way.
 */
function crowd(n: number): void {
  for (let i = 0; i < n; i += 1) {
    person(`P${String(i)}`, `p${String(i)}@example.test`);
    entra(`p${String(i)}@example.test`);
  }
}

function deps(store: 'on' | 'off' = 'on') {
  return {
    fetchImpl: graph.fetchImpl,
    sleep: () => Promise.resolve(),
    now: () => clock,
    attachments:
      store === 'off'
        ? { config: null }
        : { config: fakeAttachments(), fetchImpl: s3.fetchImpl, now: () => clock },
  };
}

function run(store: 'on' | 'off' = 'on'): Promise<PeopleSyncOutcome> {
  return runPeopleSync(t.db, SECRET, deps(store));
}

async function synced(store: 'on' | 'off' = 'on') {
  const outcome = await run(store);
  if (outcome.kind !== 'synced') throw new Error(`expected a sync, got ${JSON.stringify(outcome)}`);
  return outcome;
}

function row(userId: string) {
  return t.db.select().from(userDirectory).where(eq(userDirectory.userId, userId)).get();
}

function active(userId: string): boolean {
  return t.db.select().from(users).where(eq(users.id, userId)).get()?.isActive === 1;
}

describe('when it runs', () => {
  it('does nothing with Photos and profile off, and asks Microsoft nothing', async () => {
    switches(false, false);
    expect(await run()).toEqual({ kind: 'skipped' });
    expect(graph.requests).toEqual([]);
  });

  it('records not_connected when the switch is on and no connection is saved', async () => {
    t.db.delete(orgCalendarSource).run();
    expect(await run()).toEqual({ kind: 'failed', code: 'not_connected' });
    expect(t.db.select().from(orgPeopleSync).get()).toMatchObject({
      lastErrorCode: 'not_connected',
      lastAttemptAt: NOW,
    });
    expect(graph.requests).toEqual([]);
  });

  it('records not_granted, reading nobody, when the token lacks User.Read.All', async () => {
    graph.roles = ['Calendars.Read'];
    entra('owner@example.test');
    expect(await run()).toEqual({ kind: 'failed', code: 'not_granted' });
    expect(graph.of('user')).toHaveLength(0);
  });

  it('joins a run already going rather than starting a second', async () => {
    entra('owner@example.test');
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe(b);
    expect(graph.of('user')).toHaveLength(1);
  });
});

describe('profiles', () => {
  it('keeps title, department, account state and a manager matched to a Laika user', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test', { jobTitle: 'Director', department: 'Leadership' });
    entra('ada@example.test', {
      jobTitle: 'Engineer',
      department: 'Platform',
      manager: 'owner@example.test',
    });
    const { result } = await synced();
    expect(result).toMatchObject({ people: 2, found: 2, updated: 2 });
    expect(row(ada)).toMatchObject({
      entraOid: 'oid-ada@example.test',
      jobTitle: 'Engineer',
      department: 'Platform',
      managerUserId: s.userId,
      accountEnabled: 1,
      seenAt: NOW,
      missingSince: null,
    });
    // Nothing changed: nothing counted as updated the second time.
    expect((await synced()).result.updated).toBe(0);
  });

  it('finds by mail when the address is not the user principal name', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    graph.directory.set('a.lovelace@tenant.test', {
      id: 'oid-ada',
      upn: 'a.lovelace@tenant.test',
      mail: 'Ada@Example.test',
      jobTitle: 'Engineer',
      accountEnabled: true,
    });
    expect((await synced()).result).toMatchObject({ found: 2, not_found: 0 });
    expect(row(ada)).toMatchObject({ entraOid: 'oid-ada', jobTitle: 'Engineer' });
  });

  it('a 403, a 400 or a 404 skips only that person; everyone else is kept', async () => {
    const denied = person('Den', 'den@example.test');
    const refused = person('Ref', 'ref@example.test');
    const missing = person('Mis', 'mis@example.test');
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test', { jobTitle: 'Engineer' });
    graph.denied.add('den@example.test');
    graph.refused.add('ref@example.test');
    const { result } = await synced();
    expect(result).toMatchObject({ people: 5, found: 2, denied: 1, refused: 1, not_found: 1 });
    expect(row(ada)?.jobTitle).toBe('Engineer');
    for (const id of [denied, refused, missing]) expect(row(id)).toBeUndefined();
  });
});

describe('photos', () => {
  it('fetches and stores a photo, then fetches nothing while its tag is unchanged', async () => {
    entra('owner@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    const first = await synced();
    expect(first.result).toMatchObject({ photos_fetched: 1, photos_unchanged: 0 });
    const stored = row(s.userId)!;
    expect(stored).toMatchObject({
      photoType: 'image/jpeg',
      photoEtag: '"W/1"',
      photoUpdatedAt: NOW,
    });
    expect(stored.photoKey).toMatch(new RegExp(`^u/${s.userId}/photo/[0-9A-Z]{26}$`));
    expect(s3.objects.get(stored.photoKey!)?.body).toEqual(JPEG);

    clock = NOW + HOUR;
    const second = await synced();
    expect(second.result).toMatchObject({ photos_fetched: 0, photos_unchanged: 1 });
    expect(graph.of('photoValue')).toHaveLength(1);
    expect(row(s.userId)?.photoKey).toBe(stored.photoKey);
  });

  it('a changed tag fetches the new photo, under a new key, and deletes the old object', async () => {
    const me = entra('owner@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    await synced();
    const oldKey = row(s.userId)!.photoKey!;
    me.photo = { etag: '"W/2"', bytes: PNG, contentType: 'image/png' };
    clock = NOW + HOUR;
    expect((await synced()).result).toMatchObject({ photos_fetched: 1 });
    const now = row(s.userId)!;
    expect(now).toMatchObject({
      photoType: 'image/png',
      photoEtag: '"W/2"',
      photoUpdatedAt: NOW + HOUR,
    });
    expect(now.photoKey).not.toBe(oldKey);
    expect(s3.objects.has(oldKey)).toBe(false);
    expect(s3.objects.get(now.photoKey!)?.body).toEqual(PNG);
  });

  it('a photo removed in Microsoft (404) is removed here, object and all', async () => {
    const me = entra('owner@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    await synced();
    const key = row(s.userId)!.photoKey!;
    delete me.photo;
    expect((await synced()).result).toMatchObject({ photos_removed: 1 });
    expect(row(s.userId)).toMatchObject({ photoKey: null, photoType: null, photoEtag: null });
    expect(s3.objects.has(key)).toBe(false);
  });

  it('a photo Microsoft will not show (403) keeps the one stored', async () => {
    entra('owner@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    await synced();
    graph.intercept = (req) =>
      req.kind === 'photo' ? new Response('{}', { status: 403 }) : undefined;
    await synced();
    expect(row(s.userId)?.photoEtag).toBe('"W/1"');
  });

  it('no photo at 240px is not no photo: the default size is asked for and kept (F4)', async () => {
    entra('owner@example.test', { photo: { etag: '"W/9"', bytes: JPEG, defaultOnly: true } });
    expect((await synced()).result).toMatchObject({ photos_fetched: 1 });
    expect(graph.of('photoValue').map((r) => r.url.pathname)).toEqual([
      '/v1.0/users/oid-owner%40example.test/photo/$value',
    ]);
    expect(row(s.userId)).toMatchObject({ photoEtag: '"W/9"', photoType: 'image/jpeg' });
  });

  it('an empty answer for the bytes keeps the photo stored (F5)', async () => {
    const me = entra('owner@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    await synced();
    const key = row(s.userId)!.photoKey!;
    me.photo = { etag: '"W/2"', bytes: JPEG };
    graph.intercept = (req) =>
      req.kind === 'photoValue' ? new Response(new Uint8Array(), { status: 200 }) : undefined;
    clock = NOW + HOUR;
    // Skipped, not refused: an empty answer says nothing about the photo.
    expect((await synced()).result).toMatchObject({
      photos_removed: 0,
      photos_fetched: 0,
      photos_refused: 0,
    });
    expect(row(s.userId)).toMatchObject({ photoKey: key, photoEtag: '"W/1"' });
    expect(s3.objects.has(key)).toBe(true);
  });

  it('refuses bytes that are not png, jpeg or webp, whatever they claim, and over a megabyte', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test', {
      photo: { etag: '"svg"', bytes: SVG, contentType: 'image/jpeg' },
    });
    entra('ada@example.test', {
      photo: { etag: '"big"', bytes: new Uint8Array(PHOTO_MAX_BYTES + 1).fill(0xff) },
    });
    const { result } = await synced();
    expect(result).toMatchObject({ photos_fetched: 0, photos_refused: 2 });
    expect(row(s.userId)?.photoKey).toBeNull();
    expect(row(ada)?.photoKey).toBeNull();
    expect(s3.objects.size).toBe(0);
  });

  it('no store is no photo asked for; profiles are still kept', async () => {
    entra('owner@example.test', { jobTitle: 'Director', photo: { etag: '"W/1"', bytes: JPEG } });
    await synced('off');
    expect(graph.of('photo')).toHaveLength(0);
    expect(row(s.userId)).toMatchObject({ jobTitle: 'Director', photoKey: null });
  });

  it('a store that fails defers photos to the next run and keeps reading profiles', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    entra('ada@example.test', { jobTitle: 'Engineer', photo: { etag: '"W/1"', bytes: JPEG } });
    s3.intercept = (req) =>
      req.method === 'PUT' ? new Response('no', { status: 503 }) : undefined;
    const { result } = await synced();
    expect(result).toMatchObject({ found: 2, photos_fetched: 0, photos_deferred: 2 });
    expect(row(ada)?.jobTitle).toBe('Engineer');
  });
});

describe('one person, one Entra id (review M1)', () => {
  it('a rename in Microsoft keeps them: read by id, never missed, never a leaver', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test', { jobTitle: 'Engineer' });
    crowd(10);
    await synced();
    // Renamed and moved to a new domain: the address answers nobody now.
    graph.directory.delete('ada@example.test');
    graph.directory.set('ada.lovelace@new.test', {
      id: 'oid-ada@example.test',
      upn: 'ada.lovelace@new.test',
      mail: 'ada.lovelace@new.test',
      jobTitle: 'Staff engineer',
      accountEnabled: true,
    });
    for (const at of [NOW + HOUR, NOW + 2 * HOUR, NOW + 3 * HOUR]) {
      clock = at;
      expect((await synced()).leavers.state).toBe('none');
    }
    expect(active(ada)).toBe(true);
    expect(row(ada)).toMatchObject({ jobTitle: 'Staff engineer', missingSince: null });
    // Her address asked for once — the first match — and her id after.
    const asked = graph.of('user').map((r) => r.user);
    expect(asked.filter((u) => u === 'ada@example.test')).toHaveLength(1);
    expect(asked.filter((u) => u === 'oid-ada@example.test')).toHaveLength(3);
  });

  it('an address handed to someone else: nothing of theirs is saved, nobody goes, and the card says check', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test', { jobTitle: 'Engineer' });
    crowd(10);
    await synced();
    // Her account deleted; a new hire given her address.
    graph.directory.set('ada@example.test', {
      id: 'oid-new-hire',
      upn: 'ada@example.test',
      mail: 'ada@example.test',
      jobTitle: 'Intern',
      accountEnabled: true,
      photo: { etag: '"new"', bytes: JPEG },
    });
    for (const at of [NOW + HOUR, NOW + 3 * HOUR]) {
      clock = at;
      const { result, leavers } = await synced();
      expect(result.changed).toBe(1);
      expect(leavers.state).toBe('none');
      expect(leavers.changed).toEqual([{ user_id: ada, name: 'Ada', email: 'ada@example.test' }]);
    }
    expect(active(ada)).toBe(true);
    expect(row(ada)).toMatchObject({
      entraOid: 'oid-ada@example.test',
      jobTitle: 'Engineer',
      photoKey: null,
      missingSince: null,
    });
  });

  it('their id answered with another account is that account changed, not them', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test', { jobTitle: 'Engineer' });
    crowd(10);
    await synced();
    graph.intercept = (req) =>
      req.kind === 'user' && req.user === 'oid-ada@example.test'
        ? new Response(
            JSON.stringify({
              id: 'oid-someone-else',
              userPrincipalName: 'ada@example.test',
              mail: 'ada@example.test',
              jobTitle: 'Intern',
              accountEnabled: false,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : undefined;
    for (const at of [NOW + HOUR, NOW + 3 * HOUR]) {
      clock = at;
      const { result, leavers } = await synced();
      expect(result.changed).toBe(1);
      expect(leavers.state).toBe('none');
      expect(leavers.changed).toEqual([{ user_id: ada, name: 'Ada', email: 'ada@example.test' }]);
    }
    expect(active(ada)).toBe(true);
    expect(row(ada)).toMatchObject({
      entraOid: 'oid-ada@example.test',
      jobTitle: 'Engineer',
      accountEnabled: 1,
      disabledSince: null,
    });
  });
});

/**
 * Match everyone at `NOW`, then see `who` disabled at +1 h — the first
 * sighting — and again at +2 h, which confirms it: the second run's outcome.
 */
async function disabledTwice(who: FakeDirectoryUser[]) {
  clock = NOW;
  await synced();
  for (const u of who) u.accountEnabled = false;
  clock = NOW + HOUR;
  const first = await synced();
  clock = NOW + 2 * HOUR;
  return { first, second: await synced() };
}

describe('leavers', () => {
  it('a disabled account is listed only on a second sighting an hour after the first — a dry run while Leavers is off', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    const her = entra('ada@example.test');
    crowd(10);
    const { first, second } = await disabledTwice([her]);
    expect(first.leavers.state).toBe('none');
    expect(second.leavers).toMatchObject({ state: 'dry_run', breaker: false });
    expect(second.leavers.people).toEqual([
      {
        user_id: ada,
        name: 'Ada',
        email: 'ada@example.test',
        reason: 'disabled',
        protected: null,
        failed: false,
      },
    ]);
    expect(active(ada)).toBe(true);
  });

  it('a first match proves nothing: an account disabled from the start needs two later sightings (M2)', async () => {
    switches(true, true);
    const shared = person('Shared mailbox', 'shared@example.test');
    entra('owner@example.test');
    entra('shared@example.test', { accountEnabled: false });
    crowd(10);
    expect((await synced()).leavers.state).toBe('none');
    expect(row(shared)?.disabledSince).toBeNull();
    clock = NOW + HOUR;
    expect((await synced()).leavers.state).toBe('none');
    expect(row(shared)?.disabledSince).toBe(NOW + HOUR);
    expect(active(shared)).toBe(true);
    clock = NOW + 2 * HOUR;
    expect((await synced()).leavers.people.map((p) => p.user_id)).toEqual([shared]);
  });

  it('with Leavers on, deactivates through the deactivation service, as the system, and forgets their photo (F3)', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId: s.projectId, userId: ada, role: 'member', createdAt: NOW })
      .run();
    const task = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Hers', assignee_id: ada });
    entra('owner@example.test');
    const her = entra('ada@example.test', { photo: { etag: '"W/1"', bytes: JPEG } });
    crowd(10);
    clock = NOW;
    await synced();
    const key = row(ada)!.photoKey!;
    expect(s3.objects.has(key)).toBe(true);

    const { second } = await disabledTwice([her]);
    expect(second.leavers).toMatchObject({ state: 'deactivated' });
    expect(active(ada)).toBe(false);
    // Her open task handed back, her space left — and the record says who did it.
    expect(t.db.select().from(tasks).where(eq(tasks.id, task.id)).get()?.assigneeId).toBeNull();
    expect(
      t.db.select().from(projectMemberships).where(eq(projectMemberships.userId, ada)).all(),
    ).toEqual([]);
    const done = t.db.select().from(activity).where(eq(activity.type, 'user.deactivated')).all();
    expect(done.map((a) => [a.actorKind, a.actorId])).toEqual([['system', null]]);
    expect(JSON.parse(done[0]!.payloadJson)).toMatchObject({
      user_id: ada,
      via: 'microsoft_directory',
    });
    // Her photo and directory row go with her: old history draws initials.
    expect(row(ada)).toBeUndefined();
    expect(s3.objects.has(key)).toBe(false);
  });

  it('one leaver that cannot be deactivated is marked, and the others still go (F6)', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    const bea = person('Bea', 'bea@example.test');
    entra('owner@example.test');
    const a = entra('ada@example.test');
    const b = entra('bea@example.test');
    crowd(30);
    t.sqlite.exec(`
      CREATE TRIGGER stuck BEFORE UPDATE OF is_active ON users WHEN OLD.email = 'ada@example.test'
      BEGIN SELECT RAISE(ABORT, 'a fault nobody expected'); END
    `);
    const { second } = await disabledTwice([a, b]);
    expect(second.leavers.state).toBe('deactivated');
    expect(second.leavers.people.map((p) => [p.user_id, p.failed]).sort()).toEqual(
      [
        [ada, true],
        [bea, false],
      ].sort(),
    );
    expect(active(ada)).toBe(true);
    expect(active(bea)).toBe(false);
    expect(t.db.select().from(orgPeopleSync).get()?.lastSuccessAt).toBe(NOW + 2 * HOUR);
  });

  it('a person gone by their id goes only on a second miss at least an hour after the first', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test');
    crowd(10);
    await synced();
    graph.directory.delete('ada@example.test');

    clock = NOW + HOUR;
    expect((await synced()).leavers.state).toBe('none');
    expect(row(ada)?.missingSince).toBe(NOW + HOUR);
    expect(active(ada)).toBe(true);

    clock = NOW + HOUR + LEAVER_CONFIRM_MS - 1;
    expect((await synced()).leavers.state).toBe('none');
    expect(active(ada)).toBe(true);

    clock = NOW + HOUR + LEAVER_CONFIRM_MS;
    const { leavers } = await synced();
    expect(leavers.people).toMatchObject([{ user_id: ada, reason: 'gone' }]);
    expect(active(ada)).toBe(false);
  });

  it('found again clears the first miss', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    const her = entra('ada@example.test');
    await synced();
    graph.directory.delete('ada@example.test');
    clock = NOW + HOUR;
    await synced();
    graph.directory.set('ada@example.test', her);
    clock = NOW + 2 * HOUR;
    await synced();
    expect(row(ada)?.missingSince).toBeNull();
  });

  it('someone the directory never had is never a leaver, however long they are missing', async () => {
    switches(true, true);
    const guest = person('Guest', 'guest@elsewhere.test');
    entra('owner@example.test');
    for (const at of [NOW, NOW + 2 * HOUR, NOW + 5 * HOUR]) {
      clock = at;
      expect((await synced()).leavers.state).toBe('none');
    }
    expect(active(guest)).toBe(true);
    expect(row(guest)).toBeUndefined();
  });

  it('a miss counts only with an Entra id on the row: the review asks for one itself', async () => {
    switches(true, true);
    const guest = person('Guest', 'guest@elsewhere.test');
    entra('owner@example.test');
    crowd(10);
    // A row with a first miss and no Entra id — what no sync writes, but the
    // review must not be the place that trusts that.
    t.db
      .insert(userDirectory)
      .values({ userId: guest, missingSince: NOW - 2 * HOUR, updatedAt: NOW })
      .run();
    expect((await synced()).leavers.state).toBe('none');
    expect(active(guest)).toBe(true);
  });

  it('never deactivates an owner, and says why', async () => {
    switches(true, true);
    const me = entra('owner@example.test');
    crowd(10);
    const { second } = await disabledTwice([me]);
    expect(second.leavers.people).toMatchObject([{ user_id: s.userId, protected: 'owner' }]);
    expect(active(s.userId)).toBe(true);
  });

  it('never deactivates the last admin: of two disabled, one goes and the other stays', async () => {
    switches(true, true);
    const a = person('Amy', 'amy@example.test', 'admin');
    const b = person('Bob', 'bob@example.test', 'admin');
    entra('owner@example.test');
    const amy = entra('amy@example.test');
    const bob = entra('bob@example.test');
    // Twenty members, so two leavers are under the breaker's tenth.
    crowd(17);
    const { second } = await disabledTwice([amy, bob]);
    expect(second.leavers.state).toBe('deactivated');
    expect([active(a), active(b)].sort()).toEqual([false, true]);
    expect(second.leavers.people.map((p) => p.protected).sort()).toEqual(['last_admin', null]);

    // Alone, the last admin is protected before anything is tried.
    const alone = active(a) ? a : b;
    clock = NOW + 3 * HOUR;
    expect((await synced()).leavers.people).toMatchObject([
      { user_id: alone, protected: 'last_admin' },
    ]);
    expect(active(alone)).toBe(true);
  });

  it('the breaker holds everyone when more than three would go', async () => {
    switches(true, true);
    entra('owner@example.test');
    const gone = [1, 2, 3, 4].map((n) => ({
      id: person(`L${String(n)}`, `l${String(n)}@example.test`),
      u: entra(`l${String(n)}@example.test`),
    }));
    crowd(40);
    const { second } = await disabledTwice(gone.map((g) => g.u));
    expect(second.leavers).toMatchObject({ state: 'held', breaker: true });
    expect(second.leavers.people).toHaveLength(4);
    for (const g of gone) expect(active(g.id)).toBe(true);
  });

  it('the breaker holds everyone when more than a tenth of members would go', async () => {
    switches(true, true);
    entra('owner@example.test');
    const gone = [1, 2].map((n) => ({
      id: person(`L${String(n)}`, `l${String(n)}@example.test`),
      u: entra(`l${String(n)}@example.test`),
    }));
    // Two of eight is a quarter: held, though two is under the count.
    crowd(5);
    const { second } = await disabledTwice(gone.map((g) => g.u));
    expect(second.leavers).toMatchObject({ state: 'held', breaker: true });
    for (const g of gone) expect(active(g.id)).toBe(true);
  });

  it('the breaker counts the sync’s own deactivations over 24 hours, not one run (F1)', async () => {
    switches(true, true);
    entra('owner@example.test');
    const people = [1, 2, 3, 4].map((n) => ({
      id: person(`L${String(n)}`, `l${String(n)}@example.test`),
      u: entra(`l${String(n)}@example.test`),
    }));
    crowd(40);
    // Three today, under the count: they go.
    const { second } = await disabledTwice(people.slice(0, 3).map((p) => p.u));
    expect(second.leavers.state).toBe('deactivated');
    // A fourth, still inside the day: held.
    const last = people[3]!;
    last.u.accountEnabled = false;
    clock = NOW + 3 * HOUR;
    await synced();
    clock = NOW + 4 * HOUR;
    expect((await synced()).leavers).toMatchObject({ state: 'held', breaker: true });
    expect(active(last.id)).toBe(true);
    // A day after the three, the window has moved on: the fourth goes.
    clock = NOW + 2 * HOUR + 24 * HOUR + 1;
    expect((await synced()).leavers.state).toBe('deactivated');
    expect(active(last.id)).toBe(false);
  });

  it('a dry run says whether the breaker would hold', async () => {
    entra('owner@example.test');
    const all = [1, 2, 3, 4].map((n) => {
      person(`L${String(n)}`, `l${String(n)}@example.test`);
      return entra(`l${String(n)}@example.test`);
    });
    const { second } = await disabledTwice(all);
    expect(second.leavers).toMatchObject({ state: 'dry_run', breaker: true });
  });
});

describe('another tenant or app (F2)', () => {
  it('forgets every Entra id and first sighting, and switches Leavers off', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test');
    await synced();
    expect(row(ada)?.entraOid).toBe('oid-ada@example.test');

    saveCalendarSource(
      t.db,
      owner,
      SECRET,
      {
        tenant_id: 'contoso.onmicrosoft.com',
        client_id: GRAPH_CLIENT,
        enabled: false,
        rules: [],
      },
      { now: () => clock },
    );
    expect(row(ada)).toMatchObject({ entraOid: null, missingSince: null, disabledSince: null });
    expect(t.db.select().from(orgPeopleSync).get()).toMatchObject({
      profileEnabled: 1,
      leaversEnabled: 0,
    });

    // A disconnect forgets them too: the next connection may be another tenant's.
    switches(true, true);
    t.db.update(userDirectory).set({ entraOid: 'oid-x' }).run();
    disconnectCalendar(t.db, owner, NOW);
    expect(row(ada)?.entraOid).toBeNull();
    expect(t.db.select().from(orgPeopleSync).get()?.leaversEnabled).toBe(0);
  });

  it('a run still reading the old tenant puts no Entra id back, and records nothing', async () => {
    switches(true, false);
    person('Ada', 'ada@example.test');
    person('Bob', 'bob@example.test');
    entra('owner@example.test');
    entra('ada@example.test');
    entra('bob@example.test');
    // The second person's read is answered as another tenant is saved.
    let reads = 0;
    graph.intercept = (req) => {
      if (req.kind === 'user' && ++reads === 2) {
        saveCalendarSource(
          t.db,
          owner,
          SECRET,
          {
            tenant_id: 'contoso.onmicrosoft.com',
            client_id: GRAPH_CLIENT,
            enabled: false,
            rules: [],
          },
          { now: () => clock },
        );
      }
      return undefined;
    };

    expect((await run()).kind).toBe('skipped');
    expect(reads).toBe(2);
    const rows = t.db.select().from(userDirectory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entraOid).toBeNull();
    expect(t.db.select().from(orgPeopleSync).get()?.lastResultJson).toBeNull();
  });
});
