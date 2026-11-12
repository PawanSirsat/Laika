/**
 * The brand identity in a real browser (LAI-1126).
 *
 * What is asserted here needs a page: that the favicon is linked and served
 * from our own origin, that the splash is on screen **before any script has
 * run** and gone once the app mounts, that the icon loader stops moving under
 * reduced motion, that the rail swaps lockup for mark, and that a sign-in page
 * says "Laika" once. The geometry and the source-level rules are in
 * `test/components/brand/brand-paths.test.ts`.
 *
 * Set `BRAND_SHOTS=<dir>` to also write the review screenshots (both themes,
 * 1440 and 390 wide) — off by default, so the gate never writes files.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

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
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const SIGNED_IN: ApiStub = {
  '/api/v1/me': ME,
  '/api/v1/projects': { data: [CORE], next_cursor: null },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'org1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
};

const SIGNED_OUT: ApiStub = {
  '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
  '/api/v1/setup/status': { setup_required: false },
};

/** Stop every script, so the page is exactly what `index.html` paints alone. */
async function noScript(page: Page): Promise<void> {
  await page.route('**/*.js', (route) => route.abort());
}

const SHOTS = process.env.BRAND_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined || SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

void after(async () => {
  await closeBrowser();
});

void describe('the favicon', () => {
  void test('is the brand mark, linked from index.html and served from our own origin', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      const link = h.page.locator('head link[rel="icon"]');
      assert.equal(await link.count(), 1, 'no favicon link in the document head');
      assert.equal(await link.getAttribute('type'), 'image/svg+xml');

      const href = await link.evaluate((el) => (el as HTMLLinkElement).href);
      assert.equal(new URL(href).origin, h.origin, `the favicon is not same-origin: ${href}`);

      const res = await h.page.request.get(href);
      assert.equal(res.status(), 200, 'the favicon is linked but not served');
      assert.match(res.headers()['content-type'] ?? '', /image\/svg\+xml/);
      assert.match(await res.text(), /<svg[\s\S]*M25 9H37L27 47H15Z/, 'not the brand mark');

      // The app names each route in front of the product (`Sign in · Laika`).
      assert.match(await h.page.title(), /(^|· )Laika$/);
    } finally {
      await h.close();
    }
  });
});

void describe('the startup splash', () => {
  void test('is on screen and styled before any script runs', async () => {
    const h = await open('/login', SIGNED_OUT, { before: noScript });
    try {
      const splash = h.page.locator('[data-boot-splash]');
      await splash.waitFor({ state: 'visible', timeout: 20_000 });

      // Styled by the linked stylesheet — not by anything a script injected,
      // because no script ran. An unstyled splash would be static flow.
      const look = await splash.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { position: cs.position, image: cs.backgroundImage };
      });
      assert.equal(look.position, 'fixed', 'the splash stylesheet did not apply');
      assert.match(look.image, /linear-gradient/, 'the splash has no brand ground');

      assert.equal(await splash.getAttribute('role'), 'status');
      assert.equal(await h.page.getByRole('img', { name: 'Laika' }).count(), 1);
      assert.equal(await h.page.locator('.brand-splash-step').count(), 4);
      const box = await h.page.locator('.brand-splash-panel').boundingBox();
      assert.ok(box !== null && box.width > 200, 'the splash panel has no box');
    } finally {
      await h.close();
    }
  });

  void test('is replaced by the app on mount', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      await h.page.locator('.auth-card').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('[data-boot-splash]').count(),
        0,
        'the boot splash survived the first render',
      );
    } finally {
      await h.close();
    }
  });

  void test('steps under normal motion and holds still under reduced motion', async () => {
    const moving = await open('/login', SIGNED_OUT, { before: noScript });
    try {
      const step = moving.page.locator('.brand-splash-step').first();
      await step.waitFor({ timeout: 20_000 });
      assert.equal(await step.evaluate((el) => getComputedStyle(el).animationName), 'brand-step');
    } finally {
      await moving.close();
    }

    const still = await open('/login', SIGNED_OUT, {
      before: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await noScript(page);
      },
    });
    try {
      const steps = still.page.locator('.brand-splash-step');
      await steps.first().waitFor({ timeout: 20_000 });
      const read = await steps.evaluateAll((els) =>
        els.map((el) => ({
          animation: getComputedStyle(el).animationName,
          background: getComputedStyle(el).backgroundColor,
        })),
      );
      assert.deepEqual(
        read.map((r) => r.animation),
        ['none', 'none', 'none', 'none'],
        'a pill is still stepping under reduced motion',
      );
      // Still a loader: one pill lit, the rest the track.
      assert.notEqual(read[0]?.background, read[1]?.background, 'no pill is lit when still');
    } finally {
      await still.close();
    }
  });
});

