/**
 * Copy, on a board that is not a secure context (LAI-760).
 *
 * The live board is plain HTTP on an IP. Browsers expose `navigator.clipboard`
 * only in a secure context, so there it is `undefined`, and every Copy button
 * used to fall back to selecting the text — the owner clicked Copy and pasted
 * nothing. `127.0.0.1` *is* a secure context, so the rest of the browser suite
 * cannot see this: these tests open the app at `http://laika.test:<port>`
 * (the harness's `insecure` option), check that the page really is insecure,
 * and then read the clipboard back after each click.
 *
 * ## How the clipboard is read
 *
 * The page under test cannot read it — that is the whole point. A second page
 * in the same browser, on `http://localhost` (a secure context) with the
 * clipboard permissions granted, reads and writes the clipboard the browser
 * shares between its pages. Before each click it writes a sentinel and reads
 * it back: that proves the reader sees the clipboard at all, and it is what a
 * click that copies nothing leaves behind.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, INSECURE_HOST, open, until, type ApiStub } from './harness.ts';
import { setupBlocks } from '../../src/routes/screens/connect/connect-agents.ts';

const SECRET = 'lai_ThisIsTheWholeSecretAndMustNotRenderTwice';
const SENTINEL = 'LAI-760 sentinel: nothing was copied';

type H = Awaited<ReturnType<typeof open>>;

after(async () => {
  await closeBrowser();
});

/** A secure page beside the one under test, which may read the clipboard. */
async function clipboardOf(page: Page) {
  const browser = page.context().browser();
  assert.ok(browser !== null, 'the page has no browser to open a reader in');
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const reader = await context.newPage();
  await reader.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>reader</title>' }),
  );
  await reader.goto('http://localhost/');
  return {
    read: (): Promise<string> => reader.evaluate(() => navigator.clipboard.readText()),
    /** Put the sentinel on the clipboard, and prove the reader can see it. */
    reset: async (): Promise<void> => {
      await reader.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);
      assert.equal(
        await reader.evaluate(() => navigator.clipboard.readText()),
        SENTINEL,
        'the reader cannot see the clipboard, so nothing below could prove a copy',
      );
    },
    close: () => context.close(),
  };
}

/** The page really is what the live board is: insecure, with no clipboard API. */
async function assertInsecure(h: H): Promise<void> {
  assert.equal(new URL(h.origin).hostname, INSECURE_HOST);
  assert.deepEqual(
    await h.page.evaluate(() => ({
      secure: window.isSecureContext,
      api: typeof navigator.clipboard,
    })),
    { secure: false, api: 'undefined' },
    'the page is a secure context, so this test cannot reproduce the live board',
  );
}

/** Click `button` and return what the clipboard holds afterwards. */
async function copyWith(
  clip: Awaited<ReturnType<typeof clipboardOf>>,
  button: Locator,
): Promise<string> {
  await clip.reset();
  await button.click();
  await until(async () => (await clip.read()) !== SENTINEL);
  return clip.read();
}

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

const ONROUTE = {
  id: 'p1',
  slug: 'onroute',
  prefix: 'ONR',
  name: 'OnRoute',
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
};

const tokenRow = {
  id: 't1',
  name: 'claude-code on macOS',
  prefix: SECRET.slice(0, 8),
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: Date.now() + 90 * 86_400_000,
  revoked_at: null,
  created_at: Date.now(),
};

const CONNECT: ApiStub = {
  '/api/v1/me': ME,
  '/api/v1/projects': { data: [ONROUTE], next_cursor: null },
  '/api/v1/tokens': (call: { method?: string }) =>
    call.method === 'POST' ? { token: tokenRow, secret: SECRET } : { data: [], next_cursor: null },
  '/api/v1/presence': { enabled: true, present: [] },
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
    enabled: false,
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
};

