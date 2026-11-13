/**
 * The HR system and Holidays facts on Organisation → Overview (D-149,
 * LAI-1182), in a real browser against stubbed `/org/hr*` and
 * `/org/holidays`: an owner connects Clan (with and without a sign-in code),
 * reads every refusal in words, syncs, disconnects and maps people; a member
 * reads the holidays and is shown no HR system at all.
 *
 * Every date here is anchored to the day the test runs (CONVENTIONS §4).
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
} from './harness.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.now();
const YEAR = new Date(NOW).getFullYear();
/** A password nothing else on the page could contain by accident. */
const SECRET = 'pw-Zq8!never-echoed';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const MEMBERS = [
  user('u1', 'Ada Lovelace', 'owner'),
  user('u2', 'Grace Hopper', 'member'),
  user('u3', 'Linus Torvalds', 'member'),
  user('u4', 'Katherine Johnson', 'member'),
];

const OFF = {
  status: 'off',
  provider: null,
  base_url: null,
  account_name: null,
  account_email: null,
  token_last4: null,
  token_expires_at: null,
  expiring_soon: false,
  sees_everyone: false,
  sees_departments: false,
  sync_every_minutes: 30,
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  last_result: null,
  two_factor: null,
  people: [],
};

const RESULT = {
  people: 4,
  matched: 2,
  unmatched: 2,
  holidays: 12,
  leave_days: 340,
  created: 3,
  updated: 1,
  removed: 0,
  unchanged: 348,
};

/** Ada matched by email; Grace unmatched; Linus mapped by an owner; one said Not on Laika. */
const PEOPLE = [
  {
    external_id: 'c1',
    name: 'Ada Clan',
    user: { id: 'u1', name: 'Ada Lovelace' },
    matched_by: 'email',
  },
  { external_id: 'c2', name: 'Grace Clan', user: null, matched_by: 'none' },
  {
    external_id: 'c3',
    name: 'Linus Clan',
    user: { id: 'u3', name: 'Linus Torvalds' },
    matched_by: 'owner',
  },
  { external_id: 'c4', name: 'Contractor Clan', user: null, matched_by: 'owner' },
];

/** `minutes` before now, read when the fixture is built — the page reads it moments later. */
const ago = (minutes: number): number => Date.now() - minutes * MINUTE;

const connected = (patch: Record<string, unknown> = {}) => ({
  ...OFF,
  status: 'connected',
  provider: 'clan',
  base_url: 'https://codesage.clan.biz/api/v1',
  account_name: 'Forge',
  account_email: 'forge@codesage.test',
  token_last4: 'a1b2',
  sees_everyone: true,
  sees_departments: true,
  token_expires_at: Date.now() + 200 * DAY,
  last_attempt_at: ago(4),
  last_success_at: ago(4),
  last_result: RESULT,
  people: PEOPLE,
  ...patch,
});

const HOLIDAYS = [
  {
    id: 'h1',
    day: `${String(YEAR)}-01-01`,
    label: 'New Year’s Day',
    source: 'clan',
    everyone: true,
  },
  {
    id: 'h2',
    day: `${String(YEAR)}-09-24`,
    label: 'Heritage Day',
    source: 'clan',
    everyone: false,
  },
  {
    id: 'h3',
    day: `${String(YEAR + 1)}-03-02`,
    label: 'Company day',
    source: 'manual',
    everyone: true,
  },
];

/** The server's default grants for this role, plus `org.hr.configure` for an owner or admin. */
function permissionsFor(role: string): unknown {
  const base = defaultPermissions({ org_role: role, memberships: [] }) as {
    readonly me: { readonly actions: readonly string[] };
  };
  const hr = role === 'owner' || role === 'admin' ? ['org.hr.configure'] : [];
  return { ...base, me: { ...base.me, actions: [...base.me.actions, ...hr] } };
}

function orgStub(role: string, extra: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': { ...user('u1', 'Ada Lovelace', role), memberships: [] },
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': { data: MEMBERS, next_cursor: null },
    '/api/v1/invites': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Acme',
      presence_enabled: true,
      developer_insights: false,
      created_at: 1,
      updated_at: 2,
    },
    '/api/v1/me/time-settings': {
      org_mode: 'manual',
      draft_my_time: false,
      drafting: false,
      min_sync_interval_s: 300,
      breaks: [],
    },
    '/api/v1/permissions': permissionsFor(role),
    '/api/v1/org/holidays': { holidays: HOLIDAYS },
    '/api/v1/org/model-prices': { as_of: '2026-10-18', can_set: false, entries: [] },
    ...extra,
  };
}

/** `GET /org/hr` from state a test can change, and `DELETE` turning it off. */
function hrState(initial: unknown) {
  let state = initial;
  return {
    set: (next: unknown) => {
      state = next;
    },
    route: (call: StubCall) => {
      if (call.method === 'DELETE') {
        state = OFF;
        return reply(204, null);
      }
      return state;
    },
  };
}

const refused = (status: number, code: string, reason: string) =>
  reply(status, {
    error: { code, message: 'Clan said: invalid credentials for user', details: { reason } },
  });

