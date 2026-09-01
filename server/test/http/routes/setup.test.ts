import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../../../src/db/migrate.ts';
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
  /** §6.4's shape, named in full so a new field is a deliberate act. */
  interface StatusBody {
    setup_required: boolean;
    system: { database: string; migrations_applied: number; smtp_configured: boolean };
  }

  async function status(): Promise<StatusBody> {
    const res = await h.app.request('/api/v1/setup/status');
    expect(res.status).toBe(200);
    return (await res.json()) as StatusBody;
  }

  it('reports that setup is required on an empty database', async () => {
    expect((await status()).setup_required).toBe(true);
  });

  it('reports that it is not, once an org exists', async () => {
    seedOrg(h.db, true);

    expect((await status()).setup_required).toBe(false);
  });

  describe('the system panel (§6.4, LAI-206)', () => {
    it('carries exactly the three fields §6.4 names', async () => {
      // The endpoint is **pre-auth**. A field arriving here without a spec line
      // is not a diff nobody reads, it is an unauthenticated disclosure — so the
      // shape is pinned rather than sampled.
      expect(Object.keys((await status()).system).sort()).toEqual(
        ['database', 'migrations_applied', 'smtp_configured'].sort(),
      );
    });

    it('names SQLite and its journal mode, from the live connection', async () => {
      // D-001. `postgres 16 · connected` is the prototype artifact
      // `docs/design/README.md` lists, and a hardcoded "SQLite · WAL" here would
      // be the same mistake one step removed: right today, and still a constant.
      const { system } = await status();

      expect(system.database).toBe('SQLite · WAL');
      // The value is read, not written: change the journal mode and the field
      // follows. Without this, a string literal passes the assertion above.
      h.t.sqlite.pragma('journal_mode = MEMORY');
      expect((await status()).system.database).toBe('SQLite · MEMORY');
      h.t.sqlite.pragma('journal_mode = WAL');
    });

    it('reports the migrations the migrator actually applied', async () => {
      const { system } = await status();
      const applied: number = system.migrations_applied;

      // Counted from the migrator's journal and compared against the folder —
      // not against a number typed here, which would need editing on every
      // migration and would then be asserting itself.
      const onDisk = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql')).length;
      expect(applied).toBe(onDisk);
      expect(onDisk).toBeGreaterThan(0);
    });

    it('says SMTP is not configured when nothing is stored', async () => {
      seedOrg(h.db, true);

      expect((await status()).system.smtp_configured).toBe(false);
    });

    it('says it is once the org carries settings, and still does not say what they are', async () => {
      seedOrg(h.db, true);
      h.db.update(orgs).set({ smtpJsonEnc: 'encrypted-blob-nobody-should-see' }).run();

      const res = await h.app.request('/api/v1/setup/status');
      const body = await res.text();

      expect(
        (JSON.parse(body) as { system: { smtp_configured: boolean } }).system.smtp_configured,
      ).toBe(true);
      // The point of the boolean. This endpoint answers before anybody has
      // authenticated, so host, port and credentials are a reconnaissance gift.
      expect(body).not.toContain('encrypted-blob-nobody-should-see');
      expect(body).not.toMatch(/smtp_json|host|port|password/i);
    });

    it('answers before setup as well as after', async () => {
      // The moment the panel is actually shown. `setup-gate` exempts
      // `/api/v1/setup/*`, and a status panel that needs an org to answer would
      // be blank on precisely the one screen it exists for.
      const before = await status();
      expect(before.setup_required).toBe(true);
      expect(before.system.database).toBe('SQLite · WAL');
      expect(before.system.migrations_applied).toBeGreaterThan(0);
      expect(before.system.smtp_configured).toBe(false);
    });
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
    // `setup_required` is what this test is about; §6.4's `system` panel rides
    // along on the same response and is asserted in its own describe.
    expect(((await me.json()) as { setup_required: boolean }).setup_required).toBe(false);

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
