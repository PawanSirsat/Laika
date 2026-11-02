/**
 * Developer access V3 → Devices (LAI-1054, plan LAI-1042 §B.3, §D, §H), in a
 * real browser against a stubbed API.
 *
 * - Everything on the tab is what `GET /devices` sent: devices, their kind
 *   and origin, the tools nested under each.
 * - An imported device asks to be confirmed, through the existing
 *   `POST /agents/devices/confirm`; a paired one does not.
 * - Two active agents of one tool on one device sit in a conflicts section,
 *   both intact.
 * - Revoked tools hide behind *Show revoked* and are in no count.
 * - Status words: never *Ready*; *Connected* only for an agent seen lately.
 * - Every ⋯ action calls the existing endpoint, keyboard only, and focus
 *   comes back to where it started.
 * - Its states, and classic mode untouched.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, until, type ApiStub, type StubCall } from './harness.ts';

type Mode = 'classic' | 'preview' | 'v3';

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

const PROJECT = {
  id: 'p1',
  slug: 'onroute',
  prefix: 'ONR',
  name: 'OnRoute',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const compat = (mode: Mode) => ({
  server: { version: '0.1.0', build_commit: null },
  protocol: { current: 1, min_client: 1 },
  features: {
    developer_access: mode,
    device_pairing: false,
    tool_setup_exchange: false,
    client_reports: false,
    project_setups: false,
  },
  cli: {},
  release_notes: { ref: null, whats_new: [] },
});

const NOW = Date.now();

const token = (id: string, agentId: string, prefix: string, over: object = {}) => ({
  id,
  name: id,
  prefix,
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_id: agentId,
  agent_label: null,
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  ...over,
});

interface AgentOver {
  readonly id: string;
  readonly harness?: string;
  readonly device_label?: string | null;
  readonly display_name?: string;
  readonly status?: 'active' | 'revoked';
  readonly last_seen_at?: number | null;
  readonly grants?: { project_id: string; scope: string }[];
  readonly tokens?: object[];
}

const agentRow = (over: AgentOver) => ({
  id: over.id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: over.display_name ?? over.id,
  harness: over.harness ?? 'claude-code',
  device_label: over.device_label === undefined ? 'Belka' : over.device_label,
  status: over.status ?? 'active',
  grants: over.grants ?? [],
  tokens: over.tokens ?? [token(`t-${over.id}`, over.id, `lai_${over.id.padEnd(4, 'x')}`)],
  created_at: 1,
  revoked_at: over.status === 'revoked' ? 2 : null,
  last_seen_at: over.last_seen_at ?? null,
});

type Agent = ReturnType<typeof agentRow>;

interface DeviceOver {
  readonly id: string;
  readonly name: string;
  readonly kind?: 'local' | 'cloud';
  readonly origin?: 'imported' | 'paired';
  readonly status?: 'active' | 'revoked';
  readonly confirmed?: boolean;
  readonly key_fingerprint?: string | null;
  readonly last_seen_at?: number | null;
  readonly agents: Agent[];
}

const deviceRow = (over: DeviceOver) => {
  const active = over.agents.filter((a) => a.status === 'active').length;
  return {
    id: over.id,
    display_name: over.name,
    device_label: over.name.toLowerCase(),
    kind: over.kind ?? 'local',
    origin: over.origin ?? 'imported',
    status: over.status ?? 'active',
    confirmed: over.confirmed ?? true,
    confirmed_at: null,
    paired_at: over.origin === 'paired' ? 1 : null,
    key_fingerprint: over.key_fingerprint ?? null,
    last_seen_at: over.last_seen_at ?? null,
    active_count: active,
    revoked_count: over.agents.length - active,
    agents: over.agents,
    created_at: 1,
    revoked_at: null,
  };
};

type Device = ReturnType<typeof deviceRow>;

/** Belka: imported, not confirmed — Claude Code connected, two Codex, one revoked Cursor. */
const BELKA = deviceRow({
  id: 'd1',
  name: 'Belka',
  confirmed: false,
  last_seen_at: NOW - 60_000,
  agents: [
    agentRow({
      id: 'a1',
      last_seen_at: NOW - 60_000,
      grants: [{ project_id: 'p1', scope: 'full' }],
    }),
    agentRow({ id: 'a2', harness: 'codex', display_name: 'old laptop' }),
    agentRow({ id: 'a3', harness: 'codex', display_name: 'new laptop' }),
    agentRow({ id: 'a4', harness: 'cursor', status: 'revoked' }),
  ],
});

