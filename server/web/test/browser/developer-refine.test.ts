/**
 * Developer access V3, refined against the interaction contract (LAI-1197),
 * in a real browser:
 *
 * - Revoking a personal credential asks first; declining sends nothing and
 *   says nothing; confirming sends the DELETE and leaves a visible result
 *   note, which Dismiss takes away.
 * - A one-time secret is shown once with Copy, focus on *I've saved it*;
 *   while it is on screen leaving the page asks the browser's warning; once
 *   saved it is gone from the page and a note says it cannot come back.
 * - Disconnecting a device asks first and says what it did on screen; a
 *   re-read that then fails keeps the list, says so with Retry, and Retry
 *   brings it up to date.
 * - The Overview keeps what it shows when a re-read fails, with Retry; the
 *   first load failing still shows the full error.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { answerConfirm } from './confirm.ts';
import { closeBrowser, open, refuse, reply, until, type StubCall } from './harness.ts';
import { CLAUDE, CODEX, OMNIGENT, deviceRow, stub } from './developer-v3-fixtures.ts';

after(async () => {
  await closeBrowser();
});

const DAY = 24 * 60 * 60 * 1000;

const tokenView = (id: string, name: string) => ({
  id,
  name,
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: Date.now() - DAY,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  kind: 'personal',
  agent_id: null,
  agent_label: null,
});

const ONCE = 'lai_refine_secret_shown_once';

const result = (page: Page) => page.locator('[data-result]');
const stale = (page: Page) => page.locator('[data-stale]');
const deletes = (calls: readonly StubCall[]) => calls.filter((c) => c.method === 'DELETE');

/** Whether a `beforeunload` now would ask: some listener prevented it. */
const leavingAsks = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

const advanced = () =>
  stub({
    agents: [CLAUDE],
    routes: {
      '/api/v1/tokens': (call: StubCall) =>
        call.method === 'POST'
          ? reply(201, { token: tokenView('t9', 'release-bot'), secret: ONCE })
          : { data: [tokenView('t1', 'nightly-export')], next_cursor: null },
      '/api/v1/tokens/t1': (call: StubCall) =>
        call.method === 'DELETE' ? reply(200, {}) : tokenView('t1', 'nightly-export'),
    },
  });

