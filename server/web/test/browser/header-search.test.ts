/**
 * The one app header and its search bar, in a real browser (LAI-1188).
 *
 * What only a browser can show: every class of screen wears the same bar at
 * the same height, a space's name and key and a profile's breadcrumb are
 * drawn in it rather than in a second bar, the field and `/` open the ⌘K
 * palette (and `/` leaves a screen's own search alone), an owner's palette
 * finds people and opens the views of one, the *Viewing* chip says whose view
 * is open and leads back to the reader's own — and a member gets none of it,
 * not even the request for the people list.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  open,
  setTheme,
  until,
  type ApiStub,
} from './harness.ts';

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

const user = (id: string, name: string, email: string, role: string) => ({
  id,
  name,
  email,
  org_role: role,
  is_active: true,
  last_seen_at: null,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  user('u1', 'Ada Lovelace', 'ada@example.com', 'owner'),
  user('u2', 'Grace Hopper', 'grace@example.com', 'member'),
  user('u3', 'Alan Turing', 'alan@example.com', 'admin'),
];

/**
 * Signed in as `role`; `/permissions` is the harness's default grants for it,
 * plus — for the owner — `time.report.read`, which the server grants owners
 * (D-130) and the harness's default list leaves out.
 */
function stub(role: 'owner' | 'member'): ApiStub {
  const me = role === 'owner' ? PEOPLE[0] : PEOPLE[1];
  const memberships = [{ project_id: CORE.id, role: 'member' }];
  const granted = defaultPermissions({ org_role: me?.org_role, memberships }) as {
    me: { actions: string[] };
  };
  if (role === 'owner') granted.me.actions = [...granted.me.actions, 'time.report.read'];
  return {
    '/api/v1/me': { ...me, memberships },
    '/api/v1/permissions': granted,
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
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/tasks': { data: [], next_cursor: null },
  };
}

const HEADER = '[data-app-header]';
const FIELD = '[data-palette-trigger="header"]';
const INPUT = '[data-palette] [role="combobox"]';
const PALETTE = '[data-palette] [role="dialog"]';
const CHIP = '[data-viewing-chip]';

void after(async () => {
  await closeBrowser();
});

async function ready(page: Page): Promise<void> {
  await page.locator(`${HEADER} ${FIELD}`).waitFor({ timeout: 20_000 });
}

/** The bar's box, and how many bars there are. */
async function bar(page: Page): Promise<{ count: number; top: number; height: number }> {
  return page.evaluate((sel) => {
    const all = document.querySelectorAll(sel);
    const box = all[0]?.getBoundingClientRect();
    return { count: all.length, top: box?.top ?? -1, height: box?.height ?? -1 };
  }, HEADER);
}

/** The visible option labels in the palette, in order. */
async function options(page: Page): Promise<string[]> {
  return page.locator('[data-palette] [role="option"] .cmdk-item-label').allInnerTexts();
}

/** Every class of screen: rail pages, a tabbed page, a space, the index, a profile, a page, the reference. */
const SCREENS: readonly (readonly [string, string])[] = [
  ['/my-day', 'My day'],
  ['/inbox', 'Inbox'],
  // Organisation's heading is the organisation's name (its lead mark beside it).
  ['/organisation?tab=work', 'Borealis Labs'],
  ['/insights', 'Insights'],
  ['/developer', 'Developer access'],
  ['/settings/appearance', 'Appearance'],
  ['/projects', 'Spaces'],
  // The stub has no LC-12, so the Workroom's own heading says so.
  ['/task/LC-12', 'No task LC-12'],
  ['/design/tokens', 'Design tokens'],
];

