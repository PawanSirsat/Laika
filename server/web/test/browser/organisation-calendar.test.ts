/**
 * The Outlook calendar card on Organisation → Integrations (D-157,
 * LAI-1316), in a real browser against stubbed `/org/calendar*`: an owner
 * saves the app's credentials and a rule, tests the connection with and
 * without `Calendars.Read`, flips the switch and syncs; a member is shown no
 * card and it is never asked; and the card fits in both themes at 1440 and
 * 390.
 *
 * `LAIKA_SHOTS=<dir>` also writes the card's screenshots there.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

// The folded sections this file reads inside open as a returning viewer has them (LAI-1345).
openSectionsByDefault('calendar');

const MINUTE = 60_000;
const TENANT = '5abd4f6b-f235-4d86-a90c-08f2e5f56fbb';
const CLIENT = 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd';
/** A secret nothing else on the page could contain by accident. */
const SECRET = 'cs~Zq8.never-echoed-by-the-page';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const project = (id: string, slug: string, name: string, prefix: string) => ({
  id,
  slug,
  name,
  prefix,
  description: null,
  repo: null,
  visibility: 'private',
  color: null,
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: null,
});

const PROJECTS = [project('p1', 'laika', 'Laika', 'LAI'), project('p2', 'ksage', 'Ksage', 'KSG')];

const OFF = {
  configured: false,
  enabled: false,
  tenant_id: null,
  client_id: null,
  secret_last4: null,
  rules: [],
  sync_every_minutes: 15,
  last_test: null,
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  last_result: null,
};

/** `minutes` before now, read when the fixture is built — the page reads it moments later. */
const ago = (minutes: number): number => Date.now() - minutes * MINUTE;

const saved = (patch: Record<string, unknown> = {}) => ({
  ...OFF,
  configured: true,
  tenant_id: TENANT,
  client_id: CLIENT,
  secret_last4: 'page',
  rules: [{ kind: 'title', text: 'standup', project: { id: 'p1', slug: 'laika', name: 'Laika' } }],
  ...patch,
});

const RESULT = {
  people: 9,
  no_mailbox: 1,
  mailbox_denied: 1,
  mailbox_refused: 0,
  meetings: 14,
  not_a_meeting: 0,
  created: 3,
  updated: 1,
  removed: 1,
  unchanged: 9,
  kept_edits: 2,
  skipped: 0,
};

/** The server's default grants for this role, plus `org.calendar.configure` for an owner or admin. */
function permissionsFor(role: string): unknown {
  const base = defaultPermissions({ org_role: role, memberships: [] }) as {
    readonly me: { readonly actions: readonly string[] };
  };
  const cal = role === 'owner' || role === 'admin' ? ['org.calendar.configure'] : [];
  return { ...base, me: { ...base.me, actions: [...base.me.actions, ...cal] } };
}

function orgStub(role: string, extra: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': { ...user('u1', 'Ada Lovelace', role), memberships: [] },
    '/api/v1/projects': { data: PROJECTS, next_cursor: null },
    '/api/v1/users': { data: [user('u1', 'Ada Lovelace', role)], next_cursor: null },
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
    '/api/v1/org/holidays': { holidays: [] },
    '/api/v1/org/model-prices': { as_of: '2026-10-18', can_set: false, entries: [] },
    ...extra,
  };
}

/** `GET`, `PUT` and `DELETE /org/calendar` from state a test can change. */
function calendarState(initial: unknown) {
  let state = initial;
  const puts: unknown[] = [];
  return {
    puts,
    set: (next: unknown) => {
      state = next;
    },
    route: (call: StubCall) => {
      if (call.method === 'DELETE') {
        state = OFF;
        return reply(204, null);
      }
      if (call.method === 'PUT') {
        const body = call.body as {
          tenant_id: string;
          client_id: string;
          client_secret?: string;
          enabled: boolean;
          rules: { kind: string; text: string; project: string }[];
        };
        puts.push(body);
        state = saved({
          tenant_id: body.tenant_id,
          client_id: body.client_id,
          enabled: body.enabled,
          secret_last4:
            body.client_secret === undefined
              ? ((state as { secret_last4: string | null }).secret_last4 ?? null)
              : body.client_secret.slice(-4),
          rules: body.rules.map((r) => {
            const p = PROJECTS.find((x) => x.slug === r.project);
            return {
              kind: r.kind,
              text: r.text,
              project: p === undefined ? null : { id: p.id, slug: p.slug, name: p.name },
            };
          }),
        });
      }
      return state;
    },
  };
}

