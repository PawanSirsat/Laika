/**
 * Settings → Connect, in a browser (LAI-622, made agent-neutral by LAI-737).
 *
 * The page's job is to take a developer from nothing to a connected session, so
 * what is asserted here is the behaviour a developer would notice: the blocks
 * carry the token only once one exists, the committed block never carries it,
 * hiding it takes it off the page, and copy tells the truth on a board with no
 * clipboard API — which is the board Laika is actually deployed on.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { pick } from './dropdown.ts';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const SECRET = 'lai_ThisIsTheWholeSecretAndMustNotRenderTwice';

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

function stub(over: Partial<ApiStub> = {}): ApiStub {
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [ONROUTE, SKYNET], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/org': {
      id: 'org1',
      name: 'Kvell Dynamics',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    ...over,
  };
}

const MINTED_AT = Date.now();

/** The token row as the server lists it (LAI-736's fields included). */
const tokenRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'claude-code on macOS',
  prefix: SECRET.slice(0, 8),
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: MINTED_AT + 90 * 86_400_000,
  revoked_at: null,
  created_at: MINTED_AT,
  ...over,
});

/**
 * The mint endpoint, answering with the one-time secret — and, once minted,
 * listing that token as `listed` describes it.
 */
function mints(listed: Record<string, unknown> | undefined = undefined): Partial<ApiStub> {
  let minted = false;
  return {
    '/api/v1/tokens': (call: { method?: string }) => {
      if (call.method === 'POST') {
        minted = true;
        return { token: tokenRow(), secret: SECRET };
      }
      return { data: minted && listed !== undefined ? [tokenRow(listed)] : [], next_cursor: null };
    },
  };
}

const MINTS = mints();

/** An agent session of Ada's, as presence lists it. */
const agentSession = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  name: 'Ada Lovelace',
  repo: 'kvelld/onroute',
  branch: 'main',
  matched_task_id: null,
  project_ids: [],
  is_agent: true,
  client: 'claude-code',
  clients: ['claude-code'],
  last_seen: Date.now(),
  ...over,
});

async function mint(h: Awaited<ReturnType<typeof open>>): Promise<void> {
  await h.page.locator('.conn-mint button').click();
  await h.page.locator('.conn-secret-value').waitFor({ timeout: 20_000 });
}

after(async () => {
  await closeBrowser();
});

void describe('before a token exists', () => {
  void test('the page reads, and shows a placeholder rather than a hole', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-prompt').waitFor({ timeout: 20_000 });

      const prompt = await h.page.locator('.conn-prompt').innerText();
      assert.match(prompt, /lai_/, 'no placeholder in the prompt');
      assert.doesNotMatch(prompt, /\bundefined\b/, 'the missing token leaked as a literal');

      const body = await h.page.locator('body').innerText();
      assert.ok(!body.includes(SECRET), 'a secret rendered before anything was minted');
    } finally {
      await h.close();
    }
  });

  void test('the prompt cannot be copied yet, and says why', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-prompt').waitFor({ timeout: 20_000 });
      const copy = h.page.locator('.conn-block').first().locator('.copy-button');
      assert.equal(await copy.isDisabled(), true, 'the prompt offers a copy with no token in it');
      assert.match(
        (await copy.getAttribute('title')) ?? '',
        /mint/i,
        'the disabled button does not say why',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('minting fills the page in', () => {
  void test('every block that needs the token gets it', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);

      assert.equal(await h.page.locator('.conn-secret-value').innerText(), SECRET);
      const prompt = await h.page.locator('.conn-prompt').innerText();
      assert.ok(prompt.includes(SECRET), 'the prompt did not take the token');
      assert.match(prompt, /install\.sh/, 'the prompt lost the installer');

      const posted = h.calls.filter((c) => c.path === '/api/v1/tokens' && c.method === 'POST');
      assert.equal(posted.length, 1, 'minting did not POST exactly once');
      const body = posted[0]?.body as { name?: string; expires_at?: number };
      assert.ok((body.name ?? '') !== '', 'the token was minted unnamed');
      assert.ok(
        typeof body.expires_at === 'number' && body.expires_at > Date.now(),
        'the token was minted without an expiry',
      );
    } finally {
      await h.close();
    }
  });

  void test('CONTROL: the committed block never carries the token', async () => {
    /*
     * The two blocks sit inches apart and are built by the same module. The
     * prompt carries the secret by the owner's decision; this one is pasted
     * into a git repository, where a secret is a leak.
     */
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);
      const block = await h.page.locator('.conn-project-block').innerText();
      assert.ok(!block.includes(SECRET), 'the secret reached the committed block');
      assert.doesNotMatch(block, /lai_/, 'a token shape reached the committed block');
      assert.match(block, /onroute/, 'the block does not name the project');
    } finally {
      await h.close();
    }
  });

  void test('CONTROL: hiding the token takes it off the page entirely', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);
      await h.page.locator('.conn-hide').click();
      await h.page.locator('.conn-forgotten').waitFor({ timeout: 10_000 });

      const body = await h.page.locator('body').innerText();
      assert.ok(!body.includes(SECRET), 'the secret survived being hidden');
      assert.equal(await h.page.locator('.conn-secret-value').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the block follows the project picker', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await h.page.locator('.conn-project-block').waitFor({ timeout: 20_000 });
      await pick(h.page.locator('#conn-project'), 'skynet');
      await h.page.waitForFunction(
        () => (document.querySelector('.conn-project-block')?.textContent ?? '').includes('skynet'),
        undefined,
        { timeout: 10_000 },
      );
      const block = await h.page.locator('.conn-project-block').innerText();
      assert.match(block, /SKY-42/, 'the prefix did not follow the picker');
      assert.doesNotMatch(block, /ONR-42/, 'the old project is still named');
    } finally {
      await h.close();
    }
  });
});

