/**
 * Email to tasks (D-155, LAI-1315) in a real browser against stubbed
 * `/org/email-inbound*` and `/projects/:slug/email-address*`: an owner sees
 * the switch wait for a domain and a token, saves the domain, makes the
 * webhook token — shown once — and reads the last mails in words, never their
 * subject; a refused field is said under it. On a space's settings, a member
 * who may create tasks sees the address with *Copy*; one who may edit the
 * space makes a new address after a confirm; a reader who may not create
 * tasks is shown nothing and nothing is asked for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { answerConfirm } from './confirm.ts';
import {
  closeBrowser,
  defaultPermissions,
  open,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { ME_MEMBER, ME_OWNER, SLUG, spaceSettingsStub } from './space-settings-fixture.ts';

const MINUTE = 60_000;
/** A token nothing else on the page could contain by accident. */
const TOKEN = 'whTok-Zq8neverShownTwice-Wq3x';
/** A key nothing else on the page could contain by accident. */
const KEY = 'xkeysib-fixture-never-echoed-K3Y9';
/** A subject a server that broke its promise might send; the card must not draw it. */
const SUBJECT = 'Quarterly numbers — please do not show me';

const PERSON = { id: 'u1', name: 'Pawan Sirsat' };

const row = (patch: Record<string, unknown>) => ({
  id: `m${String(Math.random()).slice(2, 8)}`,
  received_at: Date.now() - 5 * MINUTE,
  outcome: 'dropped',
  reason: null,
  from_address: null,
  sender: null,
  project: null,
  task_key: null,
  comment_id: null,
  auth: null,
  authserv_ids: [] as string[],
  attachment_count: 0,
  ...patch,
});

const RECENT = [
  row({
    outcome: 'task_created',
    from_address: 'pawan@kvelld.com',
    sender: PERSON,
    project: { slug: SLUG, name: 'Mobile' },
    task_key: 'MOB-43',
    auth: 'mx.brevo.com dmarc=pass',
    attachment_count: 2,
    // Not part of the view. Here to prove the card draws only what it names.
    subject: SUBJECT,
  }),
  row({
    outcome: 'comment_added',
    received_at: Date.now() - 40 * MINUTE,
    from_address: 'tomas@kvelld.com',
    sender: { id: 'u2', name: 'Tomas Nel' },
    project: { slug: SLUG, name: 'Mobile' },
    task_key: 'MOB-12',
    comment_id: 'c1',
    auth: 'mx.brevo.com dkim=pass',
  }),
  row({
    reason: 'unauthenticated',
    received_at: Date.now() - 90 * MINUTE,
    from_address: 'pawan@kvelld.com',
    project: { slug: SLUG, name: 'Mobile' },
    auth: 'mx.brevo.com dmarc=fail spf=softfail',
  }),
  row({
    reason: 'unknown_address',
    received_at: Date.now() - 3 * 60 * MINUTE,
    from_address: 'someone-with-a-very-long-address-that-will-not-break@subsidiary.example.com',
  }),
];

const UNSET = {
  enabled: false,
  domain: null,
  require_authenticated: true,
  authserv_id: null,
  token_last4: null,
  api_key_last4: null,
  webhook_url: 'https://ksage.kvelld.com/webhooks/email',
  own_address: 'ksage@kvelld.com',
  can_store_secrets: true,
  can_switch_on: true,
  can_allow_unauthenticated: true,
  authserv_seen: [] as string[],
  example_domain: 'tasks.kvelld.com',
  updated_at: null,
  updated_by: null,
  recent: [] as unknown[],
};

const READY = {
  ...UNSET,
  domain: 'tasks.kvelld.com',
  token_last4: 'Wq3x',
  authserv_id: 'mx.brevo.com',
  api_key_last4: 'K3Y9',
  updated_at: Date.now() - 2 * 60 * MINUTE,
  updated_by: PERSON,
  recent: RECENT,
};

/** The server's default grants for this role, plus `org.email.configure` for an owner or admin. */
function permissionsFor(me: { org_role: string; memberships: unknown }): unknown {
  const base = defaultPermissions(me as never) as { readonly me: { readonly actions: string[] } };
  const email = me.org_role === 'owner' || me.org_role === 'admin' ? ['org.email.configure'] : [];
  return { ...base, me: { ...base.me, actions: [...base.me.actions, ...email] } };
}

