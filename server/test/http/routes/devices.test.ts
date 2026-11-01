import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { devices, orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /api/v1/devices` and `GET /api/v1/devices/:id` (SPEC §4.78, §6.4,
 * LAI-1045): the owner's own devices, and nobody else's — another owner's
 * device answers exactly as an id that does not exist.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let bob: { cookie: string; id: string };

interface Auth {
  cookie?: string;
  bearer?: string;
}

interface Device {
  id: string;
  display_name: string;
  device_label: string | null;
  kind: string;
  origin: string;
  status: string;
  confirmed: boolean;
  active_count: number;
  revoked_count: number;
  agents: { id: string }[];
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer') {
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId ?? '', email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function register(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ agent: { id: string }; secret: string }> {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Claude',
          harness: 'claude-code',
          grants: [],
          ...body,
        }),
      },
      { cookie },
    ),
    201,
  )) as unknown as { agent: { id: string }; secret: string };
}

async function list(auth: Auth): Promise<Device[]> {
  return (await ok(await req('/api/v1/devices', {}, auth))).data as Device[];
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
    }),
  });
  expect(setup.status).toBe(201);
  ownerCookie = cookieFrom(setup);
  bob = await join('bob@example.test', 'member');
});

afterEach(() => {
  h.close();
});

describe('GET /devices', () => {
  it('lists the caller’s devices, made by registering, one per label key', async () => {
    const a = await register(bob.cookie, { device_label: '  Belka ' });
    const b = await register(bob.cookie, { device_label: 'BELKA', harness: 'codex' });
    const c = await register(bob.cookie, { device_label: null, harness: 'cursor' });

    const mine = await list({ cookie: bob.cookie });
    expect(mine.map((d) => [d.device_label, d.display_name, d.kind, d.origin, d.status])).toEqual([
      [null, 'Unnamed device', 'local', 'imported', 'active'],
      ['belka', 'Belka', 'local', 'imported', 'active'],
    ]);
    expect(mine[1]?.agents.map((x) => x.id).sort()).toEqual([a.agent.id, b.agent.id].sort());
    expect(mine[0]?.agents.map((x) => x.id)).toEqual([c.agent.id]);
    expect(mine[1]?.active_count).toBe(2);

    // Ada has none, and sees none of Bob's.
    const text = await (await req('/api/v1/devices', {}, { cookie: ownerCookie })).text();
    expect(JSON.parse(text)).toEqual({ data: [] });
    expect(text).not.toContain(a.agent.id);
  });

  it('is read by an agent token as by its owner (agent.read_own, plan §L5)', async () => {
    const a = await register(bob.cookie, { device_label: 'Belka' });
    const viaToken = await list({ bearer: a.secret });
    expect(viaToken.map((d) => d.device_label)).toEqual(['belka']);
  });

  it('refuses an anonymous caller', async () => {
    const res = await req('/api/v1/devices');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });
});

describe('GET /devices/:id', () => {
  it('returns one of the caller’s own devices', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    const [device] = await list({ cookie: bob.cookie });
    const one = (await ok(
      await req(`/api/v1/devices/${device!.id}`, {}, { cookie: bob.cookie }),
    )) as unknown as Device;
    expect(one).toEqual(device);
  });

  it('answers another owner’s device byte for byte as an id that does not exist', async () => {
    await register(bob.cookie, { device_label: 'Cloud', expires_at: Date.now() + 60 * 60_000 });
    const foreign = h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).get();
    expect(foreign?.kind).toBe('cloud');
    const carol = await join('carol@example.test', 'admin');

    for (const auth of [{ cookie: carol.cookie }, { cookie: ownerCookie }]) {
      const hidden = await req(`/api/v1/devices/${foreign!.id}`, {}, auth);
      const absent = await req('/api/v1/devices/01M00000000000000000000000', {}, auth);
      expect(hidden.status).toBe(404);
      expect(absent.status).toBe(404);
      const hiddenText = await hidden.text();
      expect(hiddenText).toBe(await absent.text());
      expect(hiddenText).not.toContain(foreign!.id);
      expect(JSON.parse(hiddenText)).toMatchObject({ error: { code: 'not_found' } });
    }
  });
});

describe('GET /agents/devices is unchanged', () => {
  it('serves the same groups, fields and names it did before devices had rows', async () => {
    await register(bob.cookie, { device_label: ' Belka ' });
    const body = await ok(await req('/api/v1/agents/devices', {}, { cookie: bob.cookie }));
    const [group] = body.data as Record<string, unknown>[];
    expect(Object.keys(group!).sort()).toEqual(
      [
        'active_count',
        'agents',
        'device_label',
        'display_name',
        'last_seen_at',
        'recognised',
        'revoked_count',
      ].sort(),
    );
    expect(group).toMatchObject({ device_label: 'belka', display_name: 'Belka' });
    // An agent's view carries no device id: no client reads one yet.
    expect(Object.keys((group!.agents as Record<string, unknown>[])[0]!)).not.toContain(
      'device_id',
    );
  });
});
