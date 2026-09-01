import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, users } from '../../../src/db/schema.ts';
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
