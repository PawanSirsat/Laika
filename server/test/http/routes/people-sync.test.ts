import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, userDirectory, users } from '../../../src/db/schema.ts';
import { peopleSyncInFlight } from '../../../src/services/people-sync.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';
import {
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
} from '../../helpers/fake-graph.ts';
import { fakeAttachments, fakeS3, type FakeS3 } from '../../helpers/fake-s3.ts';

/**
 * People from Microsoft over HTTP (D-161, LAI-1330): the card's switches
 * (`/org/people-sync`), everyone's entry (`/people/directory`) and a photo
 * (`/users/:id/photo`) — cached for a year only at its current version, and
 * the same `404` whatever the reason there is none to show.
 */

const PASSWORD = 'correct-horse-battery-staple';
const NOW = Date.UTC(2026, 10, 18, 12);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 7, 7, 7]);

let h: AuthHarness;
let graph: FakeGraph;
let s3: FakeS3;
let cookie: string;
let ownerId: string;

interface ErrorBody {
  error: { code: string; details: Record<string, unknown> | null };
}

beforeEach(async () => {
  graph = fakeGraph({
    roles: ['Calendars.Read', 'User.Read.All'],
    directory: [
      {
        id: 'oid-ada',
        upn: 'ada@example.test',
        jobTitle: 'Director',
        department: 'Leadership',
        accountEnabled: true,
        photo: { etag: '"W/1"', bytes: JPEG },
      },
    ],
  });
  s3 = fakeS3();
  const attachments = { config: fakeAttachments(), fetchImpl: s3.fetchImpl, now: () => NOW };
  h = authHarness({
    attachments,
    calendarSync: { fetchImpl: graph.fetchImpl, now: () => NOW },
    peopleSync: {
      fetchImpl: (input, init) => graph.fetchImpl(input, init),
      sleep: () => Promise.resolve(),
      now: () => NOW,
    },
  });
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Kvell Dynamics',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
});
afterEach(async () => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
    await peopleSyncInFlight(h.db)?.catch(() => undefined);
  }
  h.close();
});

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<string> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { Cookie: cookie },
): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders(headers),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/** Connect Microsoft 365, turn Photos and profile on, and sync now. */
async function synced(): Promise<void> {
  const saved = await call('PUT', '/org/calendar', {
    tenant_id: GRAPH_TENANT,
    client_id: GRAPH_CLIENT,
    client_secret: GRAPH_SECRET,
    enabled: false,
    rules: [],
  });
  expect(saved.status, await saved.clone().text()).toBe(200);
  const on = await call('PUT', '/org/people-sync', {
    profile_enabled: true,
    leavers_enabled: false,
  });
  expect(on.status, await on.clone().text()).toBe(200);
  const now = await call('POST', '/org/people-sync/sync');
  expect(now.status, await now.clone().text()).toBe(200);
}

describe('/org/people-sync', () => {
  it('answers the owner the switches and the last run, and a member 403', async () => {
    const view = await call('GET', '/org/people-sync');
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({
      connected: false,
      profile_enabled: false,
      leavers_enabled: false,
      photos_stored: true,
    });
    const member = await join('m@example.test', 'member');
    expect((await call('GET', '/org/people-sync', undefined, { Cookie: member })).status).toBe(403);
  });

  it('refuses an unknown field, and Leavers without Photos and profile', async () => {
    const extra = await call('PUT', '/org/people-sync', {
      profile_enabled: true,
      leavers_enabled: false,
      photos: true,
    });
    expect(extra.status).toBe(422);
    const order = await call('PUT', '/org/people-sync', {
      profile_enabled: false,
      leavers_enabled: true,
    });
    expect(order.status).toBe(422);
    expect(((await order.json()) as ErrorBody).error.details).toMatchObject({
      reason: 'leavers_need_profile',
    });
  });

  it('sync now is 409 with the switch off, and the run it made once on', async () => {
    const off = await call('POST', '/org/people-sync/sync');
    expect(off.status).toBe(409);
    await synced();
    const view = await (await call('GET', '/org/people-sync')).json();
    // Turning the switch on fetched the photo; sync now found its tag unchanged.
    expect(view).toMatchObject({
      connected: true,
      profile_enabled: true,
      last_result: { found: 1, photos_fetched: 0, photos_unchanged: 1 },
      leavers: { state: 'none' },
    });
    expect(graph.of('photoValue')).toHaveLength(1);
  });
});

describe('/people/directory and /users/:id/photo', () => {
  it('serves everyone their entry and the photo at its version, cached for a year', async () => {
    await synced();
    const viewer = await join('v@example.test', 'viewer');
    const dir = await call('GET', '/people/directory', undefined, { Cookie: viewer });
    expect(dir.status).toBe(200);
    const people = ((await dir.json()) as { people: Record<string, { photo_v: number }> }).people;
    const v = people[ownerId]?.photo_v;
    expect(people[ownerId]).toMatchObject({ job_title: 'Director', department: 'Leadership' });
    expect(v).toBe(NOW);

    const photo = await call('GET', `/users/${ownerId}/photo?v=${String(v)}`, undefined, {
      Cookie: viewer,
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(photo.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);

    // An old or missing version is asked again every time.
    const stale = await call('GET', `/users/${ownerId}/photo?v=1`, undefined, { Cookie: viewer });
    expect(stale.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('is 401 to nobody, and 404 for a person with no photo', async () => {
    await synced();
    const anon = await h.app.request(`/api/v1/users/${ownerId}/photo`);
    expect(anon.status).toBe(401);
    const member = await join('m@example.test', 'member');
    const memberId = h.db.select().from(users).where(eq(users.email, 'm@example.test')).get()!.id;
    const none = await call('GET', `/users/${memberId}/photo`, undefined, { Cookie: member });
    expect(none.status).toBe(404);
    expect(((await none.json()) as ErrorBody).error.code).toBe('not_found');
    expect(
      h.db.select().from(userDirectory).where(eq(userDirectory.userId, memberId)).get(),
    ).toBeUndefined();
  });
});
