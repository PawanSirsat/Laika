/**
 * The overlay contract (LAI-1205), in a real browser, under the real CSP:
 *
 * - a Dialog is a labelled modal that takes focus, holds it, and hands it
 *   back, and locks the page's scroll while it is open;
 * - Escape closes **only the top layer** — a Dropdown open inside a dialog or
 *   the side panel closes first, then the dialog, never both at once;
 * - a Dropdown opened inside the side panel is drawn over it (B16);
 * - the backdrop closes a dialog and never a destructive one;
 * - on a phone a Dialog is a bottom sheet;
 * - under reduced motion nothing transitions;
 * - none of it trips the Content-Security-Policy.
 *
 * **The CSP is served here, not assumed.** The harness serves the SPA with no
 * policy at all (`harness.ts`), so a library that injected a `<style>` would
 * pass every other browser test. Each page here is served with the policy's
 * script and style directives, and the first thing each test does is prove
 * the policy is live by injecting a `<style>` and watching it be refused.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, until, type ApiStub, type Harness } from './harness.ts';

/* --- the CSP ------------------------------------------------------------- */

/**
 * The directives of `buildContentSecurityPolicy` (server/src/http/
 * security-headers.ts) that decide whether runtime script or style is
 * allowed, with the inline `<style>` hashes computed the way the server does.
 * Copied rather than imported: this package's `rootDir` is `server/web`.
 */
