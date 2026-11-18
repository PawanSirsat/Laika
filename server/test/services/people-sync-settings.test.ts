import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgCalendarSource, orgPeopleSync, orgRoleGrants, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { encryptSecret } from '../../src/secrets.ts';
import { peopleSyncInFlight } from '../../src/services/people-sync.ts';
import {
  getPeopleSync,
  savePeopleSync,
  syncPeopleNow,
} from '../../src/services/people-sync-settings.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import {
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
} from '../helpers/fake-graph.ts';
import { fakeAttachments } from '../helpers/fake-s3.ts';

/**
 * The Microsoft 365 card's people switches (D-161, LAI-1330). Who may turn
 * them, and in what order: *Leavers* only with *Photos and profile*, only
 * with a connection, and only by someone who may deactivate people.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 10, 18, 12);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let graph: FakeGraph;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW - 60_000);
  owner = loadActor(t.db, s.userId)!;
  graph = fakeGraph({ roles: ['User.Read.All'] });
  graph.directory.set('owner@example.test', {
    id: 'oid-owner',
    upn: 'owner@example.test',
    jobTitle: 'Director',
    accountEnabled: true,
  });
});
afterEach(async () => {
  // A background run a save started begins a tick after it, and must finish
  // before the database closes.
  for (let i = 0; i < 5; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
    await peopleSyncInFlight(t.db)?.catch(() => undefined);
  }
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
      configuredAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function deps(store = true) {
  return {
    fetchImpl: graph.fetchImpl,
    now: () => NOW,
    attachments: { config: store ? fakeAttachments() : null },
  };
}

/** An admin, with every grant an admin holds by default but those `revoked` (§3.1). */
function admin(revoked: ('deactivate_people' | 'change_org_settings')[] = []): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `admin-${id}@example.test`,
      name: 'Admin',
      orgRole: 'admin',
      isActive: 1,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  for (const capability of revoked) {
    t.db
      .insert(orgRoleGrants)
      .values({
        orgId: s.orgId,
        orgRole: 'admin',
        capability,
        granted: 0,
        setBy: s.userId,
        updatedAt: NOW,
      })
      .onConflictDoNothing()
      .run();
  }
  return loadActor(t.db, id)!;
}

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('the view', () => {
  it('is both switches off, with no connection and nothing run, before anyone touches it', () => {
    expect(getPeopleSync(t.db, owner, deps(false))).toEqual({
      connected: false,
      profile_enabled: false,
      leavers_enabled: false,
      photos_stored: false,
      sync_every_minutes: 60,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_result: null,
      leavers: null,
    });
  });

  it('says whether the store keeps photos', () => {
    connect();
    expect(getPeopleSync(t.db, owner, deps(true))).toMatchObject({
      connected: true,
      photos_stored: true,
    });
  });
});

describe('the switches', () => {
  it('turning Photos and profile on starts a run in the background', async () => {
    connect();
    const view = savePeopleSync(
      t.db,
      owner,
      SECRET,
      { profile_enabled: true, leavers_enabled: false },
      deps(),
    );
    expect(view).toMatchObject({ profile_enabled: true, leavers_enabled: false });
    await vi.waitFor(() => {
      expect(getPeopleSync(t.db, owner, deps()).last_result).toMatchObject({ people: 1, found: 1 });
    });
  });

  it('Leavers needs Photos and profile: 422 leavers_need_profile', () => {
    connect();
    const err = refusal(() =>
      savePeopleSync(
        t.db,
        owner,
        SECRET,
        { profile_enabled: false, leavers_enabled: true },
        deps(),
      ),
    );
    expect(err).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'leavers_need_profile' },
    });
  });

  it('turning either on with no connection saved is 409 microsoft_not_connected', () => {
    const err = refusal(() =>
      savePeopleSync(
        t.db,
        owner,
        SECRET,
        { profile_enabled: true, leavers_enabled: false },
        deps(),
      ),
    );
    expect(err).toMatchObject({ code: 'conflict', details: { reason: 'microsoft_not_connected' } });
    expect(t.db.select().from(orgPeopleSync).get()).toBeUndefined();
  });

  it('an admin who may configure the connection but not deactivate people may not turn Leavers on', () => {
    connect();
    const configures = admin(['deactivate_people']);
    savePeopleSync(
      t.db,
      configures,
      SECRET,
      { profile_enabled: true, leavers_enabled: false },
      deps(),
    );
    const err = refusal(() =>
      savePeopleSync(
        t.db,
        configures,
        SECRET,
        { profile_enabled: true, leavers_enabled: true },
        deps(),
      ),
    );
    expect(err.code).toBe('forbidden');
    expect(t.db.select().from(orgPeopleSync).get()?.leaversEnabled).toBe(0);

    t.db.delete(orgRoleGrants).run();
    const both = admin();
    expect(
      savePeopleSync(t.db, both, SECRET, { profile_enabled: true, leavers_enabled: true }, deps()),
    ).toMatchObject({ leavers_enabled: true });
    // Turning it off again asks only the connection's own action.
    expect(
      savePeopleSync(
        t.db,
        configures,
        SECRET,
        { profile_enabled: true, leavers_enabled: false },
        deps(),
      ),
    ).toMatchObject({ leavers_enabled: false });
  });

  it('a member may not read or change any of it', () => {
    const id = newId();
    t.db
      .insert(users)
      .values({
        id,
        email: 'm@example.test',
        name: 'M',
        orgRole: 'member',
        isActive: 1,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })
      .run();
    const member = loadActor(t.db, id)!;
    expect(refusal(() => getPeopleSync(t.db, member, deps())).code).toBe('forbidden');
    expect(
      refusal(() =>
        savePeopleSync(t.db, member, SECRET, { profile_enabled: false, leavers_enabled: false }),
      ).code,
    ).toBe('forbidden');
  });
});

describe('sync now', () => {
  it('is 409 people_sync_off with Photos and profile off', async () => {
    await expect(syncPeopleNow(t.db, owner, SECRET, deps())).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'people_sync_off' },
    });
  });

  it('runs, and answers the run it made', async () => {
    connect();
    t.db
      .insert(orgPeopleSync)
      .values({ orgId: s.orgId, profileEnabled: 1, leaversEnabled: 0, updatedAt: NOW })
      .run();
    const view = await syncPeopleNow(t.db, owner, SECRET, deps());
    expect(view).toMatchObject({
      last_success_at: NOW,
      last_error: null,
      last_result: { found: 1 },
      leavers: { state: 'none' },
    });
    expect(
      t.db.select().from(orgPeopleSync).where(eq(orgPeopleSync.orgId, s.orgId)).get()
        ?.lastErrorCode,
    ).toBeNull();
  });
});
