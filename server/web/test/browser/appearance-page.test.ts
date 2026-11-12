/**
 * The Appearance page, in a real browser (LAI-1212; the font half from
 * LAI-1125, when it was a side panel).
 *
 * What only a browser can say: that the page is reached from the person menu
 * and the palette; that choosing a theme repaints at once and that a reload
 * puts it on `<html>` **before the body is parsed** — no frame of the wrong
 * theme; that Black really is black and readable; that the radio groups answer
 * the keys; that Reset resets; that the layout holds at a phone's width; that
 * nothing trips the strict CSP; and that a chosen face changes the family
 * `body` is computed in and loads from our own assets — never one nobody chose.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, until, type ApiStub } from './harness.ts';

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
  '/api/v1/tasks': { data: [], next_cursor: null },
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
const PAGE = '/settings/appearance';

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

/** `data-theme` as theme.ts writes it: absent for dark. */
const attr = (theme: string): string | null => (theme === 'dark' ? null : theme);

const dataTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));

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

/** The page is up: its heading and its three radio groups. */
async function onPage(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 1, name: 'Appearance' }).waitFor({ timeout: 20_000 });
  await page.getByRole('radiogroup', { name: 'Theme' }).waitFor({ timeout: 5_000 });
}

/** Through the person menu, as a reader would. */
async function viaMenu(page: Page): Promise<void> {
  await page.locator('.user-menu-trigger').waitFor({ timeout: 20_000 });
  await page.locator('.user-menu-trigger').dispatchEvent('click');
  await page.getByRole('menuitem', { name: 'Appearance' }).dispatchEvent('click');
  await onPage(page);
}

const themes = (page: Page) => page.getByRole('radiogroup', { name: 'Theme' });
const themeRadio = (page: Page, name: string) =>
  themes(page).getByRole('radio', { name, exact: true });
const variants = (page: Page) => page.getByRole('radiogroup', { name: 'When System is dark, use' });
const fontRadio = (page: Page, label: string) =>
  page
    .getByRole('radiogroup', { name: 'Interface font' })
    .getByRole('radio', { name: label, exact: true });

/**
 * Record `data-theme` at the moment `<body>` is first inserted — before the
 * parser reaches the body, so before any paint — and every change after it.
 * An init script runs at document creation, ahead of every page script.
 */
async function watchFirstPaint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __atBody?: string | null; __themeChanges: string[] };
    w.__themeChanges = [];
    // On `document`, not `<html>`: an init script can run before the parser
    // has created the root element at all.
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target === document.documentElement) {
          w.__themeChanges.push(String(document.documentElement.getAttribute('data-theme')));
        }
        if (w.__atBody === undefined && document.body !== null) {
          w.__atBody = document.documentElement.getAttribute('data-theme');
        }
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ['data-theme'],
      childList: true,
      subtree: true,
    });
  });
}

async function firstPaint(page: Page): Promise<{ atBody: string | null; changes: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __atBody?: string | null; __themeChanges: string[] };
    if (w.__atBody === undefined) throw new Error('the body was never seen being inserted');
    return { atBody: w.__atBody, changes: w.__themeChanges };
  });
}

