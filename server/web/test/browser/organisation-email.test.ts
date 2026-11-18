/**
 * The Email card on Organisation → Integrations (D-153, LAI-1312), in a real
 * browser against stubbed `/org/email*` and `/org`: an owner takes the three
 * steps the owner asked for — paste the key and save, send a test, flip the
 * switch — and the key is sent once and shown never; a refused test reads in
 * words with its code; a member is shown no card; and an invite made while
 * email is on says it was mailed.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  defaultPermissions,
  open as openPage,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
  openSectionsByDefault,
} from './harness.ts';

// The folded sections this file reads inside open as a returning viewer has them (LAI-1318).
openSectionsByDefault('email');

/** A key nothing else on the page could contain by accident. */
const KEY = 'xsmtpsib-Zq8never-echoed-K3Y9';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const DEFAULTS = {
  host: 'smtp-relay.brevo.com',
  port: 587,
  from_address: 'ksage@kvelld.com',
  from_name: 'Ksage',
};

const COUNTS = { queued: 0, sending: 0, sent: 0, failed: 0, unconfirmed: 0, suppressed: 0 };

const UNSET = {
  enabled: false,
  configured: false,
  host: null,
  port: null,
  username: null,
  from_address: null,
  from_name: null,
  key_last4: null,
  defaults: DEFAULTS,
  public_url: 'https://ksage.kvelld.com',
  last_test: null,
  last_7_days: COUNTS,
};

const saved = (patch: Record<string, unknown> = {}) => ({
  ...UNSET,
  configured: true,
  host: 'smtp-relay.brevo.com',
  port: 587,
  username: '9a1b2c@smtp-brevo.com',
  from_address: 'ksage@kvelld.com',
  from_name: 'Ksage',
  key_last4: 'K3Y9',
  ...patch,
});

/** The server's default grants for this role, plus `org.email.configure` for an owner or admin. */
function permissionsFor(role: string): unknown {
  const base = defaultPermissions({ org_role: role, memberships: [] }) as {
    readonly me: { readonly actions: readonly string[] };
  };
  const email = role === 'owner' || role === 'admin' ? ['org.email.configure'] : [];
  return { ...base, me: { ...base.me, actions: [...base.me.actions, ...email] } };
}

/** The org, readable by everyone; `ai` only for an owner or admin, as the server does. */
function org(role: string, email: { enabled: boolean; configured: boolean }) {
  return {
    id: 'o1',
    name: 'Acme',
    presence_enabled: true,
    developer_insights: false,
    created_at: 1,
    updated_at: 2,
    attachments: null,
    email,
    ...(role === 'owner' || role === 'admin'
      ? { ai: { configured: false, provider: null, key_last4: null } }
      : {}),
  };
}

/** One server's worth of email state the stub routes read and change. */
function emailServer(role: string, initial: Record<string, unknown> = UNSET) {
  let state: Record<string, unknown> = initial;
  const posts: StubCall[] = [];
  const view = () => ({ enabled: state.enabled === true, configured: state.configured === true });
  const stub: ApiStub = {
    '/api/v1/me': { ...user('u1', 'Ada Lovelace', role), memberships: [] },
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': { data: [user('u1', 'Ada Lovelace', role)], next_cursor: null },
    '/api/v1/invites': (call: StubCall) => {
      if (call.method !== 'POST') return { data: [], next_cursor: null };
      const body = call.body as { email: string | null };
      return reply(201, {
        invite: {
          id: 'i1',
          email: body.email,
          org_role: 'member',
          project_id: null,
          project_role: null,
          created_by: 'u1',
          created_at: Date.now(),
          expires_at: Date.now() + 7 * 86_400_000,
          email_sent: false,
        },
        token: 't',
        accept_url: 'https://ksage.kvelld.com/invite?token=t',
        email:
          state.enabled === true
            ? { queued: true, reason: null }
            : { queued: false, reason: 'email_off' },
      });
    },
    '/api/v1/permissions': permissionsFor(role),
    '/api/v1/org/model-prices': { as_of: '2026-10-18', can_set: false, entries: [] },
    '/api/v1/org': (call: StubCall) => {
      if (call.method === 'PATCH') {
        const on = (call.body as { email_enabled?: boolean }).email_enabled;
        if (on === true && state.configured !== true) {
          return reply(422, {
            error: {
              code: 'unprocessable',
              message: 'Save the SMTP settings and the key before turning email on',
              details: { reason: 'email_not_configured' },
            },
          });
        }
        if (on !== undefined) state = { ...state, enabled: on };
      }
      return org(role, view());
    },
    '/api/v1/org/email': (call: StubCall) => {
      if (call.method === 'PUT') {
        posts.push(call);
        const body = call.body as Record<string, unknown>;
        const key = typeof body.password === 'string' ? body.password : null;
        state = saved({
          enabled: state.enabled,
          host: body.host,
          port: body.port,
          username: body.username,
          from_address: body.from_address,
          from_name: body.from_name,
          key_last4: key === null ? state.key_last4 : key.slice(-4),
        });
      }
      if (call.method === 'DELETE') {
        state = UNSET;
        return reply(204, null);
      }
      return state;
    },
    '/api/v1/org/email/test': () => {
      const result = { ok: true, to: 'u1@example.com', code: null, message: null, at: Date.now() };
      state = { ...state, last_test: { at: result.at, ok: true, to: result.to, code: null } };
      return result;
    },
  };
  return {
    stub,
    posts,
    set: (next: Record<string, unknown>) => {
      state = next;
    },
  };
}

