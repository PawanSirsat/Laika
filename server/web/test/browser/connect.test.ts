/**
 * Settings → Connect, in a browser (LAI-622).
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

/** The mint endpoint, answering with the one-time secret. */
const MINTS: Partial<ApiStub> = {
  '/api/v1/tokens': (call: { method?: string }) =>
    call.method === 'POST'
      ? {
          token: {
            id: 't1',
            name: 'laika-claude on macOS',
            prefix: SECRET.slice(0, 8),
            scope: 'full',
            last_used_at: null,
            expires_at: Date.now() + 90 * 86_400_000,
            revoked_at: null,
            created_at: Date.now(),
          },
          secret: SECRET,
        }
      : { data: [], next_cursor: null },
};

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
      const block = await h.page.locator('.conn-claude-md').innerText();
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
      await h.page.locator('.conn-claude-md').waitFor({ timeout: 20_000 });
      await pick(h.page.locator('#conn-project'), 'skynet');
      await h.page.waitForFunction(
        () => (document.querySelector('.conn-claude-md')?.textContent ?? '').includes('skynet'),
        undefined,
        { timeout: 10_000 },
      );
      const block = await h.page.locator('.conn-claude-md').innerText();
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
  void test('CONTROL: my own browser does not satisfy it', async () => {
    const h = await open(
      '/connect',
      stub({
        ...MINTS,
        '/api/v1/presence': {
          enabled: true,
          present: [
            {
              user_id: 'u1',
              name: 'Ada Lovelace',
              matched_task_id: null,
              project_ids: [],
              is_agent: false,
              last_seen: Date.now(),
            },
          ],
        },
      }),
    );
    try {
      await mint(h);
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

  void test('an agent session turns it green, and the watch then stops', async () => {
    const h = await open(
      '/connect',
      stub({
        ...MINTS,
        '/api/v1/presence': {
          enabled: true,
          present: [
            {
              user_id: 'u1',
              name: 'Ada Lovelace',
              repo: 'kvelld/onroute',
              branch: 'main',
              matched_task_id: null,
              project_ids: [],
              is_agent: true,
              last_seen: Date.now(),
            },
          ],
        },
      }),
    );
    try {
      await mint(h);
      await h.page.locator('.conn-live-ok').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.conn-live-ok').innerText(), /kvelld\/onroute/);

      const asked = h.calls.filter((c) => c.path === '/api/v1/presence').length;
      await h.page.waitForTimeout(6_000);
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/presence').length,
        asked,
        'the watch kept polling after it succeeded',
      );
    } finally {
      await h.close();
    }
  });

  void test('presence switched off is said, not guessed at', async () => {
    const h = await open(
      '/connect',
      stub({ ...MINTS, '/api/v1/presence': { enabled: false, present: [] } }),
    );
    try {
      await mint(h);
      await h.page.locator('.conn-live-disabled').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.conn-live-spent').count(), 0);
    } finally {
      await h.close();
    }
  });
});