/** Overview, where the Holidays fact is. */
async function organisation(stub: ApiStub, ready = '[data-fact="holidays"]'): Promise<Harness> {
  const h = await openPage('/organisation', stub);
  await h.page.locator(ready).waitFor({ timeout: 20_000 });
  return h;
}

/** Integrations, where the HR system card is, beside the GitHub webhook. */
async function integrations(stub: ApiStub, ready = '[data-section="hr"]'): Promise<Harness> {
  const h = await openPage('/organisation?tab=integrations', stub);
  await h.page.locator(ready).waitFor({ timeout: 20_000 });
  return h;
}

const hrCard = (h: Harness) => h.page.locator('[data-section="hr"]');

async function fillConnect(h: Harness, url: string): Promise<void> {
  const form = hrCard(h).getByRole('form', { name: 'Connect Clan' });
  await form.getByLabel('Clan address').fill(url);
  await form.getByLabel('Email').fill('forge@codesage.test');
  await form.locator('input[type="password"]').fill(SECRET);
  await form.getByRole('button', { name: 'Connect', exact: true }).click();
}

void after(async () => {
  await closeBrowser();
});

void describe('HR system: connecting Clan', () => {
  void test('off → connect → connected; the password is sent once and shown never', async () => {
    const posts: StubCall[] = [];
    const hr = hrState(OFF);
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': hr.route,
        '/api/v1/org/hr/connect': (call: StubCall) => {
          posts.push(call);
          hr.set(connected({ last_attempt_at: null, last_success_at: null, last_result: null }));
          return connected({ last_attempt_at: null, last_success_at: null, last_result: null });
        },
      }),
      '[data-section="hr"]',
    );
    try {
      const fact = hrCard(h);
      assert.equal(await fact.getAttribute('data-hr-status'), 'off');
      assert.equal(
        await fact.locator('[data-hr-lead]').innerText(),
        'Holidays and leave from Clan, every 30 minutes. Laika keeps the sign-in token, never the password.',
      );
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      const form = fact.getByRole('form', { name: 'Connect Clan' });
      await form.waitFor();
      assert.equal(
        await form.getByLabel('Clan address').getAttribute('placeholder'),
        'https://codesage.clan.biz',
      );
      const password = form.locator('input[type="password"]');
      assert.equal(await password.inputValue(), '', 'the password field is never pre-filled');
      assert.equal(await password.getAttribute('autocomplete'), 'new-password');

      await fillConnect(h, 'https://codesage.clan.biz');
      await until(() => posts.length === 1);
      assert.equal(posts.length, 1);
      assert.equal(posts[0]?.method, 'POST');
      assert.deepEqual(posts[0]?.body, {
        base_url: 'https://codesage.clan.biz',
        email: 'forge@codesage.test',
        password: SECRET,
      });

      await until(async () => (await fact.getAttribute('data-hr-status')) === 'connected');
      assert.equal(await fact.getAttribute('data-hr-status'), 'connected');
      assert.match(
        await fact.locator('[data-hr-connected]').innerText(),
        /^Connected as Forge \(forge@codesage\.test\) · token …a1b2, renews by \d{1,2} [A-Z][a-z]{2} \d{4}$/,
      );
      assert.equal(await fact.locator('[data-hr-connected]').getAttribute('data-tone'), null);
      assert.match(await fact.innerText(), /No sync has finished yet\./);
      assert.equal(await fact.locator('input[type="password"]').count(), 0);
      assert.equal((await h.page.content()).includes(SECRET), false, 'the password is on the page');
    } finally {
      await h.close();
    }
  });

  void test('a sign-in code: the method is chosen, the code verified, and then connected', async () => {
    const verifies: StubCall[] = [];
    const pending = {
      ...OFF,
      status: 'pending_2fa',
      provider: 'clan',
      base_url: 'https://codesage.clan.biz/api/v1',
      account_email: 'forge@codesage.test',
      two_factor: { methods: ['email', 'google_authenticator'] },
    };
    const h = await integrations(
      orgStub('admin', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': pending,
        '/api/v1/org/hr/connect/verify': (call: StubCall) => {
          verifies.push(call);
          return connected();
        },
      }),
      '[data-section="hr"]',
    );
    try {
      const fact = hrCard(h);
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      await fillConnect(h, 'https://codesage.clan.biz');
      const codeForm = fact.getByRole('form', { name: 'Clan sign-in code' });
      await codeForm.waitFor({ timeout: 5_000 });
      assert.match(
        await codeForm.innerText(),
        /Enter the code Clan emailed you\. It works for 10 minutes\./,
      );
      const methods = codeForm.getByRole('group', { name: 'How Clan sends the code' });
      assert.equal(
        await methods.getByRole('button', { name: 'Email' }).getAttribute('aria-pressed'),
        'true',
      );
      await methods.getByRole('button', { name: 'Authenticator app' }).click();
      await until(async () => (await codeForm.innerText()).includes('authenticator app'));
      assert.match(await codeForm.innerText(), /Enter the code from your authenticator app/);
      await codeForm.getByRole('textbox', { name: 'Code' }).fill(' 123456 ');
      await codeForm.getByRole('button', { name: 'Verify' }).click();
      await until(() => verifies.length === 1);
      assert.deepEqual(verifies[0]?.body, { method: 'google_authenticator', code: '123456' });
      await until(async () => (await fact.getAttribute('data-hr-status')) === 'connected');
      assert.equal(await fact.getAttribute('data-hr-status'), 'connected');
      assert.match(
        await fact.locator('[data-hr-connected]').innerText(),
        /^Connected as Forge \(forge@codesage\.test\)/,
      );
    } finally {
      await h.close();
    }
  });

  void test('an expired code says so and goes back to the connect form, password empty', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': {
          ...OFF,
          status: 'pending_2fa',
          two_factor: { methods: ['email'] },
        },
        '/api/v1/org/hr/connect/verify': refused(409, 'conflict', 'two_factor_expired'),
      }),
      '[data-section="hr"]',
    );
    try {
      const fact = hrCard(h);
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      await fillConnect(h, 'https://codesage.clan.biz');
      const codeForm = fact.getByRole('form', { name: 'Clan sign-in code' });
      await codeForm.waitFor({ timeout: 5_000 });
      // One method: no choice to make.
      assert.equal(await codeForm.getByRole('group').count(), 0);
      await codeForm.getByRole('textbox', { name: 'Code' }).fill('000000');
      await codeForm.getByRole('button', { name: 'Verify' }).click();
      const alert = fact.locator('[role="alert"]');
      await alert.waitFor({ timeout: 5_000 });
      assert.equal(await alert.innerText(), 'The sign-in code expired. Connect again.');
      const form = fact.getByRole('form', { name: 'Connect Clan' });
      await form.waitFor();
      assert.equal(await form.locator('input[type="password"]').inputValue(), '');
    } finally {
      await h.close();
    }
  });

  void test('each refusal is in words, never Clan’s; the password is cleared each time', async () => {
    for (const [answer, words] of [
      [
        refused(422, 'unprocessable', 'clan_login_failed'),
        'Clan did not accept that email and password.',
      ],
      [
        refused(502, 'internal', 'clan_unreachable'),
        'Laika could not reach Clan at that address. Check the company URL.',
      ],
    ] as const) {
      const posts: StubCall[] = [];
      const h = await integrations(
        orgStub('owner', {
          '/api/v1/org/hr': OFF,
          '/api/v1/org/hr/connect': (call: StubCall) => {
            posts.push(call);
            return answer;
          },
        }),
        '[data-section="hr"]',
      );
      try {
        const fact = hrCard(h);
        await fact.getByRole('button', { name: 'Connect Clan' }).click();
        await fillConnect(h, 'https://codesage.clan.biz');
        const alert = fact.locator('[role="alert"]');
        await alert.waitFor({ timeout: 5_000 });
        assert.equal(await alert.innerText(), words);
        assert.doesNotMatch(await fact.innerText(), /Clan said/);
        const form = fact.getByRole('form', { name: 'Connect Clan' });
        assert.equal(await form.locator('input[type="password"]').inputValue(), '');
        // What was typed otherwise stays, to correct.
        assert.equal(
          await form.getByLabel('Clan address').inputValue(),
          'https://codesage.clan.biz',
        );
        assert.equal(posts.length, 1);
      } finally {
        await h.close();
      }
    }
  });

  void test('an address that is not https is refused before anything is sent', async () => {
    const posts: StubCall[] = [];
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': (call: StubCall) => {
          posts.push(call);
          return connected();
        },
      }),
      '[data-section="hr"]',
    );
    try {
      const fact = hrCard(h);
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      await fillConnect(h, 'http://codesage.clan.biz');
      await until(async () => (await fact.innerText()).includes('https:// address'));
      assert.match(await fact.innerText(), /Use the https:\/\/ address you sign in to Clan at\./);
      assert.equal(posts.length, 0);
    } finally {
      await h.close();
    }
  });
});

