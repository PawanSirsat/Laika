/**
 * The Review dialog (D-146 item 3, LAI-1169) in a browser: a row opens a
 * labelled modal with the proof, the Ships list and the decision; Prev, Next
 * and the keys walk the queue as the page draws it; a decision advances;
 * Escape closes and gives focus back to the row; `?item=` deep-links; keys
 * typed into the Send back dialog over it reach nothing.
 *
 * With `LAIKA_SHOTS` set, the dialog open on a task with proof lands there
 * light and dark at 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { asServed, closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

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
    deliverables: [],
    ...over,
  });

const claimed = { state: 'claimed', state_source: null, state_at: null };

const ROUND = {
  id: 'r2',
  task_id: 't2',
  number: 2,
  finished_by: 'u1',
  client_name: 'omnigent on Belka',
  agent: { id: 'ag1', harness: 'omnigent', device_label: 'Belka' },
  by_registered_agent: true,
  summary_md: 'Parsed **nested lists** and added the round-trip test.',
  commits: [
    {
      id: 'e1',
      ...claimed,
      sha: 'abcdef0123456789abcdef0123456789abcdef01',
      message: 'feat: lists',
    },
  ],
  branch: { id: 'e2', ...claimed, name: 'LC-2-nested-lists' },
  pull_request: {
    id: 'e3',
    ...claimed,
    url: 'https://github.com/PawanSirsat/Laika/pull/43',
    merged: null,
  },
  tests: [{ id: 'e4', ...claimed, command: 'pnpm test', exit_code: 0 }],
  ci: null,
  created_at: NOW - 3 * HOUR,
};

const FIRST = task({ id: 't1', key: 'LC-1', number: 1, title: 'First in the queue' });
const PROVEN = task({
  id: 't2',
  key: 'LC-2',
  number: 2,
  title: 'Parser handles nested lists',
  deliverables: [
    { id: 'd1', title: 'Parser', detail: 'Nested lists round-trip', state: 'done' },
    { id: 'd2', title: 'Docs', detail: null, state: 'in_progress' },
    { id: 'd3', title: 'Migration note', detail: null, state: 'pending' },
  ],
});
const LAST = task({ id: 't3', key: 'LC-3', number: 3, title: 'Last in the queue' });

const PROJECT = { id: 'laika-core', slug: 'laika-core', name: 'Laika Core', prefix: 'LC' };

interface Row {
  task: Record<string, unknown>;
  round: typeof ROUND | null;
  waiting_since: number;
}

/** Three rows, oldest first; a decided one leaves the next read. */
function server(
  first: Row[] = [
    { task: FIRST, round: null, waiting_since: NOW - 26 * HOUR },
    { task: PROVEN, round: ROUND, waiting_since: NOW - 3 * HOUR },
    { task: LAST, round: null, waiting_since: NOW - HOUR },
  ],
): { stub: ApiStub; posts: () => string[]; drop: (id: string) => void } {
  const posts: string[] = [];
  let rows = first;
  /** Another reader decided it: the next read no longer lists it. */
  const drop = (id: string): void => {
    rows = rows.filter((r) => r.task.id !== id);
  };
  const decide = (id: string) => (call: { method: string; path: string }) => {
    posts.push(`${call.method} ${call.path}`);
    const row = rows.find((r) => r.task.id === id);
    rows = rows.filter((r) => r.task.id !== id);
    return { ...(row?.task ?? {}), status: 'done' };
  };
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/review': () => ({
      tasks: rows.map((r) => ({
        task: r.task,
        project: PROJECT,
        assignee_name: 'Ada Lovelace',
        waiting_since: r.waiting_since,
        round: r.round,
        finished_by_name: r.round === null ? null : 'Ada Lovelace',
        can_decide: true,
        cue: null,
      })),
      truncated: false,
    }),
    '/api/v1/tasks/t1/rounds': { rounds: [], send_back: null },
    '/api/v1/tasks/t2/rounds': { rounds: [ROUND], send_back: null },
    '/api/v1/tasks/t3/rounds': { rounds: [], send_back: null },
    '/api/v1/tasks/t1/accept': decide('t1'),
    '/api/v1/tasks/t2/accept': decide('t2'),
    '/api/v1/tasks/t3/accept': decide('t3'),
    '/api/v1/tasks/t2/send-back': decide('t2'),
  };
  return { stub, posts: () => posts, drop };
}

