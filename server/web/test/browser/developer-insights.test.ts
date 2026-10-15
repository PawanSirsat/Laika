/**
 * D-079's two switches in a real browser (LAI-751): the organisation's
 * *Developer insights* on Organisation, and the developer's own *Share local
 * activity* on Connect, with what is held for them and the delete.
 *
 * Each write is asserted by the request the page sent — method, path and
 * body — and by what the page then shows from the answer, so a switch that
 * only changed its own colour fails.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, reply, until, type ApiStub, type StubCall } from './harness.ts';

const NOW = Date.now();
const DAY = 86_400_000;
const TODAY = new Date(NOW).toISOString().slice(0, 10);
const YESTERDAY = new Date(NOW - DAY).toISOString().slice(0, 10);

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const me = (org_role: string) => ({ ...user('u1', 'Ada Lovelace', org_role), memberships: [] });

const org = (developer_insights: boolean) => ({
  id: 'o1',
  name: 'Kvelld Dynamics',
  presence_enabled: true,
  developer_insights,
  created_at: 1,
  updated_at: 2,
});

void after(async () => {
  await closeBrowser();
});

void describe('Organisation: Developer insights', () => {
  void test('an owner turns it on with a switch, and the page shows the server’s answer', async () => {
    let on = false;
    const h = await open('/organisation', {
      '/api/v1/me': me('owner'),
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'owner')], next_cursor: null },
      '/api/v1/invites': { data: [], next_cursor: null },
      '/api/v1/org': (call: StubCall) => {
        if (call.method === 'PATCH')
          on = (call.body as { developer_insights: boolean }).developer_insights;
        return org(on);
      },
    });
    try {
      const fact = h.page.locator('[data-fact="developer-insights"]');
      const toggle = fact.getByRole('switch', { name: 'Developer insights' });
      await toggle.waitFor({ timeout: 20_000 });
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      assert.match(await fact.innerText(), /each developer can choose — for themselves/);
      assert.match(await fact.innerText(), /never prompt text/);

      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'true');
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/org');
      assert.deepEqual(patch?.body, { developer_insights: true });
      assert.match(await toggle.innerText(), /On/);

      // And off again, by keyboard.
      await toggle.focus();
      await h.page.keyboard.press('Space');
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'false');
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    } finally {
      await h.close();
    }
  });

  void test('a member reads the setting, with no switch to press', async () => {
    const h = await open('/organisation', {
      '/api/v1/me': me('member'),
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'member')], next_cursor: null },
      '/api/v1/org': org(true),
    });
    try {
      const fact = h.page.locator('[data-fact="developer-insights"]');
      await fact.waitFor({ timeout: 20_000 });
      assert.equal(await fact.getByRole('switch').count(), 0);
      assert.match(await fact.innerText(), /^Developer insights\s*on/i);
    } finally {
      await h.close();
    }
  });
});

const HELD = {
  start: new Date(NOW - 13 * DAY).toISOString().slice(0, 10),
  end: TODAY,
  tz: 'UTC',
  days: [
    {
      day: TODAY,
      prompts_by_agent: { 'claude-code': 18, 'gemini-cli': 2, other: 1 },
      sessions: 3,
      commits_local: 2,
      pushed_commits: 4,
    },
    { day: YESTERDAY, prompts_by_agent: {}, sessions: 0, commits_local: 1, pushed_commits: 0 },
  ],
  collectors: 1,
  oldest_day: YESTERDAY,
};

const NOTHING = { ...HELD, days: [], collectors: 0, oldest_day: null };

function connect(
  state: { org: boolean; enabled: boolean; scope: string },
  held: { value: unknown },
): ApiStub {
  return {
    '/api/v1/me': me('owner'),
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/org': org(state.org),
    '/api/v1/me/activity-sharing': (call: StubCall) => {
      if (call.method === 'PUT') Object.assign(state, call.body);
      return {
        org_enabled: state.org,
        enabled: state.enabled,
        scope: state.scope,
        min_sync_interval_s: 600,
      };
    },
    '/api/v1/me/local-activity': (call: StubCall) => {
      if (call.method === 'DELETE') {
        held.value = NOTHING;
        return reply(204, null);
      }
      return held.value;
    },
  };
}

void describe('Connect: Share local activity', () => {
  void test('with the organisation’s switch off, says so and offers nothing to turn on', async () => {
    const h = await open(
      '/connect',
      connect({ org: false, enabled: false, scope: 'agent-repos' }, { value: NOTHING }),
    );
    try {
      await h.page.locator('.conn-rail-extra', { hasText: 'Share local activity' }).click();
      const panel = h.page.locator('.share-activity');
      await panel.locator('.share-list').first().waitFor({ timeout: 20_000 });
      assert.match(await panel.innerText(), /Developer insights are off for this organisation/);
      assert.equal(await panel.getByRole('switch').count(), 0);
      assert.equal(await panel.locator('a[href="/organisation"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('turns sharing on and narrows the scope, shows the command, what is sent and never sent', async () => {
    const state = { org: true, enabled: false, scope: 'agent-repos' };
    const h = await open('/connect', connect(state, { value: HELD }));
    try {
      await h.page.locator('.conn-rail-extra', { hasText: 'Share local activity' }).click();
      const panel = h.page.locator('.share-activity');
      const toggle = panel.getByRole('switch', { name: 'Share my local activity' });
      await toggle.waitFor({ timeout: 20_000 });
      const text = await panel.innerText();
      assert.match(text, /How many prompts you sent, per agent/);
      assert.match(text, /Prompt text, or anything an agent wrote/);
      assert.match(text, /Commit messages, author emails or commit ids/);
      assert.match(text, /merge commits never count/);

      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'true');
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      const puts = () =>
        h.calls.filter((c) => c.method === 'PUT' && c.path === '/api/v1/me/activity-sharing');
      assert.deepEqual(puts()[0]?.body, { enabled: true });

      // The radio follows the server's answer, so click and wait for it —
      // `check()` would assert before the PUT has returned.
      const narrow = panel.locator('input[name="share-scope"][value="laika-repos"]');
      await narrow.click();
      await until(() => puts().length === 2);
      assert.deepEqual(puts()[1]?.body, { scope: 'laika-repos' });
      await until(() => narrow.isChecked());
      assert.equal(await narrow.isChecked(), true);

      assert.equal((await panel.locator('pre.conn-pre').innerText()).trim(), 'laika activity on');
    } finally {
      await h.close();
    }
  });

  void test('previews what is held, by agent name, and deletes it after a confirmation', async () => {
    const held = { value: HELD as unknown };
    const h = await open(
      '/connect',
      connect({ org: true, enabled: true, scope: 'agent-repos' }, held),
    );
    try {
      await h.page.locator('.conn-rail-extra', { hasText: 'Share local activity' }).click();
      const panel = h.page.locator('.share-activity');
      const table = panel.locator('table.share-table');
      await table.waitFor({ timeout: 20_000 });
      const rows = await table.locator('tbody tr').allInnerTexts();
      assert.equal(rows.length, 2);
      assert.match(rows[0] ?? '', /Claude Code 18, Gemini CLI 2, Other agent 1\s+3\s+2\s+4/);

      // Declining the confirmation deletes nothing.
      h.page.once('dialog', (dialog) => {
        void dialog.dismiss();
      });
      await panel.getByRole('button', { name: 'Delete my local-activity history' }).click();
      await h.page.waitForTimeout(150);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);

      h.page.once('dialog', (dialog) => {
        assert.match(dialog.message(), /cannot be undone/);
        void dialog.accept();
      });
      await panel.getByRole('button', { name: 'Delete my local-activity history' }).click();
      await panel.locator('[data-state="nothing-held"]').waitFor();
      assert.equal(
        h.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/v1/me/local-activity')
          .length,
        1,
      );
      assert.match(
        await panel.innerText(),
        /Deleted\. Nothing held for you in these 14 days, and nothing older\./,
      );
      assert.equal(
        await panel.getByRole('button', { name: 'Delete my local-activity history' }).count(),
        0,
      );
    } finally {
      await h.close();
    }
  });
});