/** The Email page (LAI-1318), where the card is. */
async function integrations(stub: ApiStub, ready = '[data-section="email"]'): Promise<Harness> {
  const h = await openPage('/organisation?tab=email', stub);
  await h.page.locator(ready).waitFor({ timeout: 20_000 });
  return h;
}

const card = (h: Harness) => h.page.locator('[data-section="email"]');
const badge = (h: Harness) => card(h).locator('.org-status-badge');

void after(async () => {
  await closeBrowser();
});

void describe('Email: the owner’s three steps', () => {
  void test('pre-filled, off; paste the key and save; test; flip the switch on', async () => {
    const server = emailServer('owner');
    const h = await integrations(server.stub);
    try {
      assert.equal(await badge(h).innerText(), 'not set up');
      const form = card(h).getByRole('form', { name: 'SMTP settings' });
      assert.equal(await form.getByLabel('SMTP host').inputValue(), 'smtp-relay.brevo.com');
      assert.equal(await form.getByLabel('Port').inputValue(), '587');
      assert.equal(await form.getByLabel('From address').inputValue(), 'ksage@kvelld.com');
      assert.equal(await form.getByLabel('From name').inputValue(), 'Ksage');
      const toggle = card(h).getByRole('switch', { name: 'Email on' });
      assert.equal(await toggle.isDisabled(), true, 'the switch waits for a key');
      assert.equal(
        await card(h).getByRole('button', { name: 'Send test email' }).isDisabled(),
        true,
      );

      // Step 1: the key, once.
      await form.getByLabel('Login').fill('9a1b2c@smtp-brevo.com');
      const key = form.locator('input[type="password"]');
      assert.equal(await key.getAttribute('autocomplete'), 'new-password');
      await key.fill(KEY);
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await until(async () => (await badge(h).innerText()) === 'off · ready');
      assert.deepEqual(
        server.posts.map((c) => c.body),
        [
          {
            host: 'smtp-relay.brevo.com',
            port: 587,
            username: '9a1b2c@smtp-brevo.com',
            password: KEY,
            from_address: 'ksage@kvelld.com',
            from_name: 'Ksage',
          },
        ],
      );
      assert.equal(await key.inputValue(), '', 'the key is cleared once sent');
      assert.equal((await h.page.content()).includes(KEY), false, 'the key is never drawn');
      assert.match(await form.innerText(), /The saved key ends ···K3Y9/);
      assert.match(await card(h).locator('[data-email-step]').innerText(), /^Send a test email/);

      // Step 2: the test.
      await card(h).getByRole('button', { name: 'Send test email' }).click();
      const result = card(h).locator('[data-email-test-result]');
      await result.waitFor();
      assert.equal(await result.getAttribute('data-email-test-result'), 'sent');
      assert.match(await result.innerText(), /^Sent to u1@example\.com\./);

      // Step 3: on.
      await toggle.click();
      await until(async () => (await badge(h).innerText()) === 'on');
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      const patches = h.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/org');
      assert.deepEqual(
        patches.map((c) => c.body),
        [{ email_enabled: true }],
      );
    } finally {
      await h.close();
    }
  });

  void test('a refused test reads in words, with the code', async () => {
    const server = emailServer('owner', saved());
    const stub = {
      ...server.stub,
      '/api/v1/org/email/test': {
        ok: false,
        to: 'u1@example.com',
        code: '535',
        message: '5.7.8 Authentication failed',
        at: Date.now(),
      },
    };
    const h = await integrations(stub);
    try {
      await card(h).getByRole('button', { name: 'Send test email' }).click();
      const result = card(h).locator('[data-email-test-result]');
      await result.waitFor();
      assert.equal(await result.getAttribute('data-email-test-result'), 'failed');
      assert.match(
        await result.innerText(),
        /Not sent \(535\)\. The server refused the login or the key\.[\s\S]*5\.7\.8 Authentication failed/,
      );
    } finally {
      await h.close();
    }
  });

  void test('no public address: says links cannot be mailed', async () => {
    const server = emailServer('owner', saved({ public_url: null }));
    const h = await integrations(server.stub);
    try {
      assert.match(
        await card(h).locator('[data-email-warning="public-url"]').innerText(),
        /LAIKA_PUBLIC_URL/,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Email: who sees it, and what an invite says', () => {
  void test('a member is shown no Email card', async () => {
    const server = emailServer('member');
    // Its page says who sets it up, rather than drawing an empty card.
    const h = await integrations(server.stub, '[data-conn-refused]');
    try {
      await h.page.waitForTimeout(300);
      assert.equal(await card(h).count(), 0);
      assert.equal(
        h.calls.some((c) => c.path === '/api/v1/org/email'),
        false,
        'nothing asked for the settings',
      );
    } finally {
      await h.close();
    }
  });

  void test('with email on, an invite with an address says it was also emailed', async () => {
    const server = emailServer('owner', saved({ enabled: true }));
    const h = await openPage('/organisation?tab=people', server.stub);
    try {
      await h.page.locator('[data-invite-open]').click();
      const dialog = h.page.locator('[data-invite-dialog]');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Each invite with an address is also emailed/);
      await dialog
        .locator('textarea, input[type="text"], input[type="email"]')
        .first()
        .fill('grace@example.com');
      await dialog.locator('[data-invite-send]').click();
      const line = dialog.locator('[data-issued-mail]');
      await line.waitFor();
      assert.equal(await line.innerText(), 'Also emailed to grace@example.com.');
      assert.match(await dialog.innerText(), /Each link was also emailed/);
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, 1440 and 390', () => {
  void test('the card fits, with no text under 12 px, in light and dark', async () => {
    const server = emailServer(
      'owner',
      saved({ last_test: { at: Date.now(), ok: true, to: 'u1@example.com', code: null } }),
    );
    const h = await integrations(server.stub);
    try {
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          const spill = () =>
            h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          await until(async () => (await spill()) <= 0);
          const report = await h.page.evaluate(() => {
            const node = document.querySelector('[data-section="email"]');
            if (node === null) return { min: 0, lost: ['absent'] };
            const edge = Math.min(node.getBoundingClientRect().right, window.innerWidth + 1);
            let min = Infinity;
            const lost: string[] = [];
            for (const el of node.querySelectorAll('*')) {
              const box = el.getBoundingClientRect();
              if (box.width === 0 && box.height === 0) continue;
              if (el.textContent?.trim() !== '' && el.closest('svg') === null) {
                min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
              }
              if (box.right > edge + 1) lost.push(el.tagName.toLowerCase());
            }
            return { min, lost };
          });
          assert.ok(
            report.min >= 12,
            `${theme} at ${String(width)}: text at ${String(report.min)}px`,
          );
          assert.deepEqual(report.lost, [], `${theme} at ${String(width)}: drawn past the card`);
        }
      }
    } finally {
      await h.close();
    }
  });
});