/** One server's worth of inbound state the stub routes read and change. */
function inboundServer(initial: Record<string, unknown>) {
  let state: Record<string, unknown> = initial;
  const puts: StubCall[] = [];
  const tokens: StubCall[] = [];
  const settings: ApiStub = {
    '/api/v1/org/email-inbound': (call: StubCall) => {
      if (call.method !== 'PUT') return state;
      puts.push(call);
      const body = call.body as Record<string, unknown>;
      if (body.domain === 'taken.kvelld.com') {
        return reply(422, {
          error: {
            code: 'unprocessable',
            message: 'domain must be a host name, such as tasks.kvelld.com',
            details: { field: 'domain' },
          },
        });
      }
      const domain = 'domain' in body ? body.domain : state.domain;
      if (body.enabled === true && (domain === null || state.token_last4 === null)) {
        return reply(422, {
          error: {
            code: 'unprocessable',
            message: 'Email to tasks needs a receiving domain and a webhook token',
            details: { field: 'enabled', reason: 'inbound_not_configured' },
          },
        });
      }
      const key = body.api_key;
      state = {
        ...state,
        ...('enabled' in body ? { enabled: body.enabled } : {}),
        ...('domain' in body ? { domain } : {}),
        ...('require_authenticated' in body
          ? { require_authenticated: body.require_authenticated }
          : {}),
        ...('authserv_id' in body ? { authserv_id: body.authserv_id } : {}),
        ...(key === undefined
          ? {}
          : { api_key_last4: typeof key === 'string' ? key.slice(-4) : null }),
        updated_at: Date.now(),
        updated_by: PERSON,
      };
      return state;
    },
    '/api/v1/org/email-inbound/token': (call: StubCall) => {
      tokens.push(call);
      state = { ...state, token_last4: TOKEN.slice(-4) };
      return reply(201, { token: TOKEN, settings: state });
    },
  };
  return { settings, puts, tokens };
}

/** Organisation › Integrations for an owner, with the outbound card beside it. */
function orgStub(extra: ApiStub): ApiStub {
  return {
    '/api/v1/me': { ...ME_OWNER, memberships: [] },
    '/api/v1/permissions': permissionsFor({ org_role: 'owner', memberships: [] }),
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': { data: [], next_cursor: null },
    '/api/v1/invites': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Kvelld',
      presence_enabled: true,
      developer_insights: false,
      created_at: 1,
      updated_at: 2,
      attachments: null,
      email: { enabled: false, configured: false },
      email_inbound: { enabled: false, domain: null },
    },
    '/api/v1/org/model-prices': { as_of: '2026-10-18', can_set: false, entries: [] },
    '/api/v1/org/email': {
      enabled: false,
      configured: false,
      host: null,
      port: null,
      username: null,
      from_address: null,
      from_name: null,
      key_last4: null,
      defaults: {
        host: 'smtp-relay.brevo.com',
        port: 587,
        from_address: 'ksage@kvelld.com',
        from_name: 'Ksage',
      },
      public_url: 'https://ksage.kvelld.com',
      last_test: null,
      last_7_days: { queued: 0, sending: 0, sent: 0, failed: 0, unconfirmed: 0, suppressed: 0 },
    },
    ...extra,
  };
}

async function integrations(stub: ApiStub): Promise<Harness> {
  const h = await open('/organisation?tab=integrations', stub);
  await card(h).waitFor({ timeout: 20_000 });
  await card(h).getByRole('switch').waitFor();
  return h;
}

const card = (h: Harness) => h.page.locator('[data-section="email-inbound"]');
const badge = (h: Harness) => card(h).locator('.org-status-badge');
const address = (h: Harness) => h.page.locator('[data-email-address-section]');

/** The message a field's error region holds, through its `aria-describedby`. */
async function fieldError(h: Harness, label: string): Promise<string> {
  const input = card(h).getByLabel(label, { exact: true });
  const id = await input.getAttribute('id');
  assert.ok(id !== null, `${label} has no id`);
  return h.page.locator(`[id="${id}-error"]`).innerText();
}

