/**
 * Developer access V3 → Activity (LAI-1327, the owner's decision), in a real
 * browser: local activity set up as one live checklist, right after Overview.
 *
 * - Each step's state from its own read: the organisation's switch, a device,
 *   a tool, the commands, and the first report (`last_received_at`).
 * - Step 1 is a switch for an owner — the same `PATCH /org` as Organisation's
 *   — and says who to ask for anyone else.
 * - Steps 2 and 3 open the Add device and Add tool wizards; step 4 is the two
 *   commands for this board, to copy.
 * - The scope, the folds *Share local activity* always had, and *It isn't
 *   working*; Advanced's old address lands here.
 * - The Overview's journey gains *Share activity* while the organisation
 *   collects.
 * - Review 1: step 4 says *On* only for fresh data — *Paused* with the switch
 *   off, *Last sent …* once stalled; a viewer's step 4 is locked; a refused
 *   switch says why and stays put, and a slow one never flashes back; the tab
 *   keeps itself current, and a failed re-read keeps what it shows.
 * - 390px, light and dark, with no sideways scroll. Set `LAIKA_SHOTS` to a
 *   directory to keep the pictures the review asks for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { answerConfirm } from './confirm.ts';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { NEVER_REPORTED } from '../helpers/launcher.ts';

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** One part of the page, for a review that asks about that part. */
async function shootPart(part: Locator, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await part.screenshot({ path: `${SHOTS}/${name}.png` });
}

after(async () => {
  await closeBrowser();
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const compat = {
  server: { version: '0.1.0', build_commit: null },
  protocol: { current: 1, min_client: 1 },
  features: {
    developer_access: 'v3',
    device_pairing: false,
    tool_setup_exchange: false,
    client_reports: false,
    project_setups: false,
  },
  cli: {},
  release_notes: { ref: null, whats_new: [] },
};

type Role = 'owner' | 'member' | 'viewer';

const me = (org_role: Role) => ({
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role,
  is_active: true,
  memberships: [],
});

const permissions = (org_role: Role) => ({
  org_roles: [],
  project_roles: [],
  permissions: [],
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions: org_role === 'owner' ? ['org.developer_insights.set'] : [],
    projects: [],
  },
});

/** Admins may change organisation settings: the people a member is told to ask. */
const orgPermissions = {
  roles: ['admin', 'member', 'viewer'],
  capabilities: [
    { id: 'see_people_analytics', label: 'See everyone’s analytics', actions: [] },
    { id: 'change_org_settings', label: 'Change organisation settings', actions: [] },
  ],
  grants: {
    admin: { see_people_analytics: true, change_org_settings: true },
    member: { see_people_analytics: false, change_org_settings: false },
    viewer: { see_people_analytics: false, change_org_settings: false },
  },
  owner_locked: [],
  updated_at: null,
  updated_by: null,
};

const LIVE_TOKEN = {
  name: 'agent',
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_label: null,
  expires_at: null,
  revoked_at: null,
  created_at: 1,
};

/** A tool on the board: its own live credential, seen a minute ago unless said otherwise. */
const tool = (id: string, lastSeen: number | null = Date.now() - MIN) => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active' as const,
  grants: [],
  tokens: [{ ...LIVE_TOKEN, id: `t-${id}`, agent_id: id }],
  created_at: 1,
  revoked_at: null,
  last_seen_at: lastSeen,
  launcher: NEVER_REPORTED,
});

const deviceRow = (tools: readonly ReturnType<typeof tool>[]) => ({
  id: 'd1',
  display_name: 'Belka',
  device_label: 'belka',
  kind: 'local',
  origin: 'paired',
  status: 'active',
  confirmed: true,
  confirmed_at: 1,
  paired_at: 1,
  key_fingerprint: null,
  last_seen_at: null,
  active_count: tools.length,
  revoked_count: 0,
  agents: tools,
  launcher: NEVER_REPORTED,
  created_at: 1,
  revoked_at: null,
});

interface World {
  readonly org: boolean;
  readonly role: Role;
  readonly devices: readonly ReturnType<typeof deviceRow>[];
  readonly lastReceivedAt: number | null;
  readonly collectors: number;
}

