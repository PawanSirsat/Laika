/**
 * Organisation → Security's Sign-in card (LAI-1239), in a real browser: what
 * it says on each kind of instance, and *Sync now*.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until, type ApiStub, type StubCall } from './harness.ts';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const BASE: ApiStub = {
  '/api/v1/me': { ...user('u1', 'Ada Lovelace', 'owner'), memberships: [] },
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'owner')], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': { id: 'o1', name: 'Kvelld', presence_enabled: true, created_at: 1, updated_at: 2 },
};

const microsoft = (last_run: unknown) => ({
  sign_in: 'microsoft',
  microsoft: {
    tenant_id: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    client_id: 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd',
    redirect_uri: 'https://laika.kvelld.example/api/v1/auth/callback/microsoft',
    directory_sync: { enabled: true, every_minutes: 15, last_run },
  },
});

void after(async () => {
  await closeBrowser();
});

void describe('the Sign-in card on Security', () => {
  void test('Microsoft: the tenant, the redirect URI to register, and Sync now', async () => {
    const synced = microsoft({ at: Date.now(), ok: true, added: 3, existing: 9, error: null });
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(null),
      '/api/v1/org/sso/directory-sync': synced,
    });
    try {
      const card = h.page.locator('[data-section="sso"][data-sso="microsoft"]');
      await card.waitFor({ timeout: 20_000 });
      const text = await card.innerText();
      assert.match(text, /Microsoft only/);
      assert.match(text, /72f988bf-86f1-41af-91ab-2d7cd011db47/);
      assert.equal(
        await card.locator('[data-sso-redirect]').innerText(),
        'https://laika.kvelld.example/api/v1/auth/callback/microsoft',
      );
      assert.equal(await card.locator('input').count(), 0, 'SSO is set on the server, not here');
      assert.match(await card.locator('[data-sync-run]').innerText(), /Not run since/);

      await card.getByRole('button', { name: 'Sync now' }).click();
      await until(async () => (await card.locator('[data-sync-run="ok"]').count()) === 1);
      assert.match(await card.locator('[data-sync-run]').innerText(), /3 added, 9 already here/);
      const posts = h.calls.filter(
        (c: StubCall) => c.method === 'POST' && c.path === '/api/v1/org/sso/directory-sync',
      );
      assert.equal(posts.length, 1);
    } finally {
      await h.close();
    }
  });

  void test('a failed sync says what to fix in Entra', async () => {
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft({
        at: Date.now(),
        ok: false,
        added: 0,
        existing: 0,
        error: 'graph_forbidden_grant_user_read_all',
      }),
    });
    try {
      const run = h.page.locator('[data-sync-run="failed"]');
      await run.waitFor({ timeout: 20_000 });
      assert.match(await run.innerText(), /User\.Read\.All application permission/);
    } finally {
      await h.close();
    }
  });

  void test('email and password: says so, and how Microsoft is turned on', async () => {
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': { sign_in: 'email', microsoft: null },
    });
    try {
      const card = h.page.locator('[data-section="sso"][data-sso="email"]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), /LAIKA_MICROSOFT_CLIENT_ID/);
    } finally {
      await h.close();
    }
  });
});
