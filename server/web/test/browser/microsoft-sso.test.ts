/**
 * Microsoft SSO in a real browser (LAI-1238): an SSO-only instance draws
 * *Sign in with Microsoft* on the sign-in, invite and first-boot screens, with
 * no password field anywhere, sends exactly the request better-auth needs, and
 * says in words why a sign-in came back without signing anyone in.
 *
 * Microsoft itself is not in the room: `POST /auth/sign-in/social` is stubbed
 * to answer a URL on this origin, so the redirect is observed by where the
 * browser ends up rather than by trusting that `location.assign` was called.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type ApiStub, type StubCall } from './harness.ts';

const LANDING = '/__microsoft-authorize';

const SSO_SIGNED_OUT: ApiStub = {
  '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
  '/api/v1/setup/status': { setup_required: false, sign_in: 'microsoft' },
  '/api/v1/auth/sign-in/social': { url: LANDING, redirect: true },
};

const INVITE = {
  org_name: 'Borealis Labs',
  inviter_name: 'Grace Hopper',
  org_role: 'member',
  project_id: null,
  project_name: null,
  project_role: null,
  email: 'ada@borealis.example',
  expires_at: Date.now() + 3 * 86_400_000,
};

function posted(calls: readonly StubCall[], path: string): StubCall[] {
  return calls.filter((c) => c.method === 'POST' && c.path === path);
}

void after(async () => {
  await closeBrowser();
});

void describe('signing in on an SSO-only instance', () => {
  void test('one Microsoft button, no password field, and it goes to Microsoft', async () => {
    const h = await open('/login', SSO_SIGNED_OUT);
    try {
      const button = h.page.getByRole('button', { name: 'Sign in with Microsoft' });
      await button.waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.auth-card input').count(), 0, 'a field is drawn');
      assert.equal(await h.page.getByRole('heading', { level: 1 }).count(), 1);

      await button.click();
      await until(() => new URL(h.page.url()).pathname === LANDING, 10_000);
      assert.equal(new URL(h.page.url()).pathname, LANDING);

      const sent = posted(h.calls, '/api/v1/auth/sign-in/social');
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0]?.body, {
        provider: 'microsoft',
        callbackURL: '/',
        errorCallbackURL: '/login',
      });
      assert.equal(posted(h.calls, '/api/v1/auth/sign-in/email').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a sign-in that came back refused says why, in words', async () => {
    const h = await open('/login?error=invite_required', SSO_SIGNED_OUT);
    try {
      const alert = h.page.locator('.auth-alert');
      await alert.waitFor({ timeout: 20_000 });
      assert.match(await alert.innerText(), /no invite to this Laika/);
      assert.equal(
        await alert.evaluate((el) => el.closest('[role="alert"]') !== null),
        true,
        'the refusal is not in a live region',
      );
    } finally {
      await h.close();
    }
  });

  void test('a password instance still draws the password form (the control)', async () => {
    const h = await open('/login', {
      '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
      '/api/v1/setup/status': { setup_required: false, sign_in: 'email' },
    });
    try {
      await h.page.locator('.auth-card input[type="email"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: 'Sign in with Microsoft' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('accepting an invite on an SSO-only instance', () => {
  void test('says who invited whom, and accepts by signing in as that address', async () => {
    const h = await open('/invite?token=tok1', {
      ...SSO_SIGNED_OUT,
      '/api/v1/invites/tok1': INVITE,
    });
    try {
      const button = h.page.getByRole('button', { name: 'Accept with Microsoft' });
      await button.waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.auth-card input').count(),
        0,
        'a password field is drawn',
      );
      const card = await h.page.locator('.auth-card').innerText();
      assert.match(card, /Grace Hopper invited ada@borealis\.example to Borealis Labs as member/);
      assert.match(card, /Microsoft account for ada@borealis\.example/);

      await button.click();
      await until(() => new URL(h.page.url()).pathname === LANDING, 10_000);
      assert.deepEqual(posted(h.calls, '/api/v1/auth/sign-in/social')[0]?.body, {
        provider: 'microsoft',
        callbackURL: '/board',
        errorCallbackURL: '/invite?token=tok1',
      });
      assert.equal(posted(h.calls, '/api/v1/invites/accept').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a link invite says up front that it cannot be used here', async () => {
    const h = await open('/invite?token=tok2', {
      ...SSO_SIGNED_OUT,
      '/api/v1/invites/tok2': { ...INVITE, email: null },
    });
    try {
      const alert = h.page.locator('.auth-alert');
      await alert.waitFor({ timeout: 20_000 });
      assert.match(await alert.innerText(), /invite to your own email address/);
      assert.equal(await h.page.getByRole('button', { name: 'Accept with Microsoft' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('first boot on an SSO-only instance', () => {
  void test('asks for no password, sends none, and goes to sign in with Microsoft', async () => {
    const h = await open('/setup', {
      '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
      '/api/v1/setup/status': {
        setup_required: true,
        sign_in: 'microsoft',
        system: { database: 'SQLite · WAL', migrations_applied: 18, smtp_configured: false },
      },
      '/api/v1/health': { status: 'ok', version: '0.1.0', uptime_ms: 1234 },
      '/api/v1/setup': { org_id: 'o1', owner_id: 'u1', project_id: null },
      '/api/v1/auth/sign-in/social': { url: LANDING, redirect: true },
    });
    try {
      await h.page.locator('.boot-form input').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.boot-form input[type="password"]').count(), 0);

      const inputs = h.page.locator('.boot-form input:not([type="checkbox"])');
      await inputs.nth(0).fill('Ada Owner');
      await inputs.nth(1).fill('ada@borealis.example');
      await inputs.nth(2).fill('Borealis Labs');
      await h.page.locator('.boot-form button[type="submit"]').click();

      await until(() => posted(h.calls, '/api/v1/setup').length === 1, 10_000);
      const body = posted(h.calls, '/api/v1/setup')[0]?.body as Record<string, unknown>;
      assert.equal(body.owner_email, 'ada@borealis.example');
      assert.equal('owner_password' in body, false, 'a password was sent');

      await until(() => new URL(h.page.url()).pathname === '/login', 10_000);
      await h.page
        .getByRole('button', { name: 'Sign in with Microsoft' })
        .waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });
});
