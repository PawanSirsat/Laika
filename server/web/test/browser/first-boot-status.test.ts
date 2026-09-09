/**
 * The first-boot status panel renders real values (LAI-158).
 *
 * `SystemStatus` was built by LAI-021, styled, tested — and **never rendered**,
 * because LAI-106 AC5 ruled that hardcoded numbers on a status panel are worse
 * than no panel. LAI-206 provided the data and LAI-160 declared the type; this
 * is the render.
 *
 * ## Why a browser
 *
 * AC5 asks that the panel show the values it was given **and that no other
 * string from the response body reaches the DOM**. That is a claim about what a
 * reader sees, and the only way to check it is to look at what is on the page.
 * A source assertion can say `system.database` appears in the file; it cannot
 * say `setup_required` does not appear on the screen.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const SYSTEM = {
  database: 'SQLite · WAL',
  migrations_applied: 18,
  smtp_configured: false,
};

const STUB: ApiStub = {
  '/api/v1/setup/status': { setup_required: true, system: SYSTEM },
  '/api/v1/health': { status: 'ok', version: '0.1.0', uptime_ms: 1234 },
};

void after(async () => {
  await closeBrowser();
});

void describe('the first-boot status panel', () => {
  void test('shows the three values it was given, in both themes', async () => {
    const h = await open('/setup', STUB);
    try {
      const panel = h.page.locator('.status');
      await panel.waitFor({ timeout: 20_000 });

      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(250);

        const text = await panel.innerText();
        assert.match(text, /SQLite · WAL/, `${theme}: the engine is not the served one`);
        assert.match(text, /18 applied/, `${theme}: the migration count is missing`);
        assert.match(text, /smtp not configured/i, `${theme}: SMTP state is missing`);

        const box = await panel.boundingBox();
        assert.ok(box !== null && box.height > 0, `${theme}: the panel has no box`);
      }
    } finally {
      await h.close();
    }
  });

  void test('no total, and no slash — the denominator can never differ', async () => {
    const h = await open('/setup', STUB);
    try {
      const panel = h.page.locator('.status');
      await panel.waitFor({ timeout: 20_000 });
      const text = await panel.innerText();
      assert.doesNotMatch(text, /18\s*\/\s*18/, 'a total is being displayed');
      assert.doesNotMatch(text, /\d+\s*\/\s*\d+/, 'a fraction is being displayed');
    } finally {
      await h.close();
    }
  });

  void test('nothing else from the response body reaches the panel', async () => {
    // AC5's other half. `setup_required` is on the same object and is the
    // screen's routing decision, not something to show a person.
    const h = await open('/setup', STUB);
    try {
      const panel = h.page.locator('.status');
      await panel.waitFor({ timeout: 20_000 });
      const text = await panel.innerText();

      for (const leaked of ['setup_required', 'true', 'false', 'migrations_applied']) {
        assert.ok(!text.includes(leaked), `the panel leaked "${leaked}"`);
      }
      // And the engine is never the prototype's (D-001).
      assert.doesNotMatch(text, /postgres/i);
    } finally {
      await h.close();
    }
  });

  void test('the panel is absent, not guessed, before the response lands', async () => {
    // A status panel is read precisely when somebody is checking whether
    // something is wrong. Its old version drew `sqlite · wal` from the page's
    // own existence — which proves the database opened and says nothing about
    // the journal mode.
    const noSystem: ApiStub = {
      ...STUB,
      // A server that answers without `system` at all: nothing to report.
      '/api/v1/setup/status': { setup_required: true },
    };
    const h = await open('/setup', noSystem);
    try {
      await h.page.locator('.boot-form').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);
      assert.equal(await h.page.locator('.status').count(), 0, 'the panel guessed');
      // The screen still works — the panel is a detail on it, not its point.
      assert.ok(await h.page.locator('.boot-form').isVisible());
    } finally {
      await h.close();
    }
  });
});
