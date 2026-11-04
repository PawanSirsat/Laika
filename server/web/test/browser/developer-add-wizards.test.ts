/**
 * Developer access V3 → Add device and Add tool (LAI-1061, plan LAI-1042
 * §E.1–E.3, §F.6, §H), in a real browser against a stubbed API.
 *
 * - **Paired only once the board says `completed`**: approving moves to a
 *   wait, never to *Paired*.
 * - Approve and deny echo the fingerprint that was on screen.
 * - The commands carry no secret and no `npx`; the pairing code is in no
 *   address and no storage, and no `lai_` reaches the page.
 * - A tool is *Ready* only on its own request and a session where it has
 *   hooks; another tool's request ticks nothing.
 * - A duplicate pair routes to that tool's details, where it is renamed; a
 *   paired device's Reconnect is an exchange, not a secret in the browser;
 *   classic mode is untouched.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { NEVER_REPORTED } from '../helpers/launcher.ts';
import { offered } from './dropdown.ts';
import { featuredTools, moreTools } from '../../src/routes/screens/developer/v3/tool-catalog.ts';

type Mode = 'classic' | 'preview' | 'v3';

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

const COMMIT = 'cea011d6abc1234';
const CODE = 'K7W4-X2P8-M3QR-T9VA';
const FINGERPRINT = '7f3a91c20b5e44d1';
const SECRET = 'lai_SECRETSECRETSECRET';

const compat = (mode: Mode) => ({
  server: { version: '0.1.0', build_commit: COMMIT },
  protocol: { current: 1, min_client: 1 },
  features: {
    developer_access: mode,
    device_pairing: false,
    tool_setup_exchange: false,
    client_reports: false,
    project_setups: false,
  },
  cli: {
    min_protocol_for: {},
    source: {
      type: 'git',
      url: 'https://github.com/PawanSirsat/Laika.git',
      commit: COMMIT,
      path: 'cli',
    },
  },
  release_notes: { ref: COMMIT, whats_new: [] },
});

const NOW = Date.now();

const token = (id: string, agentId: string) => ({
  id,
  name: id,
  prefix: 'lai_ab12',
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
  device = 'Belka',
  tokens = [token(`t-${id}`, id)],
) => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: id,
  harness,
  device_label: device,
  status: 'active',
  grants: [],
  tokens,
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  launcher: NEVER_REPORTED,
});

type Agent = ReturnType<typeof agentRow>;

const deviceRow = (id: string, name: string, paired: boolean, agents: Agent[] = []) => ({
  id,
  display_name: name,
  device_label: name.toLowerCase(),
  kind: 'local',
  origin: paired ? 'paired' : 'imported',
  status: 'active',
  confirmed: true,
  confirmed_at: 1,
  paired_at: paired ? 1 : null,
  key_fingerprint: paired ? FINGERPRINT : null,
  last_seen_at: null,
  active_count: agents.length,
  revoked_count: 0,
  agents,
  launcher: NEVER_REPORTED,
  created_at: 1,
  revoked_at: null,
});

type Device = ReturnType<typeof deviceRow>;

const NO_CONSENT = { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null };

function stub(mode: Mode, devices: readonly Device[], over: ApiStub = {}): ApiStub {
  const perAgent: Record<string, unknown> = {};
  for (const a of devices.flatMap((d) => d.agents)) {
    perAgent[`/api/v1/agents/${a.id}/checkpoint-consent`] = NO_CONSENT;
    perAgent[`/api/v1/agents/${a.id}`] = { ...a, sessions: [] };
  }
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: devices.flatMap((d) => d.agents), next_cursor: null },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/devices': { data: devices },
    '/api/v1/developer/compatibility': compat(mode),
    ...perAgent,
    ...over,
  };
}

const pairingView = (state: string, claimed: boolean, deviceId: string | null = null) => ({
  id: 'p1',
  state,
  kind: 'local',
  display_name: 'Belka',
  device_id: deviceId,
  claimed: claimed
    ? { key_fingerprint: FINGERPRINT, os: 'darwin 25.0', cli_version: '0.2.0', claimed_at: NOW }
    : null,
  created_at: NOW,
  expires_at: NOW + 10 * 60_000,
  decided_at: null,
  completed_at: state === 'completed' ? NOW : null,
});

after(async () => {
  await closeBrowser();
});

const wizard = (page: Page, which: 'device' | 'tool') => page.locator(`[data-wizard="${which}"]`);
const step = async (page: Page, which: 'device' | 'tool') =>
  wizard(page, which).getAttribute('data-step');
const writes = (calls: readonly StubCall[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

/** Nothing secret anywhere the page keeps or shows: no token, no code in the address or storage. */
async function assertNothingKept(page: Page, code?: string): Promise<void> {
  const kept = await page.evaluate(() => {
    const all: string[] = [location.href];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i) ?? '';
        all.push(key, store.getItem(key) ?? '');
      }
    }
    return all.join('\n');
  });
  assert.doesNotMatch(kept, /lai_/);
  if (code !== undefined)
    assert.ok(!kept.includes(code), 'the pairing code is in the address or storage');
  assert.doesNotMatch(await page.locator('[data-wizard]').innerText(), /lai_[A-Za-z0-9]{8,}/);
}