void describe('Advanced: revoking a personal credential', () => {
  void test('asks first; declining sends nothing and says nothing', async () => {
    const h = await open('/developer?tab=advanced', advanced());
    try {
      const row = h.page.locator('.dev-adv-row', { hasText: 'nightly-export' });
      await row.waitFor({ timeout: 20_000 });
      await row.getByRole('button', { name: 'More actions for nightly-export' }).click();
      await h.page.getByRole('menuitem', { name: 'Revoke credential…' }).click();
      const asked = await answerConfirm(h.page, false);
      assert.match(asked, /Revoke “nightly-export”\?/);
      assert.match(asked, /stops working immediately, and it cannot be restored/);
      await h.page.waitForTimeout(400);
      assert.equal(deletes(h.calls).length, 0);
      assert.equal(await result(h.page).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('confirming DELETEs it and says so on screen, until dismissed', async () => {
    const h = await open('/developer?tab=advanced', advanced());
    try {
      const row = h.page.locator('.dev-adv-row', { hasText: 'nightly-export' });
      await row.waitFor({ timeout: 20_000 });
      await row.getByRole('button', { name: 'More actions for nightly-export' }).click();
      await h.page.getByRole('menuitem', { name: 'Revoke credential…' }).click();
      await answerConfirm(h.page, true);
      await until(() => deletes(h.calls).some((c) => c.path === '/api/v1/tokens/t1'));
      assert.deepEqual(
        deletes(h.calls).map((c) => c.path),
        ['/api/v1/tokens/t1'],
      );
      await result(h.page).waitFor({ timeout: 10_000 });
      assert.match(
        await result(h.page).innerText(),
        /Revoked “nightly-export”\. Anything using it has stopped working\./,
      );
      await result(h.page)
        .getByRole('button', { name: /^Dismiss: Revoked/ })
        .click();
      await result(h.page).waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('Advanced: a one-time secret', () => {
  void test('shown once with Copy; leaving asks; I’ve saved it hides it for good', async () => {
    const h = await open('/developer?tab=advanced', advanced());
    try {
      const create = h.page.getByRole('button', { name: '+ New personal credential' });
      await create.click({ timeout: 20_000 });
      await h.page.getByLabel('Name').fill('release-bot');
      await h.page.getByRole('button', { name: 'Create credential' }).click();
      const reveal = h.page.locator('.tok-reveal');
      await reveal.waitFor({ timeout: 10_000 });
      assert.equal(await reveal.locator('.tok-secret').innerText(), ONCE);
      assert.equal(await reveal.getByRole('button', { name: /Copy/ }).count(), 1);
      const saved = reveal.getByRole('button', { name: 'I’ve saved it' });
      await until(() => saved.evaluate((el) => el === document.activeElement).catch(() => false));
      assert.equal(
        await saved.evaluate((el) => el === document.activeElement),
        true,
        'focus is not on I’ve saved it',
      );
      assert.equal(await leavingAsks(h.page), true, 'leaving with the secret shown did not ask');

      await saved.click();
      await reveal.waitFor({ state: 'detached', timeout: 5_000 });
      assert.doesNotMatch(await h.page.content(), new RegExp(ONCE));
      assert.match(
        await result(h.page).innerText(),
        /“release-bot” is ready to use\. Its secret is hidden now and cannot be shown again\./,
      );
      assert.equal(await leavingAsks(h.page), false, 'leaving still asks with nothing to lose');
      await until(() => create.evaluate((el) => el === document.activeElement).catch(() => false));
      assert.equal(await create.evaluate((el) => el === document.activeElement), true);
    } finally {
      await h.close();
    }
  });
});

void describe('Devices: disconnect, then a re-read that fails', () => {
  void test('asks first, says what it did, keeps the list on a failed re-read, and Retry recovers', async () => {
    const tools = [CLAUDE, CODEX, OMNIGENT];
    let disconnected = false;
    let healthy = true;
    let reads = 0;
    const listed = () => {
      const agents = disconnected
        ? tools.map((a) => ({ ...a, status: 'revoked', revoked_at: Date.now() }))
        : tools;
      return { data: [deviceRow(agents)] };
    };
    const h = await open(
      '/developer?tab=devices&device=d1',
      stub({
        agents: tools,
        routes: {
          '/api/v1/devices': () => {
            reads += 1;
            return healthy ? listed() : refuse(503, 'unavailable', 'The board is restarting.');
          },
          '/api/v1/agents/devices/revoke': () => {
            disconnected = true;
            // The re-read after the write is the one that fails.
            healthy = false;
            return { revoked_agent_ids: tools.map((a) => a.id) };
          },
        },
      }),
    );
    try {
      const panel = h.page.locator('.side-panel[data-panel="device"]');
      await panel.getByRole('button', { name: 'Disconnect device…' }).click({ timeout: 20_000 });
      const asked = await answerConfirm(h.page, true);
      assert.match(asked, /Disconnect Belka\?/);
      assert.match(asked, /They cannot be restored/);
      await until(() => h.calls.some((c) => c.path === '/api/v1/agents/devices/revoke'));

      await result(h.page).waitFor({ timeout: 10_000 });
      assert.match(
        await result(h.page).innerText(),
        /Belka disconnected: 3 tools revoked\. Their credentials no longer work\./,
      );

      // The re-read failed: the list stays, with the notice and Retry — not an error in its place.
      await stale(h.page).waitFor({ timeout: 10_000 });
      assert.match(await stale(h.page).innerText(), /Couldn’t refresh your devices/);
      assert.match(await stale(h.page).innerText(), /The board is restarting\./);
      assert.equal(await stale(h.page).getAttribute('role'), 'alert');
      assert.equal(await h.page.locator('.dv3-roster .state-error').count(), 0);
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 5_000 });

      healthy = true;
      const before = reads;
      await stale(h.page).getByRole('button', { name: 'Retry' }).click();
      await until(() => reads > before);
      await stale(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('Overview: Retry keeps the last data', () => {
  void test('a re-read that fails keeps the page, says so, and Retry recovers', async () => {
    let healthy = true;
    const h = await open(
      '/developer?tab=overview',
      stub({
        routes: {
          '/api/v1/project-setups': () =>
            healthy ? { data: [] } : refuse(503, 'unavailable', 'The board is restarting.'),
        },
      }),
    );
    try {
      const hero = h.page.locator('[data-testid="dev-overview"] .dx-hero');
      await hero.waitFor({ timeout: 20_000 });
      healthy = false;
      await h.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await stale(h.page).waitFor({ timeout: 10_000 });
      assert.match(await stale(h.page).innerText(), /Couldn’t refresh your repository setups/);
      assert.match(await stale(h.page).innerText(), /Showing what was last loaded, at /);
      assert.equal(await hero.count(), 1, 'the page was replaced by the error');
      assert.equal(await h.page.locator('[data-testid="dev-overview"] .state-error').count(), 0);

      healthy = true;
      await stale(h.page).getByRole('button', { name: 'Retry' }).click();
      await stale(h.page).waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await hero.count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('the first load failing still shows the full error, with a retry', async () => {
    let healthy = false;
    const h = await open(
      '/developer?tab=overview',
      stub({
        routes: {
          '/api/v1/project-setups': () =>
            healthy ? { data: [] } : refuse(503, 'unavailable', 'The board is restarting.'),
        },
      }),
    );
    try {
      const error = h.page.locator('[data-testid="dev-overview"] .state-error');
      await error.waitFor({ timeout: 20_000 });
      assert.equal(await stale(h.page).count(), 0);
      healthy = true;
      await error.getByRole('button', { name: 'Try again' }).click();
      await h.page.locator('[data-testid="dev-overview"] .dx-hero').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });
});