void describe('copy, on a board with no clipboard API', () => {
  void test('CONTROL: it offers a selection instead of claiming success', async () => {
    /*
     * This is the state of the real deployment: plain HTTP on an IP is not a
     * secure context, so `navigator.clipboard` is `undefined`. The button must
     * not say "Copied".
     */
    const h = await open('/connect', stub(MINTS));
    try {
      await h.page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      });
      await h.page.reload();
      await mint(h);

      const copy = h.page.locator('.conn-secret').locator('.copy-button');
      await copy.click();
      await h.page.waitForFunction(
        () => document.querySelector('.copy-button[data-outcome="select"]') !== null,
        undefined,
        { timeout: 10_000 },
      );

      const label = await copy.innerText();
      assert.doesNotMatch(label, /Copied/, 'it claimed a copy that cannot have happened');
      assert.match(label, /⌘C/, 'it did not tell the reader what to do instead');
    } finally {
      await h.close();
    }
  });
});

void describe('the live check', () => {
  void test('CONTROL: my own browser does not satisfy the presence watch', async () => {
    const h = await open(
      '/connect',
      stub({ '/api/v1/presence': { enabled: true, present: [agentSession({ is_agent: false })] } }),
    );
    try {
      await h.page.getByRole('button', { name: 'Watch for my session' }).click();
      await h.page.locator('.conn-live-watching').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.conn-live-ok').count(),
        0,
        'the page congratulated itself',
      );
    } finally {
      await h.close();
    }
  });

  void test('without a token minted here, any agent session of mine turns it green — and it says so', async () => {
    const h = await open(
      '/connect',
      stub({ '/api/v1/presence': { enabled: true, present: [agentSession()] } }),
    );
    try {
      await h.page.getByRole('button', { name: 'Watch for my session' }).click();
      await h.page.locator('.conn-live-ok').waitFor({ timeout: 20_000 });
      const text = await h.page.locator('.conn-live-ok').innerText();
      assert.match(text, /kvelld\/onroute/);
      assert.match(
        text,
        /not necessarily a new one/,
        'the weaker check passes itself off as proof',
      );
    } finally {
      await h.close();
    }
  });

  void test('CONTROL: after a mint, another session of mine does not turn it green (LAI-737)', async () => {
    /*
     * **The false positive this task fixes.** LAI-622's check matched any
     * agent session of the reader's — so an agent already running on an old
     * token reported the brand-new one as connected before it was used.
     */
    const h = await open(
      '/connect',
      stub({ ...mints(), '/api/v1/presence': { enabled: true, present: [agentSession()] } }),
    );
    try {
      await mint(h);
      await h.page.locator('.conn-live-watching').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(6_000);
      assert.equal(
        await h.page.locator('.conn-live-ok').count(),
        0,
        'an old session passed for the new token',
      );
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/presence').length,
        0,
        'with a token minted here, the watch still read presence',
      );
    } finally {
      await h.close();
    }
  });

  void test('the minted token calling /mcp turns it green, names the agent, and the watch stops', async () => {
    const h = await open(
      '/connect?agent=codex',
      stub(
        mints({
          last_mcp_at: MINTED_AT + 5_000,
          last_client: 'codex',
          last_client_name: 'codex-mcp-client',
        }),
      ),
    );
    try {
      await mint(h);
      await h.page.locator('.conn-live-ok').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.conn-live-ok').innerText(),
        /Connected — Codex \(codex-mcp-client\)/,
      );

      const listed = () =>
        h.calls.filter((c) => c.path === '/api/v1/tokens' && c.method !== 'POST').length;
      const asked = listed();
      await h.page.waitForTimeout(6_000);
      assert.equal(listed(), asked, 'the watch kept polling after it succeeded');
    } finally {
      await h.close();
    }
  });

  void test('with presence off, the minted token still proves itself by its use (LAI-736 round 1)', async () => {
    /*
     * The server stops stamping `last_mcp_at` while the org has presence off.
     * The token's `last_used_at` still moves, and the page must read it,
     * or a working agent spins for three minutes and is reported broken.
     */
    const h = await open(
      '/connect?agent=omnigent',
      stub({
        ...mints({ last_used_at: MINTED_AT + 5_000 }),
        '/api/v1/org': {
          id: 'org1',
          name: 'Kvell Dynamics',
          presence_enabled: false,
          created_at: 1,
          updated_at: 1,
        },
      }),
    );
    try {
      await mint(h);
      await h.page.locator('.conn-live-ok').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.conn-live-ok').innerText(), /Connected — Omnigent/);
      assert.match(
        await h.page.locator('.conn-live-ok').innerText(),
        /weaker/,
        'the page does not say it used the weaker signal',
      );
    } finally {
      await h.close();
    }
  });

  void test('CONTROL: with presence on, a bare use of the minted token is not an MCP connection', async () => {
    const h = await open(
      '/connect?agent=omnigent',
      stub(mints({ last_used_at: MINTED_AT + 5_000 })),
    );
    try {
      await mint(h);
      await h.page.locator('.conn-live-watching').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(6_000);
      assert.equal(await h.page.locator('.conn-live-ok').count(), 0, 'a curl passed for the agent');
    } finally {
      await h.close();
    }
  });

  void test('presence switched off is said, not guessed at', async () => {
    const h = await open('/connect', stub({ '/api/v1/presence': { enabled: false, present: [] } }));
    try {
      await h.page.getByRole('button', { name: 'Watch for my session' }).click();
      await h.page.locator('.conn-live-disabled').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.conn-live-spent').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the agent picker (LAI-737)', () => {
  const radios = (h: Awaited<ReturnType<typeof open>>) =>
    h.page.getByRole('radiogroup', { name: 'Your coding agent' }).getByRole('radio');

  void test('it is one labelled radio group, Claude Code first and chosen by default', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      const first = radios(h).first();
      assert.equal(await first.getAttribute('value'), 'claude-code');
      assert.equal(await first.isChecked(), true);
      // The tile's accessible name is the product's name, not its monogram.
      assert.equal(await h.page.getByRole('radio', { name: 'Codex', exact: true }).count(), 1);
      assert.match(await h.page.locator('.conn-steps').innerText(), /Add Laika to Claude Code/);
    } finally {
      await h.close();
    }
  });

  void test('More reveals the rest, and they are radios of the same group', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.getByRole('radio', { name: 'Kiro', exact: true }).count(),
        0,
        'Kiro is not under More',
      );
      const more = h.page.locator('.conn-more');
      assert.equal(await more.getAttribute('aria-expanded'), 'false');
      await more.click();
      assert.equal(await more.getAttribute('aria-expanded'), 'true');
      await h.page.getByRole('radio', { name: 'Kiro', exact: true }).check();
      assert.match(await h.page.locator('.conn-steps').innerText(), /Add Laika to Kiro/);
      assert.match(await h.page.locator('.conn-steps').innerText(), /--allow-http/);
    } finally {
      await h.close();
    }
  });

  void test('the keyboard moves the choice, and the URL and token name follow', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      await radios(h).first().focus();
      await h.page.keyboard.press('ArrowRight');
      await h.page.waitForFunction(
        () => window.location.search.includes('agent=codex'),
        undefined,
        {
          timeout: 10_000,
        },
      );
      assert.equal(
        await h.page.getByRole('radio', { name: 'Codex', exact: true }).isChecked(),
        true,
      );
      assert.match(await h.page.locator('#conn-token-name').inputValue(), /^codex( on |$)/);
      assert.match(
        await h.page.locator('.conn-steps').innerText(),
        /bearer_token_env_var = "LAIKA_TOKEN"/,
      );
    } finally {
      await h.close();
    }
  });

  void test('?agent= opens the page on that agent, and the choice is remembered', async () => {
    const h = await open('/connect?agent=gemini-cli', stub());
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.getByRole('radio', { name: 'Gemini CLI', exact: true }).isChecked(),
        true,
      );
      assert.match(await h.page.locator('.conn-project-block').innerText(), /Laika/);
      assert.match(await h.page.locator('.conn-extra').first().innerText(), /GEMINI\.md/);

      await h.page.goto(`${h.origin}/connect`);
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.getByRole('radio', { name: 'Gemini CLI', exact: true }).isChecked(),
        true,
        'the choice was not remembered without the URL',
      );
    } finally {
      await h.close();
    }
  });

  void test('the minted token is named after the agent', async () => {
    const h = await open('/connect?agent=omnigent', stub(MINTS));
    try {
      await mint(h);
      const posted = h.calls.find((c) => c.path === '/api/v1/tokens' && c.method === 'POST');
      assert.match((posted?.body as { name?: string }).name ?? '', /^omnigent( on |$)/);
    } finally {
      await h.close();
    }
  });

  void test('CONTROL: after a mint, the token appears only in blocks that say they carry it', async () => {
    const h = await open('/connect?agent=cursor', stub(MINTS));
    try {
      await mint(h);
      const setups = h.page.locator('.conn-setup');
      const count = await setups.count();
      assert.ok(count >= 3, `only ${String(count)} setup blocks rendered`);
      for (let i = 0; i < count; i += 1) {
        const one = setups.nth(i);
        const kind = await one.getAttribute('data-token');
        const text = await one.locator('pre').innerText();
        if (kind === 'none')
          assert.ok(!text.includes(SECRET), `a tokenless block carries it: ${text}`);
        else assert.match(await one.innerText(), /carries your token/);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('review round 1', () => {
  void test('an unknown ?agent= is dropped from the URL, and Claude Code is shown', async () => {
    const h = await open('/connect?agent=teleporter', stub());
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(() => !window.location.search.includes('agent='), undefined, {
        timeout: 10_000,
      });
      assert.equal(
        await h.page.getByRole('radio', { name: 'Claude Code', exact: true }).isChecked(),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('the chosen agent stays in view when More is collapsed', async () => {
    const h = await open('/connect?agent=kiro', stub());
    try {
      const kiro = h.page.getByRole('radio', { name: 'Kiro', exact: true });
      await kiro.waitFor({ state: 'attached', timeout: 20_000 });
      await h.page.locator('.conn-more').click();
      assert.equal(await h.page.locator('.conn-more').getAttribute('aria-expanded'), 'false');
      assert.equal(await kiro.isVisible(), true, 'collapsing More hid the selected agent');
      assert.equal(await kiro.isChecked(), true);
    } finally {
      await h.close();
    }
  });

  void test('file paths are shown as typed, not upper-cased', async () => {
    const h = await open('/connect?agent=codex', stub());
    try {
      const label = h.page.locator('.conn-setup .conn-block-label').first();
      await label.waitFor({ timeout: 20_000 });
      assert.equal(await label.evaluate((el) => getComputedStyle(el).textTransform), 'none');
    } finally {
      await h.close();
    }
  });

  void test('Claude Desktop is told to paste the block into its UI, not to commit a file', async () => {
    const h = await open('/connect?agent=claude-desktop', stub());
    try {
      const lead = h.page.locator('.conn-extra').first();
      await lead.locator('.conn-project-block').waitFor({ timeout: 20_000 });
      const text = await lead.innerText();
      assert.doesNotMatch(text, /Commit this/);
      assert.match(text, /Project instructions/);
    } finally {
      await h.close();
    }
  });
});

void describe('the page as a stepper (LAI-733)', () => {
  void test('the header spans the content area, not the centred column', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 1366, height: 900 });
      await h.page.locator('.conn-prompt').waitFor({ timeout: 20_000 });
      const widths = await h.page.evaluate(() => ({
        bar: document.querySelector('.connect .screen-bar')?.getBoundingClientRect().width ?? 0,
        main: document.querySelector('.shell-main')?.clientWidth ?? -1,
        page: document.querySelector('.conn-page')?.getBoundingClientRect().width ?? 0,
      }));
      assert.ok(Math.abs(widths.bar - widths.main) <= 1, `header ${String(widths.bar)}px wide`);
      assert.ok(
        widths.page < widths.main,
        'the content fills the full width instead of a centred column',
      );
    } finally {
      await h.close();
    }
  });

  void test('minting ticks step 1 and moves "up next" to step 2', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      const steps = h.page.locator('.conn-steps > .conn-step');
      await h.page.locator('.conn-prompt').waitFor({ timeout: 20_000 });
      assert.equal(await steps.count(), 4);
      assert.equal(await steps.nth(0).getAttribute('aria-current'), 'step');
      assert.equal(await steps.nth(1).getAttribute('aria-current'), null);
      assert.match(await steps.nth(0).locator('.conn-step-n').innerText(), /^1$/);

      await mint(h);
      assert.equal(await steps.nth(0).getAttribute('data-state'), 'done');
      assert.match(await steps.nth(0).locator('.conn-step-n').innerText(), /✓/);
      assert.match(await steps.nth(0).locator('.conn-step-state').innerText(), /Done/);
      assert.equal(await steps.nth(1).getAttribute('aria-current'), 'step');
      // Steps 2 and 3 happen where the page cannot see; nothing ticks them.
      assert.equal(await steps.nth(2).getAttribute('data-state'), 'todo');

      // Hiding the token does not un-mint it.
      await h.page.locator('.conn-hide').click();
      await h.page.locator('.conn-forgotten').waitFor({ timeout: 10_000 });
      assert.equal(await steps.nth(0).getAttribute('data-state'), 'done');
    } finally {
      await h.close();
    }
  });

  void test('every copy button names what it copies', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);
      for (const name of [
        'Copy the board URL',
        'Copy the token',
        'Copy the setup prompt',
        'Copy the install commands',
        'Copy the laika-claude command',
        'Copy the CLAUDE.md block',
      ]) {
        assert.equal(
          await h.page.getByRole('button', { name, exact: true }).count(),
          1,
          `no button named "${name}"`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('copying the prompt confirms it, and copies the prompt with the token', async () => {
    const h = await open('/connect', stub(MINTS), {
      before: async (page) => {
        await page.addInitScript(() => {
          const copied: string[] = [];
          Object.defineProperty(window, '__copied', { value: copied });
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: (text: string) => {
                copied.push(text);
                return Promise.resolve();
              },
            },
          });
        });
      },
    });
    try {
      await mint(h);
      const copy = h.page.getByRole('button', { name: 'Copy the setup prompt', exact: true });
      await copy.click();
      const done = h.page.getByRole('button', { name: 'Copied the setup prompt', exact: true });
      await done.waitFor({ timeout: 10_000 });
      assert.equal(await done.getAttribute('data-outcome'), 'copied');
      assert.match(await done.innerText(), /Copied ✓/);

      const copied = await h.page.evaluate(
        () => (window as unknown as { __copied: string[] }).__copied,
      );
      assert.equal(copied.length, 1);
      assert.equal(copied[0], await h.page.locator('.conn-prompt').innerText());
      assert.ok(copied[0]?.includes(SECRET), 'the copied prompt lost the token');
    } finally {
      await h.close();
    }
  });
});
