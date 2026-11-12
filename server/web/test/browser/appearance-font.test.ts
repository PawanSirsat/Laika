/**
 * Appearance → Interface font, in a real browser (LAI-1125).
 *
 * What only a browser can say: that choosing a face changes the family `body`
 * is **computed** in and that the face actually **loads** from our own
 * assets; that the choice survives a reload and reaches the sign-in screen;
 * that the radio group answers the arrows; and — the bundle-discipline half —
 * that a face nobody chose is never requested, because an `@font-face` costs
 * nothing until text is set in it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, setTheme, type ApiStub } from './harness.ts';

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
  task_counts: { backlog: 2, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-9',
  number: 9,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: Date.now() - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [CORE], next_cursor: null },
  '/api/v1/projects/laika-core': {
    id: CORE.id,
    slug: CORE.slug,
    prefix: CORE.prefix,
    name: CORE.name,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/projects/laika-core/tasks': {
    data: [
      task({
        id: 't1',
        key: 'LC-1',
        number: 1,
        title: 'Presence strip reads the heartbeat table and keeps it current across reconnects',
      }),
      task({ id: 't2', key: 'LC-2', number: 2, title: 'Org settings and org-role management' }),
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

const BOARD = '/board?project=laika-core';

/** Each face: the radio's name, the family `body` must compute, its files' prefix. */
const FACES = [
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    family: 'Plus Jakarta Sans Variable',
    file: 'plus-jakarta-sans-',
  },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', file: 'poppins-' },
  {
    id: 'commissioner',
    label: 'Commissioner',
    family: 'Commissioner Variable',
    file: 'commissioner-',
  },
  { id: 'average-sans', label: 'Average Sans', family: 'Average Sans', file: 'average-sans-' },
  { id: 'carter-one', label: 'Carter One', family: 'Carter One', file: 'carter-one-' },
  { id: 'short-stack', label: 'Short Stack', family: 'Short Stack', file: 'short-stack-' },
] as const;

const ADDED = FACES.filter((f) => f.id !== 'plus-jakarta-sans');