void describe('one header on every screen', () => {
  for (const [width, height] of [
    [1440, 52],
    [390, 48],
  ] as const) {
    void test(`at ${String(width)}px every screen has one bar, ${String(height)}px tall, with the search`, async () => {
      for (const [path, here] of SCREENS) {
        const h = await open(path, stub('owner'), {
          before: (page) => page.setViewportSize({ width, height: 900 }),
        });
        try {
          await ready(h.page);
          const b = await bar(h.page);
          assert.equal(b.count, 1, `${path}: ${String(b.count)} app headers`);
          assert.equal(b.top, 0, `${path}: the bar is not at the top`);
          assert.equal(Math.round(b.height), height, `${path}: the bar is ${String(b.height)}px`);
          // Where the reader is: the page's own heading, or — on a screen with
          // none — the header's page step (LAI-1221's title rule: said once).
          await until(
            async () =>
              (await h.page.locator(`#main h1, ${HEADER} [aria-current="page"]`).count()) > 0,
            10_000,
          );
          const said = await h.page
            .locator(`#main h1, ${HEADER} [aria-current="page"]`)
            .allInnerTexts();
          assert.ok(
            said.map((t) => t.trim()).includes(here),
            `${path}: nothing names the page "${here}": ${said.join(' | ')}`,
          );
          const field = await h.page.locator(FIELD).boundingBox();
          assert.ok(field !== null && field.x + field.width <= width, `${path}: search off-screen`);
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          );
          assert.equal(overflow, false, `${path}: the page scrolls sideways at ${String(width)}`);
        } finally {
          await h.close();
        }
      }
    });
  }

  /*
   * LAI-1188 drew a space's title row and a profile's breadcrumb in the app
   * header. LAI-1227 (the owner's Jira header) moved both back into the page:
   * the top bar names no page, and each is still drawn exactly once.
   */
  void test('a space’s name, key, Agents and menu are the page’s, once, and not the top bar’s', async () => {
    for (const tab of ['/board', '/calendar', '/activity']) {
      const h = await open(`${tab}?project=laika-core`, stub('owner'));
      try {
        await ready(h.page);
        // The slug stands in until the space's own read lands; wait for the name.
        await until(
          () =>
            h.page.evaluate(
              (sel) => document.querySelector(sel)?.textContent?.trim() === 'Laika Core',
              '.space-bar .space-name',
            ),
          20_000,
        );
        assert.match(await h.page.locator('.space-bar .space-key').innerText(), /LC/);
        assert.equal(
          await h.page.locator('.space-bar .space-bar-right .space-menu-trigger').count(),
          1,
        );
        assert.equal(await h.page.locator(`${HEADER} .space-name, ${HEADER} nav`).count(), 0);
        assert.equal(await h.page.locator('.space-name').count(), 1, `${tab}: two names`);
        assert.equal((await bar(h.page)).count, 1);
      } finally {
        await h.close();
      }
    }
  });

  void test('a profile’s breadcrumb is the page’s, and there is one breadcrumb', async () => {
    const h = await open('/people?user=u2', stub('owner'));
    try {
      await ready(h.page);
      await until(
        async () => (await h.page.locator('#main .screen-crumbs-trail').count()) === 1,
        20_000,
      );
      assert.equal(await h.page.locator(`${HEADER} .screen-crumbs-trail`).count(), 0);
      assert.equal(await h.page.getByRole('navigation', { name: 'Breadcrumb' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('the sidebar no longer carries a second search', async () => {
    const h = await open('/my-day', stub('owner'));
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('#sidebar [data-palette-trigger]').count(), 0);
      assert.equal(await h.page.locator('[data-palette-trigger]').count(), 1);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark', 'black'] as const) {
    void test(`the field reads in ${theme}: its words differ from its ground`, async () => {
      const h = await open('/organisation', stub('owner'), {
        before: async (page) => {
          await page.addInitScript((t) => {
            localStorage.setItem('laika.theme', t);
          }, theme);
        },
      });
      try {
        await ready(h.page);
        const look = await h.page.locator(FIELD).evaluate((el) => {
          const s = getComputedStyle(el);
          return { color: s.color, background: s.backgroundColor, border: s.borderTopColor };
        });
        assert.notEqual(look.color, look.background, `${theme}: words on their own ground`);
        assert.notEqual(look.border, 'rgba(0, 0, 0, 0)', `${theme}: the field has no edge`);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the search bar is the palette', () => {
  void test('clicking the field opens the palette; Escape closes it and returns to the field', async () => {
    const h = await open('/organisation', stub('owner'));
    try {
      await ready(h.page);
      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('role')),
        'combobox',
      );
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator(PALETTE).count()) === 0);
      await until(() =>
        h.page.evaluate(
          () => document.activeElement?.getAttribute('data-palette-trigger') === 'header',
        ),
      );
    } finally {
      await h.close();
    }
  });

  void test('/ opens it where the screen has no search of its own', async () => {
    const h = await open('/organisation', stub('owner'));
    try {
      await ready(h.page);
      await h.page.locator('#main').focus();
      await h.page.keyboard.press('/');
      await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
      // Typed into the palette, the key is a character, not a second open.
      await h.page.keyboard.press('/');
      assert.equal(await h.page.locator(INPUT).inputValue(), '/');
    } finally {
      await h.close();
    }
  });

  void test('/ on a space keeps focusing the space’s own search, and the palette stays shut', async () => {
    const h = await open('/calendar?project=laika-core', stub('owner'));
    try {
      await ready(h.page);
      const own = h.page.locator('[aria-keyshortcuts="/"]').first();
      await own.waitFor({ timeout: 20_000 });
      await h.page.locator('#main').focus();
      await h.page.keyboard.press('/');
      await until(() =>
        h.page.evaluate(() => document.activeElement?.getAttribute('aria-keyshortcuts') === '/'),
      );
      // The palette loads lazily: give an open time to land before saying it did not.
      await h.page.waitForTimeout(1500);
      assert.equal(
        await h.page.locator('[data-palette], [data-palette-loading]').count(),
        0,
        'the palette opened as well',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('people and the person view (owner and admin)', () => {
  void test('the palette finds a person, lists the views of them, and opens their day', async () => {
    const h = await open('/organisation', stub('owner'));
    try {
      await ready(h.page);
      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).fill('grace');
      const group = h.page.locator('[data-palette-people]');
      await group.waitFor({ timeout: 10_000 });
      assert.deepEqual(await group.locator('[role="option"] .cmdk-item-label').allInnerTexts(), [
        'Grace Hopper',
      ]);
      await group.locator('[role="option"]', { hasText: 'Grace Hopper' }).click();
      await h.page.locator('[data-palette-person]').waitFor({ timeout: 10_000 });
      assert.deepEqual(await options(h.page), [
        'Open profile',
        'View their day',
        'View their work',
        'View their time',
        'Back to all results',
      ]);

      await h.page.locator('[data-palette] [role="option"]', { hasText: 'View their day' }).click();
      await until(() => new URL(h.page.url()).pathname === '/my-day');
      assert.equal(new URL(h.page.url()).searchParams.get('user'), 'u2');

      const chip = h.page.locator(`${HEADER} ${CHIP}`);
      await until(async () => (await chip.innerText()).includes('Grace Hopper'), 10_000);
      assert.match(await chip.innerText(), /Viewing:\s*Grace Hopper/);

      await chip.locator('[data-viewing-back]').click();
      await until(() => new URL(h.page.url()).searchParams.get('user') === null);
      assert.equal(new URL(h.page.url()).pathname, '/my-day');
      assert.equal(await h.page.locator(CHIP).count(), 0, 'the chip outlived the view');
    } finally {
      await h.close();
    }
  });

  void test('their work opens Work filtered to them, and Me is the reader’s own filter', async () => {
    const h = await open('/my-day', stub('owner'));
    try {
      await ready(h.page);
      await h.page.keyboard.press('Meta+k');
      await h.page.locator(INPUT).fill('hopper');
      await h.page.locator('[data-palette-people] [role="option"]').first().click();
      await h.page.locator('[data-palette-person]').waitFor({ timeout: 10_000 });
      // On My day, its own view of the person is offered first.
      assert.equal((await options(h.page))[0], 'View their day');
      await h.page
        .locator('[data-palette] [role="option"]', { hasText: 'View their work' })
        .click();
      await until(() => new URL(h.page.url()).searchParams.get('person') === 'u2');
      assert.equal(new URL(h.page.url()).searchParams.get('tab'), 'work');
      const chip = h.page.locator(`${HEADER} ${CHIP}`);
      await chip.waitFor({ timeout: 10_000 });
      assert.equal(await chip.getAttribute('data-viewing-chip'), 'work');
      await chip.locator('[data-viewing-back]').click();
      await until(() => new URL(h.page.url()).searchParams.get('person') === 'u1');
      assert.equal(await h.page.locator(CHIP).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Backspace in the empty field, and Escape, leave a person without closing', async () => {
    const h = await open('/organisation', stub('owner'));
    try {
      await ready(h.page);
      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).fill('turing');
      await h.page.locator('[data-palette-people] [role="option"]').first().click();
      await h.page.locator('[data-palette-person]').waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Backspace');
      await until(async () => (await h.page.locator('[data-palette-person]').count()) === 0);
      assert.equal(await h.page.locator(PALETTE).count(), 1, 'Backspace closed the palette');

      await h.page.locator(INPUT).fill('turing');
      await h.page.locator('[data-palette-people] [role="option"]').first().click();
      await h.page.locator('[data-palette-person]').waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator('[data-palette-person]').count()) === 0);
      assert.equal(await h.page.locator(PALETTE).count(), 1, 'Escape closed the palette');
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator(PALETTE).count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('the keyboard alone: arrows to a person, Enter, arrows to a view, Enter', async () => {
    const h = await open('/organisation', stub('owner'));
    try {
      await ready(h.page);
      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).fill('grace hopper');
      await h.page.locator('[data-palette-people]').waitFor({ timeout: 10_000 });
      // The only row is the person; a task search for two words finds none here.
      await until(async () => (await options(h.page)).includes('Grace Hopper'));
      for (let i = 0; i < 10; i += 1) {
        const active = await h.page
          .locator('[data-palette] [role="option"][aria-selected="true"] .cmdk-item-label')
          .innerText();
        if (active === 'Grace Hopper') break;
        await h.page.keyboard.press('ArrowDown');
      }
      await h.page.keyboard.press('Enter');
      await h.page.locator('[data-palette-person]').waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Enter');
      await until(() => new URL(h.page.url()).pathname === '/my-day');
      assert.equal(new URL(h.page.url()).searchParams.get('user'), 'u2');
    } finally {
      await h.close();
    }
  });
});

void describe('a member', () => {
  void test('has no People group, and the palette never asks for the people list', async () => {
    const h = await open('/settings/appearance', stub('member'));
    try {
      await ready(h.page);
      const before = h.calls.filter((c) => c.path === '/api/v1/users').length;
      await h.page.locator(FIELD).click();
      await h.page.locator(INPUT).fill('grace');
      // Let the debounce and any task read settle, so an absent group is not just late.
      await h.page.waitForTimeout(800);
      assert.equal(await h.page.locator('[data-palette-people]').count(), 0);
      assert.equal(await h.page.locator('[data-palette-person]').count(), 0);
      assert.ok(!(await options(h.page)).includes('Grace Hopper'));
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/users').length,
        before,
        'the palette asked for everyone on a member’s behalf',
      );
      assert.doesNotMatch(
        (await h.page.locator(INPUT).getAttribute('placeholder')) ?? '',
        /people/,
      );
    } finally {
      await h.close();
    }
  });

  void test('sees no Viewing chip, even on an address that names somebody else', async () => {
    for (const path of ['/my-day?user=u3', '/organisation?tab=work&person=u3']) {
      const h = await open(path, stub('member'));
      try {
        await ready(h.page);
        await h.page.waitForTimeout(600);
        assert.equal(await h.page.locator(CHIP).count(), 0, `${path}: a member has a chip`);
      } finally {
        await h.close();
      }
    }
  });
});

void describe('themes', () => {
  void test('the chip reads in light and dark', async () => {
    for (const theme of ['Light', 'Dark']) {
      const h = await open('/my-day?user=u2', stub('owner'));
      try {
        await ready(h.page);
        await setTheme(h.page, theme);
        const chip = h.page.locator(`${HEADER} ${CHIP}`);
        await chip.waitFor({ timeout: 10_000 });
        const look = await chip.evaluate((el) => {
          const s = getComputedStyle(el);
          return { color: s.color, background: s.backgroundColor };
        });
        assert.notEqual(look.color, look.background, theme);
        assert.equal(
          await chip
            .getByRole('button', { name: /^Stop viewing .+\. Back to your own day$/ })
            .count(),
          1,
          `${theme}: the way back is not named`,
        );
      } finally {
        await h.close();
      }
    }
  });
});
