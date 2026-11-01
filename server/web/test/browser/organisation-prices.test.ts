/**
 * The Organisation screen's *Model prices* (LAI-773, D-084 item 10): the
 * prices every cost on Usage is computed with, said as **API-equivalent, not
 * your bill**, each with where it came from — and changed only by an owner or
 * admin, when the server says so (`can_set`).
 *
 * The fixtures answer as `services/org-model-prices.ts` does for each reader:
 * the same table for everyone, `can_set` true only for an owner or admin on a
 * web session.
 */

import { answerConfirm } from './confirm.ts';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, until, type ApiStub, type StubCall } from './harness.ts';

const ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing';
const OPENAI = 'https://developers.openai.com/api/docs/pricing';

const price = (over: Record<string, unknown>) => ({
  model: 'claude-opus-5-5',
  input: 4,
  output: 20,
  cache_write: 5,
  cache_read: 0.2,
  source: ANTHROPIC,
  as_of: '2026-10-18',
  confirmed: true,
  overridden: false,
  table: null,
  ...over,
});

const TABLE = {
  model: 'claude-opus-4-8',
  input: 5,
  output: 25,
  cache_write: 6.25,
  cache_read: 0.5,
  source: ANTHROPIC,
  as_of: '2026-10-18',
  confirmed: true,
};

const prices = (canSet: boolean) => ({
  as_of: '2026-10-18',
  can_set: canSet,
  entries: [
    // The organisation's own over the table's, first.
    price({
      model: 'claude-opus-4-8',
      input: 4.5,
      output: 22.5,
      cache_write: 5.625,
      cache_read: 0.45,
      source: 'org',
      as_of: '2026-10-17',
      overridden: true,
      table: TABLE,
    }),
    price({
      table: {
        ...TABLE,
        model: 'claude-opus-5-5',
        input: 4,
        output: 20,
        cache_write: 5,
        cache_read: 0.2,
      },
    }),
    price({
      model: 'gpt-5.2-codex',
      input: 1.75,
      output: 14,
      cache_write: 1.75,
      cache_read: 0.175,
      source: OPENAI,
      confirmed: false,
      note: "Not on OpenAI's price page on 2026-10-18; priced as gpt-5.3-codex, which is.",
    }),
  ],
});

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'owner')], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Kvelld Dynamics',
    presence_enabled: true,
    developer_insights: true,
    created_at: 1,
    updated_at: 2,
  },
};

const me = (org_role: string) => ({ ...user('u1', 'Ada Lovelace', org_role), memberships: [] });

void after(async () => {
  await closeBrowser();
});

