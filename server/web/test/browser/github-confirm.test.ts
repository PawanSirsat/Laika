/**
 * GitHub in a browser (LAI-753, LAI-766, D-083): the Organisation screen's
 * webhook section — set a secret, copy it once, rotate it — and the proof
 * states GitHub decides, on the Review page and in its filters.
 *
 * ## Why these are worth a browser
 *
 * - **A secret shown once is only useful if the Copy really copies.** The board
 *   is plain HTTP, where `navigator.clipboard` does not exist (LAI-760); a Copy
 *   that said "Copied" having copied nothing would leave somebody holding a
 *   secret they can never see again. So the copy is read back from the
 *   clipboard, on an insecure page, as the live board is.
 * - **Rotation is destructive.** It must ask first, and the old secret must
 *   leave the screen when the new one arrives.
 * - **The three states are colour.** claimed grey, confirmed green, failed red
 *   — and a class asserted in a source test is not a colour on a screen.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  INSECURE_HOST,
  open,
  reply,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

const NOW = Date.now();
const HOUR = 3_600_000;
const SENTINEL = 'LAI-753 sentinel: nothing was copied';

void after(async () => {
  await closeBrowser();
});

/** A secure page beside the one under test, which may read the clipboard. */
async function clipboardOf(page: Page) {
  const browser = page.context().browser();
  assert.ok(browser !== null);
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const reader = await context.newPage();
  await reader.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>reader</title>' }),
  );
  await reader.goto('http://localhost/');
  return {
    read: (): Promise<string> => reader.evaluate(() => navigator.clipboard.readText()),
    reset: async (): Promise<void> => {
      await reader.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);
      assert.equal(await reader.evaluate(() => navigator.clipboard.readText()), SENTINEL);
    },
    close: () => context.close(),
  };
}

// --------------------------------------------------------- the settings card

const OWNER = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [],
};

const PEOPLE = [
  {
    id: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    org_role: 'owner',
    is_active: true,
    created_at: 1,
    updated_at: 1,
  },
];

const FIRST = 'a'.repeat(32) + 'b'.repeat(32);
const SECOND = 'c'.repeat(32) + 'd'.repeat(32);

function orgServer(configured: boolean): { stub: ApiStub; calls: () => StubCall[] } {
  const seen: StubCall[] = [];
  const secrets = [FIRST, SECOND];
  let set = configured;
  const org = () => ({
    id: 'o1',
    name: 'Kvelld Dynamics',
    presence_enabled: true,
    developer_insights: false,
    created_at: 1,
    updated_at: 2,
    ai: { configured: false, provider: null, key_last4: null },
    github_webhook: { configured: set, payload_url: 'http://laika.example/webhooks/github' },
  });
  const stub: ApiStub = {
    '/api/v1/me': OWNER,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/invites': { data: [], next_cursor: null },
    '/api/v1/org': () => org(),
    '/api/v1/org/github-webhook': (call: StubCall) => {
      seen.push(call);
      if (call.method === 'DELETE') {
        set = false;
        return reply(204, null);
      }
      set = true;
      return reply(201, {
        configured: true,
        payload_url: 'http://laika.example/webhooks/github',
        secret: secrets.shift() ?? 'exhausted',
      });
    },
  };
  return { stub, calls: () => seen };
}