const WORLDS = {
  /** Developer insights off, the reader an owner: step 1 is theirs to turn. */
  off: { org: false, role: 'owner', devices: [], lastReceivedAt: null, collectors: 0 },
  noDevice: { org: true, role: 'owner', devices: [], lastReceivedAt: null, collectors: 0 },
  noTool: {
    org: true,
    role: 'owner',
    devices: [deviceRow([])],
    lastReceivedAt: null,
    collectors: 0,
  },
  waiting: {
    org: true,
    role: 'owner',
    devices: [deviceRow([tool('a1')])],
    lastReceivedAt: null,
    collectors: 0,
  },
  received: {
    org: true,
    role: 'owner',
    devices: [deviceRow([tool('a1')])],
    lastReceivedAt: Date.now() - 4 * MIN,
    collectors: 1,
  },
} as const satisfies Record<string, World>;

const held = (w: World) => ({
  start: '2026-11-05',
  end: '2026-11-18',
  tz: 'UTC',
  days:
    w.lastReceivedAt === null
      ? []
      : [
          {
            day: '2026-11-18',
            prompts_by_agent: { 'claude-code': 6 },
            sessions: 2,
            commits_local: 1,
            pushed_commits: 0,
            tokens: 0,
            cache_read: 0,
          },
        ],
  collectors: w.collectors,
  oldest_day: w.lastReceivedAt === null ? null : '2026-11-18',
  last_received_at: w.lastReceivedAt,
});

function stub(w: World, over: ApiStub = {}): ApiStub {
  let on = w.org;
  return {
    '/api/v1/me': me(w.role),
    '/api/v1/permissions': permissions(w.role),
    '/api/v1/org/permissions': orgPermissions,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/project-setups': { data: [] },
    '/api/v1/developer/compatibility': compat,
    '/api/v1/devices': { data: w.devices },
    '/api/v1/org': (call: StubCall) => {
      if (call.method === 'PATCH') {
        on = (call.body as { developer_insights: boolean }).developer_insights;
      }
      return {
        id: 'o1',
        name: 'Kvell Dynamics',
        presence_enabled: true,
        developer_insights: on,
        created_at: 1,
        updated_at: 2,
      };
    },
    '/api/v1/me/activity-sharing': () => ({
      org_enabled: on,
      enabled: on,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    }),
    '/api/v1/me/local-activity': held(w),
    ...over,
  };
}

const here = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

const step = (page: Page, key: string) => page.locator(`.dev-activity [data-step="${key}"]`);

async function ready(page: Page): Promise<void> {
  await page.locator('.dev-activity [data-checklist]').waitFor({ timeout: 20_000 });
}

/** Each step's state, in order. */
async function states(page: Page): Promise<string[][]> {
  return page
    .locator('.dev-activity [data-step]')
    .evaluateAll((els) =>
      els.map((el) => [el.getAttribute('data-step') ?? '', el.getAttribute('data-state') ?? '']),
    );
}

const headline = (page: Page) => page.locator('.dev-activity [data-status-line]').innerText();

