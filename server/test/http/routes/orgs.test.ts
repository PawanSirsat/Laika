import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, orgs, users } from '../../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

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

  it('401s when signed out', async () => {
    const res = await h.app.request('/api/v1/org', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ presence_enabled: false }),
    });

    expect(res.status).toBe(401);
  });
});