void describe('the GitHub webhook card (LAI-753)', () => {
  void test('says what to paste, sets a secret, copies it once, and rotates it', async () => {
    const s = orgServer(false);
    const h = await open('/organisation?tab=integrations', s.stub, { insecure: true });
    const clip = await clipboardOf(h.page);
    try {
      assert.equal(new URL(h.origin).hostname, INSECURE_HOST);
      const card = h.page.locator('[data-section="github"]');
      await card.waitFor({ timeout: 20_000 });

      // What to paste into GitHub, before anything is set.
      assert.match(await card.innerText(), /http:\/\/laika\.example\/webhooks\/github/);
      assert.match(await card.innerText(), /application\/json/);
      for (const event of [
        'Pushes',
        'Pull requests',
        'Check runs',
        'Check suites',
        'Workflow runs',
      ]) {
        assert.match(await card.innerText(), new RegExp(event));
      }
      assert.match(await card.innerText(), /does not retry a failed delivery/);
      assert.match(await card.innerText(), /not set up/);

      // Set: no confirmation for a first secret, and it is shown.
      await card.getByRole('button', { name: 'Set secret' }).click();
      const secret = card.locator('[data-secret]');
      await secret.waitFor({ timeout: 10_000 });
      assert.equal(await secret.innerText(), FIRST);

      // Copy, read back from the clipboard on an insecure page.
      await clip.reset();
      await card.getByRole('button', { name: 'Copy the webhook secret' }).click();
      await until(async () => (await clip.read()) !== SENTINEL);
      assert.equal(await clip.read(), FIRST);

      // Done: it leaves the screen, and nothing can bring it back.
      await card.getByRole('button', { name: 'Done' }).click();
      await secret.waitFor({ state: 'detached', timeout: 5_000 });
      assert.doesNotMatch(await h.page.locator('body').innerText(), new RegExp(FIRST));
      assert.match(await card.innerText(), /secret set/);

      // Rotate asks first; the new secret replaces the old.
      let asked = '';
      h.page.once('dialog', (dialog) => {
        asked = dialog.message();
        void dialog.accept();
      });
      await card.getByRole('button', { name: 'Rotate secret' }).click();
      await secret.waitFor({ timeout: 10_000 });
      assert.match(asked, /stops working at once/);
      assert.equal(await secret.innerText(), SECOND);
      assert.doesNotMatch(await h.page.locator('body').innerText(), new RegExp(FIRST));

      assert.deepEqual(
        s.calls().map((c) => [c.method, c.path]),
        [
          ['POST', '/api/v1/org/github-webhook'],
          ['POST', '/api/v1/org/github-webhook'],
        ],
      );
    } finally {
      await clip.close();
      await h.close();
    }
  });

  void test('declining the rotation sends nothing; clearing asks and clears', async () => {
    const s = orgServer(true);
    const h = await open('/organisation?tab=integrations', s.stub);
    try {
      const card = h.page.locator('[data-section="github"]');
      await card.waitFor({ timeout: 20_000 });

      h.page.once('dialog', (dialog) => void dialog.dismiss());
      await card.getByRole('button', { name: 'Rotate secret' }).click();
      assert.equal(await card.locator('[data-secret]').count(), 0);
      assert.deepEqual(s.calls(), []);

      h.page.once('dialog', (dialog) => void dialog.accept());
      await card.getByRole('button', { name: 'Clear' }).click();
      await card.getByRole('button', { name: 'Set secret' }).waitFor({ timeout: 10_000 });
      assert.deepEqual(
        s.calls().map((c) => c.method),
        ['DELETE'],
      );
    } finally {
      await h.close();
    }
  });

  void test('a member sees no card at all', async () => {
    const s = orgServer(true);
    const h = await open('/organisation?tab=integrations', {
      ...s.stub,
      '/api/v1/me': { ...OWNER, org_role: 'member' },
      '/api/v1/org': {
        id: 'o1',
        name: 'Kvelld Dynamics',
        presence_enabled: true,
        developer_insights: false,
        created_at: 1,
        updated_at: 2,
      },
    });
    try {
      // Integrations, loaded: the price table is everyone's, so it is there.
      await h.page.locator('.org-body[data-tab="integrations"] .org-card').first().waitFor({
        timeout: 20_000,
      });
      assert.equal(await h.page.locator('[data-section="github"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------ proof states

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'review',
    priority: 'p2',
    assignee_id: 'u1',
    created_by: 'u1',
    created_via: 'mcp',
    created_by_client: null,
    sprint_id: null,
    tags: [],
    ready: false,
    comment_count: 0,
    blocked_by: [],
    blocks: [],
    send_back: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    position: null,
    created_at: 1,
    updated_at: NOW - HOUR,
    started_at: null,
    completed_at: null,
    ...over,
  });

const claimed = { state: 'claimed', state_source: null, state_at: null };
const confirmed = { state: 'confirmed', state_source: 'github', state_at: NOW - 60_000 };
const failed = { state: 'failed', state_source: 'github', state_at: NOW - 60_000 };
const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';

/** CI failed on the head commit: the agent said its lint passed. */
const RED = {
  id: 'r1',
  task_id: 't1',
  number: 1,
  finished_by: 'u1',
  client_name: 'codex',
  summary_md: 'Fixed it',
  commits: [
    { id: 'e1', ...confirmed, sha: HEAD, message: 'fix: lint' },
    { id: 'e2', ...claimed, sha: '1234567', message: 'never pushed' },
  ],
  branch: { id: 'e3', ...confirmed, name: 'lai-1-fix' },
  pull_request: {
    id: 'e4',
    ...confirmed,
    url: 'https://github.com/kvell/laika/pull/42',
    merged: false,
  },
  tests: [
    { id: 'e5', ...failed, command: 'pnpm test', exit_code: 0 },
    { id: 'e6', ...failed, command: 'pnpm lint', exit_code: 0 },
  ],
  ci: { head_sha: HEAD, total: 3, passed: 2, failed: 1, pending: 0, failed_names: ['lint'] },
  created_at: NOW - 3 * HOUR,
};

/** CI passed, the pull request merged. */
const GREEN = {
  ...RED,
  id: 'r2',
  task_id: 't2',
  commits: [{ id: 'g1', ...confirmed, sha: HEAD, message: 'feat: done' }],
  branch: null,
  pull_request: { ...RED.pull_request, id: 'g2', merged: true },
  tests: [{ id: 'g3', ...confirmed, command: 'pnpm test', exit_code: 0 }],
  ci: { head_sha: HEAD, total: 3, passed: 3, failed: 0, pending: 0, failed_names: [] },
};

/** Nothing from GitHub yet. */
const GREY = {
  ...RED,
  id: 'r3',
  task_id: 't3',
  commits: [{ id: 'y1', ...claimed, sha: HEAD, message: 'wip' }],
  branch: null,
  pull_request: null,
  tests: [{ id: 'y2', ...claimed, command: 'pnpm test', exit_code: 0 }],
  ci: null,
};

function reviewStub(): ApiStub {
  const row = (t: Record<string, unknown>, round: object, hours: number) => ({
    task: t,
    project: { id: 'laika-core', slug: 'laika-core', name: 'Laika Core', prefix: 'LC' },
    assignee_name: 'Ada Lovelace',
    waiting_since: NOW - hours * HOUR,
    round,
    finished_by_name: 'Ada Lovelace',
    can_decide: true,
    // LAI-772: no "check this one" cue on these rows.
    cue: null,
  });
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/review': {
      tasks: [
        row(task({ id: 't1', key: 'LC-1', number: 1, title: 'Lint claims to pass' }), RED, 5),
        row(task({ id: 't2', key: 'LC-2', number: 2, title: 'Merged and green' }), GREEN, 4),
        row(task({ id: 't3', key: 'LC-3', number: 3, title: 'Nothing heard yet' }), GREY, 3),
      ],
      truncated: false,
    },
    '/api/v1/tasks/t1/rounds': { rounds: [RED], send_back: null },
    '/api/v1/tasks/t2/rounds': { rounds: [GREEN], send_back: null },
    '/api/v1/tasks/t3/rounds': { rounds: [GREY], send_back: null },
  };
}

/** A computed colour, as RGB numbers. */
async function colourOf(page: Page, selector: string): Promise<[number, number, number]> {
  const value = await page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = (value.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return [r ?? 0, g ?? 0, b ?? 0];
}

void describe('the proof GitHub confirmed (D-083)', () => {
  void test('the CI filters follow GitHub, and each row says what CI found', async () => {
    const h = await open('/inbox?tab=review', reviewStub());
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      const chips = h.page.locator('.rev-chip-ci');
      // Wait for every chip it asserts, not the first row (LAI-715).
      await until(
        async () =>
          (await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-ci')))).join(
            '|',
          ) === ['failed', 'confirmed'].join('|'),
      );
      assert.deepEqual(
        await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-ci'))),
        ['failed', 'confirmed'],
      );

      await h.page.getByRole('button', { name: 'CI failed', exact: true }).click();
      await until(
        async () => (await h.page.locator('.rev-key').allInnerTexts()).join('|') === 'LC-1',
      );
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-1']);
      await h.page.getByRole('button', { name: 'CI confirmed', exact: true }).click();
      await until(
        async () => (await h.page.locator('.rev-key').allInnerTexts()).join('|') === 'LC-2',
      );
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-2']);
      assert.equal(
        await h.page
          .getByRole('button', { name: 'CI failed', exact: true })
          .getAttribute('aria-pressed'),
        'false',
        'the two CI filters are one choice, not a contradiction',
      );
    } finally {
      await h.close();
    }
  });

  void test('claimed grey, confirmed green, failed red, with the CI line and the merge', async () => {
    const h = await open('/inbox?tab=review', reviewStub());
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-1' }).click();
      const proof = h.page.locator('.rev-detail [data-section="proof"]');
      await proof.locator('.ev-round').waitFor({ timeout: 10_000 });

      await until(
        async () =>
          (await proof.locator('.ev-state-confirmed').count()) === 3 &&
          (await proof.locator('.ev-state-failed').count()) === 2 &&
          (await proof.locator('.ev-state-claimed').count()) === 1,
      );
      assert.equal(await proof.locator('.ev-state-confirmed').count(), 3);
      assert.equal(await proof.locator('.ev-state-failed').count(), 2);
      assert.equal(await proof.locator('.ev-state-claimed').count(), 1);
      assert.match(await proof.locator('.ev-ci').innerText(), /CI: lint failed/);
      assert.match(await proof.locator('.ev-ci').innerText(), /on abcdef012345/);
      assert.match(await proof.locator('.ev-merged').innerText(), /not merged/);

      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        const [gr, gg, gb] = await colourOf(h.page, '.rev-detail .ev-state-confirmed');
        const [rr, rg, rb] = await colourOf(h.page, '.rev-detail .ev-state-failed');
        const [cr, cg, cb] = await colourOf(h.page, '.rev-detail .ev-state-claimed');
        assert.ok(gg > gr && gg > gb, `${theme}: confirmed is green, got ${String([gr, gg, gb])}`);
        assert.ok(rr > rg && rr > rb, `${theme}: failed is red, got ${String([rr, rg, rb])}`);
        assert.ok(
          Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 40,
          `${theme}: claimed is grey, got ${String([cr, cg, cb])}`,
        );
      }

      await h.page.locator('.rev-line', { hasText: 'LC-1' }).click();
      await h.page.locator('.rev-line', { hasText: 'LC-2' }).click();
      await proof.locator('.ev-ci').waitFor({ timeout: 10_000 });
      assert.match(await proof.locator('.ev-ci').innerText(), /CI: 3 of 3 checks passed/);
      assert.equal(await proof.locator('.ev-merged-yes').innerText(), 'merged');
    } finally {
      await h.close();
    }
  });
});
