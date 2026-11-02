/**
 * Developer access V3 → Devices: each tool's helper update status (LAI-1065,
 * plan LAI-1042 §H), in a real browser against a stubbed API.
 *
 * - Every status, from the board's compatibility answer and each tool's own
 *   report: Up to date, Update available, Update required for a feature,
 *   Version unknown, Could not check with Retry.
 * - Separate from the connection status on the same row; summarised on the
 *   device card.
 * - *Copy update command* names this board and no secret; `--allow-http` only
 *   on a plain-http board, with why. *What's new* from the release notes.
 * - After a copy the row polls, and changes when a new report arrives,
 *   announced in the tab's live region.
 * - The board note only for an owner or admin, only when a helper is ahead.
 * - Presence off: no report time. 390 px: no sideways scroll. Classic: none of it.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save a screenshot of each status, light
 * and dark, at 1440 and 390 px.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type OpenOptions,
} from './harness.ts';

type Mode = 'classic' | 'preview' | 'v3';

const NOW = Date.now();
const BOARD = 'cea011d6b1a2c3d4e5f60718293a4b5c6d7e8f90';
const OLDER = '19f85875aa00bb11cc22dd33ee44ff5566778899';
const SECRET = 'lai_s3cr3tS3CR3Ts3cr3t';

const me = (orgRole: string) => ({
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: orgRole,
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
});

/** Project setup is switched on and needs protocol 3; the board speaks 3. */
const compat = (mode: Mode) => ({
  server: { version: '0.1.0', build_commit: BOARD },
  protocol: { current: 3, min_client: 1 },
  features: {
    developer_access: mode,
    device_pairing: false,
    tool_setup_exchange: false,
    client_reports: true,
    project_setups: true,
  },
  cli: {
    min_protocol_for: {
      device_pairing: 2,
      tool_setup_exchange: 2,
      client_reports: 2,
      project_setups: 3,
    },
    source: {
      type: 'git',
      url: 'https://github.com/PawanSirsat/Laika.git',
      commit: BOARD,
      path: 'cli',
    },
  },
  release_notes: {
    ref: BOARD,
    whats_new: [
      { protocol: 1, summary: 'laika agent login, session hooks, laika connect and checkpoints.' },
      { protocol: 3, summary: 'Project setup from the board.' },
    ],
  },
});

const token = (agentId: string) => ({
  id: `t-${agentId}`,
  name: `t-${agentId}`,
  prefix: `lai_${agentId}xx`,
  scope: 'full',
  project_ids: null,
  last_used_at: NOW - 60_000,
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

const agentRow = (id: string, harness: string) => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: id,
  harness,
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [token(id)],
  created_at: 1,
  revoked_at: null,
  last_seen_at: NOW - 60_000,
});

type Agent = ReturnType<typeof agentRow>;

/** One tool per status (the harness only tells the rows apart). */
const UP = agentRow('a1', 'claude-code');
const AVAILABLE = agentRow('a2', 'codex');
const REQUIRED = agentRow('a3', 'omnigent');
const UNKNOWN = agentRow('a4', 'cursor');
const UNCHECKED = agentRow('a5', 'gemini-cli');
const ALL = [UP, AVAILABLE, REQUIRED, UNKNOWN, UNCHECKED];

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
  key_fingerprint: null,
  last_seen_at: NOW - 60_000,
  active_count: agents.length,
  revoked_count: 0,
  agents,
  created_at: 1,
  revoked_at: null,
});

const report = (over: object = {}) => ({
  cli_version: '0.1.0',
  cli_commit: BOARD,
  protocol: 3,
  capabilities: ['client_report', 'doctor', 'update'],
  harness_version: null,
  harness: null,
  reported_at: NOW - 5 * 60_000,
  self_reported: true,
  ...over,
});

const verification = (agentId: string, clientReport: object | null) => ({
  agent_id: agentId,
  client_report: clientReport,
});

const NO_CONSENT = { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null };

interface StubOver {
  readonly mode?: Mode;
  readonly orgRole?: string;
  readonly agents?: Agent[];
  readonly reports?: Readonly<Record<string, unknown>>;
  readonly routes?: ApiStub;
}

const DEFAULT_REPORTS: Readonly<Record<string, unknown>> = {
  a1: verification('a1', report()),
  a2: verification('a2', report({ cli_commit: OLDER })),
  a3: verification('a3', report({ cli_commit: OLDER, protocol: 2 })),
  a4: verification('a4', null),
  a5: refuse(500, 'internal', 'later'),
};

