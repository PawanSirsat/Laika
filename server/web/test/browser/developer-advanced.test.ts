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
 * - Advanced is two flat cards, nothing drawn as a card inside either; the
 *   `full` chip is neutral; what explains them is in closed folds that open
 *   by click or key, and *See what the board holds for you* opens its own
 *   (LAI-1100 #11). Classic and preview's Activity tab draw none of that.
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
      assert.equal(
        await h.page.locator('.dev-adv-legacy-note').innerText(),
        'One of these is used by a coding tool. It keeps working; Upgrade connection on its row moves it to Tools. Nothing is revoked for you.',
      );
    } finally {
      await h.close();
    }
  });

  void test('the note is one line, and counts two legacy tokens as two (LAI-1100 #11)', async () => {
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
      const note = h.page.locator('.dev-adv-legacy-note');
      await note.waitFor({ timeout: 20_000 });
      assert.equal(
        await note.innerText(),
        '2 of these are used by coding tools. They keep working; Upgrade connection on each row moves that one to Tools. Nothing is revoked for you.',
      );
      assert.equal(await note.getAttribute('data-legacy-count'), '2');
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
        '/developer?tab=tools&add=tool&tool=claude-code',
      );
      await link.click();
      await until(() => here(h.page.url()).startsWith('/developer?tab=tools'), 10_000);
      assert.equal(here(h.page.url()), '/developer?tab=tools&add=tool&tool=claude-code');
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
      // The lists are folded in v3 (LAI-1100 #11); the status line is not.
      await h.page.locator('.dev-sharing [data-state="org-collects"]').waitFor({ timeout: 20_000 });
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

  void test('v3: an Activity address lands on Advanced’s second card, its title focused (LAI-1078)', async () => {
    const h = await open('/developer?tab=activity', stub('v3'));
    try {
      await h.page.locator('#activity #dev-sharing-title').waitFor({ timeout: 20_000 });
      assert.equal(new URL(h.page.url()).search, '?tab=advanced&section=activity');
      // The title is in view, not under the fold of a closed `<details>`.
      assert.equal(await h.page.locator('#dev-sharing-title').isVisible(), true);
      assert.equal(await h.page.locator('.page-tab-active').getAttribute('data-tab'), 'advanced');
      // Personal credentials first, then Share local activity — one tab, two cards.
      const order = await h.page.evaluate(() =>
        [...document.querySelectorAll('.dev-advanced-page > *')].map((el) =>
          el.classList.contains('dev-sharing')
            ? 'activity'
            : el.classList.contains('dev-advanced')
              ? 'credentials'
              : el.className,
        ),
      );
      assert.deepEqual(order, ['credentials', 'activity']);
      await h.page.waitForFunction(
        () => document.activeElement?.id === 'dev-sharing-title',
        undefined,
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('v3: Advanced on its own leaves focus where it was', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await h.page.locator('#activity #dev-sharing-title').waitFor({ timeout: 20_000 });
      await h.page.locator('.dev-adv-row, .dev-advanced .state-empty').first().waitFor({
        timeout: 20_000,
      });
      assert.notEqual(await h.page.evaluate(() => document.activeElement?.id), 'dev-sharing-title');
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
      // In its fold since LAI-1100 #11: open it first.
      await h.page.locator('[data-fold="held"] > summary').click({ timeout: 20_000 });
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

/**
 * Advanced, simplified (LAI-1100 #11): *"Too many options … force heavy
 * scrolling; reduce them."* Two flat cards; the list, the button, the scope
 * choice and the command stay in view; everything that explains them is a
 * closed `<details>`.
 */
const FOLDS = [
  { id: 'how', title: 'How to use a personal credential', inside: '.tok-ref-list' },
  { id: 'sent', title: 'What is sent and never sent', inside: '.share-list[data-list="never"]' },
  { id: 'otel', title: 'OpenTelemetry (optional)', inside: 'pre[data-otel]' },
  { id: 'held', title: 'What the board holds for you', inside: 'table.share-table' },
] as const;

const fold = (page: Page, id: string) => page.locator(`.dev-advanced-page [data-fold="${id}"]`);
const isOpen = (page: Page, id: string) =>
  fold(page, id).evaluate((el) => (el as HTMLDetailsElement).open);

/** Both cards drawn, the activity card read: what every test below waits for. */
async function advancedReady(page: Page): Promise<void> {
  await rowOf(page, 'nightly-export').waitFor({ timeout: 20_000 });
  await fold(page, 'held').waitFor({ timeout: 20_000 });
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

void describe('Advanced is two flat sections, its extras folded (LAI-1100 #11)', () => {
  void test('two cards, one after the other: none inside another, and nothing inside drawn as one', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      const cards = h.page.locator('.dev-advanced-page > .dev-card');
      assert.equal(await cards.count(), 2);
      assert.deepEqual(
        await cards.evaluateAll((els) =>
          els.map((el) => el.querySelector('h2')?.textContent?.trim() ?? ''),
        ),
        ['Personal credentials', 'Share local activity'],
      );
      assert.equal(await h.page.locator('.dev-card .dev-card, .dev-card .dx-card').count(), 0);
      // The old scope reference and CLI cards are gone, not hidden.
      assert.equal(await h.page.locator('.dev-advanced-page .tok-ref, .tok-cli').count(), 0);
      assert.equal(await h.page.getByText('Scope reference').count(), 0);
      assert.deepEqual(await boxedInside(h.page), []);
      // And with every fold open, nothing inside them is a card either.
      for (const { id } of FOLDS) await fold(h.page, id).locator('> summary').click();
      for (const { id } of FOLDS) assert.equal(await isOpen(h.page, id), true, id);
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

  void test('the extras are closed folds with a line each; the list, scope and command are in view', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      assert.deepEqual(
        await h.page
          .locator('.dev-advanced-page details')
          .evaluateAll((els) =>
            els.map((el) => [(el as HTMLElement).dataset.fold, (el as HTMLDetailsElement).open]),
          ),
        FOLDS.map(({ id }) => [id, false]),
      );
      for (const { id, title, inside } of FOLDS) {
        const summary = fold(h.page, id).locator('> summary');
        assert.equal(await summary.isVisible(), true, id);
        assert.equal(await summary.locator('.dev-fold-title').innerText(), title);
        assert.equal(await fold(h.page, id).locator(inside).isVisible(), false, `${id} is open`);
      }
      assert.equal(
        await fold(h.page, 'sent').locator('.dev-fold-sub').innerText(),
        'Daily counts only — never prompt text, file names, paths or commit messages',
      );
      // What stays out: one intro line, the button, the rows, the status, the
      // scope choice and the command with its Copy.
      assert.equal(
        await h.page.locator('.dev-advanced-intro').innerText(),
        'For scripts, the REST API and automation. It acts as you; coding tools get their own on Tools.',
      );
      for (const visible of [
        h.page.getByRole('button', { name: '+ New personal credential' }),
        rowOf(h.page, 'old-laptop'),
        h.page.locator('.dev-sharing [data-state="org-collects"]'),
        h.page.locator('.dev-sharing input[name="share-scope"][value="laika-repos"]'),
        h.page.locator('.dev-sharing pre[aria-labelledby="share-command-label"]'),
        h.page
          .locator('.dev-sharing .conn-block', { has: h.page.locator('#share-command-label') })
          .locator('.copy-button'),
      ]) {
        assert.equal(await visible.isVisible(), true);
      }
      assert.match(
        await h.page.locator('.dev-sharing [data-state="org-collects"]').innerText(),
        /^Your organisation collects your local activity\. The owner and anyone they grant access can see it, and you can see who looked\. See what the board holds for you\.$/,
      );
    } finally {
      await h.close();
    }
  });

  void test('an owner’s status line also says where to turn it off', async () => {
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', { '/api/v1/me': { ...ME, org_role: 'owner' } }),
    );
    try {
      const status = h.page.locator('.dev-sharing [data-state="org-collects"]');
      await status.waitFor({ timeout: 20_000 });
      await until(
        async () => (await status.locator('a[href="/organisation?tab=overview"]').count()) === 1,
      );
      assert.match(
        await status.innerText(),
        /See what the board holds for you\. You can turn it off in Organisation\.$/,
      );
      assert.equal(await status.locator('a[href="/organisation?tab=overview"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('each fold opens by click, Enter or Space, shows what it holds, and closes', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      const how = fold(h.page, 'how');
      await how.locator('> summary').click();
      assert.equal(await isOpen(h.page, 'how'), true);
      const howText = await how.innerText();
      assert.match(howText, /read_only/);
      assert.ok(howText.includes(`export LAIKA_URL=${h.origin}`), howText);
      assert.match(howText, /curl -s -H "Authorization: Bearer \$LAIKA_TOKEN"/);

      await fold(h.page, 'sent').locator('> summary').focus();
      await h.page.keyboard.press('Enter');
      assert.equal(await isOpen(h.page, 'sent'), true);
      assert.match(
        await fold(h.page, 'sent').innerText(),
        /Prompt text, or anything an agent wrote/,
      );

      await fold(h.page, 'otel').locator('> summary').focus();
      await h.page.keyboard.press('Space');
      assert.equal(await isOpen(h.page, 'otel'), true);
      assert.equal(await fold(h.page, 'otel').locator('pre[data-otel]').isVisible(), true);
      assert.equal(await fold(h.page, 'otel').locator('.copy-button').isVisible(), true);

      await fold(h.page, 'held').locator('> summary').click();
      assert.equal(await fold(h.page, 'held').locator('table.share-table').isVisible(), true);
      assert.equal(
        await h.page.getByRole('button', { name: 'Delete my local-activity history' }).isVisible(),
        true,
      );

      await how.locator('> summary').click();
      assert.equal(await isOpen(h.page, 'how'), false);
      assert.equal(await how.locator('.tok-ref-list').isVisible(), false);
    } finally {
      await h.close();
    }
  });

  void test('a fold’s summary is reached by Tab and drawn focused', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'));
    try {
      await advancedReady(h.page);
      // The last thing before the fold: the legacy row's Upgrade connection.
      await h.page.getByRole('link', { name: 'Upgrade connection for old-laptop' }).focus();
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

  void test('See what the board holds for you opens its fold and goes to it', async () => {
    const h = await open('/developer?tab=advanced', stub('v3'), {
      before: (page) => page.setViewportSize({ width: 1280, height: 600 }),
    });
    try {
      await advancedReady(h.page);
      const link = h.page.locator('.dev-sharing [data-state="org-collects"] a[href="#share-held"]');
      assert.equal(await isOpen(h.page, 'held'), false);
      await link.click();
      await until(() => isOpen(h.page, 'held'));
      assert.equal(await isOpen(h.page, 'held'), true);
      assert.equal(await fold(h.page, 'held').getAttribute('id'), 'share-held');
      assert.equal(await fold(h.page, 'held').locator('table.share-table').isVisible(), true);
      const where = await fold(h.page, 'held')
        .locator('> summary')
        .evaluate((el) => ({
          focused: el === document.activeElement,
          inView: el.getBoundingClientRect().top >= 0,
          above: el.getBoundingClientRect().bottom <= window.innerHeight,
        }));
      assert.deepEqual(where, { focused: true, inView: true, above: true });
    } finally {
      await h.close();
    }
  });

  void test('an Activity address scrolls the card into view as well as focusing it', async () => {
    const h = await open('/developer?tab=activity', stub('v3'), {
      before: (page) => page.setViewportSize({ width: 1280, height: 600 }),
    });
    try {
      await h.page.waitForFunction(
        () => document.activeElement?.id === 'dev-sharing-title',
        undefined,
        { timeout: 20_000 },
      );
      await h.page.waitForTimeout(200);
      const box = await h.page
        .locator('#dev-sharing-title')
        .evaluate((el) => [el.getBoundingClientRect().top, window.innerHeight] as const);
      assert.ok(box[0] >= 0 && box[0] < box[1] - 40, `the title is at ${String(box[0])}px`);
    } finally {
      await h.close();
    }
  });

  void test('with insights off: says so, offers no command, folds what is sent and what is held', async () => {
    const h = await open(
      '/developer?tab=advanced',
      stub('v3', {
        '/api/v1/me/activity-sharing': {
          org_enabled: false,
          enabled: false,
          person_can_opt_out: false,
          scope: 'agent-repos',
          min_sync_interval_s: 600,
        },
      }),
    );
    try {
      await h.page.locator('.dev-sharing [data-state="org-off"]').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.dev-sharing [data-state="org-off"]').innerText(),
        /Developer insights are off for this organisation/,
      );
      assert.equal(await h.page.locator('.dev-sharing input[name="share-scope"]').count(), 0);
      assert.equal(await h.page.locator('#share-command-label').count(), 0);
      assert.deepEqual(
        await h.page
          .locator('.dev-sharing details')
          .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.fold)),
        ['sent', 'held'],
      );
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark']) {
    void test(`${theme}, 390px, every fold open: nothing scrolls sideways, and ⋯ sits by its name`, async () => {
      const h = await open('/developer?tab=advanced', stub('v3'));
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        await advancedReady(h.page);
        for (const { id } of FOLDS) await fold(h.page, id).locator('> summary').click();
        const fits = await h.page.evaluate(() => ({
          page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          cards: [...document.querySelectorAll('.dev-advanced-page > .dev-card')].map(
            (card) =>
              card.scrollWidth <= card.clientWidth &&
              card.getBoundingClientRect().right <= document.documentElement.clientWidth,
          ),
        }));
        assert.deepEqual(fits, { page: true, cards: [true, true] });
        const row = rowOf(h.page, 'nightly-export');
        const name = await row.locator('.tok-name').boundingBox();
        const more = await row
          .getByRole('button', { name: 'More actions for nightly-export' })
          .boundingBox();
        assert.ok(name !== null && more !== null);
        assert.ok(
          more.y < name.y + name.height && more.y + more.height > name.y,
          `⋯ at ${String(more.y)}px is not on the name’s line at ${String(name.y)}px`,
        );
      } finally {
        await h.close();
      }
    });
  }
});

/**
 * The classic and preview Activity tab is the same `ShareActivity`, without
 * `compact` — and must stay exactly as it was: every part in view, no fold,
 * in its old order.
 */
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
