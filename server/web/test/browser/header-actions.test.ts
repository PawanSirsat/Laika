/**
 * The app header v2, in a real browser (LAI-1221): the search bar's words,
 * states and the palette's Recent and highlights; the title rule on every
 * class of screen; the notifications bell — its count, a new item arriving
 * through the store, *Mark all as read*, a deep link, member versus admin, and
 * no second `EventSource`; + Create; the keyboard-shortcuts sheet; and the
 * sidebar's Alt keys, which navigate, stay out of fields and modals, and do
 * not take a key My day uses.
 *
 * The rules themselves are unit-tested beside their modules
 * (`nav-shortcuts.test.ts`, `notifications-model.test.ts`,
 * `palette-recent.test.ts`, `header-model.test.ts`); this is what only a
 * browser can show.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  fakeStream,
  open,
  refuse,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { open as openDay } from './my-day-clock.ts';
import { TODAY, weekData, weekStub } from './my-day-week.ts';

/** My day, loaded — its own help button is drawn only once its day has read. */
async function myDay(): Promise<Awaited<ReturnType<typeof openDay>>> {
  const h = await openDay(`/my-day?day=${TODAY}`, weekStub(weekData()));
  await h.page.locator('[data-dayline]').waitFor({ timeout: 20_000 });
  return h;
}

const CORE = {
  id: '01AAA',
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
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [],
  last_activity_at: 2,
  task_create_min_role: 'member',
};

const user = (id: string, name: string, role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role: role,
  is_active: true,
  last_seen_at: null,
  created_at: 1,
  updated_at: 1,
});

const OWNER = user('u1', 'Ada Lovelace', 'owner');
const MEMBER = user('u2', 'Grace Hopper', 'member');
const VIEWER = user('u3', 'Alan Turing', 'viewer');

const reviewItem = (id: string, at: number) => ({
  task: {
    id,
    key: `LC-${id}`,
    title: `Wire task ${id}`,
    project_id: CORE.id,
    status: 'review',
    status_name: 'Review',
  },
  project: { id: CORE.id, slug: CORE.slug, name: CORE.name, prefix: 'LC' },
  assignee_name: 'Grace Hopper',
  waiting_since: at,
  round: null,
  finished_by_name: null,
  can_decide: true,
  cue: null,
});

const NOTICE = {
  id: 'n1',
  kind: 'added_to_space',
  actor: { id: 'u2', name: 'Grace Hopper' },
  project: { id: CORE.id, slug: CORE.slug, name: CORE.name },
  task: null,
  subject: null,
  message: null,
  created_at: Date.now() - 600_000,
  read_at: null,
};

interface StubOptions {
  readonly me?: typeof OWNER;
  readonly review?: unknown;
  readonly notices?: unknown;
  readonly extra?: ApiStub;
}

function stub({ me = OWNER, review, notices, extra = {} }: StubOptions = {}): ApiStub {
  const memberships = me.org_role === 'viewer' ? [] : [{ project_id: CORE.id, role: 'member' }];
  return {
    '/api/v1/me': { ...me, memberships },
    '/api/v1/permissions': defaultPermissions({ org_role: me.org_role, memberships }),
    '/api/v1/projects': { data: [CORE], next_cursor: null },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': { members: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/org': {
      id: 'org1',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users': { data: [OWNER, MEMBER, VIEWER], next_cursor: null },
    '/api/v1/tasks': { data: [], next_cursor: null },
    ...(review === undefined ? {} : { '/api/v1/review': review }),
    ...(notices === undefined ? {} : { '/api/v1/me/notices': notices }),
    ...extra,
  };
}

const HEADER = '[data-app-header]';
const FIELD = '[data-palette-trigger="header"]';
const INPUT = '[data-palette] [role="combobox"]';
const BELL = '[data-header-bell]';
const BADGE = '[data-bell-badge]';
const POPOVER = '[data-notifications]';

void after(async () => {
  await closeBrowser();
});

async function ready(page: Page): Promise<void> {
  await page.locator(`${HEADER} ${FIELD}`).waitFor({ timeout: 20_000 });
}

/** The badge's text, or `null` when there is none — one read, so it cannot vanish mid-way. */
async function badge(page: Page): Promise<string | null> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, BADGE);
}

