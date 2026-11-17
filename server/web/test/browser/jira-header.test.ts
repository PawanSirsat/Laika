/**
 * The Jira-style top bar and the one global Create (LAI-1227), in a real
 * browser.
 *
 * - **The top bar** spans the window above the sidebar and the page, in
 *   Jira's order — the sidebar's toggle, the brand, the search, + Create, the
 *   reader's tools, the person — on a desktop, a tablet and a phone.
 * - **+ Create opens the dialog**, whose **Space** field lists only the
 *   spaces the server lets the reader create in, starts on the right one,
 *   and, when changed, reads the new space's statuses, sprints and members
 *   again, clears what the new space cannot take and cannot submit stale.
 *
 * The rules themselves are unit-tested in
 * `test/components/create-task/create-space.test.ts`; the toolbar's missing
 * Create in `space-header.test.ts`; the filled button and the unavailable
 * state in `header-actions.test.ts`; the brand and the fold in
 * `brand-identity.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  closeBrowser,
  DEFAULT_STATUSES,
  open,
  reply,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { CORE, DIALOG, NEW_TASK, SPRINT, task } from './create-task-fixtures.ts';

void after(async () => {
  await closeBrowser();
});

// ------------------------------------------------------------------ fixture

const space = (slug: string, name: string, prefix: string, color: string) => ({
  ...CORE,
  id: slug,
  slug,
  name,
  prefix,
  color,
});
/** A lead here: may create. */
const SHELL = space('laika-shell', 'Laika Shell', 'LS', 'teal');
/** A viewer here: may not create, so the field must not offer it. */
const DOCS = space('laika-docs', 'Laika Docs', 'LD', 'amber');

const listed = (p: typeof CORE) => ({
  ...p,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [],
  last_activity_at: 2,
});

const member = (id: string, name: string, role = 'member') => ({
  user_id: id,
  name,
  email: `${id}@example.com`,
  role,
  created_at: 1,
});

/** Shell's own columns: no id in common with Core's. */
const SHELL_STATUSES = [
  ['ls-ideas', 'Ideas', 'backlog'],
  ['ls-doing', 'Building', 'in_progress'],
  ['ls-shipped', 'Shipped', 'done'],
].map(([id, name, category], position) => ({
  id,
  project_id: SHELL.id,
  name,
  category,
  position,
  hidden: false,
  created_at: 1,
  task_count: 0,
}));

const ME = {
  id: 'u1',
  email: 'u1@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [
    { project_id: CORE.id, role: 'lead' },
    { project_id: SHELL.id, role: 'lead' },
    { project_id: DOCS.id, role: 'viewer' },
  ],
};

function stub(extra: ApiStub = {}): ApiStub {
  const empty = { data: [], next_cursor: null };
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [CORE, SHELL, DOCS].map(listed), next_cursor: null },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/statuses': { data: DEFAULT_STATUSES },
    '/api/v1/projects/laika-core/tasks': { data: [task(1), task(2)], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [member('u1', 'Ada Lovelace', 'lead'), member('u2', 'Tomas Member')],
    },
    '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
    '/api/v1/projects/laika-core/activity': empty,
    '/api/v1/projects/laika-core/tags': { tags: [{ name: 'ui', task_count: 3 }] },
    '/api/v1/projects/laika-shell': SHELL,
    '/api/v1/projects/laika-shell/statuses': { data: SHELL_STATUSES },
    '/api/v1/projects/laika-shell/tasks': empty,
    // Tomas is not in Shell: an assignee carried over from Core must go.
    '/api/v1/projects/laika-shell/members': { members: [member('u1', 'Ada Lovelace', 'lead')] },
    '/api/v1/projects/laika-shell/sprints': empty,
    '/api/v1/projects/laika-shell/activity': empty,
    '/api/v1/projects/laika-shell/tags': { tags: [] },
    '/api/v1/projects/laika-docs': DOCS,
    '/api/v1/agents': empty,
    '/api/v1/tasks': empty,
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    ...extra,
  };
}

const HEADER = '[data-app-header]';

async function at(h: Harness, width: number, height = 900): Promise<void> {
  await h.page.setViewportSize({ width, height });
  await h.page.locator(`${HEADER} [data-header-create]`).waitFor({ timeout: 20_000 });
}

const dialog = (page: Page) => page.locator(DIALOG);
const spaceField = (page: Page) => dialog(page).getByRole('combobox', { name: /^Space/ });

