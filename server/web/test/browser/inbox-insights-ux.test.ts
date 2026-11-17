/**
 * The Inbox and Insights page bodies (LAI-1222): one structure on every tab —
 * a one-line summary, figures that *are* the filters, a grouped filter bar,
 * then the content.
 *
 * - Review: only a meaningful figure is drawn and each toggles its filter;
 *   the bar is scope | space and person | select-all, with no evidence
 *   buttons repeated in it; one evidence chip a row with its reason on the
 *   tooltip; a compact age coloured only once stale; Accept / Send back… on
 *   the row and the dialog's keys on the list.
 * - Unlisted work: the same figures-as-filters and row actions.
 * - Capacity: the card leads with load and two figures; the rest is behind
 *   Details.
 * - Phones: the figures scroll sideways, the narrowing filters fold behind
 *   *Filters*, cards are one column.
 *
 * Every wait is followed by an assert (LAI-1201: `until` returns silently).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { orgStub } from './capacity-org.ts';
import { answerConfirm } from './confirm.ts';
import {
  asServed,
  closeBrowser,
  open,
  reply,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { tipText } from './tooltip-probe.ts';

void after(async () => {
  await closeBrowser();
});

const NOW = Date.now();
const HOUR = 3_600_000;
const claimed = { state: 'claimed', state_source: null, state_at: null };

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};
const SPACE = { id: 'laika-core', slug: 'laika-core', name: 'Laika Core', prefix: 'LC' };

const task = (id: string, key: string, title: string) =>
  asServed({
    id,
    key,
    number: Number(key.split('-')[1]),
    project_id: 'laika-core',
    title,
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
  });

const round = (over: Record<string, unknown>) => ({
  id: 'r',
  task_id: 't',
  number: 1,
  finished_by: 'u1',
  client_name: null,
  agent: null,
  by_registered_agent: false,
  summary_md: 'Done',
  commits: [],
  branch: null,
  pull_request: null,
  tests: [],
  ci: null,
  created_at: NOW - HOUR,
  ...over,
});

/**
 * Three rows, oldest first: a bare one three days old (stale), one whose
 * tests failed, one with a commit and a passing run. No CI and no cue, so
 * those two figures are zero and must not be drawn.
 */
function reviewServer(): { stub: ApiStub; calls: StubCall[] } {
  const calls: StubCall[] = [];
  let rows = [
    { t: task('t1', 'LC-1', 'Bare and old'), round: null, since: NOW - 74 * HOUR },
    {
      t: task('t2', 'LC-2', 'Its tests failed'),
      round: round({ tests: [{ id: 'e1', ...claimed, command: 'pnpm test', exit_code: 1 }] }),
      since: NOW - 5 * HOUR,
    },
    {
      t: task('t3', 'LC-3', 'Committed and passing'),
      round: round({
        commits: [{ id: 'e2', ...claimed, sha: 'abcdef0123', message: 'x' }],
        tests: [{ id: 'e3', ...claimed, command: 'pnpm test', exit_code: 0 }],
      }),
      since: NOW - 2 * HOUR,
    },
  ];
  const decide = (id: string) => (call: StubCall) => {
    calls.push(call);
    const row = rows.find((r) => r.t.id === id);
    rows = rows.filter((r) => r.t.id !== id);
    return { ...(row?.t ?? {}), status: 'done', status_name: 'Done' };
  };
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/review': () => ({
      tasks: rows.map((r) => ({
        task: r.t,
        project: SPACE,
        assignee_name: 'Ada Lovelace',
        waiting_since: r.since,
        round: r.round,
        finished_by_name: r.round === null ? null : 'Ada Lovelace',
        can_decide: true,
        cue: null,
      })),
      truncated: false,
    }),
    '/api/v1/tasks/t1/accept': decide('t1'),
    '/api/v1/tasks/t2/accept': decide('t2'),
    '/api/v1/tasks/t3/accept': decide('t3'),
    '/api/v1/tasks/t2/send-back': decide('t2'),
  };
  return { stub, calls };
}

const keys = (page: Page) => page.locator('.rev-key').allInnerTexts();
const kpiIds = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-kpi]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kpi')));

async function openReview(width = 1440) {
  const server = reviewServer();
  const h = await open('/inbox?tab=review', server.stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    },
  });
  await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator('.rev-row').count()) === 3);
  assert.equal(await h.page.locator('.rev-row').count(), 3);
  return { h, server };
}