/** WCAG contrast of two computed `rgb()` colours. */
function contrast(a: string, b: string): number {
  const rgb = (c: string): number[] => {
    const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(c);
    assert.ok(m, `not an rgb() colour: ${c}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const lum = (c: string): number => {
    const [r, g, b] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Serve every document under the strict CSP, and collect what it refuses. */
async function strictCsp(page: Page): Promise<void> {
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
}

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

void describe('reaching the page', () => {
  void test('the person menu’s Appearance opens the page, not a sheet', async () => {
    const h = await open(BOARD, STUB);
    try {
      await viaMenu(h.page);
      assert.equal(new URL(h.page.url()).pathname, PAGE);
      assert.equal(await h.page.locator('[role="dialog"]').count(), 0, 'a dialog opened');
      assert.equal(await h.page.locator('.side-panel').count(), 0, 'the side panel is back');
      assert.equal(await themes(h.page).getByRole('radio').count(), 4);
      assert.equal(await variants(h.page).getByRole('radio').count(), 2);
      assert.equal(
        await h.page.getByRole('radiogroup', { name: 'Interface font' }).getByRole('radio').count(),
        FACES.length,
      );
      // Nothing chosen yet: System, Dark and the default face.
      assert.equal(await themeRadio(h.page, 'System').getAttribute('aria-checked'), 'true');
      assert.equal(
        await variants(h.page).getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked'),
        'true',
      );
      assert.equal(
        await fontRadio(h.page, 'Plus Jakarta Sans').getAttribute('aria-checked'),
        'true',
      );
      assert.equal(await h.page.title(), 'Appearance · Laika');
    } finally {
      await h.close();
    }
  });

  void test('the ⌘K palette’s Go to finds it, by name and by “black”', async () => {
    const h = await open(BOARD, STUB);
    try {
      await h.page.locator('[data-palette-trigger="sidebar"]').waitFor({ timeout: 20_000 });
      const input = h.page.locator('[data-palette] [role="combobox"]');
      await h.page.keyboard.press('Control+k');
      await input.waitFor({ timeout: 10_000 });
      await input.fill('black');
      const option = h.page.locator('[data-palette] [role="option"]', { hasText: 'Appearance' });
      await option.waitFor({ timeout: 5_000 });
      await input.fill('appearance');
      await option.waitFor({ timeout: 5_000 });
      await option.click();
      await onPage(h.page);
      assert.equal(new URL(h.page.url()).pathname, PAGE);
    } finally {
      await h.close();
    }
  });

  void test('the palette’s Switch theme goes light → the dark variant → light', async () => {
    const h = await open(BOARD, STUB, {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.theme', 'light');
          localStorage.setItem('laika.theme.dark', 'black');
        });
      },
    });
    try {
      await h.page.locator('[data-palette-trigger="sidebar"]').waitFor({ timeout: 20_000 });
      const input = h.page.locator('[data-palette] [role="combobox"]');
      for (const want of ['black', 'light']) {
        await h.page.keyboard.press('Control+k');
        await input.waitFor({ timeout: 10_000 });
        await input.fill('switch theme');
        const row = h.page.locator('[data-palette] [role="option"]', {
          hasText: `Switch to ${want} theme`,
        });
        await row.waitFor({ timeout: 5_000 });
        await row.click();
        await h.page.waitForFunction(
          (w: string | null) => document.documentElement.getAttribute('data-theme') === w,
          want,
          { timeout: 5_000 },
        );
        assert.equal(await dataTheme(h.page), want);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('choosing a theme', () => {
  for (const theme of ['light', 'black', 'dark'] as const) {
    void test(`${theme}: applies at once, is stored, and is on <html> before the body on reload`, async () => {
      const h = await open(PAGE, STUB, { before: watchFirstPaint });
      try {
        await onPage(h.page);
        // Start somewhere else, so the click is a change whichever theme this is.
        const from = theme === 'light' ? 'Black' : 'Light';
        await themeRadio(h.page, from).click();
        await themeRadio(h.page, theme[0]!.toUpperCase() + theme.slice(1)).click();
        // At once: no wait beyond the click's own round trip.
        assert.equal(await dataTheme(h.page), attr(theme));
        assert.equal(
          await themeRadio(h.page, theme[0]!.toUpperCase() + theme.slice(1)).getAttribute(
            'aria-checked',
          ),
          'true',
        );
        assert.equal(await h.page.evaluate(() => localStorage.getItem('laika.theme')), theme);
        assert.equal(await h.page.locator('.appearance-saved').innerText(), 'Saved on this device');
        assert.equal(
          await h.page.evaluate(() => document.documentElement.style.colorScheme),
          theme === 'light' ? 'light' : 'dark',
        );

        await h.page.reload();
        await onPage(h.page);
        const { atBody, changes } = await firstPaint(h.page);
        assert.equal(atBody, attr(theme), `the body was parsed under ${String(atBody)}`);
        // And it never flipped afterwards: every later write repeated the same value.
        assert.deepEqual(
          changes.filter((c) => c !== String(attr(theme))),
          [],
          `data-theme changed after first paint: ${changes.join(', ')}`,
        );
        assert.equal(await dataTheme(h.page), attr(theme));
      } finally {
        await h.close();
      }
    });
  }

  void test('System follows the OS, and the chosen dark variant, live and across a reload', async () => {
    const h = await open(PAGE, STUB, {
      before: async (page) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await watchFirstPaint(page);
      },
    });
    try {
      await onPage(h.page);
      assert.equal(await dataTheme(h.page), null, 'System on a dark OS starts as Dark');
      await variants(h.page).getByRole('radio', { name: 'Black' }).click();
      assert.equal(await dataTheme(h.page), 'black');
      assert.equal(await h.page.evaluate(() => localStorage.getItem('laika.theme.dark')), 'black');
      assert.equal(await h.page.evaluate(() => localStorage.getItem('laika.theme')), null);
      assert.match(await h.page.locator('.appearance-variant').innerText(), /Laika is black/);

      await h.page.emulateMedia({ colorScheme: 'light' });
      await h.page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'light',
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await dataTheme(h.page), 'light');
      await h.page.emulateMedia({ colorScheme: 'dark' });
      await h.page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'black',
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await dataTheme(h.page), 'black');

      await h.page.reload();
      await onPage(h.page);
      assert.equal((await firstPaint(h.page)).atBody, 'black');
      // An explicit theme ignores the variant.
      await themeRadio(h.page, 'Dark').click();
      assert.equal(await dataTheme(h.page), null);
    } finally {
      await h.close();
    }
  });

  void test('each theme card previews its own theme, whatever is on screen', async () => {
    const h = await open(PAGE, STUB);
    try {
      await onPage(h.page);
      await themeRadio(h.page, 'Light').click();
      const canvas = (theme: string) =>
        h.page
          .locator(`.appearance-card[data-value="${theme}"] .appearance-preview`)
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(await canvas('black'), 'rgb(0, 0, 0)');
      assert.equal(await canvas('dark'), 'rgb(11, 15, 26)');
      assert.equal(await canvas('light'), 'rgb(244, 247, 251)');
    } finally {
      await h.close();
    }
  });
});

void describe('Black', () => {
  void test('the canvas is true black and text clears AA on it and on a card', async () => {
    const h = await open(BOARD, STUB, {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.theme', 'black');
        });
      },
    });
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(await dataTheme(h.page), 'black');
      const read = await h.page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const get = (t: string) => css.getPropertyValue(t).trim();
        const probe = document.createElement('span');
        document.body.append(probe);
        const resolve = (v: string) => {
          probe.style.color = v;
          return getComputedStyle(probe).color;
        };
        const card = document.querySelector('.card');
        const out = {
          canvas: resolve(get('--bg-canvas')),
          card: card === null ? '' : getComputedStyle(card).backgroundColor,
          primary: resolve(get('--text-primary')),
          secondary: resolve(get('--text-secondary')),
          muted: resolve(get('--text-muted')),
          accent: resolve(get('--accent')),
          scheme: getComputedStyle(document.documentElement).colorScheme,
        };
        probe.remove();
        return out;
      });
      assert.equal(read.canvas, 'rgb(0, 0, 0)');
      assert.equal(read.scheme, 'dark');
      for (const [name, fg] of [
        ['primary', read.primary],
        ['secondary', read.secondary],
        ['accent', read.accent],
      ] as const) {
        assert.ok(contrast(fg, read.canvas) >= 4.5, `${name} on the canvas`);
        assert.ok(
          contrast(fg, read.card === '' ? read.canvas : read.card) >= 4.5,
          `${name} on a card`,
        );
      }
      // Muted text is held to 3:1 (token-list.ts), and clears it here.
      assert.ok(contrast(read.muted, read.canvas) >= 3, 'muted on the canvas');
    } finally {
      await h.close();
    }
  });

  void test('the reduced-transparency and forced-colours fallbacks reach Black', async () => {
    const h = await open(BOARD, STUB, {
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('laika.theme', 'black');
        });
      },
    });
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      // Translucent, as glass should be…
      assert.equal(
        await h.page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--glass-2').trim(),
        ),
        '#101010b3',
      );
      // …and the reduced-transparency block, which headless Chromium cannot
      // emulate, has a rule that matches <html> in Black and makes it solid.
      const solidRules = await h.page.evaluate(() => {
        const found: string[] = [];
        const walk = (rules: CSSRuleList, inside: boolean): void => {
          for (const rule of [...rules]) {
            if (rule instanceof CSSMediaRule) {
              walk(
                rule.cssRules,
                inside || rule.conditionText.includes('prefers-reduced-transparency'),
              );
            } else if (
              inside &&
              rule instanceof CSSStyleRule &&
              document.documentElement.matches(rule.selectorText) &&
              rule.style.getPropertyValue('--glass-2').includes('--glass-2-solid')
            ) {
              found.push(rule.selectorText);
            }
          }
        };
        for (const sheet of [...document.styleSheets]) walk(sheet.cssRules, false);
        return found;
      });
      assert.ok(solidRules.length > 0, 'no reduced-transparency rule reaches <html> in Black');

      // Forced colours: the frosted panes drop their blur.
      await h.page.emulateMedia({ forcedColors: 'active' });
      const blur = await h.page.evaluate(() => {
        const sidebar = document.querySelector('.sidebar');
        return sidebar === null ? 'missing' : getComputedStyle(sidebar, '::before').backdropFilter;
      });
      assert.equal(blur, 'none');
    } finally {
      await h.close();
    }
  });
});

void describe('before a session', () => {
  void test('the stored theme and face apply on the sign-in screen, from the first paint', async () => {
    const h = await open(
      '/login',
      {
        '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
        '/api/v1/setup/status': { setup_required: false },
      },
      {
        before: async (page) => {
          await watchFirstPaint(page);
          await page.addInitScript(() => {
            localStorage.setItem('laika.theme', 'black');
            localStorage.setItem('laika.font', 'carter-one');
          });
        },
      },
    );
    try {
      await h.page.locator('.auth').first().waitFor({ timeout: 20_000 });
      assert.equal((await firstPaint(h.page)).atBody, 'black');
      assert.equal(await dataTheme(h.page), 'black');
      // The canvas the sign-in screen sits on is Black's, #000.
      assert.equal(
        await h.page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--bg-canvas)';
          document.body.append(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        }),
        'rgb(0, 0, 0)',
      );
      assert.equal(await bodyFamily(h.page), 'Carter One');
      await loaded(h.page, 'Carter One');
    } finally {
      await h.close();
    }
  });
});

void describe('the keyboard', () => {
  void test('Theme: one tab stop; the arrows move and choose, wrapping; Home and End jump', async () => {
    const h = await open(PAGE, STUB);
    try {
      await onPage(h.page);
      const stops = await themes(h.page)
        .getByRole('radio')
        .evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length);
      assert.equal(stops, 1);
      const focused = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-value'));

      await themeRadio(h.page, 'System').focus();
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await focused(), 'light', 'ArrowRight from the last wraps to the first');
      assert.equal(await dataTheme(h.page), 'light');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await focused(), 'dark');
      assert.equal(await dataTheme(h.page), null);
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await focused(), 'black');
      assert.equal(await dataTheme(h.page), 'black');
      await h.page.keyboard.press('Home');
      assert.equal(await focused(), 'light');
      await h.page.keyboard.press('ArrowLeft');
      assert.equal(await focused(), 'system', 'ArrowLeft from the first wraps to the last');
      await h.page.keyboard.press('End');
      assert.equal(await focused(), 'system');

      const outline = await h.page.evaluate(() =>
        document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : 'none',
      );
      assert.equal(outline, 'solid', 'the focused card shows its ring');

      // Tab leaves the group for the next one: System's variant.
      await h.page.keyboard.press('Tab');
      assert.equal(await focused(), 'dark');
      assert.equal(
        await h.page.evaluate(() =>
          document.activeElement?.closest('[role="radiogroup"]')?.getAttribute('data-choices'),
        ),
        'dark-variant',
      );
    } finally {
      await h.close();
    }
  });

  void test('Interface font: the arrows choose a face, wrapping', async () => {
    const h = await open(PAGE, STUB);
    try {
      await onPage(h.page);
      await fontRadio(h.page, 'Plus Jakarta Sans').focus();
      const font = () => h.page.evaluate(() => document.documentElement.getAttribute('data-font'));
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await font(), 'poppins');
      assert.equal(await bodyFamily(h.page), 'Poppins');
      await h.page.keyboard.press('End');
      assert.equal(await font(), 'short-stack');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await font(), null, 'ArrowDown from the last wraps to the default');
    } finally {
      await h.close();
    }
  });
});

void describe('Reset to defaults', () => {
  void test('puts back System, Dark and the default face, and clears what was stored', async () => {
    const h = await open(PAGE, STUB);
    try {
      await onPage(h.page);
      const reset = h.page.getByRole('button', { name: 'Reset to defaults' });
      const disabled = () =>
        reset.evaluate(
          (el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
        );
      assert.equal(await disabled(), true, 'nothing to reset yet');

      await themeRadio(h.page, 'Black').click();
      await variants(h.page).getByRole('radio', { name: 'Black' }).click();
      await fontRadio(h.page, 'Poppins').click();
      assert.equal(await disabled(), false);
      assert.deepEqual(
        await h.page.evaluate(() => [
          localStorage.getItem('laika.theme'),
          localStorage.getItem('laika.theme.dark'),
          localStorage.getItem('laika.font'),
        ]),
        ['black', 'black', 'poppins'],
      );

      await reset.click();
      assert.deepEqual(
        await h.page.evaluate(() => [
          localStorage.getItem('laika.theme'),
          localStorage.getItem('laika.theme.dark'),
          localStorage.getItem('laika.font'),
        ]),
        [null, null, null],
      );
      assert.equal(await themeRadio(h.page, 'System').getAttribute('aria-checked'), 'true');
      assert.equal(
        await fontRadio(h.page, 'Plus Jakarta Sans').getAttribute('aria-checked'),
        'true',
      );
      assert.equal(
        await h.page.evaluate(() => document.documentElement.hasAttribute('data-font')),
        false,
      );
      assert.equal(await h.page.locator('.appearance-saved').innerText(), 'Reset to defaults');
      assert.equal(await disabled(), true);
    } finally {
      await h.close();
    }
  });
});

void describe('the layout', () => {
  for (const width of [390, 768, 1440]) {
    void test(`${String(width)}px: no sideways scroll in any theme${width === 390 ? ', the theme cards stacked' : ''}`, async () => {
      const h = await open(PAGE, STUB);
      try {
        await h.page.setViewportSize({ width, height: 900 });
        await onPage(h.page);
        for (const name of ['Light', 'Dark', 'Black', 'System']) {
          await themeRadio(h.page, name).click();
          const page = await h.page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(
            page <= width,
            `${name}: the page is ${String(page)}px wide at ${String(width)}px`,
          );
          const overflow = await h.page
            .locator('.appearance-card, .appearance-font, .appearance-fact')
            .evaluateAll((els: Element[]): string[] =>
              els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
            );
          assert.deepEqual(overflow, [], `${name}: a card's content overflows it`);
        }
        const lefts = await h.page
          .locator('.appearance-card')
          .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
        assert.equal(lefts.length, 4);
        if (width === 390) {
          assert.equal(new Set(lefts).size, 1, `not stacked: ${lefts.join(', ')}`);
        } else if (width === 1440) {
          assert.equal(new Set(lefts).size, 4, `not one row: ${lefts.join(', ')}`);
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the strict CSP', () => {
  void test('visiting, choosing every theme and reloading causes no violation', async () => {
    const h = await open(PAGE, STUB, { before: strictCsp });
    try {
      await onPage(h.page);
      // The policy really is in force: an inline <script> is refused.
      await h.page.evaluate(() => {
        const probe = document.createElement('script');
        probe.textContent = 'window.__probe = 1';
        document.head.append(probe);
      });
      await until(async () =>
        (
          await h.page.evaluate(
            () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
          )
        ).some((v) => v.startsWith('script-src')),
      );
      await h.page.evaluate(() => {
        (window as unknown as { __cspViolations: string[] }).__cspViolations.length = 0;
      });
      for (const name of ['Light', 'Black', 'Dark', 'System']) {
        await themeRadio(h.page, name).click();
      }
      await fontRadio(h.page, 'Poppins').click();
      await themeRadio(h.page, 'Black').click();
      assert.deepEqual(
        await h.page.evaluate(
          () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
        ),
        [],
      );
      await h.page.reload();
      await onPage(h.page);
      assert.equal(await dataTheme(h.page), 'black', 'the boot script ran under the policy');
      assert.deepEqual(
        await h.page.evaluate(
          () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
        ),
        [],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('choosing a face', () => {
  for (const theme of ['dark', 'black', 'light']) {
    void test(`${theme}: each face changes body's computed family and loads from our own assets`, async () => {
      const h = await open(PAGE, STUB, {
        before: async (page) => {
          await page.addInitScript((t: string) => {
            localStorage.setItem('laika.theme', t);
          }, theme);
        },
      });
      try {
        await onPage(h.page);
        // Each option previews itself: its name is set in its own face.
        for (const face of FACES) {
          const family = await fontRadio(h.page, face.label)
            .locator('.appearance-font-name')
            .evaluate((el) =>
              (getComputedStyle(el).fontFamily.split(',')[0] ?? '')
                .trim()
                .replace(/^["']|["']$/g, ''),
            );
          assert.equal(family, face.family, `${face.label}'s preview`);
        }
        for (const label of ['Carter One', 'Short Stack']) {
          assert.match(await fontRadio(h.page, label).innerText(), /less suited to dense tables/);
        }
        for (const face of [...ADDED, FACES[0]]) {
          await fontRadio(h.page, face.label).click();
          assert.equal(await bodyFamily(h.page), face.family, face.label);
          await loaded(h.page, face.family);
          assert.equal(await fontRadio(h.page, face.label).getAttribute('aria-checked'), 'true');
          const stored = await h.page.evaluate(() => localStorage.getItem('laika.font'));
          assert.equal(
            stored,
            face.id === 'plus-jakarta-sans' ? null : face.id,
            `${face.label} stored`,
          );
        }
        const mono = await h.page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
        );
        assert.match(mono, /JetBrains Mono Variable/);
      } finally {
        await h.close();
      }
    });
  }

  void test('the choice survives a reload', async () => {
    const h = await open(PAGE, STUB);
    try {
      await onPage(h.page);
      await fontRadio(h.page, 'Short Stack').click();
      await h.page.reload();
      await onPage(h.page);
      assert.equal(
        await h.page.evaluate(() => document.documentElement.getAttribute('data-font')),
        'short-stack',
      );
      assert.equal(await bodyFamily(h.page), 'Short Stack');
      assert.equal(await fontRadio(h.page, 'Short Stack').getAttribute('aria-checked'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('garbage in storage is the default face and the System theme', async () => {
    const h = await open(BOARD, STUB, {
      before: async (page) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.addInitScript(() => {
          localStorage.setItem('laika.font', 'comic-sans');
          localStorage.setItem('laika.theme', 'sepia');
          localStorage.setItem('laika.theme.dark', 'oled');
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
      assert.equal(await dataTheme(h.page), 'light', 'System on a light OS');
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
