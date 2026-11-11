import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  agents,
  analyticsViews,
  devicePairingRequests,
  devices,
  memberNotices,
  orgs,
  tokens,
  users,
} from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /people/:id/developer-setup` and the admin revokes (SPEC §3.1, §6.4,
 * D-132, D-133, D-134, LAI-1137). Acting on somebody else's credentials, so
 * the refusals are asserted by status **and** code, and the two properties
 * the read must never lose — no secret, no hidden space named — by searching
 * the response text for the stored values themselves.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let owner: { cookie: string; id: string };
let admin: { cookie: string; id: string };
let bob: { cookie: string; id: string };
let carol: { cookie: string; id: string };
let viewer: { cookie: string; id: string };

interface Auth {
  cookie?: string;
  bearer?: string;
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

/** A refusal, by status and by the code and reason only the real path gives. */
async function refused(
  res: Response,
  status: number,
  code: string,
  reason?: string,
): Promise<void> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  const body = JSON.parse(text) as { error: { code: string; details?: { reason?: string } } };
  expect(body.error.code).toBe(code);
  if (reason !== undefined) expect(body.error.details?.reason).toBe(reason);
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer') {
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const token = seedInvite(h.db, { orgId, createdBy: owner.id, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function register(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ agent: { id: string }; secret: string; token: { id: string } }> {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Claude',
          harness: 'claude-code',
          device_label: 'Belka',
          grants: [],
          ...body,
        }),
      },
      { cookie },
    ),
    201,
  )) as unknown as { agent: { id: string }; secret: string; token: { id: string } };
}

function setupPath(userId: string): string {
  return `/api/v1/people/${userId}/developer-setup`;
}

function deviceOf(agentId: string): string {
  return h.db.select().from(agents).where(eq(agents.id, agentId)).get()?.deviceId ?? '';
}

const OFF = {
  see_people_analytics: false,
  see_org_activity: false,
  open_all_projects: false,
  invite_people: false,
  deactivate_people: false,
  create_archive_projects: false,
  manage_any_tokens: false,
  change_org_settings: false,
};
const ON = Object.fromEntries(Object.keys(OFF).map((k) => [k, true]));

async function setGrants(adminGrants: Record<string, boolean>, member = OFF): Promise<void> {
  await ok(
    await req(
      '/api/v1/org/permissions',
      {
        method: 'PUT',
        body: JSON.stringify({ grants: { admin: adminGrants, member, viewer: OFF } }),
      },
      { cookie: owner.cookie },
    ),
  );
}

function looks(subjectId: string) {
  return h.db
    .select()
    .from(analyticsViews)
    .where(and(eq(analyticsViews.subjectId, subjectId), eq(analyticsViews.kind, 'developer_setup')))
    .all();
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
  owner = {
    cookie: cookieFrom(setup),
    id: h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '',
  };
  admin = await join('al@example.test', 'admin');
  bob = await join('bob@example.test', 'member');
  carol = await join('carol@example.test', 'member');
  viewer = await join('vi@example.test', 'viewer');
});

afterEach(() => {
  h.close();
});

describe('who may read a member’s setup', () => {
  it('an admin and the owner may; a member, a viewer and a token may not', async () => {
    await register(bob.cookie);
    await ok(await req(setupPath(bob.id), {}, { cookie: admin.cookie }));
    await ok(await req(setupPath(bob.id), {}, { cookie: owner.cookie }));

    await refused(await req(setupPath(bob.id), {}, { cookie: carol.cookie }), 403, 'forbidden');
    await refused(await req(setupPath(bob.id), {}, { cookie: viewer.cookie }), 403, 'forbidden');

    // An admin's own token — personal or an agent's — is refused: session only.
    const personal = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        { cookie: admin.cookie },
      ),
      201,
    )) as { secret: string };
    await refused(
      await req(setupPath(bob.id), {}, { bearer: personal.secret }),
      403,
      'forbidden',
      'session_required',
    );
    const adminAgent = await register(admin.cookie);
    await refused(
      await req(setupPath(bob.id), {}, { bearer: adminAgent.secret }),
      403,
      'forbidden',
      'session_required',
    );
    await refused(await req(setupPath(bob.id)), 401, 'unauthorized');
  });

  it('a space admin who is a member of the org is refused', async () => {
    const project = await ok(
      await req(
        '/api/v1/projects',
        { method: 'POST', body: JSON.stringify({ name: 'Sauce', slug: 'sauce', prefix: 'SAU' }) },
        { cookie: owner.cookie },
      ),
      201,
    );
    expect(project.slug).toBe('sauce');
    for (const [user, role] of [
      [carol, 'lead'],
      [bob, 'member'],
    ] as const) {
      await ok(
        await req(
          '/api/v1/projects/sauce/members',
          { method: 'POST', body: JSON.stringify({ user_id: user.id, role }) },
          { cookie: owner.cookie },
        ),
        201,
      );
    }
    await refused(await req(setupPath(bob.id), {}, { cookie: carol.cookie }), 403, 'forbidden');
  });

  it('yourself is 422 use_developer_access, and nothing is logged', async () => {
    await refused(
      await req(setupPath(admin.id), {}, { cookie: admin.cookie }),
      422,
      'unprocessable',
      'use_developer_access',
    );
    expect(looks(admin.id)).toEqual([]);
  });

  it('an unknown id is 404 to a holder and 403 to anyone else, so ids cannot be probed', async () => {
    await refused(
      await req(setupPath('01NOSUCHUSER'), {}, { cookie: admin.cookie }),
      404,
      'not_found',
    );
    await refused(
      await req(setupPath('01NOSUCHUSER'), {}, { cookie: carol.cookie }),
      403,
      'forbidden',
    );
  });

  it('withdrawing the grant from admin refuses the admin, and the owner still reads', async () => {
    await setGrants({ ...ON, manage_any_tokens: false });
    await refused(await req(setupPath(bob.id), {}, { cookie: admin.cookie }), 403, 'forbidden');
    await ok(await req(setupPath(bob.id), {}, { cookie: owner.cookie }));
  });

  it('a member granted it may read', async () => {
    await setGrants(ON, { ...OFF, manage_any_tokens: true });
    await ok(await req(setupPath(bob.id), {}, { cookie: carol.cookie }));
  });

  it('the own-only reads still answer another owner’s device and agent 404', async () => {
    const a = await register(bob.cookie);
    const deviceId = deviceOf(a.agent.id);
    await refused(
      await req(`/api/v1/devices/${deviceId}`, {}, { cookie: admin.cookie }),
      404,
      'not_found',
    );
    const agentRes = await req(`/api/v1/agents/${a.agent.id}`, {}, { cookie: admin.cookie });
    expect(agentRes.status).toBe(404);
  });
});

describe('what the read carries', () => {
  it('serves devices, tools with checks, tokens and pending pairing — and no secret or code', async () => {
    const a = await register(bob.cookie);
    const personal = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'laptop cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { secret: string; token: { id: string } };
    const pairing = (await ok(
      await req(
        '/api/v1/devices/pairing-requests',
        { method: 'POST', body: JSON.stringify({ kind: 'local', display_name: 'Strelka' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { user_code: string; pairing: { id: string } };
    expect(pairing.user_code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    const res = await req(setupPath(bob.id), {}, { cookie: admin.cookie });
    const text = await res.clone().text();
    const view = await ok(res);

    // The secrets themselves, and everything they are stored as, are nowhere.
    const stored = h.db
      .select()
      .from(devicePairingRequests)
      .where(eq(devicePairingRequests.id, pairing.pairing.id))
      .get();
    const hashes = h.db
      .select({ hash: tokens.tokenHash })
      .from(tokens)
      .where(eq(tokens.userId, bob.id))
      .all();
    expect(stored?.codeHash.length).toBeGreaterThan(10);
    expect(hashes.length).toBe(2);
    for (const needle of [
      pairing.user_code,
      pairing.user_code.replace(/-/g, ''),
      stored?.codeHash ?? 'missing',
      a.secret,
      personal.secret,
      ...hashes.map((r) => r.hash),
    ]) {
      expect(text.includes(needle), `response carries ${needle.slice(0, 8)}…`).toBe(false);
    }
    expect(text).not.toMatch(/user_code|code_hash|token_hash|claim_nonce|"secret"/);

    expect(view.user).toMatchObject({ id: bob.id, org_role: 'member', is_active: true });
    expect(view.can_revoke).toBe(true);
    const tools = view.tools as {
      id: string;
      checks: Record<string, unknown>;
      device_id: string;
    }[];
    expect(tools.map((t) => t.id)).toEqual([a.agent.id]);
    expect(Object.keys(tools[0]?.checks ?? {}).sort()).toEqual(
      [
        'credential_installed',
        'credential_used',
        'device_paired',
        'required_capabilities',
        'session_hooks',
        'tool_request',
      ].sort(),
    );
    const devicesList = view.devices as { id: string; agent_ids: string[] }[];
    expect(devicesList.map((d) => d.agent_ids)).toEqual([[a.agent.id]]);
    expect(tools[0]?.device_id).toBe(devicesList[0]?.id);
    const pending = view.pending_pairing as { id: string; display_name: string }[];
    expect(pending.map((p) => [p.id, p.display_name])).toEqual([[pairing.pairing.id, 'Strelka']]);
    const tokenLists = view.tokens as {
      personal: { id: string }[];
      tool_credentials: { id: string }[];
    };
    expect(tokenLists.personal.map((t) => t.id)).toEqual([personal.token.id]);
    expect(tokenLists.tool_credentials.map((t) => t.id)).toEqual([a.token.id]);
    expect(view.summary).toMatchObject({
      devices_active: 1,
      tools_active: 1,
      tokens_active: 2,
      tokens_inactive: 0,
      pending_pairing: 1,
    });
  });

  it('keeps revoked and expired tokens in the history', async () => {
    const minted = (await ok(
      await req(
        '/api/v1/tokens',
        {
          method: 'POST',
          body: JSON.stringify({ name: 'short', scope: 'full', expires_at: Date.now() + 60_000 }),
        },
        { cookie: bob.cookie },
      ),
      201,
    )) as { token: { id: string } };
    h.db
      .update(tokens)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(tokens.id, minted.token.id))
      .run();
    const gone = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'gone', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { token: { id: string } };
    expect(
      (await req(`/api/v1/tokens/${gone.token.id}`, { method: 'DELETE' }, { cookie: bob.cookie }))
        .status,
    ).toBe(204);

    const view = await ok(await req(setupPath(bob.id), {}, { cookie: admin.cookie }));
    const personal = (view.tokens as { personal: { id: string; revoked_at: number | null }[] })
      .personal;
    expect(personal.map((t) => t.id).sort()).toEqual([minted.token.id, gone.token.id].sort());
    expect(view.summary).toMatchObject({ tokens_active: 0, tokens_inactive: 2 });
    const activityList = view.activity as { kind: string; subject: string; by: { id: string } }[];
    expect(activityList.find((x) => x.kind === 'token_revoked')).toMatchObject({
      subject: 'gone',
      by: { id: bob.id },
    });
  });

  it('a space the reader cannot open is counted, never named — repositories, grants and pins', async () => {
    await ok(
      await req(
        '/api/v1/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'Secret Payroll',
            slug: 'secret-payroll',
            prefix: 'SEC',
            visibility: 'private',
          }),
        },
        { cookie: owner.cookie },
      ),
      201,
    );
    await ok(
      await req(
        '/api/v1/projects/secret-payroll/members',
        { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
        { cookie: owner.cookie },
      ),
      201,
    );
    const project = (await ok(
      await req('/api/v1/projects/secret-payroll', {}, { cookie: bob.cookie }),
    )) as { id: string };

    const a = await register(bob.cookie, {
      grants: [{ project_id: project.id, scope: 'full' }],
    });
    await ok(
      await req(
        '/api/v1/project-setups',
        {
          method: 'POST',
          body: JSON.stringify({
            agent_id: a.agent.id,
            project_slug: 'secret-payroll',
            template_revision: 1,
          }),
        },
        { cookie: bob.cookie },
      ),
      201,
    );
    await ok(
      await req(
        '/api/v1/tokens',
        {
          method: 'POST',
          body: JSON.stringify({ name: 'pinned', scope: 'full', project_ids: [project.id] }),
        },
        { cookie: bob.cookie },
      ),
      201,
    );

    // The admin no longer opens every space, so this private one is closed to them.
    await setGrants({ ...ON, open_all_projects: false });
    // The precondition, checked: the admin is refused the space itself.
    expect([403, 404]).toContain(
      (await req('/api/v1/projects/secret-payroll', {}, { cookie: admin.cookie })).status,
    );

    const res = await req(setupPath(bob.id), {}, { cookie: admin.cookie });
    const text = await res.clone().text();
    const view = await ok(res);
    for (const needle of [project.id, 'secret-payroll', 'Secret Payroll', 'SEC-']) {
      expect(text.includes(needle), `response names the hidden space by ${needle}`).toBe(false);
    }
    expect(view.repositories).toEqual([]);
    expect(view.summary).toMatchObject({ repositories: 0, repositories_hidden: 1 });
    const tool = (view.tools as { grants: unknown[]; grants_hidden: number }[])[0];
    expect(tool).toMatchObject({ grants: [], grants_hidden: 1 });
    const pinned = (
      view.tokens as {
        personal: { name: string; project_ids: string[]; project_ids_hidden: number }[];
      }
    ).personal.find((t) => t.name === 'pinned');
    expect(pinned).toMatchObject({ project_ids: [], project_ids_hidden: 1 });

    // The owner opens it, and is shown it.
    const asOwner = await ok(await req(setupPath(bob.id), {}, { cookie: owner.cookie }));
    expect(asOwner.summary).toMatchObject({ repositories: 1, repositories_hidden: 0 });
  });

  it('a deactivated member is still readable', async () => {
    await register(bob.cookie);
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, bob.id)).run();
    const view = await ok(await req(setupPath(bob.id), {}, { cookie: admin.cookie }));
    expect(view.user).toMatchObject({ is_active: false });
    expect(view.can_revoke).toBe(true);
  });

  it('an admin is told it cannot revoke on the owner’s setup', async () => {
    const view = await ok(await req(setupPath(owner.id), {}, { cookie: admin.cookie }));
    expect(view.can_revoke).toBe(false);
  });
});

describe('every read is a look the member sees', () => {
  it('two reads inside ten minutes write one developer_setup row, and the member lists it', async () => {
    await ok(await req(setupPath(bob.id), {}, { cookie: admin.cookie }));
    await ok(await req(setupPath(bob.id), {}, { cookie: admin.cookie }));
    expect(looks(bob.id).map((r) => [r.viewerId, r.kind, r.day])).toEqual([
      [admin.id, 'developer_setup', null],
    ]);
    // A second viewer is their own look.
    await ok(await req(setupPath(bob.id), {}, { cookie: owner.cookie }));
    expect(looks(bob.id)).toHaveLength(2);

    const mine = (await ok(await req('/api/v1/me/analytics-views', {}, { cookie: bob.cookie })))
      .data as { viewer: { id: string }; kind: string }[];
    expect(mine.map((r) => [r.viewer.id, r.kind]).sort()).toEqual(
      [
        [admin.id, 'developer_setup'],
        [owner.id, 'developer_setup'],
      ].sort(),
    );
  });

  it('a refused read writes no look', async () => {
    await req(setupPath(bob.id), {}, { cookie: carol.cookie });
    expect(looks(bob.id)).toEqual([]);
  });
});

describe('revoking a member’s tool', () => {
  function revokeTool(userId: string, agentId: string, auth: Auth) {
    return req(`/api/v1/people/${userId}/agents/${agentId}/revoke`, { method: 'POST' }, auth);
  }

  it('stops its token at once, writes token.revoked by the admin, and one notice', async () => {
    const a = await register(bob.cookie);
    await ok(await req('/api/v1/me', {}, { bearer: a.secret }));

    const tool = await ok(await revokeTool(bob.id, a.agent.id, { cookie: admin.cookie }));
    expect(tool).toMatchObject({
      id: a.agent.id,
      status: 'revoked',
      revoked_by: { id: admin.id },
    });

    // The real request, on the real credential, after the revoke.
    await refused(await req('/api/v1/me', {}, { bearer: a.secret }), 401, 'unauthorized');

    const row = h.db.select().from(agents).where(eq(agents.id, a.agent.id)).get();
    expect(row).toMatchObject({ status: 'revoked', revokedByUserId: admin.id });
    const revokedRows = h.db
      .select()
      .from(activity)
      .where(eq(activity.type, 'token.revoked'))
      .all()
      .filter((r) => r.payloadJson.includes(a.token.id));
    expect(revokedRows.map((r) => r.actorId)).toEqual([admin.id]);

    const notices = (await ok(await req('/api/v1/me/notices', {}, { cookie: bob.cookie })))
      .data as {
      kind: string;
      actor: { id: string };
      subject: string;
    }[];
    expect(notices.map((n) => [n.kind, n.actor.id, n.subject])).toEqual([
      ['tool_revoked', admin.id, 'Claude'],
    ]);

    // Again is idempotent: no second notice, no second event.
    await ok(await revokeTool(bob.id, a.agent.id, { cookie: admin.cookie }));
    expect(
      h.db.select().from(memberNotices).where(eq(memberNotices.userId, bob.id)).all(),
    ).toHaveLength(1);
    expect(
      h.db
        .select()
        .from(activity)
        .where(eq(activity.type, 'token.revoked'))
        .all()
        .filter((r) => r.payloadJson.includes(a.token.id)),
    ).toHaveLength(1);
  });

  it('leaves the member’s other tools working', async () => {
    const a = await register(bob.cookie);
    const b = await register(bob.cookie, { harness: 'codex', display_name: 'Codex' });
    await ok(await revokeTool(bob.id, a.agent.id, { cookie: admin.cookie }));
    await ok(await req('/api/v1/me', {}, { bearer: b.secret }));
  });

  it('an admin may not revoke the owner’s tool; the owner may revoke an admin’s', async () => {
    const ownersTool = await register(owner.cookie);
    await refused(
      await revokeTool(owner.id, ownersTool.agent.id, { cookie: admin.cookie }),
      403,
      'forbidden',
      'not_for_owner',
    );
    await ok(await req('/api/v1/me', {}, { bearer: ownersTool.secret }));
    expect(h.db.select().from(agents).where(eq(agents.id, ownersTool.agent.id)).get()?.status).toBe(
      'active',
    );

    const adminsTool = await register(admin.cookie);
    await ok(await revokeTool(admin.id, adminsTool.agent.id, { cookie: owner.cookie }));
    await refused(await req('/api/v1/me', {}, { bearer: adminsTool.secret }), 401, 'unauthorized');
  });

  it('refuses a member, yourself, a token, and another person’s agent under this id', async () => {
    const a = await register(bob.cookie);
    await refused(await revokeTool(bob.id, a.agent.id, { cookie: carol.cookie }), 403, 'forbidden');
    const own = await register(admin.cookie);
    await refused(
      await revokeTool(admin.id, own.agent.id, { cookie: admin.cookie }),
      422,
      'unprocessable',
      'use_developer_access',
    );
    await refused(
      await revokeTool(bob.id, a.agent.id, { bearer: own.secret }),
      403,
      'forbidden',
      'session_required',
    );
    // Carol's agent named under Bob's id: not Bob's, so no such agent.
    const carols = await register(carol.cookie);
    await refused(
      await revokeTool(bob.id, carols.agent.id, { cookie: admin.cookie }),
      404,
      'not_found',
    );
    await ok(await req('/api/v1/me', {}, { bearer: carols.secret }));
    await ok(await req('/api/v1/me', {}, { bearer: a.secret }));
    expect(h.db.select().from(memberNotices).all()).toEqual([]);
  });

  it('a deactivated member’s tool may still be revoked', async () => {
    const a = await register(bob.cookie);
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, bob.id)).run();
    await ok(await revokeTool(bob.id, a.agent.id, { cookie: admin.cookie }));
    expect(h.db.select().from(agents).where(eq(agents.id, a.agent.id)).get()?.status).toBe(
      'revoked',
    );
  });
});

describe('unpairing a member’s device', () => {
  function unpair(userId: string, deviceId: string, auth: Auth) {
    return req(`/api/v1/people/${userId}/devices/${deviceId}/revoke`, { method: 'POST' }, auth);
  }

  it('revokes the device and every tool on it, cancels its pairing, and writes one notice', async () => {
    const a = await register(bob.cookie);
    const b = await register(bob.cookie, { harness: 'codex', display_name: 'Codex' });
    const elsewhere = await register(bob.cookie, { device_label: 'Strelka' });
    const deviceId = deviceOf(a.agent.id);
    expect(deviceOf(b.agent.id)).toBe(deviceId);
    const pairing = (await ok(
      await req(
        '/api/v1/devices/pairing-requests',
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'local', display_name: 'Belka', device_id: deviceId }),
        },
        { cookie: bob.cookie },
      ),
      201,
    )) as { pairing: { id: string } };

    const out = (await ok(await unpair(bob.id, deviceId, { cookie: admin.cookie }))) as {
      device: { id: string; status: string; revoked_by: { id: string } };
      revoked_agent_ids: string[];
    };
    expect(out.device).toMatchObject({
      id: deviceId,
      status: 'revoked',
      revoked_by: { id: admin.id },
    });
    expect(out.revoked_agent_ids.sort()).toEqual([a.agent.id, b.agent.id].sort());

    for (const secret of [a.secret, b.secret]) {
      await refused(await req('/api/v1/me', {}, { bearer: secret }), 401, 'unauthorized');
    }
    await ok(await req('/api/v1/me', {}, { bearer: elsewhere.secret }));
    expect(
      h.db
        .select()
        .from(devicePairingRequests)
        .where(eq(devicePairingRequests.id, pairing.pairing.id))
        .get()?.state,
    ).toBe('cancelled');
    expect(h.db.select().from(devices).where(eq(devices.id, deviceId)).get()).toMatchObject({
      status: 'revoked',
      revokedByUserId: admin.id,
    });

    const notices = h.db.select().from(memberNotices).where(eq(memberNotices.userId, bob.id)).all();
    expect(notices.map((n) => [n.kind, n.actorUserId, n.subject])).toEqual([
      ['device_unpaired', admin.id, 'Belka'],
    ]);

    // Again changes nothing and tells nobody.
    const again = (await ok(await unpair(bob.id, deviceId, { cookie: admin.cookie }))) as {
      revoked_agent_ids: string[];
    };
    expect(again.revoked_agent_ids).toEqual([]);
    expect(
      h.db.select().from(memberNotices).where(eq(memberNotices.userId, bob.id)).all(),
    ).toHaveLength(1);

    const view = await ok(await req(setupPath(bob.id), {}, { cookie: admin.cookie }));
    const kinds = (view.activity as { kind: string; by: { id: string } | null }[]).filter(
      (x) => x.kind === 'device_unpaired' || x.kind === 'tool_revoked',
    );
    expect(kinds.map((x) => [x.kind, x.by?.id]).sort()).toEqual(
      [
        ['device_unpaired', admin.id],
        ['tool_revoked', admin.id],
        ['tool_revoked', admin.id],
      ].sort(),
    );
  });

  it('an admin may not unpair the owner’s device', async () => {
    const ownersTool = await register(owner.cookie);
    const deviceId = deviceOf(ownersTool.agent.id);
    await refused(
      await unpair(owner.id, deviceId, { cookie: admin.cookie }),
      403,
      'forbidden',
      'not_for_owner',
    );
    expect(h.db.select().from(devices).where(eq(devices.id, deviceId)).get()?.status).toBe(
      'active',
    );
    await ok(await req('/api/v1/me', {}, { bearer: ownersTool.secret }));
  });

  it('another person’s device under this id is 404, and a member is refused', async () => {
    const carols = await register(carol.cookie);
    await refused(
      await unpair(bob.id, deviceOf(carols.agent.id), { cookie: admin.cookie }),
      404,
      'not_found',
    );
    const bobs = await register(bob.cookie);
    await refused(
      await unpair(bob.id, deviceOf(bobs.agent.id), { cookie: carol.cookie }),
      403,
      'forbidden',
    );
    await ok(await req('/api/v1/me', {}, { bearer: bobs.secret }));
  });
});

describe('the admin token revoke tells the member', () => {
  it('writes a token_revoked notice for somebody else’s token, and none for your own', async () => {
    const minted = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'laptop cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { token: { id: string }; secret: string };
    expect(
      (
        await req(
          `/api/v1/users/${bob.id}/tokens/${minted.token.id}`,
          { method: 'DELETE' },
          {
            cookie: admin.cookie,
          },
        )
      ).status,
    ).toBe(204);
    await refused(await req('/api/v1/me', {}, { bearer: minted.secret }), 401, 'unauthorized');
    expect(
      h.db
        .select()
        .from(memberNotices)
        .where(eq(memberNotices.userId, bob.id))
        .all()
        .map((n) => [n.kind, n.actorUserId, n.subject]),
    ).toEqual([['token_revoked', admin.id, 'laptop cli']]);

    // Twice is one notice — and still `204`: §6.4's DELETE is idempotent.
    expect(
      (
        await req(
          `/api/v1/users/${bob.id}/tokens/${minted.token.id}`,
          { method: 'DELETE' },
          {
            cookie: admin.cookie,
          },
        )
      ).status,
    ).toBe(204);
    expect(
      h.db.select().from(memberNotices).where(eq(memberNotices.userId, bob.id)).all(),
    ).toHaveLength(1);

    const own = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'mine', scope: 'full' }) },
        { cookie: admin.cookie },
      ),
      201,
    )) as { token: { id: string } };
    // Their own, through the admin path: it happens, and writes no notice.
    expect(
      (
        await req(
          `/api/v1/users/${admin.id}/tokens/${own.token.id}`,
          { method: 'DELETE' },
          {
            cookie: admin.cookie,
          },
        )
      ).status,
    ).toBe(204);
    expect(
      h.db.select().from(memberNotices).where(eq(memberNotices.userId, admin.id)).all(),
    ).toEqual([]);
  });
});
