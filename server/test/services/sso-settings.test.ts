/**
 * Organisation → Security's Sign-in card (LAI-1239): what it may read, what it
 * must never serve, and *Sync now*.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type MicrosoftSso } from '../../src/auth/sso.ts';
import { newId } from '../../src/db/ids.ts';
import { users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { resetDirectoryRun } from '../../src/services/microsoft-directory.ts';
import { resetMeetingsRun } from '../../src/services/meetings-sync.ts';
import {
  getSsoSettings,
  syncDirectoryNow,
  syncMeetingsNow,
} from '../../src/services/sso-settings.ts';
import { fakeGraph } from '../helpers/fake-graph.ts';
import { ALL, USER_IDS } from '../helpers/meetings-fixture.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

const NOW = 1_800_000_000_000;
const PUBLIC = 'https://laika.kvelld.example/';
const SSO: MicrosoftSso = {
  provider: 'microsoft',
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 'never-in-a-response',
  tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
  directorySync: true,
  meetingsSync: false,
};

let t: TestDb;
let s: Seed;
beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  resetDirectoryRun();
  resetMeetingsRun();
});
afterEach(() => {
  t.close();
});

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function member(): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Member',
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return load(id);
}

async function refusal(call: () => unknown): Promise<ApiError> {
  try {
    await call();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

/** A Graph with one enabled Member, or one that refuses the listing. */
function graph(status = 200): typeof fetch {
  return ((url: string | URL) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'x' }), { status: 200 }));
    }
    if (status !== 200) return Promise.resolve(new Response('{}', { status }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          value: [
            {
              id: 'm1',
              displayName: 'Mia',
              mail: 'mia@kvelld.co.za',
              userPrincipalName: 'mia@kvelld.co.za',
              accountEnabled: true,
              userType: 'Member',
            },
          ],
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
}

describe('reading the sign-in settings', () => {
  it('is the owner’s and refuses a member', async () => {
    expect((await refusal(() => getSsoSettings(member(), SSO, PUBLIC))).code).toBe('forbidden');
    expect(getSsoSettings(load(s.userId), SSO, PUBLIC).sign_in).toBe('microsoft');
  });

  it('says what to register in Entra, and never serves the client secret', () => {
    const view = getSsoSettings(load(s.userId), SSO, PUBLIC);
    expect(view.microsoft).toMatchObject({
      tenant_id: SSO.tenantId,
      client_id: SSO.clientId,
      redirect_uri: 'https://laika.kvelld.example/api/v1/auth/callback/microsoft',
      directory_sync: { enabled: true, every_minutes: 15, last_run: null },
    });
    expect(JSON.stringify(view)).not.toContain(SSO.clientSecret);
  });

  it('a password instance has no Microsoft half (the control)', () => {
    expect(getSsoSettings(load(s.userId), null, PUBLIC)).toEqual({
      sign_in: 'email',
      microsoft: null,
    });
  });
});

describe('Sync now', () => {
  it('refuses a member before touching Microsoft', async () => {
    let called = false;
    const spy = ((...args: Parameters<typeof fetch>) => {
      called = true;
      return graph()(...args);
    }) as typeof fetch;
    const err = await refusal(() => syncDirectoryNow(t.db, member(), SSO, PUBLIC, { fetch: spy }));
    expect(err.code).toBe('forbidden');
    expect(called).toBe(false);
  });

  it('says how to turn it on when directory sync is off', async () => {
    const err = await refusal(() =>
      syncDirectoryNow(t.db, load(s.userId), { ...SSO, directorySync: false }, PUBLIC),
    );
    expect(err.code).toBe('conflict');
    expect(err.message).toMatch(/LAIKA_MICROSOFT_DIRECTORY_SYNC=true/);
  });

  it('runs, and the card reads the run it just made', async () => {
    const view = await syncDirectoryNow(t.db, load(s.userId), SSO, PUBLIC, {
      fetch: graph(),
      now: () => NOW,
    });
    expect(view.microsoft?.directory_sync.last_run).toEqual({
      at: NOW,
      ok: true,
      added: 1,
      existing: 0,
      error: null,
    });
  });

  it('a refused listing is recorded as its code, not thrown at the page', async () => {
    const view = await syncDirectoryNow(t.db, load(s.userId), SSO, PUBLIC, {
      fetch: graph(403),
      now: () => NOW,
    });
    expect(view.microsoft?.directory_sync.last_run).toMatchObject({
      ok: false,
      error: 'graph_forbidden_grant_user_read_all',
    });
  });
});

describe('the meetings sync block (LAI-1311)', () => {
  const ON: MicrosoftSso = { ...SSO, meetingsSync: true };

  it('says whether it is on, how often, and which Graph permissions it needs', () => {
    expect(getSsoSettings(load(s.userId), ON, PUBLIC).microsoft?.meetings_sync).toEqual({
      enabled: true,
      every_minutes: 15,
      permissions: [
        'Calendars.Read',
        'OnlineMeetings.Read.All',
        'OnlineMeetingArtifact.Read.All',
        'OnlineMeetingTranscript.Read.All',
        'User.Read.All',
      ],
      last_run: null,
    });
    expect(getSsoSettings(load(s.userId), SSO, PUBLIC).microsoft?.meetings_sync.enabled).toBe(
      false,
    );
  });

  it('Sync now refuses a member, and says how to turn it on when off', async () => {
    const graph = fakeGraph(ALL, { userIds: USER_IDS });
    const denied = await refusal(() =>
      syncMeetingsNow(t.db, member(), ON, PUBLIC, { fetch: graph.fetchImpl }),
    );
    expect(denied.code).toBe('forbidden');
    expect(graph.calls).toEqual([]);

    const off = await refusal(() => syncMeetingsNow(t.db, load(s.userId), SSO, PUBLIC));
    expect(off.code).toBe('conflict');
    expect(off.message).toMatch(/LAIKA_MICROSOFT_MEETINGS_SYNC=true/);
  });

  it('runs, and the card reads the run — a refused grant as its code', async () => {
    const ok = await syncMeetingsNow(t.db, load(s.userId), ON, PUBLIC, {
      fetch: fakeGraph(ALL, { userIds: USER_IDS }).fetchImpl,
      now: () => NOW,
    });
    expect(ok.microsoft?.meetings_sync.last_run).toMatchObject({ at: NOW, ok: true, error: null });

    resetMeetingsRun();
    const refused = await syncMeetingsNow(t.db, load(s.userId), ON, PUBLIC, {
      fetch: fakeGraph(ALL, { userIds: USER_IDS, status: { calendar: 403 } }).fetchImpl,
      now: () => NOW,
    });
    expect(refused.microsoft?.meetings_sync.last_run).toMatchObject({
      ok: false,
      error: 'graph_forbidden_grant_calendars_read',
    });
  });
});