void describe('Review: the figures are the filters (LAI-1222)', () => {
  void test('only a meaningful figure is drawn; each toggles its filter; Waiting lifts them all', async () => {
    const { h } = await openReview();
    try {
      // Waiting, Failing tests and No proof — the zero CI and Check these are not drawn.
      assert.deepEqual(await kpiIds(h.page, '.rev-kpis'), ['waiting', 'failing', 'noEvidence']);
      const waiting = h.page.locator('[data-kpi="waiting"]');
      const failing = h.page.locator('[data-kpi="failing"]');
      assert.equal(await waiting.getAttribute('aria-pressed'), 'true');
      assert.match(await failing.innerText(), /Failing tests\s*1\s*of 3/);
      // A problem figure wears its colour; No proof does not.
      assert.match((await failing.getAttribute('class')) ?? '', /kpi-danger/);
      assert.doesNotMatch(
        (await h.page.locator('[data-kpi="noEvidence"]').getAttribute('class')) ?? '',
        /kpi-(danger|warning)/,
      );

      await failing.click();
      await until(async () => (await keys(h.page)).join() === 'LC-2');
      assert.deepEqual(await keys(h.page), ['LC-2']);
      assert.equal(await failing.getAttribute('aria-pressed'), 'true');
      assert.equal(await waiting.getAttribute('aria-pressed'), 'false');

      await waiting.click();
      await until(async () => (await keys(h.page)).length === 3);
      assert.deepEqual(await keys(h.page), ['LC-1', 'LC-2', 'LC-3']);
      assert.equal(await failing.getAttribute('aria-pressed'), 'false');

      // The oldest wait is the summary line's, compact.
      assert.match(
        await h.page.locator('.screen-embedded-context').innerText(),
        /oldest waiting 3d 2h/,
      );
    } finally {
      await h.close();
    }
  });

  void test('the bar is grouped — scope, then space and person, then select-all — with no evidence buttons in it', async () => {
    const { h } = await openReview();
    try {
      const bar = h.page.getByRole('group', { name: 'Filter the queue', exact: true });
      const groups = await bar
        .locator(':scope > .fbar-group')
        .evaluateAll((els: Element[]) => els.map((el) => el.className.replace('fbar-group ', '')));
      assert.deepEqual(groups, ['fbar-primary', 'fbar-filters', 'fbar-trailing']);
      const primary = bar.locator('.fbar-primary');
      assert.equal(await primary.getByRole('button', { name: 'For you to decide (3)' }).count(), 1);
      assert.equal(
        await bar.locator('.fbar-filters').getByRole('combobox', { name: 'Space' }).count(),
        1,
      );
      assert.equal(
        await bar.locator('.fbar-filters').getByRole('combobox', { name: 'Assignee' }).count(),
        1,
      );
      for (const word of ['Failing tests', 'No proof', 'CI failed', 'Check this one']) {
        assert.equal(await bar.getByRole('button', { name: word }).count(), 0, word);
      }

      // Select-all says how many it reaches, and reaches them.
      const all = bar.getByRole('checkbox', { name: /Select all 3/ });
      await all.check();
      const selected = h.page.getByRole('region', { name: 'Selected tasks' });
      await until(async () => /3\s+selected/.test(await selected.innerText()));
      assert.match(await selected.innerText(), /3\s+selected/);
      assert.match(await bar.locator('.rev-select-all').innerText(), /3 of 3 selected/);
    } finally {
      await h.close();
    }
  });
});

