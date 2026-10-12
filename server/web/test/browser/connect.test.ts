/**
 * Settings → Connect, in a browser (LAI-622, made agent-neutral by LAI-737).
 *
 * The page's job is to take a developer from nothing to a connected session, so
 * what is asserted here is the behaviour a developer would notice: the blocks
 * carry the token only once one exists, the committed block never carries it,
 * hiding it takes it off the page, and copy tells the truth on a board with no
 * clipboard API — which is the board Laika is actually deployed on.
 *
 * Laid out as a four-step wizard since LAI-740, so a test reaches a step the
 * way a person does — by the rail, or by Continue — before asserting what is
 * on it. The assertions about *content* are LAI-622's and LAI-737's,
 * unchanged.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { pick } from './dropdown.ts';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';
import { setupBlocks } from '../../src/routes/screens/connect/connect-agents.ts';

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

type H = Awaited<ReturnType<typeof open>>;

/** Go to a step by its rail button, and wait for its card (LAI-740). */
async function goTo(h: H, n: 1 | 2 | 3 | 4): Promise<void> {
  await h.page
    .locator('.conn-rail-step')
    .nth(n - 1)
    .click();
  await h.page.locator(`.conn-wizard-card[data-step="${String(n)}"]`).waitFor({ timeout: 20_000 });
}

async function mint(h: H): Promise<void> {
  await goTo(h, 2);
  await h.page.locator('.conn-mint button').click();
  await h.page.locator('.conn-secret-value').waitFor({ timeout: 20_000 });
}

/**
 * The reader who brought a token from Tokens: steps 3 and 4 open without a
 * mint, and the blocks show the placeholder — the page LAI-622 showed before
 * anything was minted.
 */
async function bring(h: H): Promise<void> {
  await goTo(h, 2);
  await h.page.getByRole('button', { name: 'Use a token I already have' }).click();
}

/** Open one of the rail's optional entries in the card (LAI-741). */
async function openExtra(h: H, name: string): Promise<void> {
  await h.page.locator('.conn-rail-extra', { hasText: name }).click();
  await h.page.locator('.conn-wizard-card[data-extra]').waitFor({ timeout: 20_000 });
}

/** The setup prompt exactly as `connect-agents.ts` builds it for this page. */
function promptText(origin: string, secret: string | undefined): string {
  const block = setupBlocks('claude-code', {
    origin,
    secret,
    project: { slug: ONROUTE.slug, prefix: ONROUTE.prefix, name: ONROUTE.name },
  }).find((b) => b.key === 'claude-prompt');
  assert.ok(block !== undefined, 'no claude-prompt block');
  return block.text;
}

/** Open step 3's *Other ways*, if this agent has any, so every block is in view. */
async function everyBlock(h: H): Promise<void> {
  const other = h.page.locator('details.conn-alt', { hasText: 'Other ways' });
  if ((await other.count()) === 0) return;
  if ((await other.getAttribute('open')) === null) await other.locator('summary').click();
}

after(async () => {
  await closeBrowser();
});