/** Runner: paired Cloud, a tool never used. */
const RUNNER = deviceRow({
  id: 'd2',
  name: 'Runner',
  kind: 'cloud',
  origin: 'paired',
  key_fingerprint: '3f9a1c0b7d2e4f61',
  agents: [agentRow({ id: 'a5', harness: 'omnigent', device_label: 'Runner' })],
});

const NO_CONSENT = { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null };

function stub(mode: Mode, devices: readonly Device[], over: ApiStub = {}): ApiStub {
  const agents = devices.flatMap((d) => d.agents);
  const perAgent: Record<string, unknown> = {};
  for (const a of agents) {
    perAgent[`/api/v1/agents/${a.id}/checkpoint-consent`] = NO_CONSENT;
    perAgent[`/api/v1/agents/${a.id}`] = { ...a, sessions: [] };
  }
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: agents, next_cursor: null },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/devices': { data: devices },
    '/api/v1/developer/compatibility': compat(mode),
    ...perAgent,
    ...over,
  };
}

after(async () => {
  await closeBrowser();
});

const tab = (page: Page) => page.locator('.dv3-devices');
const device = (page: Page, id: string) => page.locator(`.dv3-device[data-device="${id}"]`);
const tool = (page: Page, id: string) => page.locator(`.dv3-tool[data-agent="${id}"]`);
const focusedText = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent?.trim() ??
      '',
  );