function stub(over: StubOver = {}): ApiStub {
  const agents = over.agents ?? ALL;
  const reports = { ...DEFAULT_REPORTS, ...over.reports };
  const perAgent: Record<string, unknown> = {};
  for (const a of agents) {
    perAgent[`/api/v1/agents/${a.id}/checkpoint-consent`] = NO_CONSENT;
    perAgent[`/api/v1/agents/${a.id}`] = { ...a, sessions: [] };
    perAgent[`/api/v1/agents/${a.id}/verification`] = reports[a.id];
  }
  return {
    '/api/v1/me': me(over.orgRole ?? 'member'),
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: agents, next_cursor: null },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/devices': { data: [deviceRow(agents)] },
    '/api/v1/developer/compatibility': compat(over.mode ?? 'v3'),
    ...perAgent,
    ...over.routes,
  };
}

after(async () => {
  await closeBrowser();
});

const tool = (page: Page, id: string) => page.locator(`.dv3-tool[data-agent="${id}"]`);
const update = (page: Page, id: string) => tool(page, id).locator('.dv3-update');
const live = (page: Page) => page.locator('.dev-body > [role="status"][aria-live="polite"]');

async function settled(page: Page, ids: readonly string[] = ALL.map((a) => a.id)): Promise<void> {
  await page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 20_000 });
  for (const id of ids) {
    await until(async () => {
      const key = await update(page, id).getAttribute('data-update');
      return key !== null && key !== 'checking';
    }, 15_000);
  }
}

/** Clipboard reads and writes allowed, so a copy succeeds and *watching* starts. */
const withClipboard =
  (more?: (page: Page) => Promise<void>): ((page: Page) => Promise<void>) =>
  async (page) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    if (more !== undefined) await more(page);
  };

async function openTab(over: StubOver = {}, options: OpenOptions = {}): Promise<Harness> {
  return open(`/developer?tab=devices`, stub(over), options);
}

