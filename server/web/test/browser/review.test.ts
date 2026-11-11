/**
 * The review gate in a browser (D-082, LAI-758): the Review page, its badge,
 * the proof it opens, accept and send back; and the task panel's Proof
 * section and the card's "sent back" marker. Since D-146 (LAI-1168) the page
 * is a decision queue: it opens on what this reader may decide, grouped by
 * space, with a bulk Accept; *Everything in review* is a toggle away, and
 * the badge counts the decidable rows alone. A row opens the Review dialog
 * (LAI-1169; its keys and its walk are `review-dialog.test.ts`).
 *
 * With `LAIKA_SHOTS` set, the grouped queue with two rows ticked and the bar
 * showing lands there light and dark at 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const NOW = Date.now();
const HOUR = 3_600_000;

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

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

const ROUND_2 = {
  id: 'r2',
  task_id: 't1',
  number: 2,
  finished_by: 'u1',
  // The client's own word, which no screen shows as the agent (D-120).
  client_name: 'omnigent on Belka',
  agent: { id: 'ag1', harness: 'omnigent', device_label: 'Belka' } as {
    id: string;
    harness: string;
    device_label: string | null;
  } | null,
  by_registered_agent: true,
  summary_md: 'Fixed the lint run',
  commits: [
    { id: 'e1', ...claimed, sha: 'abcdef0123456789abcdef0123456789abcdef01', message: 'fix: lint' },
  ],
  branch: { id: 'e2', ...claimed, name: 'build-review-gate' },
  pull_request: {
    id: 'e3',
    ...claimed,
    url: 'https://github.com/PawanSirsat/Laika/pull/42',
    merged: null,
  },
  tests: [
    { id: 'e4', ...claimed, command: 'pnpm test', exit_code: 0 },
    { id: 'e5', ...claimed, command: 'pnpm lint', exit_code: 1 },
  ],
  ci: null,
  created_at: NOW - 3 * HOUR,
};
const ROUND_1 = {
  ...ROUND_2,
  id: 'r1',
  number: 1,
  // A legacy token finished round 1: no registered agent to name.
  client_name: 'codex-mcp-client',
  agent: null,
  by_registered_agent: false,
  commits: [],
  branch: null,
  pull_request: null,
  tests: [{ id: 'e6', ...claimed, command: 'pnpm lint', exit_code: 2 }],
  created_at: NOW - 30 * HOUR,
};

const WORKED = task({ id: 't1', key: 'LC-1', number: 1, title: 'Agents never mark done' });
const BARE = task({ id: 't2', key: 'LC-2', number: 2, title: 'Moved to review by hand' });
const REFUSED = task({ id: 't3', key: 'LC-3', number: 3, title: 'The server will refuse this' });
const THEIRS = task({
  id: 't4',
  key: 'LC-4',
  number: 4,
  title: 'Somebody else decides',
  assignee_id: 'u2',
});
const ORBIT_ROW = task({
  id: 't5',
  key: 'OR-5',
  number: 5,
  project_id: 'orbit',
  title: 'In another space',
});

const LAIKA_CORE = { id: 'laika-core', slug: 'laika-core', name: 'Laika Core', prefix: 'LC' };
const ORBIT = { id: 'orbit', slug: 'orbit', name: 'Orbit', prefix: 'OR' };

interface QueueRow {
  task: Record<string, unknown>;
  round: typeof ROUND_2 | null;
  waiting_since: number;
  cue?: { kind: 'fast'; build_ms: number; forecast_p50_ms: number } | null;
  /** Whether this reader may decide it; the server's word (default true). */
  can_decide?: boolean;
  project?: typeof LAIKA_CORE;
}

/**
 * Two spaces and a row the reader may not decide (D-146): oldest first,
 * Laika Core's LC-2 heads the page, Orbit's OR-5 is second in the queue but
 * grouped after it, LC-3 is refused by the server on accept, LC-4 waits on
 * someone else. Five in review, four for this reader.
 */