void describe('the price table, for everyone who may see the organisation', () => {
  void test('a member: every price, whose it is, its source and date — nothing to change', async () => {
    const h = await open('/organisation?tab=integrations', {
      ...BASE,
      '/api/v1/me': me('member'),
      '/api/v1/org/model-prices': prices(false),
    });
    try {
      const section = h.page.locator('[data-section="prices"]');
      await section.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      const text = await section.innerText();
      assert.match(text, /API-equivalent, not your bill/);
      assert.match(text, /table of 2026-10-18/);
      await until(async () => (await section.locator('tbody tr').count()) === 3);
      assert.equal(await section.locator('tbody tr').count(), 3);
      const opus = section.locator('tr[data-model="claude-opus-5-5"]');
      assert.match(await opus.innerText(), /\$4\.00\s+\$20\.00\s+\$5\.00\s+\$0\.20/);
      assert.match(
        await opus.innerText(),
        /from the price page\s+platform\.claude\.com · 2026-10-18/,
      );
      assert.equal(await opus.locator('a.org-price-source').getAttribute('href'), ANTHROPIC);
      assert.match(
        await section.locator('tr[data-model="gpt-5.2-codex"]').innerText(),
        /inferred[\s\S]*priced as gpt-5\.3-codex/,
      );
      assert.match(
        await section.locator('tr[data-model="claude-opus-4-8"]').innerText(),
        /organisation’s own\s+set 2026-10-17/,
      );
      assert.equal(await section.getByRole('button', { name: 'Edit' }).count(), 0);
      assert.equal(await section.locator('.org-price-new').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('an admin: edits a price, resets the organisation’s own, and prices a model the table lacks', async () => {
    const writes: StubCall[] = [];
    const h = await open('/organisation?tab=integrations', {
      ...BASE,
      '/api/v1/me': me('admin'),
      '/api/v1/org/model-prices': prices(true),
      '/api/v1/org/model-prices/claude-opus-5-5': (call: StubCall) => {
        writes.push(call);
        return prices(true);
      },
      '/api/v1/org/model-prices/claude-opus-4-8': (call: StubCall) => {
        writes.push(call);
        return prices(true);
      },
      '/api/v1/org/model-prices/gpt-5.1-codex-mini': (call: StubCall) => {
        writes.push(call);
        return prices(true);
      },
    });
    try {
      const section = h.page.locator('[data-section="prices"]');
      await section.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      const opus = section.locator('tr[data-model="claude-opus-5-5"]');
      await opus.getByRole('button', { name: 'Edit' }).click();
      const editing = section.locator('tr[data-editing]');
      await editing.getByLabel('Input, dollars per million, claude-opus-5-5').fill('3.5');
      await editing.getByRole('button', { name: 'Save' }).click();
      await h.page.waitForFunction(() => document.querySelector('tr[data-editing]') === null);
      assert.equal(writes[0]?.method, 'PUT');
      assert.equal(writes[0]?.path, '/api/v1/org/model-prices/claude-opus-5-5');
      assert.deepEqual(writes[0]?.body, {
        input: 3.5,
        output: 20,
        cache_write: 5,
        cache_read: 0.2,
      });

      await section
        .locator('tr[data-model="claude-opus-4-8"]')
        .getByRole('button', { name: 'Reset' })
        .click();
      // Reset asks first (LAI-522), naming the model.
      assert.match(
        await answerConfirm(h.page, true),
        /Reset claude-opus-4-8 to the table’s price\?/,
      );
      await until(() => writes.length === 2);
      // Its answer redraws the table: wait until the buttons are back.
      await until(
        async () => !(await section.getByRole('button', { name: 'Price a model' }).isDisabled()),
      );
      await until(async () => (await section.locator('button[disabled]').count()) === 0);
      assert.equal(writes[1]?.method, 'DELETE');
      assert.equal(writes[1]?.path, '/api/v1/org/model-prices/claude-opus-4-8');

      await section.getByLabel('Model id to price').fill('gpt-5.1-codex-mini');
      await section.getByRole('button', { name: 'Price a model' }).click();
      const form = section.locator('form[aria-label="Price for gpt-5.1-codex-mini"]');
      for (const [label, value] of [
        ['Input', '0.25'],
        ['Output', '2'],
        ['Cache write', '0.25'],
        ['Cache read', '0.025'],
      ] as const) {
        await form.getByLabel(`${label}, dollars per million, gpt-5.1-codex-mini`).fill(value);
      }
      await form.getByRole('button', { name: 'Save' }).click();
      await h.page.waitForFunction(
        () => document.querySelector('form[aria-label^="Price for"]') === null,
      );
      assert.equal(writes[2]?.path, '/api/v1/org/model-prices/gpt-5.1-codex-mini');
      assert.deepEqual(writes[2]?.body, {
        input: 0.25,
        output: 2,
        cache_write: 0.25,
        cache_read: 0.025,
      });
    } finally {
      await h.close();
    }
  });

  void test('light and dark at 1366 and 390: the page never scrolls sideways', async () => {
    const h = await open('/organisation?tab=integrations', {
      ...BASE,
      '/api/v1/me': me('owner'),
      '/api/v1/org/model-prices': prices(true),
    });
    try {
      await h.page.locator('[data-section="prices"] tbody tr').first().waitFor({ timeout: 20_000 });
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1366, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          const spill = () =>
            h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          // The size lands before the reflow does (LAI-715).
          await until(async () => (await spill()) <= 0);
          const overflow = await spill();
          assert.ok(overflow <= 0, `${theme} at ${String(width)}: ${String(overflow)} px sideways`);
        }
      }
    } finally {
      await h.close();
    }
  });
});
