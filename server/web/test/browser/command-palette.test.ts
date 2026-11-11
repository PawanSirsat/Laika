/**
 * The ⌘K command palette in a real browser (LAI-1192).
 *
 * What only a browser can show: the shortcut and the trigger open it, the
 * focus goes in and comes back, the keyboard drives it, a task search reaches
 * the API once and opens the task in its own space, failure and emptiness
 * are said, the palette arrives in its own chunk, and it runs under the
 * server's strict CSP without a single violation.
 *
 * Set `PALETTE_SCREENSHOTS=<dir>` to also write dark and light, 1440 and 390,
 * screenshots there.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, until, type ApiStub, type StubCall } from './harness.ts';

const project = (id: string, slug: string, name: string, prefix: string) => ({
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
  task_counts: { backlog: 1, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
  task_create_min_role: 'member',
});

const CORE = project('01AAA', 'laika-core', 'Laika Core', 'LC');
const WEB = project('01BBB', 'laika-web', 'Laika Web', 'LW');

const task = (id: string, key: string, title: string, status: string, statusName: string) => ({
  id,
  key,
  title,
  project_id: CORE.id,
  status,
  status_id: `st-${status}`,
  status_name: statusName,
  priority: 'p2',
  assignee_id: null,
  external_ref: null,
  position: id,
  created_at: 1,
  updated_at: 1,
});

const TASKS = [
  task('t12', 'LC-12', 'Fix the login page', 'in_progress', 'In progress'),
  task('t13', 'LC-13', 'Palette shortcut hint', 'todo', 'To do'),
];

/** The stub every test starts from; `tasks` answers `GET /tasks`. */
function stub(
  tasks: (call: StubCall) => unknown = () => ({ data: TASKS, next_cursor: null }),
): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: CORE.id, role: 'lead' }],
    },
    '/api/v1/projects': { data: [CORE, WEB], next_cursor: null },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-web': WEB,
    '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
    '/api/v1/projects/laika-web/tasks': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': { members: [] },
    '/api/v1/projects/laika-web/members': { members: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-web/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-web/tags': { tags: [] },
    '/api/v1/org': {
      id: 'org1',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/tasks': tasks,
  };
}

const START = '/board?project=laika-core';
const PALETTE = '[data-palette] [role="dialog"]';
const INPUT = '[data-palette] [role="combobox"]';
const TRIGGER = '[data-palette-trigger="sidebar"]';

/** The server's policy (`server/src/http/security-headers.ts`) with no style hashes. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

async function ready(page: Page): Promise<void> {
  await page.locator(TRIGGER).waitFor({ timeout: 20_000 });
}

async function openWithKeys(page: Page, combo = 'Meta+k'): Promise<void> {
  await page.keyboard.press(combo);
  await page.locator(INPUT).waitFor({ timeout: 10_000 });
}

/** The visible option labels, in order. */
async function options(page: Page): Promise<string[]> {
  return page.locator('[data-palette] [role="option"] .cmdk-item-label').allInnerTexts();
}

const tasksCalls = (calls: readonly StubCall[]): StubCall[] =>
  calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks');

void after(async () => {
  await closeBrowser();
});