/** Open the dialog from the top bar, once Create is available. */
async function openCreate(page: Page): Promise<Locator> {
  const create = page.locator('[data-header-create]');
  await until(async () => (await create.getAttribute('aria-disabled')) === null, 15_000);
  await create.click();
  await dialog(page).locator('.ct-title-input').waitFor({ timeout: 15_000 });
  return dialog(page);
}

/** The options a Dropdown offers, by value, once its panel is open. */
async function offered(page: Page, trigger: Locator): Promise<string[]> {
  await trigger.click();
  const opts = page.locator('[role="listbox"] [role="option"]');
  await opts.first().waitFor({ timeout: 5_000 });
  const values = await opts.evaluateAll((els) => els.map((el) => el.getAttribute('data-value')));
  await page.keyboard.press('Escape');
  return values.filter((v): v is string => v !== null);
}

async function choose(page: Page, trigger: Locator, value: string): Promise<void> {
  await trigger.click();
  await page.locator(`[role="listbox"] [role="option"][data-value="${value}"]`).click();
}

const createButton = (page: Page) =>
  dialog(page).getByRole('button', { name: 'Create', exact: true });

// --------------------------------------------------------------- the top bar

void describe('the top bar (LAI-1227)', () => {
  for (const [width, label] of [
    [1440, 'a desktop'],
    [1024, 'a laptop'],
  ] as const) {
    void test(`on ${label}: one bar across the window, above the sidebar, in Jira’s order`, async () => {
      const h = await open('/board?project=laika-core', stub());
      try {
        await at(h, width);
        await h.page.locator('#sidebar .sidebar-link').first().waitFor({ timeout: 10_000 });
        const m = await h.page.evaluate((sel) => {
          const head = document.querySelector(sel)?.getBoundingClientRect();
          const side = document.querySelector('#sidebar')?.getBoundingClientRect();
          const main = document.querySelector('#main')?.getBoundingClientRect();
          // The bar's own controls, left to right, as a person sees them.
          const marks: [string, string][] = [
            ['toggle', '.sidebar-toggle'],
            ['brand', '[data-header-brand]'],
            ['search', '[data-palette-trigger="header"]'],
            ['create', '[data-header-create]'],
            ['bell', '[data-header-bell]'],
            ['help', '[data-header-help]'],
            ['settings', '[data-header-settings]'],
            ['person', '.user-menu-trigger'],
          ];
          const order = marks
            .map(([name, q]) => {
              const el = document.querySelector(`${sel} ${q}`);
              const r = el?.getBoundingClientRect();
              return r !== undefined && r.width > 0 ? ([name, r.left] as const) : null;
            })
            .filter((x): x is readonly [string, number] => x !== null)
            .sort((a, b) => a[1] - b[1])
            .map(([name]) => name);
          return {
            head: head && { left: head.left, width: head.width, bottom: head.bottom },
            sideTop: side?.top ?? -1,
            mainTop: main?.top ?? -1,
            vw: document.documentElement.clientWidth,
            order,
          };
        }, HEADER);
        assert.ok(m.head !== undefined, 'no top bar');
        assert.equal(m.head.left, 0, 'the bar does not start at the window’s edge');
        assert.equal(Math.round(m.head.width), m.vw, 'the bar does not span the window');
        assert.ok(m.sideTop >= m.head.bottom - 1, 'the sidebar starts above the bar’s foot');
        assert.ok(m.mainTop >= m.head.bottom - 1, 'the page starts above the bar’s foot');
        assert.deepEqual(m.order, [
          'toggle',
          'brand',
          'search',
          'create',
          'bell',
          'help',
          'settings',
          'person',
        ]);
      } finally {
        await h.close();
      }
    });
  }

  void test('the toggle folds the sidebar to its rail and back; the bar stays whole', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await at(h, 1440);
      const toggle = h.page.locator(`${HEADER} .sidebar-toggle`);
      const railWidth = () =>
        h.page.evaluate(() =>
          Math.round(document.querySelector('#sidebar')?.getBoundingClientRect().width ?? 0),
        );
      await until(async () => (await railWidth()) === 212);
      assert.equal(await toggle.getAttribute('aria-label'), 'Collapse sidebar');
      await toggle.click();
      await until(async () => (await railWidth()) === 60);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await toggle.getAttribute('aria-label'), 'Expand sidebar');
      const head = await h.page.locator(HEADER).boundingBox();
      assert.equal(Math.round(head?.width ?? 0), 1440, 'folding the rail moved the bar');
      await toggle.click();
      await until(async () => (await railWidth()) === 212);
    } finally {
      await h.close();
    }
  });

  void test('settings lists only what the reader can reach', async () => {
    const h = await open('/inbox', stub());
    try {
      await at(h, 1440);
      await h.page.locator('[data-header-settings]').click();
      const items = h.page.locator('#hdr-settings-menu [role="menuitem"]');
      await items.first().waitFor({ timeout: 5_000 });
      // Appearance, then exactly the settings pages the rail draws for this
      // reader — the same grants, read once (`navRoutes`).
      const rail = await h.page.locator('#sidebar .sidebar-link-label').allInnerTexts();
      const expected = [
        'Appearance',
        ...(rail.includes('Organisation') ? ['Organisation settings'] : []),
        ...(rail.includes('Developer access') ? ['Developer access'] : []),
      ];
      assert.ok(expected.length > 1, 'the rail drew no settings page — check the fixture');
      await until(async () => (await items.count()) === expected.length);
      assert.deepEqual(await items.allInnerTexts(), expected);
      await items.first().click();
      await until(() => new URL(h.page.url()).pathname === '/settings/appearance');
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`a phone, ${theme}: menu, mark, search, +, bell and the person — and nothing runs off`, async () => {
      const h = await open('/board?project=laika-core', stub(), {
        before: async (page) => {
          await page.addInitScript((t) => {
            localStorage.setItem('laika.theme', t);
          }, theme);
        },
      });
      try {
        await at(h, 390, 844);
        const shown = async (q: string): Promise<boolean> =>
          h.page.locator(`${HEADER} ${q}`).first().isVisible();
        for (const q of [
          '.shell-navtoggle',
          '[data-header-brand] .brand-mark',
          '[data-palette-trigger="header"]',
          '[data-header-create]',
          '[data-header-bell]',
          '.user-menu-trigger',
        ]) {
          assert.equal(await shown(q), true, `${q} is not on the phone’s bar`);
        }
        for (const q of ['.sidebar-toggle', '[data-header-help]', '[data-header-settings]']) {
          assert.equal(await shown(q), false, `${q} crowds the phone’s bar`);
        }
        // Create is its plus, named.
        const create = h.page.locator('[data-header-create]');
        assert.equal(await create.locator('.hdr-create-text').isVisible(), false);
        assert.match((await create.textContent()) ?? '', /Create/);
        const fit = await h.page.evaluate((sel) => {
          const head = document.querySelector(sel);
          const right = Math.max(
            ...[...(head?.querySelectorAll('button, a') ?? [])]
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0)
              .map((r) => r.right),
          );
          return {
            right,
            height: Math.round(head?.getBoundingClientRect().height ?? 0),
            sideways: document.documentElement.scrollWidth > innerWidth,
          };
        }, HEADER);
        assert.ok(fit.right <= 390, `a control ends at ${String(fit.right)}px`);
        assert.equal(fit.height, 48);
        assert.equal(fit.sideways, false, 'the page scrolls sideways');
        // The person menu opens from the bar, inside the window.
        await h.page.locator(`${HEADER} .user-menu-trigger`).click();
        const menu = h.page.locator('#user-menu');
        await menu.waitFor({ timeout: 5_000 });
        const box = await menu.boundingBox();
        assert.ok(box !== null && box.x >= 0 && box.x + box.width <= 390, 'the menu runs off');
        // Create opens the dialog on a phone too.
        await h.page.keyboard.press('Escape');
        await openCreate(h.page);
      } finally {
        await h.close();
      }
    });
  }
});

