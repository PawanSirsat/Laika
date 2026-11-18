/**
 * Developer access V3 → Advanced (LAI-1058, plan §B.6, §L7; LAI-1327), in a
 * real browser. Advanced holds the reader's personal credentials and nothing
 * else — Activity is a tab of its own (developer-activity.test.ts).
 *
 * - Advanced asks for personal credentials only, and shows no agent's.
 * - Only what is in use is in view, and counted: revoked and expired wait
 *   behind *Show N revoked/expired*.
 * - Personal tokens a coding tool uses are one callout — *N credentials are
 *   used by coding tools* — that opens to their rows, each with a *Used by …*
 *   chip and *Move to Tools*, which revokes nothing.
 * - A new credential's expiry: 90 days unless chosen, *Never* still allowed.
 * - Revoke is under `⋯`, asks first, and a refusal shows with the form shut.
 * - The one-time secret is shown once, and focus comes back after it.
 * - One flat card, nothing boxed inside it; the `full` chip is neutral; *How
 *   to use a personal credential* is a closed fold. Classic and preview's
 *   Activity tab draw their panel as they always did.
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
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

/** Set `LAIKA_SHOTS` to a directory to keep the pictures the review asks for. */
const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

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
const REVOKED = tokenView({
  id: 't5',
  name: 'old-ci',
  revoked_at: NOW - 2 * DAY,
});
const EXPIRED = tokenView({
  id: 't6',
  name: 'last-quarter',
  expires_at: NOW - DAY,
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
        // In view: the script's row; the coding tool's is in the callout, closed.
        assert.equal(await h.page.locator('.dev-adv-row').count(), 1);
        assert.equal(
          await h.page.locator('.dev-adv-legacy-callout').getAttribute('data-legacy-count'),
          '1',
        );
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

void describe('personal tokens a coding tool uses: one callout (LAI-1327)', () => {
  void test('one line and a closed toggle; opened, the row has a short chip and Move to Tools', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      const callout = h.page.locator('.dev-adv-legacy-callout');
      await callout.waitFor({ timeout: 20_000 });
      assert.equal(
        (await callout.locator('.dev-adv-legacy-note').innerText()).replace(/\s+/g, ' '),
        '1 credential is used by a coding tool — move it to Tools, where each tool gets its own. Nothing is revoked for you.',
      );
      const toggle = callout.getByRole('button', { name: 'Show it' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await rowOf(h.page, 'old-laptop').count(), 0);

      await toggle.click();
      const legacy = rowOf(h.page, 'old-laptop');
      await legacy.waitFor({ timeout: 10_000 });
      assert.equal(
        await callout.getByRole('button', { name: 'Hide them' }).getAttribute('aria-expanded'),
        'true',
      );
      assert.equal(await legacy.locator('.dev-adv-used-by').innerText(), 'Used by Claude Code');
      assert.equal(await legacy.locator('.tok-kind').textContent(), 'Personal (legacy)');
      // The long sentence each row carried is gone.
      assert.doesNotMatch(await callout.innerText(), /It keeps working; to give/);
      assert.equal(await rowOf(h.page, 'nightly-export').locator('.dev-adv-used-by').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('two are counted as two', async () => {
    const SECOND = tokenView({
      id: 't4',
      name: 'old-desktop',
      last_mcp_at: NOW - DAY,
      last_client: 'codex',
      last_client_name: 'codex',
    });
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', { '/api/v1/tokens': { data: [SCRIPT, LEGACY, SECOND], next_cursor: null } }),
    );
    try {
      const callout = h.page.locator('.dev-adv-legacy-callout');
      await callout.waitFor({ timeout: 20_000 });
      assert.equal(await callout.getAttribute('data-legacy-count'), '2');
      assert.match(
        await callout.locator('.dev-adv-legacy-note').innerText(),
        /^2 credentials are used by coding tools — move them to Tools/,
      );
      await callout.getByRole('button', { name: 'Show them' }).click();
      await rowOf(h.page, 'old-desktop').waitFor({ timeout: 10_000 });
      assert.equal(
        await rowOf(h.page, 'old-desktop').locator('.dev-adv-used-by').innerText(),
        'Used by Codex',
      );
    } finally {
      await h.close();
    }
  });

  void test('Move to Tools opens Add a tool on that tool, and revokes nothing', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await h.page.getByRole('button', { name: 'Show it' }).click();
      const link = h.page.getByRole('link', { name: 'Move old-laptop to Tools' });
      await link.waitFor({ timeout: 20_000 });
      assert.equal(await link.innerText(), 'Move to Tools');
      assert.equal(
        await link.getAttribute('href'),
        '/developer?tab=tools&add=tool&tool=claude-code',
      );
      await link.click();
      await until(() => here(h.page.url()).startsWith('/developer?tab=tools'), 10_000);
      assert.equal(here(h.page.url()), '/developer?tab=tools&add=tool&tool=claude-code');
      await h.page.waitForTimeout(500);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0, 'moving sent a DELETE');
    } finally {
      await h.close();
    }
  });
});

void describe('revoked and expired wait behind a toggle (LAI-1327)', () => {
  void test('hidden and uncounted until asked for; shown, each says what it is', async () => {
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', {
        '/api/v1/tokens': { data: [SCRIPT, REVOKED, LEGACY, EXPIRED], next_cursor: null },
      }),
    );
    try {
      await rowOf(h.page, 'nightly-export').waitFor({ timeout: 20_000 });
      // The count is of credentials in use: the script's and the tool's.
      assert.equal((await h.page.locator('.dev-adv-count').innerText()).trim(), '· 2');
      assert.equal(await rowOf(h.page, 'old-ci').count(), 0);
      assert.equal(await rowOf(h.page, 'last-quarter').count(), 0);

      const show = h.page.getByRole('button', { name: 'Show 2 revoked/expired' });
      assert.equal(await show.getAttribute('aria-expanded'), 'false');
      await show.click();
      await rowOf(h.page, 'old-ci').waitFor({ timeout: 10_000 });
      assert.equal(await rowOf(h.page, 'old-ci').locator('.tok-state').textContent(), 'revoked');
      assert.equal(
        await rowOf(h.page, 'last-quarter').locator('.tok-state').textContent(),
        'expired',
      );
      // A revoked one can be revoked no further: it says when, not ⋯.
      assert.equal(await rowOf(h.page, 'old-ci').locator('.tok-revoked-at').count(), 1);
      assert.equal((await h.page.locator('.dev-adv-count').innerText()).trim(), '· 2');

      await h.page.getByRole('button', { name: 'Hide revoked/expired' }).click();
      await until(async () => (await rowOf(h.page, 'old-ci').count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('none retired: no toggle at all', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await rowOf(h.page, 'nightly-export').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: /revoked\/expired/ }).count(), 0);
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
      await h.page.getByRole('button', { name: 'I’ve saved it' }).click();
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
      // The tool's token is in its callout: opened first.
      await h.page.getByRole('button', { name: 'Show it' }).click();
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

/** Advanced's one fold (LAI-1100 #11): what explains a personal credential. */
const fold = (page: Page, id: string) => page.locator(`.dev-advanced-page [data-fold="${id}"]`);
const isOpen = (page: Page, id: string) =>
  fold(page, id).evaluate((el) => (el as HTMLDetailsElement).open);

/** The card drawn and its list read: what every test below waits for. */
async function advancedReady(page: Page): Promise<void> {
  await rowOf(page, 'nightly-export').waitFor({ timeout: 20_000 });
  await fold(page, 'how').waitFor({ timeout: 20_000 });
}

/**
 * Anything inside an Advanced card that is drawn as a card itself: framed on
 * all four sides on the card's own ground, or raised by a shadow. Controls are
 * left out — a button is boxed by design — and so is what a closed fold hides.
 */
function boxedInside(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const controls =
      'button, input, select, textarea, summary, [role="combobox"], [role="menu"], [role="option"]';
    const found: string[] = [];
    for (const card of document.querySelectorAll('.dev-advanced-page > .dev-card')) {
      const ground = getComputedStyle(card).backgroundColor;
      for (const el of card.querySelectorAll('*')) {
        if (el.matches(controls) || el.closest('button, [role="menu"]') !== null) continue;
        if (!el.checkVisibility()) continue;
        const style = getComputedStyle(el);
        const framed = ['top', 'right', 'bottom', 'left'].every(
          (side) =>
            parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
            style.getPropertyValue(`border-${side}-style`) !== 'none',
        );
        if ((framed && style.backgroundColor === ground) || style.boxShadow !== 'none') {
          found.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
        }
      }
    }
    return found;
  });
}

void describe('Advanced is one flat card, credentials only (LAI-1100 #11, LAI-1327)', () => {
  void test('one card, no activity: nothing inside it drawn as a card, whatever is open', async () => {
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', { '/api/v1/tokens': { data: [SCRIPT, LEGACY, REVOKED], next_cursor: null } }),
    );
    try {
      await advancedReady(h.page);
      const cards = h.page.locator('.dev-advanced-page > .dev-card');
      assert.equal(await cards.count(), 1);
      assert.equal(await cards.locator('h2').first().innerText(), 'Personal credentials');
      assert.equal(await h.page.locator('.dev-sharing, [data-extra="activity"]').count(), 0);
      assert.equal(await h.page.getByText('Share local activity').count(), 0);
      assert.equal(await h.page.locator('.dev-card .dev-card, .dev-card .dx-card').count(), 0);
      assert.deepEqual(await boxedInside(h.page), []);
      await h.page.getByRole('button', { name: 'Show it' }).click();
      await h.page.getByRole('button', { name: 'Show 1 revoked/expired' }).click();
      await fold(h.page, 'how').locator('> summary').click();
      assert.equal(await isOpen(h.page, 'how'), true);
      assert.deepEqual(await boxedInside(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('the full scope chip is neutral, not red, in both themes', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      const chip = rowOf(h.page, 'nightly-export').getByText('full', { exact: true });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const got = await chip.evaluate((el) => {
          const probe = (token: string) => {
            const span = document.createElement('span');
            span.style.color = `var(${token})`;
            document.body.append(span);
            const colour = getComputedStyle(span).color;
            span.remove();
            return colour;
          };
          return {
            colour: getComputedStyle(el).color,
            neutral: probe('--chip-neutral'),
            danger: probe('--overdue'),
            pink: probe('--chip-pink'),
          };
        });
        assert.equal(got.colour, got.neutral, `${theme}: the full chip is not neutral`);
        assert.notEqual(got.colour, got.danger, `${theme}: the full chip is red`);
        assert.notEqual(got.colour, got.pink, `${theme}: the full chip is pink`);
      }
    } finally {
      await h.close();
    }
  });

  void test('How to use a personal credential is its one fold, closed, and opens by click, Enter or Space', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      assert.deepEqual(
        await h.page
          .locator('.dev-advanced-page details')
          .evaluateAll((els) =>
            els.map((el) => [(el as HTMLElement).dataset.fold, (el as HTMLDetailsElement).open]),
          ),
        [['how', false]],
      );
      const how = fold(h.page, 'how');
      await how.locator('> summary').click();
      assert.equal(await isOpen(h.page, 'how'), true);
      const howText = await how.innerText();
      assert.match(howText, /read_only/);
      assert.ok(howText.includes(`export LAIKA_URL=${h.origin}`), howText);
      assert.match(howText, /curl -s -H "Authorization: Bearer \$LAIKA_TOKEN"/);
      await how.locator('> summary').click();
      assert.equal(await isOpen(h.page, 'how'), false);
      await how.locator('> summary').focus();
      await h.page.keyboard.press('Enter');
      assert.equal(await isOpen(h.page, 'how'), true);
      await h.page.keyboard.press('Space');
      assert.equal(await isOpen(h.page, 'how'), false);
    } finally {
      await h.close();
    }
  });

  void test('the fold’s summary is reached by Tab and drawn focused', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      // The last thing before the fold: the callout's toggle.
      await h.page.getByRole('button', { name: 'Show it' }).focus();
      await h.page.keyboard.press('Tab');
      const focused = await h.page.evaluate(() => {
        const el = document.activeElement;
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        if (el === null) return null;
        const style = getComputedStyle(el);
        return {
          fold: el.parentElement?.dataset.fold,
          tag: el.tagName,
          outline: style.outlineStyle,
          colour: style.outlineColor === accent,
        };
      });
      assert.deepEqual(focused, { fold: 'how', tag: 'SUMMARY', outline: 'solid', colour: true });
    } finally {
      await h.close();
    }
  });

  void test('Advanced, 1440 and 390, light and dark: no sideways scroll', async () => {
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', {
        '/api/v1/tokens': { data: [SCRIPT, LEGACY, REVOKED, EXPIRED], next_cursor: null },
      }),
    );
    try {
      await advancedReady(h.page);
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        for (const width of [1440, 390]) {
          await h.page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
          await h.page.waitForTimeout(250);
          const fit = await h.page.evaluate(() => ({
            page: document.documentElement.scrollWidth,
            view: document.documentElement.clientWidth,
          }));
          assert.ok(fit.page <= fit.view, `${theme} ${String(width)}: ${String(fit.page)}px wide`);
          await shoot(h.page, `advanced-${String(width)}-${theme}`);
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the classic Activity tab is untouched by Advanced’s folds (LAI-1100 #11)', () => {
  for (const mode of ['classic', 'preview'] as const) {
    void test(`${mode}: no fold, every part in view, in its old order`, async () => {
      const h = await open('/developer?tab=activity', stub(mode));
      try {
        const panel = h.page.locator('.dev-sharing .share-activity');
        await panel.locator('table.share-table tbody tr').first().waitFor({ timeout: 20_000 });
        assert.equal(await panel.locator('details').count(), 0);
        assert.equal(await panel.getAttribute('data-compact'), null);
        assert.deepEqual(
          await panel.evaluate((el) =>
            [...el.children].map((child) => `${child.tagName}.${[...child.classList].join('.')}`),
          ),
          [
            'P.conn-body',
            'DIV.share-lists',
            'P.conn-note.share-collects',
            'FIELDSET.share-scope',
            'DIV.conn-block',
            'SECTION.share-otel',
            'SECTION.share-held',
          ],
        );
        for (const visible of [
          panel.locator('.share-list[data-list="sent"]'),
          panel.locator('.share-list[data-list="never"]'),
          panel.getByRole('heading', { name: 'OpenTelemetry (optional)' }),
          panel.locator('pre[data-otel]'),
          panel.getByRole('heading', { name: 'What the board holds for you · last 14 days' }),
          panel.getByRole('button', { name: 'Delete my local-activity history' }),
        ]) {
          assert.equal(await visible.isVisible(), true);
        }
        const notice = await panel.locator('[data-state="org-collects"]').innerText();
        assert.match(notice, /^Your organisation collects your local activity: per-day counts/);
        assert.match(notice, /and your own time on My day\./);
      } finally {
        await h.close();
      }
    });
  }
});
