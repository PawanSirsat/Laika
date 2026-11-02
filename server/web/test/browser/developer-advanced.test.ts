/**
 * Developer access V3 → Advanced and Activity (LAI-1058, plan §B.5, §B.6,
 * §L7), in a real browser.
 *
 * - Advanced asks for personal credentials only, and shows no agent's.
 * - A new credential's expiry: 90 days unless chosen, *Never* still allowed.
 * - A personal token a coding tool uses says *Personal (legacy)*, and its
 *   *Upgrade connection* goes to Add a tool without revoking anything.
 * - Revoke is under `⋯`, asks first, and a refusal shows with the form shut.
 * - The one-time secret is shown once, and focus comes back after it.
 * - Activity in v3 says *Once per device* and points at Project setup; its
 *   history deletion still asks first.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page, Request } from 'playwright';
import { answerConfirm } from './confirm.ts';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

type Mode = 'classic' | 'preview' | 'v3';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
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

const tokenView = (over: Record<string, unknown> & { id: string; name: string }) => ({
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  kind: 'personal',
  agent_id: null,
  agent_label: null,
  ...over,
});

const SCRIPT = tokenView({ id: 't1', name: 'nightly-export', last_used_at: NOW - DAY });
const LEGACY = tokenView({
  id: 't2',
  name: 'old-laptop',
  last_used_at: NOW - 60_000,
  last_mcp_at: NOW - 60_000,
  last_client: 'claude-code',
  last_client_name: 'claude-code',
});
const AGENT = tokenView({
  id: 't3',
  name: 'agent-credential',
  kind: 'agent',
  agent_id: 'a1',
  agent_label: 'claude-code · Belka',
});

function stub(mode: Mode, over: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    // A server that ignored `?kind=` would send the agent's too; the tab must
    // still not show it.
    '/api/v1/tokens': (call: StubCall) =>
      call.method === 'POST'
        ? reply(201, {
            token: tokenView({ id: 't9', name: 'new-one' }),
            secret: 'lai_secret_shown_once',
          })
        : { data: [SCRIPT, LEGACY, AGENT], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: [], next_cursor: null },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/org': {
      id: 'org1',
      name: 'Kvell Dynamics',
      presence_enabled: true,
      developer_insights: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/me/activity-sharing': {
      org_enabled: true,
      enabled: true,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    },
    '/api/v1/me/local-activity': {
      start: '2026-10-02',
      end: '2026-10-15',
      tz: 'UTC',
      days: [
        {
          day: '2026-10-14',
          prompts_by_agent: { 'claude-code': 3 },
          sessions: 1,
          commits_local: 0,
          pushed_commits: 0,
          tokens: 0,
          cache_read: 0,
        },
      ],
      collectors: 1,
      oldest_day: '2026-10-14',
    },
    '/api/v1/developer/compatibility': compat(mode),
    ...over,
  };
}

after(async () => {
  await closeBrowser();
});

const here = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

const rowOf = (page: Page, name: string) => page.locator('.dev-adv-row', { hasText: name });

void describe('Advanced lists personal credentials only', () => {
  for (const mode of ['preview', 'v3'] as const) {
    void test(`${mode}: asks for kind=personal, and never shows an agent's credential`, async () => {
      const h = await open('/developer?tab=advanced', stub(mode));
      try {
        await rowOf(h.page, 'nightly-export').waitFor({ timeout: 20_000 });
        const asked: string[] = [];
        h.page.on('request', (r: Request) => {
          if (new URL(r.url()).pathname === '/api/v1/tokens') asked.push(r.url());
        });
        await h.page.reload();
        await rowOf(h.page, 'nightly-export').waitFor({ timeout: 20_000 });
        assert.ok(asked.length > 0, 'the list was not read');
        for (const url of asked) {
          assert.equal(new URL(url).searchParams.get('kind'), 'personal', url);
        }
        assert.equal(await h.page.locator('.dev-adv-row').count(), 2);
        assert.equal(await h.page.getByText('agent-credential').count(), 0);
        assert.equal(await h.page.getByText(/Belka/).count(), 0);
        assert.match(
          await h.page.locator('.dev-adv-intro').innerText(),
          /scripts, the REST API and automation/,
        );
      } finally {
        await h.close();
      }
    });
  }
});

void describe('a legacy tool token', () => {
  void test('is labelled Personal (legacy), says how to move, and a script token is not', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      const legacy = rowOf(h.page, 'old-laptop');
      await legacy.waitFor({ timeout: 20_000 });
      assert.equal(await legacy.locator('.tok-kind').textContent(), 'Personal (legacy)');
      assert.match(await legacy.innerText(), /Used by Claude Code\. It keeps working/);
      assert.equal(
        await rowOf(h.page, 'nightly-export').locator('.tok-kind').textContent(),
        'Personal',
      );
      assert.equal(await rowOf(h.page, 'nightly-export').locator('.dev-adv-legacy').count(), 0);
      assert.match(
        await h.page.locator('.dev-adv-legacy-note').innerText(),
        /One of these is used by a coding tool\..*Nothing is revoked for you/s,
      );
    } finally {
      await h.close();
    }
  });

  void test('Upgrade connection opens Add a tool on that tool, and revokes nothing', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      const link = h.page.getByRole('link', { name: 'Upgrade connection for old-laptop' });
      await link.waitFor({ timeout: 20_000 });
      assert.equal(
        await link.getAttribute('href'),
        '/developer?tab=devices&add=tool&tool=claude-code',
      );
      await link.click();
      await until(() => here(h.page.url()).startsWith('/developer?tab=devices'), 10_000);
      assert.equal(here(h.page.url()), '/developer?tab=devices&add=tool&tool=claude-code');
      await h.page.waitForTimeout(500);
      assert.equal(
        h.calls.filter((c) => c.method === 'DELETE').length,
        0,
        'upgrading sent a DELETE',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('creating a credential', () => {
  void test('the expiry defaults to 90 days and is sent; the secret is shown once; focus comes back', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      const create = h.page.getByRole('button', { name: '+ New personal credential' });
      await create.click();
      const name = h.page.getByRole('textbox', { name: 'Name' });
      await name.waitFor({ timeout: 10_000 });
      assert.equal(await name.evaluate((el) => el === document.activeElement), true);
      const expiry = h.page.getByRole('combobox', { name: 'Expires' });
      assert.match(await expiry.innerText(), /90 days/);
      await expiry.click();
      assert.deepEqual(
        (await h.page.getByRole('option').allInnerTexts()).map((t) => t.trim()),
        ['30 days', '90 days', '180 days', '1 year', 'Never'],
      );
      await h.page.keyboard.press('Escape');
      await name.fill('new-one');
      const before = Date.now();
      await h.page.getByRole('button', { name: 'Create credential' }).click();
      await h.page.locator('.tok-secret').waitFor({ timeout: 10_000 });
      const post = h.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/tokens');
      assert.ok(post, 'no POST was sent');
      const body = post.body as { name: string; scope: string; expires_at?: number };
      assert.equal(body.name, 'new-one');
      assert.equal(typeof body.expires_at, 'number');
      const days = ((body.expires_at ?? 0) - before) / DAY;
      assert.ok(days > 89.9 && days < 90.1, `expires in ${String(days)} days, not 90`);

      assert.equal(await h.page.locator('.tok-secret').innerText(), 'lai_secret_shown_once');
      await h.page.getByRole('button', { name: 'Done' }).click();
      await until(async () => (await h.page.locator('.tok-reveal').count()) === 0);
      assert.equal(await h.page.getByText('lai_secret_shown_once').count(), 0);
      await until(async () =>
        create.evaluate((el) => el === document.activeElement).catch(() => false),
      );
    } finally {
      await h.close();
    }
  });

  void test('Never is still allowed, and sends no expiry', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await h.page.getByRole('button', { name: '+ New personal credential' }).click();
      await h.page.getByRole('textbox', { name: 'Name' }).fill('forever');
      await h.page.getByRole('combobox', { name: 'Expires' }).click();
      await h.page.getByRole('option', { name: 'Never' }).click();
      assert.match(await h.page.locator('.tok-form').innerText(), /works until you revoke it/);
      await h.page.getByRole('button', { name: 'Create credential' }).click();
      await h.page.locator('.tok-secret').waitFor({ timeout: 10_000 });
      const post = h.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/tokens');
      assert.ok(post, 'no POST was sent');
      assert.equal('expires_at' in (post.body as object), false);
    } finally {
      await h.close();
    }
  });

  void test('Escape closes the form and gives focus back to the button', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      const create = h.page.getByRole('button', { name: '+ New personal credential' });
      await create.click();
      await h.page.getByRole('textbox', { name: 'Name' }).waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator('.tok-form').count()) === 0);
      await until(async () =>
        create.evaluate((el) => el === document.activeElement).catch(() => false),
      );
    } finally {
      await h.close();
    }
  });
});

void describe('revoking', () => {
  void test('is under ⋯, asks first, and declining sends nothing', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      const row = rowOf(h.page, 'nightly-export');
      await row.waitFor({ timeout: 20_000 });
      assert.equal(await row.getByRole('button', { name: /^Revoke/ }).count(), 0);
      await row.getByRole('button', { name: 'More actions for nightly-export' }).click();
      await h.page.getByRole('menuitem', { name: 'Revoke credential…' }).click();
      const asked = await answerConfirm(h.page, false);
      assert.match(asked, /nightly-export/);
      assert.match(asked, /stops working immediately/);
      await h.page.waitForTimeout(500);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('confirming DELETEs it; a refusal is shown with the form closed', async () => {
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', { '/api/v1/tokens/t2': refuse(409, 'conflict', 'That token is busy') }),
    );
    try {
      const row = rowOf(h.page, 'old-laptop');
      await row.waitFor({ timeout: 20_000 });
      await row.getByRole('button', { name: 'More actions for old-laptop' }).click();
      await h.page.getByRole('menuitem', { name: 'Revoke credential…' }).click();
      const asked = await answerConfirm(h.page, true);
      assert.match(asked, /A coding tool is using this token/);
      await until(() =>
        h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/tokens/t2'),
      );
      const error = h.page.locator('.dev-adv-error');
      await error.waitFor({ timeout: 10_000 });
      assert.equal(await error.innerText(), 'That token is busy');
      assert.equal(await h.page.locator('.tok-form').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('Activity', () => {
  void test('v3: Once per device, Project setup named, rules and history unchanged', async () => {
    const h = await open('/developer?tab=activity', stub('v3'));
    try {
      await h.page.locator('.dev-sharing .share-list').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.dev-sharing .conn-chip-scope').innerText(),
        'Once per device',
      );
      const text = await h.page.locator('.dev-sharing').innerText();
      assert.match(text, /Developer access’s Project setup\./);
      assert.doesNotMatch(text, /Projects tab/);
    } finally {
      await h.close();
    }
  });

  for (const mode of ['classic', 'preview'] as const) {
    void test(`${mode}: the Activity tab is exactly as it was`, async () => {
      const h = await open('/developer?tab=activity', stub(mode));
      try {
        await h.page.locator('.dev-sharing .share-list').first().waitFor({ timeout: 20_000 });
        assert.equal(
          await h.page.locator('.dev-sharing .conn-chip-scope').innerText(),
          'Once per machine',
        );
        assert.match(
          await h.page.locator('.dev-sharing').innerText(),
          /Developer access’s Projects tab\./,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('deleting the history asks first; declining sends nothing', async () => {
    const h = await open('/developer?tab=activity', stub('v3'));
    try {
      const del = h.page.getByRole('button', { name: 'Delete my local-activity history' });
      await del.waitFor({ timeout: 20_000 });
      await del.click();
      const asked = await answerConfirm(h.page, false);
      assert.match(asked, /This cannot be undone/);
      await h.page.waitForTimeout(500);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);
    } finally {
      await h.close();
    }
  });
});
