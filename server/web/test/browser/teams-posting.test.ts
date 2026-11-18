/**
 * Teams posting (D-154, LAI-1314) in a real browser against stubbed
 * `/org/teams` and `/projects/:slug/teams*`: an owner turns the switch on
 * Organisation → Integrations; on a space's settings they save a webhook
 * address — sent once and never shown again — send a test post while posting
 * is off, read the held-back posts, and remove the channel. A member is shown
 * neither card.
 *
 * `TEAMS_SHOTS=<dir>` also saves both cards in light and dark, for review.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
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
  openSectionsByDefault,
} from './harness.ts';
import { ME_MEMBER, ME_OWNER, PROJECT, SLUG, spaceSettingsStub } from './space-settings-fixture.ts';

// The folded sections this file reads inside open as a returning viewer has them (LAI-1345).
openSectionsByDefault('teams');

const MINUTE = 60_000;
/** A fixture address, never a real flow; its `sig=` must never reach the page. */
const ADDRESS =
  'https://default0fixture.00.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/0fixture/triggers/manual/paths/invoke?api-version=1&sig=fixtureSigNeverShown9Wq3';
const HOST = 'default0fixture.00.environment.api.powerplatform.com';
const SHOTS = process.env.TEAMS_SHOTS;

/** The server's default grants for this role, plus `org.teams.configure` for an owner or admin. */
function permissionsFor(me: { org_role: string; memberships: unknown }): unknown {
  const base = defaultPermissions(me as never) as { readonly me: { readonly actions: string[] } };
  const teams = me.org_role === 'owner' || me.org_role === 'admin' ? ['org.teams.configure'] : [];
  return { ...base, me: { ...base.me, actions: [...base.me.actions, ...teams] } };
}

const post = (patch: Record<string, unknown>) => ({
  id: `t${String(Math.random()).slice(2, 8)}`,
  kind: 'notice',
  event: 'in_review',
  title: 'MOB-12 is waiting for review',
  outcome: 'suppressed',
  reason: 'posting_off',
  http_status: null,
  created_at: Date.now() - 5 * MINUTE,
  finished_at: Date.now() - 5 * MINUTE,
  ...patch,
});

const CHANNEL = {
  project_id: PROJECT.id,
  project_slug: SLUG,
  project_name: PROJECT.name,
  host: HOST,
  last4: ADDRESS.slice(-4),
  set_at: Date.now() - 60 * MINUTE,
  set_by: { id: 'u1', name: 'Pawan Sirsat' },
  last_post: null,
};

const RECENT = [
  post({}),
  post({
    kind: 'standup',
    event: 'morning',
    title: 'Mobile (MOB) — Daily Update',
    created_at: Date.now() - 90 * MINUTE,
  }),
  post({
    kind: 'notice',
    event: 'assigned',
    title: 'Tomas Nel — MOB-7 is yours',
    created_at: Date.now() - 120 * MINUTE,
  }),
];

/** `GET`, `PUT` and `DELETE /projects/mobile/teams` from state the test can read. */
function spaceTeams(initial: { channel: unknown; recent: unknown[] }, posting = false) {
  const state = { ...initial };
  const calls: StubCall[] = [];
  return {
    calls,
    route: (call: StubCall) => {
      calls.push(call);
      if (call.method === 'DELETE') {
        state.channel = null;
        return reply(204, null);
      }
      if (call.method === 'PUT') state.channel = CHANNEL;
      return { posting_enabled: posting, channel: state.channel, recent: state.recent };
    },
    test: (call: StubCall) => {
      calls.push(call);
      const sent = post({
        kind: 'test',
        event: null,
        title: 'Laika is connected to this channel — Mobile (MOB)',
        outcome: 'sent',
        reason: null,
        http_status: 202,
        created_at: Date.now(),
      });
      state.recent = [sent, ...state.recent];
      return sent;
    },
  };
}

