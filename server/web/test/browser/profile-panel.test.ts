/**
 * The member profile's header ⋯ and the Manage member panel, in a real
 * browser (LAI-1134, design frames 1n–1s).
 *
 * `person-admin.test.ts` proves every control inside the panel still does
 * what it did; this file is about the panel as a thing a person operates: ⋯
 * is a menu button the keyboard opens, the panel is a modal that takes focus,
 * keeps it and gives it back to ⋯, it is a drawer on a desktop and a bottom
 * sheet on a phone, a question asked from inside it closes without closing
 * it, and the tabs are Overview · Day · Time report for somebody else and
 * absent for yourself.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, reply, setTheme, type ApiStub, type Harness } from './harness.ts';

const NOW = Date.now();
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [person('u1', 'Ada Owner', 'owner'), person('u2', 'Bea Builder', 'member')];

function profile(user: ReturnType<typeof person>) {
  const zeros = Array.from({ length: 12 }, (_, i) => ({
    week_start: NOW - (12 - i) * WEEK,
    accepted: 0,
    sent_back: 0,
  }));
  return {
    user: { ...user, profile_kind: 'builder', created_at: NOW - 100 * DAY },
    window: { weeks: 12, since: NOW - 12 * WEEK, until: NOW },
    projects: [],
    review: {
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: zeros,
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    },
    ratings: [],
    ratings_total: 0,
    activity_sharing: { org_enabled: false, enabled: false },
    current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
    delivery: {
      accepted_per_week: zeros.map((w) => ({ week_start: w.week_start, accepted: 0 })),
      accepted: 0,
      sent_back: 0,
      reopened: 0,
      cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
    },
    agents: {
      tokens: [],
      tokens_total: 0,
      online: { enabled: true, clients: [], last_seen: null },
      writes: [],
      writes_total: 0,
    },
  };
}

const quietActivity = () => {
  const zeros = () => new Array<number>(364).fill(0);
  return {
    range: '52w',
    start: new Date(NOW - 363 * DAY).toISOString().slice(0, 10),
    end: new Date(NOW).toISOString().slice(0, 10),
    tz: 'UTC',
    sharing: { org_enabled: false, enabled: false },
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: zeros(),
      board_agent: zeros(),
    },
    prompts_by_agent: {},
    agents: [],
  };
};

const quietUsage = (userId: string) => ({
  user_id: userId,
  from: '2026-07-27',
  to: '2026-10-18',
  weeks: [],
  totals: {
    tokens: 0,
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    attributed_tokens: 0,
    cost: { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] },
  },
  by_agent: [],
  by_model: [],
  no_token_data: [],
  sharing: { org_enabled: true, enabled: true },
});

/** The owner, reading Bea's profile (or their own). */
function stub(overrides: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': { ...PEOPLE[0]!, memberships: [] },
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users/u2/profile': profile(PEOPLE[1]!),
    '/api/v1/users/u1/profile': profile(PEOPLE[0]!),
    '/api/v1/users/u2/usage': quietUsage('u2'),
    '/api/v1/users/u1/usage': quietUsage('u1'),
    '/api/v1/people/u2/activity': quietActivity,
    '/api/v1/people/u1/activity': quietActivity,
    '/api/v1/users/u2/tokens': { data: [], next_cursor: null },
    '/api/v1/users/u2/memberships': { data: [] },
    ...overrides,
  };
}

const MORE = '[data-profile-manage] button[aria-haspopup="menu"]';
const PANEL = '[data-panel="manage-member"]';

async function at(path: string, width: number, overrides: ApiStub = {}): Promise<Harness> {
  return open(path, stub(overrides), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
}

/** Whether focus is on `selector` (the first match). */
const focusedOn = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => el === document.activeElement);