void describe('the checklist, step by step', () => {
  void test('organisation off, as its owner: step 1 is a switch, and turning it on moves the list on', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.off));
    try {
      await ready(h.page);
      assert.equal(await headline(h.page), 'Off for the organisation');
      assert.equal(await h.page.locator('.dev-activity').getAttribute('data-headline'), 'off');
      assert.deepEqual(await states(h.page), [
        ['org', 'active'],
        ['device', 'pending'],
        ['tool', 'pending'],
        ['command', 'pending'],
        ['data', 'pending'],
      ]);
      // A later step says why it waits.
      assert.match(
        await step(h.page, 'device').locator('[data-locked-step] .visually-hidden').innerText(),
        /Developer insights must be on first/,
      );
      const toggle = step(h.page, 'org').getByRole('switch');
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      // Named by its step, described by its line.
      assert.equal(await toggle.getAttribute('aria-labelledby'), 'dx-activity-org-name');

      await toggle.click();
      await until(() => h.calls.some((c) => c.method === 'PATCH' && c.path === '/api/v1/org'));
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/org');
      assert.deepEqual(patch?.body, { developer_insights: true });
      await until(
        async () => (await step(h.page, 'org').getAttribute('data-state')) === 'done',
        10_000,
      );
      assert.equal(await headline(h.page), 'Not set up on any machine');
      assert.equal(await step(h.page, 'device').getAttribute('data-state'), 'active');
    } finally {
      await h.close();
    }
  });

  void test('organisation off, as a member: no switch — it says who can turn it on', async () => {
    const h = await open('/developer?tab=activity', stub({ ...WORLDS.off, role: 'member' }));
    try {
      await ready(h.page);
      await step(h.page, 'org').locator('[data-ask]').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.getByRole('switch').count(), 0);
      assert.equal(
        await step(h.page, 'org').locator('[data-ask]').innerText(),
        'Ask the owner and admins to turn it on, in Organisation.',
      );
      await h.page.waitForTimeout(300);
      assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('no device: step 2 is next, and Add device opens that wizard', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.noDevice));
    try {
      await ready(h.page);
      assert.deepEqual((await states(h.page)).slice(0, 3), [
        ['org', 'done'],
        ['device', 'active'],
        ['tool', 'pending'],
      ]);
      const add = step(h.page, 'device').getByRole('link', { name: /Add device/ });
      assert.equal(await add.getAttribute('href'), '/developer?tab=devices&add=device');
      await add.click();
      await until(() => here(h.page.url()) === '/developer?tab=devices&add=device', 10_000);
    } finally {
      await h.close();
    }
  });

  void test('a device, no tool: step 3 is next, and Add tool opens that wizard', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.noTool));
    try {
      await ready(h.page);
      assert.equal(await step(h.page, 'device').getAttribute('data-state'), 'done');
      assert.match(await step(h.page, 'device').innerText(), /1 device · Belka/);
      assert.equal(await step(h.page, 'tool').getAttribute('data-state'), 'active');
      assert.equal(
        await step(h.page, 'tool')
          .getByRole('link', { name: /Add tool/ })
          .getAttribute('href'),
        '/developer?tab=tools&add=tool',
      );
    } finally {
      await h.close();
    }
  });

  void test('a tool connected, nothing received: the two commands to copy, and waiting', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.waiting));
    try {
      await ready(h.page);
      assert.deepEqual(await states(h.page), [
        ['org', 'done'],
        ['device', 'done'],
        ['tool', 'done'],
        ['command', 'active'],
        ['data', 'pending'],
      ]);
      const commands = step(h.page, 'command').locator('pre[data-commands]');
      assert.equal(
        await commands.innerText(),
        `laika update --board ${h.origin}\nlaika activity on`,
      );
      assert.equal(
        // Its words, as written: the bar draws them in capitals.
        await h.page.locator('#dx-activity-command-label').textContent(),
        'On that machine — no credential to paste',
      );
      assert.equal(await step(h.page, 'command').locator('.copy-button').isVisible(), true);
      assert.match(
        await step(h.page, 'data').innerText(),
        /Waiting… start an agent session or run laika activity sync/,
      );
      // The command is set as code, not wrapped in literal backticks.
      assert.equal(
        await step(h.page, 'data').locator('.dx-flow-line code').textContent(),
        'laika activity sync',
      );
      assert.equal(await headline(h.page), 'Not set up on any machine');
    } finally {
      await h.close();
    }
  });

  void test('data received: every step done, and when it last came', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.received));
    try {
      await ready(h.page);
      assert.deepEqual(
        (await states(h.page)).map(([, state]) => state),
        ['done', 'done', 'done', 'done', 'done'],
      );
      assert.equal(await headline(h.page), 'Collecting · last received 4 min ago');
      assert.match(
        await step(h.page, 'data').innerText(),
        /Received from one machine, last 4 min ago/,
      );
      // The commands stay to hand, for the next machine.
      assert.equal(await step(h.page, 'command').locator('pre[data-commands]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('under the checklist', () => {
  void test('the scope, the folds it always had, and It isn’t working', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.received));
    try {
      await ready(h.page);
      await h.page.locator('.dev-activity fieldset.share-scope').waitFor({ timeout: 10_000 });
      assert.deepEqual(
        await h.page
          .locator('.dev-activity details.dev-fold')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-fold'))),
        ['sent', 'otel', 'held', 'trouble'],
      );
      const trouble = h.page.locator('.dev-activity details[data-fold="trouble"]');
      await trouble.locator('> summary').click();
      assert.deepEqual(
        await trouble
          .locator('[data-trouble]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-trouble'))),
        ['org-off', 'not-connected', 'refused', 'read-only'],
      );
      assert.match(await trouble.innerText(), /This machine is not connected to a board/);
      assert.equal(
        await trouble.locator('[data-trouble="org-off"] dd code').textContent(),
        'laika activity on',
      );
      assert.doesNotMatch(await trouble.innerText(), /`/);
    } finally {
      await h.close();
    }
  });

  void test('deleting the history still asks first; declining sends nothing', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.received));
    try {
      await ready(h.page);
      await h.page.locator('.dev-activity details[data-fold="held"] > summary').click();
      await h.page.getByRole('button', { name: 'Delete my local-activity history' }).click();
      const asked = await answerConfirm(h.page, false);
      assert.match(asked, /Delete your activity history\?/);
      await h.page.waitForTimeout(300);
      assert.equal(
        h.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/v1/me/local-activity')
          .length,
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('with the organisation off there is no scope to choose and no telemetry fold', async () => {
    const h = await open('/developer?tab=activity', stub(WORLDS.off));
    try {
      await ready(h.page);
      await h.page.locator('.dev-activity details[data-fold="trouble"]').waitFor();
      assert.equal(await h.page.locator('.dev-activity fieldset.share-scope').count(), 0);
      assert.equal(await h.page.locator('.dev-activity details[data-fold="otel"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('where Activity is', () => {
  void test('right after Overview, and Advanced’s old activity address lands on it', async () => {
    const h = await open('/developer?tab=advanced&section=activity', stub(WORLDS.waiting));
    try {
      await ready(h.page);
      await until(() => here(h.page.url()) === '/developer?tab=activity', 10_000);
      assert.equal(await h.page.locator('.page-tab-active').getAttribute('data-tab'), 'activity');
      assert.deepEqual(
        await h.page
          .locator('.dx-tabrow .page-tab')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-tab'))),
        ['overview', 'activity', 'projects', 'devices', 'tools'],
      );
    } finally {
      await h.close();
    }
  });

  void test('the Overview journey gains Share activity while the organisation collects', async () => {
    const h = await open('/developer?tab=overview', stub(WORLDS.waiting));
    try {
      const row = h.page.locator('[data-journey] [data-step="activity"]');
      await row.waitFor({ timeout: 20_000 });
      assert.equal(await row.getAttribute('data-state'), 'active');
      assert.equal(
        await row.getByRole('link', { name: /Start/ }).getAttribute('href'),
        '/developer?tab=activity',
      );
    } finally {
      await h.close();
    }
  });

  void test('with the organisation off, the journey keeps its three steps', async () => {
    const h = await open('/developer?tab=overview', stub(WORLDS.off));
    try {
      await h.page.locator('[data-journey] [data-step="project"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-journey] [data-step="activity"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the switch, refused or slow (LAI-1327 review 1)', () => {
  for (const [status, code, message] of [
    [403, 'forbidden', 'Only an owner or admin may change this.'],
    [500, 'internal', 'The board could not save that.'],
  ] as const) {
    void test(`a ${String(status)} lands in the alert, and the switch stays where it truly is`, async () => {
      const base = stub(WORLDS.off);
      const org = base['/api/v1/org'] as (call: StubCall) => unknown;
      const h = await open('/developer?tab=activity', {
        ...base,
        '/api/v1/org': (call: StubCall) =>
          call.method === 'PATCH' ? refuse(status, code, message) : org(call),
      });
      try {
        await ready(h.page);
        const toggle = step(h.page, 'org').getByRole('switch');
        await toggle.click();
        const alert = step(h.page, 'org').getByRole('alert');
        await alert.waitFor({ timeout: 10_000 });
        assert.equal(await alert.innerText(), message);
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        assert.equal(await toggle.isDisabled(), false);
        assert.equal(await headline(h.page), 'Off for the organisation');
        assert.equal(await step(h.page, 'device').getAttribute('data-state'), 'pending');
      } finally {
        await h.close();
      }
    });
  }

  void test('turned on, it shows on from the answer and stays busy until the re-read lands', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let patched = false;
    const base = stub(WORLDS.off);
    const org = base['/api/v1/org'] as (call: StubCall) => unknown;
    const sharing = base['/api/v1/me/activity-sharing'] as (call: StubCall) => unknown;
    const h = await open('/developer?tab=activity', {
      ...base,
      '/api/v1/org': (call: StubCall) => {
        if (call.method === 'PATCH') patched = true;
        return org(call);
      },
      // The re-read after the change is held until the test has looked.
      '/api/v1/me/activity-sharing': (call: StubCall) =>
        patched ? gate.then(() => sharing(call)) : sharing(call),
    });
    try {
      await ready(h.page);
      const toggle = step(h.page, 'org').getByRole('switch');
      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'true', 10_000);
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      assert.equal(await toggle.isDisabled(), true, 'busy while the re-read is out');
      await h.page.waitForTimeout(300);
      assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'never back to off');
      release();
      await until(async () => !(await toggle.isDisabled()), 10_000);
      assert.equal(await toggle.isDisabled(), false);
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      assert.equal(await step(h.page, 'org').getAttribute('data-state'), 'done');
    } finally {
      release();
      await h.close();
    }
  });
});

void describe('it keeps itself current (LAI-1327 review 1)', () => {
  const localReads = (calls: readonly StubCall[]) =>
    calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/me/local-activity').length;

  void test('coming back to the window reads again; a failed re-read keeps what is shown and says so', async () => {
    let fail = false;
    const w = { ...WORLDS.received, lastReceivedAt: Date.now() - 4 * MIN };
    const h = await open(
      '/developer?tab=activity',
      stub(w, {
        '/api/v1/me/local-activity': () =>
          fail ? refuse(500, 'internal', 'The board is restarting.') : held(w),
      }),
    );
    try {
      await ready(h.page);
      fail = true;
      const before = localReads(h.calls);
      await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const notice = h.page.locator('.dev-activity [data-stale]');
      await notice.waitFor({ timeout: 10_000 });
      assert.ok(localReads(h.calls) > before, 'focus read it again');
      assert.match(await notice.innerText(), /Couldn’t refresh your activity setup/);
      assert.match(await notice.innerText(), /The board is restarting\./);
      // What was shown stays.
      assert.equal(await headline(h.page), 'Collecting · last received 4 min ago');
      assert.equal(await step(h.page, 'data').getAttribute('data-state'), 'done');

      fail = false;
      await notice.getByRole('button', { name: 'Retry' }).click();
      await until(async () => (await notice.count()) === 0, 10_000);
      assert.equal(await notice.count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('while step 5 waits it asks every 20 s, only in view, and stops once data lands', async () => {
    let w: World = WORLDS.waiting;
    const h = await open(
      '/developer?tab=activity',
      stub(WORLDS.waiting, { '/api/v1/me/local-activity': () => held(w) }),
      { before: async (page) => page.clock.install() },
    );
    const view = (state: 'visible' | 'hidden') =>
      h.page.evaluate((to) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => to });
      }, state);
    try {
      await ready(h.page);
      const first = localReads(h.calls);
      await h.page.clock.fastForward(21_000);
      await until(() => localReads(h.calls) > first);
      assert.equal(localReads(h.calls), first + 1, 'asked again while waiting');

      await view('hidden');
      const hidden = localReads(h.calls);
      await h.page.clock.fastForward(45_000);
      await h.page.waitForTimeout(300);
      assert.equal(localReads(h.calls), hidden, 'not while the page is out of view');
      await view('visible');

      w = { ...WORLDS.waiting, lastReceivedAt: Date.now() - MIN, collectors: 1 };
      await h.page.clock.fastForward(21_000);
      await until(async () => (await step(h.page, 'data').getAttribute('data-state')) === 'done');
      assert.equal(await step(h.page, 'data').getAttribute('data-state'), 'done');
      const landed = localReads(h.calls);
      await h.page.clock.fastForward(65_000);
      await h.page.waitForTimeout(300);
      assert.equal(localReads(h.calls), landed, 'no more asking once data has arrived');
    } finally {
      await h.close();
    }
  });

  void test('when it last came moves on by itself', async () => {
    const w = { ...WORLDS.received, lastReceivedAt: Date.now() - 4 * MIN };
    const h = await open('/developer?tab=activity', stub(w), {
      before: async (page) => page.clock.install(),
    });
    try {
      await ready(h.page);
      assert.equal(await headline(h.page), 'Collecting · last received 4 min ago');
      await h.page.clock.fastForward(2 * MIN);
      await until(async () => (await headline(h.page)) === 'Collecting · last received 6 min ago');
      assert.equal(await headline(h.page), 'Collecting · last received 6 min ago');
    } finally {
      await h.close();
    }
  });
});

void describe('a viewer cannot send (LAI-1327 review 1)', () => {
  const viewer: World = { ...WORLDS.waiting, role: 'viewer' };
  const SAYS = 'Viewers can’t send activity: ask an owner for a member role';

  void test('step 4 is locked, saying why, with no commands to copy; step 5 waits behind it', async () => {
    const h = await open('/developer?tab=activity', stub(viewer));
    try {
      await ready(h.page);
      await until(
        async () => (await step(h.page, 'command').getAttribute('data-state')) === 'pending',
      );
      assert.equal(await step(h.page, 'command').getAttribute('data-state'), 'pending');
      assert.equal(await step(h.page, 'command').locator('[data-locked]').innerText(), SAYS);
      assert.equal(await step(h.page, 'command').locator('pre[data-commands]').count(), 0);
      assert.equal(await step(h.page, 'data').getAttribute('data-state'), 'pending');
      assert.equal(await step(h.page, 'data').locator('[data-locked]').innerText(), SAYS);
    } finally {
      await h.close();
    }
  });

  void test('the Overview journey says the same', async () => {
    const h = await open('/developer?tab=overview', stub(viewer));
    try {
      const row = h.page.locator('[data-journey] [data-step="activity"]');
      await row.waitFor({ timeout: 20_000 });
      assert.equal(await row.getAttribute('data-state'), 'pending');
      assert.equal(await row.locator('.dx-flow-line').innerText(), SAYS);
    } finally {
      await h.close();
    }
  });
});

void describe('step 4 says what is true now (LAI-1327 review 1)', () => {
  const cases = [
    {
      name: 'paused',
      world: (): World => ({
        ...WORLDS.received,
        org: false,
        lastReceivedAt: Date.now() - 2 * 60 * MIN,
      }),
      line: 'Paused: Developer insights are off',
      head: 'Off for the organisation',
    },
    {
      name: 'stalled',
      world: (): World => ({
        ...WORLDS.received,
        lastReceivedAt: Date.now() - 20 * DAY,
        collectors: 0,
      }),
      line: 'Last sent 20 d ago; run laika activity status on that machine',
      head: 'Stalled · last received 20 d ago',
    },
    {
      name: 'fresh',
      world: (): World => ({ ...WORLDS.received, lastReceivedAt: Date.now() - 4 * MIN }),
      line: 'On: the collector sends after each agent session',
      head: 'Collecting · last received 4 min ago',
    },
  ] as const;

  for (const c of cases) {
    void test(`${c.name}: “${c.line}”, light and dark, 1440 and 390`, async () => {
      const h = await open('/developer?tab=activity', stub(c.world()));
      try {
        await ready(h.page);
        const command = step(h.page, 'command');
        assert.equal(await command.getAttribute('data-state'), 'done');
        assert.equal((await command.locator('.dx-flow-line').first().innerText()).trim(), c.line);
        assert.equal(await headline(h.page), c.head);
        assert.equal(
          await h.page.locator('.dev-activity').getAttribute('data-headline'),
          c.name === 'paused' ? 'off' : c.name === 'stalled' ? 'stalled' : 'collecting',
        );
        for (const theme of ['light', 'dark'] as const) {
          await h.page.setViewportSize({ width: 1440, height: 1000 });
          await setTheme(h.page, theme);
          await h.page.waitForTimeout(300);
          await shootPart(
            h.page.locator('.dev-activity [data-checklist]'),
            `step4-${c.name}-1440-${theme}`,
          );
          await h.page.setViewportSize({ width: 390, height: 844 });
          await h.page.waitForTimeout(500);
          await shootPart(
            h.page.locator('.dev-activity [data-checklist]'),
            `step4-${c.name}-390-${theme}`,
          );
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('look and fit', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, world] of [
      ['off', WORLDS.off],
      ['received', WORLDS.received],
    ] as const) {
      void test(`${name}, ${theme}: 1440 and 390, no sideways scroll`, async () => {
        const h = await open('/developer?tab=activity', stub(world));
        try {
          await setTheme(h.page, theme);
          await ready(h.page);
          await h.page.setViewportSize({ width: 1440, height: 1000 });
          await shoot(h.page, `activity-${name}-1440-${theme}`);
          await h.page.setViewportSize({ width: 390, height: 844 });
          await h.page.waitForTimeout(300);
          const fit = await h.page.evaluate(() => ({
            page: document.documentElement.scrollWidth,
            view: document.documentElement.clientWidth,
          }));
          assert.ok(
            fit.page <= fit.view,
            `${String(fit.page)}px wide in a ${String(fit.view)}px view`,
          );
          await shoot(h.page, `activity-${name}-390-${theme}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});