function settingsStub(me: typeof ME_OWNER, extra: ApiStub): ApiStub {
  return spaceSettingsStub(me, {
    '/api/v1/permissions': permissionsFor(me),
    ...extra,
  });
}

const card = (h: Harness) => h.page.locator('[data-teams-section]');

async function shoot(h: Harness, locator: string, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const theme of ['light', 'dark']) {
    await setTheme(h.page, theme);
    await h.page.waitForTimeout(300);
    await h.page.locator(locator).screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
  }
}

void after(async () => {
  await closeBrowser();
});

void describe('Space settings: the Teams card', () => {
  void test('saves an address once and never shows it; tests while off; lists what was held back', async () => {
    const teams = spaceTeams({ channel: null, recent: RECENT });
    const h = await open(
      `/spaces/${SLUG}/settings`,
      settingsStub(ME_OWNER, {
        [`/api/v1/projects/${SLUG}/teams`]: teams.route,
        [`/api/v1/projects/${SLUG}/teams/test`]: teams.test,
      }),
    );
    try {
      await card(h).waitFor({ timeout: 20_000 });
      await until(async () => (await card(h).locator('[data-teams-off]').count()) === 1);
      assert.match(
        await card(h).locator('[data-teams-off]').innerText(),
        /Teams posting is off for the organisation/,
      );
      assert.equal(
        await card(h).locator('[data-teams-channel]').getAttribute('data-teams-channel'),
        'none',
      );
      const testButton = card(h).getByRole('button', { name: 'Send test post' });
      assert.equal(await testButton.isDisabled(), true, 'no channel, nothing to test');
      assert.match(await card(h).innerText(), /Held back — Teams posting is off/);
      assert.match(await card(h).innerText(), /Morning stand-up/);

      // Labelled for a first address; once one is saved, the same field replaces it.
      assert.equal(await card(h).getByLabel('Power Automate webhook URL').count(), 1);
      const field = card(h).locator('input[type="url"]');
      await field.fill(ADDRESS);
      await card(h).getByRole('button', { name: 'Save address' }).click();
      await until(async () => (await field.inputValue()) === '');
      assert.deepEqual(
        teams.calls.filter((c) => c.method === 'PUT').map((c) => c.body),
        [{ webhook_url: ADDRESS }],
      );
      assert.equal(await field.inputValue(), '', 'the field is emptied once saved');
      await until(async () =>
        (await card(h).locator('[data-teams-channel]').innerText()).includes(HOST),
      );
      assert.match(
        await card(h).locator('[data-teams-channel]').innerText(),
        new RegExp(
          `^Posting to\\s+${HOST.replaceAll('.', '\\.')} ···${ADDRESS.slice(-4)}\\s+Set by Pawan Sirsat, `,
        ),
      );
      assert.equal((await h.page.content()).includes('sig='), false, 'the address is on the page');
      assert.equal(await card(h).getByLabel('Replace the webhook URL').count(), 1);

      await testButton.click();
      await until(async () => (await card(h).locator('[data-teams-tested]').count()) === 1);
      assert.equal(await card(h).locator('[data-teams-tested]').innerText(), 'Test post: Sent.');
      await until(async () => (await card(h).innerText()).includes('Test post'));
      assert.match(await card(h).innerText(), /Laika is connected to this channel/);

      await shoot(h, '[data-teams-section]', 'space-settings-teams');

      await card(h).getByRole('button', { name: 'Remove channel' }).click();
      assert.match(await answerConfirm(h.page, true), /Remove this space’s Teams channel\?/);
      await until(async () =>
        (await card(h).locator('[data-teams-channel]').innerText()).startsWith('No channel'),
      );
      assert.equal(teams.calls.filter((c) => c.method === 'DELETE').length, 1);
    } finally {
      await h.close();
    }
  });

  void test('says a refused address in words, and keeps what was typed', async () => {
    const h = await open(
      `/spaces/${SLUG}/settings`,
      settingsStub(ME_OWNER, {
        [`/api/v1/projects/${SLUG}/teams`]: (call: StubCall) =>
          call.method === 'PUT'
            ? reply(422, {
                error: {
                  code: 'unprocessable',
                  message: 'webhook_url must be …',
                  details: { field: 'webhook_url', reason: 'webhook_url_invalid' },
                },
              })
            : { posting_enabled: true, channel: null, recent: [] },
      }),
    );
    try {
      await card(h).waitFor({ timeout: 20_000 });
      const field = card(h).getByLabel('Power Automate webhook URL');
      await field.waitFor();
      assert.equal(await card(h).locator('[data-teams-off]').count(), 0, 'posting is on');
      await field.fill('https://localhost/hook');
      await card(h).getByRole('button', { name: 'Save address' }).click();
      await until(async () => (await card(h).locator('[data-error="teams"]').count()) === 1);
      assert.match(
        await card(h).locator('[data-error="teams"]').innerText(),
        /not a Power Automate or Teams webhook address/,
      );
      assert.equal(await field.inputValue(), 'https://localhost/hook');
    } finally {
      await h.close();
    }
  });

  void test('is not there for a member', async () => {
    const h = await open(`/spaces/${SLUG}/settings`, settingsStub(ME_MEMBER, {}));
    try {
      await h.page.locator('.ss').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(500);
      assert.equal(await card(h).count(), 0);
      assert.equal(
        h.calls.some((c) => c.path.endsWith('/teams')),
        false,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Organisation → Integrations: the Teams switch', () => {
  function orgStub(on: { value: boolean }, puts: StubCall[]): ApiStub {
    const settings = () => ({
      posting_enabled: on.value,
      updated_at: on.value ? Date.now() : null,
      updated_by: on.value ? { id: 'u1', name: 'Pawan Sirsat' } : null,
      schedule: { standup_utc: ['05:30', '12:30'], digest_utc: '07:00' },
      channels: [
        {
          ...CHANNEL,
          last_post: post({
            kind: 'test',
            event: null,
            outcome: 'sent',
            reason: null,
            http_status: 202,
          }),
        },
      ],
    });
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
      },
      '/api/v1/org/model-prices': { as_of: '2026-10-18', can_set: false, entries: [] },
      '/api/v1/org/teams': (call: StubCall) => {
        if (call.method === 'PUT') {
          puts.push(call);
          on.value = (call.body as { posting_enabled: boolean }).posting_enabled;
        }
        return settings();
      },
    };
  }

  void test('is off, turns on with one click, and lists every space with a channel', async () => {
    const on = { value: false };
    const puts: StubCall[] = [];
    const h = await open('/organisation?tab=teams', orgStub(on, puts));
    try {
      const section = h.page.locator('[data-section="teams"]');
      await section.waitFor({ timeout: 20_000 });
      const toggle = section.getByRole('switch');
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      assert.match(
        await section.innerText(),
        /Stand-ups at 05:30 and 12:30 UTC, Monday to Friday; the nightly digest at 07:00 UTC, daily\./,
      );
      assert.match(
        await section.innerText(),
        new RegExp(`Mobile\\s+${HOST.replaceAll('.', '\\.')}`),
      );
      assert.equal(
        await section.getByRole('link', { name: 'Mobile' }).getAttribute('href'),
        `/spaces/${SLUG}/settings`,
      );

      await shoot(h, '[data-section="teams"]', 'integrations-teams-off');

      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'true');
      assert.deepEqual(
        puts.map((c) => c.body),
        [{ posting_enabled: true }],
      );
      assert.equal(await section.locator('.org-status-badge').innerText(), 'posting on');
      assert.match(await section.innerText(), /Turned on by Pawan Sirsat/);

      await shoot(h, '[data-section="teams"]', 'integrations-teams-on');
    } finally {
      await h.close();
    }
  });
});