void describe('opening and closing', () => {
  void test('⌘K and Ctrl+K open it; Escape closes it and gives the focus back', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      assert.equal(await h.page.locator(PALETTE).count(), 0, 'open before anything was pressed');

      // Focus on a known control, so "back where it was" is checkable.
      await h.page.locator('.sidebar-toggle').focus();
      await openWithKeys(h.page, 'Meta+k');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('role')),
        'combobox',
        'the focus did not go to the search field',
      );
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator(PALETTE).count()) === 0);
      assert.equal(await h.page.locator(PALETTE).count(), 0, 'Escape did not close it');
      await until(() =>
        h.page.evaluate(
          () => document.activeElement?.classList.contains('sidebar-toggle') === true,
        ),
      );
      assert.ok(
        await h.page.evaluate(() => document.activeElement?.classList.contains('sidebar-toggle')),
        'the focus did not return to what had it',
      );

      await openWithKeys(h.page, 'Control+k');
      // A second ⌘K, from inside its own field, closes it.
      await h.page.keyboard.press('Control+k');
      await until(async () => (await h.page.locator(PALETTE).count()) === 0);
      assert.equal(await h.page.locator(PALETTE).count(), 0, 'a second ⌘K did not close it');
    } finally {
      await h.close();
    }
  });

  void test('the trigger opens it, shows the shortcut, and takes the focus back', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      const hint = await h.page.locator(`${TRIGGER} .cmdk-kbd`).innerText();
      assert.match(hint, /^(?:⌘K|Ctrl K)$/, `the trigger's hint reads ${hint}`);
      assert.match(
        (await h.page.locator(TRIGGER).getAttribute('aria-keyshortcuts')) ?? '',
        /^(?:Meta|Control)\+K$/,
      );

      await h.page.locator(TRIGGER).click();
      await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await until(() =>
        h.page.evaluate(
          () => document.activeElement?.hasAttribute('data-palette-trigger') === true,
        ),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-palette-trigger')),
        'sidebar',
        'Escape did not restore the focus to the trigger',
      );
    } finally {
      await h.close();
    }
  });

  void test('does not fire while typing in a field or an editor', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      await h.page.evaluate(() => {
        const field = document.createElement('input');
        field.id = 'probe-field';
        const editor = document.createElement('div');
        editor.id = 'probe-editor';
        editor.contentEditable = 'true';
        document.body.append(field, editor);
      });
      // One key at a time, checked after each: a second press would toggle a
      // palette the first had wrongly opened, and both would look refused.
      for (const probe of ['#probe-field', '#probe-editor']) {
        for (const combo of ['Meta+k', 'Control+k']) {
          await h.page.locator(probe).focus();
          await h.page.keyboard.press(combo);
          // Long enough for the lazy chunk, had it been asked for.
          await h.page.waitForTimeout(400);
          assert.equal(
            await h.page.locator('[data-palette], [data-palette-loading]').count(),
            0,
            `${combo} opened it inside ${probe}`,
          );
        }
      }
      // A bare K is My day's, never the palette's. Each key is checked on its
      // own: a K that opened it and a Shift+K that toggled it shut would look
      // like neither did.
      await h.page.locator('.sidebar-toggle').focus();
      for (const combo of ['k', 'Shift+K']) {
        await h.page.keyboard.press(combo);
        await h.page.waitForTimeout(400);
        assert.equal(
          await h.page.locator('[data-palette], [data-palette-loading]').count(),
          0,
          `${combo} opened it`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('arrives in its own chunk, fetched only on first open', async () => {
    const scripts: string[] = [];
    const h = await open(START, stub(), {
      before: (page) => {
        page.on('request', (request) => {
          if (request.resourceType() === 'script') scripts.push(request.url());
        });
        return Promise.resolve();
      },
    });
    try {
      await ready(h.page);
      const chunk = (): boolean => scripts.some((u) => /\/CommandPalette-[^/]+\.js$/.test(u));
      assert.equal(
        chunk(),
        false,
        `the palette loaded before it was opened: ${scripts.join(', ')}`,
      );
      await openWithKeys(h.page);
      assert.equal(chunk(), true, `no CommandPalette chunk was fetched: ${scripts.join(', ')}`);
    } finally {
      await h.close();
    }
  });
});

void describe('the groups', () => {
  void test('Go to lists the sidebar’s pages and Enter goes there', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      const listed = await options(h.page);
      for (const label of ['My day', 'Inbox', 'Insights', 'Board', 'List', 'All spaces']) {
        assert.ok(listed.includes(label), `${label} missing from: ${listed.join(', ')}`);
      }
      // textContent: the heading is upper-cased by CSS, the words are not.
      assert.equal(
        await h.page.locator('[data-palette] [cmdk-group-heading]').first().textContent(),
        'Go to',
      );

      await h.page.locator(INPUT).fill('inbox');
      await until(async () => (await options(h.page))[0] === 'Inbox');
      await h.page.keyboard.press('Enter');
      await until(() => new URL(h.page.url()).pathname === '/inbox');
      assert.equal(new URL(h.page.url()).pathname, '/inbox');
      assert.equal(await h.page.locator('[data-palette]').count(), 0, 'still open after Enter');
    } finally {
      await h.close();
    }
  });

  void test('Spaces switches space, keeping the view', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      await h.page.locator(INPUT).fill('laika web');
      await until(async () => (await options(h.page)).includes('Laika Web'));
      const labels = await options(h.page);
      assert.ok(!labels.includes('Laika Core'), 'offered the space already open');
      await h.page.keyboard.press('Enter');
      await until(() => new URL(h.page.url()).searchParams.get('project') === 'laika-web');
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/board');
      assert.equal(url.searchParams.get('project'), 'laika-web');
    } finally {
      await h.close();
    }
  });

  void test('Tasks: a debounced search reads the API once and opens the task in its space', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      // One keystroke at a time, faster than the debounce.
      await h.page.locator(INPUT).pressSequentially('lc-12', { delay: 30 });
      const row = h.page.locator('[data-palette] [role="option"]', { hasText: 'LC-12' });
      await row.waitFor({ timeout: 10_000 });
      assert.equal(await row.locator('.cmdk-task-key').innerText(), 'LC-12');
      assert.equal(await row.locator('.cmdk-item-label').innerText(), 'Fix the login page');
      assert.equal(await row.locator('.cmdk-status').innerText(), 'In progress');
      assert.equal(tasksCalls(h.calls).length, 1, 'the task list was read more than once');

      // The exact key ranks first; move to it and open it.
      await until(
        async () => (await h.page.locator('[data-palette] [aria-selected="true"]').count()) === 1,
      );
      while (
        !(await h.page.locator('[data-palette] [aria-selected="true"]').innerText()).includes(
          'LC-12',
        )
      ) {
        await h.page.keyboard.press('ArrowDown');
      }
      await h.page.keyboard.press('Enter');
      await until(() => new URL(h.page.url()).searchParams.get('task') === 't12');
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('task'), 't12');
      assert.equal(url.searchParams.get('project'), 'laika-core');
    } finally {
      await h.close();
    }
  });

  void test('Tasks: a failed read says so, and Retry reads again', async () => {
    let attempts = 0;
    const h = await open(
      START,
      stub(() => {
        attempts += 1;
        return attempts === 1
          ? refuse(500, 'internal', 'boom')
          : { data: TASKS, next_cursor: null };
      }),
    );
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      await h.page.locator(INPUT).fill('login');
      const alert = h.page.locator('[data-palette] [role="alert"]');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(await alert.innerText(), 'Tasks could not be loaded.');
      const retry = h.page.locator('[data-palette] [role="option"]', {
        hasText: 'Retry task search',
      });
      await retry.click();
      const row = h.page.locator('[data-palette] [role="option"]', { hasText: 'LC-12' });
      await row.waitFor({ timeout: 10_000 });
      assert.equal(attempts, 2);
      assert.equal(await alert.count(), 0, 'the error stayed after a successful retry');
    } finally {
      await h.close();
    }
  });

  void test('no match says so, with a suggestion, and the count is announced', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      await h.page.locator(INPUT).fill('zzqqxx');
      const empty = h.page.locator('[data-palette-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.equal(await empty.locator('.cmdk-empty-title').innerText(), 'No results for “zzqqxx”');
      assert.match(await empty.locator('.cmdk-empty-hint').innerText(), /task title/);
      const live = h.page.locator('[data-palette] [role="status"][aria-live="polite"]');
      await until(async () => (await live.innerText()) === 'No results for zzqqxx');
      assert.equal(await live.innerText(), 'No results for zzqqxx');
    } finally {
      await h.close();
    }
  });

  void test('Actions: the theme switches, and Create task opens the board’s form', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      const before = await h.page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      );
      await openWithKeys(h.page);
      await h.page.locator(INPUT).fill('theme');
      await until(async () => (await options(h.page)).some((l) => l.startsWith('Switch to')));
      await h.page.keyboard.press('Enter');
      await until(
        async () =>
          (await h.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !==
          before,
      );
      assert.notEqual(
        await h.page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        before,
        'the theme did not change',
      );

      await openWithKeys(h.page);
      await h.page.locator(INPUT).fill('create');
      await until(async () => (await options(h.page)).includes('Create task'));
      await h.page.keyboard.press('Enter');
      // `?new=task` is the board's contract (LAI-1167): the space opens its
      // Create task dialog and takes the parameter back out of the address.
      const dialog = h.page.locator('[data-dialog="create-task"]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.equal(new URL(h.page.url()).searchParams.get('project'), 'laika-core');
    } finally {
      await h.close();
    }
  });
});

