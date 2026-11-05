/**
 * Developer access V3 → Devices and Tools (LAI-1054; one line a row and a
 * details panel each since LAI-1080), in a real browser against a stubbed API.
 *
 * - Everything on both tabs is what `GET /devices` sent — devices, their kind
 *   and origin, the tools on each — and one tool's own verification for its
 *   readiness. Devices and Tools count the same tools.
 * - A row is one line; what it has no room for is in its details panel:
 *   the fingerprint, the helper updates, the imported confirmation, the
 *   conflicts with Rename, the credential, the grants, Disconnect.
 * - An imported device asks to be confirmed, through the existing
 *   `POST /agents/devices/confirm`; a paired one does not.
 * - Two active agents of one tool on one device are a conflict, both intact.
 * - Revoked devices and tools hide behind *Show revoked* and are in no count.
 * - Status words: *Ready* only from the tool's own verification; *Connected*
 *   for an agent seen lately before it is read.
 * - Every action calls the existing endpoint, and focus lands where it
 *   should after it.
 * - *Rename…* in an active device's details sends `PATCH /devices/:id`, and
 *   the panel, the row and the tools on it follow the answer (LAI-1095).
 * - Its states, and classic mode untouched.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { join } from 'node:path';
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
  launcher: NEVER_REPORTED,
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
    launcher: NEVER_REPORTED,
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

const check = (state: 'pass' | 'fail', detail: unknown, at: number | null = null) => ({
  state,
  at,
  detail,
});

/**
 * `GET /agents/:id/verification` as the board serves it. `ready` is the
 * tool's own request and a session, lately; `used` a credential that reached
 * the board from something other than the tool; `unused` one never used.
 */
const verification = (agent: Agent, how: 'ready' | 'used' | 'unused') => ({
  agent_id: agent.id,
  harness: agent.harness,
  status: agent.status,
  now: Date.now(),
  last_seen_at: agent.last_seen_at,
  checks: {
    device_paired: check('pass', { device_id: 'd1' }, NOW - 600_000),
    credential_installed: check('pass', { token_id: `t-${agent.id}`, via_exchange: false }),
    credential_used: check(how === 'unused' ? 'fail' : 'pass', null),
    tool_request: check(
      how === 'ready' ? 'pass' : 'fail',
      {
        evidence: how === 'ready' ? 'client_info' : null,
        mcp_client_name: 'specific',
        client_slug: how === 'ready' ? agent.harness : null,
        client_name: how === 'ready' ? agent.harness : null,
        client_version: null,
        self_reported: true,
      },
      how === 'ready' ? Date.now() - 60_000 : null,
    ),
    required_capabilities: check('pass', { required: [], missing: [] }),
    session_hooks: check(
      how === 'ready' ? 'pass' : 'fail',
      { harness: how === 'ready' ? agent.harness : null },
      how === 'ready' ? Date.now() - 60_000 : null,
    ),
  },
  client_report: null,
});