const WIDE: QueueRow[] = [
  { task: BARE, round: null, waiting_since: NOW - 26 * HOUR },
  { task: ORBIT_ROW, round: null, waiting_since: NOW - 10 * HOUR, project: ORBIT },
  { task: REFUSED, round: null, waiting_since: NOW - 5 * HOUR },
  { task: WORKED, round: ROUND_2, waiting_since: NOW - 3 * HOUR },
  { task: THEIRS, round: null, waiting_since: NOW - HOUR, can_decide: false },
];

/** A queue that shrinks when a task is decided, so the re-read can be seen. */
function server(
  first: QueueRow[] = [
    { task: BARE, round: null, waiting_since: NOW - 26 * HOUR },
    { task: WORKED, round: ROUND_2, waiting_since: NOW - 3 * HOUR },
  ],
): { stub: ApiStub; calls: () => StubCall[] } {
  const seen: StubCall[] = [];
  let rows: QueueRow[] = first;
  const queue = () => ({
    tasks: rows.map((r) => ({
      task: r.task,
      project: r.project ?? LAIKA_CORE,
      assignee_name: r.task.assignee_id === 'u2' ? 'Grace Hopper' : 'Ada Lovelace',
      waiting_since: r.waiting_since,
      round: r.round,
      finished_by_name: r.round === null ? null : 'Ada Lovelace',
      can_decide: r.can_decide ?? true,
      cue: r.cue ?? null,
    })),
    truncated: false,
  });
  const decide = (id: string) => (call: StubCall) => {
    seen.push(call);
    const row = rows.find((r) => r.task.id === id);
    rows = rows.filter((r) => r.task.id !== id);
    return { ...(row?.task ?? {}), status: 'done', status_name: 'Done' };
  };
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/review': () => queue(),
    '/api/v1/tasks/t1/rounds': { rounds: [ROUND_2, ROUND_1], send_back: null },
    '/api/v1/tasks/t2/rounds': { rounds: [], send_back: null },
    '/api/v1/tasks/t4/rounds': { rounds: [], send_back: null },
    '/api/v1/tasks/t1/accept': decide('t1'),
    '/api/v1/tasks/t2/accept': decide('t2'),
    // The server's word wins over the page's: LC-3 is refused however it is asked.
    '/api/v1/tasks/t3/accept': (call: StubCall) => {
      seen.push(call);
      return refuse(403, 'forbidden', 'Only the assignee or a space admin may accept this task.');
    },
    '/api/v1/tasks/t5/accept': decide('t5'),
    '/api/v1/tasks/t1/send-back': decide('t1'),
  };
  return { stub, calls: () => seen };
}

const inboxBadge = (page: Page) =>
  page.locator('.sidebar-link', { hasText: 'Inbox' }).locator('.sidebar-count');

void after(async () => {
  await closeBrowser();
});

