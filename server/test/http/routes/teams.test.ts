import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import { orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';
import { fakeTeams, type FakeTeams, TEAMS_URL } from '../../helpers/fake-teams.ts';

/**
 * `/api/v1/org/teams` and `/api/v1/projects/:slug/teams*` (§6.4, D-154,
 * LAI-1314).
 *
 * The services own the rules; this is that the routes are mounted, that a
 * signed-in owner or admin — never a token — is required, that the address
 * never comes back in a response or goes into the log, and that the test
 * post spends its own bucket. Teams is a fake behind an injected `fetch`:
 * **no test calls a real one**.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let fake: FakeTeams;
let cookie: string;
let ownerId: string;

beforeEach(async () => {
  fake = fakeTeams();
  h = authHarness({ teams: { fetchImpl: (input, init) => fake.fetchImpl(input, init) } });
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

  const created = await call('POST', '/api/v1/projects', {
    name: 'Murphy',
    slug: 'murphy',
    prefix: 'MUR',
  });
  expect(created.status, await created.clone().text()).toBe(201);
});
afterEach(() => {
  h.close();
});

async function join(email: string, orgRole: 'admin' | 'member'): Promise<string> {
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
    h.app.request(path, {
      method,
      headers: jsonHeaders(headers),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

const CHANNEL = '/api/v1/projects/murphy/teams';

describe('who may', () => {
  it('is mounted, and reads as off with no channel for the owner', async () => {
    const org = await call('GET', '/api/v1/org/teams');
    expect(org.status).toBe(200);
    expect(await org.json()).toMatchObject({ posting_enabled: false, channels: [] });

    const space = await call('GET', CHANNEL);
    expect(space.status).toBe(200);
    expect(await space.json()).toEqual({ posting_enabled: false, channel: null, recent: [] });
  });

  it('answers 401 signed out', async () => {
    expect((await call('GET', '/api/v1/org/teams', undefined, {})).status).toBe(401);
    expect((await call('GET', CHANNEL, undefined, {})).status).toBe(401);
  });

  it('answers 403 to a member, on every Teams route, and calls nobody', async () => {
    const member = await join('member@example.test', 'member');
    for (const [method, path, body] of [
      ['GET', '/api/v1/org/teams', undefined],
      ['PUT', '/api/v1/org/teams', { posting_enabled: true }],
      ['GET', CHANNEL, undefined],
      ['PUT', CHANNEL, { webhook_url: TEAMS_URL }],
      ['DELETE', CHANNEL, undefined],
      ['POST', `${CHANNEL}/test`, undefined],
    ] as const) {
      const res = await call(method, path, body, { Cookie: member });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(fake.requests).toEqual([]);
  });

  it('lets an admin, signed in', async () => {
    const admin = await join('admin@example.test', 'admin');
    const res = await call(
      'PUT',
      '/api/v1/org/teams',
      { posting_enabled: true },
      { Cookie: admin },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ posting_enabled: true });
  });

  it('refuses the owner’s own token: a signed-in session only', async () => {
    const minted = await call('POST', '/api/v1/tokens', { name: 'An agent', scope: 'full' });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    const res = await call(
      'PUT',
      CHANNEL,
      { webhook_url: TEAMS_URL },
      { Authorization: `Bearer ${secret}` },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { details: unknown } }).error.details).toEqual({
      action: 'org.teams.configure',
      reason: 'session_required',
    });
  });
});

describe('a space’s channel', () => {
  it('is set, never answered or logged, tested while off, and cleared', async () => {
    const set = await call('PUT', CHANNEL, { webhook_url: TEAMS_URL });
    expect(set.status, await set.clone().text()).toBe(200);
    const text = await set.text();
    // A positive control: what is meant to be shown, is.
    expect(text).toContain(TEAMS_URL.slice(-4));
    expect(text).toContain('environment.api.powerplatform.com');
    expect(text).not.toContain('sig=');

    const tested = await call('POST', `${CHANNEL}/test`);
    expect(tested.status).toBe(200);
    expect(await tested.json()).toMatchObject({ kind: 'test', outcome: 'sent', http_status: 202 });
    expect(fake.requests.map((r) => r.url)).toEqual([TEAMS_URL]);
    expect(fake.texts()[0]).toContain('Laika is connected to this channel — Murphy (MUR)');

    const read = await (await call('GET', '/api/v1/org/teams')).text();
    expect(read).not.toContain('sig=');
    expect(JSON.parse(read)).toMatchObject({
      posting_enabled: false,
      channels: [{ project_slug: 'murphy', last_post: { kind: 'test', outcome: 'sent' } }],
    });

    const logged = JSON.stringify(h.log.records);
    expect(logged).toContain('/api/v1/projects/murphy/teams');
    expect(logged).not.toContain('sig=');

    expect((await call('DELETE', CHANNEL)).status).toBe(204);
    expect(await (await call('GET', CHANNEL)).json()).toMatchObject({ channel: null });
  });

  it('answers 422 with the field and the reason for an address that is not a webhook', async () => {
    const res = await call('PUT', CHANNEL, { webhook_url: 'http://example.test/hook' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { details: unknown } }).error.details).toEqual({
      field: 'webhook_url',
      reason: 'webhook_url_not_https',
    });
  });

  it('answers 409 teams_no_channel to a test with no channel', async () => {
    const res = await call('POST', `${CHANNEL}/test`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { details: unknown } }).error.details).toEqual({
      reason: 'teams_no_channel',
    });
  });

  it('answers 404 for a space that does not exist', async () => {
    expect((await call('GET', '/api/v1/projects/nope/teams')).status).toBe(404);
  });
});

describe('the switch', () => {
  it('refuses a body that is not a boolean', async () => {
    const res = await call('PUT', '/api/v1/org/teams', { posting_enabled: 'yes' });
    expect([400, 422]).toContain(res.status);
    expect((await call('GET', '/api/v1/org/teams')).status).toBe(200);
  });
});

describe('the test post’s bucket', () => {
  it('is its own, per person, and a GET or another path never spends it', () => {
    const who = { userId: 'u1', tokenId: null };
    expect(classify('/api/v1/projects/murphy/teams/test', who, 'POST')).toEqual({
      key: 'teams-test:u1',
      policy: LIMITS.teamsTest,
    });
    expect(classify('/api/v1/projects/murphy/teams/test', who, 'GET').key).not.toMatch(
      /^teams-test/,
    );
    expect(classify('/api/v1/projects/murphy/teams', who, 'PUT').key).not.toMatch(/^teams-test/);
  });
});
