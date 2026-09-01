import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedOrg,
} from '../../helpers/auth.ts';

let h: AuthHarness;

beforeEach(() => {
  h = authHarness();
});
afterEach(() => {
  h.close();
});

const VALID = {
  org_name: 'Laika',
  owner_name: 'Ada',
  owner_email: 'ada@example.test',
  owner_password: 'correct-horse-battery-staple',
};

async function post(body: unknown): Promise<Response> {
  return h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

describe('GET /api/v1/setup/status', () => {
  it('reports that setup is required on an empty database', async () => {
    const res = await h.app.request('/api/v1/setup/status');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setup_required: true });
  });

  it('reports that it is not, once an org exists', async () => {
    seedOrg(h.db, true);

    const res = await h.app.request('/api/v1/setup/status');

    expect(await res.json()).toEqual({ setup_required: false });
  });
});

describe('the setup gate (AC1)', () => {
  it('answers conflict for API routes while setup is required', async () => {
    for (const path of ['/api/v1/me', '/api/v1/auth/sign-in/email']) {
      const res = await h.app.request(path);

      expect(res.status, path).toBe(409);

      const body = (await res.json()) as { error: { code: string; details: unknown } };
      expect(body.error.code, path).toBe('conflict');
      expect(body.error.details).toMatchObject({ setup_required: true, setup_path: '/setup' });
    }
  });

  it('keeps health answering — the container probe must not restart a server waiting to be configured', async () => {
    const res = await h.app.request('/api/v1/health');

    expect(res.status).toBe(200);
  });

  it('keeps the setup endpoints reachable', async () => {
    expect((await h.app.request('/api/v1/setup/status')).status).toBe(200);
  });

  it('redirects SPA routes to /setup', async () => {
    const res = await h.app.request('/board/LAI-1');

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/setup');
  });

  it('does not redirect /setup itself, or the page could never render', async () => {
    const res = await h.app.request('/setup');

    expect(res.status).toBe(200);
  });

  it('stops gating once setup has run', async () => {
    await post(VALID);

    expect((await h.app.request('/api/v1/me')).status).not.toBe(409);
    expect((await h.app.request('/board')).status).toBe(200);
  });
});

describe('POST /api/v1/setup', () => {
  it('creates the org, the Owner and an optional project', async () => {
    const res = await post({ ...VALID, project_name: 'Laika Core' });

    expect(res.status).toBe(201);

    const body = (await res.json()) as { org_id: string; owner_id: string; project_id: string };
    expect(body.org_id).toBeTruthy();
    expect(body.project_id).toBeTruthy();
  });

  it('signs the Owner in, so they land in the authenticated shell (AC6)', async () => {
    const res = await post(VALID);
    const cookie = cookieFrom(res);

    expect(cookie).not.toBe('');

    const me = await h.app.request('/api/v1/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);

    const profile = (await me.json()) as { email: string; org_role: string };
    expect(profile.email).toBe('ada@example.test');
    expect(profile.org_role).toBe('owner');
  });

  it('is single-use — a second call is conflict (AC3)', async () => {
    expect((await post(VALID)).status).toBe(201);

    const second = await post({ ...VALID, owner_email: 'someone-else@example.test' });

    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('leaves exactly one org after a second attempt', async () => {
    await post(VALID);
    await post({ ...VALID, owner_email: 'someone-else@example.test' });

    expect(h.db.select().from(orgs).all()).toHaveLength(1);
  });

  it('leaves no orphan account behind when the second call loses', async () => {
    await post(VALID);
    await post({ ...VALID, owner_email: 'loser@example.test' });

    // The loser's account is removed, so setup could be retried with that email.
    const me = await h.app.request('/api/v1/setup/status');
    expect(await me.json()).toEqual({ setup_required: false });

    const emails = h.db
      .select({ email: users.email })
      .from(users)
      .orderBy(users.email)
      .all()
      .map((r) => r.email);

    expect(emails).toEqual(['ada@example.test']);
  });

  it('rejects a body missing a required field', async () => {
    const { owner_password, ...withoutPassword } = VALID;
    void owner_password;

    const res = await post(withoutPassword);

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unprocessable');
  });

  it('rejects unknown fields rather than ignoring them', async () => {
    // §6.3. `trackPresence` from the SPA's form has no server field yet — see
    // the review notes — and this is what makes that visible instead of silent.
    const res = await post({ ...VALID, org_role: 'owner' });

    expect(res.status).toBe(422);
  });

  it('rejects a short password', async () => {
    const res = await post({ ...VALID, owner_password: 'short' });

    expect(res.status).toBe(422);
  });

  it('rejects a malformed project prefix', async () => {
    const res = await post({ ...VALID, project_name: 'Laika Core', project_prefix: '1BAD!' });

    expect(res.status).toBe(422);
  });
});

describe('the presence toggle (§4.2, LAI-207)', () => {
  async function setUp(body: Record<string, unknown>): Promise<Response> {
    return h.app.request('/api/v1/setup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        org_name: 'Laika',
        owner_name: 'Ada',
        owner_email: 'ada@example.test',
        owner_password: 'correct-horse-battery-staple',
        ...body,
      }),
    });
  }

  it('defaults to on when the key is absent', async () => {
    expect((await setUp({})).status).toBe(201);
    expect(h.db.select().from(orgs).get()?.presenceEnabled).toBe(1);
  });

  it('stores false when the toggle is off', async () => {
    expect((await setUp({ presence_enabled: false })).status).toBe(201);
    expect(h.db.select().from(orgs).get()?.presenceEnabled).toBe(0);
  });

  it('stores true when the toggle is explicitly on', async () => {
    expect((await setUp({ presence_enabled: true })).status).toBe(201);
    expect(h.db.select().from(orgs).get()?.presenceEnabled).toBe(1);
  });

  it('still refuses the name the control used to send', async () => {
    // `trackPresence` is what LAI-106 found failing. It is still a 422, and that
    // is correct — the fix was to accept `presence_enabled`, not to loosen the
    // schema.
    expect((await setUp({ trackPresence: false })).status).toBe(422);
  });
});