void describe('before a token exists', () => {
  void test('the page reads, and shows a placeholder rather than a hole', async () => {
    const h = await open('/connect', stub());
    try {
      await bring(h);
      await goTo(h, 3);
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
      await bring(h);
      await goTo(h, 3);
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
      await goTo(h, 3);
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
      await openExtra(h, 'Share with your project');
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
      await openExtra(h, 'Share with your project');
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
      await bring(h);
      await goTo(h, 4);
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
      await bring(h);
      await goTo(h, 4);
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
      await goTo(h, 4);
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
      await goTo(h, 4);
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
      await goTo(h, 4);
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

  void test('No MCP: a REST call on the minted token is the proof, said plainly (re-review)', async () => {
    const h = await open('/connect?agent=rest', stub(mints({ last_used_at: MINTED_AT + 5_000 })));
    try {
      await mint(h);
      await goTo(h, 4);
      await h.page.locator('.conn-live-ok').waitFor({ timeout: 20_000 });
      const text = await h.page.locator('.conn-live-ok').innerText();
      assert.match(text, /That is the token you minted here, calling this board\./);
      assert.doesNotMatch(text, /presence/i, 'presence blamed in an org that has it on');
    } finally {
      await h.close();
    }
  });

  void test('a recorded client with presence on is weaker, and does not blame presence (re-review)', async () => {
    const h = await open(
      '/connect?agent=codex',
      stub(mints({ last_client: 'codex', last_client_name: 'codex-mcp-client' })),
    );
    try {
      await mint(h);
      await goTo(h, 4);
      await h.page.locator('.conn-live-ok').waitFor({ timeout: 20_000 });
      const text = await h.page.locator('.conn-live-ok').innerText();
      assert.match(text, /weaker/);
      assert.doesNotMatch(text, /presence off/i);
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
      await goTo(h, 4);
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
      await bring(h);
      await goTo(h, 4);
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

  void test('every agent is a radio of the one group, and search narrows it (LAI-740)', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      // No More button any more: all of them are there, under headings.
      assert.equal(await radios(h).count(), 21);
      await h.page.getByRole('searchbox', { name: 'Search agents' }).fill('kiro');
      assert.equal(await radios(h).count(), 1);
      await h.page.getByRole('radio', { name: 'Kiro', exact: true }).check();
      assert.match(await h.page.locator('.conn-steps').innerText(), /Add Laika to Kiro/);
      await bring(h);
      await goTo(h, 3);
      assert.match(await h.page.locator('.conn-wizard-card').innerText(), /--allow-http/);
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
      await goTo(h, 2);
      assert.match(await h.page.locator('#conn-token-name').inputValue(), /^codex( on |$)/);
      await bring(h);
      await goTo(h, 3);
      await h.page.getByRole('button', { name: 'By hand', exact: true }).click();
      assert.match(
        await h.page.locator('.conn-wizard-card').innerText(),
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
      await openExtra(h, 'Share with your project');
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
      await goTo(h, 3);
      let seen = 0;
      // Both ways of adding it, each with the other ways open beneath (LAI-740).
      for (const way of ['Automatic', 'By hand']) {
        await h.page.getByRole('button', { name: way, exact: true }).click();
        await everyBlock(h);
        const setups = h.page.locator('.conn-setup');
        const count = await setups.count();
        seen += count;
        for (let i = 0; i < count; i += 1) {
          const one = setups.nth(i);
          const kind = await one.getAttribute('data-token');
          const text = await one.locator('pre').innerText();
          if (kind === 'none')
            assert.ok(!text.includes(SECRET), `a tokenless block carries it: ${text}`);
          else assert.match(await one.innerText(), /carries your token/);
        }
      }
      assert.ok(seen >= 3, `only ${String(seen)} setup blocks rendered`);
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

  void test('a search that hides the chosen agent does not change the choice (LAI-740)', async () => {
    const h = await open('/connect?agent=kiro', stub());
    try {
      const kiro = h.page.getByRole('radio', { name: 'Kiro', exact: true });
      await kiro.waitFor({ state: 'attached', timeout: 20_000 });
      await h.page.getByRole('searchbox', { name: 'Search agents' }).fill('codex');
      assert.equal(await kiro.count(), 0);
      assert.match(await h.page.locator('.conn-steps').innerText(), /Add Laika to Kiro/);
      await h.page.getByRole('searchbox', { name: 'Search agents' }).fill('');
      assert.equal(await kiro.isChecked(), true);
    } finally {
      await h.close();
    }
  });

  void test('file paths are shown as typed, not upper-cased', async () => {
    const h = await open('/connect?agent=codex', stub());
    try {
      await bring(h);
      await goTo(h, 3);
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
      await openExtra(h, 'Share with your project');
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

void describe('the page as a stepper (LAI-733, a wizard since LAI-740)', () => {
  void test('the header spans the content area, not the centred column', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 1366, height: 900 });
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
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

  void test('minting ticks the mint step, and hiding the token does not un-tick it', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      const steps = h.page.locator('.conn-steps > .conn-step');
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      assert.equal(await steps.count(), 4);
      assert.equal(await steps.nth(0).locator('button').getAttribute('aria-current'), 'step');
      assert.match(await steps.nth(1).locator('.conn-step-n').innerText(), /^2$/);

      await mint(h);
      assert.match(await steps.nth(1).locator('.conn-step-n').innerText(), /✓/);
      assert.equal(await steps.nth(1).locator('button').getAttribute('aria-current'), 'step');
      assert.match(await steps.nth(1).locator('.conn-rail-sub').innerText(), /claude-code/);
      // Step 3 happens on the reader's machine; minting does not tick it.
      assert.equal(await steps.nth(2).getAttribute('data-state'), 'todo');

      await h.page.locator('.conn-hide').click();
      await h.page.locator('.conn-forgotten').waitFor({ timeout: 10_000 });
      assert.match(await steps.nth(1).locator('.conn-step-n').innerText(), /✓/);
      assert.equal(await steps.nth(2).locator('button').isDisabled(), false);
    } finally {
      await h.close();
    }
  });

  void test('every copy button names what it copies', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);
      // Each where it now lives (LAI-740): the header on every step, the token
      // on step 2, the setup on step 3, the start on 4 — and the lead's block
      // behind *Share with your project* since LAI-741.
      await openExtra(h, 'Share with your project');
      assert.equal(
        await h.page.getByRole('button', { name: 'Copy the CLAUDE.md block', exact: true }).count(),
        1,
        'no button named "Copy the CLAUDE.md block"',
      );
      const where: readonly [1 | 2 | 3 | 4, string, string?][] = [
        [2, 'Copy the board URL'],
        [2, 'Copy the token'],
        [3, 'Copy the setup prompt', 'Automatic'],
        [3, 'Copy the install commands', 'By hand'],
        [4, 'Copy the laika-claude command'],
      ];
      for (const [n, name, way] of where) {
        await goTo(h, n);
        if (way !== undefined) await h.page.getByRole('button', { name: way, exact: true }).click();
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
      await goTo(h, 3);
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

void describe('the wizard (LAI-740)', () => {
  void test('Continue and Back walk the steps, and focus lands on the new step', async () => {
    const h = await open('/connect?agent=codex', stub(MINTS));
    try {
      const card = h.page.locator('.conn-wizard-card');
      await card.waitFor({ timeout: 20_000 });
      assert.equal(await card.getAttribute('data-step'), '1');
      assert.match(await h.page.locator('.conn-eyebrow').innerText(), /step 1 of 4/i);
      assert.equal(await h.page.locator('.conn-back').isDisabled(), true);
      assert.match(await h.page.locator('.conn-foot-hint').innerText(), /Continue with Codex/);

      await h.page.locator('.conn-continue').click();
      assert.equal(await card.getAttribute('data-step'), '2');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.id),
        'conn-step-title',
        'focus stayed on a button that may no longer mean anything',
      );
      assert.equal(await h.page.locator('#conn-step-title').innerText(), 'Mint a token');

      await h.page.locator('.conn-back').click();
      assert.equal(await card.getAttribute('data-step'), '1');
    } finally {
      await h.close();
    }
  });

  void test('CONTROL: steps 3 and 4 stay locked until a token is minted', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      const rail = h.page.locator('.conn-rail-step');
      await rail.first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await Promise.all([0, 1, 2, 3].map((i) => rail.nth(i).isDisabled())), [
        false,
        false,
        true,
        true,
      ]);

      await goTo(h, 2);
      const next = h.page.locator('.conn-continue');
      assert.equal(await next.isDisabled(), true, 'Continue went past an unminted token');
      assert.match(await h.page.locator('.conn-foot-hint').innerText(), /Mint a token to continue/);

      await h.page.locator('.conn-mint button').click();
      await h.page.locator('.conn-secret-value').waitFor({ timeout: 20_000 });
      assert.equal(await next.isDisabled(), false);
      assert.equal(await rail.nth(2).isDisabled(), false);
      assert.equal(await rail.nth(3).isDisabled(), false);
      await next.click();
      assert.equal(await h.page.locator('.conn-wizard-card').getAttribute('data-step'), '3');
    } finally {
      await h.close();
    }
  });

  void test('the line carrying the real token is highlighted, and only after a mint', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await bring(h);
      await goTo(h, 3);
      await h.page.locator('.conn-prompt').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.conn-token-line').count(),
        0,
        'a placeholder was highlighted as a token',
      );

      await mint(h);
      await goTo(h, 3);
      // Every line that carries it, and no other: the prompt names it on its
      // Token: line, feeds it to the installer, and curls with it.
      const prompt = await h.page.locator('.conn-prompt').innerText();
      const lines = prompt.split('\n').filter((line) => line.includes(SECRET)).length;
      const marked = await h.page.locator('.conn-prompt .conn-token-line').allInnerTexts();
      assert.equal(marked.length, lines);
      assert.ok(lines >= 1);
      for (const text of marked)
        assert.ok(text.includes(SECRET), `marked without the token: ${text}`);
      assert.match(marked[0] ?? '', /^Token:/);
      // The highlight is decoration: the block's text is what it was, to the
      // byte (LAI-741 — "no undefined" was a sample of that, not the claim).
      assert.equal(prompt, promptText(h.origin, SECRET));
      // Lines wrap rather than scroll sideways.
      const pre = await h.page.locator('.conn-prompt').evaluate((el) => ({
        ws: getComputedStyle(el).whiteSpace,
        ox: getComputedStyle(el).overflowX,
      }));
      assert.equal(pre.ws, 'pre-wrap');
      assert.equal(pre.ox, 'hidden');
    } finally {
      await h.close();
    }
  });

  void test('copying a block says so on the rail', async () => {
    const h = await open('/connect', stub(MINTS), {
      before: async (page) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: () => Promise.resolve() },
          });
        });
      },
    });
    try {
      await mint(h);
      await goTo(h, 3);
      const sub = h.page.locator('.conn-rail-sub').nth(2);
      assert.equal(await sub.innerText(), 'Not copied yet');
      await h.page.getByRole('button', { name: 'Copy the setup prompt', exact: true }).click();
      await h.page
        .getByRole('button', { name: 'Copied the setup prompt', exact: true })
        .waitFor({ timeout: 10_000 });
      // The rail hears the copy through an observer, a render after the button
      // does: wait for its text rather than read it once (LAI-742).
      await h.page.waitForFunction(
        () => document.querySelectorAll('.conn-rail-sub')[2]?.textContent === 'Command copied',
        undefined,
        { timeout: 10_000 },
      );
      assert.equal(await sub.innerText(), 'Command copied');
      assert.match(await h.page.locator('.conn-steps .conn-step-n').nth(2).innerText(), /✓/);
    } finally {
      await h.close();
    }
  });

  void test('connected: the status row goes live and offers the board or another agent', async () => {
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
      await goTo(h, 4);
      await h.page.locator('.conn-live-pill').waitFor({ timeout: 20_000 });
      const row = h.page.locator('.conn-status');
      assert.equal(await row.getAttribute('data-dot'), 'ok');
      assert.match(await row.innerText(), /claude-code on macOS/);
      assert.equal(
        await h.page.getByRole('link', { name: 'Open the board' }).getAttribute('href'),
        '/board',
      );

      await h.page.getByRole('button', { name: 'Connect another agent' }).click();
      assert.equal(await h.page.locator('.conn-wizard-card').getAttribute('data-step'), '1');
      // `forget()` drops the blanked token a tick after blanking it, so the
      // lock returns on the next render — wait for it rather than sample it.
      await h.page.waitForFunction(
        () => document.querySelectorAll<HTMLButtonElement>('.conn-rail-step')[2]?.disabled === true,
        undefined,
        { timeout: 10_000 },
      );
      assert.ok(!(await h.page.locator('body').innerText()).includes(SECRET));
    } finally {
      await h.close();
    }
  });

  void test('an empty search points at Any MCP client and No MCP, and they choose', async () => {
    const h = await open('/connect', stub());
    try {
      const search = h.page.getByRole('searchbox', { name: 'Search agents' });
      await search.waitFor({ timeout: 20_000 });
      assert.equal(await search.getAttribute('placeholder'), 'Search 21 agents');
      await search.fill('teleporter');
      const empty = h.page.locator('.conn-agents-empty');
      assert.match(await empty.innerText(), /Any MCP client/);
      assert.match(await empty.innerText(), /No MCP \(REST \/ CLI\)/);
      await empty.getByRole('button', { name: 'Any MCP client' }).click();
      assert.equal(
        await h.page.getByRole('radio', { name: 'Any MCP client', exact: true }).isChecked(),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('every agent is drawn with its real mark, as inline SVG, and nothing is fetched', async () => {
    const elsewhere: string[] = [];
    const h = await open('/connect', stub(), {
      before: (page) => {
        page.on('request', (request) => {
          if (!request.url().startsWith('http://127.0.0.1') && !request.url().startsWith('data:'))
            elsewhere.push(request.url());
        });
        return Promise.resolve();
      },
    });
    try {
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      const tiles = h.page.locator('.conn-agent');
      const count = await tiles.count();
      assert.equal(count, 21);
      const monograms: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const tile = tiles.nth(i);
        const value = (await tile.locator('input').getAttribute('value')) ?? '';
        const mark = tile.locator('.agent-mark');
        assert.equal(
          await mark.getAttribute('aria-hidden'),
          'true',
          `${value}'s mark is announced`,
        );
        const svgs = await mark.locator('svg path').count();
        if (svgs === 0) monograms.push(value);
        else
          assert.equal(
            await mark.locator('img, image, use').count(),
            0,
            `${value} references a file`,
          );
      }
      // `any` and `rest` are not brands: they are drawn as *another agent*.
      assert.deepEqual(monograms.sort(), ['any', 'rest']);
      // The name is the text; the mark adds none.
      assert.equal(
        await h.page.getByRole('radio', { name: 'Claude Code', exact: true }).count(),
        1,
      );
      assert.deepEqual(elsewhere, [], 'the page asked another origin for something');
    } finally {
      await h.close();
    }
  });

  void test('at 390px the rail sits above the card and nothing scrolls sideways', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await h.page.setViewportSize({ width: 390, height: 900 });
      await mint(h);
      await goTo(h, 3);
      await h.page.waitForTimeout(300);
      const layout = await h.page.evaluate(() => ({
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rail: document.querySelector('.conn-rail')?.getBoundingClientRect().bottom ?? 0,
        card: document.querySelector('.conn-wizard-card')?.getBoundingClientRect().top ?? 0,
        pre: [...document.querySelectorAll('.conn-pre')].map(
          (el) => el.scrollWidth - el.clientWidth,
        ),
      }));
      assert.equal(layout.over, 0, `the page scrolls ${String(layout.over)}px sideways`);
      assert.ok(layout.rail <= layout.card, 'the rail is not above the card');
      assert.deepEqual(
        layout.pre.filter((d) => d > 0),
        [],
        'a command block scrolls sideways',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a fixed rail, the optional entries, and the review follow-ups (LAI-741)', () => {
  /** Where the things that must not move are, and what the scrollers hold. */
  const measure = (h: H) =>
    h.page.evaluate(() => {
      const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
      const main = document.querySelector('.shell-main');
      const scroller = document.querySelector('.conn-card-scroll');
      return {
        doc: document.documentElement.scrollHeight,
        viewport: window.innerHeight,
        mainOver: main === null ? -1 : main.scrollHeight - main.clientHeight,
        bar: top('.connect .screen-bar'),
        rail: top('.conn-rail'),
        foot: document.querySelector('.conn-card-foot')?.getBoundingClientRect().bottom ?? -1,
        cardOver: scroller === null ? -1 : scroller.scrollHeight - scroller.clientHeight,
        scrolled: scroller?.scrollTop ?? -1,
      };
    });

  void test('on a desktop only the card scrolls: the rail and header stay, the footer is pinned', async () => {
    const h = await open('/connect', stub());
    try {
      for (const [width, height] of [
        [1366, 768],
        [1920, 1080],
      ] as const) {
        await h.page.setViewportSize({ width, height });
        await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
        await h.page.waitForTimeout(200);
        const size = `${String(width)}x${String(height)}`;
        // The sidebar is open at this width: the shell's rail is on screen.
        assert.ok(
          ((await h.page.locator('#sidebar').boundingBox())?.width ?? 0) > 100,
          `${size}: no open sidebar`,
        );
        const before = await measure(h);
        assert.equal(before.doc, before.viewport, `${size}: the document scrolls`);
        assert.equal(before.mainOver, 0, `${size}: the shell's scroller has something to scroll`);
        assert.ok(before.foot <= before.viewport, `${size}: the footer is below the fold`);
        if (width === 1366) {
          // Step 1's list is taller than the card here: the card scrolls, nothing else.
          assert.ok(before.cardOver > 0, 'the agent list fits — the test proves nothing');
          await h.page
            .locator('.conn-card-scroll')
            .evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
          await h.page.waitForTimeout(200);
          const after = await measure(h);
          assert.ok(after.scrolled > 0, 'the card did not scroll');
          assert.equal(after.rail, before.rail, 'the rail moved');
          assert.equal(after.bar, before.bar, 'the header moved');
          assert.equal(after.foot, before.foot, 'the footer moved');
          assert.ok(
            await h.page.locator('.conn-card-foot .conn-continue').isVisible(),
            'Continue scrolled away',
          );
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('at 390px nothing is pinned: the page scrolls, the card does not', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(200);
      const m = await measure(h);
      assert.ok(m.mainOver > 0, 'the page does not scroll on a phone');
      assert.equal(m.cardOver, 0, 'the card is a scroller inside the scrolling page');
    } finally {
      await h.close();
    }
  });

  void test('the optional entries open in the card, uncounted, and Back to steps returns', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);
      await goTo(h, 3);
      const rows = h.page.locator('.conn-rail-extra');
      assert.deepEqual(await rows.allInnerTexts(), [
        'Share with your project',
        'What agents can do',
        'Invite a teammate',
      ]);
      // Never numbered, never locked, and the four steps are still four.
      assert.equal(await h.page.locator('.conn-optional .conn-step-n').count(), 0);
      assert.equal(await h.page.locator('.conn-steps > .conn-step').count(), 4);

      const card = h.page.locator('.conn-wizard-card');
      const expect: readonly [string, RegExp][] = [
        ['Share with your project', /For the project lead|Commit this to CLAUDE\.md/],
        [
          'What agents can do',
          /Eighteen tools[\s\S]*Find work[\s\S]*Three rules the board enforces/i,
        ],
        ['Invite a teammate', /Organisation issues an invite link/],
      ];
      for (const [name, body] of expect) {
        await openExtra(h, name);
        assert.equal((await card.getAttribute('data-extra')) !== null, true);
        assert.equal(await h.page.locator('.conn-eyebrow').innerText(), 'OPTIONAL');
        assert.equal(await h.page.locator('#conn-step-title').innerText(), name);
        assert.match(await h.page.locator('.conn-card-body').innerText(), body);
        assert.equal(
          await h.page.locator('.conn-rail-extra[aria-current]').innerText(),
          name,
          'the open entry is not marked current',
        );
        assert.equal(
          await h.page.locator('.conn-rail-step[aria-current="step"]').count(),
          0,
          'a step still claims to be current',
        );
        assert.equal(await h.page.locator('.conn-continue').count(), 0);
        assert.equal(
          await h.page.evaluate(() => document.activeElement?.id),
          'conn-step-title',
          'focus did not follow to the opened entry',
        );
      }

      await h.page.getByRole('button', { name: 'Back to steps' }).click();
      assert.equal(await card.getAttribute('data-step'), '3', 'Back to steps lost the step');
      assert.match(await h.page.locator('.conn-eyebrow').innerText(), /step 3 of 4/i);
      assert.equal(await card.getAttribute('data-extra'), null);
    } finally {
      await h.close();
    }
  });

  void test('nothing sits on the page outside the rail and the card', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      const outside = await h.page.evaluate(() => ({
        page: [...document.querySelectorAll('.conn-page > *')].map((el) => el.className),
        wizard: [...document.querySelectorAll('.conn-wizard > *')].map((el) => el.className),
      }));
      assert.deepEqual(outside.page, ['conn-wizard']);
      // The rail is the steps and its Optional group, which follows the card in
      // the document so that it follows it on a phone too (LAI-742).
      assert.deepEqual(outside.wizard, [
        'conn-rail',
        'conn-card conn-wizard-card',
        'conn-optional',
      ]);
      const body = await h.page.locator('.connect').innerText();
      assert.doesNotMatch(body, /Eighteen tools|You can add people/, 'an optional section is out');
    } finally {
      await h.close();
    }
  });

  void test('a viewer who cannot invite sees no Invite entry', async () => {
    const h = await open('/connect', stub({ '/api/v1/me': { ...ME, org_role: 'member' } }));
    try {
      await h.page.locator('.conn-rail-extra').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await h.page.locator('.conn-rail-extra').allInnerTexts(), [
        'Share with your project',
        'What agents can do',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('connected, step 4 offers Share with your project as the next thing', async () => {
    const h = await open(
      '/connect?agent=codex',
      stub(mints({ last_mcp_at: MINTED_AT + 5_000, last_client: 'codex' })),
    );
    try {
      await mint(h);
      await goTo(h, 4);
      await h.page.locator('.conn-live-pill').waitFor({ timeout: 20_000 });
      await h.page
        .locator('.conn-done-actions')
        .getByRole('button', { name: 'Share with your project' })
        .click();
      assert.equal(await h.page.locator('.conn-wizard-card').getAttribute('data-extra'), 'share');
      await h.page.getByRole('button', { name: 'Back to steps' }).click();
      assert.equal(await h.page.locator('.conn-wizard-card').getAttribute('data-step'), '4');
    } finally {
      await h.close();
    }
  });

  void test('C1: Use a token I already have hands focus to Continue, not to the page', async () => {
    const h = await open('/connect', stub());
    try {
      await bring(h);
      await h.page.waitForFunction(
        () => document.activeElement?.classList.contains('conn-continue') === true,
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await h.page.locator('.conn-continue').isDisabled(), false);
    } finally {
      await h.close();
    }
  });

  void test('C2: the minted token is an alert once, on the mint, not on every return', async () => {
    const h = await open('/connect', stub(MINTS));
    try {
      await mint(h);
      assert.equal(await h.page.locator('.conn-secret').getAttribute('role'), 'alert');
      await goTo(h, 3);
      await goTo(h, 2);
      await h.page.locator('.conn-secret').waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.locator('.conn-secret').getAttribute('role'),
        null,
        'the token box announced itself again',
      );
      assert.equal(await h.page.locator('[role="alert"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('C3: a refused clipboard does not count as copied', async () => {
    const h = await open('/connect', stub(MINTS), {
      before: async (page) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        });
      },
    });
    try {
      await mint(h);
      await goTo(h, 3);
      await h.page.getByRole('button', { name: 'Copy the setup prompt', exact: true }).click();
      await h.page.locator('.conn-block-main .copy-button[data-outcome="select"]').waitFor({
        timeout: 10_000,
      });
      assert.equal(await h.page.locator('.conn-rail-sub').nth(2).innerText(), 'Not copied yet');
      assert.match(await h.page.locator('.conn-steps .conn-step-n').nth(2).innerText(), /^3$/);
    } finally {
      await h.close();
    }
  });

  void test('C3: a copy from Other ways is not the command', async () => {
    const h = await open('/connect', stub(MINTS), {
      before: async (page) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: () => Promise.resolve() },
          });
        });
      },
    });
    try {
      await mint(h);
      await goTo(h, 3);
      await everyBlock(h);
      const other = h.page.locator('details.conn-alt .copy-button').first();
      await other.click();
      await h.page
        .locator('details.conn-alt .copy-button[data-outcome="copied"]')
        .waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.conn-rail-sub').nth(2).innerText(), 'Not copied yet');
    } finally {
      await h.close();
    }
  });

  void test('C4: under the automatic block, a link switches to By hand', async () => {
    const h = await open('/connect', stub());
    try {
      await bring(h);
      await goTo(h, 3);
      const link = h.page.getByRole('button', { name: 'Switch to By hand', exact: true });
      assert.match(
        await h.page.locator('.conn-switch').innerText(),
        /^Prefer to do it by hand\? Switch to By hand$/,
      );
      // It sits below the automatic block, not above it.
      assert.ok(
        await h.page.evaluate(() => {
          const block = document.querySelector('.conn-block-main');
          const line = document.querySelector('.conn-switch');
          return (
            block !== null &&
            line !== null &&
            (block.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          );
        }),
      );
      await link.click();
      const hand = h.page.getByRole('button', { name: 'By hand', exact: true });
      assert.equal(await hand.getAttribute('aria-pressed'), 'true');
      assert.equal(await h.page.locator('.conn-switch').count(), 0);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent),
        'By hand',
        'focus fell to the page when the link went',
      );
      assert.match(await h.page.locator('.conn-wizard-card').innerText(), /install\.sh/);
    } finally {
      await h.close();
    }
  });

  void test('C5: a note that introduces its block sits above it; a follow-up stays below', async () => {
    const h = await open('/connect', stub());
    try {
      await bring(h);
      await goTo(h, 3);
      const order = (key: string) =>
        h.page.evaluate((k) => {
          const pre = document.querySelector(`.conn-block-${k}`);
          const setup = pre?.closest('.conn-setup');
          const block = setup?.querySelector('.conn-block');
          const note = setup?.querySelector('.conn-intro, .conn-info');
          if (block === null || block === undefined || note === null || note === undefined)
            return 'missing';
          return (block.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
            ? 'above'
            : 'below';
        }, key);
      assert.equal(await order('claude-prompt'), 'above');
      assert.match(
        await h.page.locator('.conn-intro').first().innerText(),
        /^Open Claude Code in your project folder/,
      );
      await h.page.getByRole('button', { name: 'By hand', exact: true }).click();
      assert.equal(await order('claude-manual'), 'below');
    } finally {
      await h.close();
    }
  });

  void test('C6: a wrapped line hangs under its own text, and the text is untouched', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await bring(h);
      await goTo(h, 3);
      await h.page.locator('.conn-prompt').waitFor({ timeout: 20_000 });
      const hangs = await h.page.locator('.conn-prompt').evaluate((pre) => {
        // Every text node in order, with where it starts in the block's text,
        // so a logical line can be measured whatever elements carry it.
        const nodes: { node: Text; at: number }[] = [];
        const walk = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        let at = 0;
        for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
          nodes.push({ node: n as Text, at });
          at += (n as Text).length;
        }
        const point = (offset: number): [Text, number] => {
          const hit = [...nodes].reverse().find((p) => p.at <= offset) ?? nodes[0];
          if (hit === undefined) throw new Error('no text in the block');
          return [hit.node, Math.min(offset - hit.at, hit.node.length)];
        };
        const rects = (from: number, to: number) => {
          const range = document.createRange();
          range.setStart(...point(from));
          range.setEnd(...point(to));
          return [...range.getClientRects()].filter((r) => r.width > 0);
        };
        const text = nodes.map((p) => p.node.data).join('');
        const out = { wrapped: 0, indented: 0, under: [] as string[] };
        let start = 0;
        for (const line of text.split('\n')) {
          const from = start;
          start += line.length + 1;
          const lead = line.length - line.trimStart().length;
          if (lead === line.length) continue;
          // One rect per visual row of this logical line, top to bottom.
          const rows = rects(from, from + line.length);
          const tops = [...new Set(rows.map((r) => Math.round(r.top)))];
          if (tops.length < 2) continue;
          out.wrapped += 1;
          if (lead > 0) out.indented += 1;
          // Where this line's own text starts: its first non-space character.
          const own = rects(from + lead, from + lead + 1)[0]?.left ?? 0;
          const later = rows.filter((r) => Math.round(r.top) !== tops[0]);
          if (later.some((r) => r.left <= own + 1)) out.under.push(line.trim().slice(0, 40));
        }
        return out;
      });
      assert.ok(hangs.wrapped > 0, 'no line wrapped at 390px — the test proves nothing');
      assert.ok(
        hangs.indented > 0,
        'no indented line wrapped at 390px — half the claim is untested',
      );
      assert.deepEqual(hangs.under, [], 'a continuation starts at or left of its own line’s text');
      assert.equal(
        await h.page.locator('.conn-prompt').innerText(),
        promptText(h.origin, undefined),
        'the indent changed the text',
      );
    } finally {
      await h.close();
    }
  });

  void test('in light and in dark, the screen fits 1366x768 without scrolling', async () => {
    // Both themes at the size the owner named; the layout must not depend on one.
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        const m = await measure(h);
        assert.equal(m.doc, m.viewport, `${theme}: the document scrolls`);
        assert.equal(m.mainOver, 0, `${theme}: the shell scrolls`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the LAI-741 review notes (LAI-742)', () => {
  void test('1: the rail clips neither the current step’s halo nor its focus ring', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      const current = h.page.locator('.conn-rail-step[aria-current="step"]');
      await current.focus();
      const m = await current.evaluate((button) => {
        const rail = button.closest('.conn-rail');
        if (rail === null) throw new Error('the current step is not in the rail');
        const box = rail.getBoundingClientRect();
        // The padding box: what an `overflow` other than visible clips to.
        const left = box.left + rail.clientLeft;
        const right = left + rail.clientWidth;
        const style = getComputedStyle(button);
        const ring = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const halo = Number(/0px 0px 0px ([\d.]+)px/.exec(style.boxShadow)?.[1] ?? 0);
        const b = button.getBoundingClientRect();
        return {
          focusVisible: button.matches(':focus-visible'),
          sideways: rail.scrollWidth - rail.clientWidth,
          ring,
          halo,
          left: b.left - Math.max(ring, halo) - left,
          right: right - (b.right + Math.max(ring, halo)),
        };
      });
      // Check the instrument: a ring and a halo to measure, or this proves nothing.
      assert.ok(m.focusVisible, 'the step is not :focus-visible — no ring to measure');
      assert.equal(m.ring, 4, 'the focus ring is not 2px at a 2px offset');
      assert.equal(m.halo, 3, 'the current step has no 3px halo');
      assert.equal(m.sideways, 0, 'the rail scrolls sideways');
      assert.ok(m.left >= 0, `the ring and halo are cut ${String(-m.left)}px on the left`);
      assert.ok(m.right >= 0, `the ring and halo are cut ${String(-m.right)}px on the right`);
    } finally {
      await h.close();
    }
  });

  void test('2: a step or entry change starts the card at its top', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      const scroller = h.page.locator('.conn-card-scroll');
      const toBottom = async (where: string): Promise<void> => {
        await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
        await h.page.waitForTimeout(150);
        const top = await scroller.evaluate((el) => el.scrollTop);
        assert.ok(top > 0, `${where}: the card has nothing to scroll — the test proves nothing`);
      };
      const atTop = async (what: string): Promise<void> => {
        await h.page.waitForFunction(() => document.activeElement?.id === 'conn-step-title');
        await h.page.waitForTimeout(150);
        const m = await scroller.evaluate((el) => ({
          top: el.scrollTop,
          eyebrow:
            (el.querySelector('.conn-eyebrow')?.getBoundingClientRect().top ?? -1) -
            el.getBoundingClientRect().top,
        }));
        assert.equal(m.top, 0, `${what}: the card kept the last card's scroll`);
        assert.ok(m.eyebrow >= 0, `${what}: the eyebrow is above the card's top`);
      };

      // Two tall cards, so the old scroll survives the change unless it is reset.
      await bring(h);
      await goTo(h, 3);
      await toBottom('step 3');
      await goTo(h, 1);
      await atTop('step 3 → step 1');

      // An optional entry is the same change. Every entry fits the card at this
      // size, so this half holds by clamping too; the step change above is the
      // half that can fail.
      await toBottom('step 1');
      await openExtra(h, 'What agents can do');
      await atTop('step 1 → What agents can do');
    } finally {
      await h.close();
    }
  });

  void test('6: on a phone the card follows the steps, and Optional follows the card', async () => {
    const h = await open('/connect', stub());
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('.conn-picker').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(200);
      const at = await h.page.evaluate(() => {
        const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
        return {
          steps: rect('.conn-steps')?.bottom ?? -1,
          card: rect('.conn-wizard-card')?.top ?? -1,
          cardBottom: rect('.conn-wizard-card')?.bottom ?? -1,
          optional: rect('.conn-optional')?.top ?? -1,
          viewport: window.innerHeight,
        };
      });
      assert.ok(at.steps > 0 && at.steps <= at.card, 'the four steps are not above the card');
      assert.ok(at.cardBottom <= at.optional, 'Optional is not after the card');
      assert.ok(
        at.card <= at.viewport / 2,
        `the card starts ${String(Math.round(at.card))}px down a ${String(at.viewport)}px screen`,
      );

      // The desktop is unchanged: Optional sits in the rail's column, under the steps.
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await h.page.waitForTimeout(200);
      const desk = await h.page.evaluate(() => {
        const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
        return {
          steps: rect('.conn-steps'),
          step: rect('.conn-steps .conn-rail-step'),
          optional: rect('.conn-optional'),
          extra: rect('.conn-rail-extra'),
          card: rect('.conn-wizard-card'),
        };
      });
      const { steps, step, optional, extra, card } = desk;
      assert.ok(steps && step && optional && extra && card, 'a part of the wizard is missing');
      assert.ok(optional.top >= steps.bottom, 'Optional is not under the steps');
      assert.ok(optional.right <= card.left, 'Optional left the rail’s column');
      assert.equal(Math.round(optional.left), Math.round(steps.left), 'Optional is out of line');
      assert.equal(Math.round(extra.width), Math.round(step.width), 'its rows are not the steps’');
    } finally {
      await h.close();
    }
  });
});