function stub(
  mode: Mode,
  devices: readonly Device[],
  over: ApiStub = {},
  ready: readonly string[] = [],
): ApiStub {
  const agents = devices.flatMap((d) => d.agents);
  const perAgent: Record<string, unknown> = {};
  for (const a of agents) {
    perAgent[`/api/v1/agents/${a.id}/checkpoint-consent`] = NO_CONSENT;
    perAgent[`/api/v1/agents/${a.id}`] = { ...a, sessions: [] };
    // No client report: the helper is *Version unknown* (LAI-1065).
    perAgent[`/api/v1/agents/${a.id}/verification`] = verification(
      a,
      ready.includes(a.id) ? 'ready' : a.last_seen_at === null ? 'unused' : 'used',
    );
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

const roster = (page: Page) => page.locator('.dv3-roster');
const device = (page: Page, id: string) => page.locator(`.dv3-device[data-device="${id}"]`);
const tool = (page: Page, id: string) => page.locator(`.dv3-tool[data-agent="${id}"]`);
const panel = (page: Page, kind: 'device' | 'tool') =>
  page.locator(`.side-panel[data-panel="${kind}"]`);
const live = (page: Page) => page.locator('.dv3-roster > [role="status"][aria-live="polite"]');
const here = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};
const writes = (calls: readonly StubCall[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
const focusedText = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent?.trim() ??
      '',
  );

async function ready(page: Page): Promise<void> {
  await device(page, 'd1').waitFor({ timeout: 20_000 });
}

async function readyTools(page: Page, id = 'a1'): Promise<void> {
  await tool(page, id).waitFor({ timeout: 20_000 });
}

/** A tool's details, opened from its row's *Details*. */
async function toolDetails(page: Page, id: string) {
  await tool(page, id).locator(`[data-details="tools:${id}"]`).click();
  const body = panel(page, 'tool').locator(`.dv3-tool-details[data-agent="${id}"]`);
  await body.waitFor({ timeout: 10_000 });
  return body;
}

/** A device's details, opened from its row's *Details*. */
async function deviceDetails(page: Page, id: string) {
  await device(page, id).locator(`[data-details="devices:${id}"]`).click();
  const body = panel(page, 'device').locator(`.dv3-device-details[data-device="${id}"]`);
  await body.waitFor({ timeout: 10_000 });
  return body;
}

void describe('V3 Devices: one line a device, the rest in its details', () => {
  void test('a row each, with kind, tools and last seen; no tool rows and one list only', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [BELKA, RUNNER]));
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('.dv3-device').count(), 2);
      // Tools are Tools' rows now (LAI-1080), and the classic list is not here.
      assert.equal(await h.page.locator('.dv3-tool').count(), 0);
      assert.equal(await h.page.locator('[data-testid="agents-tab"]').count(), 0);
      assert.equal(await h.page.locator('.agents-list').count(), 0);

      assert.equal(
        await device(h.page, 'd1').locator('[data-line]').innerText(),
        'Local computer · 3 tools · last seen 1 min ago',
      );
      assert.match(await device(h.page, 'd1').innerText(), /Imported — confirm it’s yours/);
      assert.equal(
        await device(h.page, 'd2').locator('[data-line]').innerText(),
        'Cloud runner · 1 tool · never seen',
      );
      assert.match(await device(h.page, 'd2').innerText(), /Paired/);
      // Add tool is on a paired device only: the wizard adds to paired ones.
      assert.equal(
        await device(h.page, 'd2')
          .getByRole('button', { name: /Add a tool/ })
          .count(),
        1,
      );
      assert.equal(
        await device(h.page, 'd1')
          .getByRole('button', { name: /Add a tool/ })
          .count(),
        0,
      );
      // The fingerprint and the Cloud note are the details', not the row's.
      assert.doesNotMatch(await roster(h.page).innerText(), /3f9a1c0b7d2e4f61/);
      // The live region counts as before: 2 devices, 4 active tools.
      await until(async () => (await live(h.page).innerText()).includes('devices'));
      assert.equal(await live(h.page).innerText(), '2 devices, 4 tools.');
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/agents/devices').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('Details: kind, origin, fingerprint, the Cloud note and its tools, at ?device=', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [BELKA, RUNNER]));
    try {
      await ready(h.page);
      const runner = await deviceDetails(h.page, 'd2');
      assert.equal(here(h.page), '/developer?tab=devices&device=d2');
      assert.equal(await panel(h.page, 'device').locator('h2').innerText(), 'Runner');
      const said = await runner.innerText();
      assert.match(said, /Kind\s*Cloud runner/);
      assert.match(said, /Origin\s*Paired/);
      assert.match(said, /Key fingerprint\s*3f9a1c0b7d2e4f61/);
      assert.match(said, /Cloud credentials last a day/);
      assert.match(said, /Omnigent · Runner/);
      assert.equal(await runner.locator('[data-imported]').count(), 0);
      // Its tool opens that tool's details, on Tools.
      await runner.getByRole('button', { name: /^Omnigent · Runner: .*Details$/ }).click();
      await panel(h.page, 'tool').locator('[data-agent="a5"]').waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=tools&agent=a5');
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Tools: one line a tool, across every device', () => {
  void test('as many rows as Devices counts tools, each tool · device, projects and last seen', async () => {
    const h = await open('/developer?tab=tools', stub('v3', [BELKA, RUNNER]));
    try {
      await readyTools(h.page);
      assert.deepEqual(
        await h.page
          .locator('.dv3-tool')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-agent'))),
        ['a1', 'a2', 'a3', 'a5'],
      );
      assert.equal(
        await tool(h.page, 'a1').locator('.dx-record-title').innerText(),
        'Claude Code · Belka',
      );
      assert.equal(
        await tool(h.page, 'a1').locator('[data-line]').innerText(),
        '1 project · seen 1 min ago',
      );
      assert.equal(
        await tool(h.page, 'a5').locator('[data-line]').innerText(),
        'No project yet · never seen',
      );
      // The two of a pair are told apart, and marked.
      assert.equal(
        await tool(h.page, 'a2').locator('.dx-record-title').innerText(),
        'Codex · Belka (old laptop)',
      );
      assert.match(await tool(h.page, 'a2').innerText(), /Duplicate/);
      assert.doesNotMatch(await tool(h.page, 'a1').innerText(), /Duplicate/);
      // A revoked tool is in no row and no count.
      assert.equal(await tool(h.page, 'a4').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('status words: Ready only from the tool’s own verification, never from last seen', async () => {
    const h = await open('/developer?tab=tools', stub('v3', [BELKA, RUNNER]));
    try {
      await readyTools(h.page);
      // Its credential reached the board, but not from Claude Code itself.
      await until(
        async () => (await tool(h.page, 'a1').locator('[data-evidence="true"]').count()) === 1,
      );
      assert.equal(await tool(h.page, 'a1').getAttribute('data-status'), 'connected');
      assert.equal(await tool(h.page, 'a5').getAttribute('data-status'), 'needs-setup');
      assert.match(await tool(h.page, 'a5').innerText(), /Needs setup/);
      assert.doesNotMatch(await roster(h.page).innerText(), /\bReady\b/);
      // No claim API exists for an agent's owner, so no row says what it is working on.
      assert.doesNotMatch(await roster(h.page).innerText(), /Working on/);
    } finally {
      await h.close();
    }

    // The same tool, with its own request and a session lately: Ready.
    const r = await open('/developer?tab=tools', stub('v3', [BELKA, RUNNER], {}, ['a1']));
    try {
      await readyTools(r.page);
      await until(async () => (await tool(r.page, 'a1').getAttribute('data-status')) === 'ready');
      assert.equal(
        await tool(r.page, 'a1').locator('[data-readiness="ready"]').getAttribute('data-evidence'),
        'true',
      );
      assert.equal(
        (await tool(r.page, 'a1').locator('.dx-chip').first().innerText()).trim(),
        'Ready',
      );
      // Ready is that tool's alone.
      assert.equal(await r.page.locator('.dv3-tool[data-status="ready"]').count(), 1);
    } finally {
      await r.close();
    }
  });

  void test('the next step: Set up project for a set-up tool, Finish setup for one that needs it', async () => {
    const h = await open('/developer?tab=tools', stub('v3', [BELKA, RUNNER]));
    try {
      await readyTools(h.page, 'a5');
      await until(
        async () => (await tool(h.page, 'a5').getAttribute('data-status')) === 'needs-setup',
      );
      const setUp = tool(h.page, 'a1').getByRole('link', {
        name: 'Set up a project for Claude Code · Belka',
      });
      assert.equal(await setUp.getAttribute('href'), '/developer?tab=projects&tool=a1');
      // Runner is paired and Omnigent is set up by the helper: its reconnect.
      await tool(h.page, 'a5')
        .getByRole('button', { name: 'Finish setting up Omnigent · Runner' })
        .click();
      await h.page.waitForURL(/reconnect=a5/, { timeout: 10_000 });
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('tab'), 'tools');
      assert.equal(url.searchParams.get('add'), 'tool');
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: imported versus paired', () => {
  void test('an imported device asks to be confirmed in its details; confirming calls the existing endpoint', async () => {
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub('v3', [BELKA, RUNNER], {
        '/api/v1/agents/devices/confirm': (call: StubCall) => ({
          device_label: (call.body as { device_label: string }).device_label,
          recognised: true,
        }),
      }),
    );
    try {
      const body = panel(h.page, 'device').locator('.dv3-device-details[data-device="d1"]');
      await body.waitFor({ timeout: 20_000 });
      assert.match(
        await body.locator('[data-imported]').innerText(),
        /Imported device — confirm it’s yours/,
      );
      await h.page.getByRole('button', { name: 'Confirm Belka is yours' }).click();
      await body.locator('[data-imported]').waitFor({ state: 'detached' });
      const sent = h.calls.find((c) => c.path === '/api/v1/agents/devices/confirm');
      assert.equal(sent?.method, 'POST');
      assert.deepEqual(sent?.body, { device_label: 'belka' });
      // The tab's own polite region, the first thing in its body.
      await until(async () => (await live(h.page).innerText()).includes('confirmed as yours'));
      assert.match(await live(h.page).innerText(), /Belka confirmed as yours/);
      // The row's chip follows.
      assert.doesNotMatch(await device(h.page, 'd1').innerText(), /confirm it’s yours/);
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: conflicts and revoked', () => {
  void test('two active agents of one tool: a note, then both intact in the device’s details', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [BELKA]));
    try {
      await ready(h.page);
      const note = h.page.locator('[data-conflicts-note]');
      assert.match(await note.innerText(), /Needs your attention: 1 conflict/);
      await note.getByRole('button', { name: 'Review Belka' }).click();
      const conflicts = panel(h.page, 'device').locator('[data-conflicts]');
      await conflicts.waitFor({ timeout: 10_000 });
      assert.match(await conflicts.innerText(), /Needs your attention: 1 conflict/);
      assert.match(await conflicts.innerText(), /Codex · Belka: 2 active/);
      assert.match(await conflicts.innerText(), /old laptop/);
      assert.match(await conflicts.innerText(), /new laptop/);
      // Rename is offered on a duplicate only.
      assert.equal(await conflicts.getByRole('button', { name: /^Rename / }).count(), 2);
      assert.equal(
        await panel(h.page, 'device')
          .getByRole('button', { name: /^Rename Claude Code/ })
          .count(),
        0,
      );
      assert.deepEqual(writes(h.calls), [], 'nothing was revoked or changed on its own');
    } finally {
      await h.close();
    }
  });

  void test('Rename from the conflicts saves through the existing endpoint', async () => {
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub('v3', [BELKA], {
        '/api/v1/agents/a2': (call: StubCall) =>
          call.method === 'PATCH'
            ? {
                ...BELKA.agents[1],
                display_name: (call.body as { display_name: string }).display_name,
              }
            : { ...BELKA.agents[1], sessions: [] },
      }),
    );
    try {
      const conflicts = panel(h.page, 'device').locator('[data-conflicts]');
      await conflicts.waitFor({ timeout: 20_000 });
      await conflicts.getByRole('button', { name: 'Rename Codex · Belka (old laptop)' }).click();
      await conflicts.getByLabel('New name').fill('spare laptop');
      await conflicts.getByRole('button', { name: /^Save/ }).click();
      await until(async () => (await conflicts.innerText()).includes('spare laptop'));
      assert.deepEqual(writes(h.calls), ['PATCH /api/v1/agents/a2']);
    } finally {
      await h.close();
    }
  });

  void test('revoked hidden by default and in no count; each tab’s toggle shows its own', async () => {
    const gone = deviceRow({
      id: 'd3',
      name: 'Old',
      agents: [agentRow({ id: 'a9', device_label: 'Old', status: 'revoked' })],
    });
    const h = await open('/developer?tab=devices', stub('v3', [BELKA, gone]));
    try {
      await ready(h.page);
      assert.equal(await device(h.page, 'd3').count(), 0);
      // Devices adds the device whose every tool is revoked.
      const toggle = h.page.getByRole('button', { name: 'Show revoked (1)' });
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await toggle.click();
      await device(h.page, 'd3').waitFor({ timeout: 5_000 });
      assert.match(await device(h.page, 'd3').innerText(), /No tools yet/);
      assert.equal(
        await h.page.getByRole('button', { name: 'Hide revoked' }).getAttribute('aria-pressed'),
        'true',
      );

      // Tools adds every revoked agent, on any device; the rows do not move.
      await h.page.locator('.page-tab[data-tab="tools"]').click();
      await readyTools(h.page);
      assert.equal(await h.page.locator('.dv3-tool').count(), 3);
      await h.page.getByRole('button', { name: 'Show revoked (2)' }).click();
      await tool(h.page, 'a4').waitFor({ timeout: 5_000 });
      await tool(h.page, 'a9').waitFor({ timeout: 5_000 });
      assert.equal(await tool(h.page, 'a4').getAttribute('data-status'), 'revoked');
      // A revoked row offers its details and nothing else. Its status chip is a
      // button too, one that only explains the status (LAI-1086), never an action.
      assert.equal(
        await tool(h.page, 'a4').getByRole('button', { name: 'Revoked', exact: true }).count(),
        1,
      );
      assert.deepEqual(
        await tool(h.page, 'a4')
          .locator('button:not(.dv3-hint-anchor), a')
          .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
        ['Details for Cursor · Belka'],
      );
      // Its details are read only.
      const body = await toolDetails(h.page, 'a4');
      assert.equal(
        await panel(h.page, 'tool')
          .getByRole('button', { name: /Disconnect/ })
          .count(),
        0,
      );
      assert.match(await body.innerText(), /Revoked/);
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Tools: the details panel’s actions', () => {
  void test('Disconnect tool names its credential and sessions; Escape keeps it; confirming revokes and closes', async () => {
    let revoked = false;
    const h = await open(
      '/developer?tab=tools',
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
      await readyTools(h.page);
      await toolDetails(h.page, 'a1');
      const disconnect = panel(h.page, 'tool').getByRole('button', { name: 'Disconnect tool…' });
      await disconnect.focus();
      await h.page.keyboard.press('Enter');

      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect/ }));
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

      // Tab moves inside the confirmation, over the panel: it reaches both buttons.
      const seen = new Set<string>();
      for (let i = 0; i < 4; i += 1) {
        await h.page.keyboard.press('Tab');
        seen.add(await focusedText(h.page));
      }
      assert.ok(seen.has('Cancel') && seen.has('Disconnect tool'), [...seen].join(', '));

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      // Escape closed the confirmation, not the panel, and focus is back on the button.
      await panel(h.page, 'tool').waitFor();
      await h.page.waitForFunction(
        () => document.activeElement?.textContent === 'Disconnect tool…',
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(revoked, false);

      await h.page.keyboard.press('Enter');
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      await tool(h.page, 'a1').waitFor({ state: 'detached', timeout: 10_000 });
      await panel(h.page, 'tool').waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(revoked, true);
      assert.deepEqual(writes(h.calls), ['POST /api/v1/agents/a1/revoke']);
      // The row left the list, so focus is on the list's heading.
      await h.page.waitForFunction(
        () => document.activeElement?.id === 'dv3-tools-title',
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(here(h.page), '/developer?tab=tools');
      assert.equal(await h.page.locator('.dv3-tool').count(), 2);
    } finally {
      await h.close();
    }
  });

  void test('Project access saves through PUT /grants; Change access goes to Project setup', async () => {
    const h = await open(
      '/developer?tab=tools&agent=a5',
      stub('v3', [RUNNER, BELKA], {
        '/api/v1/agents/a5/grants': (call: StubCall) => ({
          ...RUNNER.agents[0],
          grants: (call.body as { grants: unknown[] }).grants,
        }),
      }),
    );
    try {
      const body = panel(h.page, 'tool').locator('.dv3-tool-details[data-agent="a5"]');
      await body.waitFor({ timeout: 20_000 });
      assert.equal(
        await body.locator('[data-projects]').innerText(),
        'None — it reaches no project',
      );
      assert.equal(
        await body.getByRole('link', { name: 'Change access →' }).getAttribute('href'),
        '/developer?tab=projects&tool=a5',
      );
      await body.getByRole('button', { name: 'Project access…' }).click();
      const form = body.locator('.agents-panel');
      await form.waitFor({ timeout: 5_000 });
      await form.getByRole('button', { name: 'Cancel' }).click();
      await form.waitFor({ state: 'detached' });

      await body.getByRole('button', { name: 'Project access…' }).click();
      await form.getByRole('radio', { name: 'Read only' }).check();
      await form.getByRole('button', { name: 'Save access' }).click();
      await form.waitFor({ state: 'detached', timeout: 10_000 });
      const put = h.calls.find((c) => c.method === 'PUT');
      assert.equal(put?.path, '/api/v1/agents/a5/grants');
      assert.deepEqual(put?.body, { grants: [{ project_id: 'p1', scope: 'read_only' }] });
      assert.equal(await body.locator('[data-projects]').innerText(), 'OnRoute (read only)');
      // The row's line follows.
      assert.match(await tool(h.page, 'a5').locator('[data-line]').innerText(), /^1 project/);

      await body.getByRole('link', { name: 'Change access →' }).click();
      await h.page.waitForURL(/tab=projects/, { timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=projects&tool=a5');
    } finally {
      await h.close();
    }
  });

  void test('Reconnect on an imported device rotates, shows the secret once, and leaves no copy', async () => {
    const h = await open(
      '/developer?tab=tools&agent=a1',
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
      const body = panel(h.page, 'tool').locator('.dv3-tool-details[data-agent="a1"]');
      await body.waitFor({ timeout: 20_000 });
      assert.equal(await body.locator('[data-credential]').innerText(), 'lai_a1xx…');
      await body.getByRole('button', { name: 'Reconnect (new credential)…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Reconnect/ }));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Create new credential' }).click();
      await h.page.getByTestId('agent-secret').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.getByTestId('agent-secret').innerText(), 'lai_newx_SECRET_ONCE');
      const rotate = h.calls.find((c) => c.path === '/api/v1/agents/a1/rotate-token');
      assert.deepEqual(rotate?.body, { token_id: 't-a1' });
      assert.equal(await body.locator('[data-credential]').innerText(), 'lai_newx…');
      await h.page.getByRole('button', { name: 'Done' }).click();
      await h.page.getByTestId('agent-secret').waitFor({ state: 'detached' });
      assert.doesNotMatch(await h.page.content(), /SECRET_ONCE/);
      // Copied and done: the panel closes without asking (LAI-1081).
      await panel(h.page, 'tool').getByRole('button', { name: 'Close details' }).click();
      await panel(h.page, 'tool').waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await h.page.getByRole('alertdialog').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('closing the panel while a new credential is shown asks first (LAI-1081)', async () => {
    const h = await open(
      '/developer?tab=tools&agent=a1',
      stub('v3', [BELKA], {
        '/api/v1/agents/a1/rotate-token': () => ({
          agent: { ...BELKA.agents[0], tokens: [token('t-new', 'a1', 'lai_newx')] },
          token: token('t-new', 'a1', 'lai_newx'),
          secret: 'lai_newx_SECRET_ONCE',
        }),
      }),
    );
    try {
      const body = panel(h.page, 'tool').locator('.dv3-tool-details[data-agent="a1"]');
      await body.waitFor({ timeout: 20_000 });
      await body.getByRole('button', { name: 'Reconnect (new credential)…' }).click();
      await h.page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Create new credential' })
        .click();
      const secret = h.page.getByTestId('agent-secret');
      await secret.waitFor({ timeout: 10_000 });
      const ask = h.page.getByRole('alertdialog', {
        name: 'Close without copying the new credential?',
      });

      // Reloading meanwhile gets the browser's own warning; staying keeps it.
      const warned = new Promise<string>((resolve) => {
        h.page.once('dialog', (d) => {
          resolve(d.type());
          void d.dismiss();
        });
      });
      void h.page.reload().catch(() => undefined);
      assert.equal(await warned, 'beforeunload');
      assert.equal(await secret.innerText(), 'lai_newx_SECRET_ONCE');

      // Escape asks; Keep it open keeps the panel, its address and the secret.
      await h.page.keyboard.press('Escape');
      await ask.waitFor({ timeout: 10_000 });
      assert.match(await ask.innerText(), /shown only once/);
      await ask.getByRole('button', { name: 'Keep it open' }).click();
      await ask.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await panel(h.page, 'tool').count(), 1);
      assert.equal(await secret.innerText(), 'lai_newx_SECRET_ONCE');
      assert.equal(new URL(h.page.url()).searchParams.get('agent'), 'a1');

      // The scrim asks too.
      await h.page.locator('.side-panel-scrim').click({ position: { x: 10, y: 10 } });
      await ask.waitFor({ timeout: 10_000 });
      await ask.getByRole('button', { name: 'Keep it open' }).click();
      await ask.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await secret.innerText(), 'lai_newx_SECRET_ONCE');

      // × asks; Close anyway closes the panel and the secret goes with it.
      await panel(h.page, 'tool').getByRole('button', { name: 'Close details' }).click();
      await ask.waitFor({ timeout: 10_000 });
      await ask.getByRole('button', { name: 'Close anyway' }).click();
      await panel(h.page, 'tool').waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('agent'), null);
      assert.doesNotMatch(await h.page.content(), /SECRET_ONCE/);
    } finally {
      await h.close();
    }
  });

  void test('a secret on screen is blanked when its tool is disconnected', async () => {
    const h = await open(
      '/developer?tab=tools&agent=a1',
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
      const body = panel(h.page, 'tool').locator('.dv3-tool-details[data-agent="a1"]');
      await body.waitFor({ timeout: 20_000 });
      await body.getByRole('button', { name: 'Reconnect (new credential)…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Reconnect|Disconnect/ }));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Create new credential' }).click();
      await h.page.getByTestId('agent-secret').waitFor({ timeout: 10_000 });

      await panel(h.page, 'tool').getByRole('button', { name: 'Disconnect tool…' }).click();
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      await panel(h.page, 'tool').waitFor({ state: 'detached', timeout: 10_000 });
      await until(async () => !(await h.page.content()).includes('SECRET_ONCE'));
      assert.doesNotMatch(await h.page.content(), /SECRET_ONCE/);
    } finally {
      await h.close();
    }
  });

  void test('disconnecting an imported device’s last tool takes the device off Devices too', async () => {
    // An imported device whose tools are all revoked is history (LAI-1070 keeps this).
    const solo = deviceRow({
      id: 'd4',
      name: 'Solo',
      agents: [agentRow({ id: 'a7', harness: 'codex', device_label: 'Solo' })],
    });
    const h = await open(
      '/developer?tab=tools&agent=a7',
      stub('v3', [BELKA, solo], {
        '/api/v1/agents/a7/revoke': () => ({
          ...solo.agents[0],
          status: 'revoked',
          revoked_at: Date.now(),
        }),
      }),
    );
    try {
      await panel(h.page, 'tool').locator('[data-agent="a7"]').waitFor({ timeout: 20_000 });
      await panel(h.page, 'tool').getByRole('button', { name: 'Disconnect tool…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect/ }));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      await tool(h.page, 'a7').waitFor({ state: 'detached', timeout: 10_000 });
      // Opened from its address, so closing replaced it: no entry to go Back to.
      assert.equal(here(h.page), '/developer?tab=tools');
      await h.page.waitForFunction(
        () => document.activeElement?.id === 'dv3-tools-title',
        undefined,
        { timeout: 5_000 },
      );
      await h.page.locator('.page-tab[data-tab="devices"]').click();
      await ready(h.page);
      assert.equal(await device(h.page, 'd4').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a paired device stays listed after its only tool is disconnected (LAI-1070)', async () => {
    const h = await open(
      '/developer?tab=tools&agent=a5',
      stub('v3', [RUNNER], {
        '/api/v1/agents/a5/revoke': () => ({
          ...RUNNER.agents[0],
          status: 'revoked',
          revoked_at: Date.now(),
        }),
      }),
    );
    try {
      await panel(h.page, 'tool').locator('[data-agent="a5"]').waitFor({ timeout: 20_000 });
      await panel(h.page, 'tool').getByRole('button', { name: 'Disconnect tool…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect/ }));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect tool' }).click();
      await tool(h.page, 'a5').waitFor({ state: 'detached', timeout: 10_000 });
      // Runner is paired: Tools offers a tool for it rather than *Add a device first*.
      await h.page.getByText('No tools connected').waitFor({ timeout: 10_000 });

      await h.page.locator('.page-tab[data-tab="devices"]').click();
      await device(h.page, 'd2').waitFor({ timeout: 20_000 });
      assert.match(await device(h.page, 'd2').locator('[data-line]').innerText(), /No tools yet/);
      assert.equal(await h.page.getByText('Every device and tool of yours is revoked.').count(), 0);
      const body = await deviceDetails(h.page, 'd2');
      assert.match(await body.innerText(), /No tools yet — Add a tool/);
      await body.getByRole('button', { name: 'Add a tool' }).click();
      await h.page.waitForURL(/add=tool/, { timeout: 5_000 });
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('tab'), 'tools');
      assert.equal(url.searchParams.get('device'), 'd2');
      await h.page.locator('[data-wizard="tool"]').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: the device’s own actions', () => {
  void test('Disconnect device names every tool on it and calls the device revoke', async () => {
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub('v3', [BELKA], {
        '/api/v1/agents/devices/revoke': { revoked_agent_ids: ['a1', 'a2', 'a3'] },
      }),
    );
    try {
      await panel(h.page, 'device').locator('[data-device="d1"]').waitFor({ timeout: 20_000 });
      await panel(h.page, 'device').getByRole('button', { name: 'Disconnect device…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect/ }));
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
      await panel(h.page, 'device').waitFor({ state: 'detached', timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('Disconnect device cannot be chosen again while the first is under way', async () => {
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub('v3', [BELKA], {
        '/api/v1/agents/devices/revoke': { revoked_agent_ids: ['a1', 'a2', 'a3'] },
      }),
    );
    try {
      const button = panel(h.page, 'device').getByRole('button', { name: 'Disconnect device…' });
      await button.waitFor({ timeout: 20_000 });
      // Hold the session reads the dialog waits for, so the first choice stays out.
      let release: () => void = () => undefined;
      const held = new Promise<void>((done) => {
        release = done;
      });
      await h.page.route('**/api/v1/agents/a1', async (route) => {
        await held;
        await route.continue();
      });
      await button.click();
      await until(async () => (await button.getAttribute('aria-disabled')) === 'true');
      // Chosen anyway: it does nothing.
      await button.dispatchEvent('click');
      release();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect/ }));
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.count(), 1);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      // Cancelled: it can be chosen again.
      assert.equal(await button.getAttribute('aria-disabled'), null);
      assert.deepEqual(writes(h.calls), [], 'nothing was revoked');
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices and Tools: states', () => {
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

  void test('empty Devices: no devices yet, and Add device opens the wizard', async () => {
    const h = await open('/developer?tab=devices', stub('v3', []));
    try {
      await h.page.getByText('No devices yet').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Add device', exact: true }).click();
      // The V3 Add device wizard (LAI-1061), not the classic registration one.
      await h.page.locator('[data-wizard="device"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.agents-wizard').count(), 0);
      assert.equal(here(h.page), '/developer?tab=devices&add=device');
      assert.equal(await h.page.locator('.agents-list').count(), 0);
      assert.equal(await h.page.locator('.devices-group').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('empty Tools: Add a device first with no paired device, then No tools connected', async () => {
    const h = await open('/developer?tab=tools', stub('v3', []));
    try {
      await h.page
        .getByRole('heading', { name: 'Add a device first' })
        .waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Add device →' }).click();
      await h.page.locator('[data-wizard="device"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=devices&add=device');
    } finally {
      await h.close();
    }
    const paired = deviceRow({ id: 'd6', name: 'Walkbook', origin: 'paired', agents: [] });
    const p = await open('/developer?tab=tools', stub('v3', [paired]));
    try {
      await p.page.getByText('No tools connected').waitFor({ timeout: 20_000 });
      await p.page.getByRole('button', { name: 'Add first tool' }).click();
      await p.page.locator('[data-wizard="tool"]').waitFor({ timeout: 20_000 });
      assert.equal(here(p.page), '/developer?tab=tools&add=tool');
    } finally {
      await p.close();
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
      '/developer?tab=tools',
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
      const body = await deviceDetails(h.page, 'd3');
      assert.match(await body.innerText(), /Revoked/);
      assert.equal(
        await panel(h.page, 'device')
          .getByRole('button', { name: /Disconnect/ })
          .count(),
        0,
      );
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
      assert.equal(await h.page.locator('.dv3-roster').count(), 0);
      assert.equal(await h.page.getByRole('button', { name: '+ Register an agent' }).count(), 1);
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/devices').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('preview: the V3 Devices and Tools tabs are reachable and draw the new lists', async () => {
    const h = await open('/developer?tab=devices', stub('preview', [BELKA]));
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('[data-testid="agents-tab"]').count(), 0);
      await h.page.locator('.page-tab[data-tab="tools"]').click();
      await readyTools(h.page);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------------ LAI-1095: renaming a device

/** Belka as `PATCH /devices/d1` answers it, renamed: every tool on it relabelled. */
const STRELKA = deviceRow({
  id: 'd1',
  name: 'Strelka',
  confirmed: false,
  last_seen_at: NOW - 60_000,
  agents: BELKA.agents.map((a) => ({ ...a, device_label: 'Strelka' })),
});

/** `GET` is Belka; a `PATCH` is answered by `onPatch`. */
const renameRoute =
  (onPatch: (call: StubCall) => unknown) =>
  (call: StubCall): unknown =>
    call.method === 'PATCH' ? onPatch(call) : BELKA;

const titleOf = (page: Page) => panel(page, 'device').locator('#dv3-device-panel-title');

void describe('V3 Devices: renaming a device (LAI-1095)', () => {
  void test('Rename… sends the trimmed name; the panel, the row and its tools follow; focus returns', async () => {
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub('v3', [BELKA, RUNNER], { '/api/v1/devices/d1': renameRoute(() => STRELKA) }),
    );
    try {
      const body = panel(h.page, 'device').locator('.dv3-device-details[data-device="d1"]');
      await body.waitFor({ timeout: 20_000 });
      await body.getByRole('button', { name: 'Rename Belka' }).click();
      const form = body.locator('[data-device-rename]');
      const input = form.getByRole('textbox', { name: 'Device name' });
      const save = form.getByRole('button', { name: 'Save name' });
      assert.equal(await input.inputValue(), 'Belka');
      assert.equal(await input.evaluate((el) => el === document.activeElement), true);
      // Unchanged, and empty, cannot be sent.
      assert.equal(await save.isDisabled(), true);
      await input.fill('   ');
      assert.equal(await save.isDisabled(), true);
      assert.match(await form.innerText(), /Give the device a name\./);

      await input.fill('  Strelka ');
      await save.click();
      await form.waitFor({ state: 'detached' });

      assert.deepEqual(writes(h.calls), ['PATCH /api/v1/devices/d1']);
      const sent = h.calls.find((c) => c.method === 'PATCH');
      assert.deepEqual(sent?.body, { display_name: 'Strelka' });
      assert.equal(await titleOf(h.page).innerText(), 'Strelka');
      assert.equal(await device(h.page, 'd1').locator('.dx-record-title').innerText(), 'Strelka');
      assert.match(
        await body.locator('ul[aria-label="Tools on Strelka"]').innerText(),
        /Claude Code · Strelka/,
      );
      await until(async () => (await live(h.page).innerText()).includes('Renamed to Strelka.'));
      assert.match(await live(h.page).innerText(), /Renamed to Strelka\./);
      await until(async () => (await focusedText(h.page)) === 'Rename Strelka');
      assert.equal(await focusedText(h.page), 'Rename Strelka');
    } finally {
      await h.close();
    }
  });

  void test('a refused name stays in the form with the reason; Escape closes the form, not the panel', async () => {
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub('v3', [BELKA, RUNNER], {
        '/api/v1/devices/d1': renameRoute(() =>
          refuse(409, 'conflict', 'You have a device with that name'),
        ),
      }),
    );
    try {
      const body = panel(h.page, 'device').locator('.dv3-device-details[data-device="d1"]');
      await body.waitFor({ timeout: 20_000 });
      await body.getByRole('button', { name: 'Rename Belka' }).click();
      const form = body.locator('[data-device-rename]');
      await form.getByRole('textbox', { name: 'Device name' }).fill('Runner');
      await form.getByRole('button', { name: 'Save name' }).click();
      const alert = form.locator('[role="alert"]');
      await alert.waitFor({ timeout: 10_000 });
      assert.match(await alert.innerText(), /You have a device with that name/);
      assert.equal(await titleOf(h.page).innerText(), 'Belka');
      // Focus is back on the name, not lost with the disabled Save.
      const input = form.getByRole('textbox', { name: 'Device name' });
      await until(async () => input.evaluate((el) => el === document.activeElement));
      assert.equal(await input.evaluate((el) => el === document.activeElement), true);

      await h.page.keyboard.press('Escape');
      await form.waitFor({ state: 'detached' });
      assert.equal(await body.isVisible(), true);
      await until(async () => (await focusedText(h.page)) === 'Rename Belka');
      assert.equal(await focusedText(h.page), 'Rename Belka');
    } finally {
      await h.close();
    }
  });

  void test('a revoked device offers no Rename', async () => {
    const old = deviceRow({
      id: 'd3',
      name: 'Old',
      status: 'revoked',
      agents: [agentRow({ id: 'a9', status: 'revoked', device_label: 'Old' })],
    });
    const h = await open('/developer?tab=devices&device=d3', stub('v3', [BELKA, old]));
    try {
      const body = panel(h.page, 'device').locator('.dv3-device-details[data-device="d3"]');
      await body.waitFor({ timeout: 20_000 });
      assert.equal(await body.locator('[data-rename-device]').count(), 0);
      assert.equal(await body.getByRole('button', { name: /^Rename/ }).count(), 0);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark']) {
    void test(`the form fits a 390px phone in ${theme}`, async () => {
      const h = await open(
        '/developer?tab=devices&device=d1',
        stub('v3', [BELKA, RUNNER], { '/api/v1/devices/d1': renameRoute(() => STRELKA) }),
      );
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        const body = panel(h.page, 'device').locator('.dv3-device-details[data-device="d1"]');
        await body.waitFor({ timeout: 20_000 });
        await body.getByRole('button', { name: 'Rename Belka' }).click();
        const form = body.locator('[data-device-rename]');
        for (const part of [
          form.getByRole('textbox', { name: 'Device name' }),
          form.getByRole('button', { name: 'Save name' }),
          form.getByRole('button', { name: 'Cancel' }),
        ]) {
          await part.scrollIntoViewIfNeeded();
          const box = await part.boundingBox();
          assert.ok(box !== null, 'not rendered');
          assert.ok(box.x >= 0 && box.x + box.width <= 390, `off-screen: ${JSON.stringify(box)}`);
        }
        const wide = await h.page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(wide <= 390, `the page scrolls sideways: ${String(wide)}`);
        const evidence = process.env.LAIKA_EVIDENCE_DIR;
        if (evidence !== undefined) {
          await panel(h.page, 'device').screenshot({
            path: join(evidence, `device-rename-${theme}-390.png`),
          });
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('an unavailable action says why (LAI-1141, the audit’s B10)', () => {
  void test('Reconnect with no live credential to replace: the reason, described by it, and a click that opens nothing', async () => {
    const spent = deviceRow({
      id: 'd1',
      name: 'Belka',
      agents: [
        agentRow({ id: 'a1', tokens: [token('t-a1', 'a1', 'lai_a1xx', { revoked_at: 2 })] }),
      ],
    });
    const h = await open('/developer?tab=tools&agent=a1', stub('v3', [spent]));
    try {
      const body = panel(h.page, 'tool').locator('.dv3-tool-details[data-agent="a1"]');
      await body.waitFor({ timeout: 20_000 });
      const button = body.getByRole('button', { name: 'Reconnect (new credential)…' });
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      const why = body.locator('[data-reconnect-why]');
      assert.match(await why.innerText(), /No live credential to replace/);
      assert.equal(await button.getAttribute('aria-describedby'), await why.getAttribute('id'));
      await button.click();
      await h.page.waitForTimeout(500);
      assert.equal(await h.page.getByRole('alertdialog').count(), 0);
      assert.deepEqual(writes(h.calls), [], 'nothing was rotated');
    } finally {
      await h.close();
    }
  });

  void test('Disconnect device with no active tool: the reason, described by it, and a click that opens nothing', async () => {
    const idle = deviceRow({
      id: 'd1',
      name: 'Belka',
      agents: [agentRow({ id: 'a1', status: 'revoked' })],
    });
    const h = await open('/developer?tab=devices&device=d1', stub('v3', [idle]));
    try {
      const button = panel(h.page, 'device').getByRole('button', { name: 'Disconnect device…' });
      await button.waitFor({ timeout: 20_000 });
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      const why = panel(h.page, 'device').locator('[data-disconnect-why]');
      assert.match(await why.innerText(), /nothing to disconnect/);
      assert.equal(await button.getAttribute('aria-describedby'), await why.getAttribute('id'));
      await button.click();
      await h.page.waitForTimeout(500);
      assert.equal(await h.page.getByRole('alertdialog').count(), 0);
      assert.deepEqual(writes(h.calls), [], 'nothing was revoked');
    } finally {
      await h.close();
    }
  });

  void test('neither reason is drawn when the action is available', async () => {
    const h = await open('/developer?tab=tools&agent=a1', stub('v3', [BELKA]));
    try {
      const body = panel(h.page, 'tool').locator('.dv3-tool-details[data-agent="a1"]');
      await body.waitFor({ timeout: 20_000 });
      assert.equal(await body.locator('[data-reconnect-why]').count(), 0);
      assert.equal(
        await body
          .getByRole('button', { name: 'Reconnect (new credential)…' })
          .getAttribute('aria-describedby'),
        null,
      );
    } finally {
      await h.close();
    }
  });
});
