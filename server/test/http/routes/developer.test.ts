import { afterEach, describe, expect, it } from 'vitest';
import { type CompatibilityBody } from '../../../src/http/routes/developer.ts';
import { FEATURE_NAMES } from '../../../src/services/developer-compat.ts';
import { TEST_VERSION, testApp } from '../../helpers/app.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  TEST_SECRET,
} from '../../helpers/auth.ts';

/**
 * `GET /api/v1/developer/compatibility` and `/health`'s `build_commit`
 * (SPEC §6.4, LAI-1043). The body's construction is asserted in
 * `services/developer-compat.test.ts`; this is the route: mounted, public,
 * the same for everyone, and carrying nothing secret.
 */

const COMMIT = 'cea011d6a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8';
const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

async function read(res: Response): Promise<CompatibilityBody> {
  expect(res.status, await res.clone().text()).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  return (await res.json()) as CompatibilityBody;
}

describe('GET /api/v1/developer/compatibility', () => {
  it('answers anonymously with the build, the protocol and the flag', async () => {
    const { app } = testApp({ buildCommit: COMMIT, developerAccess: 'preview' });

    const body = await read(await app.request('/api/v1/developer/compatibility'));

    expect(body.server).toEqual({ version: TEST_VERSION, build_commit: COMMIT });
    // Protocol 2 is current; a protocol-1 helper is still accepted (LAI-1062).
    expect(body.protocol).toEqual({ current: 2, min_client: 1 });
    expect(body.features.developer_access).toBe('preview');
    expect(body.cli.source).toEqual({
      type: 'git',
      url: 'https://github.com/PawanSirsat/Laika.git',
      commit: COMMIT,
      path: 'cli',
    });
    expect(body.release_notes.ref).toBe(COMMIT);
  });

  it('defaults to classic and a null commit when the deployment says neither', async () => {
    const { app } = testApp();

    const body = await read(await app.request('/api/v1/developer/compatibility'));

    expect(body.features.developer_access).toBe('classic');
    expect(body.server.build_commit).toBeNull();
    expect(body.cli.source.commit).toBeNull();
    expect(body.release_notes.ref).toBeNull();
  });

  it('serves the configured CLI source URL', async () => {
    const { app } = testApp({ cliSourceUrl: 'https://git.example.test/laika.git' });

    const body = await read(await app.request('/api/v1/developer/compatibility'));

    expect(body.cli.source.url).toBe('https://git.example.test/laika.git');
  });

  it('gives a signed-in caller and a token the same body as an anonymous one, and no secret', async () => {
    h = authHarness({ buildCommit: COMMIT, developerAccess: 'v3' });
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
    const cookie = cookieFrom(setup);
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'Doctor', scope: 'full' }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const secret = String(((await minted.json()) as { secret: string }).secret);
    expect(secret).toMatch(/^lai_/);

    const anonymous = await h.app.request('/api/v1/developer/compatibility');
    const anonymousText = await anonymous.clone().text();
    const anonymousBody = await read(anonymous);
    const withCookie = await read(
      await h.app.request('/api/v1/developer/compatibility', { headers: { Cookie: cookie } }),
    );
    const withToken = await read(
      await h.app.request('/api/v1/developer/compatibility', {
        headers: { Authorization: `Bearer ${secret}` },
      }),
    );

    expect(withCookie).toEqual(anonymousBody);
    expect(withToken).toEqual(anonymousBody);
    expect(anonymousBody.features.developer_access).toBe('v3');

    // Nothing the server holds or the caller sent comes back.
    for (const leaked of [TEST_SECRET, secret, 'ada@example.test', PASSWORD]) {
      expect(anonymousText).not.toContain(leaked);
      expect(JSON.stringify(withToken)).not.toContain(leaked);
    }
    expect(anonymousText).not.toMatch(/lai_[A-Za-z0-9]/);
  });

  it('answers 409 setup_required before first-boot setup, like every API path but /health and /setup', async () => {
    h = authHarness({ buildCommit: COMMIT });

    const res = await h.app.request('/api/v1/developer/compatibility');

    expect(res.status, await res.clone().text()).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; details: { setup_required?: unknown; setup_path?: unknown } };
    };
    expect(body.error.code).toBe('conflict');
    expect(body.error.details).toMatchObject({ setup_required: true, setup_path: '/setup' });
    // `/health` stays open on the same un-set-up instance.
    expect((await h.app.request('/api/v1/health')).status).toBe(200);
  });

  it('is a GET only: another method is 405 method_not_allowed (§6.3)', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/developer/compatibility', { method: 'POST' });

    expect(res.status).toBe(405);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'method_not_allowed',
    );
  });
});

/** First-boot setup, so every API path answers rather than `409`. */
async function setUp(harness: AuthHarness): Promise<void> {
  const setup = await harness.app.request('/api/v1/setup', {
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
}

describe('GET /api/v1/developer/compatibility — features (LAI-1062)', () => {
  it('says device pairing, the tool setup exchange and client reports are on, project setups off', async () => {
    h = authHarness();
    await setUp(h);

    const body = await read(await h.app.request('/api/v1/developer/compatibility'));

    expect(body.features).toEqual({
      developer_access: 'classic',
      device_pairing: true,
      tool_setup_exchange: true,
      client_reports: true,
      project_setups: false,
    });
  });

  // Each feature's routes answer as themselves, not as the SPA fallback or a
  // 404: an anonymous empty body is refused by the route's own auth or
  // validation, with a Laika error code.
  it('answers each named route with Laika JSON, not a 404', async () => {
    h = authHarness();
    await setUp(h);
    const id = '01M6CTJSC90GV0R511PPMG7NBH';

    for (const path of [
      '/api/v1/devices/pairing-requests',
      `/api/v1/devices/pairing-requests/${id}/approve`,
      `/api/v1/devices/${id}/tools`,
      '/api/v1/device-pairing/claim',
      `/api/v1/device-pairing/${id}/complete`,
      `/api/v1/tool-setup/${id}/redeem`,
      '/api/v1/agents/me/client-report',
    ]) {
      const res = await h.app.request(path, { method: 'POST', headers: jsonHeaders(), body: '{}' });
      expect(res.status, path).not.toBe(404);
      expect(res.headers.get('content-type'), path).toMatch(/^application\/json/);
      expect(((await res.json()) as { error?: { code?: unknown } }).error?.code, path).toEqual(
        expect.any(String),
      );
    }
  });

  it('reports every feature off on an app that mounts none of their routes', async () => {
    const { app } = testApp();

    const { features } = await read(await app.request('/api/v1/developer/compatibility'));

    for (const name of FEATURE_NAMES) expect(features[name], name).toBe(false);
  });
});

describe('GET /api/v1/health — build_commit (LAI-1043)', () => {
  it('adds build_commit and keeps the three original fields', async () => {
    const { app } = testApp({ buildCommit: COMMIT });

    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['build_commit', 'status', 'uptime_ms', 'version']);
    expect(body.status).toBe('ok');
    expect(body.version).toBe(TEST_VERSION);
    expect(typeof body.uptime_ms).toBe('number');
    expect(body.build_commit).toBe(COMMIT);
  });

  it('reports a null build_commit when the build did not say', async () => {
    const { app } = testApp();

    const body = (await (await app.request('/api/v1/health')).json()) as Record<string, unknown>;

    expect(body.build_commit).toBeNull();
  });
});