void describe('HR system: pasting a token', () => {
  const TOKEN = '123|tok-Zq8-never-echoed';

  void test('both ways are offered, signing in first; the line says to use a dedicated account', async () => {
    const h = await integrations(orgStub('owner', { '/api/v1/org/hr': OFF }));
    try {
      await hrCard(h).getByRole('button', { name: 'Connect Clan' }).click();
      const form = hrCard(h).getByRole('form', { name: 'Connect Clan' });
      const ways = form.getByRole('group', { name: 'How to connect' });
      await ways.waitFor();
      assert.deepEqual(
        await ways
          .getByRole('button')
          .evaluateAll((els) => els.map((el) => [el.textContent, el.getAttribute('aria-pressed')])),
        [
          ['Sign in with the account', 'true'],
          ['Paste a token', 'false'],
        ],
      );
      assert.equal(
        await form.locator('[data-hr-dedicated]').innerText(),
        'Use a dedicated, read-only Clan account (for example Forge) — never your own login. Laika keeps only a sign-in key, never the password.',
      );
      assert.equal(await form.getByLabel('Email').count(), 1);
      await ways.getByRole('button', { name: 'Paste a token' }).click();
      await until(async () => (await form.getByLabel('Email').count()) === 0);
      assert.equal(await form.getByLabel('Email').count(), 0, 'no email for a token');
      const token = form.locator('input[type="password"]');
      assert.equal(await token.inputValue(), '', 'the token field is never pre-filled');
      assert.equal(await token.getAttribute('autocomplete'), 'new-password');
      assert.equal(await form.getByLabel('Expires on').inputValue(), '');
    } finally {
      await h.close();
    }
  });

  void test('a token with its end date, and one without: each body as the server reads it', async () => {
    for (const [expires, body] of [
      [
        `${String(YEAR + 1)}-06-30`,
        {
          base_url: 'https://codesage.clan.biz',
          token: TOKEN,
          expires_on: `${String(YEAR + 1)}-06-30`,
        },
      ],
      ['', { base_url: 'https://codesage.clan.biz', token: TOKEN }],
    ] as const) {
      const posts: StubCall[] = [];
      const h = await integrations(
        orgStub('owner', {
          '/api/v1/org/hr': OFF,
          '/api/v1/org/hr/connect': (call: StubCall) => {
            posts.push(call);
            return connected({
              account_email: null,
              token_expires_at: expires === '' ? null : Date.now() + 200 * DAY,
              last_attempt_at: null,
              last_success_at: null,
              last_result: null,
            });
          },
        }),
      );
      try {
        const card = hrCard(h);
        await card.getByRole('button', { name: 'Connect Clan' }).click();
        const form = card.getByRole('form', { name: 'Connect Clan' });
        await form.getByRole('button', { name: 'Paste a token' }).click();
        await form.getByLabel('Clan address').fill('https://codesage.clan.biz');
        await form.locator('input[type="password"]').fill(` ${TOKEN} `);
        if (expires !== '') await form.getByLabel('Expires on').fill(expires);
        await form.getByRole('button', { name: 'Connect', exact: true }).click();
        await until(() => posts.length === 1);
        assert.deepEqual(posts[0]?.body, body);
        await until(async () => (await card.getAttribute('data-hr-status')) === 'connected');
        // No email for a token: the account by Clan's name alone.
        assert.match(
          await card.locator('[data-hr-connected]').innerText(),
          expires === ''
            ? /^Connected as Forge · token …a1b2$/
            : /^Connected as Forge · token …a1b2, renews by \d{1,2} [A-Z][a-z]{2} \d{4}$/,
        );
        assert.equal((await h.page.content()).includes(TOKEN), false, 'the token is on the page');
      } finally {
        await h.close();
      }
    }
  });

  void test('a refused token is in words, and the field is emptied', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': refused(422, 'unprocessable', 'clan_token_refused'),
      }),
    );
    try {
      const card = hrCard(h);
      await card.getByRole('button', { name: 'Connect Clan' }).click();
      const form = card.getByRole('form', { name: 'Connect Clan' });
      await form.getByRole('button', { name: 'Paste a token' }).click();
      await form.getByLabel('Clan address').fill('https://codesage.clan.biz');
      await form.locator('input[type="password"]').fill(TOKEN);
      await form.getByRole('button', { name: 'Connect', exact: true }).click();
      const alert = card.locator('[role="alert"]');
      await alert.waitFor({ timeout: 5_000 });
      assert.equal(
        await alert.innerText(),
        'Clan refused this token — check it was copied whole and finished its two-factor step.',
      );
      assert.equal(await form.locator('input[type="password"]').inputValue(), '');
      // Still the token way, to paste again.
      assert.equal(
        await form.getByRole('button', { name: 'Paste a token' }).getAttribute('aria-pressed'),
        'true',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('HR system: connected', () => {
  void test('a failed sync is in words, with the last good one; an expiring token warns', async () => {
    for (const [code, words] of [
      ['token_rejected', 'Clan refused the token — connect again'],
      ['unreachable', 'Laika could not reach Clan'],
      ['bad_answer', 'Clan answered with something Laika could not read'],
    ] as const) {
      const h = await integrations(
        orgStub('owner', {
          '/api/v1/org/hr': connected({
            expiring_soon: true,
            token_expires_at: Date.now() + 12 * DAY,
            last_attempt_at: ago(4),
            last_success_at: ago(3 * 60),
            last_error: { code, message: 'internal detail' },
          }),
        }),
        '[data-hr-sync]',
      );
      try {
        const fact = hrCard(h);
        const sync = fact.locator('[data-hr-sync]');
        assert.match(await sync.innerText(), new RegExp(`Last sync 4 min ago failed: ${words}\\.`));
        assert.match(
          await sync.innerText(),
          /Last good sync 3 h ago: 12 holidays · 340 leave days · 2 of 4 people matched\./,
        );
        assert.doesNotMatch(await fact.innerText(), /internal detail/);
        // Clan refused the token: a new one is one press away.
        assert.equal(
          await fact.getByRole('button', { name: 'Connect again' }).count(),
          1,
          `${code}: an expiring token offers Connect again`,
        );
        const line = fact.locator('[data-hr-connected]');
        assert.equal(await line.getAttribute('data-tone'), 'warning');
        const [drawn, warning] = await line.evaluate((el) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--chip-orange)';
          document.body.append(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return [getComputedStyle(el).color, want];
        });
        assert.equal(drawn, warning, 'the warning tone is the theme’s orange');
        assert.match(await fact.locator('[data-hr-expiring]').innerText(), /within 30 days/);
      } finally {
        await h.close();
      }
    }
  });

  void test('what the token can see: each warning only when the check found it cannot', async () => {
    for (const [sees_everyone, sees_departments, shown] of [
      [false, true, ['sees-everyone']],
      [true, false, ['sees-departments']],
      [false, false, ['sees-everyone', 'sees-departments']],
      [true, true, []],
    ] as const) {
      const h = await integrations(
        orgStub('owner', {
          '/api/v1/org/hr': connected({ sees_everyone, sees_departments }),
        }),
        '[data-hr-sync]',
      );
      try {
        const card = hrCard(h);
        assert.deepEqual(
          await card
            .locator('[data-hr-warning]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('data-hr-warning'))),
          shown,
          `sees_everyone ${String(sees_everyone)}, sees_departments ${String(sees_departments)}`,
        );
        if ((shown as readonly string[]).includes('sees-everyone')) {
          assert.equal(
            await card.locator('[data-hr-warning="sees-everyone"]').innerText(),
            'This token can only see one person’s leave — it needs an HR or admin role in Clan.',
          );
        }
        if ((shown as readonly string[]).includes('sees-departments')) {
          assert.equal(
            await card.locator('[data-hr-warning="sees-departments"]').innerText(),
            'People’s departments are hidden from this token, so holidays meant for some departments can’t be matched.',
          );
        }
        assert.equal(await card.locator('.org-count').innerText(), 'connected');
      } finally {
        await h.close();
      }
    }
  });

  void test('Sync now posts once, spins without changing its label, and shows the new counts', async () => {
    const syncs: StubCall[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': connected(),
        '/api/v1/org/hr/sync': (call: StubCall) => {
          syncs.push(call);
          return held.then(() =>
            connected({
              last_attempt_at: Date.now(),
              last_success_at: Date.now(),
              last_result: { ...RESULT, holidays: 13, leave_days: 351, matched: 3 },
            }),
          );
        },
      }),
      '[data-hr-sync]',
    );
    try {
      const fact = hrCard(h);
      assert.match(
        await fact.locator('[data-hr-counts]').innerText(),
        /^Last sync 4 min ago: 12 holidays · 340 leave days · 2 of 4 people matched\.$/,
      );
      const button = fact.getByRole('button', { name: 'Sync now' });
      await button.dblclick();
      await until(async () => (await button.getAttribute('aria-busy')) === 'true');
      assert.equal(await button.getAttribute('aria-busy'), 'true');
      assert.equal((await button.innerText()).trim(), 'Sync now', 'the label never swaps');
      assert.equal(await button.isDisabled(), true);
      release();
      await until(async () => (await fact.innerText()).includes('13 holidays'));
      assert.match(
        await fact.locator('[data-hr-counts]').innerText(),
        /^Last sync just now: 13 holidays · 351 leave days · 3 of 4 people matched\.$/,
      );
      assert.equal(syncs.length, 1, 'Sync now posted more than once');
      assert.equal(syncs[0]?.method, 'POST');
      assert.equal(await button.isDisabled(), false);
    } finally {
      await h.close();
    }
  });

  void test('Disconnect confirms that synced days stay, then forgets the connection', async () => {
    const hr = hrState(connected());
    const h = await integrations(
      orgStub('owner', { '/api/v1/org/hr': hr.route }),
      '[data-hr-sync]',
    );
    try {
      const fact = hrCard(h);
      await fact.getByRole('button', { name: 'Disconnect' }).click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Disconnect Clan\?/);
      assert.match(await dialog.innerText(), /Holidays and leave already synced stay as they are/);
      await dialog.getByRole('button', { name: 'Disconnect' }).click();
      await until(async () => (await fact.getAttribute('data-hr-status')) === 'off');
      assert.equal(await fact.getAttribute('data-hr-status'), 'off');
      assert.deepEqual(
        h.calls.filter((c) => c.path === '/api/v1/org/hr').map((c) => c.method),
        ['GET', 'DELETE', 'GET'],
      );
      assert.equal(await fact.getByRole('button', { name: 'Connect Clan' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('people: the matched count, and a picker for the unmatched and the owner-mapped', async () => {
    const puts: StubCall[] = [];
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': connected(),
        '/api/v1/org/hr/people': (call: StubCall) => {
          puts.push(call);
          return connected({
            people: [
              PEOPLE[0],
              { ...PEOPLE[1], user: { id: 'u2', name: 'Grace Hopper' }, matched_by: 'owner' },
              { ...PEOPLE[2], user: null, matched_by: 'owner' },
              PEOPLE[3],
            ],
          });
        },
      }),
      '[data-hr-people]',
    );
    try {
      const people = hrCard(h).locator('[data-hr-people]');
      assert.match(await people.innerText(), /People: 2 of 4 matched/);
      const rows = people.locator('[data-hr-person]');
      assert.deepEqual(
        await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-hr-person'))),
        ['c2', 'c3', 'c4'],
        'Ada, matched by email, is not offered',
      );
      const save = people.getByRole('button', { name: 'Save people' });
      assert.equal(await save.isDisabled(), true, 'nothing to save yet');

      const grace = people.getByRole('combobox', { name: 'Laika member for Grace Clan' });
      assert.match(await grace.innerText(), /Choose a member/);
      assert.match(
        await people
          .getByRole('combobox', { name: 'Laika member for Contractor Clan' })
          .innerText(),
        /Not on Laika/,
      );
      await grace.click();
      // Held by an owner's word: offered, greyed, and says whose.
      const linus = h.page.getByRole('option', { name: /^Linus Torvalds/ });
      await linus.waitFor();
      assert.equal(await linus.getAttribute('aria-disabled'), 'true');
      assert.match(await linus.innerText(), /matched to Linus Clan/);
      // Held only by an email match: the owner's word moves it, so it can be taken.
      const ada = h.page.getByRole('option', { name: /^Ada Lovelace/ });
      assert.equal(await ada.getAttribute('aria-disabled'), null);
      assert.match(await ada.innerText(), /matched by email to Ada Clan/);
      await h.page.getByRole('option', { name: /^Grace Hopper/ }).click();

      await people.getByRole('combobox', { name: 'Laika member for Linus Clan' }).click();
      await h.page.getByRole('option', { name: 'Not on Laika' }).click();

      await until(async () => !(await save.isDisabled()));
      await save.click();
      await until(() => puts.length === 1);
      assert.equal(puts[0]?.method, 'PUT');
      assert.deepEqual(puts[0]?.body, {
        people: [
          { external_id: 'c2', user_id: 'u2' },
          { external_id: 'c3', user_id: null },
        ],
      });
      await until(async () => (await people.innerText()).includes('People: 2 of 4 matched'));
      await until(async () => await save.isDisabled());
      assert.equal(await save.isDisabled(), true, 'the answer is what the server holds now');
      assert.match(await grace.innerText(), /Grace Hopper/);
    } finally {
      await h.close();
    }
  });
});

void describe('HR system: a sync under an unsaved pick', () => {
  void test('a pick for a person the sync then matches by email goes with the row: no Save, no PUT', async () => {
    const puts: StubCall[] = [];
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': connected(),
        '/api/v1/org/hr/sync': () =>
          connected({
            last_attempt_at: Date.now(),
            last_success_at: Date.now(),
            people: [
              PEOPLE[0],
              {
                ...PEOPLE[1],
                user: { id: 'u4', name: 'Katherine Johnson' },
                matched_by: 'email',
              },
              PEOPLE[2],
              PEOPLE[3],
            ],
          }),
        '/api/v1/org/hr/people': (call: StubCall) => {
          puts.push(call);
          return connected();
        },
      }),
      '[data-hr-people]',
    );
    try {
      const card = hrCard(h);
      const people = card.locator('[data-hr-people]');
      const save = people.getByRole('button', { name: 'Save people' });
      await people.getByRole('combobox', { name: 'Laika member for Grace Clan' }).click();
      await h.page.getByRole('option', { name: /^Grace Hopper/ }).click();
      await until(async () => !(await save.isDisabled()));
      assert.equal(await save.isDisabled(), false, 'the pick is a change to save');

      await card.getByRole('button', { name: 'Sync now' }).click();
      await until(async () => (await people.locator('[data-hr-person="c2"]').count()) === 0);
      assert.equal(await people.locator('[data-hr-person="c2"]').count(), 0, 'Grace left the form');
      await until(async () => await save.isDisabled());
      assert.equal(await save.isDisabled(), true, 'nothing on screen changed, so nothing to save');

      // Katherine is Grace's by email now: offered to another row, not greyed by the old pick.
      await people.getByRole('combobox', { name: 'Laika member for Linus Clan' }).click();
      const katherine = h.page.getByRole('option', { name: /^Katherine Johnson/ });
      await katherine.waitFor();
      assert.match(await katherine.innerText(), /matched by email to Grace Clan/);
      assert.equal(await katherine.getAttribute('aria-disabled'), null);
      const hopper = h.page.getByRole('option', { name: /^Grace Hopper/ });
      assert.doesNotMatch(await hopper.innerText(), /matched/);
      await h.page.keyboard.press('Escape');
      assert.equal(puts.length, 0, 'a PUT was sent');
    } finally {
      await h.close();
    }
  });
});