void describe('the Review page', () => {
  void test('cues “check this one” on a finish far faster than forecast, and filters by it (LAI-772)', async () => {
    const h = await open(
      '/inbox?tab=review',
      server([
        { task: BARE, round: null, waiting_since: NOW - 26 * HOUR },
        {
          task: WORKED,
          round: ROUND_2,
          waiting_since: NOW - 3 * HOUR,
          cue: { kind: 'fast', build_ms: 60_000, forecast_p50_ms: 2 * HOUR },
        },
      ]).stub,
    );
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      const chip = h.page.locator('.rev-chip-check');
      await until(async () => (await chip.count()) === 1);
      assert.equal(await chip.count(), 1);
      assert.equal(await chip.innerText(), 'check this one');
      assert.match(
        (await chip.getAttribute('title')) ?? '',
        /Finished in 1 min against a forecast of 2 h, and CI has not confirmed it/,
      );
      assert.equal(await h.page.locator('[data-stat="check"] .prof-stat-value').innerText(), '1');
      await h.page.getByRole('button', { name: 'Check this one', exact: true }).click();
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-1']);
      // About the task, never the person: the cue names nobody.
      assert.doesNotMatch(await chip.innerText(), /Ada/);
    } finally {
      await h.close();
    }
  });

  void test('lists what waits, oldest first, with the proof summary and the badge', async () => {
    const h = await open('/inbox?tab=review', server().stub);
    try {
      const rows = h.page.locator('.rev-row');
      await rows.first().waitFor({ timeout: 20_000 });
      // Wait for both rows, not the first (LAI-715).
      await until(
        async () => (await h.page.locator('.rev-key').allInnerTexts()).join('|') === 'LC-2|LC-1',
      );
      assert.deepEqual(
        await h.page.locator('.rev-key').allInnerTexts(),
        ['LC-2', 'LC-1'],
        'oldest waiting first',
      );
      const worked = rows.nth(1);
      assert.match(await worked.innerText(), /1 commit/);
      assert.match(await worked.innerText(), /PR/);
      assert.match(await worked.innerText(), /✓ 1 passed/);
      assert.match(await worked.innerText(), /✗ 1 failed/);
      // The agent as harness and device (D-120), never the client's own word.
      assert.match(await worked.innerText(), /Omnigent · Belka/);
      assert.doesNotMatch(await worked.innerText(), /omnigent on Belka/);
      assert.match(await worked.innerText(), /round 2/);
      assert.match(await rows.first().innerText(), /no proof/);
      assert.match(await rows.first().innerText(), /1 d/);

      // The tab carries the count, and the sidebar's Inbox the same (LAI-796):
      // nothing is unlisted in this stub, so the sum is Review's alone.
      assert.match(await h.page.locator('.page-tab[data-tab="review"]').innerText(), /Review\s*2/);
      const badge = h.page.locator('.sidebar-link', { hasText: 'Inbox' }).locator('.sidebar-count');
      await badge.waitFor({ timeout: 10_000 });
      assert.match(await badge.innerText(), /^2/);

      // The filters mean what they say.
      await h.page.getByRole('button', { name: 'Failing tests', exact: true }).click();
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-1']);
      await h.page.getByRole('button', { name: 'Failing tests', exact: true }).click();
      await h.page.getByRole('button', { name: 'No proof', exact: true }).click();
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-2']);
    } finally {
      await h.close();
    }
  });

  void test('opening a row shows every item claimed, exit codes coloured, earlier rounds folded', async () => {
    const h = await open('/inbox?tab=review', server().stub);
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-1' }).click();
      // The proof opens in the Review dialog (LAI-1169), not under the row.
      const detail = h.page.locator('[data-dialog="review"]');
      await detail.locator('.ev-round').first().waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.rev-detail').count(), 0);
      assert.equal(new URL(h.page.url()).searchParams.get('item'), 't1');
      assert.match(await detail.locator('.rd-summary').innerText(), /Fixed the lint run/);
      const round2 = (cls: string) => detail.locator(`.ev-round[data-round="2"] ${cls}`);
      await until(
        async () =>
          (await round2('.ev-state-claimed').count()) === 5 &&
          (await round2('.ev-exit-pass').count()) === 1 &&
          (await round2('.ev-exit-fail').count()) === 1,
      );

      assert.equal(await detail.locator('.ev-round[data-round="2"] .ev-state-claimed').count(), 5);
      assert.equal(await detail.locator('.ev-round[data-round="2"] .ev-exit-pass').count(), 1);
      assert.equal(await detail.locator('.ev-round[data-round="2"] .ev-exit-fail').count(), 1);
      const link = detail.locator('a.ev-link');
      assert.equal(await link.getAttribute('href'), 'https://github.com/PawanSirsat/Laika/pull/42');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      // Who finished each round: the registered agent by its pair; the
      // legacy token's round by its client word, marked unregistered.
      assert.equal(
        await detail.locator('.ev-round[data-round="2"] .ev-agent').innerText(),
        'Omnigent · Belka',
      );
      assert.equal(
        await detail.locator('.ev-round[data-round="1"] .ev-agent').textContent(),
        'unregistered agent (codex-mcp-client)',
      );
      // Round 1 is kept, folded.
      const earlier = detail.locator('details.ev-earlier');
      assert.equal(await earlier.getAttribute('open'), null);
      assert.match(await earlier.locator('summary').innerText(), /Earlier round \(1\)/);
    } finally {
      await h.close();
    }
  });

  void test('accept posts, and the queue re-reads without it', async () => {
    const s = server();
    const h = await open('/inbox?tab=review', s.stub);
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-2' }).click();
      const dialog = h.page.locator('[data-dialog="review"]');
      await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
      await h.page
        .locator('.rev-key', { hasText: 'LC-2' })
        .waitFor({ state: 'detached', timeout: 10_000 });
      // LC-2 was the first of two: the dialog moved on to LC-1.
      await until(async () => (await dialog.getAttribute('data-task')) === 'LC-1');
      assert.equal(await dialog.getAttribute('data-task'), 'LC-1');
      assert.deepEqual(
        s.calls().map((c) => [c.method, c.path]),
        [['POST', '/api/v1/tasks/t2/accept']],
      );
    } finally {
      await h.close();
    }
  });

  void test('send back needs a reason, then posts it', async () => {
    const s = server();
    const h = await open('/inbox?tab=review', s.stub);
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-1' }).click();
      await h.page
        .locator('[data-dialog="review"]')
        .getByRole('button', { name: 'Send back…' })
        .click();
      const dialog = h.page.getByRole('dialog', { name: 'Send back LC-1' });
      await dialog.waitFor({ timeout: 10_000 });

      const send = dialog.getByRole('button', { name: 'Send back' });
      assert.equal(await send.isDisabled(), true, 'nothing is sent without a reason');
      await dialog.locator('textarea').fill('The lint run exits 1: fix it before review.');
      assert.equal(await send.isDisabled(), false);
      await send.click();
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });

      const call = s.calls().find((c) => c.path === '/api/v1/tasks/t1/send-back');
      assert.deepEqual(call?.body, { reason: 'The lint run exits 1: fix it before review.' });
      // LC-1 was the last row: the Review dialog closed with it.
      await h.page
        .locator('[data-dialog="review"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
    } finally {
      await h.close();
    }
  });

  void test('says so when nothing waits, in both themes', async () => {
    const h = await open('/inbox?tab=review', {
      '/api/v1/me': ME,
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/review': { tasks: [], truncated: false },
    });
    try {
      await h.page.getByText('Nothing waiting for review').waitFor({ timeout: 20_000 });
      await setTheme(h.page, 'Dark');
      await h.page.getByText('Nothing waiting for review').waitFor({ timeout: 5_000 });
      await setTheme(h.page, 'Light');
    } finally {
      await h.close();
    }
  });
});