void describe('V3 Devices: each tool’s helper update status', () => {
  void test('every status in words with its reason, beside the connection status', async () => {
    const h = await openTab();
    try {
      await settled(h.page);
      const expect: [string, string, RegExp][] = [
        ['a1', 'up-to-date', /Up to date[\s\S]*Runs the helper this board offers, cea011d/],
        ['a2', 'available', /Update available[\s\S]*offers helper cea011d; this one runs 19f8587/],
        [
          'a3',
          'required',
          /Update required for project setup[\s\S]*needs helper protocol 3; this one speaks 2/,
        ],
        ['a4', 'unknown', /Version unknown[\s\S]*has not reported a version/],
        ['a5', 'unchecked', /Could not check[\s\S]*version report could not be read/],
      ];
      for (const [id, key, words] of expect) {
        assert.equal(await update(h.page, id).getAttribute('data-update'), key, id);
        assert.match(await update(h.page, id).locator('.status-chip').innerText(), words, id);
        // The connection status is its own chip on the same row, unchanged.
        assert.equal(await tool(h.page, id).getAttribute('data-status'), 'connected', id);
      }
      // Never "outdated", and Version unknown only where there is no report.
      assert.doesNotMatch(await h.page.locator('.dv3-devices').innerText(), /outdated/i);
      // Nothing was asked of GitHub: only this board's answers.
      assert.ok(h.calls.every((c) => c.path.startsWith('/api/v1/')));
    } finally {
      await h.close();
    }
  });

  void test('the device card summarises its tools, worst first', async () => {
    const h = await openTab();
    try {
      await settled(h.page);
      const line = h.page.locator('.dv3-device[data-device="d1"] [data-device-update]');
      assert.equal(await line.getAttribute('data-device-update'), 'required');
      assert.equal(
        await line.innerText(),
        'Helper updates: 1 update required, 1 update available, 1 could not check, 1 version unknown, 1 up to date',
      );
    } finally {
      await h.close();
    }
  });

  void test('only a tool with something to update to offers the command', async () => {
    const h = await openTab();
    try {
      await settled(h.page);
      for (const id of ['a2', 'a3']) {
        assert.equal(await tool(h.page, id).locator('[data-update-how]').count(), 1, id);
      }
      for (const id of ['a1', 'a4', 'a5']) {
        assert.equal(await tool(h.page, id).locator('[data-update-how]').count(), 0, id);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: Could not check, and Retry', () => {
  void test('a failed compatibility answer is Could not check on every row; Retry asks again', async () => {
    let asks = 0;
    const h = await openTab({
      routes: {
        '/api/v1/developer/compatibility': () => {
          asks += 1;
          // The first answer is the mode switch (read once a page); the second fails.
          return asks === 2 ? refuse(500, 'internal', 'later') : compat('v3');
        },
      },
    });
    try {
      await settled(h.page);
      assert.equal(await update(h.page, 'a1').getAttribute('data-update'), 'unchecked');
      assert.match(
        await update(h.page, 'a1').innerText(),
        /Could not check[\s\S]*board’s update information/,
      );
      // Retry is a real button, reached and pressed from the keyboard.
      const retry = update(h.page, 'a1').getByRole('button', {
        name: 'Retry the update check for Claude Code · Belka',
      });
      await retry.focus();
      await h.page.keyboard.press('Enter');
      await until(
        async () => (await update(h.page, 'a1').getAttribute('data-update')) === 'up-to-date',
      );
      assert.equal(asks, 3);
    } finally {
      await h.close();
    }
  });

  void test('a failed report is Could not check for that row alone; Retry reads it again', async () => {
    let asks = 0;
    const h = await openTab({
      reports: {
        a5: () => {
          asks += 1;
          return asks === 1 ? refuse(500, 'internal', 'later') : verification('a5', report());
        },
      },
    });
    try {
      await settled(h.page);
      assert.equal(await update(h.page, 'a5').getAttribute('data-update'), 'unchecked');
      assert.equal(await update(h.page, 'a1').getAttribute('data-update'), 'up-to-date');
      await update(h.page, 'a5').getByRole('button', { name: /Retry/ }).click();
      await until(
        async () => (await update(h.page, 'a5').getAttribute('data-update')) === 'up-to-date',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: the update command, What’s new, and after', () => {
  void test('check first, then update, against this board — no secret, no --allow-http on loopback', async () => {
    const h = await openTab();
    try {
      await settled(h.page);
      const how = tool(h.page, 'a2').locator('[data-update-how]');
      await how.locator('summary').focus();
      await h.page.keyboard.press('Enter');
      const text = await how.locator('pre').innerText();
      assert.equal(
        text,
        `laika update --check --board ${h.origin}\nlaika update --board ${h.origin}`,
      );
      assert.doesNotMatch(text, /lai_|token|secret/i);
      assert.equal(await how.locator('[data-allow-http]').count(), 0);
      assert.match(await how.locator('[data-after-update]').innerText(), /laika doctor/);
      // No secret anywhere on the tab, either.
      assert.doesNotMatch(await h.page.locator('body').innerText(), new RegExp(SECRET));
    } finally {
      await h.close();
    }
  });

  void test('a plain-http board adds --allow-http to the update and says why', async () => {
    const h = await openTab({}, { insecure: true });
    try {
      await settled(h.page);
      const how = tool(h.page, 'a3').locator('[data-update-how]');
      await how.locator('summary').click();
      const text = await how.locator('pre').innerText();
      assert.match(text, /^laika update --check --board http:\/\/laika\.test:\d+\n/);
      assert.match(text, /\nlaika update --board http:\/\/laika\.test:\d+ --allow-http$/);
      assert.match(
        await how.locator('[data-allow-http]').innerText(),
        /plain http[\s\S]*refuses to act on it unless you add --allow-http/,
      );
    } finally {
      await h.close();
    }
  });

  void test('What’s new lists the board’s notes and marks what is new for this tool', async () => {
    const h = await openTab();
    try {
      await settled(h.page);
      const notes = tool(h.page, 'a3').locator('[data-whats-new]');
      await notes.locator('summary').click();
      const lines = notes.locator('li');
      assert.equal(await lines.count(), 2);
      assert.match(
        await lines.nth(1).innerText(),
        /Protocol 3[\s\S]*New for this tool[\s\S]*Project setup/,
      );
      assert.doesNotMatch(await lines.nth(0).innerText(), /New for this tool/);
    } finally {
      await h.close();
    }
  });

  void test('after a copy the row watches, and changes when a new report arrives', async () => {
    let updated = false;
    const h = await openTab(
      {
        reports: {
          a2: () =>
            verification(
              'a2',
              updated ? report({ reported_at: NOW }) : report({ cli_commit: OLDER }),
            ),
        },
      },
      { before: withClipboard(async (page) => page.clock.install()) },
    );
    try {
      await settled(h.page);
      const how = tool(h.page, 'a2').locator('[data-update-how]');
      await how.locator('summary').click();
      await how.locator('.copy-button').click();
      await how.locator('[data-watching]').waitFor();
      updated = true;
      await h.page.clock.fastForward(16_000);
      await until(
        async () => (await update(h.page, 'a2').getAttribute('data-update')) === 'up-to-date',
      );
      await until(async () => (await live(h.page).innerText()).includes('Up to date'));
      assert.match(await live(h.page).innerText(), /Codex · Belka: Up to date\./);
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: the board, and presence', () => {
  const ahead = { a1: verification('a1', report({ cli_commit: OLDER, protocol: 4 })) };

  void test('an owner sees the board note when a helper is ahead of the board', async () => {
    const h = await openTab({ orgRole: 'owner', reports: ahead });
    try {
      await settled(h.page);
      assert.match(
        await h.page.locator('[data-board-update]').innerText(),
        /updated by whoever runs this instance; your devices update themselves with laika update/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a member never sees it, and an owner does not when nothing shows the board behind', async () => {
    for (const [role, reports] of [
      ['member', ahead],
      ['owner', {}],
    ] as const) {
      const h = await openTab({ orgRole: role, reports });
      try {
        await settled(h.page);
        assert.equal(await h.page.locator('[data-board-update]').count(), 0, role);
      } finally {
        await h.close();
      }
    }
  });

  void test('presence off: the report is shown with no time', async () => {
    const h = await openTab({
      reports: { a1: verification('a1', report({ reported_at: null })) },
    });
    try {
      await settled(h.page);
      assert.match(await tool(h.page, 'a1').locator('[data-report]').innerText(), /laika 0\.1\.0/);
      assert.equal(await tool(h.page, 'a1').locator('[data-reported-at]').count(), 0);
      // With presence on, the same row says when.
      assert.equal(await tool(h.page, 'a2').locator('[data-reported-at]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('V3 Devices: layout, themes, and classic', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: 390 px has no sideways scroll, with every panel open`, async () => {
      const h = await openTab({}, { insecure: true });
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        await settled(h.page);
        for (const summary of await h.page.locator('.dv3-update summary').all()) {
          await summary.click();
        }
        const wide = await h.page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        assert.equal(wide, false, 'the page scrolls sideways at 390 px');
      } finally {
        await h.close();
      }
    });
  }

  void test('classic shows no update status and asks for no report', async () => {
    const h = await open('/developer?tab=agents', stub({ mode: 'classic' }));
    try {
      await h.page.locator('.dev-body').first().waitFor({ timeout: 20_000 });
      await h.page.waitForLoadState('networkidle');
      assert.equal(await h.page.locator('.dv3-update').count(), 0);
      assert.equal(h.calls.filter((c) => c.path.endsWith('/verification')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('preview shows it on the V3 Devices tab', async () => {
    const h = await open('/developer?tab=devices', stub({ mode: 'preview' }));
    try {
      await settled(h.page);
      assert.equal(await update(h.page, 'a3').getAttribute('data-update'), 'required');
    } finally {
      await h.close();
    }
  });
});

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

void describe(
  'evidence: each status, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      const names: Record<string, string> = {
        a1: 'up-to-date',
        a2: 'update-available',
        a3: 'update-required',
        a4: 'version-unknown',
        a5: 'could-not-check',
      };
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          const h = await openTab(
            { orgRole: 'owner', reports: { ...DEFAULT_REPORTS } },
            { insecure: true },
          );
          try {
            await h.page.setViewportSize({ width, height: 900 });
            await setTheme(h.page, theme);
            await settled(h.page);
            for (const id of ['a2', 'a3']) {
              await tool(h.page, id).locator('[data-update-how] summary').click();
              await tool(h.page, id).locator('[data-whats-new] summary').click();
            }
            await h.page.screenshot({
              path: join(dir, `devices-${theme}-${String(width)}.png`),
              fullPage: true,
            });
            for (const [id, name] of Object.entries(names)) {
              await tool(h.page, id).screenshot({
                path: join(dir, `${name}-${theme}-${String(width)}.png`),
              });
            }
          } finally {
            await h.close();
          }
        }
      }
    });
  },
);