const pathOf = (page: Page): string => new URL(page.url()).pathname;

// ------------------------------------------------------------- search bar

void describe('the search bar', () => {
  void test('says what it searches: people only for a reader who may see everyone', async () => {
    for (const [me, words] of [
      [OWNER, 'Search tasks, spaces, people…'],
      [MEMBER, 'Search tasks, spaces, pages…'],
    ] as const) {
      const h = await open('/inbox', stub({ me }));
      try {
        await ready(h.page);
        await until(
          async () => (await h.page.locator(`${FIELD} .cmdk-trigger-text`).innerText()) === words,
          10_000,
        );
        assert.equal(await h.page.locator(`${FIELD} .cmdk-trigger-text`).innerText(), words);
      } finally {
        await h.close();
      }
    }
  });

  void test('is wide and, with Create beside it, centred on a desktop; its focus and open states read', async () => {
    const h = await open('/inbox', stub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      await ready(h.page);
      const box = await h.page.locator(FIELD).boundingBox();
      // The search and + Create are the bar's centre together (LAI-1227).
      const group = await h.page.locator(`${HEADER} .shell-head-search`).boundingBox();
      const main = await h.page.locator(HEADER).boundingBox();
      assert.ok(box !== null && group !== null && main !== null);
      assert.ok(box.width >= 400, `the field is ${String(box.width)}px wide`);
      assert.ok(group.width <= 720, `the centre is ${String(group.width)}px wide`);
      const centre = group.x + group.width / 2;
      const barCentre = main.x + main.width / 2;
      assert.ok(Math.abs(centre - barCentre) < 24, `off centre by ${String(centre - barCentre)}`);

      const edge = () =>
        h.page.locator(FIELD).evaluate((el) => getComputedStyle(el).borderTopColor);
      const rest = await edge();
      await h.page.locator(FIELD).focus();
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.press('Shift+Tab');
      await until(async () => (await edge()) !== rest);
      assert.notEqual(await edge(), rest, 'keyboard focus does not change the field');

      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator(FIELD).getAttribute('aria-expanded'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('the palette remembers where it went, by id, and offers it first next time', async () => {
    const h = await open('/organisation', stub());
    try {
      await ready(h.page);
      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-palette-recent]').count(), 0);
      // Before typing: suggested actions, not sign out.
      const suggested = h.page.locator('[data-palette-suggested] [role="option"]');
      await suggested.first().waitFor({ timeout: 10_000 });
      const words = await suggested.allInnerTexts();
      assert.ok(
        words.some((w) => w.includes('Keyboard shortcuts')),
        words.join(', '),
      );
      assert.ok(!words.some((w) => w.includes('Sign out')), 'sign out is not a suggestion');

      await h.page.locator(INPUT).fill('inb');
      // The match is marked, and the label still reads whole.
      const option = h.page.locator('[data-palette] [role="option"]', { hasText: 'Inbox' }).first();
      await option.waitFor({ timeout: 10_000 });
      assert.equal(await option.locator('mark.cmdk-mark').innerText(), 'Inb');
      assert.equal(await option.locator('.cmdk-item-label').innerText(), 'Inbox');
      // Its Alt key is on the row — ⌥3 since Meetings took ⌥2 (LAI-1312).
      assert.match(await option.locator('[data-palette-shortcut]').innerText(), /^(⌥3|Alt\+3)$/);
      await h.page.keyboard.press('Enter');
      await until(() => pathOf(h.page) === '/inbox');

      const stored = await h.page.evaluate(() => localStorage.getItem('laika.palette.recent.u1'));
      assert.deepEqual(JSON.parse(stored ?? '[]'), [{ kind: 'page', id: '/inbox' }]);

      await h.page.keyboard.press('Meta+k');
      const recent = h.page.locator('[data-palette-recent] [role="option"] .cmdk-item-label');
      await recent.first().waitFor({ timeout: 10_000 });
      assert.deepEqual(await recent.allInnerTexts(), ['Inbox']);
      assert.equal(
        await h.page.locator('[data-palette] [cmdk-group-heading]').first().textContent(),
        'Recent',
      );
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------- title rule

/** One of each class of screen, and the name its own `h1` gives it. */
const SCREENS: readonly (readonly [string, string])[] = [
  ['/my-day', 'My day'],
  ['/inbox', 'Inbox'],
  ['/insights', 'Insights'],
  // Organisation's heading is the organisation's own name.
  ['/organisation', 'Borealis Labs'],
  ['/developer', 'Developer access'],
  ['/settings/appearance', 'Appearance'],
  ['/projects', 'Spaces'],
];

void describe('the title rule: each screen is named once, by the page (LAI-1227)', () => {
  void test('the top bar names no page; the page’s own heading names it, once', async () => {
    for (const [path, name] of SCREENS) {
      const h = await open(path, stub());
      try {
        await ready(h.page);
        const h1 = h.page.locator('#main h1').first();
        await h1.waitFor({ timeout: 10_000 });
        assert.equal((await h1.innerText()).trim(), name, `${path}: the page's own heading`);
        assert.equal(await h.page.locator('h1').count(), 1, `${path}: more than one h1`);
        // Jira's top bar: brand, search, Create, the reader's tools — no trail.
        assert.equal(
          await h.page.locator(`${HEADER} nav, ${HEADER} h1, ${HEADER} [aria-current]`).count(),
          0,
          `${path}: the top bar carries a breadcrumb or a page name`,
        );
        const bar = (await h.page.locator(HEADER).innerText()).split('\n').map((t) => t.trim());
        if (name !== 'Borealis Labs') {
          assert.ok(!bar.includes(name), `${path}: the top bar repeats "${name}"`);
        }
      } finally {
        await h.close();
      }
    }
  });

  void test('a space: its name is the page’s, under Spaces /, and the top bar has neither', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await ready(h.page);
      const name = h.page.locator('#main .space-name');
      await until(async () => (await name.innerText()).trim() === 'Laika Core', 20_000);
      assert.equal(await h.page.locator('.space-name').count(), 1);
      assert.equal(await h.page.locator(`${HEADER} .space-name`).count(), 0);
      const crumb = h.page.locator('#main [data-space-crumbs] a');
      assert.equal((await crumb.innerText()).trim(), 'Spaces');
      assert.equal(await crumb.getAttribute('href'), '/projects');
      const above = await h.page.evaluate(() => {
        const c = document.querySelector('[data-space-crumbs]')?.getBoundingClientRect();
        const n = document.querySelector('.space-name')?.getBoundingClientRect();
        return c !== undefined && n !== undefined && c.bottom <= n.top;
      });
      assert.equal(above, true, 'the breadcrumb is not above the name');
      await crumb.click();
      await until(() => pathOf(h.page) === '/projects');
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------- notifications

void describe('the notifications bell', () => {
  void test('counts what waits on the reader and the unread notices, and lists them grouped', async () => {
    const h = await open(
      '/organisation',
      stub({
        review: { tasks: [reviewItem('t1', Date.now() - 3_600_000)], truncated: false },
        notices: { data: [NOTICE], next_cursor: null, unread_count: 1 },
      }),
    );
    try {
      await ready(h.page);
      await until(async () => (await badge(h.page)) === '2', 15_000);
      assert.equal(await badge(h.page), '2');
      assert.equal(await h.page.locator(BELL).getAttribute('aria-label'), 'Notifications, 2 new');
      await h.page.locator(BELL).click();
      const popover = h.page.locator(POPOVER);
      await popover.waitFor({ timeout: 10_000 });
      await until(async () => (await popover.locator('[data-notification]').count()) === 2);
      assert.deepEqual(await popover.locator('.hdr-group-title').allTextContents(), [
        'Waiting on you',
        'Updates',
      ]);
      assert.match(await popover.innerText(), /on this device/);
      // Escape closes it and gives focus back to the bell.
      await h.page.keyboard.press('Escape');
      await until(async () => (await popover.count()) === 0);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.hasAttribute('data-header-bell')),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('Mark all as read: the server reads the notices, this device the rest', async () => {
    const h = await open(
      '/organisation',
      stub({
        review: { tasks: [reviewItem('t1', Date.now() - 3_600_000)], truncated: false },
        notices: { data: [NOTICE], next_cursor: null, unread_count: 1 },
        extra: { '/api/v1/me/notices/read-all': {} },
      }),
    );
    try {
      await ready(h.page);
      await until(async () => (await badge(h.page)) === '2', 15_000);
      await h.page.locator(BELL).click();
      await h.page.locator('[data-mark-all-read]').click();
      await until(async () => (await badge(h.page)) === null);
      assert.equal(await badge(h.page), null);
      assert.ok(
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/me/notices/read-all'),
        'the server was not asked',
      );
      const seen = await h.page.evaluate(() =>
        Number(localStorage.getItem('laika.notifications.seen.u1')),
      );
      assert.ok(seen > Date.now() - 60_000, 'this device did not record when it looked');
      assert.equal(await h.page.locator(`${POPOVER} [data-unread]`).count(), 0);
      // Still listed — it still waits — just not new.
      assert.equal(await h.page.locator(`${POPOVER} [data-notification="review"]`).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a new item arriving through the store is unread again; no second EventSource', async () => {
    let queue = [reviewItem('t1', Date.now() - 3_600_000)];
    const h = await open(
      '/board?project=laika-core',
      stub({
        review: () => ({ tasks: queue, truncated: false }),
        extra: { '/api/v1/me/notices/read-all': {} },
      }),
      { before: fakeStream },
    );
    try {
      await ready(h.page);
      await until(async () => (await badge(h.page)) === '1', 15_000);
      await h.page.locator(BELL).click();
      await h.page.locator('[data-mark-all-read]').click();
      await until(async () => (await badge(h.page)) === null);
      await h.page.keyboard.press('Escape');

      const sources = () =>
        h.page.evaluate(() =>
          (window as unknown as { __laikaStream: { count: () => number } }).__laikaStream.count(),
        );
      await until(async () => (await sources()) > 0);
      const before = await sources();
      assert.equal(before, 1, 'the space and the shell share one stream');

      queue = [...queue, reviewItem('t2', Date.now() + 1_000)];
      await h.page.evaluate(() => {
        (
          window as unknown as { __laikaStream: { emit: (t: string, d: unknown) => void } }
        ).__laikaStream.emit('task.status_changed', { id: 'x' });
      });
      await until(async () => (await badge(h.page)) === '1', 10_000);
      assert.equal(await badge(h.page), '1', 'the new review is not counted');
      assert.equal(await sources(), before, 'the bell opened a stream of its own');
    } finally {
      await h.close();
    }
  });

  void test('each row is a link to the screen that shows it', async () => {
    const h = await open(
      '/organisation',
      stub({ review: { tasks: [reviewItem('t1', Date.now() - 60_000)], truncated: false } }),
    );
    try {
      await ready(h.page);
      await h.page.locator(BELL).click();
      const row = h.page.locator(`${POPOVER} [data-notification="review"]`);
      await row.waitFor({ timeout: 10_000 });
      assert.equal(await row.getAttribute('href'), '/inbox?tab=review&item=t1');
      await row.click();
      await until(() => pathOf(h.page) === '/inbox');
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('item'), 't1');
      assert.equal(await h.page.locator(POPOVER).count(), 0, 'the popover outlived the click');
    } finally {
      await h.close();
    }
  });

  void test('unlisted work is an admin’s; a member gets neither the row nor the request', async () => {
    const note = {
      id: 'w1',
      user_id: 'u2',
      token_id: null,
      repo: 'laika',
      note: 'Fixed the flaky deploy',
      promoted_task_id: null,
      dismissed_at: null,
      created_at: Date.now() - 60_000,
    };
    for (const me of [OWNER, MEMBER]) {
      const h = await open(
        '/organisation',
        stub({ me, extra: { '/api/v1/unlisted': { data: [note], next_cursor: null } } }),
      );
      try {
        await ready(h.page);
        await h.page.locator(BELL).click();
        await h.page.locator(POPOVER).waitFor({ timeout: 10_000 });
        const rows = h.page.locator(`${POPOVER} [data-notification="unlisted"]`);
        if (me === OWNER) {
          await until(async () => (await rows.count()) === 1, 10_000);
          assert.equal(await rows.count(), 1);
        } else {
          await h.page.waitForTimeout(1_000);
          assert.equal(await rows.count(), 0);
          assert.equal(
            h.calls.filter((c: StubCall) => c.path === '/api/v1/unlisted').length,
            0,
            'a member asked for unlisted work',
          );
        }
      } finally {
        await h.close();
      }
    }
  });

  void test('notices failing: said, with Retry; nothing waiting: all caught up', async () => {
    let fail = true;
    const h = await open(
      '/organisation',
      stub({
        notices: () =>
          fail ? refuse(500, 'internal', 'down') : { data: [], next_cursor: null, unread_count: 0 },
      }),
    );
    try {
      await ready(h.page);
      await h.page.locator(BELL).click();
      const error = h.page.locator('[data-notifications-error]');
      await error.waitFor({ timeout: 10_000 });
      assert.match(await error.innerText(), /could not be loaded/);
      fail = false;
      await error.locator('button', { hasText: 'Retry' }).click();
      const empty = h.page.locator('[data-notifications-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.match(await empty.innerText(), /You’re all caught up/);
      assert.equal(await error.count(), 0);
    } finally {
      await h.close();
    }
  });
});

// ----------------------------------------------------------------- create

void describe('+ Create (LAI-1227)', () => {
  void test('is filled in the accent and opens the Create task dialog itself — no menu of spaces', async () => {
    const h = await open('/inbox', stub());
    try {
      await ready(h.page);
      const create = h.page.locator('[data-header-create]');
      await until(async () => (await create.getAttribute('aria-disabled')) === null, 10_000);
      const paint = await create.evaluate((el) => {
        const probe = document.createElement('i');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return { fill: getComputedStyle(el).backgroundColor, accent };
      });
      assert.equal(paint.fill, paint.accent, 'Create is not filled with the accent');

      await create.click();
      const dialog = h.page.locator('[data-dialog="create-task"]');
      await dialog.waitFor({ timeout: 15_000 });
      assert.equal(await h.page.locator('#hdr-create-menu, [data-create]').count(), 0, 'a menu');
      // On a page that is not a space, the field starts on a space the reader
      // may create in — here the only one.
      const space = dialog.getByRole('combobox', { name: /^Space/ });
      await until(async () => (await space.innerText()).includes('Laika Core'), 10_000);
      assert.equal(new URL(h.page.url()).pathname, '/inbox', 'Create navigated');
    } finally {
      await h.close();
    }
  });

  void test('a reader who may create nowhere sees it unavailable, with the reason, and it opens nothing', async () => {
    const h = await open('/inbox', stub({ me: VIEWER }));
    try {
      await ready(h.page);
      const create = h.page.locator('[data-header-create]');
      await until(async () =>
        (await create.innerText()).includes('No space lets you create a task'),
      );
      assert.equal(await create.getAttribute('aria-disabled'), 'true');
      await create.hover();
      const tip = h.page.locator('[role="tooltip"]').filter({ hasText: 'No space lets you' });
      await tip.first().waitFor({ state: 'visible', timeout: 5_000 });
      // A press, past the tooltip it raised: it does nothing.
      await create.dispatchEvent('click');
      await h.page.waitForTimeout(400);
      assert.equal(await h.page.locator('[data-dialog="create-task"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

// -------------------------------------------------------------- shortcuts

void describe('keyboard shortcuts', () => {
  void test('the ? button and the ? key open the sheet, listing the reader’s destinations', async () => {
    const h = await open('/inbox', stub());
    try {
      await ready(h.page);
      await h.page.locator('[data-header-help]').click();
      const sheet = h.page.locator('[data-shortcuts-sheet]');
      await sheet.waitFor({ timeout: 10_000 });
      const goTo = sheet.locator('section[aria-label="Go to"] .shortcuts-label');
      assert.deepEqual(await goTo.allInnerTexts(), [
        'My day',
        'Inbox',
        'Insights',
        'Organisation',
        'Developer access',
      ]);
      await h.page.keyboard.press('Escape');
      await until(async () => (await sheet.count()) === 0);

      await h.page.locator('#main').focus();
      await h.page.keyboard.press('Shift+Slash');
      await sheet.waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('on My day, ? stays My day’s own sheet', async () => {
    const h = await myDay();
    try {
      await ready(h.page);
      await h.page.locator('[aria-keyshortcuts="?"]').first().waitFor({ timeout: 15_000 });
      await h.page.locator('#main').focus();
      await h.page.keyboard.press('Shift+Slash');
      await h.page.waitForTimeout(1_200);
      assert.equal(await h.page.locator('[data-shortcuts-sheet]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Alt + a digit goes to each sidebar destination', async () => {
    const h = await open('/organisation', stub());
    try {
      await ready(h.page);
      await h.page.locator('#sidebar .sidebar-link').first().waitFor({ timeout: 10_000 });
      for (const [digit, path] of [
        // ⌥2 is Meetings (LAI-1312), offered only where Teams meetings sync —
        // not on this password instance, so it is checked in meetings.test.ts.
        ['1', '/my-day'],
        ['3', '/inbox'],
        ['4', '/insights'],
        ['6', '/developer'],
        ['5', '/organisation'],
      ] as const) {
        await h.page.locator('#main').focus();
        await h.page.keyboard.press(`Alt+Digit${digit}`);
        await until(() => pathOf(h.page) === path, 10_000);
        assert.equal(pathOf(h.page), path, `Alt+${digit}`);
      }
      // The link says its key to assistive technology.
      assert.equal(
        await h.page
          .locator('#sidebar a.sidebar-link[href^="/inbox"]')
          .getAttribute('aria-keyshortcuts'),
        'Alt+3',
      );
    } finally {
      await h.close();
    }
  });

  void test('Alt + a digit types in a field rather than leaving the page, and waits for a modal', async () => {
    const h = await open('/organisation', stub());
    try {
      await ready(h.page);
      await h.page.evaluate(() => {
        const field = document.createElement('input');
        field.id = 'probe';
        document.getElementById('main')?.append(field);
      });
      // ⌥3, Inbox: ⌥2 is Meetings, absent here, and would pass by doing nothing (LAI-1312).
      await h.page.locator('#probe').focus();
      await h.page.keyboard.press('Alt+Digit3');
      await h.page.waitForTimeout(600);
      assert.equal(pathOf(h.page), '/organisation', 'Alt+3 in a field left the page');

      await h.page.locator('[data-header-help]').click();
      await h.page.locator('[data-shortcuts-sheet]').waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Alt+Digit3');
      await h.page.waitForTimeout(600);
      assert.equal(pathOf(h.page), '/organisation', 'Alt+3 left from under a dialog');
    } finally {
      await h.close();
    }
  });

  void test('My day’s own letters stay My day’s: G, J, K, D go nowhere', async () => {
    const h = await myDay();
    try {
      await ready(h.page);
      await h.page.locator('#main').focus();
      for (const letter of ['g', 'j', 'k', 'd', 'i']) {
        await h.page.keyboard.press(letter);
      }
      await h.page.waitForTimeout(600);
      assert.equal(pathOf(h.page), '/my-day');
      await h.page.keyboard.press('Escape');
      await h.page.locator('#main').focus();
      await h.page.keyboard.press('Alt+Digit3');
      await until(() => pathOf(h.page) === '/inbox', 10_000);
      assert.equal(pathOf(h.page), '/inbox');
    } finally {
      await h.close();
    }
  });
});