/** The page re-reads the queue when the tab comes back; this is that signal. */
const reread = (page: Page) =>
  page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

/** Hold every accept until the returned release is called. */
async function holdAccepts(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/api/v1/tasks/*/accept', async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  return release;
}

const dialog = (page: Page) => page.locator('[data-dialog="review"]');
const position = (page: Page) => dialog(page).locator('.rd-position');
const focusedIn = (page: Page) =>
  dialog(page).evaluate((el) => el.contains(document.activeElement));
const activeText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? null);

/**
 * Wait for `done`, then **assert** it: `until` returns on its timeout without
 * failing (harness.ts), so a wait alone is not a check.
 */
async function eventually(done: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  await until(done, ms);
  assert.ok(await done(), `never became true: ${String(done)}`);
}

async function openOn(key: string, stub: ApiStub, width = 1440) {
  const h = await open('/inbox?tab=review', stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
  await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
  await eventually(async () => (await h.page.locator('.rev-row').count()) === 3);
  await h.page.locator(`.rev-row[data-task="${key}"] .rev-line`).click();
  await dialog(h.page).waitFor({ timeout: 10_000 });
  return h;
}

void after(async () => {
  await closeBrowser();
});

void describe('the Review dialog (LAI-1169)', () => {
  void test('a row opens a labelled modal with the finish, the proof and Ships; focus is on Accept and Tab stays inside', async () => {
    const h = await openOn('LC-2', server().stub);
    try {
      const d = dialog(h.page);
      assert.equal(await d.getAttribute('role'), 'dialog');
      assert.equal(await d.getAttribute('aria-modal'), 'true');
      const labelledBy = (await d.getAttribute('aria-labelledby')) ?? '';
      assert.match(
        (await h.page.locator(`[id="${labelledBy}"]`).innerText()).replace(/\s+/g, ' '),
        /LC-2 Parser handles nested lists/,
      );
      assert.equal(new URL(h.page.url()).searchParams.get('item'), 't2');
      const head = await d.locator('.rd-sub').innerText();
      assert.match(head, /Laika Core/);
      assert.match(head, /Ada Lovelace/);
      assert.match(head, /Omnigent · Belka/);
      assert.match(head, /round 2/);
      assert.match(head, /waiting 3 h/);

      // The finish summary as Markdown, the proof read for this task, the Ships list.
      assert.match(await d.locator('.rd-summary strong').innerText(), /nested lists/);
      await d.locator('.ev-round[data-round="2"]').waitFor({ timeout: 10_000 });
      await eventually(async () => (await d.locator('.ev-state-claimed').count()) === 4);
      assert.ok(h.calls.some((c) => c.path === '/api/v1/tasks/t2/rounds'));
      const ships = d.locator('[data-section="ships"]');
      assert.equal(
        await ships.locator('.rd-ships-line').innerText(),
        '1 of 3 built · Docs in progress',
      );
      assert.deepEqual(
        await ships
          .locator('.rd-ships-row')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-state'))),
        ['done', 'in_progress', 'pending'],
      );
      assert.equal(await ships.locator('.dl-mark-done').count(), 1);
      assert.match(await position(h.page).innerText(), /^2 of 3$/);

      // Focus starts on Accept; forty Tabs each way never leave.
      assert.equal(await activeText(h.page), 'Accept');
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 20; i += 1) {
          await h.page.keyboard.press(key);
          assert.equal(await focusedIn(h.page), true, `${key} ×${String(i + 1)} left the dialog`);
        }
      }
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      await shoot(h.page, 'review-dialog-light-1440');
      await setTheme(h.page, 'Dark');
      await eventually(
        async () =>
          (await h.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !==
          'light',
      );
      const surface = await d.evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.notEqual(surface, 'rgb(255, 255, 255)', 'the dark dialog is white');
      await shoot(h.page, 'review-dialog-dark-1440');
    } finally {
      await h.close();
    }
  });

  void test('Prev, Next and the keys walk the rows as drawn; the ends stop', async () => {
    const h = await openOn('LC-1', server().stub);
    try {
      const d = dialog(h.page);
      assert.match(await position(h.page).innerText(), /^1 of 3$/);
      assert.equal(await d.getByRole('button', { name: 'Prev' }).isDisabled(), true);

      await h.page.keyboard.press('j');
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-2');
      assert.match(await position(h.page).innerText(), /^2 of 3$/);
      assert.equal(new URL(h.page.url()).searchParams.get('item'), 't2');
      // Moving on focuses the heading, so the next key is read from inside.
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.classList.contains('rd-title')),
        true,
      );
      await h.page.keyboard.press('ArrowDown');
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-3');
      assert.match(await position(h.page).innerText(), /^3 of 3$/);
      assert.equal(await d.getByRole('button', { name: 'Next' }).isDisabled(), true);
      await h.page.keyboard.press('j');
      await new Promise((done) => setTimeout(done, 200));
      assert.equal(await d.getAttribute('data-task'), 'LC-3', 'j past the end moved');

      await h.page.keyboard.press('k');
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-2');
      await d.getByRole('button', { name: 'Prev' }).click();
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-1');
      await h.page.keyboard.press('ArrowUp');
      await new Promise((done) => setTimeout(done, 200));
      assert.equal(await d.getAttribute('data-task'), 'LC-1', 'k before the start moved');
      // Prev and Next replace: one Back closes the dialog from wherever it walked.
      await d.getByRole('button', { name: 'Next' }).click();
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-2');
      await h.page.goBack();
      await d.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
    } finally {
      await h.close();
    }
  });

  void test('a posts the accept and the dialog advances; a decision on the last row closes', async () => {
    const s = server();
    const h = await openOn('LC-2', s.stub);
    try {
      const d = dialog(h.page);
      await h.page.keyboard.press('a');
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-3');
      assert.deepEqual(s.posts(), ['POST /api/v1/tasks/t2/accept']);
      await h.page
        .locator('.rev-row[data-task="LC-2"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      assert.match(await position(h.page).innerText(), /^2 of 2$/);
      assert.equal(new URL(h.page.url()).searchParams.get('item'), 't3');

      await d.getByRole('button', { name: 'Accept', exact: true }).click();
      await d.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(s.posts(), ['POST /api/v1/tasks/t2/accept', 'POST /api/v1/tasks/t3/accept']);
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
      // Focus went back to the queue, not to the page.
      assert.notEqual(await h.page.evaluate(() => document.activeElement?.tagName), 'BODY');
    } finally {
      await h.close();
    }
  });

  void test('s opens Send back over the dialog; typing a in its reason posts nothing; sending advances', async () => {
    const s = server();
    const h = await openOn('LC-2', s.stub);
    try {
      const d = dialog(h.page);
      await h.page.keyboard.press('s');
      const sendBack = h.page.getByRole('dialog', { name: 'Send back LC-2' });
      await sendBack.waitFor({ timeout: 10_000 });
      const field = sendBack.locator('textarea');
      assert.equal(await field.evaluate((el) => el === document.activeElement), true);
      // The Send back dialog is portaled beside this one: its keys are its own.
      await field.type('a reason: fix the docs');
      await new Promise((done) => setTimeout(done, 200));
      assert.deepEqual(s.posts(), [], 'a key typed in the reason reached the dialog');
      assert.equal(await d.getAttribute('data-task'), 'LC-2');
      assert.equal(await field.inputValue(), 'a reason: fix the docs');
      // A key on a control there that is not typed into — Cancel — is still
      // the Send back dialog's: this is the case the DOM containment guard
      // exists for, since React bubbles it through the tree to the dialog.
      await sendBack.getByRole('button', { name: 'Cancel' }).focus();
      await h.page.keyboard.press('a');
      await h.page.keyboard.press('j');
      await new Promise((done) => setTimeout(done, 200));
      assert.deepEqual(s.posts(), [], 'a on Cancel reached the Review dialog');
      assert.equal(await d.getAttribute('data-task'), 'LC-2', 'j on Cancel moved the dialog');
      assert.equal(await sendBack.count(), 1);
      await field.focus();

      // Escape there closes it alone and gives focus back to Send back…
      await h.page.keyboard.press('Escape');
      await sendBack.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await d.count(), 1, 'Escape in Send back closed the Review dialog too');
      await eventually(async () => (await activeText(h.page)) === 'Send back…');

      await d.getByRole('button', { name: 'Send back…' }).click();
      await sendBack.waitFor({ timeout: 10_000 });
      await sendBack.locator('textarea').fill('Fix the docs before review.');
      await sendBack.getByRole('button', { name: 'Send back' }).click();
      await sendBack.waitFor({ state: 'detached', timeout: 10_000 });
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-3');
      assert.deepEqual(s.posts(), ['POST /api/v1/tasks/t2/send-back']);
    } finally {
      await h.close();
    }
  });

  void test('Escape closes and focus returns to the row; a deep link opens directly; a stale one says so', async () => {
    const s = server();
    const h = await openOn('LC-2', s.stub);
    try {
      const d = dialog(h.page);
      await h.page.keyboard.press('Escape');
      await d.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
      await eventually(() =>
        h.page.evaluate(
          () =>
            document.activeElement?.closest('[data-task]')?.getAttribute('data-task') === 'LC-2' &&
            document.activeElement.classList.contains('rev-line'),
        ),
      );
      // The scrim closes too.
      await h.page.locator('.rev-row[data-task="LC-1"] .rev-line').click();
      await d.waitFor({ timeout: 10_000 });
      await h.page.locator('.rd-scrim').click({ position: { x: 5, y: 5 } });
      await d.waitFor({ state: 'detached', timeout: 10_000 });

      // A link straight to a task opens on it once the queue has loaded.
      await h.page.goto(`${h.origin}/inbox?tab=review&item=t3`);
      await d.waitFor({ timeout: 20_000 });
      assert.equal(await d.getAttribute('data-task'), 'LC-3');
      await eventually(async () => /^3 of 3$/.test(await position(h.page).innerText()));

      // A link to a task no longer waiting: no dialog, the param dropped, said once.
      await h.page.goto(`${h.origin}/inbox?tab=review&item=t-gone`);
      await h.page.locator('.rev-notice').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.rev-notice').innerText(),
        /That task is no longer waiting for review/,
      );
      assert.equal(await d.count(), 0);
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
    } finally {
      await h.close();
    }
  });

  void test('keys work after a click on the text, and after a — Escape closes an in-flight accept, which does not reopen it', async () => {
    const s = server();
    const h = await openOn('LC-1', s.stub);
    try {
      const d = dialog(h.page);
      // A click on the summary text: focus stays in the box, so j and Escape still read.
      await d.locator('.rd-sub').click();
      assert.equal(await focusedIn(h.page), true, 'a click on the text dropped focus to the page');
      await h.page.keyboard.press('j');
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-2');

      // a, with the request held: Accept is disabled, focus is on the heading, Escape closes.
      const release = await holdAccepts(h.page);
      await h.page.keyboard.press('a');
      await eventually(async () => (await d.getAttribute('aria-busy')) === 'true');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.classList.contains('rd-title')),
        true,
        'focus left the box when Accept was disabled',
      );
      // Prev / Next and their keys are held while the decision is out (item 4).
      assert.equal(await d.getByRole('button', { name: 'Next' }).isDisabled(), true);
      await h.page.keyboard.press('j');
      await new Promise((done) => setTimeout(done, 150));
      assert.equal(await d.getAttribute('data-task'), 'LC-2', 'j moved during a decision');
      await h.page.keyboard.press('Escape');
      await d.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);

      // The decision lands after the close: the row leaves, the dialog stays closed.
      release();
      await h.page
        .locator('.rev-row[data-task="LC-2"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      await new Promise((done) => setTimeout(done, 500));
      assert.equal(await d.count(), 0, 'a closed dialog reopened when the decision landed');
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
      assert.deepEqual(s.posts(), ['POST /api/v1/tasks/t2/accept']);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('the × during an in-flight accept keeps it closed', async () => {
    const s = server();
    const h = await openOn('LC-1', s.stub);
    try {
      const d = dialog(h.page);
      const release = await holdAccepts(h.page);
      await d.getByRole('button', { name: 'Accept', exact: true }).click();
      await eventually(async () => (await d.getAttribute('aria-busy')) === 'true');
      await d.getByRole('button', { name: 'Close' }).click();
      await d.waitFor({ state: 'detached', timeout: 10_000 });
      release();
      await h.page
        .locator('.rev-row[data-task="LC-1"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      await new Promise((done) => setTimeout(done, 500));
      assert.equal(await d.count(), 0, 'reopened after ×');
      assert.equal(new URL(h.page.url()).searchParams.get('item'), null);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a row a poll took before the decision landed is skipped on advance', async () => {
    const s = server();
    const h = await openOn('LC-1', s.stub);
    try {
      const d = dialog(h.page);
      const release = await holdAccepts(h.page);
      await h.page.keyboard.press('a');
      await eventually(async () => (await d.getAttribute('aria-busy')) === 'true');
      // Meanwhile somebody else decides LC-2, and the page re-reads.
      s.drop('t2');
      await reread(h.page);
      await h.page
        .locator('.rev-row[data-task="LC-2"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      release();
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-3');
      assert.equal(await d.getAttribute('data-task'), 'LC-3');
      assert.equal(new URL(h.page.url()).searchParams.get('item'), 't3');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a poll that takes the open item: the dialog says so, and Next goes to the row that was after it', async () => {
    const s = server();
    const h = await openOn('LC-2', s.stub);
    try {
      const d = dialog(h.page);
      s.drop('t2');
      await reread(h.page);
      await d.locator('.rd-gone').waitFor({ timeout: 10_000 });
      assert.match(await d.locator('.rd-gone').innerText(), /This task left the queue/);
      assert.equal(await d.getAttribute('data-task'), 'LC-2');
      assert.equal(await d.getByRole('button', { name: 'Accept', exact: true }).count(), 0);
      assert.equal(await d.getByRole('button', { name: 'Next' }).isDisabled(), false);
      await d.getByRole('button', { name: 'Next' }).click();
      await eventually(async () => (await d.getAttribute('data-task')) === 'LC-3');
      assert.match(await position(h.page).innerText(), /^2 of 2$/);
    } finally {
      await h.close();
    }
  });

  void test('is a full sheet on a phone, both themes, with no horizontal scroll', async () => {
    const h = await openOn('LC-2', server().stub, 390);
    try {
      const d = dialog(h.page);
      await d.locator('.ev-round').first().waitFor({ timeout: 10_000 });
      const box = await d.boundingBox();
      assert.ok(box !== null && box.x === 0 && Math.round(box.width) === 390, 'not a sheet');
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        'horizontal scroll at 390',
      );
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      await shoot(h.page, 'review-dialog-light-390');
      await setTheme(h.page, 'Dark');
      await eventually(
        async () =>
          (await h.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !==
          'light',
      );
      assert.ok(await d.isVisible());
      await shoot(h.page, 'review-dialog-dark-390');
    } finally {
      await h.close();
    }
  });
});