async function goTo(h: H, n: 2 | 3): Promise<void> {
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

void describe('Copy on the Connect screen, served over plain HTTP', () => {
  void test('the BOARD chip copies the board address', async () => {
    const h = await open('/developer/connect', CONNECT, { insecure: true });
    const clip = await clipboardOf(h.page);
    try {
      await assertInsecure(h);
      const button = h.page.locator('.conn-url .copy-button');
      await button.waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.conn-url-value').innerText(), h.origin);

      assert.equal(await copyWith(clip, button), h.origin);
      await button.and(h.page.locator('[data-outcome="copied"]')).waitFor({ timeout: 10_000 });
      assert.equal(await button.innerText(), 'Copied ✓');
    } finally {
      await clip.close();
      await h.close();
    }
  });

  void test('the setup prompt copies the prompt, token included, inside the wizard card', async () => {
    const h = await open('/developer/connect', CONNECT, { insecure: true });
    const clip = await clipboardOf(h.page);
    try {
      await assertInsecure(h);
      await mint(h);
      await goTo(h, 3);
      const button = h.page.getByRole('button', { name: 'Copy the setup prompt', exact: true });
      await button.waitFor({ timeout: 20_000 });
      // Inside the card, where the reader clicks it; and focus stays on it.
      assert.equal(
        await button.evaluate((b) => b.closest('.conn-wizard-card') !== null),
        true,
        'the prompt button is not in the Connect card',
      );

      const prompt = setupBlocks('claude-code', {
        origin: h.origin,
        secret: SECRET,
        project: { slug: ONROUTE.slug, prefix: ONROUTE.prefix, name: ONROUTE.name },
      }).find((b) => b.key === 'claude-prompt');
      assert.ok(prompt !== undefined, 'no claude-prompt block');

      assert.equal(await copyWith(clip, button), prompt.text);
      await h.page.locator('.conn-block-main .copy-button[data-outcome="copied"]').waitFor({
        timeout: 10_000,
      });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null),
        'Copied the setup prompt',
        'focus did not come back to the button after the copy',
      );
      assert.equal(
        await h.page.locator('textarea[aria-hidden="true"]').count(),
        0,
        'the temporary textarea was left behind',
      );
    } finally {
      await clip.close();
      await h.close();
    }
  });

  void test('the Share local activity command block copies the command', async () => {
    const h = await open('/developer/connect', CONNECT, { insecure: true });
    const clip = await clipboardOf(h.page);
    try {
      await assertInsecure(h);
      await h.page.locator('.conn-rail-extra', { hasText: 'Share local activity' }).click();
      // By its block, not its name: the name becomes "Copied the command".
      const button = h.page
        .locator('.conn-block', { has: h.page.locator('#share-command-label') })
        .locator('.copy-button');
      await button.waitFor({ timeout: 20_000 });
      const shown = await h.page.locator('pre[aria-labelledby="share-command-label"]').innerText();
      assert.equal(shown, 'laika activity on');

      assert.equal(await copyWith(clip, button), shown);
      await button.and(h.page.locator('[data-outcome="copied"]')).waitFor({ timeout: 10_000 });
    } finally {
      await clip.close();
      await h.close();
    }
  });

  void test('CONTROL: when both ways fail it says how to copy, selects the text, and never says Copied', async () => {
    const h = await open('/developer/connect', CONNECT, {
      insecure: true,
      before: async (page) => {
        await page.addInitScript(() => {
          // The fallback refused too: the one case left where nothing can copy.
          document.execCommand = () => false;
        });
      },
    });
    const clip = await clipboardOf(h.page);
    try {
      await assertInsecure(h);
      await h.page.locator('.conn-rail-extra', { hasText: 'Share local activity' }).click();
      // By its block, not its name: the name changes once it says what to press.
      const button = h.page
        .locator('.conn-block', { has: h.page.locator('#share-command-label') })
        .locator('.copy-button');
      await button.waitFor({ timeout: 20_000 });

      await clip.reset();
      await button.click();
      await h.page.locator('.copy-button[data-outcome="select"]').waitFor({ timeout: 10_000 });

      const label = await button.innerText();
      assert.match(label, /^Press (⌘C|Ctrl\+C) to copy/, 'it did not say how to copy');
      assert.doesNotMatch(label, /Copied/, 'it claimed a copy that did not happen');
      assert.equal(await clip.read(), SENTINEL, 'something reached the clipboard after all');
      assert.equal(
        await h.page.evaluate(() => window.getSelection()?.toString() ?? ''),
        'laika activity on',
        'the text was not selected for the reader to copy',
      );
    } finally {
      await clip.close();
      await h.close();
    }
  });
});

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const SUBJECT = {
  id: 't3',
  key: 'LC-3',
  number: 3,
  project_id: 'laika-core',
  title: 'Org settings and org-role management',
  description_md: '',
  acceptance_md: '',
  status: 'in_progress',
  priority: 'p1',
  assignee_id: 'u1',
  created_by: 'u1',
  created_via: 'api',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
};

const BOARD: ApiStub = {
  '/api/v1/me': { ...ME, memberships: [{ project_id: 'laika-core', role: 'lead' }] },
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 0, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks?limit=200': { data: [SUBJECT], next_cursor: null },
  '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/tasks/t3/comments': { data: [], next_cursor: null },
  '/api/v1/tasks/t3/watchers': { watchers: ['u1'] },
  '/api/v1/tasks/t3/dependencies': SUBJECT,
  '/api/v1/tasks/t3': SUBJECT,
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

void describe('Copy inside a dialog, served over plain HTTP', () => {
  void test("the task panel's Copy link copies the link, from inside the modal", async () => {
    const h = await open('/board?project=laika-core', BOARD, { insecure: true });
    const clip = await clipboardOf(h.page);
    try {
      await assertInsecure(h);
      await h.page.locator('.card', { hasText: 'Org settings' }).first().click({ timeout: 20_000 });
      const button = h.page.locator('.panel[aria-modal="true"]').getByRole('button', {
        name: 'Copy link to this task',
        exact: true,
      });
      await button.waitFor({ timeout: 10_000 });

      // Where the temporary textarea goes: inside the modal, or a focus trap
      // would take focus back and the copy would fail silently.
      await h.page.evaluate(() => {
        const seen: boolean[] = [];
        (window as unknown as { __scratch: boolean[] }).__scratch = seen;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              // The parent it was added to: by the time this runs the
              // textarea has been removed again, and a detached node has no
              // ancestors to ask.
              if (node instanceof HTMLTextAreaElement && record.target instanceof Element) {
                seen.push(record.target.closest('[aria-modal="true"]') !== null);
              }
            }
          }
        }).observe(document.body, { childList: true, subtree: true });
      });

      const href = await h.page.evaluate(() => window.location.href);
      assert.equal(await copyWith(clip, button), href);
      assert.deepEqual(
        await h.page.evaluate(() => (window as unknown as { __scratch: boolean[] }).__scratch),
        [true],
        'the temporary textarea was not placed inside the dialog',
      );
    } finally {
      await clip.close();
      await h.close();
    }
  });
});