void describe('Review: a row (LAI-1222)', () => {
  void test('one quiet evidence chip a row, its reason on the tooltip; the age is compact and coloured only once stale', async () => {
    const { h } = await openReview();
    try {
      const chip = (key: string) => h.page.locator(`.rev-row[data-task="${key}"] .rev-evidence`);
      assert.deepEqual(
        await h.page
          .locator('.rev-evidence')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-evidence'))),
        ['none', 'tests_failed', 'attached'],
      );
      // One chip a row, never a pill per kind of proof.
      for (const key of ['LC-1', 'LC-2', 'LC-3']) {
        assert.equal(await h.page.locator(`.rev-row[data-task="${key}"] .chip`).count(), 1, key);
      }
      assert.equal((await chip('LC-1').innerText()).trim(), 'No proof');
      assert.match((await chip('LC-1').getAttribute('class')) ?? '', /chip-tone-neutral/);
      assert.match(await tipText(chip('LC-1')), /without a finish: no commits, branch/);
      assert.match(await tipText(chip('LC-3')), /1 commit, 1 test run/);

      const age = (key: string) => h.page.locator(`.rev-row[data-task="${key}"] .rev-wait`);
      assert.match(await age('LC-1').innerText(), /3d 2h$/);
      assert.equal(await age('LC-1').getAttribute('data-stale'), 'true');
      assert.match(await age('LC-2').innerText(), /5h$/);
      assert.equal(await age('LC-2').getAttribute('data-stale'), null);
      const stale = await age('LC-1').evaluate((el) => getComputedStyle(el).color);
      const fresh = await age('LC-2').evaluate((el) => getComputedStyle(el).color);
      assert.notEqual(stale, fresh, 'a stale age is drawn in the same ink as a fresh one');
      assert.match(await tipText(age('LC-1')), /^In review since /);
    } finally {
      await h.close();
    }
  });

  void test('Accept on the row posts at once and focus moves to the next row; Send back… asks for a reason', async () => {
    const { h, server } = await openReview();
    try {
      const row = h.page.locator('.rev-row[data-task="LC-1"]');
      const accept = h.page.getByRole('button', { name: 'Accept LC-1' });
      // Laid over the row until it is hovered or focused.
      assert.equal(await accept.evaluate((el) => getComputedStyle(el.parentElement!).opacity), '0');
      await row.hover();
      await until(
        async () =>
          (await accept.evaluate((el) => getComputedStyle(el.parentElement!).opacity)) === '1',
      );
      assert.equal(await accept.evaluate((el) => getComputedStyle(el.parentElement!).opacity), '1');
      await accept.click();
      await row.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(
        server.calls.map((c) => [c.method, c.path]),
        [['POST', '/api/v1/tasks/t1/accept']],
      );
      await until(
        async () =>
          (await h.page.evaluate(
            () => document.activeElement?.closest('.rev-row')?.getAttribute('data-task') ?? null,
          )) === 'LC-2',
      );
      assert.equal(
        await h.page.evaluate(
          () => document.activeElement?.closest('.rev-row')?.getAttribute('data-task') ?? null,
        ),
        'LC-2',
        'focus did not move to the next row',
      );
      // No Review dialog was opened for it.
      assert.equal(await h.page.locator('[data-dialog="review"]').count(), 0);

      await h.page.getByRole('button', { name: 'Send LC-2 back' }).click();
      const dialog = h.page.getByRole('dialog', { name: 'Send back LC-2' });
      await dialog.waitFor({ timeout: 10_000 });
      const send = dialog.getByRole('button', { name: 'Send back' });
      assert.equal(await send.isDisabled(), true, 'nothing is sent without a reason');
      await dialog.locator('textarea').fill('The test run exits 1.');
      await send.click();
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      const sent = server.calls.find((c) => c.path === '/api/v1/tasks/t2/send-back');
      assert.deepEqual(sent?.body, { reason: 'The test run exits 1.' });
    } finally {
      await h.close();
    }
  });

  void test('the rows answer the dialog keys: j and k move, a accepts the focused row, s sends it back', async () => {
    const { h, server } = await openReview();
    try {
      const focused = () =>
        h.page.evaluate(
          () => document.activeElement?.closest('.rev-row')?.getAttribute('data-task') ?? null,
        );
      await h.page.locator('.rev-row[data-task="LC-1"] .rev-line').focus();
      await h.page.keyboard.press('j');
      assert.equal(await focused(), 'LC-2');
      await h.page.keyboard.press('j');
      assert.equal(await focused(), 'LC-3');
      await h.page.keyboard.press('j');
      assert.equal(await focused(), 'LC-3', 'j past the end moved');
      await h.page.keyboard.press('k');
      assert.equal(await focused(), 'LC-2');

      await h.page.keyboard.press('s');
      const dialog = h.page.getByRole('dialog', { name: 'Send back LC-2' });
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.count(), 1);
      // Typing a reason with an `a` in it decides nothing.
      await dialog.locator('textarea').fill('a');
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(server.calls.length, 0, `a key posted: ${JSON.stringify(server.calls)}`);

      await h.page.locator('.rev-row[data-task="LC-3"] .rev-line').focus();
      await h.page.keyboard.press('a');
      await h.page
        .locator('.rev-row[data-task="LC-3"]')
        .waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(
        server.calls.map((c) => c.path),
        ['/api/v1/tasks/t3/accept'],
      );
      // Enter still opens the row in the dialog.
      await h.page.locator('.rev-row[data-task="LC-1"] .rev-line').focus();
      await h.page.keyboard.press('Enter');
      await h.page.locator('[data-dialog="review"]').waitFor({ timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('item'), 't1');
    } finally {
      await h.close();
    }
  });
});