void describe('the icon loader', () => {
  void test('is a named status that turns, and stops turning under reduced motion', async () => {
    const h = await open('/design/states', SIGNED_OUT);
    try {
      const spinner = h.page.getByRole('status', { name: 'Loading, medium' });
      await spinner.waitFor({ timeout: 20_000 });
      const ring = spinner.locator('.brand-spinner-ring');
      assert.equal(await ring.evaluate((el) => getComputedStyle(el).animationName), 'brand-spin');
      assert.equal(await spinner.locator('.brand-mark').getAttribute('aria-hidden'), 'true');

      await h.page.emulateMedia({ reducedMotion: 'reduce' });
      await until(
        async () => (await ring.evaluate((el) => getComputedStyle(el).animationName)) === 'none',
      );
      assert.equal(await ring.evaluate((el) => getComputedStyle(el).animationName), 'none');
      // The arc is still drawn: a still loader, not a missing one.
      const arc = await spinner.locator('.brand-spinner-arc').boundingBox();
      assert.ok(arc !== null && arc.width > 0, 'the arc vanished under reduced motion');

      for (const size of ['small', 'large']) {
        assert.equal(await h.page.getByRole('status', { name: `Loading, ${size}` }).count(), 1);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the sidebar head', () => {
  void test('shows mark and wordmark expanded, the mark alone collapsed', async () => {
    const h = await open('/board?project=laika-core', SIGNED_IN);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      const head = h.page.locator('.sidebar-head');
      await head.locator('.sidebar-wordmark').waitFor({ timeout: 20_000 });

      assert.ok(await head.locator('.brand-mark').isVisible(), 'no mark in the expanded head');
      assert.ok(
        await head.locator('.sidebar-wordmark .brand-wordmark svg').isVisible(),
        'no drawn wordmark in the expanded head',
      );
      // The name is still text, which is what the rest of the suite reads.
      assert.equal(await head.locator('.sidebar-wordmark').textContent(), 'Laika');

      await h.page.locator('.sidebar-toggle').click();
      await h.page.locator('.sidebar-collapsed').waitFor({ timeout: 10_000 });
      assert.equal(await head.locator('.sidebar-wordmark').count(), 0, 'wordmark in the rail');
      assert.ok(await head.locator('.brand-mark').isVisible(), 'the rail lost the mark');
    } finally {
      await h.close();
    }
  });
});

void describe('the sign-in page', () => {
  void test('carries the lockup once, and no second "Laika" in the header', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      await h.page.locator('.auth-card').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.getByRole('img', { name: 'Laika' }).count(),
        1,
        'the lockup is missing or repeated',
      );
      assert.equal(
        await h.page.locator('.auth-card .brand-lockup').count(),
        1,
        'the lockup is not on the card',
      );
      assert.equal(await h.page.locator('.shell-head .brand-lockup').count(), 0);
      assert.equal(await h.page.getByText('Laika', { exact: true }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a public page without a card still names the product in its header', async () => {
    const h = await open('/design/states', SIGNED_OUT);
    try {
      const brand = h.page.locator('.shell-head .brand-lockup');
      await brand.waitFor({ timeout: 20_000 });
      assert.equal(await brand.getAttribute('aria-label'), 'Laika');
    } finally {
      await h.close();
    }
  });
});

void describe('review screenshots', { skip: SHOTS === undefined || SHOTS === '' }, () => {
  for (const width of [1440, 390]) {
    for (const theme of ['Dark', 'Light']) {
      const tag = `${theme.toLowerCase()}-${String(width)}`;

      void test(`login, ${tag}`, async () => {
        const h = await open('/login', SIGNED_OUT);
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await h.page.locator('.auth-card').waitFor({ timeout: 20_000 });
          await setTheme(h.page, theme);
          await h.page.waitForTimeout(300);
          await shoot(h.page, `login-${tag}`);
        } finally {
          await h.close();
        }
      });

      void test(`splash, ${tag}`, async () => {
        const h = await open('/login', SIGNED_OUT, { before: noScript });
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await h.page.locator('[data-boot-splash]').waitFor({ timeout: 20_000 });
          // No script runs here, so the theme is set the way initTheme would.
          if (theme === 'Light') {
            await h.page.evaluate(() => {
              document.documentElement.setAttribute('data-theme', 'light');
            });
          }
          await h.page.waitForTimeout(200);
          await shoot(h.page, `splash-${tag}`);
        } finally {
          await h.close();
        }
      });

      void test(`spinner, ${tag}`, async () => {
        const h = await open('/design/states', SIGNED_OUT);
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          const item = h.page.locator('.gallery-item', { hasText: 'Loading — whole panel' });
          await item.waitFor({ timeout: 20_000 });
          await item.scrollIntoViewIfNeeded();
          await h.page.emulateMedia({ reducedMotion: 'reduce' });
          await h.page.waitForTimeout(200);
          if (SHOTS !== undefined) {
            mkdirSync(SHOTS, { recursive: true });
            await item.screenshot({ path: join(SHOTS, `spinner-${tag}.png`) });
          }
        } finally {
          await h.close();
        }
      });

      if (width === 1440) {
        void test(`sidebar expanded and collapsed, ${tag}`, async () => {
          const h = await open('/board?project=laika-core', SIGNED_IN);
          try {
            await h.page.setViewportSize({ width, height: 900 });
            await h.page.locator('.sidebar-wordmark').waitFor({ timeout: 20_000 });
            await setTheme(h.page, theme);
            await h.page.waitForTimeout(300);
            await shoot(h.page, `sidebar-expanded-${tag}`);
            await h.page.locator('.sidebar-toggle').click();
            await h.page.locator('.sidebar-collapsed').waitFor({ timeout: 10_000 });
            await h.page.waitForTimeout(300);
            await shoot(h.page, `sidebar-collapsed-${tag}`);
            // Leave the rail as found: it is remembered in this browser.
            await h.page.locator('.sidebar-toggle').click();
          } finally {
            await h.close();
          }
        });
      } else {
        void test(`sidebar open on a phone, ${tag}`, async () => {
          const h = await open('/board?project=laika-core', SIGNED_IN);
          try {
            await h.page.setViewportSize({ width, height: 844 });
            await h.page.locator('.shell-navtoggle').waitFor({ timeout: 20_000 });
            await setTheme(h.page, theme);
            await h.page.locator('.shell-navtoggle').click();
            await h.page.waitForTimeout(400);
            await shoot(h.page, `sidebar-expanded-${tag}`);
          } finally {
            await h.close();
          }
        });
      }
    }
  }
});