function policy(html: string): string {
  const hashes = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem ${["'self'", ...hashes].join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}

async function withCsp(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(event.effectiveDirective + ' ' + event.blockedURI);
      });
    `,
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body,
      headers: { ...response.headers(), 'content-security-policy': policy(body) },
    });
  });
}

const violations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

/** Check the check: an injected `<style>` must be refused, or the CSP is not on. */
async function assertCspLive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = 'body { outline: 1px solid; }';
    document.head.append(style);
    style.remove();
  });
  await until(async () => (await violations(page)).length > 0);
  const seen = await violations(page);
  assert.ok(
    seen.some((v) => v.startsWith('style-src-elem')),
    `the CSP is not being enforced — an injected <style> was allowed (${JSON.stringify(seen)})`,
  );
  await page.evaluate(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
  });
}

/* --- a board with two "to do" columns, so To do can be deleted ------------ */

const PROJECT = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'Something already on the board',
  description_md: null,
  acceptance_md: null,
  status: 'todo',
  status_id: 'st-todo',
  status_name: 'To do',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: true,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
};

const BOARD: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [PROJECT], next_cursor: null },
  '/api/v1/projects/laika-core': PROJECT,
  '/api/v1/projects/laika-core/statuses': {
    data: [
      ['st-todo', 'To do', 'todo', false],
      ['st-doing', 'In progress', 'in_progress', false],
      ['st-done', 'Done', 'done', false],
      ['st-later', 'Later', 'todo', false],
      ['st-backlog', 'Backlog', 'backlog', true],
      ['st-review', 'Review', 'review', true],
      ['st-cancelled', 'Cancelled', 'cancelled', true],
    ].map(([id, name, category, hidden], position) => ({
      id,
      project_id: 'p1',
      name,
      category,
      position,
      hidden,
      created_at: 1,
      task_count: 0,
    })),
  },
  '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/presence': { data: [], next_cursor: null },
};

async function board(width = 1440, reducedMotion = false): Promise<Harness> {
  const h = await open('/board?project=laika-core', BOARD, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 860 });
      if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
      await withCsp(page);
    },
  });
  try {
    await h.page.locator('.lane-title').first().waitFor({ timeout: 20_000 });
    await assertCspLive(h.page);
  } catch (cause) {
    // A setup that fails must still close: an open stub server keeps the
    // test process alive for ever (found by mutating the CSP check, LAI-1205).
    await h.close();
    throw cause;
  }
  return h;
}

/* --- the Manage member side panel, which holds a Dropdown ----------------- */

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

const PEOPLE_STUB: ApiStub = {
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
  '/api/v1/me/profile': profile(PEOPLE[0]!),
  '/api/v1/me/activity': quietActivity,
  '/api/v1/users/u2/usage': quietUsage('u2'),
  '/api/v1/users/u1/usage': quietUsage('u1'),
  '/api/v1/people/u2/activity': quietActivity,
  '/api/v1/people/u1/activity': quietActivity,
  '/api/v1/users/u2/tokens': { data: [], next_cursor: null },
  '/api/v1/users/u2/memberships': { data: [] },
};

const MORE = '[data-profile-manage] button[aria-haspopup="menu"]';
const PANEL = '[data-panel="manage-member"]';

/* --- helpers --------------------------------------------------------------- */

const focusedInside = (box: Locator): Promise<boolean> =>
  box.evaluate((el) => el.contains(document.activeElement));

const isFocused = (l: Locator): Promise<boolean> =>
  l.evaluate((el) => el === document.activeElement);

const locked = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.classList.contains('overlay-scroll-locked'));

/** The Dropdown's list is the thing actually drawn at its own centre. */
const listOnTop = (page: Page): Promise<boolean> =>
  page.locator('[data-dropdown-panel]').evaluate((p) => {
    const r = p.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && p.contains(hit);
  });

async function openDeleteToDo(h: Harness): Promise<Locator> {
  const menu = h.page.getByRole('button', { name: 'Column menu for To do', exact: true });
  await menu.focus();
  await menu.click();
  await h.page.getByRole('menuitem', { name: 'Delete column' }).click();
  const dialog = h.page.getByRole('dialog', { name: 'Delete “To do”?', exact: true });
  await dialog.waitFor({ timeout: 5_000 });
  return dialog;
}

void after(async () => {
  await closeBrowser();
});

/* --- the tests ------------------------------------------------------------- */

void describe('a Dialog (LAI-1205)', () => {
  void test('is a labelled modal: focus in, held, handed back; the page does not scroll', async () => {
    const h = await board();
    try {
      const tile = h.page.locator('.lane-new');
      await tile.focus();
      await h.page.keyboard.press('Enter');
      const dialog = h.page.getByRole('dialog', { name: 'Add column', exact: true });
      await dialog.waitFor({ timeout: 5_000 });

      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      // Focus starts on the field the dialog exists to fill.
      await until(() => isFocused(dialog.locator('.cd-input')));
      assert.equal(await isFocused(dialog.locator('.cd-input')), true, 'focus is not on Name');
      assert.equal(await locked(h.page), true, 'the page behind still scrolls');

      // Tab all the way round, twice over: focus never leaves the dialog.
      const stops = await dialog.evaluate(
        (el) =>
          el.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ).length,
      );
      for (let i = 0; i < stops * 2 + 1; i++) {
        await h.page.keyboard.press('Tab');
        assert.equal(await focusedInside(dialog), true, `Tab ${String(i + 1)} left the dialog`);
      }
      for (let i = 0; i < stops + 1; i++) {
        await h.page.keyboard.press('Shift+Tab');
        assert.equal(await focusedInside(dialog), true, `Shift+Tab ${String(i + 1)} left it`);
      }

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
      await until(() => isFocused(tile));
      assert.equal(await isFocused(tile), true, 'focus did not go back to the tile');
      assert.equal(await locked(h.page), false, 'the scroll lock outlived the dialog');
      assert.deepEqual(await violations(h.page), [], 'the dialog tripped the CSP');
    } finally {
      await h.close();
    }
  });

  void test('the backdrop closes a dialog, never a delete', async () => {
    const h = await board();
    try {
      await h.page.locator('.lane-new').click();
      const add = h.page.getByRole('dialog', { name: 'Add column', exact: true });
      await add.waitFor({ timeout: 5_000 });
      await h.page.locator('[data-overlay-scrim]').click({ position: { x: 8, y: 8 } });
      await add.waitFor({ state: 'detached', timeout: 5_000 });

      const del = await openDeleteToDo(h);
      await h.page.locator('[data-overlay-scrim]').click({ position: { x: 8, y: 8 } });
      await h.page.waitForTimeout(300);
      assert.equal(await del.count(), 1, 'a click beside a delete closed it');
      await del.getByRole('button', { name: 'Cancel' }).click();
      await del.waitFor({ state: 'detached', timeout: 5_000 });
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('Escape closes only the top layer: the picker inside, then the dialog', async () => {
    const h = await board();
    try {
      const del = await openDeleteToDo(h);
      const picker = del.getByRole('combobox');
      await until(() => isFocused(picker));
      await picker.click();
      const list = h.page.locator('[data-dropdown-panel]');
      await list.waitFor({ timeout: 5_000 });
      assert.equal(await listOnTop(h.page), true, 'the list is drawn under the dialog');

      await h.page.keyboard.press('Escape');
      await list.waitFor({ state: 'detached', timeout: 5_000 });
      await h.page.waitForTimeout(200);
      assert.equal(await del.count(), 1, 'one Escape closed the dialog with the list');
      assert.equal(await locked(h.page), true);

      await h.page.keyboard.press('Escape');
      await del.waitFor({ state: 'detached', timeout: 5_000 });
      const menu = h.page.getByRole('button', { name: 'Column menu for To do', exact: true });
      await until(() => isFocused(menu));
      assert.equal(await isFocused(menu), true, 'focus did not go back to the column menu');
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('on a phone it is a bottom sheet the width of the screen', async () => {
    const h = await board(390);
    try {
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Add column', exact: true });
      await dialog.waitFor({ timeout: 5_000 });
      const g = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: innerWidth - r.right, bottom: innerHeight - r.bottom };
      });
      assert.deepEqual(g, { left: 0, right: 0, bottom: 0 }, 'not a sheet on the bottom edge');
      // Its buttons are full width, the action on top.
      const [cancel, add] = await Promise.all([
        dialog.getByRole('button', { name: 'Cancel' }).boundingBox(),
        dialog.getByRole('button', { name: 'Add column' }).boundingBox(),
      ]);
      assert.ok(cancel !== null && add !== null);
      assert.ok(add.y < cancel.y, 'the action is not above Cancel');
      assert.ok(cancel.width > 300, `Cancel is ${String(cancel.width)}px, not full width`);
    } finally {
      await h.close();
    }
  });
});

void describe('motion (LAI-1205)', () => {
  void test('a dialog fades in, and its rows rise; the box itself never transforms', async () => {
    const h = await board();
    try {
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Add column', exact: true });
      await dialog.waitFor({ timeout: 5_000 });
      const m = await dialog.evaluate((el) => {
        const box = getComputedStyle(el);
        const head = getComputedStyle(el.querySelector('.overlay-dialog-head')!);
        return {
          boxProps: box.transitionProperty,
          boxMs: box.transitionDuration,
          boxTransform: box.transform,
          headProps: head.transitionProperty,
        };
      });
      assert.equal(m.boxProps, 'opacity');
      // --overlay-in is --duration-base, motion.css's dialog token (LAI-1208).
      assert.equal(m.boxMs, '0.18s');
      assert.equal(m.boxTransform, 'none', 'the box transforms — a list portaled into it moves');
      assert.equal(m.headProps, 'transform');
    } finally {
      await h.close();
    }
  });

  void test('under reduced motion nothing transitions', async () => {
    const h = await board(1440, true);
    try {
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Add column', exact: true });
      await dialog.waitFor({ timeout: 5_000 });
      const running = await h.page.evaluate(
        () =>
          document.querySelector('[data-overlay-layer]')?.getAnimations({ subtree: true }).length ??
          -1,
      );
      assert.equal(running, 0, `${String(running)} transitions ran under reduced motion`);
      assert.equal(await dialog.evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
    } finally {
      await h.close();
    }
  });
});

void describe('the side panel (LAI-1205, B16)', () => {
  void test('a Dropdown inside it is drawn over it, and Escape closes the list before the panel', async () => {
    const h = await open('/people?user=u2', PEOPLE_STUB, {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await withCsp(page);
      },
    });
    try {
      const more = h.page.locator(MORE);
      await more.waitFor({ timeout: 20_000 });
      await assertCspLive(h.page);
      await more.click();
      await h.page.getByRole('menuitem', { name: 'Manage member…' }).click();
      const panel = h.page.locator(PANEL);
      await panel.waitFor({ timeout: 5_000 });
      assert.equal(await locked(h.page), true, 'the page behind the panel still scrolls');

      const role = panel.getByRole('combobox').first();
      await role.click();
      const list = h.page.locator('[data-dropdown-panel]');
      await list.waitFor({ timeout: 5_000 });
      assert.equal(await listOnTop(h.page), true, 'the list is drawn under the panel (B16)');

      await h.page.keyboard.press('Escape');
      await list.waitFor({ state: 'detached', timeout: 5_000 });
      await h.page.waitForTimeout(200);
      assert.equal(await panel.count(), 1, 'one Escape closed the panel with the list');

      await h.page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await locked(h.page), false);
      assert.deepEqual(await violations(h.page), [], 'the panel tripped the CSP');
    } finally {
      await h.close();
    }
  });
});