void describe('the decision queue (D-146, LAI-1168)', () => {
  const keysIn = (page: Page, slug: string) =>
    page.locator(`.rev-group[data-space="${slug}"] .rev-key`).allInnerTexts();

  void test('opens on what this reader may decide, grouped by space, oldest space first', async () => {
    const h = await open('/inbox?tab=review', server(WIDE).stub);
    try {
      await h.page.locator('.rev-group').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.rev-row').count()) === 4);

      // The groups in order of their oldest task, each with its count.
      assert.deepEqual(await h.page.locator('.rev-group-title').allInnerTexts(), [
        'Laika Core',
        'Orbit',
      ]);
      assert.deepEqual(
        await h.page
          .locator('.rev-group-count')
          .evaluateAll((els) => els.map((el) => el.firstChild?.textContent)),
        ['3', '1'],
      );
      // Within a group the queue's order is kept; the row the reader may not
      // decide is not on this view at all.
      assert.deepEqual(await keysIn(h.page, 'laika-core'), ['LC-2', 'LC-3', 'LC-1']);
      assert.deepEqual(await keysIn(h.page, 'orbit'), ['OR-5']);
      assert.equal(await h.page.locator('.rev-row[data-task="LC-4"]').count(), 0);

      // The header, the toggle and the tiles say which view this is.
      assert.match(
        await h.page.locator('.screen-embedded-context').innerText(),
        /4 for you to decide · 5 in review/,
      );
      const mine = h.page.getByRole('button', { name: 'For you to decide (4)' });
      assert.equal(await mine.getAttribute('aria-pressed'), 'true');
      assert.equal(
        await h.page
          .getByRole('button', { name: 'Everything in review (5)' })
          .getAttribute('aria-pressed'),
        'false',
      );
      assert.equal(await h.page.locator('[data-stat="waiting"] .prof-stat-value').innerText(), '4');
      assert.match(
        await h.page.locator('.rev-summary .prof-card-caption').innerText(),
        /for you to decide/,
      );
      // The default view is not in the address.
      assert.equal(new URL(h.page.url()).searchParams.get('view'), null);

      // The tab and the sidebar's badge count the decidable rows, not the five.
      assert.match(await h.page.locator('.page-tab[data-tab="review"]').innerText(), /Review\s*4/);
      await inboxBadge(h.page).waitFor({ timeout: 10_000 });
      assert.match(await inboxBadge(h.page).innerText(), /^4/);
    } finally {
      await h.close();
    }
  });

  void test('Everything in review lists the rest read-only, at ?view=all, and the filters keep the view', async () => {
    const h = await open('/inbox?tab=review', server(WIDE).stub);
    try {
      await h.page.locator('.rev-group').first().waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Everything in review (5)' }).click();
      const theirs = h.page.locator('.rev-row[data-task="LC-4"]');
      await theirs.waitFor({ timeout: 10_000 });

      assert.equal(new URL(h.page.url()).searchParams.get('view'), 'all');
      assert.deepEqual(await keysIn(h.page, 'laika-core'), ['LC-2', 'LC-3', 'LC-1', 'LC-4']);
      assert.match(
        await h.page.locator('.rev-summary .prof-card-caption').innerText(),
        /everything in review/,
      );
      assert.equal(await h.page.locator('[data-stat="waiting"] .prof-stat-value').innerText(), '5');
      // The row the reader may not decide: no checkbox, no decisions — only
      // the board link and the reason.
      assert.equal(await theirs.locator('.rev-check').count(), 0);
      assert.equal(await h.page.locator('.rev-row[data-task="LC-1"] .rev-check').count(), 1);
      await theirs.locator('.rev-line').click();
      const dialog = h.page.locator('[data-dialog="review"]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.getByRole('button', { name: 'Accept', exact: true }).count(), 0);
      assert.equal(await dialog.getByRole('button', { name: 'Send back…' }).count(), 0);
      assert.equal(await dialog.getByRole('link', { name: 'Open on board' }).count(), 1);
      assert.match(await dialog.locator('.rev-why').innerText(), /Only the assignee/);
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      // The badge did not move: the view is the page's, the count is the reader's.
      assert.match(await inboxBadge(h.page).innerText(), /^4/);

      // A filter narrows the view without leaving it.
      await h.page.getByRole('button', { name: 'No proof', exact: true }).click();
      assert.deepEqual(await keysIn(h.page, 'laika-core'), ['LC-2', 'LC-3', 'LC-4']);
      assert.equal(new URL(h.page.url()).searchParams.get('view'), 'all');
      await h.page.getByRole('button', { name: 'No proof', exact: true }).click();

      // Back to the reader's own, and the address drops the view again.
      await h.page.getByRole('button', { name: 'For you to decide (4)' }).click();
      await theirs.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('view'), null);

      // A deep link opens on everything.
      await h.page.goto(`${h.origin}/inbox?tab=review&view=all`);
      await h.page.locator('.rev-row[data-task="LC-4"]').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page
          .getByRole('button', { name: 'Everything in review (5)' })
          .getAttribute('aria-pressed'),
        'true',
      );
    } finally {
      await h.close();
    }
  });

  void test('says so when every waiting task is somebody else’s, and offers the rest', async () => {
    const h = await open(
      '/inbox?tab=review',
      server([{ task: THEIRS, round: null, waiting_since: NOW - HOUR, can_decide: false }]).stub,
    );
    try {
      await h.page.getByText('Nothing for you to decide').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.screen-embedded-context').innerText(),
        /0 for you to decide · 1 in review/,
      );
      // No badge for nothing to decide: the tab shows 0 and the rail nothing.
      assert.match(await h.page.locator('.page-tab[data-tab="review"]').innerText(), /Review\s*0/);
      await h.page.getByRole('button', { name: 'Show everything in review' }).click();
      await h.page.locator('.rev-row[data-task="LC-4"]').waitFor({ timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('view'), 'all');
    } finally {
      await h.close();
    }
  });

  void test('a group’s box selects its decidable rows; Accept N posts one at a time, in page order, and reports the refusal', async () => {
    const s = server(WIDE);
    const h = await open('/inbox?tab=review', s.stub);
    try {
      await h.page.locator('.rev-group').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.rev-row').count()) === 4);
      const head = h.page.getByRole('checkbox', { name: 'Select every task in Laika Core' });
      const indeterminate = () => head.evaluate((el) => (el as HTMLInputElement).indeterminate);

      // One row ticked: the bar appears and the group's box is indeterminate.
      await h.page.getByRole('checkbox', { name: 'Select LC-2' }).click();
      const bar = h.page.getByRole('region', { name: 'Selected tasks' });
      await bar.waitFor({ timeout: 10_000 });
      assert.match(await bar.innerText(), /1\s+selected/);
      assert.equal(await indeterminate(), true);
      assert.equal(await head.isChecked(), false);
      assert.ok(
        await h.page
          .locator('.rev-row[data-task="LC-2"]')
          .evaluate((el) => el.classList.contains('rev-row-selected')),
      );

      // The group's box completes the group; Orbit's row is not in it.
      await head.click();
      await until(async () => /3\s+selected/.test(await bar.innerText()));
      assert.match(await bar.innerText(), /3\s+selected/);
      assert.equal(await indeterminate(), false);
      assert.equal(await head.isChecked(), true);
      assert.equal(await h.page.getByRole('checkbox', { name: 'Select OR-5' }).isChecked(), false);

      // Hold LC-3's refusal so the run can be seen mid-way: the progress
      // line counts what has been tried and the boxes hold still.
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await h.page.route('**/api/v1/tasks/t3/accept', async (route) => {
        await held;
        await route.continue();
      });

      await bar.getByRole('button', { name: 'Accept 3' }).click();
      const progress = bar.locator('.rev-bulk-progress');
      await progress.waitFor({ timeout: 10_000 });
      await until(async () => (await progress.innerText()).includes('Accepting 1 of 3…'));
      assert.equal(await progress.innerText(), 'Accepting 1 of 3…');
      assert.equal(await head.isDisabled(), true);
      assert.equal(await h.page.getByRole('checkbox', { name: 'Select OR-5' }).isDisabled(), true);
      assert.equal(await bar.getByRole('button', { name: 'Accept 3' }).isDisabled(), true);
      release();

      const report = bar.locator('.rev-bulk-report');
      await report.waitFor({ timeout: 10_000 });
      // One request per task, in the order the page drew them — not the
      // order they were ticked, not in parallel.
      assert.deepEqual(
        s.calls().map((c) => [c.method, c.path]),
        [
          ['POST', '/api/v1/tasks/t2/accept'],
          ['POST', '/api/v1/tasks/t3/accept'],
          ['POST', '/api/v1/tasks/t1/accept'],
        ],
      );
      assert.match(await report.locator('.rev-bulk-summary').innerText(), /2 accepted, 1 refused/);
      assert.deepEqual(await report.locator('.rev-bulk-refusal').allInnerTexts(), [
        'LC-3 — Only the assignee or a space admin may accept this task.',
      ]);

      // The accepted rows left with the re-read; the refused one is still
      // ticked, so a retry is one click; the badge followed.
      await h.page
        .locator('.rev-row[data-task="LC-2"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      await h.page
        .locator('.rev-row[data-task="LC-1"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(await keysIn(h.page, 'laika-core'), ['LC-3']);
      assert.equal(await h.page.getByRole('checkbox', { name: 'Select LC-3' }).isChecked(), true);
      assert.match(await bar.innerText(), /1\s+selected/);
      await until(async () => (await inboxBadge(h.page).innerText()).startsWith('2'));
      assert.match(await inboxBadge(h.page).innerText(), /^2/);

      await bar.getByRole('button', { name: 'Dismiss' }).click();
      assert.equal(await report.count(), 0);
      await bar.getByRole('button', { name: 'Clear selection' }).click();
      await bar.waitFor({ state: 'detached', timeout: 5_000 });
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
    } finally {
      await h.close();
    }
  });

  void test('a ticked row hidden by a filter or a view change is not posted, and the count drops', async () => {
    const s = server(WIDE);
    const h = await open('/inbox?tab=review', s.stub);
    try {
      await h.page.locator('.rev-group').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.rev-row').count()) === 4);
      await h.page.getByRole('checkbox', { name: 'Select LC-2' }).click();
      await h.page.getByRole('checkbox', { name: 'Select LC-1' }).click();
      const bar = h.page.getByRole('region', { name: 'Selected tasks' });
      await until(async () => /2\s+selected/.test(await bar.innerText()));
      assert.match(await bar.innerText(), /2\s+selected/);

      // *No proof* hides LC-1: the bar counts one and Accept 1 posts one.
      await h.page.getByRole('button', { name: 'No proof', exact: true }).click();
      await h.page.locator('.rev-row[data-task="LC-1"]').waitFor({ state: 'detached' });
      await until(async () => /1\s+selected/.test(await bar.innerText()));
      assert.match(await bar.innerText(), /1\s+selected/);
      await bar.getByRole('button', { name: 'Accept 1' }).click();
      await bar.locator('.rev-bulk-report').waitFor({ timeout: 10_000 });
      assert.deepEqual(
        s.calls().map((c) => [c.method, c.path]),
        [['POST', '/api/v1/tasks/t2/accept']],
        'a hidden row was posted',
      );
      await bar.getByRole('button', { name: 'Dismiss' }).click();
      await h.page.getByRole('button', { name: 'No proof', exact: true }).click();

      // A view change clears the selection outright.
      await h.page.getByRole('checkbox', { name: 'Select OR-5' }).click();
      await until(async () => /1\s+selected/.test(await bar.innerText()));
      await h.page.getByRole('button', { name: /Everything in review/ }).click();
      await h.page.locator('.rev-row[data-task="LC-4"]').waitFor({ timeout: 10_000 });
      await bar.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await h.page.getByRole('checkbox', { name: 'Select OR-5' }).isChecked(), false);
    } finally {
      await h.close();
    }
  });

  /** The page with two rows ticked and the bar showing, at `width`. */
  async function ticked(width: number, height: number) {
    const h = await open('/inbox?tab=review', server(WIDE).stub, {
      before: async (page) => {
        await page.setViewportSize({ width, height });
      },
    });
    await h.page.locator('.rev-group').first().waitFor({ timeout: 20_000 });
    await until(async () => (await h.page.locator('.rev-row').count()) === 4);
    await h.page.getByRole('checkbox', { name: 'Select LC-2' }).click();
    await h.page.getByRole('checkbox', { name: 'Select OR-5' }).click();
    const bar = h.page.getByRole('region', { name: 'Selected tasks' });
    await until(async () => /2\s+selected/.test(await bar.innerText()));
    assert.match(await bar.innerText(), /2\s+selected/);
    await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
    return { h, bar };
  }

  /** Dark is the bare `:root` — no attribute at all (LAI-606). */
  const themed = (page: Page, theme: 'Dark' | 'Light') =>
    until(
      async () =>
        ((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) ===
          'light') ===
        (theme === 'Light'),
    );

  void test('the bar is drawn in both themes at a laptop width', async () => {
    const { h, bar } = await ticked(1440, 900);
    try {
      await shoot(h.page, 'review-grouped-selected-light-1440');
      await setTheme(h.page, 'Dark');
      await themed(h.page, 'Dark');
      assert.ok(await bar.isVisible(), 'the bar is drawn in dark');
      // The bar sits on the card's surface in dark too, not on a light one.
      const surface = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
      const pageBg = await h.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notEqual(surface, 'rgb(255, 255, 255)', `the dark bar is white: ${pageBg}`);
      await shoot(h.page, 'review-grouped-selected-dark-1440');
    } finally {
      await h.close();
    }
  });

  void test('the bar fits a phone, both themes, with no horizontal scroll', async () => {
    // A fresh page at 390, not a resized laptop one: the off-canvas sidebar's
    // state is decided at first paint.
    const { h, bar } = await ticked(390, 844);
    try {
      const box = await h.page.locator('.rev-bulk').boundingBox();
      assert.ok(box !== null && box.x >= 0 && box.x + box.width <= 390, 'the bar fits the phone');
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        'no horizontal scroll at 390',
      );
      await shoot(h.page, 'review-grouped-selected-light-390');
      await setTheme(h.page, 'Dark');
      await themed(h.page, 'Dark');
      assert.ok(await bar.isVisible(), 'the bar is drawn in dark');
      await shoot(h.page, 'review-grouped-selected-dark-390');
    } finally {
      await h.close();
    }
  });
});