void describe('accessibility and layout', () => {
  void test('combobox, listbox and options, driven by the arrows', async () => {
    const h = await open(START, stub());
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      const combobox = h.page.locator(INPUT);
      assert.equal(await combobox.getAttribute('aria-expanded'), 'true');
      const listbox = await combobox.getAttribute('aria-controls');
      assert.ok(listbox !== null, 'the combobox controls nothing');
      assert.equal(await h.page.locator(`[id="${listbox}"]`).getAttribute('role'), 'listbox');
      assert.equal(
        await h.page.locator(PALETTE).getAttribute('aria-modal'),
        'true',
        'the palette is not a modal dialog',
      );

      // On open the first row is highlighted **and announced**: the combobox
      // points at it before any arrow is pressed.
      const highlighted = (): Promise<string | null> =>
        h.page.locator('[data-palette] [role="option"][aria-selected="true"]').getAttribute('id');
      await until(async () => (await combobox.getAttribute('aria-activedescendant')) !== null);
      const first = await combobox.getAttribute('aria-activedescendant');
      assert.equal(
        first,
        await highlighted(),
        'the combobox does not point at the highlighted row',
      );
      assert.equal(
        first,
        await h.page.locator('[data-palette] [role="option"]').first().getAttribute('id'),
      );
      await h.page.keyboard.press('ArrowDown');
      const second = await combobox.getAttribute('aria-activedescendant');
      assert.ok(first !== null && second !== null && first !== second, 'ArrowDown did not move');
      await h.page.keyboard.press('ArrowUp');
      assert.equal(await combobox.getAttribute('aria-activedescendant'), first);
      // `loop`: up from the first is the last.
      await h.page.keyboard.press('ArrowUp');
      const last = await h.page.locator('[data-palette] [role="option"]').last().getAttribute('id');
      assert.equal(await combobox.getAttribute('aria-activedescendant'), last);
    } finally {
      await h.close();
    }
  });

  void test('a full-screen sheet at 390px, opened from the phone bar', async () => {
    const h = await open(START, stub(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      const trigger = h.page.locator('[data-palette-trigger="header"]');
      await trigger.waitFor({ timeout: 20_000 });
      await trigger.click();
      await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
      // Measured at rest, after the entry animation.
      await until(() => h.page.evaluate(() => document.getAnimations().length === 0));
      const box = await h.page.locator(PALETTE).boundingBox();
      assert.ok(box !== null);
      assert.deepEqual(
        [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
        [0, 0, 390, 844],
        'the palette is not a full-screen sheet on a phone',
      );
      const overflow = await h.page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false, 'the page scrolls sideways');
      await h.page.keyboard.press('Escape');
      await until(() =>
        h.page.evaluate(
          () => document.activeElement?.getAttribute('data-palette-trigger') === 'header',
        ),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-palette-trigger')),
        'header',
      );
    } finally {
      await h.close();
    }
  });

  void test('reduced motion: nothing animates', async () => {
    const h = await open(START, stub(), {
      before: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
      },
    });
    try {
      await ready(h.page);
      await openWithKeys(h.page);
      const names = await h.page.evaluate(() =>
        ['.cmdk-panel', '.cmdk-scrim'].map(
          (s) => getComputedStyle(document.querySelector(s)!).animationName,
        ),
      );
      assert.deepEqual(names, ['none', 'none']);
    } finally {
      await h.close();
    }
  });
});