// ------------------------------------------------------------ the Space field

void describe('the Create task dialog’s Space field (LAI-1227)', () => {
  void test('lists only the spaces the reader may create in, each with its key', async () => {
    const h = await open('/inbox', stub());
    try {
      await at(h, 1440);
      await openCreate(h.page);
      const field = spaceField(h.page);
      await until(async () => (await field.innerText()).includes('Laika'));
      assert.deepEqual(await offered(h.page, field), ['laika-core', 'laika-shell']);
      await field.click();
      const shell = h.page.locator('[role="option"][data-value="laika-shell"]');
      assert.match(await shell.innerText(), /Laika Shell[\s\S]*LS/);
      assert.equal(await shell.locator('.ct-space-mark').getAttribute('data-color'), 'teal');
      await h.page.keyboard.press('Escape');
    } finally {
      await h.close();
    }
  });

  void test('starts on the space on screen; elsewhere on the last one used; else the first', async () => {
    // On a space: that space, whatever was used last.
    let h = await open('/board?project=laika-shell', stub(), {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.create.space', 'laika-core');
        });
      },
    });
    try {
      await at(h, 1440);
      await openCreate(h.page);
      assert.match(await spaceField(h.page).innerText(), /Laika Shell/);
    } finally {
      await h.close();
    }

    // Off a space: the last one used, while the reader may still create there.
    h = await open('/inbox', stub(), {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.create.space', 'laika-shell');
        });
      },
    });
    try {
      await at(h, 1440);
      await openCreate(h.page);
      await until(async () => (await spaceField(h.page).innerText()).includes('Laika Shell'));
      assert.match(await spaceField(h.page).innerText(), /Laika Shell/);
    } finally {
      await h.close();
    }

    // The last one used is one they may not create in any more: the first allowed.
    h = await open('/inbox', stub(), {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.create.space', 'laika-docs');
        });
      },
    });
    try {
      await at(h, 1440);
      await openCreate(h.page);
      await until(async () => (await spaceField(h.page).innerText()).includes('Laika Core'));
      assert.match(await spaceField(h.page).innerText(), /Laika Core/);
    } finally {
      await h.close();
    }
  });

  void test('a space’s c opens it in that space, as the top bar’s Create does', async () => {
    const h = await open('/calendar?project=laika-shell', stub());
    try {
      await at(h, 1440);
      await until(
        async () =>
          (await h.page.locator('[data-header-create]').getAttribute('aria-disabled')) === null,
        15_000,
      );
      await h.page.locator('body').click({ position: { x: 600, y: 500 } });
      await h.page.keyboard.press('c');
      await dialog(h.page).locator('.ct-title-input').waitFor({ timeout: 15_000 });
      assert.match(await spaceField(h.page).innerText(), /Laika Shell/);
    } finally {
      await h.close();
    }
  });

  void test('a change of space reads its statuses, sprints and members, clears what it cannot take, and creates there', async () => {
    const h = await open(
      '/board?project=laika-core',
      stub({
        '/api/v1/projects/laika-shell/tasks': (call: { method: string }) =>
          call.method === 'POST'
            ? reply(201, { ...NEW_TASK, project_id: SHELL.id, key: 'LS-1' })
            : { data: [], next_cursor: null },
      }),
    );
    try {
      await at(h, 1440);
      const d = await openCreate(h.page);
      await d.locator('.ct-title-input').fill('Move me');
      await choose(h.page, d.getByLabel('Status', { exact: true }), 'st-todo');
      await choose(h.page, d.getByLabel('Assignee', { exact: true }), 'u2');
      await choose(h.page, d.getByLabel('Sprint', { exact: true }), 's1');

      const reads = (suffix: string): number =>
        h.calls.filter(
          (c) => c.method === 'GET' && c.path === `/api/v1/projects/laika-shell${suffix}`,
        ).length;
      await choose(h.page, spaceField(h.page), 'laika-shell');

      // The new space's own lists were read…
      await until(
        () => reads('/statuses') > 0 && reads('/sprints') > 0 && reads('/members') > 0,
        10_000,
      );
      // …and the form shows them: Shell's default column, no sprint, nobody.
      const status = d.getByLabel('Status', { exact: true });
      await until(async () => (await status.getAttribute('data-value')) === 'ls-ideas', 10_000);
      assert.equal(await d.getByLabel('Sprint', { exact: true }).getAttribute('data-value'), '');
      await until(
        async () =>
          (await d.getByLabel('Assignee', { exact: true }).innerText()).trim() !== 'Tomas Member',
      );
      assert.deepEqual(await offered(h.page, status), ['ls-ideas', 'ls-doing', 'ls-shipped']);
      // What describes the task stayed.
      assert.equal(await d.locator('.ct-title-input').inputValue(), 'Move me');

      await until(
        async () => (await createButton(h.page).getAttribute('aria-disabled')) !== 'true',
      );
      await createButton(h.page).click();
      await d.waitFor({ state: 'detached', timeout: 10_000 });

      const posted = h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tasks'));
      assert.deepEqual(
        posted.map((c) => c.path),
        ['/api/v1/projects/laika-shell/tasks'],
        'created somewhere other than the chosen space',
      );
      const body = posted[0]?.body as Record<string, unknown>;
      assert.equal(body.status_id, 'ls-ideas');
      assert.equal(body.assignee_id, undefined, 'Core’s assignee was sent to Shell');
      assert.equal(
        h.calls.some((c) => c.method === 'POST' && c.path.startsWith('/api/v1/sprints/')),
        false,
        'Core’s sprint was set on a Shell task',
      );
      // Remembered for the next Create off a space.
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.create.space')),
        'laika-shell',
      );
    } finally {
      await h.close();
    }
  });

  void test('Create waits for the new space’s answers — no stale submit — and says why', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = await open('/board?project=laika-core', stub(), {
      before: async (page) => {
        await page.route('**/api/v1/projects/laika-shell/members', async (route) => {
          await held;
          await route.continue();
        });
      },
    });
    try {
      await at(h, 1440);
      const d = await openCreate(h.page);
      await d.locator('.ct-title-input').fill('Not yet');
      await until(
        async () => (await createButton(h.page).getAttribute('aria-disabled')) !== 'true',
      );
      await choose(h.page, spaceField(h.page), 'laika-shell');

      // Everything but the held members has answered: statuses and sprints.
      const read = (suffix: string): boolean =>
        h.calls.some(
          (c) => c.method === 'GET' && c.path === `/api/v1/projects/laika-shell${suffix}`,
        );
      await until(() => read('/statuses') && read('/sprints'), 10_000);
      await h.page.waitForTimeout(300);
      assert.equal(
        await createButton(h.page).getAttribute('aria-disabled'),
        'true',
        'Create is available before the new space’s members have answered',
      );
      assert.match(await d.locator('.ct-foot').innerText(), /Loading Laika Shell/);
      // Neither the Title's Enter nor ⌘/Ctrl+Enter gets past it.
      await d.locator('.ct-title-input').press('Enter');
      await d.locator('.ct-title-input').press('ControlOrMeta+Enter');
      await h.page.waitForTimeout(300);
      assert.equal(
        h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tasks')).length,
        0,
        'a create went out before the space had answered',
      );

      release();
      await until(
        async () => (await createButton(h.page).getAttribute('aria-disabled')) !== 'true',
      );
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('Create another keeps the chosen space', async () => {
    const h = await open(
      '/inbox',
      stub({
        '/api/v1/projects/laika-shell/tasks': (call: { method: string }) =>
          call.method === 'POST'
            ? reply(201, { ...NEW_TASK, project_id: SHELL.id, key: 'LS-1' })
            : { data: [], next_cursor: null },
      }),
    );
    try {
      await at(h, 1440);
      const d = await openCreate(h.page);
      await until(async () => (await spaceField(h.page).innerText()).includes('Laika Core'));
      await choose(h.page, spaceField(h.page), 'laika-shell');
      await d.locator('.ct-another input').check();
      await d.locator('.ct-title-input').fill('One');
      await until(
        async () => (await createButton(h.page).getAttribute('aria-disabled')) !== 'true',
      );
      await createButton(h.page).click();
      await until(async () => (await d.locator('.ct-title-input').inputValue()) === '');
      assert.match(await spaceField(h.page).innerText(), /Laika Shell/);
      // The toast opens the task in its own space, from a page that is not one.
      await h.page.locator('[data-created-toast]').getByRole('button', { name: 'Open' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('project') === 'laika-shell');
      assert.equal(new URL(h.page.url()).pathname, '/board');
    } finally {
      await h.close();
    }
  });

  void test('the palette’s Create task opens it; Create space is the palette’s too', async () => {
    const h = await open('/inbox', stub());
    try {
      await at(h, 1440);
      await h.page.keyboard.press('Meta+k');
      const input = h.page.locator('[data-palette] [role="combobox"]');
      await input.waitFor({ timeout: 10_000 });
      await input.fill('create');
      const labels = h.page.locator('[data-palette] [role="option"] .cmdk-item-label');
      await until(async () => (await labels.allInnerTexts()).includes('Create task'));
      // A member may not create spaces (project.create is an admin's).
      assert.equal((await labels.allInnerTexts()).includes('Create space'), false);
      await h.page.keyboard.press('Enter');
      await dialog(h.page).waitFor({ timeout: 10_000 });
      assert.equal(new URL(h.page.url()).pathname, '/inbox', 'Create task navigated');
    } finally {
      await h.close();
    }

    const admin = await open('/inbox', stub({ '/api/v1/me': { ...ME, org_role: 'admin' } }));
    try {
      await at(admin, 1440);
      await admin.page.keyboard.press('Meta+k');
      const input = admin.page.locator('[data-palette] [role="combobox"]');
      await input.waitFor({ timeout: 10_000 });
      await input.fill('create space');
      const option = admin.page.locator('[data-palette] [role="option"]', {
        hasText: 'Create space',
      });
      await option.first().waitFor({ timeout: 10_000 });
      await option.first().click();
      await until(() => new URL(admin.page.url()).pathname === '/projects');
    } finally {
      await admin.close();
    }
  });
});
