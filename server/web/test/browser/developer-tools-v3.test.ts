/**
 * Developer access V3 → the details side panel (LAI-1078's `SidePanel`, its
 * first use in LAI-1080), in a real browser against a stubbed API.
 *
 * - *Details* opens it as a history entry: the URL names it, focus moves in,
 *   and Tab stays inside.
 * - Escape, the scrim, × and Back each close it, and focus comes back to the
 *   *Details* that opened it. One opened from a pasted address closes by
 *   replacing the address, so Back leaves rather than reopening it.
 * - A device's tool opens that tool's details, and closing it goes back to the
 *   device's.
 * - A bottom sheet on a phone, with no sideways scroll; the card colour of
 *   whichever theme is on.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save the Devices and Tools tabs and both
 * panels, light and dark, at 1440 and 390 px.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, navigateInApp, open, setTheme, until, type ApiStub } from './harness.ts';

const NOW = Date.now();

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
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

const COMPAT = {
  server: { version: '0.1.0', build_commit: null },
  protocol: { current: 2, min_client: 1 },
  features: {
    developer_access: 'v3',
    device_pairing: true,
    tool_setup_exchange: true,
    client_reports: true,
    project_setups: false,
  },
  cli: {
    min_protocol_for: {
      device_pairing: 2,
      tool_setup_exchange: 2,
      client_reports: 2,
      project_setups: 2,
    },
  },
  release_notes: {
    ref: null,
    whats_new: [
      { protocol: 1, summary: 'laika agent login, session hooks, laika connect and checkpoints.' },
      { protocol: 2, summary: 'laika device pair, laika tool add and client reports.' },
    ],
  },
};

const token = (agentId: string) => ({
  id: `t-${agentId}`,
  name: `t-${agentId}`,
  prefix: `lai_${agentId}xx`,
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
});

const agentRow = (
  id: string,
  harness: string,
  seen: number | null,
  grants: { project_id: string; scope: string }[] = [],
) => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: id,
  harness,
  device_label: 'Belka',
  status: 'active',
  grants,
  tokens: [token(id)],
  created_at: 1,
  revoked_at: null,
  last_seen_at: seen,
});

type Agent = ReturnType<typeof agentRow>;

/** Claude Code set up and in use; Codex installed, never used; Omnigent reached the board. */
const CLAUDE = agentRow('a1', 'claude-code', NOW - 30_000, [{ project_id: 'p1', scope: 'full' }]);
const CODEX = agentRow('a2', 'codex', null);
const OMNI = agentRow('a3', 'omnigent', NOW - 5 * 60_000);

const deviceRow = (agents: Agent[]) => ({
  id: 'd1',
  display_name: 'Belka',
  device_label: 'belka',
  kind: 'local',
  origin: 'paired',
  status: 'active',
  confirmed: true,
  confirmed_at: null,
  paired_at: 1,
  key_fingerprint: '7f3a91c20b5e44d1',
  last_seen_at: NOW - 30_000,
  active_count: agents.length,
  revoked_count: 0,
  agents,
  created_at: 1,
  revoked_at: null,
});

const check = (state: string, detail: unknown, at: number | null = null) => ({
  state,
  at,
  detail,
});

const report = (protocol: number) => ({
  cli_version: '0.1.0',
  cli_commit: null,
  protocol,
  capabilities: ['client_report', 'doctor', 'update'],
  harness_version: null,
  harness: null,
  reported_at: NOW - 5 * 60_000,
  self_reported: true,
});

/** The board's evidence for each: Claude Code Ready, Codex never used, Omnigent not yet itself. */
function verification(agent: Agent) {
  const ready = agent.id === 'a1';
  const used = agent.last_seen_at !== null;
  return {
    agent_id: agent.id,
    harness: agent.harness,
    status: 'active',
    now: Date.now(),
    last_seen_at: agent.last_seen_at,
    checks: {
      device_paired: check('pass', { device_id: 'd1' }, NOW - 3_600_000),
      credential_installed: check(
        'pass',
        { token_id: `t-${agent.id}`, via_exchange: true },
        NOW - 3_600_000,
      ),
      credential_used: check(used ? 'pass' : 'fail', null),
      tool_request: check(
        ready ? 'pass' : 'fail',
        {
          evidence: ready ? 'client_info' : null,
          mcp_client_name: 'specific',
          client_slug: ready ? agent.harness : null,
          client_name: ready ? 'claude-code' : null,
          client_version: ready ? '2.1.0' : null,
          self_reported: true,
        },
        ready ? Date.now() - 30_000 : null,
      ),
      required_capabilities: check('pass', { required: [], missing: [] }),
      session_hooks: check(
        ready ? 'pass' : 'fail',
        { harness: ready ? agent.harness : null },
        ready ? Date.now() - 30_000 : null,
      ),
    },
    // Omnigent's helper speaks protocol 1: an update is required for pairing.
    client_report: agent.id === 'a3' ? report(1) : agent.id === 'a1' ? report(2) : null,
  };
}