/**
 * How far the page draws past the viewport, and what inside `selector` draws
 * past its box.
 *
 * **Each text node is measured too, by a `Range`.** An element's own box
 * cannot see text spilling out of it: a flex item with `min-width: 0` shrinks
 * to fit while an unbroken address runs on past it, and an ancestor that
 * clips keeps the page from scrolling — so only the text's own line boxes
 * show it. Measured: with the long From address set `nowrap`, every element
 * box stayed inside the card at 390 and this was the only check that went red.
 */
async function spill(h: Harness, selector: string) {
  return h.page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (node === null) return { page: 0, lost: ['absent'], min: 0 };
    const edge = Math.min(node.getBoundingClientRect().right, window.innerWidth + 1);
    const lost: string[] = [];
    let min = Infinity;
    for (const el of node.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right > edge + 1) lost.push(`${el.tagName.toLowerCase()}.${el.className}`);
      if (el.textContent?.trim() !== '' && el.closest('svg') === null) {
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if (text.textContent?.trim() === '' || text.parentElement?.closest('.visually-hidden')) {
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const line of range.getClientRects()) {
        if (line.right > edge + 1) lost.push(`text "${(text.textContent ?? '').slice(0, 24)}"`);
      }
    }
    return { page: document.documentElement.scrollWidth - window.innerWidth, lost, min };
  }, selector);
}

void after(async () => {
  await closeBrowser();
});