/** Open the panel by keyboard only: focus ⋯, ArrowDown, Enter on *Manage member…*. */
async function openByKeyboard(page: Page) {
  const more = page.locator(MORE);
  await more.waitFor({ timeout: 20_000 });
  await more.focus();
  await page.keyboard.press('ArrowDown');
  const item = page.getByRole('menuitem', { name: 'Manage member…' });
  await item.waitFor();
  assert.equal(await item.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  const panel = page.locator(PANEL);
  await panel.waitFor();
  return panel;
}

void after(async () => {
  await closeBrowser();
});

void describe('⋯ on the profile header', () => {
  void test('is a menu button named for the person, which the keyboard opens and Escape closes', async () => {
    const h = await at('/people?user=u2', 1440);
    try {
      const more = h.page.locator(MORE);
      await more.waitFor({ timeout: 20_000 });
      assert.equal(await more.getAttribute('aria-label'), 'Manage Bea Builder');
      assert.equal(await more.getAttribute('aria-expanded'), 'false');

      await more.focus();
      await h.page.keyboard.press('ArrowDown');
      const menu = h.page.getByRole('menu', { name: 'Manage Bea Builder' });
      await menu.waitFor();
      assert.equal(await more.getAttribute('aria-expanded'), 'true');
      // LAI-1152 put the profile's two links beside it.
      assert.deepEqual(
        (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')),
        [
          'Manage member… Role, spaces, security, deactivate',
          'Copy link to profile',
          'See Bea’s cards in Work',
        ],
      );

      await h.page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await focusedOn(h.page, MORE), true, 'Escape left focus off ⋯');
      // Nothing opened on the way.
      assert.equal(await h.page.locator(PANEL).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the Manage member panel', () => {
  void test('is a labelled modal: focus moves in, Tab stays inside, Escape gives it back to ⋯', async () => {
    const h = await at('/people?user=u2', 1440);
    try {
      const panel = await openByKeyboard(h.page);
      assert.equal(await panel.getAttribute('role'), 'dialog');
      assert.equal(await panel.getAttribute('aria-modal'), 'true');
      const labelledBy = (await panel.getAttribute('aria-labelledby')) ?? '';
      assert.equal(
        (await h.page.locator(`[id="${labelledBy}"]`).innerText()).trim(),
        'Manage member',
      );
      assert.match(await panel.innerText(), /Bea Builder\s*·\s*Member/);
      // Focus starts on Close.
      assert.equal(
        await panel
          .getByRole('button', { name: 'Close' })
          .evaluate((el) => el === document.activeElement),
        true,
      );

      // Forty Tabs, each way: focus never leaves the panel.
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 40; i += 1) {
          await h.page.keyboard.press(key);
          assert.equal(
            await panel.evaluate((el) => el.contains(document.activeElement)),
            true,
            `${key} ×${String(i + 1)} left the panel`,
          );
        }
      }

      await h.page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel) === document.activeElement,
        MORE,
      );
    } finally {
      await h.close();
    }
  });

  void test('the close button and the scrim close it, and focus goes back to ⋯', async () => {
    const h = await at('/people?user=u2', 1440);
    try {
      let panel = await openByKeyboard(h.page);
      await panel.getByRole('button', { name: 'Close' }).click();
      await panel.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel) === document.activeElement,
        MORE,
      );

      panel = await openByKeyboard(h.page);
      await h.page.locator('.side-panel-scrim').click({ position: { x: 20, y: 400 } });
      await panel.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel) === document.activeElement,
        MORE,
      );
    } finally {
      await h.close();
    }
  });

  void test('a right-hand drawer at 1440 and a bottom sheet at 390, in both themes, nothing sideways', async () => {
    for (const theme of ['Light', 'Dark']) {
      for (const width of [1440, 390]) {
        const h = await at('/people?user=u2', 1440);
        try {
          await h.page.locator(MORE).waitFor({ timeout: 20_000 });
          await setTheme(h.page, theme);
          await h.page.setViewportSize({ width, height: 900 });
          const panel = await openByKeyboard(h.page);
          await h.page.waitForTimeout(300);
          const box = await panel.boundingBox();
          assert.ok(box !== null);
          const where = `${theme} ${String(width)}`;
          if (width === 1440) {
            assert.ok(Math.abs(box.x + box.width - 1440) <= 1, `${where}: not at the right edge`);
            assert.ok(Math.abs(box.y) <= 1, `${where}: does not start at the top`);
            assert.ok(box.width <= 28 * 16 + 1, `${where}: ${String(box.width)}px wide`);
          } else {
            assert.ok(Math.abs(box.y + box.height - 900) <= 1, `${where}: not at the bottom`);
            assert.ok(box.y > 0, `${where}: a sheet covers the whole screen`);
            assert.ok(Math.abs(box.width - 390) <= 1, `${where}: ${String(box.width)}px wide`);
          }
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(overflow <= 0, `${where}: scrolls sideways by ${String(overflow)}px`);
          // Its sections, in the design's order, everything the owner holds.
          assert.deepEqual(
            await panel
              .locator('[data-admin]')
              .evaluateAll((els) => els.map((el) => el.getAttribute('data-admin'))),
            ['role', 'spaces', 'tokens', 'security', 'danger'],
          );
          // The panel's background is a card, not the page showing through.
          const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.notEqual(bg, 'rgba(0, 0, 0, 0)', `${where}: transparent panel`);
        } finally {
          await h.close();
        }
      }
    }
  });

  void test('Escape in the deactivate question closes the question, not the panel', async () => {
    const h = await at('/people?user=u2', 1440, {
      '/api/v1/users/u2': reply(409, {
        error: {
          code: 'conflict',
          message: 'They hold 1 open task',
          details: { reason: 'open_tasks', count: 1, keys: ['LC-1'], hidden: 0 },
        },
      }),
    });
    try {
      const panel = await openByKeyboard(h.page);
      await panel.locator('[data-action="deactivate"]').click();
      const dialog = h.page.locator('.offb-dialog');
      await dialog.waitFor();
      // The question is over the panel: its button takes a real click.
      await dialog.locator('[data-action="offboard-confirm"]').click();
      await dialog.locator('[data-held]').waitFor();
      // From inside the question, as a keyboard reader is: React bubbles a
      // portaled modal's keys through the panel that rendered it.
      await dialog.locator('input[value="unassign"]').focus();
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await panel.isVisible(), true, 'Escape closed the panel under the question');
      // Focus is handed back to the button that asked, inside the panel —
      // not dropped on body (review N2) …
      await h.page.waitForFunction(
        () =>
          document.activeElement?.matches(
            '[data-panel="manage-member"] [data-action="deactivate"]',
          ) === true,
      );
      // … so the next Escape is the panel's, and closes it.
      await h.page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel) === document.activeElement,
        MORE,
      );
    } finally {
      await h.close();
    }
  });

  void test('Cancel on the deactivate question gives focus back to Deactivate…', async () => {
    const h = await at('/people?user=u2', 1440);
    try {
      const panel = await openByKeyboard(h.page);
      await panel.locator('[data-action="deactivate"]').click();
      const dialog = h.page.locator('.offb-dialog');
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        () =>
          document.activeElement?.matches(
            '[data-panel="manage-member"] [data-action="deactivate"]',
          ) === true,
      );
    } finally {
      await h.close();
    }
  });

  void test('Escape on the profile kind’s (i) closes the tip, not the panel (review N1)', async () => {
    const h = await at('/people?user=u2', 1440);
    try {
      const panel = await openByKeyboard(h.page);
      const tip = panel.getByRole('button', { name: 'What the profile kinds mean' });
      await tip.focus();
      await h.page.keyboard.press('Enter');
      const pop = panel.locator('.prof-info-pop');
      await pop.waitFor();
      assert.equal(await tip.getAttribute('aria-expanded'), 'true');

      await h.page.keyboard.press('Escape');
      await pop.waitFor({ state: 'detached' });
      assert.equal(await panel.isVisible(), true, 'Escape on the tip closed the panel');
      assert.equal(await tip.evaluate((el) => el === document.activeElement), true);

      await h.page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
    } finally {
      await h.close();
    }
  });

  void test('while a reset link is shown, a click beside the panel keeps it; × still closes', async () => {
    const h = await at('/people?user=u2', 1440, {
      '/api/v1/users/u2/reset-link': () =>
        reply(201, {
          url: 'http://laika.test/reset-password?token=SHOWN-ONCE',
          expires_at: NOW + 3_600_000,
        }),
    });
    try {
      const panel = await openByKeyboard(h.page);
      const scrim = h.page.locator('.side-panel-scrim');
      await panel.locator('[data-action="reset-link"]').click();
      await panel.locator('[data-action="admin-confirm"]').click();
      await panel.locator('[data-reset-url]').waitFor();

      await scrim.click({ position: { x: 20, y: 400 } });
      await h.page.waitForTimeout(300);
      assert.equal(await panel.isVisible(), true, 'a stray click threw the reset link away');
      assert.equal(await panel.locator('[data-reset-url]').count(), 1);

      // Put away, the panel is an ordinary panel again.
      await panel.locator('[data-action="reset-done"]').click();
      await panel.locator('[data-reset-link]').waitFor({ state: 'detached' });
      await scrim.click({ position: { x: 20, y: 400 } });
      await panel.waitFor({ state: 'detached' });
    } finally {
      await h.close();
    }
  });
});

void describe('the profile’s tabs (LAI-1134)', () => {
  void test('somebody else: Overview · Day · Time report, and Developer setup not yet', async () => {
    const h = await at('/people?user=u2', 1440);
    try {
      const tabs = h.page.locator('[data-profile-tab]');
      await tabs.first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await tabs.allInnerTexts(), ['Overview', 'Day', 'Time report']);
      assert.equal(
        await h.page.locator('[data-profile-tab="overview"]').getAttribute('aria-current'),
        'page',
      );
      await h.page.locator('[data-profile-tab="time"]').click();
      await h.page.waitForURL(/tab=time/);
      assert.equal(
        await h.page.locator('[data-profile-tab="time"]').getAttribute('aria-current'),
        'page',
      );
    } finally {
      await h.close();
    }
  });

  void test('your own profile: all four tabs, Developer access by its own name (D-139)', async () => {
    const h = await at('/people?user=u1', 1440);
    try {
      await h.page.locator('.prof-head').waitFor({ timeout: 20_000 });
      await h.page.locator('.prof-card').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await h.page.locator('[data-profile-tab]').allInnerTexts(), [
        'Overview',
        'Day',
        'Time report',
        'Developer access',
      ]);
    } finally {
      await h.close();
    }
  });
});