const NO_CONSENT = { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null };

function stub(agents: readonly Agent[] = [CLAUDE, CODEX, OMNI], devices?: unknown[]): ApiStub {
  const perAgent: Record<string, unknown> = {};
  for (const a of agents) {
    perAgent[`/api/v1/agents/${a.id}/checkpoint-consent`] = NO_CONSENT;
    perAgent[`/api/v1/agents/${a.id}`] = { ...a, sessions: [] };
    perAgent[`/api/v1/agents/${a.id}/verification`] = verification(a);
  }
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: agents, next_cursor: null },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/devices': { data: devices ?? [deviceRow([...agents])] },
    '/api/v1/developer/compatibility': COMPAT,
    ...perAgent,
  };
}

after(async () => {
  await closeBrowser();
});

const panel = (page: Page) => page.locator('.side-panel');
const here = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};
const depth = (page: Page) => page.evaluate(() => history.length);
const focusIn = (page: Page, selector: string) =>
  page.evaluate((s) => document.activeElement?.closest(s) !== null, selector);
const focusedDetails = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-details') ?? null);

async function openFromRow(page: Page, id = 'a1'): Promise<void> {
  await page.locator(`.dv3-tool[data-agent="${id}"]`).waitFor({ timeout: 20_000 });
  await page.locator(`[data-details="tools:${id}"]`).click();
  await panel(page).locator(`[data-agent="${id}"]`).waitFor({ timeout: 10_000 });
}

/** Closed, back on the list, and focus on the *Details* that opened it. */
async function closedTo(page: Page, id = 'a1'): Promise<void> {
  await panel(page).waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForFunction(
    (key) => document.activeElement?.getAttribute('data-details') === key,
    `tools:${id}`,
    { timeout: 5_000 },
  );
}

