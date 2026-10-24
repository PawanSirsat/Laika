/**
 * Developer access as one page of four tabs (LAI-507, D-111): Connect — the
 * wizard — then Projects, Activity, Tokens. And the two prompts that replaced
 * the one: the machine prompt installs and, when the organisation collects
 * local activity, turns the collector on, never touching a repository; the
 * project prompt writes the block and nothing else.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { pick } from './dropdown.ts';
import { closeBrowser, open, until, type ApiStub } from './harness.ts';
import { ACTIVITY_ON } from '../../src/routes/screens/connect/connect-copy.ts';

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

const project = (id: string, slug: string, prefix: string, name: string) => ({
  id,
  slug,
  prefix,
  name,
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
});

const ONROUTE = project('p1', 'onroute', 'ONR', 'OnRoute');
const SKYNET = project('p2', 'skynet', 'SKY', 'Skynet');

function stub(orgCollects: boolean, over: Partial<ApiStub> = {}): ApiStub {
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [ONROUTE, SKYNET], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/org': {
      id: 'org1',
      name: 'Kvell Dynamics',
      presence_enabled: true,
      developer_insights: orgCollects,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/me/activity-sharing': {
      org_enabled: orgCollects,
      enabled: orgCollects,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    },
    '/api/v1/me/local-activity': {
      start: '2026-10-02',
      end: '2026-10-15',
      tz: 'UTC',
      days: [],
      collectors: 0,
      oldest_day: null,
    },
    ...over,
  };
}

after(async () => {
  await closeBrowser();
});

const tabs = async (h: Awaited<ReturnType<typeof open>>) =>
  (await h.page.locator('.page-tab').allInnerTexts()).map((t) => t.trim());

void describe('four tabs (LAI-507)', () => {
  void test('/developer opens on Connect, and the four tabs are the four', async () => {
    const h = await open('/developer', stub(false));
    try {
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      assert.deepEqual(await tabs(h), ['Connect', 'Projects', 'Activity', 'Tokens']);
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Connect/);
      assert.match(await h.page.locator('.screen-page-title').innerText(), /Developer access/);
      // The wizard's own header gave up its band: the board's address sits in
      // the page header, as every embedded screen's controls do.
      assert.equal(await h.page.locator('.screen-bar').count(), 0, 'a band header is drawn');
      assert.equal(await h.page.locator('.screen-page-actions .conn-url').count(), 1);
      // The compact card of LAI-796 is gone with it.
      assert.equal(await h.page.locator('.dev-connect, .dev-steps').count(), 0);
      assert.doesNotMatch(await h.page.locator('.dev-page').innerText(), /Invite a teammate/);
    } finally {
      await h.close();
    }
  });

  void test('each tab renders its own thing, and a link to it keeps the tab', async () => {
    const h = await open('/developer?tab=projects', stub(false));
    try {
      await h.page.locator('.dev-projects .conn-project-block').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Projects/);

      await h.page.locator('.page-tab', { hasText: 'Activity' }).click();
      await h.page.locator('.dev-sharing .share-list').first().waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Activity/);
      assert.match(
        await h.page.locator('.dev-sharing .conn-chip-scope').innerText(),
        /Once per machine/,
      );

      await h.page.locator('.page-tab', { hasText: 'Tokens' }).click();
      await h.page.locator('.dev-tokens').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Tokens/);
      // Tokens' own control sits in the page header, as it did (LAI-796).
      await h.page
        .locator('.screen-page-actions')
        .getByRole('button', { name: /New token/ })
        .waitFor({ timeout: 10_000 });

      await h.page.locator('.page-tab', { hasText: 'Connect' }).click();
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      assert.match(h.page.url(), /\/developer\?tab=connect/);
    } finally {
      await h.close();
    }
  });

  void test('the wizard’s old address redirects into the tab, step and agent kept', async () => {
    const h = await open('/developer/connect?agent=codex&step=2', stub(false));
    try {
      await h.page.waitForURL(
        (url) => url.pathname === '/developer' && url.search === '?tab=connect&agent=codex&step=2',
        { timeout: 10_000 },
      );
      await h.page.locator('.conn-wizard-card[data-step="2"]').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.conn-rail-sub').first().innerText(), /Codex/);
    } finally {
      await h.close();
    }
  });
});

void describe('two prompts, two scopes (D-111)', () => {
  /** Step 3's main block for Claude Code, the reader having brought a token. */
  const setupText = async (h: Awaited<ReturnType<typeof open>>): Promise<string> => {
    await h.page.locator('.conn-rail-step').nth(1).click();
    const bring = h.page.getByRole('button', { name: 'Use a token I already have' });
    if ((await bring.count()) > 0) await bring.click();
    await h.page.locator('.conn-rail-step').nth(2).click();
    const pre = h.page.locator('.conn-block-main pre.conn-pre').first();
    await pre.waitFor({ timeout: 20_000 });
    return pre.innerText();
  };

  void test('the machine prompt never writes a repository, and says it is once per machine', async () => {
    const h = await open('/developer', stub(false));
    try {
      const text = await setupText(h);
      assert.match(text, /install\.sh/);
      assert.doesNotMatch(text, /--- begin block ---|Add the Laika block|CLAUDE\.md, so every/);
      assert.match(text, /once per machine, not per project/);
      assert.ok(
        !text.includes(ACTIVITY_ON),
        'the collector is turned on while the org does not collect',
      );
      assert.match(text, /does not collect local activity/);
      // The chip on step 3 says the same in two words.
      assert.match(
        await h.page.locator('.conn-setup-bar .conn-chip-scope').innerText(),
        /Once per machine/,
      );
    } finally {
      await h.close();
    }
  });

  void test('when the organisation collects, the machine prompt turns local activity on', async () => {
    const h = await open('/developer', stub(true));
    try {
      await until(async () => (await setupText(h)).includes(ACTIVITY_ON), 20_000);
      const text = await setupText(h);
      assert.ok(text.includes(ACTIVITY_ON));
      assert.match(text, /Turn on local activity for this machine/);
    } finally {
      await h.close();
    }
  });

  void test('the CLI route for another agent gains the same last line', async () => {
    const h = await open('/developer?agent=codex', stub(true));
    try {
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      await until(async () => (await setupText(h)).includes(ACTIVITY_ON), 20_000);
      const text = await setupText(h);
      assert.ok(
        text.trimEnd().endsWith(ACTIVITY_ON),
        `the CLI block ends with: ${text.slice(-80)}`,
      );
      assert.match(text, /laika connect codex/);
    } finally {
      await h.close();
    }
  });

  void test('the project prompt writes the block into the agent’s file, and nothing else', async () => {
    const h = await open('/developer?tab=projects', stub(true));
    try {
      const tab = h.page.locator('.dev-projects');
      await tab.locator('.conn-project-prompt').waitFor({ timeout: 20_000 });
      assert.match(await tab.locator('.conn-chip-scope').innerText(), /Once per project/);
      const prompt = await tab.locator('.conn-project-prompt').innerText();
      assert.match(prompt, /CLAUDE\.md/);
      assert.match(prompt, /once per project/);
      assert.match(prompt, /This project is tracked on a Laika board\./);
      assert.doesNotMatch(prompt, /install\.sh|git clone|lai_/);
      assert.match(prompt, /onroute/);
      // The block beside it is the committed form, and carries no token either.
      assert.doesNotMatch(await tab.locator('.conn-project-block').innerText(), /lai_/);
      // Both copy buttons say what they copy.
      assert.equal(
        await tab.getByRole('button', { name: 'Copy the CLAUDE.md block', exact: true }).count(),
        1,
      );
      assert.equal(
        await tab.getByRole('button', { name: 'Copy the project prompt', exact: true }).count(),
        1,
      );

      // Another agent, another file — and the prompt follows.
      await pick(h.page.locator('#dev-project-agent'), 'gemini-cli');
      await until(async () =>
        (await tab.locator('#dev-project-block-label').innerText())
          .toLowerCase()
          .includes('gemini.md'),
      );
      assert.match(await tab.locator('.conn-project-prompt').innerText(), /GEMINI\.md/);

      // An editor that reads its MCP config from the repo is told the one more thing.
      assert.equal(await tab.locator('[data-note="project-file"]').count(), 0);
      await pick(h.page.locator('#dev-project-agent'), 'vscode');
      await tab.locator('[data-note="project-file"]').waitFor({ timeout: 10_000 });
      assert.match(
        await tab.locator('[data-note="project-file"]').innerText(),
        /laika connect vscode --project/,
      );
    } finally {
      await h.close();
    }
  });

  void test('at 390px the tabs and the Projects tab fit without a sideways scroll', async () => {
    const h = await open('/developer?tab=projects', stub(true));
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('.dev-projects .conn-project-prompt').waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      const wide = await h.page.evaluate(() => ({
        page: document.documentElement.scrollWidth > window.innerWidth,
        spill: [...document.querySelectorAll('.dev-body > *, .page-tabs, .screen-page')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .map((el) => el.className),
      }));
      assert.equal(wide.page, false, 'the page scrolls sideways');
      assert.deepEqual(wide.spill, []);
    } finally {
      await h.close();
    }
  });
});