/** The first family `body` is computed in, unquoted. */
async function bodyFamily(page: Page): Promise<string> {
  return page.evaluate(() =>
    (getComputedStyle(document.body).fontFamily.split(',')[0] ?? '')
      .trim()
      .replace(/^["']|["']$/g, ''),
  );
}

/** Wait until a face of `family` has actually loaded — the file arrived and parsed. */
async function loaded(page: Page, family: string): Promise<void> {
  await page.waitForFunction(
    (want: string) =>
      [...document.fonts].some(
        (f) => f.family.replace(/["']/g, '') === want && f.status === 'loaded',
      ),
    family,
    { timeout: 10_000 },
  );
}

async function openAppearance(page: Page) {
  await page.locator('.user-menu-trigger').waitFor({ timeout: 20_000 });
  await page.locator('.user-menu-trigger').dispatchEvent('click');
  await page.getByRole('menuitem', { name: 'Appearance…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Appearance' });
  await dialog.waitFor({ timeout: 5_000 });
  return dialog;
}

const radio = (page: Page, label: string) =>
  page
    .getByRole('radiogroup', { name: 'Interface font' })
    .getByRole('radio', { name: new RegExp(`^${label}`) });

/** Every font file the page asked for, by basename. */
function recordFonts(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\.woff2?$/.test(path)) seen.push(path.slice(path.lastIndexOf('/') + 1));
  });
  return seen;
}

void after(async () => {
  await closeBrowser();
});

void describe('Appearance opens from the person menu', () => {
  void test('a dialog with a Theme group and an Interface font group, the default chosen', async () => {
    const h = await open(BOARD, STUB);
    try {
      const dialog = await openAppearance(h.page);
      assert.equal(await dialog.getByRole('radiogroup').count(), 2);
      assert.equal(
        await dialog.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio').count(),
        2,
      );
      assert.equal(
        await dialog.getByRole('radiogroup', { name: 'Interface font' }).getByRole('radio').count(),
        FACES.length,
      );
      assert.equal(await radio(h.page, 'Plus Jakarta Sans').getAttribute('aria-checked'), 'true');
      assert.equal(
        await h.page.evaluate(() => document.documentElement.hasAttribute('data-font')),
        false,
      );
      // Each option previews itself: its name is set in its own face.
      for (const face of FACES) {
        const family = await radio(h.page, face.label)
          .locator('.appearance-choice-label')
          .evaluate((el) =>
            (getComputedStyle(el).fontFamily.split(',')[0] ?? '')
              .trim()
              .replace(/^["']|["']$/g, ''),
          );
        assert.equal(family, face.family, `${face.label}'s preview`);
      }
      // The display faces say what they cost.
      for (const label of ['Carter One', 'Short Stack']) {
        assert.match(await radio(h.page, label).innerText(), /less suited to dense tables/);
      }
    } finally {
      await h.close();
    }
  });

  void test('the theme group switches the theme through the one store', async () => {
    const h = await open(BOARD, STUB);
    try {
      await setTheme(h.page, 'dark');
      const dialog = await openAppearance(h.page);
      const themes = dialog.getByRole('radiogroup', { name: 'Theme' });
      await themes.getByRole('radio', { name: 'Light' }).click();
      await h.page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'light',
      );
      assert.equal(
        await themes.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked'),
        'true',
      );
      assert.equal(await h.page.evaluate(() => localStorage.getItem('laika.theme')), 'light');
    } finally {
      await h.close();
    }
  });
});

void describe('choosing a face', () => {
  for (const theme of ['dark', 'light']) {
    void test(`${theme}: each face changes body's computed family and loads from our own assets`, async () => {
      const h = await open(BOARD, STUB);
      try {
        await setTheme(h.page, theme);
        await openAppearance(h.page);
        for (const face of [...ADDED, FACES[0]]) {
          await radio(h.page, face.label).click();
          assert.equal(await bodyFamily(h.page), face.family, face.label);
          await loaded(h.page, face.family);
          assert.equal(await radio(h.page, face.label).getAttribute('aria-checked'), 'true');
          const stored = await h.page.evaluate(() => localStorage.getItem('laika.font'));
          assert.equal(
            stored,
            face.id === 'plus-jakarta-sans' ? null : face.id,
            `${face.label} stored`,
          );
        }
        // Monospace never follows.
        const mono = await h.page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
        );
        assert.match(mono, /JetBrains Mono Variable/);
      } finally {
        await h.close();
      }
    });
  }

  void test('the choice survives a reload, before anything is opened', async () => {
    const h = await open(BOARD, STUB);
    try {
      await openAppearance(h.page);
      await radio(h.page, 'Short Stack').click();
      await h.page.reload();
      await h.page.locator('.user-menu-trigger').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.evaluate(() => document.documentElement.getAttribute('data-font')),
        'short-stack',
      );
      assert.equal(await bodyFamily(h.page), 'Short Stack');
      await openAppearance(h.page);
      assert.equal(await radio(h.page, 'Short Stack').getAttribute('aria-checked'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('garbage in storage is the default face', async () => {
    const h = await open(BOARD, STUB, {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.font', 'comic-sans');
        });
      },
    });
    try {
      await h.page.locator('.user-menu-trigger').waitFor({ timeout: 20_000 });
      assert.equal(await bodyFamily(h.page), 'Plus Jakarta Sans Variable');
      assert.equal(
        await h.page.evaluate(() => document.documentElement.hasAttribute('data-font')),
        false,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the keyboard', () => {
  void test('one tab stop; the arrows move and choose, wrapping; Home and End jump', async () => {
    const h = await open(BOARD, STUB);
    try {
      await openAppearance(h.page);
      const fonts = h.page.getByRole('radiogroup', { name: 'Interface font' });
      // Only the chosen option is in the tab order.
      const stops = await fonts
        .getByRole('radio')
        .evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length);
      assert.equal(stops, 1);

      await radio(h.page, 'Plus Jakarta Sans').focus();
      const focused = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-value'));
      const font = () => h.page.evaluate(() => document.documentElement.getAttribute('data-font'));

      await h.page.keyboard.press('ArrowDown');
      assert.equal(await focused(), 'poppins');
      assert.equal(await font(), 'poppins');
      assert.equal(await bodyFamily(h.page), 'Poppins');

      await h.page.keyboard.press('ArrowRight');
      assert.equal(await font(), 'commissioner');

      await h.page.keyboard.press('End');
      assert.equal(await focused(), 'short-stack');
      assert.equal(await font(), 'short-stack');

      await h.page.keyboard.press('ArrowDown');
      assert.equal(
        await focused(),
        'plus-jakarta-sans',
        'ArrowDown from the last wraps to the first',
      );
      assert.equal(await font(), null);

      await h.page.keyboard.press('ArrowUp');
      assert.equal(await focused(), 'short-stack', 'ArrowUp from the first wraps to the last');

      await h.page.keyboard.press('Home');
      assert.equal(await focused(), 'plus-jakarta-sans');

      // The focus ring is visible on the option the keyboard is on.
      const outline = await h.page.evaluate(() =>
        document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : 'none',
      );
      assert.equal(outline, 'solid');

      // Escape closes the panel and hands the focus back to the menu's trigger.
      await h.page.keyboard.press('Escape');
      await h.page
        .getByRole('dialog', { name: 'Appearance' })
        .waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(
        await h.page.evaluate(() =>
          document.activeElement?.classList.contains('user-menu-trigger'),
        ),
        true,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('before a session', () => {
  void test('the stored face applies on the sign-in screen', async () => {
    const h = await open(
      '/login',
      {
        '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
        '/api/v1/setup/status': { setup_required: false },
      },
      {
        before: async (page) => {
          await page.addInitScript(() => {
            localStorage.setItem('laika.font', 'carter-one');
          });
        },
      },
    );
    try {
      await h.page.locator('.auth').first().waitFor({ timeout: 20_000 });
      assert.equal(await bodyFamily(h.page), 'Carter One');
      await loaded(h.page, 'Carter One');
    } finally {
      await h.close();
    }
  });
});

void describe('first load fetches only the face in use', () => {
  for (const stored of [undefined, 'poppins'] as const) {
    void test(`${stored ?? 'the default'}: no other added face's file is requested`, async () => {
      let seen: string[] = [];
      const h = await open(BOARD, STUB, {
        before: async (page) => {
          seen = recordFonts(page);
          if (stored !== undefined) {
            await page.addInitScript((id: string) => {
              localStorage.setItem('laika.font', id);
            }, stored);
          }
        },
      });
      try {
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
        const inUse = FACES.find((f) => f.id === (stored ?? 'plus-jakarta-sans'));
        assert.ok(inUse !== undefined);
        // Positive control: the face in use was requested, so the recorder works.
        assert.ok(
          seen.some((file) => file.startsWith(inUse.file)),
          `${inUse.file}* never requested; saw ${seen.join(', ')}`,
        );
        const stray = seen.filter((file) =>
          ADDED.some((face) => face.id !== inUse.id && file.startsWith(face.file)),
        );
        assert.deepEqual(stray, [], 'a face nobody chose was downloaded');
        // Only woff2: the woff fallbacks are for browsers this app does not support.
        assert.deepEqual(
          seen.filter((file) => file.endsWith('.woff')),
          [],
        );
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the layout holds in every face', () => {
  for (const width of [390, 1440]) {
    void test(`${String(width)}px: the panel never scrolls sideways and the cards keep their titles inside`, async () => {
      const h = await open(BOARD, STUB);
      try {
        await h.page.setViewportSize({ width, height: 900 });
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        if (width === 390) {
          await h.page.locator('.shell-navtoggle').click();
          await h.page.locator('.sidebar-open').waitFor({ timeout: 5_000 });
        }
        await openAppearance(h.page);
        for (const face of FACES) {
          await radio(h.page, face.label).click();
          await loaded(h.page, face.family);
          const panel = await h.page
            .locator('.side-panel-body')
            .evaluate((el) => [el.scrollWidth, el.clientWidth]);
          assert.ok(
            (panel[0] ?? 0) <= (panel[1] ?? 0),
            `${face.label}: the panel scrolls sideways at ${String(width)}px`,
          );
          const page = await h.page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(
            page <= width,
            `${face.label}: the page is ${String(page)}px wide at ${String(width)}px`,
          );
          const cards = await h.page
            .locator('.card')
            .evaluateAll((els) => els.map((el) => el.scrollWidth - el.clientWidth));
          assert.ok(cards.length > 0, 'no cards to measure');
          assert.deepEqual(
            cards.filter((d) => d > 0),
            [],
            `${face.label}: a card's content overflows it`,
          );
        }
      } finally {
        await h.close();
      }
    });
  }
});