void describe('Unlisted work: the same treatment (LAI-1222)', () => {
  const note = (id: string, hours: number, text: string, over: Record<string, unknown> = {}) => ({
    id,
    user_id: 'u1',
    token_id: 'tok1',
    repo: 'PawanSirsat/Laika',
    note: text,
    promoted_task_id: null,
    dismissed_at: null,
    created_at: NOW - hours * HOUR,
    ...over,
  });

  void test('To triage is a filter; a promoted note says so in a chip; Dismiss sits on an open row', async () => {
    let notes = [
      note('n1', 1, 'Open and from an agent.'),
      note('n2', 30, 'Became a task.', { promoted_task_id: 'x' }),
      note('n3', 50, 'Open and from a person.', { token_id: null }),
    ];
    const deleted: string[] = [];
    const h = await open('/inbox?tab=unlisted', {
      '/api/v1/me': ME,
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/users': {
        data: [{ id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', org_role: 'owner' }],
        next_cursor: null,
      },
      '/api/v1/unlisted': () => ({ data: notes, next_cursor: null }),
      '/api/v1/unlisted/n3': (call: StubCall) => {
        deleted.push(call.method);
        notes = notes.filter((n) => n.id !== 'n3');
        return reply(204, undefined);
      },
    });
    try {
      const lines = h.page.locator('.unl-line');
      await lines.first().waitFor({ timeout: 20_000 });
      await until(async () => (await lines.count()) === 3);
      assert.equal(await lines.count(), 3);
      assert.deepEqual(await kpiIds(h.page, '.unl-kpis'), ['all', 'pending', 'promoted']);

      const triage = h.page.locator('[data-kpi="pending"]');
      assert.match(await triage.innerText(), /To triage\s*2/);
      await triage.click();
      await until(async () => (await lines.count()) === 2);
      assert.equal(await lines.count(), 2);
      await triage.click();
      await until(async () => (await lines.count()) === 3);

      // Agents only, from the bar's scope.
      await h.page.getByRole('button', { name: 'Agents', exact: true }).click();
      await until(async () => (await lines.count()) === 2);
      assert.deepEqual(await h.page.locator('.unl-first').allInnerTexts(), [
        'Open and from an agent.',
        'Became a task.',
      ]);
      await h.page.getByRole('button', { name: 'Anyone', exact: true }).click();

      const promoted = h.page.locator('.unl-tag-promoted');
      assert.equal((await promoted.innerText()).trim(), 'Promoted');
      assert.equal(await promoted.getAttribute('data-chip'), 'status');
      // An open row says nothing on the line.
      assert.equal(await lines.first().locator('.chip').count(), 0);

      // Dismiss from the row, without opening it.
      const row = h.page.locator('.unl-row', { hasText: 'Open and from a person.' });
      await row.hover();
      await row.getByRole('button', { name: 'Dismiss the note from PawanSirsat/Laika' }).click();
      await answerConfirm(h.page, true);
      await until(() => deleted.length === 1);
      assert.deepEqual(deleted, ['DELETE']);
    } finally {
      await h.close();
    }
  });
});

void describe('Capacity: a card leads with what matters (LAI-1222)', () => {
  void test('load, one bar and two figures up front; the rest behind Details, which opens and closes', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      const pawan = h.page.locator('.cap-grid > .cap-card', { hasText: 'Pawan Sirsat' });
      await pawan.waitFor({ timeout: 20_000 });
      // The badges are the shared status Chip: Heavy, and overdue apart with its mark.
      assert.equal(await pawan.locator('.cap-load').getAttribute('data-chip'), 'status');
      assert.equal((await pawan.locator('.cap-load .chip-text').innerText()).trim(), 'Heavy');
      assert.equal(await pawan.locator('.cap-overdue [data-mark="alert"]').count(), 1);
      // Up front: one bar, in progress and to do, agents running, in review.
      assert.equal(await pawan.locator('.cap-bar').count(), 1);
      assert.equal(
        (await pawan.locator('.cap-counts').innerText()).replace(/\s+/g, ' ').trim(),
        '7 in progress 3 to do',
      );
      assert.match(await pawan.locator('.cap-keys').innerText(), /2\s*agents running/);
      // Closed: no spaces, agents list or activity in the page at all.
      const details = pawan.getByRole('button', { name: 'Show details for Pawan Sirsat' });
      assert.equal(await details.getAttribute('aria-expanded'), 'false');
      for (const block of ['.cap-spaces', '.cap-agents', '.cap-act', '.cap-waits']) {
        assert.equal(await pawan.locator(block).count(), 0, `${block} is drawn closed`);
      }

      await details.click();
      const hide = pawan.getByRole('button', { name: 'Hide details for Pawan Sirsat' });
      await hide.waitFor({ timeout: 5_000 });
      assert.equal(await hide.getAttribute('aria-expanded'), 'true');
      for (const block of ['.cap-spaces', '.cap-agents', '.cap-act', '.cap-waits']) {
        assert.equal(await pawan.locator(block).count(), 1, `${block} is not drawn open`);
      }
      // The activity bar has a legend carrying the numbers.
      assert.equal(await pawan.locator('.cap-figs .cap-act-swatch').count(), 3);
      // Only this card opened.
      assert.equal(
        await h.page
          .locator('.cap-grid > .cap-card', { hasText: 'Bea Nkosi' })
          .locator('.cap-details:not([hidden])')
          .count(),
        0,
      );

      await hide.click();
      await until(async () => (await pawan.locator('.cap-spaces').count()) === 0);
      assert.equal(await pawan.locator('.cap-spaces').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('phones (LAI-1222)', () => {
  void test('Review at 390: the figures scroll sideways, the filters fold behind Filters, nothing spills', async () => {
    const { h } = await openReview(390);
    try {
      const row = h.page.locator('.rev-kpis');
      assert.equal(await row.evaluate((el) => getComputedStyle(el).overflowX), 'auto');
      assert.equal(await row.evaluate((el) => getComputedStyle(el).display), 'flex');

      const space = h.page.getByRole('combobox', { name: 'Space' });
      const toggle = h.page.getByRole('button', { name: /^Filters/ });
      assert.equal(await toggle.isVisible(), true, 'no Filters button on a phone');
      assert.equal(await space.isVisible(), false, 'the filters are open on a phone');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await space.isVisible(), true, 'Filters opened nothing');
      // The scope stays on screen without opening anything.
      assert.equal(
        await h.page.getByRole('button', { name: 'For you to decide (3)' }).isVisible(),
        true,
      );
      // The row's actions are drawn under its line, not over it.
      assert.equal(
        await h.page
          .getByRole('button', { name: 'Accept LC-1' })
          .evaluate((el) => getComputedStyle(el.parentElement!).position),
        'static',
      );
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        'the page scrolls sideways at 390',
      );
    } finally {
      await h.close();
    }
  });

  void test('on a laptop there is no Filters button and the filters always show', async () => {
    const { h } = await openReview(1440);
    try {
      assert.equal(await h.page.getByRole('button', { name: /^Filters/ }).isVisible(), false);
      assert.equal(await h.page.getByRole('combobox', { name: 'Space' }).isVisible(), true);
    } finally {
      await h.close();
    }
  });

  void test('Capacity at 390: one card a row, figures in a sideways strip, nothing spills', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      await h.page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 2);
      const xs = await h.page
        .locator('.cap-grid > .cap-card')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
      assert.equal(new Set(xs).size, 1, `cards side by side at 390: ${xs.join(', ')}`);
      assert.equal(
        await h.page.locator('.cap-kpis').evaluate((el) => getComputedStyle(el).overflowX),
        'auto',
      );
      assert.equal(await h.page.getByRole('combobox', { name: 'Sort' }).isVisible(), false);
      await h.page.getByRole('button', { name: /^Filters/ }).click();
      assert.equal(await h.page.getByRole('combobox', { name: 'Sort' }).isVisible(), true);
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
    } finally {
      await h.close();
    }
  });
});