void describe('the details panel: open, held, closed', () => {
  void test('Details opens it as a history entry: a labelled modal dialog, focus in, Tab held inside', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await h.page.locator('.dv3-tool[data-agent="a1"]').waitFor({ timeout: 20_000 });
      const before = await depth(h.page);
      await openFromRow(h.page);
      assert.equal(here(h.page), '/developer?tab=tools&agent=a1');
      assert.equal(await depth(h.page), before + 1, 'opening is a history entry');
      const dialog = h.page.getByRole('dialog', { name: 'Claude Code · Belka' });
      assert.equal(await dialog.count(), 1);
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.equal(await dialog.getAttribute('data-panel'), 'tool');
      // Focus is on ×, inside.
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Close details',
      );
      for (let i = 0; i < 25; i += 1) {
        await h.page.keyboard.press('Tab');
        assert.equal(await focusIn(h.page, '.side-panel'), true, `Tab ${String(i + 1)} left it`);
      }
      for (let i = 0; i < 5; i += 1) {
        await h.page.keyboard.press('Shift+Tab');
        assert.equal(
          await focusIn(h.page, '.side-panel'),
          true,
          `Shift+Tab ${String(i + 1)} left it`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('Escape closes it by going Back, and focus returns to its Details', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await openFromRow(h.page);
      await h.page.keyboard.press('Escape');
      await closedTo(h.page);
      assert.equal(here(h.page), '/developer?tab=tools');
      // It went Back: Forward reopens it.
      await h.page.goForward();
      await panel(h.page).locator('[data-agent="a1"]').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('the scrim closes it, and focus returns to its Details', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await openFromRow(h.page, 'a2');
      await h.page.locator('.side-panel-scrim').click({ position: { x: 20, y: 20 } });
      await closedTo(h.page, 'a2');
      assert.equal(here(h.page), '/developer?tab=tools');
    } finally {
      await h.close();
    }
  });

  void test('× closes it, and focus returns to its Details', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await openFromRow(h.page, 'a3');
      await panel(h.page).getByRole('button', { name: 'Close details' }).click();
      await closedTo(h.page, 'a3');
      assert.equal(here(h.page), '/developer?tab=tools');
    } finally {
      await h.close();
    }
  });

  void test('Back closes it, and focus returns to its Details', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await openFromRow(h.page);
      await h.page.goBack();
      await closedTo(h.page);
      assert.equal(here(h.page), '/developer?tab=tools');
    } finally {
      await h.close();
    }
  });

  void test('opened from its address, closing replaces it: Back does not reopen it', async () => {
    const h = await open('/developer?tab=tools&agent=a1', stub());
    try {
      await panel(h.page).locator('[data-agent="a1"]').waitFor({ timeout: 20_000 });
      const before = await depth(h.page);
      await h.page.keyboard.press('Escape');
      await closedTo(h.page);
      assert.equal(here(h.page), '/developer?tab=tools');
      assert.equal(await depth(h.page), before, 'closing replaced the address');
      assert.equal(await focusedDetails(h.page), 'tools:a1');
    } finally {
      await h.close();
    }
  });

  void test('a device’s tool opens that tool’s details; closing it goes back to the device’s', async () => {
    const h = await open('/developer?tab=devices', stub());
    try {
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 20_000 });
      await h.page.locator('[data-details="devices:d1"]').click();
      const device = h.page.getByRole('dialog', { name: 'Belka' });
      await device.waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=devices&device=d1');
      await device.getByRole('button', { name: /^Codex · Belka: Needs setup/ }).click();
      await h.page.getByRole('dialog', { name: 'Codex · Belka' }).waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=tools&agent=a2');
      await h.page.keyboard.press('Escape');
      await device.waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=devices&device=d1');
      // …and that one closes by going Back too, to the Devices list.
      await h.page.keyboard.press('Escape');
      await panel(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=devices');
      await until(async () => (await focusedDetails(h.page)) === 'devices:d1');
    } finally {
      await h.close();
    }
  });

  void test('Escape in a confirmation over the panel closes the confirmation alone', async () => {
    const h = await open('/developer?tab=tools&agent=a2', stub());
    try {
      await panel(h.page).locator('[data-agent="a2"]').waitFor({ timeout: 20_000 });
      await panel(h.page).getByRole('button', { name: 'Disconnect tool…' }).click();
      const confirm = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect Codex/ }));
      await confirm.waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await confirm.waitFor({ state: 'detached' });
      assert.equal(await panel(h.page).count(), 1);
      assert.equal(here(h.page), '/developer?tab=tools&agent=a2');
      assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the details panel: what it says', () => {
  void test('a Ready tool: its checks from the board’s evidence, its helper, projects and credential', async () => {
    const h = await open('/developer?tab=tools&agent=a1', stub());
    try {
      const body = panel(h.page).locator('.dv3-tool-details[data-agent="a1"]');
      await body.waitFor({ timeout: 20_000 });
      await until(
        async () => (await panel(h.page).locator('[data-readiness="ready"]').count()) === 1,
      );
      assert.equal(
        await panel(h.page).locator('[data-readiness]').getAttribute('data-evidence'),
        'true',
      );
      assert.deepEqual(
        await body
          .locator('[data-check]')
          .evaluateAll((lines) =>
            lines.map(
              (l) => `${l.getAttribute('data-check') ?? ''}:${l.getAttribute('data-state') ?? ''}`,
            ),
          ),
        [
          'device_paired:pass',
          'credential_installed:pass',
          'tool_request:pass',
          'session_hooks:pass',
        ],
      );
      assert.match(await body.innerText(), /Device\s*Belka/);
      assert.equal(await body.locator('[data-projects]').innerText(), 'OnRoute (full)');
      assert.equal(await body.locator('[data-credential]').innerText(), 'lai_a1xx…');
      // Owner, signed in: the checkpoint consent is here, off until given.
      assert.match(await body.innerText(), /Save checkpoints automatically/);
      // No duplicate, so no rename.
      assert.equal(await body.locator('[data-rename]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a tool that needs setup says what is missing, and is not Ready', async () => {
    const h = await open('/developer?tab=tools&agent=a2', stub());
    try {
      const body = panel(h.page).locator('.dv3-tool-details[data-agent="a2"]');
      await body.waitFor({ timeout: 20_000 });
      await until(
        async () => (await panel(h.page).locator('[data-evidence="true"]').count()) === 1,
      );
      assert.equal(
        await panel(h.page).locator('[data-readiness]').getAttribute('data-readiness'),
        'needs-setup',
      );
      assert.equal(
        await body.locator('[data-check="tool_request"]').getAttribute('data-state'),
        'fail',
      );
      assert.doesNotMatch(await panel(h.page).innerText(), /\bReady\b(?! means)/);
    } finally {
      await h.close();
    }
  });
});

void describe('the details panel: phone and themes', () => {
  void test('390 px: a bottom sheet the width of the screen, with no sideways scroll', async () => {
    const h = await open('/developer?tab=tools', stub(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      await openFromRow(h.page, 'a3');
      const box = await panel(h.page).boundingBox();
      assert.ok(box !== null);
      assert.equal(Math.round(box.x), 0);
      assert.equal(Math.round(box.width), 390);
      assert.equal(Math.round(box.y + box.height), 844, 'it sits on the bottom edge');
      assert.ok(box.height <= 844 * 0.86 + 1, `it is ${String(box.height)}px tall`);
      for (const summary of await panel(h.page).locator('summary').all()) await summary.click();
      const wide = await h.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(wide <= 0, `the page scrolls sideways by ${String(wide)}px`);
      const over = await panel(h.page)
        .locator('.side-panel-body')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(over <= 0, `the sheet scrolls sideways by ${String(over)}px`);
    } finally {
      await h.close();
    }
  });

  void test('both themes: the panel is the theme’s card, and the two differ', async () => {
    const colours: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      const h = await open('/developer?tab=tools', stub());
      try {
        await setTheme(h.page, theme);
        await openFromRow(h.page);
        const [panelBg, cardBg] = await h.page.evaluate(() => [
          getComputedStyle(document.querySelector('.side-panel') as Element).backgroundColor,
          getComputedStyle(document.querySelector('.dv3-roster .dx-card') as Element)
            .backgroundColor,
        ]);
        assert.equal(panelBg, cardBg, `${theme}: the panel is not the card colour`);
        colours.push(panelBg ?? '');
      } finally {
        await h.close();
      }
    }
    assert.notEqual(colours[0], colours[1], 'light and dark drew the same panel');
  });
});

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

void describe(
  'evidence: Devices and Tools and their details, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      const shots: readonly {
        readonly name: string;
        readonly path: string;
        readonly api: ApiStub;
        readonly ready: (page: Page) => Promise<void>;
      }[] = [
        {
          name: 'devices-list',
          path: '/developer?tab=devices',
          api: stub(),
          ready: (page) => page.locator('.dv3-device').first().waitFor({ timeout: 20_000 }),
        },
        {
          name: 'devices-fresh',
          path: '/developer?tab=devices',
          api: stub([], []),
          ready: (page) => page.getByText('No devices yet').waitFor({ timeout: 20_000 }),
        },
        {
          name: 'tools-list',
          path: '/developer?tab=tools',
          api: stub(),
          ready: async (page) => {
            await page.locator('.dv3-tool[data-status="ready"]').waitFor({ timeout: 20_000 });
            await page.locator('[data-update-chip]').waitFor({ timeout: 20_000 });
          },
        },
        {
          name: 'tools-fresh',
          path: '/developer?tab=tools',
          api: stub([], []),
          ready: (page) => page.getByText('Add a device first').waitFor({ timeout: 20_000 }),
        },
        {
          name: 'tools-none',
          path: '/developer?tab=tools',
          api: stub([]),
          ready: (page) => page.getByText('No tools connected').waitFor({ timeout: 20_000 }),
        },
        {
          name: 'device-details',
          path: '/developer?tab=devices&device=d1',
          api: stub(),
          ready: (page) => page.locator('[data-device-update]').waitFor({ timeout: 20_000 }),
        },
        {
          name: 'tool-details-ready',
          path: '/developer?tab=tools&agent=a1',
          api: stub(),
          ready: (page) =>
            page.locator('.side-panel [data-readiness="ready"]').waitFor({ timeout: 20_000 }),
        },
        {
          name: 'tool-details-needs-setup',
          path: '/developer?tab=tools&agent=a2',
          api: stub(),
          ready: (page) =>
            page.locator('.side-panel [data-check="tool_request"]').waitFor({ timeout: 20_000 }),
        },
        {
          name: 'tool-details-update-required',
          path: '/developer?tab=tools&agent=a3',
          api: stub(),
          ready: (page) =>
            page.locator('.side-panel [data-update="required"]').waitFor({ timeout: 20_000 }),
        },
      ];
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          for (const shot of shots) {
            // The theme is set through the real control, which a panel's scrim
            // would cover: on the tab first, then to the panel's address.
            const tab = shot.path.replace(/&.*$/, '');
            const h = await open(tab, shot.api);
            try {
              await h.page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
              await setTheme(h.page, theme);
              if (tab !== shot.path) await navigateInApp(h.page, shot.path);
              await shot.ready(h.page);
              // Let the panel's and the chips' last answers land.
              await h.page.waitForTimeout(300);
              await h.page.screenshot({
                path: join(dir, `${shot.name}-${theme}-${String(width)}.png`),
                fullPage: !shot.name.includes('details'),
              });
            } finally {
              await h.close();
            }
          }
        }
      }
    });
  },
);