/** Integrations, where the calendar card is. */
async function integrations(stub: ApiStub, ready = '[data-section="calendar"]'): Promise<Harness> {
  const h = await openPage('/organisation?tab=calendar', stub);
  await h.page.locator(ready).waitFor({ timeout: 20_000 });
  return h;
}

const card = (h: Harness) => h.page.locator('[data-section="calendar"]');

void after(async () => {
  await closeBrowser();
});

void describe('Outlook calendar: setting it up', () => {
  void test('off → save the app and a rule; the secret is sent once and shown never', async () => {
    const cal = calendarState(OFF);
    const h = await integrations(orgStub('owner', { '/api/v1/org/calendar': cal.route }));
    try {
      const c = card(h);
      assert.equal(await c.getAttribute('data-calendar-status'), 'not set up');
      const lead = await c.locator('[data-calendar-lead]').innerText();
      assert.match(lead, /accepted an\s+invitation to/);
      // The owner's rule of 2026-11-18: only a Teams meeting they organised.
      assert.match(lead, /Teams meetings they organised/);
      assert.match(lead, /not a Teams meeting, like lunch or focus time, is left off/);
      assert.match(lead, /never join links/);
      assert.match(lead, /“Busy”/);
      assert.match(lead, /later syncs leave it alone/);
      // The switch cannot be turned on with nothing saved.
      const toggle = c.getByRole('switch');
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      assert.equal(await toggle.isDisabled(), true);
      // Nothing saved: no test, no sync.
      assert.equal(await c.getByRole('button', { name: 'Test connection' }).count(), 0);

      // Saving with nothing typed names each field and sends nothing.
      const form = c.getByRole('form', { name: 'Outlook calendar settings' });
      await form.getByRole('button', { name: 'Add a rule' }).click();
      await form.getByLabel('Directory (tenant) ID').fill('contoso');
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await until(async () => (await form.locator('.field-error').count()) >= 2);
      assert.match(await form.innerText(), /a domain such as contoso\.onmicrosoft\.com/);
      assert.match(await form.innerText(), /Paste the client secret/);
      assert.equal(cal.puts.length, 0);

      await form.getByLabel('Directory (tenant) ID').fill(TENANT);
      await form.getByLabel('Application (client) ID').fill(CLIENT);
      await form.locator('input[type="password"]').fill(SECRET);
      await form.getByLabel('Words in the title, rule 1').fill('standup');
      await form.getByRole('combobox', { name: 'Space, rule 1' }).click();
      await h.page.getByRole('option', { name: 'Laika' }).click();
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await until(async () => (await c.getAttribute('data-calendar-status')) === 'off');

      assert.deepEqual(cal.puts, [
        {
          tenant_id: TENANT,
          client_id: CLIENT,
          client_secret: SECRET,
          enabled: false,
          rules: [{ kind: 'title', text: 'standup', project: 'laika' }],
        },
      ]);
      assert.equal(await form.locator('input[type="password"]').inputValue(), '');
      assert.match(await form.innerText(), /Saved, ending ···page/);
      assert.equal((await h.page.content()).includes(SECRET), false, 'the secret is on the page');
      // Saved, the switch can be turned on and the connection tested.
      assert.equal(await c.getByRole('switch').isDisabled(), false);
      assert.equal(await c.getByRole('button', { name: 'Test connection' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a refusal naming a field marks that field, in words', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': (call: StubCall) =>
          call.method === 'PUT'
            ? reply(422, {
                error: {
                  code: 'unprocessable',
                  message: 'tenant_id is invalid',
                  details: { field: 'tenant_id', reason: 'tenant_invalid' },
                },
              })
            : OFF,
      }),
    );
    try {
      const form = card(h).getByRole('form', { name: 'Outlook calendar settings' });
      await form.getByLabel('Directory (tenant) ID').fill(TENANT);
      await form.getByLabel('Application (client) ID').fill(CLIENT);
      await form.locator('input[type="password"]').fill(SECRET);
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await until(async () => (await form.innerText()).includes('That is not a tenant ID'));
      assert.match(await form.innerText(), /That is not a tenant ID/);
      // The server's words, and only those: a blank secret is not asked for yet.
      assert.equal((await form.innerText()).includes('Paste the client secret'), false);
      // Refused or not, the secret is gone from the form.
      assert.equal(await form.locator('input[type="password"]').inputValue(), '');
    } finally {
      await h.close();
    }
  });
});

void describe('Outlook calendar: testing the connection', () => {
  void test('granted: says so and lists the roles, with the switch still off', async () => {
    const tested: StubCall[] = [];
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': saved(),
        '/api/v1/org/calendar/test': (call: StubCall) => {
          tested.push(call);
          return saved({
            last_test: {
              at: Date.now(),
              calendars_read: true,
              roles: ['User.Read.All', 'Calendars.Read'],
            },
          });
        },
      }),
    );
    try {
      const c = card(h);
      assert.match(await c.locator('[data-calendar-test]').innerText(), /Not tested yet/);
      await c.getByRole('button', { name: 'Test connection' }).click();
      await until(async () => (await c.locator('[data-calendar-granted]').count()) > 0);
      assert.equal(
        await c.locator('[data-calendar-granted]').getAttribute('data-calendar-granted'),
        'true',
      );
      assert.match(
        await c.locator('[data-calendar-granted]').innerText(),
        /^Connected\. Microsoft grants Calendars\.Read\. Tested just now\.$/,
      );
      assert.equal(
        await c.locator('[data-calendar-roles]').innerText(),
        'Permissions on the token: Calendars.Read, User.Read.All.',
      );
      assert.equal(await c.locator('[data-calendar-grant]').count(), 0);
      assert.equal(tested.length, 1);
      assert.equal(tested[0]?.method, 'POST');
      assert.equal(await c.getByRole('switch').getAttribute('aria-checked'), 'false');
    } finally {
      await h.close();
    }
  });

  void test('not granted: says what an Entra admin does', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': saved({
          last_test: { at: ago(3), calendars_read: false, roles: [] },
        }),
      }),
      '[data-calendar-granted]',
    );
    try {
      const c = card(h);
      assert.equal(
        await c.locator('[data-calendar-granted]').getAttribute('data-calendar-granted'),
        'false',
      );
      assert.match(
        await c.locator('[data-calendar-granted]').innerText(),
        /does not grant Calendars\.Read yet/,
      );
      assert.match(await c.locator('[data-calendar-roles]').innerText(), /: none\.$/);
      const grant = await c.locator('[data-calendar-grant]').innerText();
      assert.match(grant, /Application permissions/);
      assert.match(grant, /Grant admin consent/);
    } finally {
      await h.close();
    }
  });

  void test('Microsoft refusing the credentials is in words', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': saved(),
        '/api/v1/org/calendar/test': reply(422, {
          error: {
            code: 'unprocessable',
            message: 'AADSTS7000215: Invalid client secret provided.',
            details: { reason: 'graph_credentials_refused' },
          },
        }),
      }),
    );
    try {
      const c = card(h);
      await c.getByRole('button', { name: 'Test connection' }).click();
      const alert = c.getByRole('alert');
      await alert.waitFor();
      assert.match(await alert.innerText(), /Microsoft refused that tenant, client ID or secret/);
      assert.equal(
        (await c.innerText()).includes('AADSTS'),
        false,
        'Microsoft’s words reached the page',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Outlook calendar: the switch and syncing', () => {
  void test('the switch saves at once, as saved; on, Sync now posts and shows the counts', async () => {
    const cal = calendarState(saved());
    const syncs: StubCall[] = [];
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': cal.route,
        '/api/v1/org/calendar/sync': (call: StubCall) => {
          syncs.push(call);
          const next = saved({
            enabled: true,
            last_attempt_at: Date.now(),
            last_success_at: Date.now(),
            last_result: RESULT,
          });
          cal.set(next);
          return next;
        },
      }),
    );
    try {
      const c = card(h);
      assert.equal(await c.getByRole('button', { name: 'Sync now' }).count(), 0);
      assert.match(await c.locator('[data-calendar-last]').innerText(), /the switch is off/);
      await c.getByRole('switch').click();
      await until(async () => (await c.getAttribute('data-calendar-status')) === 'on');
      assert.deepEqual(cal.puts, [
        {
          tenant_id: TENANT,
          client_id: CLIENT,
          enabled: true,
          rules: [{ kind: 'title', text: 'standup', project: 'laika' }],
        },
      ]);
      await c.getByRole('button', { name: 'Sync now' }).click();
      await until(async () => (await c.locator('[data-calendar-counts]').count()) > 0);
      assert.equal(
        await c.locator('[data-calendar-counts]').innerText(),
        'Last sync just now: 14 meetings · 3 logged · 1 updated · 1 removed · 2 left as people changed them · 9 people, 1 with no Outlook calendar, 1 whose calendar Microsoft would not open.',
      );
      assert.equal(syncs.length, 1);
    } finally {
      await h.close();
    }
  });

  void test('a failed sync is in words, with the last good one', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': saved({
          enabled: true,
          last_attempt_at: ago(2),
          last_success_at: ago(20),
          last_error: { code: 'not_granted', message: 'x' },
          last_result: RESULT,
        }),
      }),
      '[data-calendar-sync-error]',
    );
    try {
      const text = await card(h).locator('[data-calendar-last]').innerText();
      assert.match(text, /failed: Microsoft has not granted Calendars\.Read to the app yet\./);
      assert.match(text, /Last good sync 20 min ago: 14 meetings/);
    } finally {
      await h.close();
    }
  });

  void test('Disconnect confirms that logged meetings stay, then forgets the app', async () => {
    const cal = calendarState(saved({ enabled: true }));
    const h = await integrations(orgStub('owner', { '/api/v1/org/calendar': cal.route }));
    try {
      const c = card(h);
      await c.getByRole('button', { name: 'Disconnect' }).click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Disconnect Outlook\?/);
      assert.match(await dialog.innerText(), /Meetings already logged stay/);
      await dialog.getByRole('button', { name: 'Disconnect' }).click();
      await until(async () => (await c.getAttribute('data-calendar-status')) === 'not set up');
      assert.deepEqual(
        h.calls.filter((call) => call.path === '/api/v1/org/calendar').map((call) => call.method),
        ['GET', 'DELETE', 'GET'],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Outlook calendar: who sees it', () => {
  void test('a member on Integrations is shown no calendar card, and it is never asked', async () => {
    const h = await integrations(orgStub('member'), '[data-section="prices"]');
    try {
      await h.page.waitForTimeout(300);
      assert.equal(await card(h).count(), 0);
      assert.equal(
        h.calls.filter((call) => call.path.startsWith('/api/v1/org/calendar')).length,
        0,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, 1440 and 390', () => {
  /** No sideways scroll, no text under 12 px, nothing drawn past the card (LAI-1182's measure). */
  async function fits(h: Harness, root: string): Promise<void> {
    assert.ok((await h.page.locator(root).count()) > 0, `${root} absent`);
    const shots = process.env.LAIKA_SHOTS;
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
          const box0 = node?.closest('.org-card') ?? node;
          if (node === null || box0 === null || box0 === undefined) return [`${selector} absent`];
          const edge = box0.getBoundingClientRect().right;
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
        if (shots !== undefined && shots !== '') {
          // Tall enough for the whole card: the shell scrolls inside itself,
          // so an element shot past the viewport comes out blank.
          mkdirSync(shots, { recursive: true });
          await h.page.setViewportSize({ width, height: 3000 });
          await h.page.waitForTimeout(400);
          await h.page.locator(root).screenshot({
            path: join(shots, `calendar-card-${theme.toLowerCase()}-${String(width)}.png`),
          });
          await h.page.setViewportSize({ width, height });
        }
      }
    }
  }

  void test('the card, saved, tested without the permission, with rules and a failed sync: it fits', async () => {
    const h = await integrations(
      orgStub('owner', {
        '/api/v1/org/calendar': saved({
          enabled: true,
          rules: [
            {
              kind: 'title',
              text: 'standup',
              project: { id: 'p1', slug: 'laika', name: 'Laika' },
            },
            {
              kind: 'channel',
              text: 'Ksage engineering — weekly planning and review',
              project: { id: 'p2', slug: 'ksage', name: 'Ksage' },
            },
          ],
          last_test: {
            at: ago(5),
            calendars_read: false,
            roles: ['User.Read.All', 'Group.Read.All'],
          },
          last_attempt_at: ago(2),
          last_success_at: ago(20),
          last_error: { code: 'not_granted', message: 'x' },
          last_result: RESULT,
        }),
      }),
      '[data-calendar-rule="1"]',
    );
    try {
      await fits(h, '[data-section="calendar"]');
      // On a phone a rule stacks: the match and its remove on one line, then
      // the words, then the space, each across the card.
      await h.page.setViewportSize({ width: 390, height: 844 });
      const rows = await h.page.locator('[data-calendar-rule]').evaluateAll((els) =>
        els.map((row) => {
          const box = row.getBoundingClientRect();
          const text = row.querySelector('.org-cal-rule-text')?.getBoundingClientRect();
          const kind = row.querySelector('.org-cal-rule-kind')?.getBoundingClientRect();
          return {
            below: text !== undefined && kind !== undefined && text.top >= kind.bottom - 1,
            full: text !== undefined && text.width >= box.width - 1,
          };
        }),
      );
      assert.deepEqual(
        rows,
        rows.map(() => ({ below: true, full: true })),
        'a rule’s words beside its match, or narrower than the row, at 390',
      );
    } finally {
      await h.close();
    }
  });
});