void describe('the task panel and the card (D-082)', () => {
  const SENT = task({
    id: 't7',
    key: 'LC-7',
    number: 7,
    title: 'Sent back once',
    status: 'in_progress',
    send_back: {
      reason_md: 'The lint run exits 1.',
      decided_by: 'u1',
      created_at: NOW - HOUR,
    },
  });
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [{ ...CORE, task_counts: {}, members: [] }], next_cursor: null },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: [SENT], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t7&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/tasks/t7': SENT,
    '/api/v1/tasks/t7/comments': {
      data: [
        {
          id: 'c1',
          task_id: 't7',
          author_id: 'u1',
          body_md: 'The lint run exits 1.',
          created_via: 'web',
          edited_at: null,
          sent_back: true,
          created_at: NOW - HOUR,
          updated_at: NOW - HOUR,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/tasks/t7/watchers': { watchers: [] },
    '/api/v1/tasks/t7/rounds': {
      rounds: [{ ...ROUND_1, task_id: 't7' }],
      send_back: null,
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };

  void test('the card is marked and the panel reads the reason, then the proof', async () => {
    const h = await open('/board?project=laika-core', stub);
    try {
      const card = h.page.locator('.card', { hasText: 'Sent back once' }).first();
      await card.waitFor({ timeout: 20_000 });
      const marker = card.locator('.marker-sent-back');
      assert.match(await marker.innerText(), /sent back/);
      assert.equal(await marker.getAttribute('title'), 'Sent back: The lint run exits 1.');

      await card.click();
      const panel = h.page.locator('.drawer');
      await panel.locator('[data-section="proof"] .ev-round').waitFor({ timeout: 10_000 });
      const proof = panel.locator('[data-section="proof"]');
      assert.match(await proof.locator('.ev-sendback').innerText(), /The lint run exits 1\./);
      await until(
        async () =>
          (await proof.locator('.ev-exit-fail').count()) === 1 &&
          (await proof.locator('.ev-state-claimed').count()) === 1,
      );
      assert.equal(await proof.locator('.ev-exit-fail').count(), 1);
      assert.equal(await proof.locator('.ev-state-claimed').count(), 1);
      await panel.locator('.cmt-sent-back').first().waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });
});