void describe('the strict CSP', () => {
  void test('opening and searching causes no violation and adds no <style>', async () => {
    const h = await open(START, stub(), {
      before: async (page) => {
        await page.addInitScript(() => {
          const seen: string[] = [];
          (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
          document.addEventListener('securitypolicyviolation', (event) => {
            seen.push(`${event.violatedDirective} ${event.blockedURI} ${event.sample}`);
          });
        });
        await page.route('**/*', async (route) => {
          if (route.request().resourceType() !== 'document') {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          await route.fulfill({
            response,
            headers: { ...response.headers(), 'content-security-policy': CSP },
          });
        });
      },
    });
    try {
      await ready(h.page);
      const stylesBefore = await h.page.evaluate(() => document.querySelectorAll('style').length);
      await openWithKeys(h.page);
      await h.page.locator(INPUT).fill('login');
      await h.page
        .locator('[data-palette] [role="option"]', { hasText: 'LC-12' })
        .waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('ArrowDown');

      // The policy really is in force: an inline <style> is refused.
      await h.page.evaluate(() => {
        const probe = document.createElement('style');
        probe.textContent = 'body{}';
        probe.dataset.cspProbe = '';
        document.head.append(probe);
      });
      await until(
        async () =>
          (
            await h.page.evaluate(
              () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
            )
          ).length > 0,
      );
      const violations = await h.page.evaluate(
        () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
      );
      assert.equal(
        violations.length,
        1,
        `expected only the probe's violation: ${violations.join(' | ')}`,
      );
      assert.match(
        violations[0] ?? '',
        /^style-src-elem/,
        'the probe was not refused by style-src-elem',
      );

      const stylesAfter = await h.page.evaluate(
        () => document.querySelectorAll('style:not([data-csp-probe])').length,
      );
      assert.equal(stylesAfter, stylesBefore, 'the palette injected a <style> element');
    } finally {
      await h.close();
    }
  });
});

void describe('screenshots', () => {
  const dir = process.env.PALETTE_SCREENSHOTS;
  void test('dark and light, 1440 and 390', { skip: dir === undefined }, async () => {
    if (dir === undefined) return;
    mkdirSync(dir, { recursive: true });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      for (const theme of ['dark', 'light'] as const) {
        const h = await open(START, stub(), {
          before: async (page) => {
            await page.setViewportSize({ width, height });
            await page.emulateMedia({ colorScheme: theme });
            await page.addInitScript((t) => {
              localStorage.setItem('laika.theme', t);
            }, theme);
          },
        });
        try {
          const trigger = h.page.locator(width < 900 ? '[data-palette-trigger="header"]' : TRIGGER);
          await trigger.waitFor({ timeout: 20_000 });
          await trigger.click();
          await h.page.locator(INPUT).waitFor({ timeout: 10_000 });
          await h.page.locator(INPUT).fill('lc');
          await h.page
            .locator('[data-palette] [role="option"]', { hasText: 'LC-12' })
            .waitFor({ timeout: 10_000 });
          await h.page.screenshot({ path: join(dir, `palette-${theme}-${String(width)}.png`) });
        } finally {
          await h.close();
        }
      }
    }
  });
});