void describe('Add device: paired only when the board says so', () => {
  void test('bootstrap, wait, fingerprint, approve with the echo, and Paired only on completed', async () => {
    let state: 'open' | 'claimed' | 'approved' | 'completed' = 'claimed';
    const h = await open(
      '/developer?tab=devices&add=device',
      stub('v3', [], {
        '/api/v1/devices/pairing-requests': (call: StubCall) =>
          call.method === 'POST'
            ? reply(201, {
                pairing: pairingView('open', false),
                user_code: CODE,
                command: `laika device pair --board http://board.test --code ${CODE}`,
              })
            : refuse(405, 'method_not_allowed', 'no'),
        '/api/v1/devices/pairing-requests/p1': () =>
          pairingView(state, state !== 'open', state === 'completed' ? 'd9' : null),
        '/api/v1/devices/pairing-requests/p1/approve': () => {
          state = 'approved';
          return pairingView('approved', true);
        },
      }),
    );
    try {
      const page = h.page;
      await wizard(page, 'device').waitFor({ timeout: 20_000 });
      // Focus is on the step's title, and no coding tool is asked here.
      await until(
        async () => (await page.evaluate(() => document.activeElement?.tagName)) === 'H2',
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        'Name your device',
      );
      // The owner's design's frame (LAI-1081): three rail steps, the eyebrow names the kind.
      assert.deepEqual(
        await wizard(page, 'device')
          .getByRole('navigation', { name: 'Pairing steps' })
          .locator('.conn-rail-name')
          .allTextContents(),
        ['Step 1: Name your device', 'Step 2: Pair the device', 'Step 3: Approve & finish'],
      );
      assert.equal(
        // The text, not innerText: the eyebrow is drawn in capitals.
        await wizard(page, 'device').locator('.conn-eyebrow').textContent(),
        'Step 1 of 3 · Device',
      );
      assert.doesNotMatch(await wizard(page, 'device').innerText(), /Claude Code|Codex/);

      // Keyboard only: type the name, Enter asks for a code.
      await page.getByLabel('Device name').fill('Belka');
      await page.getByLabel('Device name').press('Enter');
      await until(async () => (await step(page, 'device')) === '2');
      const sent = h.calls.find(
        (c) => c.method === 'POST' && c.path === '/api/v1/devices/pairing-requests',
      );
      assert.deepEqual(sent?.body, { kind: 'local', display_name: 'Belka' });

      const block = await wizard(page, 'device').locator('pre').innerText();
      assert.deepEqual(block.split('\n'), [
        'git clone https://github.com/PawanSirsat/Laika.git ~/laika &&',
        `git -C ~/laika checkout --detach ${COMMIT} &&`,
        '~/laika/plugin/scripts/install.sh --no-credential &&',
        `~/laika/cli/bin/laika device pair --board http://board.test --code ${CODE}`,
      ]);
      assert.doesNotMatch(block, /\bnpx\b/);
      assert.match(page.url(), /[?&]pairing=p1(&|$)/);
      await assertNothingKept(page, CODE);

      // The device claims: its key, to compare.
      await until(async () => (await step(page, 'device')) === '3', 15_000);
      const fp = wizard(page, 'device').locator('[data-fingerprint]');
      assert.equal((await fp.innerText()).replace(/\s/g, ''), FINGERPRINT);
      assert.match(
        await wizard(page, 'device').innerText(),
        /Approve only if this matches your terminal/,
      );
      assert.match(await wizard(page, 'device').innerText(), /darwin 25\.0/);
      assert.match(await wizard(page, 'device').innerText(), /0\.2\.0/);
      assert.match(
        await wizard(page, 'device').innerText(),
        /said the code was already used[\s\S]*deny/,
      );

      await page.getByRole('button', { name: 'Approve Belka' }).click();
      const approve = h.calls.find((c) => c.path === '/api/v1/devices/pairing-requests/p1/approve');
      await until(() => approve !== undefined || h.calls.some((c) => c.path.endsWith('/approve')));
      assert.deepEqual(
        h.calls.find((c) => c.path.endsWith('/approve'))?.body,
        { key_fingerprint: FINGERPRINT },
        'the fingerprint shown is the one echoed',
      );
      // Approved is a wait, not Paired — and stays one through a poll.
      const polls = h.calls.filter((c) => c.path === '/api/v1/devices/pairing-requests/p1').length;
      await until(
        () =>
          h.calls.filter((c) => c.path === '/api/v1/devices/pairing-requests/p1').length > polls,
        15_000,
      );
      assert.equal(await step(page, 'device'), '3');
      assert.doesNotMatch(await wizard(page, 'device').innerText(), /is paired with this board/);
      assert.match(await wizard(page, 'device').innerText(), /Waiting for Belka to finish/);

      // The device completes; now, and only now, Paired.
      state = 'completed';
      await until(async () => (await step(page, 'device')) === '4', 20_000);
      assert.match(await wizard(page, 'device').innerText(), /Belka is paired with this board/);
      assert.ok(await page.getByRole('button', { name: /Add a tool to Belka/ }).isVisible());
      await page.getByRole('button', { name: /Add a tool to Belka/ }).click();
      await until(() => page.url().includes('add=tool'));
      assert.match(page.url(), /device=d9/);
      assert.doesNotMatch(page.url(), /pairing=/);
    } finally {
      await h.close();
    }
  });

  void test('deny echoes the fingerprint, and a changed key is refused with what to do', async () => {
    let denied = false;
    const h = await open(
      '/developer?tab=devices&add=device&pairing=p1',
      stub('v3', [], {
        '/api/v1/devices/pairing-requests/p1': () =>
          pairingView(denied ? 'denied' : 'claimed', true),
        '/api/v1/devices/pairing-requests/p1/approve': refuse(409, 'conflict', 'changed'),
        '/api/v1/devices/pairing-requests/p1/deny': () => {
          denied = true;
          return pairingView('denied', true);
        },
      }),
    );
    try {
      const page = h.page;
      await until(async () => (await step(page, 'device')) === '3', 20_000);
      await page.getByRole('button', { name: 'Deny' }).click();
      await until(async () =>
        (await wizard(page, 'device').innerText()).includes('Nothing was paired'),
      );
      assert.deepEqual(h.calls.find((c) => c.path.endsWith('/deny'))?.body, {
        key_fingerprint: FINGERPRINT,
      });
      assert.ok(await page.getByRole('button', { name: 'Start again' }).isVisible());
      assert.equal(writes(h.calls).filter((w) => w.endsWith('/approve')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a resumed request says the code is not shown again; expiry offers a new one', async () => {
    let expired = false;
    const h = await open(
      '/developer?tab=devices&add=device&pairing=p1',
      stub('v3', [], {
        '/api/v1/devices/pairing-requests/p1': () =>
          pairingView(expired ? 'expired' : 'open', false),
      }),
    );
    try {
      const page = h.page;
      await until(async () => (await step(page, 'device')) === '2', 20_000);
      assert.match(await wizard(page, 'device').innerText(), /shown once/);
      assert.equal(await wizard(page, 'device').locator('pre').count(), 0);
      expired = true;
      await until(
        async () => (await wizard(page, 'device').innerText()).includes('This code expired'),
        15_000,
      );
      assert.ok(await page.getByRole('button', { name: 'Start again' }).isVisible());
    } finally {
      await h.close();
    }
  });

  void test('public_url_unset, 429 and a taken name each say what to do', async () => {
    let answer = 0;
    const answers = [
      reply(409, {
        error: { code: 'conflict', message: 'x', details: { reason: 'public_url_unset' } },
      }),
      refuse(429, 'rate_limited', 'slow down'),
      reply(409, {
        error: { code: 'conflict', message: 'x', details: { reason: 'device_name_taken' } },
      }),
    ];
    const h = await open(
      '/developer?tab=devices&add=device',
      stub('v3', [], {
        '/api/v1/devices/pairing-requests': () => answers[answer++],
      }),
    );
    try {
      const page = h.page;
      await wizard(page, 'device').waitFor({ timeout: 20_000 });
      await page.getByLabel('Device name').fill('Belka');
      const alert = wizard(page, 'device').locator('[role="alert"]');
      const go = page.getByRole('button', { name: /Get a pairing code/ });
      await go.click();
      await until(async () =>
        (await alert.innerText().catch(() => '')).includes('LAIKA_PUBLIC_URL'),
      );
      await go.click();
      await until(async () =>
        (await alert.innerText().catch(() => '')).includes('Too many requests'),
      );
      await go.click();
      await until(async () => (await alert.innerText().catch(() => '')).includes('called Belka'));
      assert.equal(await step(page, 'device'), '1');
    } finally {
      await h.close();
    }
  });
});

void describe('Add tool: the command, and checks from evidence', () => {
  void test('one paired device: the server’s command, no secret, checks that pass only on this tool’s evidence', async () => {
    const created = agentRow('a1', 'claude-code', 'Belka', []);
    let phase = 0;
    const verification = () => {
      const pass = (detail: unknown) => ({ state: 'pass', at: NOW - 30_000, detail });
      const fail = (detail: unknown) => ({ state: 'fail', at: null, detail });
      const request = phase === 0 ? null : phase === 1 ? 'codex' : 'claude-code';
      return {
        agent_id: 'a1',
        harness: 'claude-code',
        status: 'active',
        now: Date.now(),
        last_seen_at: phase === 0 ? null : Date.now() - 30_000,
        checks: {
          device_paired: pass({ device_id: 'd1' }),
          credential_installed:
            phase === 0
              ? fail({ token_id: null, via_exchange: false })
              : pass({ token_id: 't1', via_exchange: true }),
          credential_used: phase === 0 ? fail(null) : pass(null),
          tool_request:
            request === 'claude-code'
              ? pass({
                  evidence: 'client_info',
                  mcp_client_name: 'specific',
                  client_slug: 'claude-code',
                  client_name: 'claude-code',
                  client_version: '2.1.0',
                  self_reported: true,
                })
              : fail({
                  evidence: null,
                  mcp_client_name: 'specific',
                  client_slug: request,
                  client_name: request,
                  client_version: null,
                  self_reported: true,
                }),
          required_capabilities: { state: 'pass', at: null, detail: { required: [], missing: [] } },
          session_hooks: phase >= 3 ? pass({ harness: 'claude-code' }) : fail({ harness: null }),
        },
        client_report: null,
      };
    };
    const h = await open(
      '/developer?tab=tools&add=tool&tool=claude-code',
      stub('v3', [deviceRow('d1', 'Belka', true)], {
        '/api/v1/devices/d1/tools': () =>
          reply(201, {
            agent: created,
            exchange: {
              id: 'x1',
              state: 'open',
              purpose: 'install',
              agent_id: 'a1',
              device_id: 'd1',
              created_at: NOW,
              expires_at: NOW + 600_000,
              redeemed_at: null,
            },
            command: 'laika tool add claude-code --exchange x1',
            revokes_on_redeem: [],
          }),
        '/api/v1/tool-setup/x1': () => ({
          id: 'x1',
          state: phase === 0 ? 'open' : 'redeemed',
          purpose: 'install',
          agent_id: 'a1',
          device_id: 'd1',
          created_at: NOW,
          expires_at: NOW + 600_000,
          redeemed_at: phase === 0 ? null : NOW,
        }),
        '/api/v1/agents/a1/verification': verification,
        '/api/v1/agents/a1/checkpoint-consent': NO_CONSENT,
      }),
    );
    try {
      const page = h.page;
      await wizard(page, 'tool').waitFor({ timeout: 20_000 });
      assert.equal(await page.getByRole('radio', { name: /Claude Code/ }).isChecked(), true);
      // One paired device is a line, not a choice (LAI-1097, the owner's design).
      assert.equal(
        (await wizard(page, 'tool').locator('[data-on-device="d1"]').innerText()).trim(),
        'Belka · Local computer',
      );
      assert.equal(await page.getByRole('radio', { name: /Belka/ }).count(), 0);
      // How each tool is set up is said in words on its tile, and for the chosen one
      // beside its mode; with no tool count anywhere.
      const choose = await wizard(page, 'tool').innerText();
      assert.match(choose, /set up automatically/);
      assert.match(choose, /MCP entry by hand/);
      assert.match(choose, /Automatic: Credential, MCP entry and session hooks/);
      assert.doesNotMatch(choose, /\b\d+ (tools|agents)\b/);

      await page.getByRole('button', { name: /Get the command/ }).click();
      await until(async () => (await step(page, 'tool')) === '2');
      assert.deepEqual(h.calls.find((c) => c.path === '/api/v1/devices/d1/tools')?.body, {
        harness: 'claude-code',
      });
      assert.equal(
        await wizard(page, 'tool').locator('pre').innerText(),
        'laika tool add claude-code --exchange x1',
      );
      assert.match(page.url(), /exchange=x1/);
      assert.match(await wizard(page, 'tool').innerText(), /laika-claude/);
      await assertNothingKept(page);
      // The checks are step 3's (LAI-1081): configure on the device, then verify.
      assert.equal(await wizard(page, 'tool').locator('[data-check]').count(), 0);
      await page.getByRole('button', { name: /^I ran it/ }).click();
      await until(async () => (await step(page, 'tool')) === '3');

      const readiness = () => wizard(page, 'tool').getAttribute('data-status');
      const check = (id: string) =>
        wizard(page, 'tool').locator(`[data-check="${id}"]`).getAttribute('data-state');

      await until(async () => (await readiness()) === 'needs-setup', 15_000);
      assert.equal(await check('device_paired'), 'pass');
      assert.equal(await check('credential_installed'), 'fail');
      assert.match(
        await wizard(page, 'tool').locator('[data-check="credential_installed"]').innerText(),
        /Missing[\s\S]*run the command on Belka/,
      );

      // The credential arrives, and Codex calls on it: nothing ticks for Claude Code.
      phase = 1;
      await until(async () => (await check('credential_installed')) === 'pass', 20_000);
      assert.equal(await readiness(), 'connected');
      assert.equal(await check('tool_request'), 'fail');
      assert.match(
        await wizard(page, 'tool').locator('[data-check="tool_request"]').innerText(),
        /named Codex, not Claude Code/,
      );

      // Claude Code's own request, no session yet: still Connected.
      phase = 2;
      await until(async () => (await check('tool_request')) === 'pass', 20_000);
      assert.equal(await readiness(), 'connected');
      assert.equal(await check('session_hooks'), 'fail');

      // Its hooks open a session: Ready.
      phase = 3;
      await until(async () => (await readiness()) === 'ready', 25_000);
      assert.equal(
        await wizard(page, 'tool')
          .locator('[data-verify-status]')
          .getAttribute('data-verify-status'),
        'ready',
      );
      assert.match(
        await wizard(page, 'tool').locator('.dv3w-status-word').innerText(),
        /^Claude Code is Ready$/,
      );

      assert.equal(await step(page, 'tool'), '3');
      // Four checks (LAI-1097): paired, credential, its own request, its hooks.
      assert.deepEqual(
        await wizard(page, 'tool')
          .locator('[data-check]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-check'))),
        ['device_paired', 'credential_installed', 'tool_request', 'session_hooks'],
      );
      // Checkpoints are one line, what the board holds; the switch is the tool's details'.
      await until(
        async () =>
          (await wizard(page, 'tool')
            .locator('[data-consent-line]')
            .getAttribute('data-consent-line')) === 'false',
      );
      assert.match(
        await wizard(page, 'tool').locator('[data-consent-line]').innerText(),
        /^Automatic checkpoints: Off · change in its details$/,
      );
      assert.equal(await wizard(page, 'tool').getByRole('switch').count(), 0);
      assert.equal(writes(h.calls).filter((w) => w.includes('checkpoint-consent')).length, 0);
      // The footer is Back and one primary; nothing else to choose between.
      assert.deepEqual(
        (await wizard(page, 'tool').locator('.dx-wizard-foot button').allTextContents()).map((t) =>
          t.replace(/\s+/g, ' ').trim(),
        ),
        ['Back', 'Set up a project →'],
      );
      assert.equal(await page.getByRole('button', { name: 'Add another tool' }).count(), 0);

      await page.getByRole('button', { name: /Set up a project/ }).click();
      await until(() => page.url().includes('tab=projects'));
      assert.match(page.url(), /tab=projects&tool=a1/);
    } finally {
      await h.close();
    }
  });

  void test('a duplicate pair routes to the tool’s details, where it can be renamed', async () => {
    const twins = [agentRow('a2', 'codex'), agentRow('a3', 'codex')];
    const h = await open(
      '/developer?tab=tools&add=tool&tool=codex',
      stub('v3', [deviceRow('d1', 'Belka', true, twins)], {
        '/api/v1/devices/d1/tools': reply(409, {
          error: {
            code: 'conflict',
            message: 'dupes',
            details: { reason: 'agent_duplicates_need_resolution', agent_ids: ['a2', 'a3'] },
          },
        }),
      }),
    );
    try {
      const page = h.page;
      await wizard(page, 'tool').waitFor({ timeout: 20_000 });
      await page.getByRole('button', { name: /Get the command/ }).click();
      await page.getByRole('button', { name: 'Go to the conflicts' }).click();
      await wizard(page, 'tool').waitFor({ state: 'detached' });
      assert.match(page.url(), /agent=a2/);
      assert.match(page.url(), /tab=tools/);
      // LAI-1080: its details, where one of a pair is renamed.
      const details = page.locator(
        '.side-panel[data-panel="tool"] .dv3-tool-details[data-agent="a2"]',
      );
      await details.waitFor({ timeout: 10_000 });
      assert.equal(await details.locator('[data-rename]').count(), 1);
      assert.equal(await details.getByRole('button', { name: 'Rename…' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('no paired device: pair one first, keeping the tool', async () => {
    const h = await open(
      '/developer?tab=tools&add=tool&tool=codex',
      stub('v3', [deviceRow('d2', 'Strelka', false)]),
    );
    try {
      const page = h.page;
      await wizard(page, 'tool').locator('[data-no-paired]').waitFor({ timeout: 20_000 });
      assert.match(await wizard(page, 'tool').innerText(), /Strelka is imported, not paired yet/);
      await page.getByRole('button', { name: /^Add a device/ }).click();
      await wizard(page, 'device').waitFor({ timeout: 10_000 });
      assert.match(page.url(), /add=device/);
      assert.match(page.url(), /tool=codex/);
      // Pairing the imported device is an explicit choice there, never assumed.
      assert.equal(await page.getByRole('radio', { name: 'A new device' }).isChecked(), true);
    } finally {
      await h.close();
    }
  });

  void test('Reconnect on a paired device is an exchange: no rotate, no secret', async () => {
    const a1 = agentRow('a1', 'claude-code');
    const h = await open(
      '/developer?tab=tools&agent=a1',
      stub('v3', [deviceRow('d1', 'Belka', true, [a1])], {
        '/api/v1/agents/a1/reconnect': () =>
          reply(201, {
            agent: a1,
            exchange: {
              id: 'x2',
              state: 'open',
              purpose: 'rotate',
              agent_id: 'a1',
              device_id: 'd1',
              created_at: NOW,
              expires_at: NOW + 600_000,
              redeemed_at: null,
            },
            command: 'laika tool add claude-code --exchange x2',
            revokes_on_redeem: ['t-a1'],
          }),
        '/api/v1/tool-setup/x2': {
          id: 'x2',
          state: 'open',
          purpose: 'rotate',
          agent_id: 'a1',
          device_id: 'd1',
          created_at: NOW,
          expires_at: NOW + 600_000,
          redeemed_at: null,
        },
        '/api/v1/agents/a1/verification': refuse(500, 'internal', 'later'),
        '/api/v1/agents/a1/rotate-token': () => ({ secret: SECRET }),
      }),
    );
    try {
      const page = h.page;
      const details = page.locator(
        '.side-panel[data-panel="tool"] .dv3-tool-details[data-agent="a1"]',
      );
      await details.waitFor({ timeout: 20_000 });
      await details.getByRole('button', { name: 'Reconnect (new credential)…' }).click();
      await until(async () => (await step(page, 'tool')) === '2', 15_000);
      assert.match(page.url(), /reconnect=a1/);
      // Step 1 is done and names the tool, never a tick beside "Not yet" (LAI-1071).
      const railStep1 = await wizard(page, 'tool')
        .getByRole('navigation', { name: 'Tool setup steps' })
        .locator('.conn-step')
        .first()
        .evaluate((el) => `${el.getAttribute('data-state') ?? ''}:${el.textContent?.trim() ?? ''}`);
      assert.match(railStep1, /^done:.*Choose tool.*Claude Code · Belka$/);
      assert.doesNotMatch(railStep1, /Not yet/);
      assert.equal(
        await wizard(page, 'tool').locator('pre').innerText(),
        'laika tool add claude-code --exchange x2',
      );
      // The board said which live credential redeeming revokes: said before the copy.
      assert.equal(
        await wizard(page, 'tool')
          .locator('[data-revokes-on-redeem]')
          .getAttribute('data-revokes-on-redeem'),
        '1',
      );
      assert.match(
        await wizard(page, 'tool').innerText(),
        /replaces Claude Code’s current credential/,
      );
      assert.equal(h.calls.filter((c) => c.path.endsWith('/rotate-token')).length, 0);
      assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(SECRET));
    } finally {
      await h.close();
    }
  });
});

void describe('around the wizards', () => {
  void test('390 px, both themes: no sideways scroll on the pairing and tool steps', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const h = await open(
        '/developer?tab=devices&add=device&pairing=p1',
        stub('v3', [], { '/api/v1/devices/pairing-requests/p1': pairingView('claimed', true) }),
        {
          before: async (page) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.emulateMedia({ colorScheme: scheme });
          },
        },
      );
      try {
        await until(async () => (await step(h.page, 'device')) === '3', 20_000);
        const wide = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(wide <= 0, `${scheme}: the page scrolls sideways by ${String(wide)} px`);
      } finally {
        await h.close();
      }
    }
  });

  void test('classic is untouched: Connect with an agent is still the classic wizard', async () => {
    const h = await open('/developer?tab=connect&agent=codex', stub('classic', []));
    try {
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-wizard]').count(), 0);
      assert.match(h.page.url(), /tab=connect/);
      assert.equal(h.calls.filter((c) => c.path.startsWith('/api/v1/devices/')).length, 0);
    } finally {
      await h.close();
    }
  });
});

const exchangeRow = (state: string, redeemed: boolean) => ({
  id: 'x1',
  state,
  purpose: 'install',
  agent_id: 'a1',
  device_id: 'd1',
  created_at: NOW,
  expires_at: NOW + 600_000,
  redeemed_at: redeemed ? NOW : null,
});

const notYet = {
  agent_id: 'a1',
  harness: 'claude-code',
  status: 'active',
  now: NOW,
  last_seen_at: null,
  checks: {
    device_paired: { state: 'pass', at: NOW, detail: { device_id: 'd1' } },
    credential_installed: {
      state: 'fail',
      at: null,
      detail: { token_id: null, via_exchange: false },
    },
    credential_used: { state: 'fail', at: null, detail: null },
    tool_request: {
      state: 'fail',
      at: null,
      detail: {
        evidence: null,
        mcp_client_name: 'specific',
        client_slug: null,
        client_name: null,
        client_version: null,
        self_reported: true,
      },
    },
    required_capabilities: { state: 'pass', at: null, detail: { required: [], missing: [] } },
    session_hooks: { state: 'fail', at: null, detail: { harness: null } },
  },
  client_report: null,
};

const toolCreated = () =>
  reply(201, {
    agent: agentRow('a1', 'claude-code', 'Belka', []),
    exchange: exchangeRow('open', false),
    command: 'laika tool add claude-code --exchange x1',
    revokes_on_redeem: [],
  });

void describe('review round 1 (PR #215)', () => {
  void test('a poll answer behind the decision is ignored: no Approve after approving', async () => {
    const h = await open(
      '/developer?tab=devices&add=device&pairing=p1',
      stub('v3', [], {
        // A board slow to show the decision keeps answering `claimed`.
        '/api/v1/devices/pairing-requests/p1': pairingView('claimed', true),
        '/api/v1/devices/pairing-requests/p1/approve': pairingView('approved', true),
      }),
    );
    try {
      const page = h.page;
      await until(async () => (await step(page, 'device')) === '3', 20_000);
      await page.getByRole('button', { name: 'Approve Belka' }).click();
      await until(async () =>
        (await wizard(page, 'device').innerText()).includes('Waiting for Belka to finish'),
      );
      const reads = () =>
        h.calls.filter((c) => c.path === '/api/v1/devices/pairing-requests/p1').length;
      const before = reads();
      await until(() => reads() > before, 15_000);
      assert.ok(reads() > before, 'no poll ran after the approval');
      assert.equal(await page.getByRole('button', { name: 'Approve Belka' }).count(), 0);
      assert.match(await wizard(page, 'device').innerText(), /Waiting for Belka to finish/);
    } finally {
      await h.close();
    }
  });

  void test('an exchange that expired unredeemed stops the polling and offers a new command', async () => {
    const h = await open(
      '/developer?tab=tools&add=tool&tool=claude-code',
      stub('v3', [deviceRow('d1', 'Belka', true)], {
        '/api/v1/devices/d1/tools': toolCreated,
        '/api/v1/tool-setup/x1': exchangeRow('expired', false),
        '/api/v1/agents/a1/verification': notYet,
      }),
    );
    try {
      const page = h.page;
      await wizard(page, 'tool').waitFor({ timeout: 20_000 });
      await page.getByRole('button', { name: /Get the command/ }).click();
      await until(async () =>
        (await wizard(page, 'tool').innerText()).includes('This command expired'),
      );
      assert.ok(await page.getByRole('button', { name: 'Get a new command' }).isVisible());
      const reads = () => h.calls.filter((c) => c.path === '/api/v1/agents/a1/verification').length;
      const settled = reads();
      // Nothing should happen, so this is a window, not a wait: two poll gaps.
      await page.waitForTimeout(8_000);
      assert.equal(reads(), settled, 'the wizard kept polling an ended exchange');
    } finally {
      await h.close();
    }
  });

  void test('closing Add tool with an open exchange asks, then cancels it', async () => {
    const h = await open(
      '/developer?tab=tools&add=tool&tool=claude-code',
      stub('v3', [deviceRow('d1', 'Belka', true)], {
        '/api/v1/devices/d1/tools': toolCreated,
        '/api/v1/tool-setup/x1': (call: StubCall) =>
          call.method === 'DELETE' ? reply(200, {}) : exchangeRow('open', false),
        '/api/v1/agents/a1/verification': notYet,
      }),
    );
    try {
      const page = h.page;
      await wizard(page, 'tool').waitFor({ timeout: 20_000 });
      await page.getByRole('button', { name: /Get the command/ }).click();
      await until(async () => (await step(page, 'tool')) === '2');
      await page.getByRole('button', { name: 'Done' }).click();
      const dialog = page.getByRole('alertdialog');
      await dialog.waitFor({ timeout: 10_000 });
      assert.match(await dialog.innerText(), /Cancel this tool setup\?/);
      await dialog.getByRole('button', { name: 'Cancel setup' }).click();
      await wizard(page, 'tool').waitFor({ state: 'detached', timeout: 10_000 });
      assert.ok(writes(h.calls).includes('DELETE /api/v1/tool-setup/x1'));
    } finally {
      await h.close();
    }
  });

  void test('a session that cannot manage tools is told why Get the command is off', async () => {
    const perms = defaultPermissions(ME) as {
      me: { actions: string[] };
    };
    perms.me.actions = perms.me.actions.filter((a) => a !== 'agent.manage_own');
    const h = await open(
      '/developer?tab=tools&add=tool&tool=claude-code',
      stub('v3', [deviceRow('d1', 'Belka', true)], { '/api/v1/permissions': perms }),
    );
    try {
      const page = h.page;
      const go = page.getByRole('button', { name: /Get the command/ });
      await go.waitFor({ timeout: 20_000 });
      await until(async () => await go.isDisabled());
      assert.equal(await go.isDisabled(), true);
      const hintId = await go.getAttribute('aria-describedby');
      assert.ok(hintId !== null);
      assert.match(
        await page.locator(`[id="${hintId}"]`).innerText(),
        /needs a signed-in browser session/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a tool the helper refuses gets the manual step, never a laika tool add command', async () => {
    const h = await open(
      '/developer?tab=tools&add=tool&tool=zed',
      stub('v3', [deviceRow('d1', 'Belka', true)]),
    );
    try {
      const page = h.page;
      await wizard(page, 'tool').locator('[data-manual="zed"]').waitFor({ timeout: 20_000 });
      const text = await wizard(page, 'tool').innerText();
      assert.match(text, /has no setup for Zed yet and refuses it/);
      assert.match(text, /personal token from Advanced/);
      assert.match(text, /cannot set up Zed, so there is no command/);
      assert.equal(await wizard(page, 'tool').locator('pre').count(), 0);
      assert.equal(await page.getByRole('button', { name: /Get the command/ }).isDisabled(), true);
      await page.getByRole('button', { name: 'Open Advanced' }).click();
      await until(() => page.url().includes('tab=advanced'));
      assert.match(page.url(), /tab=advanced/);
      assert.equal(writes(h.calls).filter((w) => w.includes('/tools')).length, 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the owner’s design: the steps as he draws them (LAI-1097)', () => {
  void test('Add tool, step 1: the helper’s tools as option cards, the rest behind More tools', async () => {
    const h = await open(
      '/developer?tab=tools&add=tool',
      stub('v3', [deviceRow('d1', 'Belka', true), deviceRow('d2', 'Strelka', true)]),
    );
    try {
      const page = h.page;
      const w = wizard(page, 'tool');
      await w.locator('[data-tools="featured"]').waitFor({ timeout: 20_000 });
      // The tools `laika tool add` sets up, each with its line: the catalog's, by name.
      assert.deepEqual(
        await w.locator('[data-tools="featured"] .dx-option-name').allInnerTexts(),
        featuredTools().map((t) => t.name),
      );
      assert.match(
        await w.locator('[data-tool="claude-code"]').innerText(),
        /Claude Code\s+Direct coding tool · set up automatically/,
      );
      // The rest wait behind one disclosure, its count the catalog's.
      const more = w.getByRole('button', { name: `More tools (${String(moreTools().length)})` });
      assert.equal(await more.getAttribute('aria-expanded'), 'false');
      assert.equal(await w.locator('[data-tools="more"]').count(), 0);
      assert.equal(await page.getByRole('radio', { name: /Zed/ }).count(), 0);
      await more.click();
      assert.deepEqual(
        await w.locator('[data-tools="more"] .dx-option-name').allInnerTexts(),
        moreTools().map((t) => t.name),
      );
      assert.equal(
        await w.getByRole('button', { name: 'Fewer tools' }).getAttribute('aria-expanded'),
        'true',
      );
      // One radio group across both: choosing Zed unchooses nothing else, and says why it is by hand.
      await w.locator('[data-tool="zed"]').click();
      await w.locator('[data-manual="zed"]').waitFor({ timeout: 10_000 });
      assert.equal(await page.getByRole('radio', { name: /Zed/ }).isChecked(), true);
      assert.equal(await page.getByRole('radio', { name: /Claude Code/ }).isChecked(), false);
      await w.locator('[data-tool="claude-code"]').click();
      assert.equal(await page.getByRole('radio', { name: /Claude Code/ }).isChecked(), true);
      // Two paired devices are a dropdown, not cards, and neither is guessed.
      const device = w.getByRole('combobox');
      assert.deepEqual(await offered(device), [
        'Belka · Local computer',
        'Strelka · Local computer',
      ]);
      assert.equal(await page.getByRole('radio', { name: /Belka|Strelka/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /Get the command/ }).isDisabled(), true);
      assert.match(await w.locator('.dx-wizard-note').innerText(), /Choose a device\./);
      // Still three steps: authorising is Get the command, never a step of its own.
      assert.equal((await w.locator('.conn-eyebrow').textContent())?.trim(), 'Step 1 of 3 · Tool');
    } finally {
      await h.close();
    }
  });

  void test('Add tool, verify: checkpoints are read from the board, and changed in the tool’s details', async () => {
    const a1 = agentRow('a1', 'claude-code', 'Belka', []);
    const pass = (detail: unknown) => ({ state: 'pass', at: NOW - 30_000, detail });
    const fail = (detail: unknown) => ({ state: 'fail', at: null, detail });
    const h = await open(
      '/developer?tab=tools&add=tool&exchange=x1',
      stub('v3', [deviceRow('d1', 'Belka', true, [a1])], {
        '/api/v1/tool-setup/x1': () => ({
          id: 'x1',
          state: 'redeemed',
          purpose: 'install',
          agent_id: 'a1',
          device_id: 'd1',
          created_at: NOW,
          expires_at: NOW + 600_000,
          redeemed_at: NOW,
        }),
        '/api/v1/agents/a1/verification': () => ({
          agent_id: 'a1',
          harness: 'claude-code',
          status: 'active',
          now: Date.now(),
          last_seen_at: Date.now() - 30_000,
          checks: {
            device_paired: pass({ device_id: 'd1' }),
            credential_installed: pass({ token_id: 't1', via_exchange: true }),
            credential_used: pass(null),
            tool_request: fail({
              evidence: null,
              mcp_client_name: 'specific',
              client_slug: null,
              client_name: null,
              client_version: null,
              self_reported: true,
            }),
            required_capabilities: {
              state: 'pass',
              at: null,
              detail: { required: [], missing: [] },
            },
            session_hooks: fail({ harness: null }),
          },
          client_report: null,
        }),
        // Given before: the line says what the board holds, not a default.
        '/api/v1/agents/a1/checkpoint-consent': {
          given: true,
          given_by_user_id: 'u1',
          given_at: NOW - 60_000,
          withdrawn_at: null,
        },
      }),
    );
    try {
      const page = h.page;
      await until(async () => (await step(page, 'tool')) === '2', 20_000);
      await page.getByRole('button', { name: /^I ran it/ }).click();
      await until(async () => (await step(page, 'tool')) === '3');
      const w = wizard(page, 'tool');
      await until(async () => (await w.getAttribute('data-status')) === 'connected', 15_000);
      // Connected is never Ready: its own request is missing, and the line says so.
      assert.match(await w.locator('.dv3w-status-word').innerText(), /^Claude Code is Connected$/);
      assert.match(
        await w.locator('[data-check="tool_request"]').innerText(),
        /Missing[\s\S]*not from Claude Code itself/,
      );
      // A check met says only Done: its evidence is in the details.
      assert.equal(
        (await w.locator('[data-check="device_paired"]').innerText()).replace(/\s+/g, ' ').trim(),
        'Device paired Done',
      );
      await until(
        async () =>
          (await w.locator('[data-consent-line]').getAttribute('data-consent-line')) === 'true',
      );
      assert.match(
        await w.locator('[data-consent-line]').innerText(),
        /^Automatic checkpoints: On ·/,
      );
      await w.getByRole('button', { name: 'change in its details' }).click();
      await page.locator('.side-panel [data-agent="a1"]').waitFor({ timeout: 10_000 });
      const url = new URL(page.url());
      assert.equal(url.searchParams.get('agent'), 'a1');
      assert.equal(url.searchParams.get('add'), null);
      assert.equal(await w.count(), 0);
      // There, the switch itself.
      assert.equal(await page.locator('.side-panel').getByRole('switch').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('Add device, step 3: Approve and Deny are the footer’s; four tiles; when it was claimed', async () => {
    const h = await open(
      '/developer?tab=devices&add=device&pairing=p1',
      stub('v3', [], {
        '/api/v1/devices/pairing-requests/p1': () => pairingView('claimed', true),
      }),
    );
    try {
      const page = h.page;
      await until(async () => (await step(page, 'device')) === '3', 20_000);
      const w = wizard(page, 'device');
      const foot = w.locator('.dx-wizard-foot');
      assert.deepEqual(
        (await foot.locator('button').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()),
        ['Cancel pairing', 'Deny', 'Approve Belka'],
      );
      assert.equal(
        await foot.getByRole('button', { name: 'Approve Belka' }).getAttribute('class'),
        'dx-btn dx-btn-primary',
      );
      // Nothing to decide in the body: the fingerprint to compare, the facts, one warning.
      assert.equal(await w.locator('.conn-card-body button').count(), 0);
      assert.equal(
        (await w.locator('[data-fingerprint]').innerText()).replace(/\s/g, ''),
        FINGERPRINT,
      );
      assert.deepEqual(await w.locator('.dx-detail dt').allInnerTexts(), [
        'Device',
        'System',
        'Helper',
        'Tool credentials',
      ]);
      assert.match(
        await w.locator('.conn-card-head').innerText(),
        /Belka claimed the code (just now|\d+ min ago) with this key\./,
      );
    } finally {
      await h.close();
    }
  });

  void test('Add device, step 1: the design’s option cards, a full-width name, the helper as one line', async () => {
    const h = await open('/developer?tab=devices&add=device', stub('v3', []));
    try {
      const page = h.page;
      await page.setViewportSize({ width: 1440, height: 900 });
      const w = wizard(page, 'device');
      await w.getByLabel('Device name').waitFor({ timeout: 20_000 });
      // The kind cards are the prototype's size: one line of sub, about 77 px tall.
      for (const name of ['My computer', 'Cloud runner']) {
        const box = await w.locator('.dx-option', { hasText: name }).boundingBox();
        assert.ok(box !== null);
        assert.ok(box.height <= 80, `${name} is ${String(box.height)} px tall`);
      }
      // The name fills its column.
      const input = await w.getByLabel('Device name').boundingBox();
      const column = await w.locator('.conn-field').boundingBox();
      assert.ok(input !== null && column !== null);
      assert.ok(Math.abs(input.width - column.width) <= 1, 'the name is not full width');
      // Helper installed? Two radios in one compact line, not a second pair of cards.
      const choice = w.locator('[data-installed-choice]');
      assert.equal(await choice.locator('.dx-option').count(), 0);
      assert.equal(await choice.getByRole('radio', { name: 'No, install it' }).isChecked(), true);
      const row = await choice.locator('.dv3w-segments').boundingBox();
      assert.ok(row !== null && row.height <= 48, 'the helper choice is not one line');
      await choice.locator('.dv3w-segment', { hasText: 'Yes' }).click();
      assert.equal(await choice.getByRole('radio', { name: 'Yes' }).isChecked(), true);
      assert.equal(await choice.getByRole('radio', { name: 'No, install it' }).isChecked(), false);
    } finally {
      await h.close();
    }
  });
});

void describe('an open wizard stands in place of its list (LAI-1081)', () => {
  for (const [tab, open_, back, which] of [
    ['devices', '+ Add device', 'Back to devices', 'device'],
    ['tools', '+ Add tool', 'Back to tools', 'tool'],
  ] as const) {
    void test(`${tab}: ${open_} hides the list; ${back} brings it back, focus on ${open_}`, async () => {
      const h = await open(
        `/developer?tab=${tab}`,
        stub('v3', [deviceRow('d1', 'Belka', true, [agentRow('a1', 'claude-code')])]),
      );
      try {
        const page = h.page;
        const list = page.locator('.dv3-list');
        await list.waitFor({ timeout: 20_000 });
        const verifications = () =>
          h.calls.filter((c) => c.path === '/api/v1/agents/a1/verification').length;
        await until(() => verifications() > 0);
        await page.waitForTimeout(300);
        const asked = verifications();
        await page.getByRole('button', { name: open_ }).click();
        await wizard(page, which).waitFor({ timeout: 20_000 });
        assert.equal(await list.count(), 0);
        await page.getByRole('button', { name: back }).click();
        await wizard(page, which).waitFor({ state: 'detached', timeout: 10_000 });
        await list.waitFor({ timeout: 10_000 });
        await until(
          async () =>
            (await page.evaluate(() => document.activeElement?.textContent?.trim())) === open_,
        );
        // Opened and closed with nothing changed: nothing is asked of the board again.
        await page.waitForTimeout(500);
        assert.equal(verifications(), asked);
      } finally {
        await h.close();
      }
    });
  }
});

/**
 * Set `LAIKA_EVIDENCE_DIR` to save each wizard step in the owner's design's
 * frame (LAI-1081), light and dark, at a desktop's width and a phone's — to
 * put beside the prototype's own screenshots. Skipped otherwise.
 */
const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

void describe('screenshots of each step (LAI-1081)', { skip: EVIDENCE === undefined }, () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390] as const) {
      void test(`${theme}, ${String(width)}px`, async () => {
        const size = { width, height: width === 390 ? 844 : 900 };
        const shot = async (page: Page, name: string) => {
          // A step's buttons ease into their new look; shoot them settled.
          await page.waitForTimeout(400);
          await page.screenshot({
            path: `${EVIDENCE ?? ''}/wizard-${name}-${theme}-${String(width)}.png`,
            fullPage: true,
          });
        };

        let pairing: 'open' | 'claimed' | 'completed' = 'open';
        const h = await open(
          '/developer?tab=devices&add=device',
          stub('v3', [], {
            '/api/v1/devices/pairing-requests': (call: StubCall) =>
              call.method === 'POST'
                ? reply(201, {
                    pairing: pairingView('open', false),
                    user_code: CODE,
                    command: `laika device pair --board http://board.test --code ${CODE}`,
                  })
                : refuse(405, 'method_not_allowed', 'no'),
            '/api/v1/devices/pairing-requests/p1': () =>
              pairingView(pairing, pairing !== 'open', pairing === 'completed' ? 'd9' : null),
          }),
        );
        try {
          await h.page.setViewportSize(size);
          await setTheme(h.page, theme);
          await wizard(h.page, 'device').waitFor({ timeout: 20_000 });
          await shot(h.page, 'device-1');
          await h.page.getByLabel('Device name').fill('Belka');
          await h.page.getByRole('button', { name: /Get a pairing code/ }).click();
          await until(async () => (await step(h.page, 'device')) === '2');
          await shot(h.page, 'device-2');
          pairing = 'claimed';
          await until(async () => (await step(h.page, 'device')) === '3', 20_000);
          await shot(h.page, 'device-3');
          pairing = 'completed';
          await until(async () => (await step(h.page, 'device')) === '4', 20_000);
          await shot(h.page, 'device-4');
        } finally {
          await h.close();
        }

        const created = agentRow('a1', 'claude-code', 'Belka', []);
        const pass = (detail: unknown) => ({ state: 'pass', at: NOW - 30_000, detail });
        const fail = (detail: unknown) => ({ state: 'fail', at: null, detail });
        const t = await open(
          '/developer?tab=devices&add=tool&tool=claude-code',
          stub('v3', [deviceRow('d1', 'Belka', true)], {
            '/api/v1/devices/d1/tools': () =>
              reply(201, {
                agent: created,
                exchange: {
                  id: 'x1',
                  state: 'open',
                  purpose: 'install',
                  agent_id: 'a1',
                  device_id: 'd1',
                  created_at: NOW,
                  expires_at: NOW + 600_000,
                  redeemed_at: null,
                },
                command: 'laika tool add claude-code --exchange x1',
                revokes_on_redeem: [],
              }),
            '/api/v1/tool-setup/x1': () => ({
              id: 'x1',
              state: 'redeemed',
              purpose: 'install',
              agent_id: 'a1',
              device_id: 'd1',
              created_at: NOW,
              expires_at: NOW + 600_000,
              redeemed_at: NOW,
            }),
            '/api/v1/agents/a1/verification': () => ({
              agent_id: 'a1',
              harness: 'claude-code',
              status: 'active',
              now: Date.now(),
              last_seen_at: Date.now() - 30_000,
              checks: {
                device_paired: pass({ device_id: 'd1' }),
                credential_installed: pass({ token_id: 't1', via_exchange: true }),
                credential_used: pass(null),
                tool_request: pass({
                  evidence: 'client_info',
                  mcp_client_name: 'specific',
                  client_slug: 'claude-code',
                  client_name: 'claude-code',
                  client_version: '2.1.0',
                  self_reported: true,
                }),
                required_capabilities: {
                  state: 'pass',
                  at: null,
                  detail: { required: [], missing: [] },
                },
                session_hooks: fail({ harness: null }),
              },
              client_report: null,
            }),
            '/api/v1/agents/a1': { ...created, sessions: [] },
            '/api/v1/agents/a1/checkpoint-consent': NO_CONSENT,
          }),
        );
        try {
          await t.page.setViewportSize(size);
          await setTheme(t.page, theme);
          await wizard(t.page, 'tool').waitFor({ timeout: 20_000 });
          await shot(t.page, 'tool-1');
          await t.page.getByRole('button', { name: /^More tools/ }).click();
          await shot(t.page, 'tool-1-more');
          await t.page.getByRole('button', { name: 'Fewer tools' }).click();
          await t.page.getByRole('button', { name: /Get the command/ }).click();
          await until(async () => (await step(t.page, 'tool')) === '2');
          await shot(t.page, 'tool-2');
          await t.page.getByRole('button', { name: /^I ran it/ }).click();
          await until(async () => (await step(t.page, 'tool')) === '3');
          await t.page.locator('[data-check="tool_request"]').waitFor({ timeout: 20_000 });
          await shot(t.page, 'tool-3');
        } finally {
          await t.close();
        }
      });
    }
  }
});
