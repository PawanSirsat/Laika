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
  account_email: null,
  token_last4: null,
  token_expires_at: null,
  expiring_soon: false,
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
  base_url: 'https://acme.clan.biz/api/v1',
  account_email: 'hr@acme.test',
  token_last4: 'a1b2',
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

async function organisation(stub: ApiStub, ready = '[data-fact="holidays"]'): Promise<Harness> {
  const h = await openPage('/organisation', stub);
  await h.page.locator(ready).waitFor({ timeout: 20_000 });
  return h;
}

const hrFact = (h: Harness) => h.page.locator('[data-fact="hr"]');

async function fillConnect(h: Harness, url: string): Promise<void> {
  const form = hrFact(h).getByRole('form', { name: 'Connect Clan' });
  await form.getByLabel('Company URL').fill(url);
  await form.getByLabel('Email').fill('hr@acme.test');
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
    const h = await organisation(
      orgStub('owner', {
        '/api/v1/org/hr': hr.route,
        '/api/v1/org/hr/connect': (call: StubCall) => {
          posts.push(call);
          hr.set(connected({ last_attempt_at: null, last_success_at: null, last_result: null }));
          return connected({ last_attempt_at: null, last_success_at: null, last_result: null });
        },
      }),
      '[data-fact="hr"]',
    );
    try {
      const fact = hrFact(h);
      assert.equal(await fact.getAttribute('data-hr-status'), 'off');
      assert.equal(
        await fact.locator('[data-hr-lead]').innerText(),
        'Holidays and leave from Clan, every 30 minutes. Laika keeps the sign-in token, never the password.',
      );
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      const form = fact.getByRole('form', { name: 'Connect Clan' });
      await form.waitFor();
      assert.equal(
        await form.getByLabel('Company URL').getAttribute('placeholder'),
        'https://yourcompany.clan.biz',
      );
      const password = form.locator('input[type="password"]');
      assert.equal(await password.inputValue(), '', 'the password field is never pre-filled');
      assert.equal(await password.getAttribute('autocomplete'), 'new-password');

      await fillConnect(h, 'https://acme.clan.biz');
      await until(() => posts.length === 1);
      assert.equal(posts.length, 1);
      assert.equal(posts[0]?.method, 'POST');
      assert.deepEqual(posts[0]?.body, {
        base_url: 'https://acme.clan.biz',
        email: 'hr@acme.test',
        password: SECRET,
      });

      await until(async () => (await fact.getAttribute('data-hr-status')) === 'connected');
      assert.equal(await fact.getAttribute('data-hr-status'), 'connected');
      assert.match(
        await fact.locator('[data-hr-connected]').innerText(),
        /^Connected as hr@acme\.test · token …a1b2, renews by \d{1,2} [A-Z][a-z]{2} \d{4}$/,
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
      base_url: 'https://acme.clan.biz/api/v1',
      account_email: 'hr@acme.test',
      two_factor: { methods: ['email', 'google_authenticator'] },
    };
    const h = await organisation(
      orgStub('admin', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': pending,
        '/api/v1/org/hr/connect/verify': (call: StubCall) => {
          verifies.push(call);
          return connected();
        },
      }),
      '[data-fact="hr"]',
    );
    try {
      const fact = hrFact(h);
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      await fillConnect(h, 'https://acme.clan.biz');
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
        /^Connected as hr@acme\.test/,
      );
    } finally {
      await h.close();
    }
  });

  void test('an expired code says so and goes back to the connect form, password empty', async () => {
    const h = await organisation(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': {
          ...OFF,
          status: 'pending_2fa',
          two_factor: { methods: ['email'] },
        },
        '/api/v1/org/hr/connect/verify': refused(409, 'conflict', 'two_factor_expired'),
      }),
      '[data-fact="hr"]',
    );
    try {
      const fact = hrFact(h);
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      await fillConnect(h, 'https://acme.clan.biz');
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
      const h = await organisation(
        orgStub('owner', {
          '/api/v1/org/hr': OFF,
          '/api/v1/org/hr/connect': (call: StubCall) => {
            posts.push(call);
            return answer;
          },
        }),
        '[data-fact="hr"]',
      );
      try {
        const fact = hrFact(h);
        await fact.getByRole('button', { name: 'Connect Clan' }).click();
        await fillConnect(h, 'https://acme.clan.biz');
        const alert = fact.locator('[role="alert"]');
        await alert.waitFor({ timeout: 5_000 });
        assert.equal(await alert.innerText(), words);
        assert.doesNotMatch(await fact.innerText(), /Clan said/);
        const form = fact.getByRole('form', { name: 'Connect Clan' });
        assert.equal(await form.locator('input[type="password"]').inputValue(), '');
        // What was typed otherwise stays, to correct.
        assert.equal(await form.getByLabel('Company URL').inputValue(), 'https://acme.clan.biz');
        assert.equal(posts.length, 1);
      } finally {
        await h.close();
      }
    }
  });

  void test('an address that is not https is refused before anything is sent', async () => {
    const posts: StubCall[] = [];
    const h = await organisation(
      orgStub('owner', {
        '/api/v1/org/hr': OFF,
        '/api/v1/org/hr/connect': (call: StubCall) => {
          posts.push(call);
          return connected();
        },
      }),
      '[data-fact="hr"]',
    );
    try {
      const fact = hrFact(h);
      await fact.getByRole('button', { name: 'Connect Clan' }).click();
      await fillConnect(h, 'http://acme.clan.biz');
      await until(async () => (await fact.innerText()).includes('https:// address'));
      assert.match(await fact.innerText(), /Use the https:\/\/ address you sign in to Clan at\./);
      assert.equal(posts.length, 0);
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
      const h = await organisation(
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
        const fact = hrFact(h);
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

  void test('Sync now posts once, spins without changing its label, and shows the new counts', async () => {
    const syncs: StubCall[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const h = await organisation(
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
      const fact = hrFact(h);
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
    const h = await organisation(
      orgStub('owner', { '/api/v1/org/hr': hr.route }),
      '[data-hr-sync]',
    );
    try {
      const fact = hrFact(h);
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
    const h = await organisation(
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
      const people = hrFact(h).locator('[data-hr-people]');
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
      const heritage = fact.locator('[data-holiday="h2"]');
      assert.match(await heritage.innerText(), /Heritage Day/);
      assert.equal(await heritage.locator('[data-holiday-tag="clan"]').innerText(), 'Clan');
      assert.equal(await heritage.locator('[data-holiday-tag="some"]').innerText(), 'Some people');
      assert.equal(await fact.locator('[data-holiday="h1"] [data-holiday-tag="some"]').count(), 0);
      assert.equal(await fact.locator('[data-holiday="h3"] [data-holiday-tag]').count(), 0);
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
      // No HR system for a member: not drawn, and never asked.
      assert.equal(await h.page.locator('[data-fact="hr"]').count(), 0);
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
  void test('connected with people, and the forms open: no sideways scroll, no type under 12 px', async () => {
    const h = await organisation(
      orgStub('owner', { '/api/v1/org/hr': connected({ expiring_soon: true }) }),
      '[data-hr-people]',
    );
    try {
      await h.page
        .locator('[data-fact="holidays"]')
        .getByRole('button', { name: 'Add a holiday' })
        .click();
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
          const smallest = await h.page.evaluate(() => {
            let min = Infinity;
            for (const root of document.querySelectorAll(
              '[data-fact="hr"], [data-fact="holidays"]',
            )) {
              for (const el of root.querySelectorAll('*')) {
                if (el.textContent?.trim() === '' || el.closest('svg') !== null) continue;
                min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
              }
            }
            return min;
          });
          assert.ok(smallest >= 12, `${theme} at ${String(width)}: text at ${String(smallest)}px`);
          // Every row of the people map and the holidays stays inside the card.
          const outside = await h.page.evaluate(() => {
            const card = document.querySelector('[data-fact="hr"]')?.closest('.org-card');
            const edge = card?.getBoundingClientRect().right ?? 0;
            return [...document.querySelectorAll('[data-hr-person], [data-holiday]')].filter(
              (el) => el.getBoundingClientRect().right > edge + 0.5,
            ).length;
          });
          assert.equal(outside, 0, `${theme} at ${String(width)}: a row overflows the card`);
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('the connect form at 390 in both themes fits', async () => {
    const h = await organisation(orgStub('owner', { '/api/v1/org/hr': OFF }), '[data-fact="hr"]');
    try {
      await hrFact(h).getByRole('button', { name: 'Connect Clan' }).click();
      await hrFact(h).getByRole('form', { name: 'Connect Clan' }).waitFor();
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 390, height: 844 });
        const spill = () =>
          h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await until(async () => (await spill()) <= 0);
        assert.ok((await spill()) <= 0, `${theme} at 390: sideways`);
      }
    } finally {
      await h.close();
    }
  });
});
