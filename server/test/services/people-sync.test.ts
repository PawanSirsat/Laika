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
import {
  LEAVER_MISSING_MS,
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

describe('leavers', () => {
  it('lists a disabled account as a dry run while Leavers is off, and deactivates nobody', async () => {
    const ada = person('Ada', 'ada@example.test');
    entra('owner@example.test');
    entra('ada@example.test', { accountEnabled: false });
    crowd(10);
    const { leavers } = await synced();
    expect(leavers).toMatchObject({ state: 'dry_run', breaker: false });
    expect(leavers.people).toEqual([
      { user_id: ada, name: 'Ada', email: 'ada@example.test', reason: 'disabled', protected: null },
    ]);
    expect(active(ada)).toBe(true);
  });

  it('with Leavers on, deactivates a disabled account through the deactivation service, as the system', async () => {
    switches(true, true);
    const ada = person('Ada', 'ada@example.test');
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId: s.projectId, userId: ada, role: 'member', createdAt: NOW })
      .run();
    const task = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Hers', assignee_id: ada });
    entra('owner@example.test');
    entra('ada@example.test', { accountEnabled: false });
    crowd(10);

    const { leavers } = await synced();
    expect(leavers).toMatchObject({ state: 'deactivated' });
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
  });

  it('a person gone from the directory goes only on a second miss at least an hour after the first', async () => {
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

    clock = NOW + HOUR + LEAVER_MISSING_MS - 1;
    expect((await synced()).leavers.state).toBe('none');
    expect(active(ada)).toBe(true);

    clock = NOW + HOUR + LEAVER_MISSING_MS;
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
    entra('owner@example.test', { accountEnabled: false });
    const { leavers } = await synced();
    expect(leavers.people).toMatchObject([{ user_id: s.userId, protected: 'owner' }]);
    expect(active(s.userId)).toBe(true);
  });

  it('never deactivates the last admin: of two disabled, one goes and the other stays', async () => {
    switches(true, true);
    const a = person('Amy', 'amy@example.test', 'admin');
    const b = person('Bob', 'bob@example.test', 'admin');
    entra('owner@example.test');
    entra('amy@example.test', { accountEnabled: false });
    entra('bob@example.test', { accountEnabled: false });
    // Twenty members, so two leavers are under the breaker's tenth.
    crowd(17);
    const { leavers } = await synced();
    expect(leavers.state).toBe('deactivated');
    expect([active(a), active(b)].sort()).toEqual([false, true]);
    expect(leavers.people.map((p) => p.protected).sort()).toEqual(['last_admin', null]);

    // Alone, the last admin is protected before anything is tried.
    const alone = active(a) ? a : b;
    clock = NOW + HOUR;
    expect((await synced()).leavers.people).toMatchObject([
      { user_id: alone, protected: 'last_admin' },
    ]);
    expect(active(alone)).toBe(true);
  });

  it('the breaker holds everyone when more than three would go', async () => {
    switches(true, true);
    entra('owner@example.test');
    const gone = [1, 2, 3, 4].map((n) => {
      entra(`l${String(n)}@example.test`, { accountEnabled: false });
      return person(`L${String(n)}`, `l${String(n)}@example.test`);
    });
    crowd(40);
    const { leavers } = await synced();
    expect(leavers).toMatchObject({ state: 'held', breaker: true });
    expect(leavers.people).toHaveLength(4);
    for (const id of gone) expect(active(id)).toBe(true);
  });

  it('the breaker holds everyone when more than a tenth of members would go', async () => {
    switches(true, true);
    entra('owner@example.test');
    const gone = [1, 2].map((n) => {
      entra(`l${String(n)}@example.test`, { accountEnabled: false });
      return person(`L${String(n)}`, `l${String(n)}@example.test`);
    });
    // Two of eight is a quarter: held, though two is under the count.
    crowd(5);
    expect((await synced()).leavers).toMatchObject({ state: 'held', breaker: true });
    for (const id of gone) expect(active(id)).toBe(true);
  });

  it('a dry run says whether the breaker would hold', async () => {
    entra('owner@example.test');
    for (const n of [1, 2, 3, 4]) {
      entra(`l${String(n)}@example.test`, { accountEnabled: false });
      person(`L${String(n)}`, `l${String(n)}@example.test`);
    }
    expect((await synced()).leavers).toMatchObject({ state: 'dry_run', breaker: true });
  });
});