void describe('Organisation → Integrations: the Email to tasks card', () => {
  void test('the switch waits for a domain and a token; save the domain; make the token once; turn it on', async () => {
    const server = inboundServer(UNSET);
    const h = await integrations(orgStub(server.settings));
    try {
      assert.equal(await badge(h).innerText(), 'not set up');
      const toggle = card(h).getByRole('switch', { name: 'Email to tasks on' });
      assert.equal(await toggle.isDisabled(), true, 'no domain, no token: the switch waits');
      assert.equal(
        await card(h).locator('[data-inbound-step]').innerText(),
        'Save a receiving domain and make a webhook token first.',
      );
      const domain = card(h).getByLabel('Receiving domain', { exact: true });
      assert.equal(await domain.getAttribute('placeholder'), 'tasks.kvelld.com');
      const save = card(h).locator('[data-inbound-save]');
      assert.equal(await save.isDisabled(), true, 'nothing to save yet');
      assert.equal(
        await card(h).getByRole('checkbox', { name: 'Require authenticated senders' }).isChecked(),
        true,
      );
      assert.match(
        await card(h).locator('[data-inbound-url]').innerText(),
        /^https:\/\/ksage\.kvelld\.com\/webhooks\/email$/,
      );
      assert.equal(
        await card(h)
          .getByRole('button', { name: /Copy the webhook URL/ })
          .count(),
        1,
      );
      assert.match(await card(h).innerText(), /Mail from\s+ksage@kvelld\.com/);
      assert.match(await card(h).innerText(), /No mail has arrived yet\./);

      // Step 1: the domain, sent as the server stores it, and only it.
      await domain.fill(' Tasks.Kvelld.com ');
      await save.click();
      await until(async () =>
        (await card(h).locator('[data-inbound-step]').innerText()).startsWith('Make'),
      );
      assert.deepEqual(
        server.puts.map((c) => c.body),
        [{ domain: 'tasks.kvelld.com' }],
      );
      assert.equal(await domain.inputValue(), 'tasks.kvelld.com');
      assert.equal(await toggle.isDisabled(), true, 'a domain alone is not enough');
      assert.equal(
        await card(h).locator('[data-inbound-step]').innerText(),
        'Make a webhook token first.',
      );

      // Step 2: the token, shown this once.
      assert.equal(
        await card(h).locator('[data-inbound-token]').getAttribute('data-inbound-token'),
        'none',
      );
      await card(h).getByRole('button', { name: 'Make token' }).click();
      const shown = card(h).locator('[data-inbound-token="new"]');
      await shown.waitFor();
      assert.match(await shown.innerText(), new RegExp(TOKEN));
      assert.match(
        await shown.innerText(),
        /Paste this into Brevo’s inbound webhook as its bearer token\. It is not shown again\./,
      );
      assert.equal(await shown.getByRole('button', { name: /Copy the webhook token/ }).count(), 1);
      assert.equal(server.tokens.length, 1);
      assert.equal(await card(h).getByRole('button', { name: 'Make a new token' }).count(), 1);

      // Step 3: the receiving server, read off a real delivery (M1) — until
      // then nothing would be believed, so the switch still waits.
      assert.equal(await badge(h).innerText(), 'not set up');
      assert.equal(
        await card(h).locator('[data-inbound-step]').innerText(),
        'Name the receiving server first, from a real delivery.',
      );
      await card(h)
        .getByLabel(/Receiving server/)
        .fill('mx.brevo.com');
      await save.click();
      await until(async () => (await badge(h).innerText()) === 'off · ready');
      assert.deepEqual(server.puts.at(-1)?.body, { authserv_id: 'mx.brevo.com' });

      // Step 4: on.
      assert.equal(await toggle.isDisabled(), false);
      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'true');
      assert.deepEqual(server.puts.at(-1)?.body, { enabled: true });
      assert.equal(await badge(h).innerText(), 'on');
    } finally {
      await h.close();
    }

    // Read again, the token is gone: only its last four.
    const again = await integrations(orgStub(server.settings));
    try {
      assert.equal((await again.page.content()).includes(TOKEN), false, 'the token is shown twice');
      assert.equal(
        await card(again).locator('[data-inbound-token]').innerText(),
        'Ends …Wq3x. Only Brevo’s webhook should have it.',
      );
    } finally {
      await again.close();
    }
  });

  void test('a new token replaces the old one only after a yes', async () => {
    const server = inboundServer(READY);
    const h = await integrations(orgStub(server.settings));
    try {
      await card(h).getByRole('button', { name: 'Make a new token' }).click();
      assert.match(await answerConfirm(h.page, false), /The current token stops working at once/);
      assert.equal(server.tokens.length, 0, 'Cancel made nothing');
      await card(h).getByRole('button', { name: 'Make a new token' }).click();
      await answerConfirm(h.page, true);
      await card(h).locator('[data-inbound-token="new"]').waitFor();
      assert.equal(server.tokens.length, 1);
    } finally {
      await h.close();
    }
  });

  void test('a refused field is said under it; a bad one is caught before it is sent', async () => {
    const server = inboundServer(READY);
    const h = await integrations(orgStub(server.settings));
    try {
      const domain = card(h).getByLabel('Receiving domain', { exact: true });
      const save = card(h).locator('[data-inbound-save]');

      // The client's own check: nothing goes up.
      await domain.fill('not a domain');
      await save.click();
      await until(async () => (await domain.getAttribute('aria-invalid')) === 'true');
      assert.equal(
        await fieldError(h, 'Receiving domain'),
        'A host name, such as tasks.kvelld.com',
      );
      assert.equal(server.puts.length, 0, 'a value the server would refuse was sent');

      // The server's refusal, by `details.field`.
      await domain.fill('taken.kvelld.com');
      await save.click();
      await until(async () =>
        (await fieldError(h, 'Receiving domain')).startsWith('domain must be'),
      );
      assert.equal(
        await fieldError(h, 'Receiving domain'),
        'domain must be a host name, such as tasks.kvelld.com',
      );
      assert.deepEqual(
        server.puts.map((c) => c.body),
        [{ domain: 'taken.kvelld.com' }],
      );
      assert.match(await card(h).innerText(), /Couldn.t save/);
      assert.equal(await domain.inputValue(), 'taken.kvelld.com', 'what was typed is kept');
    } finally {
      await h.close();
    }
  });

  void test('the key is sent once, cleared, and shown only as its last four', async () => {
    const server = inboundServer({ ...READY, api_key_last4: null });
    const h = await integrations(orgStub(server.settings));
    try {
      const key = card(h).locator('input[type="password"]');
      assert.equal(await key.getAttribute('autocomplete'), 'new-password');
      await key.fill(KEY);
      await card(h).getByLabel('Receiving server (Authentication-Results)').fill('');
      await card(h).getByRole('checkbox', { name: 'Require authenticated senders' }).uncheck();
      await card(h).locator('[data-inbound-save]').click();
      await until(async () => server.puts.length === 1 && (await key.inputValue()) === '');
      assert.deepEqual(server.puts[0]?.body, {
        require_authenticated: false,
        authserv_id: null,
        api_key: KEY,
      });
      await until(async () => (await card(h).innerText()).includes('…K3Y9'));
      assert.match(await card(h).innerText(), /The saved key ends …K3Y9/);
      assert.equal((await h.page.content()).includes(KEY), false, 'the key is drawn');
    } finally {
      await h.close();
    }
  });

  void test('the last mails, in words: who, where, the task, the verdicts — never a subject', async () => {
    const server = inboundServer({ ...READY, enabled: true });
    const h = await integrations(orgStub(server.settings));
    try {
      const rows = card(h).locator('.org-inbound-row');
      assert.equal(await rows.count(), RECENT.length);
      const created = rows.nth(0);
      assert.equal(await created.locator('.org-inbound-outcome').innerText(), 'Task created');
      assert.match(await created.innerText(), /Pawan Sirsat/);
      assert.match(await created.innerText(), /Mobile/);
      assert.match(await created.innerText(), /mx\.brevo\.com dmarc=pass/);
      assert.match(await created.innerText(), /2 attachments/);
      const link = created.getByRole('link', { name: 'MOB-43' });
      assert.equal(await link.getAttribute('href'), `/board?project=${SLUG}&task=MOB-43`);

      assert.equal(await rows.nth(1).locator('.org-inbound-outcome').innerText(), 'Comment added');
      assert.equal(
        await rows.nth(2).locator('.org-inbound-outcome').innerText(),
        'Dropped: The sender could not be authenticated',
      );
      assert.equal(await rows.nth(2).getByRole('link').count(), 0, 'a dropped mail links nothing');
      assert.equal(
        await rows.nth(3).locator('.org-inbound-outcome').innerText(),
        'Dropped: Not a space’s address',
      );
      assert.match(await rows.nth(3).innerText(), /someone-with-a-very-long-address/);

      const text = await card(h).innerText();
      assert.equal(text.includes(SUBJECT), false, 'a subject is drawn');
      assert.equal((await h.page.content()).includes(SUBJECT), false, 'a subject is in the page');
      assert.doesNotMatch(text, /unauthenticated|unknown_address|task_created/, 'a code shows');
      assert.match(text, /Last changed by Pawan Sirsat/);

      // In the app, not a reload: the click goes through the router.
      await link.click();
      await h.page.waitForURL((url) => url.pathname === '/board', { timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('an admin: the switch is an owner’s to turn on, and so is authentication off (M2)', async () => {
    const server = inboundServer({
      ...READY,
      can_switch_on: false,
      can_allow_unauthenticated: false,
    });
    const h = await integrations(orgStub(server.settings));
    try {
      assert.equal(
        await card(h).getByRole('switch', { name: 'Email to tasks on' }).isDisabled(),
        true,
      );
      assert.equal(
        await card(h).locator('[data-inbound-step]').innerText(),
        'Only an owner can turn this on.',
      );
      const require = card(h).getByRole('checkbox', { name: 'Require authenticated senders' });
      assert.equal(await require.isChecked(), true);
      assert.equal(await require.isDisabled(), true);
      assert.match(await card(h).innerText(), /Only an owner can turn this off\./);
    } finally {
      await h.close();
    }
  });

  void test('no receiving server named: the switch waits, and the servers recent mail named are offered (M1)', async () => {
    const server = inboundServer({
      ...READY,
      authserv_id: null,
      authserv_seen: ['inbound1.brevo.example'],
      recent: [row({ reason: 'switch_off', authserv_ids: ['inbound1.brevo.example'] })],
    });
    const h = await integrations(orgStub(server.settings));
    try {
      assert.equal(
        await card(h).locator('[data-inbound-step]').innerText(),
        'Name the receiving server first, from a real delivery.',
      );
      assert.equal(
        await card(h).getByRole('switch', { name: 'Email to tasks on' }).isDisabled(),
        true,
      );
      assert.match(await card(h).innerText(), /Seen in recent mail: inbound1\.brevo\.example\./);
      assert.equal(
        (await card(h).locator('[data-inbound-seen]').innerText()).trim(),
        'named inbound1.brevo.example',
      );
    } finally {
      await h.close();
    }
  });

  void test('no LAIKA_SECRET: the key field is off and says why, before any Save', async () => {
    const server = inboundServer({ ...UNSET, can_store_secrets: false });
    const h = await integrations(orgStub(server.settings));
    try {
      const key = card(h).getByLabel(/Brevo API key/);
      await key.waitFor({ timeout: 5_000 });
      assert.equal(await key.isDisabled(), true);
      assert.match(await card(h).innerText(), /no LAIKA_SECRET, so it cannot store a key/);
      assert.equal(server.puts.length, 0);
    } finally {
      await h.close();
    }
  });

  void test('no public address: says there is no webhook URL to give Brevo', async () => {
    const server = inboundServer({ ...UNSET, webhook_url: null });
    const h = await integrations(orgStub(server.settings));
    try {
      assert.match(
        await card(h).locator('[data-inbound-warning="public-url"]').innerText(),
        /LAIKA_PUBLIC_URL/,
      );
      assert.equal(await card(h).locator('[data-inbound-url]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('fits in light and dark, at 1440 and at 390, with no text under 12 px', async () => {
    const server = inboundServer({ ...READY, enabled: true });
    const h = await integrations(orgStub(server.settings));
    try {
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          await until(async () => (await spill(h, '[data-section="email-inbound"]')).page <= 0);
          const report = await spill(h, '[data-section="email-inbound"]');
          const at = `${theme} at ${String(width)}`;
          assert.ok(
            report.page <= 0,
            `${at}: the page scrolls sideways by ${String(report.page)}px`,
          );
          assert.deepEqual(report.lost, [], `${at}: drawn past the card`);
          assert.ok(report.min >= 12, `${at}: text at ${String(report.min)}px`);
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('Space settings: the space’s address', () => {
  const ADDRESS = 'mobile-k3x9q2m7bz4a@tasks.kvelld.com';

  /** `GET` and `POST …/rotate`, recording each call. */
  function addressRoutes(view: Record<string, unknown>) {
    let state = view;
    const calls: StubCall[] = [];
    return {
      calls,
      stub: {
        [`/api/v1/projects/${SLUG}/email-address`]: (call: StubCall) => {
          calls.push(call);
          return state;
        },
        [`/api/v1/projects/${SLUG}/email-address/rotate`]: (call: StubCall) => {
          calls.push(call);
          state = { ...state, address: 'mobile-n3wn3wn3wn3w@tasks.kvelld.com' };
          return state;
        },
      } satisfies ApiStub,
    };
  }

  void test('shows the address with Copy, and New address goes after a confirm', async () => {
    const routes = addressRoutes({ address: ADDRESS, enabled: true, can_rotate: true });
    const h = await open(`/spaces/${SLUG}/settings`, spaceSettingsStub(ME_OWNER, routes.stub));
    try {
      await address(h).waitFor({ timeout: 20_000 });
      const shown = address(h).locator('[data-email-address="set"]');
      await shown.waitFor();
      assert.equal(await shown.locator('code').innerText(), ADDRESS);
      assert.equal(
        await shown.getByRole('button', { name: /Copy this space’s address/ }).count(),
        1,
      );
      assert.match(
        await address(h).innerText(),
        /Mail from a member to this address becomes a task in this space, written as them; replies in the thread become comments\./,
      );
      assert.equal(await address(h).locator('[data-email-off]').count(), 0, 'it is on');

      // Cancel changes nothing.
      await address(h).getByRole('button', { name: 'New address' }).click();
      assert.match(await answerConfirm(h.page, false), /The old address stops working at once/);
      assert.equal(routes.calls.filter((c) => c.method === 'POST').length, 0);

      await address(h).getByRole('button', { name: 'New address' }).click();
      await answerConfirm(h.page, true);
      await until(async () =>
        (await shown.locator('code').innerText()).startsWith('mobile-n3wn3w'),
      );
      assert.deepEqual(
        routes.calls.map((c) => [c.method, c.path]),
        [
          ['GET', `/api/v1/projects/${SLUG}/email-address`],
          ['POST', `/api/v1/projects/${SLUG}/email-address/rotate`],
        ],
      );
      assert.match(await address(h).locator('[data-email-rotated]').innerText(), /New address/);
    } finally {
      await h.close();
    }
  });

  void test('a member who may create tasks but not edit the space has no New address', async () => {
    const routes = addressRoutes({ address: ADDRESS, enabled: false, can_rotate: false });
    const h = await open(`/spaces/${SLUG}/settings`, spaceSettingsStub(ME_MEMBER, routes.stub));
    try {
      await address(h).locator('[data-email-address="set"]').waitFor({ timeout: 20_000 });
      assert.equal(await address(h).getByRole('button', { name: 'New address' }).count(), 0);
      assert.equal(
        await address(h).locator('[data-email-off]').innerText(),
        'Email to tasks is off for this organisation. Mail to this address is recorded and dropped.',
      );
    } finally {
      await h.close();
    }
  });

  void test('with no receiving domain, says so', async () => {
    const routes = addressRoutes({ address: null, enabled: false, can_rotate: true });
    const h = await open(`/spaces/${SLUG}/settings`, spaceSettingsStub(ME_OWNER, routes.stub));
    try {
      const none = address(h).locator('[data-email-address="none"]');
      await none.waitFor({ timeout: 20_000 });
      assert.equal(await none.innerText(), 'Your organisation has not set a receiving domain yet.');
      assert.equal(await address(h).getByRole('button', { name: 'New address' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a reader who may not create tasks is shown nothing, and nothing is asked', async () => {
    const viewer = { ...ME_MEMBER, memberships: [{ project_id: 'p1', role: 'viewer' }] };
    const routes = addressRoutes({ address: ADDRESS, enabled: true, can_rotate: false });
    const h = await open(`/spaces/${SLUG}/settings`, spaceSettingsStub(viewer, routes.stub));
    try {
      await h.page.locator('.ss').waitFor({ timeout: 20_000 });
      await h.page.locator('[data-action], .ss-card').first().waitFor();
      await h.page.waitForTimeout(500);
      assert.equal(await address(h).count(), 0);
      assert.equal(routes.calls.length, 0, 'the address was asked for');
    } finally {
      await h.close();
    }
  });

  void test('a refusal draws nothing at all', async () => {
    const h = await open(
      `/spaces/${SLUG}/settings`,
      spaceSettingsStub(ME_MEMBER, {
        [`/api/v1/projects/${SLUG}/email-address`]: reply(403, {
          error: { code: 'forbidden', message: 'You may not create tasks here' },
        }),
      }),
    );
    try {
      await h.page.locator('.ss').waitFor({ timeout: 20_000 });
      await until(() => h.calls.some((c) => c.path === `/api/v1/projects/${SLUG}/email-address`));
      await h.page.waitForTimeout(300);
      assert.equal(await address(h).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('fits in light and dark, at 1440 and at 390', async () => {
    const routes = addressRoutes({ address: ADDRESS, enabled: false, can_rotate: true });
    const h = await open(`/spaces/${SLUG}/settings`, spaceSettingsStub(ME_OWNER, routes.stub));
    try {
      await address(h).locator('[data-email-address="set"]').waitFor({ timeout: 20_000 });
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          await until(async () => (await spill(h, '[data-email-address-section]')).page <= 0);
          const report = await spill(h, '[data-email-address-section]');
          const at = `${theme} at ${String(width)}`;
          assert.ok(
            report.page <= 0,
            `${at}: the page scrolls sideways by ${String(report.page)}px`,
          );
          assert.deepEqual(report.lost, [], `${at}: drawn past the card`);
          assert.ok(report.min >= 12, `${at}: text at ${String(report.min)}px`);
        }
      }
    } finally {
      await h.close();
    }
  });
});
