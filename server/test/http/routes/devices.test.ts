import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backfillAgentDevices } from '../../../src/db/backfill.ts';
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

describe('PATCH /devices/:id (LAI-1095)', () => {
  interface Agent {
    id: string;
    display_name: string;
    device_label: string | null;
    status: string;
    tokens: { name: string }[];
  }
  type Named = Omit<Device, 'agents'> & { agents: Agent[] };

  function rename(id: string, body: unknown, auth: Auth = { cookie: bob.cookie }) {
    return req(`/api/v1/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, auth);
  }

  async function refusal(res: Response, status: number) {
    expect(res.status, await res.clone().text()).toBe(status);
    const body = (await res.json()) as { error: { code: string; details?: { reason?: string } } };
    return { code: body.error.code, reason: body.error.details?.reason };
  }

  async function deviceNamed(key: string | null): Promise<Named> {
    const found = (await list({ cookie: bob.cookie })).find((d) => d.device_label === key);
    expect(found, `no device ${String(key)}`).toBeDefined();
    return found as Named;
  }

  it('renames the device and every agent on it, revoked ones too; a default tool name follows', async () => {
    const claude = await register(bob.cookie, {
      device_label: ' Belka ',
      display_name: 'Claude Code · Belka',
    });
    const codex = await register(bob.cookie, {
      device_label: 'belka',
      harness: 'codex',
      display_name: 'My own codex',
    });
    const cursor = await register(bob.cookie, {
      device_label: 'Belka',
      harness: 'cursor',
      display_name: 'cursor · BELKA',
    });
    await ok(
      await req(
        `/api/v1/agents/${cursor.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );
    const before = await deviceNamed('belka');

    const renamed = (await ok(
      await rename(before.id, { display_name: '  Strelka  ' }),
    )) as unknown as Named;

    expect(renamed).toMatchObject({
      id: before.id,
      display_name: 'Strelka',
      device_label: 'strelka',
      status: 'active',
      active_count: 2,
      revoked_count: 1,
    });
    expect(renamed).toEqual(await deviceNamed('strelka'));
    const byId = new Map(renamed.agents.map((a) => [a.id, a]));
    expect(renamed.agents.map((a) => a.device_label)).toEqual(['Strelka', 'Strelka', 'Strelka']);
    // `<tool> · <old name>` follows, in any case; a name the owner chose stays.
    expect(byId.get(claude.agent.id)?.display_name).toBe('Claude Code · Strelka');
    expect(byId.get(claude.agent.id)?.tokens.map((t) => t.name)).toEqual(['Claude Code · Strelka']);
    expect(byId.get(codex.agent.id)?.display_name).toBe('My own codex');
    expect(byId.get(codex.agent.id)?.tokens.map((t) => t.name)).toEqual(['My own codex']);
    expect(byId.get(cursor.agent.id)).toMatchObject({
      status: 'revoked',
      display_name: 'cursor · Strelka',
    });

    // The legacy grouping follows the label, and the boot backfill finds
    // nothing stale to move back.
    const legacy = await ok(await req('/api/v1/agents/devices', {}, { cookie: bob.cookie }));
    const groups = legacy.data as { device_label: string }[];
    expect(groups.map((g) => g.device_label)).toEqual(['strelka']);
    expect(backfillAgentDevices(h.db)).toBe(0);
    expect((await list({ cookie: bob.cookie })).map((d) => d.device_label)).toEqual(['strelka']);

    // The old name is free: a tool registered with it makes a device of its own.
    await register(bob.cookie, { device_label: 'Belka' });
    expect((await list({ cookie: bob.cookie })).map((d) => d.device_label)).toEqual([
      'belka',
      'strelka',
    ]);
  });

  it('changes only the case of a name, and a no-op answers the device unchanged', async () => {
    await register(bob.cookie, { device_label: 'belka' });
    const device = await deviceNamed('belka');
    const shouted = (await ok(
      await rename(device.id, { display_name: 'BELKA' }),
    )) as unknown as Named;
    expect(shouted).toMatchObject({ id: device.id, display_name: 'BELKA', device_label: 'belka' });
    expect(shouted.agents[0]?.device_label).toBe('BELKA');
    expect(await ok(await rename(device.id, { display_name: 'BELKA' }))).toEqual(shouted);
  });

  it('names the unnamed device', async () => {
    const plain = await register(bob.cookie, { device_label: null });
    const unnamed = await deviceNamed(null);
    const named = (await ok(
      await rename(unnamed.id, { display_name: 'Laika' }),
    )) as unknown as Named;
    expect(named).toMatchObject({ display_name: 'Laika', device_label: 'laika' });
    expect(named.agents.map((a) => [a.id, a.device_label])).toEqual([[plain.agent.id, 'Laika']]);
  });

  it('refuses a name another active device of yours holds, in any case or spacing', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    await register(bob.cookie, { device_label: 'Strelka' });
    const strelka = await deviceNamed('strelka');
    expect(await refusal(await rename(strelka.id, { display_name: ' BELKA ' }), 409)).toEqual({
      code: 'conflict',
      reason: 'device_name_taken',
    });
    expect((await deviceNamed('strelka')).display_name).toBe('Strelka');
  });

  it('refuses a name of no characters or more than 80, and an unknown field', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    const belka = await deviceNamed('belka');
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      expect(await refusal(await rename(belka.id, { display_name: name }), 422)).toEqual({
        code: 'unprocessable',
        reason: 'invalid_device_name',
      });
    }
    expect(await ok(await rename(belka.id, { display_name: 'x'.repeat(80) }))).toMatchObject({
      display_name: 'x'.repeat(80),
    });
    const extra = await rename(belka.id, { display_name: 'Ok', kind: 'cloud' });
    expect(extra.status).toBe(422);
  });

  it('refuses a revoked device', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    const belka = await deviceNamed('belka');
    h.db
      .update(devices)
      .set({ status: 'revoked', revokedAt: Date.now() })
      .where(eq(devices.id, belka.id))
      .run();
    expect(await refusal(await rename(belka.id, { display_name: 'Strelka' }), 409)).toEqual({
      code: 'conflict',
      reason: 'device_revoked',
    });
  });

  it('answers another owner’s device as an id that does not exist, and changes nothing', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    const belka = await deviceNamed('belka');
    const hidden = await rename(belka.id, { display_name: 'Mine' }, { cookie: ownerCookie });
    const absent = await rename(
      '01M00000000000000000000000',
      { display_name: 'Mine' },
      {
        cookie: ownerCookie,
      },
    );
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await absent.text());
    expect((await deviceNamed('belka')).display_name).toBe('Belka');
  });

  it('is session only: an agent’s own token cannot rename its device', async () => {
    const a = await register(bob.cookie, { device_label: 'Belka' });
    const belka = await deviceNamed('belka');
    expect(
      await refusal(await rename(belka.id, { display_name: 'Strelka' }, { bearer: a.secret }), 403),
    ).toEqual({ code: 'forbidden', reason: 'session_required' });
    expect((await req(`/api/v1/devices/${belka.id}`, { method: 'PATCH' })).status).toBe(401);
  });

  it('keeps a confirmation made by label under the new label', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    await ok(
      await req(
        '/api/v1/agents/devices/confirm',
        { method: 'POST', body: JSON.stringify({ device_label: 'belka' }) },
        { cookie: bob.cookie },
      ),
    );
    const belka = await deviceNamed('belka');
    expect(belka.confirmed).toBe(true);
    const renamed = await ok(await rename(belka.id, { display_name: 'Strelka' }));
    expect(renamed).toMatchObject({ confirmed: true, device_label: 'strelka' });
    expect(renamed.confirmed_at).not.toBeNull();
    const legacy = await ok(await req('/api/v1/agents/devices', {}, { cookie: bob.cookie }));
    expect(legacy.data).toMatchObject([{ device_label: 'strelka', recognised: true }]);
  });

  it('renames onto Cloud only when every live token on it meets the cloud rule', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    const belka = await deviceNamed('belka');
    expect(await refusal(await rename(belka.id, { display_name: 'cloud' }), 422)).toEqual({
      code: 'unprocessable',
      reason: 'cloud_token_expiry_required',
    });
    expect((await deviceNamed('belka')).display_name).toBe('Belka');

    await register(bob.cookie, { device_label: 'Runner', expires_at: Date.now() + 60 * 60_000 });
    const runner = await deviceNamed('runner');
    expect(await ok(await rename(runner.id, { display_name: 'Cloud' }))).toMatchObject({
      display_name: 'Cloud',
      device_label: 'cloud',
    });
  });

  it('carries the new name into a live pairing request for the device', async () => {
    await register(bob.cookie, { device_label: 'Belka' });
    const belka = await deviceNamed('belka');
    const created = (await ok(
      await req(
        '/api/v1/devices/pairing-requests',
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'local', display_name: 'ignored', device_id: belka.id }),
        },
        { cookie: bob.cookie },
      ),
      201,
    )) as { pairing: { id: string; display_name: string } };
    expect(created.pairing.display_name).toBe('Belka');
    await ok(await rename(belka.id, { display_name: 'Strelka' }));
    const pairing = await ok(
      await req(
        `/api/v1/devices/pairing-requests/${created.pairing.id}`,
        {},
        { cookie: bob.cookie },
      ),
    );
    expect(pairing.display_name).toBe('Strelka');
  });
});