void describe('Holidays', () => {
  void test('a member reads this year and next, tagged, and is shown no HR system', async () => {
    const h = await organisation(orgStub('member', { '/api/v1/org/hr': connected() }));
    try {
      const fact = h.page.locator('[data-fact="holidays"]');
      assert.deepEqual(
        await fact
          .locator('[data-holiday-year]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-holiday-year'))),
        [String(YEAR), String(YEAR + 1)],
      );
      assert.deepEqual(
        await fact
          .locator('[data-holiday]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-holiday'))),
        ['h1', 'h2', 'h3'],
      );
      // Whom each covers: Clan's only ever the people Clan lists; one added here, everyone.
      const tags = (id: string) =>
        fact
          .locator(`[data-holiday="${id}"] [data-holiday-tag]`)
          .evaluateAll((els) =>
            els.map((el) => [el.getAttribute('data-holiday-tag'), el.textContent]),
          );
      assert.match(await fact.locator('[data-holiday="h2"]').innerText(), /Heritage Day/);
      assert.deepEqual(await tags('h1'), [
        ['clan', 'Clan'],
        ['clan-staff', 'Clan staff'],
      ]);
      assert.deepEqual(await tags('h2'), [
        ['clan', 'Clan'],
        ['some', 'Some people'],
      ]);
      assert.deepEqual(await tags('h3'), [['everyone', 'Everyone']]);
      assert.equal(await fact.getByRole('button').count(), 0, 'a member changes nothing');
      assert.equal(await fact.locator('input').count(), 0);
      // The window asked for: 1 Jan this year to 31 Dec next.
      assert.ok(
        h.requests.some(
          (r) =>
            r.url ===
            `/api/v1/org/holidays?from=${String(YEAR)}-01-01&to=${String(YEAR + 1)}-12-31`,
        ),
        `asked ${h.requests.map((r) => r.url).join(', ')}`,
      );
      // The HR system is not on Overview for anyone.
      assert.equal(await h.page.locator('[data-section="hr"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a member on Integrations is shown no HR system, and it is never asked', async () => {
    const h = await integrations(
      orgStub('member', { '/api/v1/org/hr': connected() }),
      '[data-section="prices"]',
    );
    try {
      assert.equal(await hrCard(h).count(), 0);
      assert.equal(h.calls.filter((c) => c.path.startsWith('/api/v1/org/hr')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('an owner adds a day and removes their own; a Clan day has no remove', async () => {
    const writes: StubCall[] = [];
    let exists = false;
    const h = await organisation(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/holidays': (call: StubCall) => {
          if (call.method !== 'POST') return { holidays: HOLIDAYS };
          writes.push(call);
          if (exists) return refused(409, 'conflict', 'holiday_exists');
          const body = call.body as { day: string; label: string };
          return reply(201, { id: 'h9', ...body, source: 'manual', everyone: true });
        },
        '/api/v1/org/holidays/h3': (call: StubCall) => {
          writes.push(call);
          return reply(204, null);
        },
      }),
    );
    try {
      const fact = h.page.locator('[data-fact="holidays"]');
      assert.equal(await fact.locator('[data-holiday="h1"]').getByRole('button').count(), 0);
      assert.equal(await fact.locator('[data-holiday="h2"]').getByRole('button').count(), 0);
      assert.equal(await fact.locator('[data-holiday="h3"]').getByRole('button').count(), 1);

      await fact.getByRole('button', { name: 'Add a holiday' }).click();
      const form = fact.getByRole('form', { name: 'Add a holiday' });
      const add = form.getByRole('button', { name: 'Add holiday' });
      assert.equal(await add.isDisabled(), true, 'a day and a name first');
      await form.getByLabel('Day').fill(`${String(YEAR + 1)}-06-16`);
      await form.getByLabel('Name').fill(' Youth Day ');
      await add.click();
      await until(() => writes.length === 1);
      assert.equal(writes[0]?.method, 'POST');
      assert.deepEqual(writes[0]?.body, { day: `${String(YEAR + 1)}-06-16`, label: 'Youth Day' });
      await fact.locator('[data-holiday="h9"]').waitFor({ timeout: 5_000 });
      assert.deepEqual(
        await fact
          .locator(`[data-holiday-year="${String(YEAR + 1)}"] [data-holiday]`)
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-holiday'))),
        ['h3', 'h9'],
      );

      await fact.getByRole('button', { name: /^Remove Company day/ }).click();
      await until(() => writes.length === 2);
      assert.equal(writes[1]?.method, 'DELETE');
      assert.equal(writes[1]?.path, '/api/v1/org/holidays/h3');
      await until(async () => (await fact.locator('[data-holiday="h3"]').count()) === 0);
      assert.equal(await fact.locator('[data-holiday="h3"]').count(), 0);

      // A day that already has one: said in words, and the form stays.
      exists = true;
      await fact.getByRole('button', { name: 'Add a holiday' }).click();
      await form.getByLabel('Day').fill(`${String(YEAR)}-12-25`);
      await form.getByLabel('Name').fill('Christmas');
      await form.getByRole('button', { name: 'Add holiday' }).click();
      const alert = fact.locator('[role="alert"]');
      await alert.waitFor({ timeout: 5_000 });
      assert.equal(await alert.innerText(), 'There is already a holiday on that day.');
      assert.equal(await form.getByLabel('Name').inputValue(), 'Christmas');
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, 1440 and 390', () => {
  /**
   * Every theme × width: no sideways scroll, no text under 12 px, and nothing
   * drawn past the card — the card inside the viewport, and every visible
   * element inside the card.
   *
   * **The page-wide scroll check alone cannot see a clipped card** (CHIEF's
   * LAI-1182 review): the shell hides horizontal overflow, so at 390 every
   * Integrations card was 499 px wide, cut at the screen's edge, and
   * `scrollWidth` still equalled the viewport. Measuring each element against
   * the card, and the card against the viewport, is what sees it.
   */
  async function fits(h: Harness, root: string): Promise<void> {
    // A selector that resolves to nothing would pass every check below vacuously.
    assert.ok((await h.page.locator(root).count()) > 0, `${root} absent`);
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
        assert.ok((await spill()) <= 0, `${theme} at ${String(width)}: sideways`);
        const smallest = await h.page.evaluate((selector) => {
          let min = Infinity;
          for (const el of document.querySelector(selector)?.querySelectorAll('*') ?? []) {
            if (el.textContent?.trim() === '' || el.closest('svg') !== null) continue;
            min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
          }
          return min;
        }, root);
        assert.ok(smallest >= 12, `${theme} at ${String(width)}: text at ${String(smallest)}px`);
        const lost = await h.page.evaluate((selector) => {
          const node = document.querySelector(selector);
          const card = node?.closest('.org-card') ?? node;
          if (node === null || card === null || card === undefined) return [`${selector} absent`];
          const edge = card.getBoundingClientRect().right;
          const out: string[] = [];
          if (edge > window.innerWidth + 1) {
            out.push(`the card ends at ${edge.toFixed(0)}, past ${String(window.innerWidth)}`);
          }
          for (const el of node.querySelectorAll('*')) {
            const box = el.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;
            if (getComputedStyle(el).visibility === 'hidden') continue;
            if (box.right > edge + 1) {
              out.push(
                `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''} ends at ` +
                  `${box.right.toFixed(0)}, past the card's ${edge.toFixed(0)}`,
              );
            }
          }
          return out;
        }, root);
        assert.deepEqual(lost, [], `${theme} at ${String(width)}: drawn past the card`);
      }
    }
  }

  void test('the HR card, connected with warnings and people: it fits', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': connected({
          expiring_soon: true,
          sees_everyone: false,
          sees_departments: false,
        }),
      }),
      '[data-hr-people]',
    );
    try {
      await fits(h, '[data-section="hr"]');
      // On a phone each person stacks: the name, then the picker across the row.
      await h.page.setViewportSize({ width: 390, height: 844 });
      const rows = await h.page.locator('[data-hr-person]').evaluateAll((els) =>
        els.map((row) => {
          const name = row.querySelector('.org-hr-person-name')?.getBoundingClientRect();
          const pick = row.querySelector('.org-hr-pick')?.getBoundingClientRect();
          const box = row.getBoundingClientRect();
          return {
            below: name !== undefined && pick !== undefined && pick.top >= name.bottom - 1,
            // Right under it: the name's box is its words (two lines at most), not a
            // flex basis turned into a height that leaves empty rows above the picker.
            close:
              name !== undefined &&
              pick !== undefined &&
              name.height <= 48 &&
              pick.top - name.bottom <= 16,
            full: pick !== undefined && pick.width >= box.width - 1,
          };
        }),
      );
      assert.equal(rows.length, 3);
      assert.deepEqual(
        rows,
        rows.map(() => ({ below: true, close: true, full: true })),
        'a picker beside its name, or narrower than the row, at 390',
      );
    } finally {
      await h.close();
    }
  });

  void test('the Holidays fact, its add form open: it fits', async () => {
    const h = await organisation(orgStub('owner'));
    try {
      await h.page
        .locator('[data-fact="holidays"]')
        .getByRole('button', { name: 'Add a holiday' })
        .click();
      await fits(h, '[data-fact="holidays"]');
    } finally {
      await h.close();
    }
  });

  void test('the connect form, either way, and the code step: each fits', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': {
          ...OFF,
          status: 'pending_2fa',
          two_factor: { methods: ['email', 'google_authenticator'] },
        },
      }),
    );
    try {
      const card = hrCard(h);
      await card.getByRole('button', { name: 'Connect Clan' }).click();
      const form = card.getByRole('form', { name: 'Connect Clan' });
      await form.waitFor();
      await fits(h, '[data-section="hr"]');
      await form.getByRole('button', { name: 'Paste a token' }).click();
      await form.getByLabel('Expires on').waitFor();
      await fits(h, '[data-section="hr"]');
      await form.getByRole('button', { name: 'Sign in with the account' }).click();
      await fillConnect(h, 'https://codesage.clan.biz');
      await card.getByRole('form', { name: 'Clan sign-in code' }).waitFor({ timeout: 5_000 });
      await fits(h, '[data-section="hr"]');
    } finally {
      await h.close();
    }
  });
});
