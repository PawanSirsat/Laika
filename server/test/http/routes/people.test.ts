import { gunzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /api/v1/people/:id/activity` over HTTP (SPEC §6.4, D-079, LAI-751).
 *
 * The door, with status, code and `details` for each caller: an owner and an
 * admin on a session pass; a member, a viewer and every token do not — the
 * token told `session_required`, the member only `forbidden`.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let orgId: string;
let ownerId: string;
let admin: { cookie: string; id: string };
let member: { cookie: string; id: string };

async function req(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const credential =
    auth === undefined
      ? {}
      : auth.startsWith('lai_')
        ? { Authorization: `Bearer ${auth}` }
        : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function errorOf(res: Response): Promise<{ code: string; details: unknown }> {
  return ((await res.json()) as { error: { code: string; details: unknown } }).error;
}

async function join(
  email: string,
  orgRole: 'admin' | 'member',
): Promise<{ cookie: string; id: string }> {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function mint(cookie: string): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Claude Code', scope: 'full' }) },
    cookie,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
}

beforeEach(async () => {
  h = authHarness();
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  ownerCookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  admin = await join('ari@example.test', 'admin');
  member = await join('bea@example.test', 'member');
});

afterEach(() => {
  h.close();
});

describe('GET /people/:id/activity', () => {
  it('answers an owner and an admin with the contract shape, twelve weeks by default', async () => {
    for (const who of [ownerCookie, admin.cookie]) {
      const res = await req(`/api/v1/people/${member.id}/activity`, {}, who);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as Record<string, unknown> & {
        series: Record<string, unknown[] | null>;
      };
      expect(Object.keys(body).sort()).toEqual(
        ['agents', 'end', 'prompts_by_agent', 'range', 'series', 'sharing', 'start', 'tz'].sort(),
      );
      expect(body).toMatchObject({
        range: '12w',
        tz: 'UTC',
        sharing: { org_enabled: false, enabled: false },
        prompts_by_agent: {},
        agents: [],
      });
      expect(Object.keys(body.series).sort()).toEqual(
        ['board_agent', 'board_self', 'github', 'local_commits', 'prompts', 'sessions'].sort(),
      );
      expect(body.series.board_self).toHaveLength(84);
      expect(body.series.github).toBeNull();
    }
  });

  it('answers a year for range=52w', async () => {
    const res = await req(`/api/v1/people/${member.id}/activity?range=52w`, {}, ownerCookie);
    const body = (await res.json()) as { series: { board_agent: number[] } };
    expect(body.series.board_agent).toHaveLength(364);
  });

  it('401s nobody', async () => {
    expect((await req(`/api/v1/people/${member.id}/activity`)).status).toBe(401);
  });

  it('403s a member, forbidden by profile.activity.read', async () => {
    const res = await req(`/api/v1/people/${admin.id}/activity`, {}, member.cookie);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toEqual({
      code: 'forbidden',
      message: expect.any(String) as string,
      details: { action: 'profile.activity.read' },
    });
  });

  it('403s an owner’s token with session_required — no agent reads the heatmap', async () => {
    const res = await req(`/api/v1/people/${member.id}/activity`, {}, await mint(ownerCookie));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).details).toEqual({
      action: 'profile.activity.read',
      reason: 'session_required',
    });
  });

  it('404s an unknown person to an admin, and still 403s a member asking the same', async () => {
    const res = await req('/api/v1/people/nobody/activity', {}, admin.cookie);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
    expect((await req('/api/v1/people/nobody/activity', {}, member.cookie)).status).toBe(403);
  });

  it('422s a range that is not 12w or 52w, and an unknown parameter', async () => {
    for (const query of ['range=1y', 'range=12w&weeks=3']) {
      const res = await req(`/api/v1/people/${member.id}/activity?${query}`, {}, ownerCookie);
      expect(res.status, query).toBe(422);
      expect((await errorOf(res)).code).toBe('unprocessable');
    }
  });

  it('is gzipped for a client that accepts it', async () => {
    const res = await req(
      `/api/v1/people/${member.id}/activity?range=52w`,
      { headers: { 'Accept-Encoding': 'gzip' } },
      ownerCookie,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Encoding')).toBe('gzip');
    const body = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')) as {
      range: string;
    };
    expect(body.range).toBe('52w');
  });
});
