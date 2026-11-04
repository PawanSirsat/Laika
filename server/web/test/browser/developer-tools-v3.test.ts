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
 * - One row a tool (LAI-321): a tool on two devices is a header — the tool,
 *   how many devices, the worst of their statuses — over a line a device,
 *   each opening its own agent's details; no name an owner typed anywhere.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save the Devices and Tools tabs and both
 * panels, light and dark, at 1440 and 390 px.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, navigateInApp, open, setTheme, until, type ApiStub } from './harness.ts';
import { NEVER_REPORTED } from '../helpers/launcher.ts';

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
  revoked_at: null as number | null,
  last_seen_at: seen,
  launcher: NEVER_REPORTED,
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
  launcher: NEVER_REPORTED,
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

/** Two Codex agents on Belka, from before one per tool per device: a conflict. */
const TWIN_A = agentRow('a4', 'codex', NOW - 60_000);
const TWIN_B = agentRow('a5', 'codex', NOW - 120_000);

const focusLabel = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent?.trim() ??
      '',
  );

void describe('the details panel: a form inside it, and Escape (review round 1)', () => {
  void test('Escape in Project access closes the form, not the panel; a second Escape closes the panel', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await openFromRow(h.page);
      const body = panel(h.page).locator('.dv3-tool-details[data-agent="a1"]');
      await body.getByRole('button', { name: 'Project access…' }).click();
      const form = body.locator('.agents-panel');
      await form.waitFor({ timeout: 10_000 });
      await form.getByRole('radio', { name: 'Read only' }).focus();
      await h.page.keyboard.press('Escape');
      await form.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await panel(h.page).count(), 1, 'Escape in the form closed the panel');
      assert.equal(here(h.page), '/developer?tab=tools&agent=a1');
      // Focus is back on the button that opened the form, inside the panel.
      await until(async () => (await focusLabel(h.page)) === 'Project access…');
      assert.equal(await focusIn(h.page, '.side-panel'), true);

      await h.page.keyboard.press('Escape');
      await closedTo(h.page);
      assert.equal(here(h.page), '/developer?tab=tools');
      assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing was saved');
    } finally {
      await h.close();
    }
  });

  void test('Escape in Rename closes the form, not the panel; a second Escape closes the panel', async () => {
    const h = await open('/developer?tab=tools', stub([CLAUDE, TWIN_A, TWIN_B]));
    try {
      await openFromRow(h.page, 'a4');
      const body = panel(h.page).locator('.dv3-tool-details[data-agent="a4"]');
      await body.getByRole('button', { name: 'Rename…' }).click();
      const input = body.getByLabel('New name');
      await input.waitFor({ timeout: 10_000 });
      // The form puts focus in its field; Escape is pressed there.
      await until(async () => focusIn(h.page, '.agents-panel'));
      await h.page.keyboard.press('Escape');
      await input.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await panel(h.page).count(), 1, 'Escape in the form closed the panel');
      await until(async () => (await focusLabel(h.page)) === 'Rename…');

      await h.page.keyboard.press('Escape');
      await closedTo(h.page, 'a4');
      assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing was renamed');
    } finally {
      await h.close();
    }
  });

  void test('Escape in a device’s conflict Rename closes the form, not the panel', async () => {
    const h = await open('/developer?tab=devices', stub([CLAUDE, TWIN_A, TWIN_B]));
    try {
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 20_000 });
      await h.page.locator('[data-details="devices:d1"]').click();
      const conflicts = panel(h.page).locator('[data-conflicts]');
      await conflicts.waitFor({ timeout: 10_000 });
      await conflicts
        .getByRole('button', { name: /^Rename Codex · Belka/ })
        .first()
        .click();
      const input = conflicts.getByLabel('New name');
      await input.waitFor({ timeout: 10_000 });
      await until(async () => focusIn(h.page, '.agents-panel'));
      await h.page.keyboard.press('Escape');
      await input.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await panel(h.page).count(), 1, 'Escape in the form closed the panel');
      await until(async () => (await focusLabel(h.page)).startsWith('Rename Codex · Belka'));

      await h.page.keyboard.press('Escape');
      await panel(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      await until(async () => (await focusedDetails(h.page)) === 'devices:d1');
    } finally {
      await h.close();
    }
  });
});

