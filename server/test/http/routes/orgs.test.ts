import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /api/v1/org` (SPEC §6.4, LAI-222).
 *
 * The service owns which fields are safe at which grade; what is left here is
 * transport — that it is **mounted**, that it answers `401` signed out, and that
 * the field gate survives serialisation.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let ownerId: string;

interface OrgBody {
  id: string;
  name: string;
  presence_enabled: boolean;
  created_at: number;
  updated_at: number;
  ai?: { configured: boolean; provider: string | null; key_last4: string | null };
}

beforeEach(async () => {
  h = authHarness();
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
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
});
afterEach(() => {
  h.close();
});

async function getOrgAs(useCookie = cookie): Promise<Response> {
  return h.app.request('/api/v1/org', { headers: jsonHeaders({ Cookie: useCookie }) });
}

describe('GET /api/v1/org', () => {
  it('is mounted, not merely written', async () => {
    // LAI-222 was filed because §6.4 lists this and `app.ts` mounted no org
    // router at all — the probe that found it got a 404.
    const res = await getOrgAs();

    expect(res.status).toBe(200);
    expect(((await res.json()) as OrgBody).name).toBe('Kvell Dynamics');
  });

  it('answers 401 when signed out', async () => {
    const res = await h.app.request('/api/v1/org', { headers: jsonHeaders() });

    expect(res.status).toBe(401);
  });

  it('serialises the provider block for the Owner', async () => {
    h.db
      .update(orgs)
      .set({ aiProvider: 'anthropic', aiApiKeyEnc: 'ciphertext' })
      .where(eq(orgs.ownerUserId, ownerId))
      .run();

    const body = (await (await getOrgAs()).json()) as OrgBody;

    expect(body.ai?.configured).toBe(true);
    expect(body.ai?.provider).toBe('anthropic');
  });

  it('omits the key from the wire, not just from the type', async () => {
    h.db
      .update(orgs)
      .set({ aiProvider: 'anthropic', aiApiKeyEnc: 'ciphertext', smtpJsonEnc: 'smtp-secret' })
      .where(eq(orgs.ownerUserId, ownerId))
      .run();

    // Read the response text rather than the parsed object: a field the type
    // does not declare still travels if the service puts it there.
    const text = await (await getOrgAs()).text();

    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('smtp-secret');
  });

  it('answers 405 with Allow: GET on a write to the same path (D-021)', async () => {
    const res = await h.app.request('/api/v1/org', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'Renamed' }),
    });

    // The path exists and only one method is allowed on it. Renaming an org is a
    // settings write and has no task; `405` says "not this way", where `404`
    // would say "no such thing".
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });
});

/**
 * Setting the LLM provider (§4.2, §6.4, §12, LAI-447).
 *
 * The key is **write-only**: accepted here and returned by nothing. Every
 * assertion about that is made against the whole response body rather than
 * against the fields somebody remembered to exclude — LAI-206's shape, and the
 * only version that survives a field being added later.
 */
describe('PATCH /api/v1/org — the AI provider', () => {
  const KEY = 'sk-ant-secret-value-nobody-should-ever-see-9999';

  async function patch(body: unknown, useCookie = cookie): Promise<Response> {
    return h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders({ Cookie: useCookie }),
      body: JSON.stringify(body),
    });
  }

  async function setAnthropicKey(): Promise<Response> {
    const res = await patch({ ai_provider: 'anthropic', ai_api_key: KEY });
    expect(res.status, await res.clone().text()).toBe(200);
    return res;
  }

  it('stores the provider and reports it as configured', async () => {
    const body = (await (await setAnthropicKey()).json()) as OrgBody;

    expect(body.ai?.configured).toBe(true);
    expect(body.ai?.provider).toBe('anthropic');
  });

  it('reports the last four, from the stored column rather than by decrypting', async () => {
    await setAnthropicKey();

    const body = (await (await getOrgAs()).json()) as OrgBody;

    expect(body.ai?.key_last4).toBe('9999');
    // Stored at write time: the row carries it, so no read path needs the key.
    expect(h.db.select().from(orgs).get()?.aiKeyLast4).toBe('9999');
  });

  it('encrypts the key at rest — the row holds no plaintext', async () => {
    await setAnthropicKey();

    const row = h.db.select().from(orgs).get();

    expect(row?.aiApiKeyEnc).not.toBeNull();
    expect(row?.aiApiKeyEnc).not.toContain(KEY);
    // §12's format, so a future scheme is distinguishable (LAI-161).
    expect(row?.aiApiKeyEnc).toMatch(/^v1\./);
  });

  it('never returns the key, at any grade or on any response', async () => {
    // **AC3 and AC8's first third.** Asserted of the whole body, on the write
    // that sets it and on every later read, because the response that leaks a
    // secret is usually the one nobody thought produced it.
    const written = await (await setAnthropicKey()).text();
    const read = await (await getOrgAs()).text();

    for (const [label, body] of [
      ['the PATCH response', written],
      ['the GET response', read],
    ] as const) {
      expect(body, label).not.toContain(KEY);
      expect(body, label).not.toContain('sk-ant');
      // Nor the ciphertext: it is not a secret, and it is also not the org's
      // business to hand out.
      expect(body, label).not.toContain('v1.');
      expect(body, label).not.toMatch(/ai_api_key|_enc/);
    }
  });

  it('writes no activity row containing the key', async () => {
    // **AC8's second third.** `updateOrg` writes no activity row today — §4.8
    // has no verb for an org settings change — so this asserts the property
    // rather than the absence: if one is ever added, it must not carry the key.
    await setAnthropicKey();

    const rows = h.db.select().from(activity).all();

    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(KEY);
    }
  });

  it('writes no log line containing the key', async () => {
    // **AC8's last third.** §13.2 logs method, path and status for every
    // request; a body-logging change would put this key in stdout.
    await setAnthropicKey();

    expect(JSON.stringify(h.log.records)).not.toContain(KEY);
  });

  it('refuses to encrypt under an empty server secret', async () => {
    // `serverSecret` is optional on `createApp` so the LAI-002 HTTP tests can
    // build an app without one. Storing ciphertext under `''` would "work" and
    // be unrecoverable, so the route refuses instead — the guard the option's
    // own comment promises.
    const bare = authHarness({ serverSecret: '' });
    try {
      const setup = await bare.app.request('/api/v1/setup', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          org_name: 'Bare',
          owner_name: 'Ada',
          owner_email: 'ada@example.test',
          owner_password: PASSWORD,
        }),
      });
      const bareCookie = cookieFrom(setup);

      const res = await bare.app.request('/api/v1/org', {
        method: 'PATCH',
        headers: jsonHeaders({ Cookie: bareCookie }),
        body: JSON.stringify({ ai_provider: 'anthropic', ai_api_key: KEY }),
      });

      expect(res.status).toBe(500);
      expect(bare.db.select().from(orgs).get()?.aiApiKeyEnc).toBeNull();
    } finally {
      bare.close();
    }
  });
});

describe('PATCH /api/v1/org (LAI-207)', () => {
  async function patch(body: unknown): Promise<Response> {
    return h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify(body),
    });
  }

  it('turns presence off and reports the new value', async () => {
    const res = await patch({ presence_enabled: false });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as OrgBody).presence_enabled).toBe(false);
  });

  it('refuses an unknown key rather than discarding it', async () => {
    // The failure LAI-106 deleted the first-boot toggle to avoid: a control that
    // appears to save and does not.
    expect((await patch({ track_presence: false })).status).toBe(422);
  });

  it('refuses a patch that asks for nothing', async () => {
    expect((await patch({})).status).toBe(400);
  });

  it('403s an owner’s token turning Developer insights on: a web session only (LAI-751 review)', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'An agent', scope: 'full' }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    const res = await h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
      body: JSON.stringify({ developer_insights: true }),
    });
    expect(res.status).toBe(403);
    expect(
      ((await res.json()) as { error: { code: string; details: unknown } }).error,
    ).toMatchObject({
      code: 'forbidden',
      details: { action: 'org.developer_insights.set', reason: 'session_required' },
    });
    expect(h.db.select({ on: orgs.developerInsights }).from(orgs).get()?.on).toBe(0);

    // The owner, signed in, may.
    expect((await patch({ developer_insights: true })).status).toBe(200);
    expect(h.db.select({ on: orgs.developerInsights }).from(orgs).get()?.on).toBe(1);
  });

  it('401s when signed out', async () => {
    const res = await h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ presence_enabled: false }),
    });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/org { name } — renaming the organisation (LAI-984, D-104 item 7)', () => {
  async function patchAs(body: unknown, who = cookie): Promise<Response> {
    return h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders({ Cookie: who }),
      body: JSON.stringify(body),
    });
  }

  async function errorOf(res: Response): Promise<{ code: string; details?: unknown }> {
    return ((await res.json()) as { error: { code: string; details?: unknown } }).error;
  }

  async function joinAs(email: string, orgRole: 'admin' | 'member'): Promise<string> {
    const orgId = h.db.select().from(orgs).get()?.id ?? '';
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
    const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
    expect(res.status, await res.clone().text()).toBe(200);
    return cookieFrom(res);
  }

  it('renames it, trimmed, and every reader sees the new name', async () => {
    const res = await patchAs({ name: '  Kvell Labs  ' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as OrgBody).name).toBe('Kvell Labs');

    expect(h.db.select({ name: orgs.name }).from(orgs).get()?.name).toBe('Kvell Labs');
    expect(((await (await getOrgAs()).json()) as OrgBody).name).toBe('Kvell Labs');
  });

  it('takes 1 to 80 characters and refuses an empty, blank or longer name with 422', async () => {
    expect((await patchAs({ name: 'K' })).status).toBe(200);
    expect((await patchAs({ name: 'x'.repeat(80) })).status).toBe(200);

    for (const name of ['', '   ', 'x'.repeat(81), 42, null]) {
      const res = await patchAs({ name });
      expect(res.status, JSON.stringify(name)).toBe(422);
      expect((await errorOf(res)).code).toBe('unprocessable');
    }
    expect(h.db.select({ name: orgs.name }).from(orgs).get()?.name).toBe('x'.repeat(80));
  });

  it('an admin may rename it — Change organisation settings — and a member is refused 403', async () => {
    const admin = await joinAs('ari@example.test', 'admin');
    expect((await patchAs({ name: 'By the admin' }, admin)).status).toBe(200);

    const member = await joinAs('bea@example.test', 'member');
    const refused = await patchAs({ name: 'By the member' }, member);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toMatchObject({
      code: 'forbidden',
      details: { action: 'org.settings.edit' },
    });
    expect(h.db.select({ name: orgs.name }).from(orgs).get()?.name).toBe('By the admin');
  });

  it('an admin whose role lost Change organisation settings is refused', async () => {
    const admin = await joinAs('ari@example.test', 'admin');
    const revoked = await h.app.request('/api/v1/org/permissions', {
      method: 'GET',
      headers: jsonHeaders({ Cookie: cookie }),
    });
    const matrix = (await revoked.json()) as { grants: Record<string, Record<string, boolean>> };
    const grants = {
      ...matrix.grants,
      admin: { ...matrix.grants.admin, change_org_settings: false },
    };
    const put = await h.app.request('/api/v1/org/permissions', {
      method: 'PUT',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ grants }),
    });
    expect(put.status, await put.clone().text()).toBe(200);

    const res = await patchAs({ name: 'Nope' }, admin);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('forbidden');
  });

  it('a request refused by another setting beside it leaves the name alone', async () => {
    // openai_compatible without a base URL is refused (§12) — after the name
    // would have been written, were the two not one transaction.
    const res = await patchAs({ name: 'Half done', ai_provider: 'openai_compatible' });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('unprocessable');
    expect(h.db.select({ name: orgs.name }).from(orgs).get()?.name).toBe('Kvell Dynamics');
  });

  it('401s when signed out', async () => {
    const res = await h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Anyone' }),
    });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
  });
});

/**
 * Exactly one owner, and the way it changes hands (D-104 item 2, LAI-982).
 * The service drives each refusal; this is that the routes exist, that the
 * codes reach the wire, and that a real session — not a token — is required.
 */
describe('one owner and transfer ownership (LAI-982)', () => {
  interface ErrorBody {
    error: { code: string; details: { reason?: string; action?: string } | null };
  }

  async function join(
    email: string,
    orgRole: 'admin' | 'member',
  ): Promise<{ id: string; cookie: string }> {
    const orgId = h.db.select().from(orgs).get()!.id;
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
    const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
    expect(res.status, await res.clone().text()).toBe(200);
    return {
      id: h.db.select().from(users).where(eq(users.email, email)).get()!.id,
      cookie: cookieFrom(res),
    };
  }

  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    return h.app.request(path, {
      method: 'POST',
      headers: jsonHeaders(headers),
      body: JSON.stringify(body),
    });
  }

  it('hands the organisation over, and the new owner is the one GET /org answers as owner', async () => {
    const grace = await join('grace@example.test', 'admin');

    const res = await post(
      '/api/v1/org/transfer-ownership',
      { user_id: grace.id, confirm: 'grace@example.test' },
      { Cookie: cookie },
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      owner: { id: string; org_role: string };
      previous_owner: { id: string; org_role: string };
    };
    expect(body.owner).toMatchObject({ id: grace.id, org_role: 'owner' });
    expect(body.previous_owner).toMatchObject({ id: ownerId, org_role: 'admin' });
    expect(h.db.select().from(orgs).get()?.ownerUserId).toBe(grace.id);
    expect(
      h.db
        .select()
        .from(activity)
        .all()
        .filter((r) => r.type === 'org.ownership_transferred'),
    ).toHaveLength(1);

    // The new owner reads the owner's field; the former owner, now an admin, does not.
    const asGrace = (await (await getOrgAs(grace.cookie)).json()) as { extra_owners?: unknown };
    expect(asGrace.extra_owners).toEqual([]);
    const asAda = (await (await getOrgAs()).json()) as { extra_owners?: unknown };
    expect('extra_owners' in asAda).toBe(false);

    // And the former owner can no longer transfer it back.
    const again = await post(
      '/api/v1/org/transfer-ownership',
      { user_id: ownerId, confirm: 'ada@example.test' },
      { Cookie: cookie },
    );
    expect(again.status).toBe(403);
    expect(((await again.json()) as ErrorBody).error.code).toBe('forbidden');
  });

  it('422s a wrong confirmation with its reason, and moves nothing', async () => {
    const grace = await join('grace@example.test', 'member');

    const res = await post(
      '/api/v1/org/transfer-ownership',
      { user_id: grace.id, confirm: 'not-her@example.test' },
      { Cookie: cookie },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'confirm_mismatch' },
    });
    expect(h.db.select().from(orgs).get()?.ownerUserId).toBe(ownerId);
  });

  it('403s the owner’s own token: session only', async () => {
    const grace = await join('grace@example.test', 'admin');
    const minted = await post(
      '/api/v1/tokens',
      { name: 'An agent', scope: 'full' },
      { Cookie: cookie },
    );
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    const res = await post(
      '/api/v1/org/transfer-ownership',
      { user_id: grace.id, confirm: 'grace@example.test' },
      { Authorization: `Bearer ${secret}` },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({
      code: 'forbidden',
      details: { action: 'org.transfer_ownership', reason: 'session_required' },
    });
    expect(h.db.select().from(orgs).get()?.ownerUserId).toBe(ownerId);
  });

  it('refuses an unknown key in the body', async () => {
    const res = await post(
      '/api/v1/org/transfer-ownership',
      { user_id: ownerId, confirm: 'ada@example.test', demote_me: false },
      { Cookie: cookie },
    );
    expect(res.status).toBe(422);
  });

  it('422s PATCH /users/:id to owner with use_transfer', async () => {
    const grace = await join('grace@example.test', 'admin');

    const res = await h.app.request(`/api/v1/users/${grace.id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ org_role: 'owner' }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'use_transfer' },
    });
  });

  it('422s an owner invite with use_transfer', async () => {
    const res = await post(
      '/api/v1/invites',
      { email: 'co-owner@example.test', org_role: 'owner' },
      { Cookie: cookie },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'use_transfer' },
    });
  });

  it('reports an owner left from before D-104 to the owner, and leaves them one', async () => {
    const now = Date.now();
    h.db
      .insert(users)
      .values({
        id: 'usr_second',
        email: 'second@example.test',
        name: 'Second',
        orgRole: 'owner',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();

    const body = (await (await getOrgAs()).json()) as { extra_owners?: unknown };
    expect(body.extra_owners).toEqual([
      { id: 'usr_second', name: 'Second', email: 'second@example.test' },
    ]);
    expect(h.db.select().from(users).where(eq(users.id, 'usr_second')).get()?.orgRole).toBe(
      'owner',
    );
  });
});
