/**
 * Organisation → Security's Sign-in card (LAI-1239), in a real browser: what
 * it says on each kind of instance, and *Sync now*.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';

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

/** The Graph permissions the server lists for the meetings sync (`MEETINGS_GRAPH_PERMISSIONS`). */
const PERMISSIONS = [
  'Calendars.Read',
  'OnlineMeetings.Read.All',
  'OnlineMeetingArtifact.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'User.Read.All',
];

const meetingsSync = (enabled: boolean, last_run: unknown = null) => ({
  enabled,
  every_minutes: 15,
  permissions: PERMISSIONS,
  last_run,
});

const microsoft = (last_run: unknown, meetings: unknown = meetingsSync(false)) => ({
  sign_in: 'microsoft',
  microsoft: {
    tenant_id: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    client_id: 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd',
    redirect_uri: 'https://laika.kvelld.example/api/v1/auth/callback/microsoft',
    directory_sync: { enabled: true, every_minutes: 15, last_run },
    meetings_sync: meetings,
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

void describe('the Sign-in card’s Meetings sync (LAI-1313)', () => {
  const block = (h: Harness) => h.page.locator('[data-meetings-sync]');
  const toast = (h: Harness) => h.page.locator('[data-toast]').last();

  void test('off: says so, how to turn it on, and the permissions it will need — no Sync now', async () => {
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(null, meetingsSync(false)),
    });
    try {
      await block(h).waitFor({ timeout: 20_000 });
      assert.equal(await block(h).getAttribute('data-meetings-sync'), 'off');
      assert.match(await block(h).innerText(), /LAIKA_MICROSOFT_MEETINGS_SYNC=true/);
      assert.deepEqual(
        await block(h).locator('[data-meetings-permissions] code').allInnerTexts(),
        PERMISSIONS,
      );
      assert.equal(await block(h).getByRole('button', { name: 'Sync now' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('on: the last run, the permissions, and Sync now ending in a success toast', async () => {
    const synced = microsoft(
      null,
      meetingsSync(true, { at: Date.now(), ok: true, meetings: 12, error: null }),
    );
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(null, meetingsSync(true)),
      '/api/v1/org/sso/meetings-sync': synced,
    });
    try {
      await block(h).waitFor({ timeout: 20_000 });
      assert.equal(await block(h).getAttribute('data-meetings-sync'), 'on');
      assert.match(await block(h).locator('[data-meetings-run]').innerText(), /Not run since/);
      assert.deepEqual(
        await block(h).locator('[data-meetings-permissions] code').allInnerTexts(),
        PERMISSIONS,
      );

      await block(h).getByRole('button', { name: 'Sync now' }).click();
      await toast(h).waitFor({ timeout: 5_000 });
      assert.match(await toast(h).innerText(), /Meetings synced — 12 meetings/);
      await until(async () => (await block(h).locator('[data-meetings-run="ok"]').count()) === 1);
      assert.match(await block(h).locator('[data-meetings-run]').innerText(), /12 meetings/);
      const posts = h.calls.filter(
        (c: StubCall) => c.method === 'POST' && c.path === '/api/v1/org/sso/meetings-sync',
      );
      assert.equal(posts.length, 1);
      // Only the meetings sync ran: the directory's own button was not pressed.
      assert.equal(
        h.calls.filter((c: StubCall) => c.path === '/api/v1/org/sso/directory-sync').length,
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('Sync now that Graph refuses: a persistent error toast with the fix, and the run says it', async () => {
    const refused = microsoft(
      null,
      meetingsSync(true, {
        at: Date.now(),
        ok: false,
        meetings: 0,
        error: 'graph_forbidden_grant_calendars_read',
      }),
    );
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(null, meetingsSync(true)),
      '/api/v1/org/sso/meetings-sync': refused,
    });
    try {
      await block(h).waitFor({ timeout: 20_000 });
      await block(h).getByRole('button', { name: 'Sync now' }).click();
      await toast(h).waitFor({ timeout: 5_000 });
      const said = await toast(h).innerText();
      assert.match(said, /Meetings sync failed/);
      assert.match(said, /Calendars\.Read application permission/);
      assert.equal(await toast(h).getAttribute('data-tone'), 'error');
      // Errors persist: still there after a success toast would have gone.
      await h.page.waitForTimeout(6_500);
      assert.equal(await h.page.locator('[data-toast]').count(), 1);
      const run = block(h).locator('[data-meetings-run="failed"]');
      assert.match(await run.innerText(), /Last sync failed/);
      assert.match(await run.innerText(), /Calendars\.Read/);
    } finally {
      await h.close();
    }
  });

  void test('Sync now the server refuses: the server’s sentence in an error toast', async () => {
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(null, meetingsSync(true)),
      '/api/v1/org/sso/meetings-sync': refuse(
        409,
        'conflict',
        'Meetings sync is off. Set LAIKA_MICROSOFT_MEETINGS_SYNC=true and restart to turn it on.',
      ),
    });
    try {
      await block(h).waitFor({ timeout: 20_000 });
      await block(h).getByRole('button', { name: 'Sync now' }).click();
      await toast(h).waitFor({ timeout: 5_000 });
      assert.match(await toast(h).innerText(), /Couldn’t sync meetings/);
      assert.match(await toast(h).innerText(), /Meetings sync is off/);
    } finally {
      await h.close();
    }
  });

  void test('an incomplete run names what it read and the Teams grant to fix, with the access policy', async () => {
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(
        null,
        meetingsSync(true, {
          at: Date.now(),
          ok: false,
          meetings: 7,
          error: 'graph_forbidden_grant_onlinemeetingartifact_read_all',
        }),
      ),
    });
    try {
      const run = h.page.locator('[data-meetings-run="failed"]');
      await run.waitFor({ timeout: 20_000 });
      const text = await run.innerText();
      assert.match(text, /read 7 meetings but was incomplete/);
      assert.match(text, /OnlineMeetingArtifact\.Read\.All application permission/);
      assert.match(text, /Teams application access policy/);
    } finally {
      await h.close();
    }
  });

  void test('readable in both themes', async () => {
    const h = await open('/organisation?tab=security', {
      ...BASE,
      '/api/v1/org/sso': microsoft(null, meetingsSync(true)),
    });
    try {
      await block(h).waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const { text, chip } = await block(h).evaluate((el) => ({
          text: getComputedStyle(el.querySelector('.org-sso-sub') ?? el).color,
          chip: getComputedStyle(el.querySelector('.org-sso-perms code') ?? el).backgroundColor,
        }));
        assert.notEqual(text, 'rgba(0, 0, 0, 0)', `${theme}: the heading has no colour`);
        assert.notEqual(chip, 'rgba(0, 0, 0, 0)', `${theme}: the permission chips have no surface`);
      }
    } finally {
      await h.close();
    }
  });
});