void describe('the details panel: around it (review round 1)', () => {
  void test('an address naming a wizard and a panel shows the wizard; closing it opens the panel', async () => {
    const h = await open('/developer?tab=tools&add=tool&agent=a1', stub());
    try {
      await h.page.locator('[data-wizard="tool"]').waitFor({ timeout: 20_000 });
      // The wizard takes the page; no panel opens over it.
      assert.equal(await panel(h.page).count(), 0);
      await h.page.waitForTimeout(300);
      assert.equal(await panel(h.page).count(), 0);
      // The wizard stands in place of the list (LAI-1081), nothing broken.
      assert.equal(await h.page.locator('.dv3-tool[data-agent="a1"]').count(), 0);
      await h.page.locator('[data-wizard="tool"]').getByRole('button', { name: 'Cancel' }).click();
      await h.page.locator('[data-wizard="tool"]').waitFor({ state: 'detached', timeout: 10_000 });
      // What was left in the address is the panel, and it opens.
      assert.equal(here(h.page), '/developer?tab=tools&agent=a1');
      await panel(h.page).locator('[data-agent="a1"]').waitFor({ timeout: 10_000 });
      assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('Disconnect device: the panel closes, and focus is on the device’s Details while it is listed', async () => {
    let revoked = false;
    const gone = [CLAUDE, CODEX, OMNI].map((a) => ({
      ...a,
      status: 'revoked',
      revoked_at: NOW,
    }));
    const h = await open('/developer?tab=devices', {
      ...stub(),
      // The board, read again after the write, says what it did.
      '/api/v1/devices': () => ({
        data: [revoked ? deviceRow(gone) : deviceRow([CLAUDE, CODEX, OMNI])],
      }),
      '/api/v1/agents/devices/revoke': () => {
        revoked = true;
        return { revoked_agent_ids: ['a1', 'a2', 'a3'] };
      },
    });
    try {
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 20_000 });
      await h.page.locator('[data-details="devices:d1"]').click();
      await panel(h.page).getByRole('button', { name: 'Disconnect device…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect Belka/ }));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect 3 tools' }).click();
      await panel(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=devices');
      // Belka is paired: still listed, with no tools, and focus is on its Details.
      await until(async () => (await focusedDetails(h.page)) === 'devices:d1');
      await until(async () =>
        (await h.page.locator('.dv3-device[data-device="d1"] [data-line]').innerText()).includes(
          'No tools yet',
        ),
      );
    } finally {
      await h.close();
    }
  });

  void test('Disconnect device: when the device leaves the list, focus is on the list’s heading', async () => {
    let revoked = false;
    const imported = {
      ...deviceRow([CLAUDE]),
      origin: 'imported',
      paired_at: null,
      key_fingerprint: null,
    };
    const h = await open('/developer?tab=devices&device=d1', {
      ...stub([CLAUDE]),
      '/api/v1/devices': () => ({
        data: [
          revoked
            ? {
                ...imported,
                active_count: 0,
                revoked_count: 1,
                agents: [{ ...CLAUDE, status: 'revoked', revoked_at: NOW }],
                launcher: NEVER_REPORTED,
              }
            : imported,
        ],
      }),
      '/api/v1/agents/devices/revoke': () => {
        revoked = true;
        return { revoked_agent_ids: ['a1'] };
      },
    });
    try {
      await panel(h.page).locator('[data-device="d1"]').waitFor({ timeout: 20_000 });
      await panel(h.page).getByRole('button', { name: 'Disconnect device…' }).click();
      const dialog = h.page
        .getByRole('alertdialog')
        .or(h.page.getByRole('dialog', { name: /Disconnect Belka/ }));
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Disconnect 1 tool' }).click();
      await panel(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      await h.page
        .locator('.dv3-device[data-device="d1"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      await h.page.waitForFunction(
        () => document.activeElement?.id === 'dv3-devices-title',
        undefined,
        { timeout: 5_000 },
      );
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
        const panelBg = await panel(h.page).evaluate((el) => getComputedStyle(el).backgroundColor);
        const cardBg = await h.page
          .locator('.dv3-roster .dx-card')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.equal(panelBg, cardBg, `${theme}: the panel is not the card colour`);
        colours.push(panelBg);
      } finally {
        await h.close();
      }
    }
    assert.notEqual(colours[0], colours[1], 'light and dark drew the same panel');
  });
});

/** A click where a row's line is: what a person aims at when they click the row, not its name. */
async function clickLine(page: Page, row: string): Promise<void> {
  const box = await page.locator(`${row} [data-line]`).boundingBox();
  assert.ok(box !== null);
  await page.mouse.click(box.x + Math.min(24, box.width / 2), box.y + box.height / 2);
}

void describe('a row opens its details (LAI-1097, the owner’s design: one chip, one action)', () => {
  void test('Tools: anywhere on the row opens it, focus comes back to the row, and there is no Details button', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await h.page.locator('.dv3-tool[data-agent="a2"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: 'Details', exact: true }).count(), 0);
      assert.equal(await h.page.getByText('Details', { exact: true }).count(), 0);
      await clickLine(h.page, '.dv3-tool[data-agent="a2"]');
      await panel(h.page).locator('[data-agent="a2"]').waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=tools&agent=a2');
      await h.page.keyboard.press('Escape');
      await closedTo(h.page, 'a2');
      // The chip and the action keep their own clicks: a tooltip, the wizard.
      const row = h.page.locator('.dv3-tool[data-agent="a2"]');
      await row.locator('[data-readiness] .dv3-hint-anchor').click();
      await until(() => row.locator('[data-readiness] [role="tooltip"]').isVisible());
      assert.equal(await panel(h.page).count(), 0);
      await row.getByRole('button', { name: 'Finish setting up Codex · Belka' }).click();
      await until(() => h.page.url().includes('reconnect=a2'));
      assert.doesNotMatch(h.page.url(), /agent=/);
    } finally {
      await h.close();
    }
  });

  void test('by keyboard: the row is one button named for it; Enter opens, Escape comes back to it', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      await h.page.locator('.dv3-tool[data-agent="a1"]').waitFor({ timeout: 20_000 });
      const open_ = h.page.getByRole('button', { name: 'Details for Claude Code · Belka' });
      assert.equal(await open_.count(), 1);
      assert.equal(await open_.getAttribute('data-details'), 'tools:a1');
      // Its name is the row's own words, so a screen reader hears what it opens.
      assert.equal((await open_.innerText()).trim(), 'Claude Code · Belka');
      await open_.focus();
      await h.page.keyboard.press('Enter');
      await panel(h.page).locator('[data-agent="a1"]').waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await closedTo(h.page, 'a1');
      // The chevron says it opens, and says nothing to a screen reader.
      const chevron = h.page.locator('.dv3-tool[data-agent="a1"] .dv3-row-chevron');
      assert.equal(await chevron.getAttribute('aria-hidden'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('Devices: anywhere on the row opens the device, and focus comes back to it', async () => {
    const h = await open('/developer?tab=devices', stub());
    try {
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: 'Details', exact: true }).count(), 0);
      await clickLine(h.page, '.dv3-device[data-device="d1"]');
      await h.page.getByRole('dialog', { name: 'Belka' }).waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=devices&device=d1');
      await h.page.keyboard.press('Escape');
      await panel(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      await h.page.waitForFunction(
        () => document.activeElement?.getAttribute('data-details') === 'devices:d1',
        undefined,
        { timeout: 5_000 },
      );
      // Add tool → keeps its own click.
      await h.page.getByRole('button', { name: 'Add a tool to Belka' }).click();
      await until(() => h.page.url().includes('add=tool'));
    } finally {
      await h.close();
    }
  });

  void test('Needs setup is the warn tone: never drawn like Connected or Ready', async () => {
    const h = await open('/developer?tab=tools', stub());
    try {
      const chip = (id: string) =>
        h.page.locator(`.dv3-tool[data-agent="${id}"] [data-readiness] .dx-chip`);
      await until(
        async () =>
          (await h.page.locator('.dv3-tool[data-agent="a1"]').getAttribute('data-status')) ===
          'ready',
        15_000,
      );
      await until(
        async () =>
          (await h.page.locator('.dv3-tool[data-agent="a2"]').getAttribute('data-status')) ===
          'needs-setup',
        15_000,
      );
      assert.equal(await chip('a2').innerText(), 'Needs setup');
      assert.equal(await chip('a2').getAttribute('data-tone'), 'warn');
      assert.equal(await chip('a3').innerText(), 'Connected');
      assert.equal(await chip('a3').getAttribute('data-tone'), 'accent');
      assert.equal(await chip('a1').getAttribute('data-tone'), 'ok');
      // Drawn from the warn tokens, so it looks unlike both.
      const colour = (id: string) => chip(id).evaluate((el) => getComputedStyle(el).color);
      const warn = await h.page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--chip-orange)';
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      assert.equal(await colour('a2'), warn);
      assert.notEqual(await colour('a2'), await colour('a3'));
      assert.notEqual(await colour('a2'), await colour('a1'));
    } finally {
      await h.close();
    }
  });
});

/**
 * The owner's Claude Code on two laptops (LAI-321): Ready on Belka, never
 * used on paired Strelka — and Codex on Belka alone. Every agent carries a
 * name its owner typed, which no label shows (D-120).
 */
const TYPED = 'Ada typed this';
const G_CLAUDE = { ...CLAUDE, display_name: `${TYPED} for Belka` };
const G_CODEX = { ...CODEX, display_name: `${TYPED} for Codex` };
const G_STRELKA = {
  ...agentRow('a6', 'claude-code', null),
  device_label: 'Strelka',
  display_name: `${TYPED} for Strelka`,
};
const strelkaRow = (agents: Agent[]) => ({
  ...deviceRow(agents),
  id: 'd2',
  display_name: 'Strelka',
  device_label: 'strelka',
  key_fingerprint: '0c4e2a9f61b7d358',
});
const grouped = () =>
  stub([G_CLAUDE, G_CODEX, G_STRELKA], [deviceRow([G_CLAUDE, G_CODEX]), strelkaRow([G_STRELKA])]);

const claudeGroup = (page: Page) => page.locator('.dv3-tool-group[data-tool-group="claude-code"]');

/** Both lines' statuses are in: Ready from Belka's own verification, Needs setup on Strelka. */
async function groupedReady(page: Page): Promise<void> {
  await claudeGroup(page).waitFor({ timeout: 20_000 });
  for (const [id, key] of [
    ['a1', 'ready'],
    ['a6', 'needs-setup'],
  ] as const) {
    await until(
      async () =>
        (await page.locator(`.dv3-tool[data-agent="${id}"]`).getAttribute('data-status')) === key,
      15_000,
    );
  }
}

/** A chip's description, through its `aria-describedby`. */
async function describedBy(page: Page, anchor: Locator): Promise<string> {
  const id = await anchor.getAttribute('aria-describedby');
  assert.ok(id !== null, 'the chip has no aria-describedby');
  return ((await page.locator(`[id="${id}"]`).textContent()) ?? '').trim();
}

void describe('Tools by tool (LAI-321): one row a tool, a line a device under it', () => {
  void test('two Claude Code agents on two devices: one group, a line each, device by device', async () => {
    const h = await open('/developer?tab=tools', grouped());
    try {
      await groupedReady(h.page);
      // The list's own rows: Claude Code's group, then Codex, one device, one row.
      assert.deepEqual(
        await h.page
          .locator('.dv3-roster .dx-records > li')
          .evaluateAll((rows) =>
            rows.map(
              (row) => row.getAttribute('data-tool-group') ?? row.getAttribute('data-agent'),
            ),
          ),
        ['claude-code', 'a2'],
      );
      const group = claudeGroup(h.page);
      assert.equal(await group.locator('.dv3-tool-group-title').innerText(), 'Claude Code');
      assert.equal(await group.locator('[data-group-line]').innerText(), '2 devices');
      assert.equal(await group.getAttribute('data-devices'), '2');
      const lines = group.locator('.dv3-tool-lines > .dv3-tool-line');
      assert.deepEqual(
        await lines.evaluateAll((els) => els.map((el) => el.getAttribute('data-agent'))),
        ['a1', 'a6'],
      );
      assert.deepEqual(
        await lines
          .locator('.dx-record-title')
          .evaluateAll((els) => els.map((el) => el.textContent)),
        ['Belka', 'Strelka'],
      );
      // Each line is named for the whole label, so a screen reader hears what it opens.
      assert.deepEqual(
        await lines
          .locator('[data-details]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
        ['Details for Claude Code · Belka', 'Details for Claude Code · Strelka'],
      );
      // The list of lines is labelled by its tool.
      assert.equal(
        await group
          .locator('.dv3-tool-lines')
          .evaluate(
            (ul) => document.getElementById(ul.getAttribute('aria-labelledby') ?? '')?.textContent,
          ),
        'Claude Code',
      );
      // A tool on one device is one row, named as before, with no header.
      const codex = h.page.locator('.dv3-tool[data-agent="a2"]');
      assert.equal(await codex.locator('.dx-record-title').innerText(), 'Codex · Belka');
      assert.equal(await codex.evaluate((el) => el.classList.contains('dv3-tool-line')), false);
      assert.equal(await h.page.locator('[data-tool-group="codex"]').count(), 0);
      // Each line keeps its own chips and next step.
      const belka = h.page.locator('.dv3-tool[data-agent="a1"]');
      assert.equal(await belka.locator('[data-readiness] .dx-chip').innerText(), 'Ready');
      assert.equal(await belka.locator('[data-auto-pickup]').count(), 1);
      assert.equal(
        await belka
          .getByRole('link', { name: 'Set up a project for Claude Code · Belka' })
          .getAttribute('href'),
        '/developer?tab=projects&tool=a1',
      );
      const strelka = h.page.locator('.dv3-tool[data-agent="a6"]');
      assert.equal(await strelka.locator('[data-readiness] .dx-chip').innerText(), 'Needs setup');
      assert.equal(
        await strelka
          .getByRole('button', { name: 'Finish setting up Claude Code · Strelka' })
          .count(),
        1,
      );
      // The add-tool entry point is still the tab's.
      assert.equal(await h.page.getByRole('button', { name: '+ Add tool' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('the header carries the worst of its lines: Needs setup on Strelka beside Ready on Belka', async () => {
    const h = await open('/developer?tab=tools', grouped());
    try {
      await groupedReady(h.page);
      const group = claudeGroup(h.page);
      assert.equal(await group.getAttribute('data-status'), 'needs-setup');
      const head = group.locator('.dv3-tool-group-head [data-group-status]');
      assert.equal(await head.getAttribute('data-group-status'), 'needs-setup');
      assert.equal(await head.locator('.dx-chip').innerText(), 'Needs setup');
      assert.equal(await head.locator('.dx-chip').getAttribute('data-tone'), 'warn');
      assert.match(
        await describedBy(h.page, head.locator('.dv3-hint-anchor')),
        /^Needs setup: Claude Code on Strelka\. The worst of its lines/,
      );
      // One status chip in the header, and it is not either line's.
      assert.equal(await group.locator('.dv3-tool-group-head .dx-chip').count(), 1);
      assert.equal(await group.locator('.dv3-tool-group-head [data-readiness]').count(), 0);
    } finally {
      await h.close();
    }

    // Once Strelka's Claude Code is in use, the worst is what is left.
    const seen = { ...G_STRELKA, last_seen_at: NOW - 60_000 };
    const r = await open(
      '/developer?tab=tools',
      stub([G_CLAUDE, G_CODEX, seen], [deviceRow([G_CLAUDE, G_CODEX]), strelkaRow([seen])]),
    );
    try {
      await claudeGroup(r.page).waitFor({ timeout: 20_000 });
      await until(
        async () =>
          (await r.page.locator('.dv3-tool[data-agent="a6"]').getAttribute('data-status')) ===
          'connected',
        15_000,
      );
      assert.equal(
        await claudeGroup(r.page).locator('[data-group-status]').getAttribute('data-group-status'),
        'connected',
      );
    } finally {
      await r.close();
    }
  });

  void test('a device line opens its own agent’s details; the header opens nothing', async () => {
    const h = await open('/developer?tab=tools', grouped());
    try {
      await groupedReady(h.page);
      // The header is a summary: no button opens it, and a click on it does nothing.
      const head = claudeGroup(h.page).locator('.dv3-tool-group-head');
      assert.equal(await head.locator('[data-details]').count(), 0);
      await head.locator('.dv3-tool-group-title').click();
      await h.page.waitForTimeout(300);
      assert.equal(await panel(h.page).count(), 0);
      assert.equal(here(h.page), '/developer?tab=tools');

      await clickLine(h.page, '.dv3-tool[data-agent="a6"]');
      await h.page
        .getByRole('dialog', { name: 'Claude Code · Strelka' })
        .waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=tools&agent=a6');
      await panel(h.page).locator('.dv3-tool-details[data-agent="a6"]').waitFor();
      await h.page.keyboard.press('Escape');
      await closedTo(h.page, 'a6');

      // The other line is its own agent.
      await clickLine(h.page, '.dv3-tool[data-agent="a1"]');
      await h.page
        .getByRole('dialog', { name: 'Claude Code · Belka' })
        .waitFor({ timeout: 10_000 });
      assert.equal(here(h.page), '/developer?tab=tools&agent=a1');
    } finally {
      await h.close();
    }
  });

  void test('no name its owner typed is shown — on the list, in a description or in a line’s details (D-120)', async () => {
    const h = await open('/developer?tab=tools', grouped());
    try {
      await groupedReady(h.page);
      const roster = h.page.locator('.dv3-roster');
      // textContent: the tooltips' descriptions too, not only what is on screen.
      assert.doesNotMatch((await roster.textContent()) ?? '', new RegExp(TYPED));
      const named = await roster
        .locator('[aria-label], [title]')
        .evaluateAll((els) =>
          els.map(
            (el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`,
          ),
        );
      assert.ok(named.length > 0);
      assert.equal(named.filter((n) => n.includes(TYPED)).length, 0, named.join(' | '));
      // The products and devices are what it says instead.
      assert.match((await roster.textContent()) ?? '', /Claude Code[\s\S]*Belka[\s\S]*Strelka/);

      await clickLine(h.page, '.dv3-tool[data-agent="a6"]');
      const details = panel(h.page).locator('.dv3-tool-details[data-agent="a6"]');
      await details.waitFor({ timeout: 10_000 });
      assert.doesNotMatch((await panel(h.page).textContent()) ?? '', new RegExp(TYPED));
    } finally {
      await h.close();
    }
  });

  void test('390 px, both themes: the lines under their tool, with no sideways scroll', async () => {
    const rails: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      const h = await open('/developer?tab=tools', grouped(), {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
        },
      });
      try {
        await setTheme(h.page, theme);
        await groupedReady(h.page);
        const wide = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(wide <= 0, `${theme}: the page scrolls sideways by ${String(wide)}px`);
        const head = await claudeGroup(h.page).locator('.dv3-tool-group-title').boundingBox();
        for (const id of ['a1', 'a6']) {
          const line = await h.page.locator(`.dv3-tool[data-agent="${id}"]`).boundingBox();
          assert.ok(line !== null && head !== null);
          assert.ok(line.x + line.width <= 390, `${theme}: ${id} runs off screen`);
          // Under its tool, set in from the header's edge.
          assert.ok(line.y > head.y, `${theme}: ${id} is not under its header`);
        }
        rails.push(
          await claudeGroup(h.page)
            .locator('.dv3-tool-lines')
            .evaluate((el) => getComputedStyle(el).borderLeftColor),
        );
      } finally {
        await h.close();
      }
    }
    // The rule the lines hang from is the theme's own colour.
    assert.notEqual(rails[0], rails[1], 'light and dark drew the same rule');
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
          // LAI-321: Claude Code on two devices, one row with a line a device.
          name: 'tools-grouped',
          path: '/developer?tab=tools',
          api: grouped(),
          ready: groupedReady,
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
        {
          // The same panel scrolled to its helper, every disclosure open.
          name: 'tool-details-helper',
          path: '/developer?tab=tools&agent=a3',
          api: stub(),
          ready: async (page) => {
            const helper = page.locator('.side-panel .dv3-update[data-update="required"]');
            await helper.waitFor({ timeout: 20_000 });
            for (const summary of await helper.locator('summary').all()) await summary.click();
            await helper.evaluate((el) => {
              el.scrollIntoView({ block: 'start' });
            });
          },
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