const writes = (calls: readonly StubCall[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

async function ready(page: Page): Promise<void> {
  await device(page, 'd1').waitFor({ timeout: 20_000 });
}

void describe('V3 Devices: what the server sent, and nothing else', () => {
  void test('devices with their tools nested, kind, origin, and one list only', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [BELKA, RUNNER]));
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('.dv3-device').count(), 2);
      // One list: no classic agents list and no second "Your devices" beside it.
      assert.equal(await h.page.locator('[data-testid="agents-tab"]').count(), 0);
      assert.equal(await h.page.locator('.agents-list').count(), 0);

      const belka = await device(h.page, 'd1').innerText();
      assert.match(belka, /Belka/);
      assert.match(belka, /Local/);
      assert.match(belka, /Imported/);
      assert.match(belka, /Claude Code · Belka/);

      const runner = await device(h.page, 'd2').innerText();
      assert.match(runner, /Cloud/);
      assert.match(runner, /Paired/);
      assert.match(runner, /Cloud credentials last a day/);
      assert.match(runner, /3f9a1c0b7d2e4f61/);
      assert.match(runner, /Omnigent · Runner/);

      // Counts exclude revoked: 2 devices, 4 active tools (a1, a2, a3, a5).
      assert.match(await h.page.locator('[data-counts]').innerText(), /2 devices · 4 tools/);
      // Nothing was fetched from the classic lists to draw this.
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/agents/devices').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('status words: Connected only for an agent seen lately, never Ready, Version unknown', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [BELKA, RUNNER]));
    try {
      await ready(h.page);
      assert.equal(await tool(h.page, 'a1').getAttribute('data-status'), 'connected');
      assert.match(
        await tool(h.page, 'a1').locator('.status-chip').innerText(),
        /Connected[\s\S]*Seen/,
      );
      assert.equal(await tool(h.page, 'a5').getAttribute('data-status'), 'needs-setup');
      assert.match(
        await tool(h.page, 'a5').locator('.status-chip').innerText(),
        /Needs setup[\s\S]*never used/,
      );
      assert.equal(await h.page.locator('.dv3-tool[data-status="connected"]').count(), 1);
      assert.doesNotMatch(await tab(h.page).innerText(), /\bReady\b/);
      assert.match(await tool(h.page, 'a1').innerText(), /Version unknown/);
      // No claim API exists for an agent's owner, so no row says what it is working on.
      assert.doesNotMatch(await tab(h.page).innerText(), /Working on/);
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: imported versus paired', () => {
  void test('an imported device asks to be confirmed; confirming calls the existing endpoint', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA, RUNNER], {
        '/api/v1/agents/devices/confirm': (call: StubCall) => ({
          device_label: (call.body as { device_label: string }).device_label,
          recognised: true,
        }),
      }),
    );
    try {
      await ready(h.page);
      assert.match(
        await device(h.page, 'd1').locator('[data-imported]').innerText(),
        /Imported device — confirm it’s yours/,
      );
      assert.equal(await device(h.page, 'd2').locator('[data-imported]').count(), 0);

      await h.page.getByRole('button', { name: 'Confirm Belka is yours' }).click();
      await device(h.page, 'd1').locator('[data-imported]').waitFor({ state: 'detached' });
      const sent = h.calls.find((c) => c.path === '/api/v1/agents/devices/confirm');
      assert.equal(sent?.method, 'POST');
      assert.deepEqual(sent?.body, { device_label: 'belka' });
      // The tab's own polite region, the first thing in its body.
      const live = h.page.locator('.dev-body > [role="status"][aria-live="polite"]');
      await until(async () => (await live.innerText()).includes('confirmed as yours'));
      assert.match(await live.innerText(), /Belka confirmed as yours/);
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: conflicts and revoked', () => {
  void test('two active agents of one tool: a conflicts section, both intact, nothing revoked', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [BELKA]));
    try {
      await ready(h.page);
      const conflicts = device(h.page, 'd1').locator('[data-conflicts]');
      assert.match(
        await conflicts.locator('summary').innerText(),
        /Needs your attention: 1 conflict/,
      );
      assert.equal(await conflicts.getAttribute('open'), null, 'collapsed by default');
      await conflicts.locator('summary').click();
      assert.equal(await conflicts.locator('.dv3-tool').count(), 2);
      assert.match(await conflicts.innerText(), /Codex · Belka: 2 active/);
      assert.match(await conflicts.innerText(), /old laptop/);
      assert.match(await conflicts.innerText(), /new laptop/);
      // Rename is offered on a duplicate only.
      await tool(h.page, 'a2')
        .getByRole('button', { name: /More actions/ })
        .click();
      assert.equal(await h.page.getByRole('menuitem', { name: 'Rename…' }).count(), 1);
      await h.page.keyboard.press('Escape');
      await tool(h.page, 'a1')
        .getByRole('button', { name: /More actions/ })
        .click();
      assert.equal(await h.page.getByRole('menuitem', { name: 'Rename…' }).count(), 0);
      await h.page.keyboard.press('Escape');
      assert.deepEqual(writes(h.calls), [], 'nothing was revoked or changed on its own');
    } finally {
      await h.close();
    }
  });

  void test('revoked hidden by default, in no count, and shown by the toggle', async () => {
    const gone = deviceRow({
      id: 'd3',
      name: 'Old',
      agents: [agentRow({ id: 'a9', device_label: 'Old', status: 'revoked' })],
    });
    const h = await open('/developer?tab=devices', stub('v3', [BELKA, gone]));
    try {
      await ready(h.page);
      assert.equal(await tool(h.page, 'a4').count(), 0);
      assert.equal(await device(h.page, 'd3').count(), 0);
      assert.match(await h.page.locator('[data-counts]').innerText(), /1 device · 3 tools/);
      const toggle = h.page.getByRole('button', { name: 'Show revoked (2)' });
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await toggle.click();
      await tool(h.page, 'a4').waitFor({ timeout: 5_000 });
      await tool(h.page, 'a9').waitFor({ timeout: 5_000 });
      assert.equal(await tool(h.page, 'a4').getAttribute('data-status'), 'revoked');
      // Revoked rows offer no actions.
      assert.equal(await tool(h.page, 'a4').locator('.overflow-menu-button').count(), 0);
      // The counts do not move.
      assert.match(await h.page.locator('[data-counts]').innerText(), /1 device · 3 tools/);
      const hide = h.page.getByRole('button', { name: 'Hide revoked' });
      assert.equal(await hide.getAttribute('aria-pressed'), 'true');
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: ⋯ actions, keyboard only', () => {
  void test('Disconnect tool names its credential and sessions, Escape returns focus, confirm revokes', async () => {
    let revoked = false;
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA], {
        '/api/v1/agents/a1': {
          ...BELKA.agents[0],
          sessions: [
            {
              id: 's1',
              agent_id: 'a1',
              started_at: NOW - 5 * 60_000,
              last_heartbeat_at: NOW - 10_000,
              ended_at: null,
              end_reason: null,
              client_version: '0.1.0',
              harness: 'claude-code',
              harness_version: '2.1',
              model: 'claude-opus-5-5',
              connection: 'live',
            },
          ],
        },
        '/api/v1/agents/a1/revoke': () => {
          revoked = true;
          return { ...BELKA.agents[0], status: 'revoked', revoked_at: Date.now() };
        },
      }),
    );
    try {
      await ready(h.page);
      const menu = tool(h.page, 'a1').getByRole('button', {
        name: 'More actions for Claude Code · Belka',
      });
      await menu.focus();
      await h.page.keyboard.press('ArrowDown');
      await h.page.getByRole('menu').waitFor({ timeout: 5_000 });
      // Project access… → Reconnect… → Disconnect tool…
      await h.page.keyboard.press('End');
      assert.equal(await focusedText(h.page), 'Disconnect tool…');
      await h.page.keyboard.press('Enter');

      const dialog = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog'));
      await dialog.waitFor({ timeout: 10_000 });
      const said = await dialog.innerText();
      assert.match(said, /Disconnect Claude Code · Belka\?/);
      assert.match(said, /lai_a1xx… stops working/);
      assert.match(said, /This session ends/);
      assert.match(said, /Claude Code 2\.1 · claude-opus-5-5, started 5 min ago/);
      // Review round 1: claims lapse on a revoke, they are never released.
      assert.match(
        said,
        /Any task it holds stays claimed until its claim lapses, then it can be recovered\./,
      );
      assert.doesNotMatch(said, /releas/i);

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        () =>
          document.activeElement?.getAttribute('aria-label') ===
          'More actions for Claude Code · Belka',
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(revoked, false);

      await h.page.keyboard.press('ArrowUp');
      assert.equal(await focusedText(h.page), 'Disconnect tool…');
      await h.page.keyboard.press('Enter');
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      await tool(h.page, 'a1').waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(revoked, true);
      assert.deepEqual(writes(h.calls), ['POST /api/v1/agents/a1/revoke']);
      // The row left the list, so focus is on its device.
      await h.page.waitForFunction(
        () => document.activeElement?.textContent === 'Belka',
        undefined,
        {
          timeout: 5_000,
        },
      );
      assert.match(await h.page.locator('[data-counts]').innerText(), /1 device · 2 tools/);
    } finally {
      await h.close();
    }
  });

  void test('Project access saves through PUT /grants; Cancel returns focus to ⋯', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [RUNNER, BELKA], {
        '/api/v1/agents/a5/grants': (call: StubCall) => ({
          ...RUNNER.agents[0],
          grants: (call.body as { grants: unknown[] }).grants,
        }),
      }),
    );
    try {
      await device(h.page, 'd2').waitFor({ timeout: 20_000 });
      const menu = tool(h.page, 'a5').getByRole('button', { name: /More actions/ });
      await menu.focus();
      await h.page.keyboard.press('Enter');
      assert.equal(await focusedText(h.page), 'Project access…');
      await h.page.keyboard.press('Enter');
      const panel = tool(h.page, 'a5').locator('.agents-panel');
      await panel.waitFor({ timeout: 5_000 });
      await panel.getByRole('button', { name: 'Cancel' }).click();
      await panel.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        () => document.activeElement?.classList.contains('overflow-menu-button') === true,
        undefined,
        { timeout: 5_000 },
      );

      await h.page.keyboard.press('Enter');
      await h.page.keyboard.press('Enter');
      await panel.waitFor({ timeout: 5_000 });
      await panel.getByRole('radio', { name: 'Read only' }).check();
      await panel.getByRole('button', { name: 'Save access' }).click();
      await panel.waitFor({ state: 'detached', timeout: 10_000 });
      const put = h.calls.find((c) => c.method === 'PUT');
      assert.equal(put?.path, '/api/v1/agents/a5/grants');
      assert.deepEqual(put?.body, { grants: [{ project_id: 'p1', scope: 'read_only' }] });
      assert.match(await tool(h.page, 'a5').innerText(), /OnRoute \(read only\)/);
    } finally {
      await h.close();
    }
  });

  void test('Reconnect rotates through the existing endpoint, shows the secret once, and focus returns', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA], {
        '/api/v1/agents/a1/rotate-token': () => ({
          agent: {
            ...BELKA.agents[0],
            tokens: [token('t-new', 'a1', 'lai_newx')],
          },
          token: token('t-new', 'a1', 'lai_newx'),
          secret: 'lai_newx_SECRET_ONCE',
        }),
      }),
    );
    try {
      await ready(h.page);
      await tool(h.page, 'a1')
        .getByRole('button', { name: /More actions/ })
        .click();
      await h.page.getByRole('menuitem', { name: 'Reconnect (new credential)…' }).click();
      const dialog = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog'));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Create new credential' }).click();
      await h.page.getByTestId('agent-secret').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.getByTestId('agent-secret').innerText(), 'lai_newx_SECRET_ONCE');
      const rotate = h.calls.find((c) => c.path === '/api/v1/agents/a1/rotate-token');
      assert.deepEqual(rotate?.body, { token_id: 't-a1' });
      await h.page.getByRole('button', { name: 'Done' }).click();
      await h.page.getByTestId('agent-secret').waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        () => document.activeElement?.classList.contains('overflow-menu-button') === true,
        undefined,
        { timeout: 5_000 },
      );
      assert.doesNotMatch(await h.page.content(), /SECRET_ONCE/);
    } finally {
      await h.close();
    }
  });

  void test('Disconnect device names every tool on it and calls the device revoke', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA], {
        '/api/v1/agents/devices/revoke': { revoked_agent_ids: ['a1', 'a2', 'a3'] },
      }),
    );
    try {
      await ready(h.page);
      await device(h.page, 'd1').getByRole('button', { name: 'More actions for Belka' }).click();
      await h.page.getByRole('menuitem', { name: 'Disconnect device…' }).click();
      const dialog = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog'));
      await dialog.waitFor({ timeout: 10_000 });
      const list = await dialog.locator('[data-disconnect-targets]').innerText();
      assert.match(list, /Claude Code · Belka — no running session/);
      assert.match(list, /Codex · Belka \(old laptop\)/);
      assert.match(list, /Codex · Belka \(new laptop\)/);
      assert.doesNotMatch(list, /Cursor/, 'a revoked tool is not named as stopping');
      const said = await dialog.innerText();
      assert.match(
        said,
        /Any task they hold stays claimed until its claim lapses, then it can be recovered\./,
      );
      assert.doesNotMatch(said, /releas/i);
      await dialog.getByRole('button', { name: 'Disconnect 3 tools' }).click();
      await until(() => h.calls.some((c) => c.path === '/api/v1/agents/devices/revoke'));
      const sent = h.calls.find((c) => c.path === '/api/v1/agents/devices/revoke');
      assert.equal(sent?.method, 'POST');
      assert.deepEqual(sent?.body, { device_label: 'belka' });
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: review round 1', () => {
  void test('disconnecting a device’s last tool moves focus to the list heading', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA, RUNNER], {
        '/api/v1/agents/a5/revoke': () => ({
          ...RUNNER.agents[0],
          status: 'revoked',
          revoked_at: Date.now(),
        }),
      }),
    );
    try {
      await device(h.page, 'd2').waitFor({ timeout: 20_000 });
      await tool(h.page, 'a5')
        .getByRole('button', { name: /More actions/ })
        .click();
      await h.page.getByRole('menuitem', { name: 'Disconnect tool…' }).click();
      const dialog = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog'));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      // Runner had one tool: the whole card leaves the list.
      await device(h.page, 'd2').waitFor({ state: 'detached', timeout: 10_000 });
      await h.page.waitForFunction(
        () => document.activeElement?.id === 'dv3-devices-title',
        undefined,
        { timeout: 5_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('a secret on screen is blanked when its tool is disconnected', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA], {
        '/api/v1/agents/a1/rotate-token': () => ({
          agent: { ...BELKA.agents[0], tokens: [token('t-new', 'a1', 'lai_newx')] },
          token: token('t-new', 'a1', 'lai_newx'),
          secret: 'lai_newx_SECRET_ONCE',
        }),
        '/api/v1/agents/a1/revoke': () => ({
          ...BELKA.agents[0],
          status: 'revoked',
          revoked_at: Date.now(),
        }),
      }),
    );
    try {
      await ready(h.page);
      // Keep revoked rows on screen, so the row stays and its panel with it.
      await h.page.getByRole('button', { name: /Show revoked/ }).click();
      await tool(h.page, 'a1')
        .getByRole('button', { name: /More actions/ })
        .click();
      await h.page.getByRole('menuitem', { name: 'Reconnect (new credential)…' }).click();
      const dialog = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog'));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Create new credential' }).click();
      await h.page.getByTestId('agent-secret').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.getByTestId('agent-secret').innerText(), 'lai_newx_SECRET_ONCE');

      await tool(h.page, 'a1')
        .getByRole('button', { name: /More actions/ })
        .click();
      await h.page.getByRole('menuitem', { name: 'Disconnect tool…' }).click();
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      await h.page.locator('.dv3-tool[data-agent="a1"][data-status="revoked"]').waitFor({
        timeout: 10_000,
      });
      await until(async () => !(await h.page.content()).includes('SECRET_ONCE'));
      assert.doesNotMatch(await h.page.content(), /SECRET_ONCE/);
    } finally {
      await h.close();
    }
  });

  void test('Disconnect device cannot be chosen again while the first is under way', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [BELKA], {
        '/api/v1/agents/devices/revoke': { revoked_agent_ids: ['a1', 'a2', 'a3'] },
      }),
    );
    try {
      await ready(h.page);
      // Hold the session reads the dialog waits for, so the first choice stays out.
      let release: () => void = () => undefined;
      const held = new Promise<void>((done) => {
        release = done;
      });
      await h.page.route('**/api/v1/agents/a1', async (route) => {
        await held;
        await route.continue();
      });
      const menu = device(h.page, 'd1').getByRole('button', { name: 'More actions for Belka' });
      await menu.click();
      await h.page.getByRole('menuitem', { name: 'Disconnect device…' }).click();
      await menu.click();
      const item = h.page.getByRole('menuitem', { name: 'Disconnect device…' });
      assert.equal(await item.getAttribute('aria-disabled'), 'true');
      // Chosen anyway (a script, or a reader past the arrows): it does nothing.
      await item.dispatchEvent('click');
      await h.page.keyboard.press('Escape');
      release();
      const dialog = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog'));
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.count(), 1);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      // Cancelled: it can be chosen again.
      await menu.click();
      assert.equal(
        await h.page
          .getByRole('menuitem', { name: 'Disconnect device…' })
          .getAttribute('aria-disabled'),
        null,
      );
      assert.deepEqual(writes(h.calls), [], 'nothing was revoked');
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: states', () => {
  void test('loading, then an error with a retry that works', async () => {
    let calls = 0;
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [], {
        '/api/v1/devices': () => {
          calls += 1;
          return calls === 1 ? refuse(503, 'unavailable', 'Try again shortly.') : { data: [BELKA] };
        },
      }),
    );
    try {
      await h.page.getByText('Could not load your devices').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Try again' }).click();
      await ready(h.page);
    } finally {
      await h.close();
    }
  });

  void test('empty: no devices yet, and Add a device opens the wizard', async () => {
    const h = await open('/developer?tab=devices', stub('v3', []));
    try {
      await h.page.getByText('No devices yet').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Add a device' }).click();
      // The V3 Add device wizard (LAI-1061), not the classic registration one.
      await h.page.locator('[data-wizard="device"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.agents-wizard').count(), 0);
      assert.match(h.page.url(), /add=device/);
      // The wizard alone: the classic list does not come with it.
      assert.equal(await h.page.locator('.agents-list').count(), 0);
      assert.equal(await h.page.locator('.devices-group').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('403 is the permission state', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [], { '/api/v1/devices': refuse(403, 'forbidden', 'Not yours.') }),
    );
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.state-forbidden').innerText(), /your devices/);
      assert.equal(await h.page.locator('.dv3-device').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('an expired session goes to sign-in', async () => {
    const h = await open(
      '/developer?tab=devices',
      stub('v3', [], { '/api/v1/devices': refuse(401, 'unauthorized', 'Signed out.') }),
    );
    try {
      await h.page.waitForURL(/\/login/, { timeout: 20_000 });
    } finally {
      await h.close();
    }
  });

  void test('every device revoked: said so, with the toggle to see them', async () => {
    const gone = deviceRow({
      id: 'd3',
      name: 'Old',
      status: 'revoked',
      agents: [agentRow({ id: 'a9', device_label: 'Old', status: 'revoked' })],
    });
    const h = await open('/developer?tab=devices', stub('v3', [gone]));
    try {
      await h.page
        .getByText('Every device and tool of yours is revoked.')
        .waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Show revoked (1)' }).click();
      await device(h.page, 'd3').waitFor({ timeout: 5_000 });
      assert.match(await device(h.page, 'd3').innerText(), /Revoked/);
      assert.equal(await device(h.page, 'd3').locator('.overflow-menu-button').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('classic mode is unchanged', () => {
  void test('classic Agents is the classic tab, and nothing asks for /devices', async () => {
    const h = await open('/developer?tab=agents', stub('classic', [BELKA]));
    try {
      await h.page.locator('[data-testid="agents-tab"] .agents-list').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.dv3-devices').count(), 0);
      assert.equal(await h.page.getByRole('button', { name: '+ Register an agent' }).count(), 1);
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/devices').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('preview: the V3 Devices tab is reachable and draws the new list', async () => {
    const h = await open('/developer?tab=devices', stub('preview', [BELKA]));
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('[data-testid="agents-tab"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});
