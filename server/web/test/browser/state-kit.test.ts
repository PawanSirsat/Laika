/**
 * The LAI-1207 state kit in a real browser: on its `/design/states` specimens,
 * and on a migrated screen (Meeting review).
 *
 * What is asserted is what a reader lives with — that an empty state never
 * looks or sounds like an error, in either theme; that Clear filters brings
 * the rows back; that a fast load draws no skeleton and a slow one draws it
 * only after the delay; that Retry keeps focus while it works and recovers;
 * that a stale banner sits over rows that stay; that reduced motion stops
 * everything the kit animates. Every wait is followed by an assertion of what
 * was actually on screen.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  everSeen,
  open,
  refuse,
  setTheme,
  until,
  watchFor,
  type ApiStub,
  type Harness,
} from './harness.ts';

const GALLERY = '[data-kit-gallery]';

async function gallery(options: Parameters<typeof open>[2] = {}): Promise<Harness> {
  const h = await open('/design/states', {}, options);
  await h.page.locator(GALLERY).waitFor({ timeout: 20_000 });
  assert.equal(await h.page.locator(`${GALLERY} [data-kit-specimen]`).count(), 12);
  return h;
}

const demo = (page: Page, name: string) => page.locator(`[data-kit-demo="${name}"]`);

/**
 * The computed colours of every part of every empty panel on the page, and the
 * error and warning palette's computed values, so the two can be compared as
 * the browser resolved them in the current theme.
 */
async function emptyColours(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const resolve = (token: string): string => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const palette = ['--overdue', '--chip-orange'].map(resolve);
    const backgrounds = ['--blocked-bg', '--chip-orange-bg'].map((token) => {
      probe.style.backgroundColor = `var(${token})`;
      return getComputedStyle(probe).backgroundColor;
    });
    probe.remove();
    const panels = [...document.querySelectorAll<HTMLElement>('.empty-panel')];
    const parts = panels.flatMap((panel) =>
      [panel, ...panel.querySelectorAll<HTMLElement>('*')].map((el) => {
        const style = getComputedStyle(el);
        return {
          text: (el.textContent ?? '').trim().slice(0, 30),
          color: style.color,
          background: style.backgroundColor,
          border: style.borderTopColor,
          role: el.getAttribute('role'),
          live: el.getAttribute('aria-live'),
        };
      }),
    );
    return { palette, backgrounds, panels: panels.length, parts };
  });
}

void after(async () => {
  await closeBrowser();
});

void describe('an empty state never looks or sounds like an error (LAI-1207)', () => {
  for (const theme of ['dark', 'light'] as const) {
    void test(`no error colour, no alert and no live region — ${theme}`, async () => {
      const h = await gallery();
      try {
        await setTheme(h.page, theme);
        const seen = await emptyColours(h.page);
        assert.ok(seen.panels >= 5, `only ${String(seen.panels)} empty panels on the page`);
        assert.ok(seen.parts.length > 20, 'read no parts — the probe is wrong');
        assert.equal(
          new Set(seen.palette).size,
          2,
          `palette did not resolve: ${String(seen.palette)}`,
        );
        for (const part of seen.parts) {
          assert.equal(part.role, null, `"${part.text}" carries role=${String(part.role)}`);
          assert.equal(part.live, null, `"${part.text}" is a live region`);
          for (const bad of seen.palette) {
            assert.notEqual(part.color, bad, `"${part.text}" is drawn in ${bad}`);
            assert.notEqual(part.border, bad, `"${part.text}" is bordered in ${bad}`);
          }
          for (const bad of seen.backgrounds) {
            assert.notEqual(part.background, bad, `"${part.text}" sits on ${bad}`);
          }
        }
        // And the error panel, by contrast, is an alert — the comparison is not vacuous.
        assert.ok((await h.page.locator('.error-panel[role="alert"]').count()) >= 2);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('filtered, no match', () => {
  void test('Clear filters brings the rows back', async () => {
    const h = await gallery();
    try {
      const filtered = demo(h.page, 'filtered');
      assert.equal(await filtered.locator('[data-kit-rows] li').count(), 0);
      assert.equal(
        await filtered
          .locator('.empty-panel[data-variant="filtered"] .empty-panel-title')
          .innerText(),
        'Nothing matches this filter',
      );
      await filtered.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await until(async () => (await filtered.locator('[data-kit-rows] li').count()) === 3);
      assert.equal(await filtered.locator('[data-kit-rows] li').count(), 3);
      assert.equal(await filtered.locator('.empty-panel').count(), 0);
      assert.equal(
        await filtered.locator('[data-kit-filter]').innerText(),
        'No filter Filter again',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a skeleton waits before it draws', () => {
  void test('a fast load never draws it', async () => {
    const h = await gallery({
      before: (page) =>
        watchFor(page, ['[data-kit-demo="loading"] .skeleton-region[data-shown="true"]']),
    });
    try {
      const loading = demo(h.page, 'loading');
      await loading.getByRole('button', { name: 'Fast load (0.1 s)' }).click();
      await until(async () => (await loading.locator('[data-kit-runs="1"]').count()) === 1);
      assert.equal(await loading.locator('[data-kit-runs="1"]').count(), 1, 'the load never ended');
      assert.equal(
        await everSeen(h.page, '[data-kit-demo="loading"] .skeleton-region[data-shown="true"]'),
        false,
        'a 100 ms load drew the skeleton',
      );
    } finally {
      await h.close();
    }
  });

  void test('a slow load holds the space at once, draws after the delay, and announces once', async () => {
    const h = await gallery();
    try {
      const loading = demo(h.page, 'loading');
      const region = loading.locator('.skeleton-region');
      const started = Date.now();
      await loading.getByRole('button', { name: 'Slow load (1.5 s)' }).click();
      await region.waitFor({ state: 'attached', timeout: 5_000 });
      // Held, not drawn: in the layout, invisible, busy, and silent.
      assert.equal(await region.getAttribute('aria-busy'), 'true');
      const early = await region.evaluate((el) => ({
        shown: el.getAttribute('data-shown'),
        height: el.getBoundingClientRect().height,
        visibility: getComputedStyle(el.querySelector('.skeleton-region-body')!).visibility,
        said: el.querySelector('[role="status"]')!.textContent,
      }));
      const elapsed = Date.now() - started;
      if (elapsed < 250) {
        assert.equal(early.shown, 'false', `drawn after only ${String(elapsed)} ms`);
        assert.equal(early.visibility, 'hidden');
        assert.equal(early.said, '');
      }
      assert.ok(early.height > 60, `the space was not held: ${String(early.height)}px`);

      await until(async () => (await region.getAttribute('data-shown')) === 'true');
      const drawnAt = Date.now() - started;
      assert.equal(await region.getAttribute('data-shown'), 'true');
      assert.ok(drawnAt >= 280, `drawn at ${String(drawnAt)} ms, before the 300 ms delay`);
      assert.equal(await region.locator('[role="status"]').innerText(), 'Loading tasks');
      assert.equal(
        await region.locator('.skeleton-region-body').getAttribute('aria-hidden'),
        'true',
      );
      const drawnHeight = await region.evaluate((el) => el.getBoundingClientRect().height);
      assert.equal(drawnHeight, early.height, 'the region changed size when it was drawn');

      await until(async () => (await loading.locator('[data-kit-runs="1"]').count()) === 1);
      assert.equal(await region.count(), 0, 'the skeleton outlived its load');
      assert.equal(await loading.locator('[data-kit-rows] li').count(), 3);
    } finally {
      await h.close();
    }
  });
});

void describe('an error offers Retry, and Retry recovers', () => {
  void test('Retry keeps focus and says it is working, then the rows arrive', async () => {
    const h = await gallery();
    try {
      const retry = demo(h.page, 'retry');
      assert.equal(await retry.locator('.error-panel').getAttribute('role'), 'alert');
      assert.equal(await retry.locator('.error-panel-title').innerText(), 'Couldn’t load tasks');
      const button = retry.getByRole('button', { name: 'Try again' });
      await button.focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await button.getAttribute('aria-busy')) === 'true');
      assert.equal(await button.getAttribute('aria-busy'), 'true');
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      assert.equal(await button.innerText(), 'Try again', 'the label changed while busy');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent?.trim()),
        'Try again',
        'focus left the button while it worked',
      );
      const rows = h.page.locator('[data-kit-specimen="retry"] [data-kit-rows] li');
      await until(async () => (await rows.count()) === 3);
      assert.equal(await rows.count(), 3);
    } finally {
      await h.close();
    }
  });

  void test('a refusal shows the server’s words and no Retry', async () => {
    const h = await gallery();
    try {
      const final = h.page.locator('[data-kit-specimen="error-final"] .error-panel');
      assert.equal(
        await final.locator('.error-panel-title').innerText(),
        'Couldn’t save the column',
      );
      assert.equal(
        await final.locator('.error-panel-why').innerText(),
        'A column with that name already exists.',
      );
      assert.equal(await final.getByRole('button', { name: 'Try again' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('stale data', () => {
  void test('the rows stay under the banner, which says how old they are; Retry clears it', async () => {
    const h = await gallery();
    try {
      const stale = demo(h.page, 'stale');
      const banner = stale.locator('.stale-banner');
      assert.equal(await banner.getAttribute('role'), 'status');
      assert.match(
        await banner.innerText(),
        /^Couldn’t refresh tasks\. Showing what was read 4 min ago \(\d{1,2}:\d{2} [AP]M\)\./,
      );
      assert.equal(await stale.locator('[data-kit-rows] li').count(), 3, 'the rows were dropped');
      await banner.getByRole('button', { name: 'Retry' }).click();
      await until(async () => (await banner.count()) === 0);
      assert.equal(await banner.count(), 0, 'the banner outlived a good refresh');
      assert.equal(await stale.locator('[data-kit-rows] li').count(), 3, 'the rows went with it');
    } finally {
      await h.close();
    }
  });
});

void describe('reduced motion', () => {
  void test('nothing the kit draws moves', async () => {
    const h = await gallery({ before: (page) => page.emulateMedia({ reducedMotion: 'reduce' }) });
    try {
      const motion = await h.page.evaluate(() => {
        const bars = [
          ...document.querySelectorAll<HTMLElement>('[data-kit-specimen="primitives"] .skeleton'),
        ];
        const body = document.querySelector<HTMLElement>(
          '[data-kit-specimen="primitives"] .skeleton-region-body',
        )!;
        const button = document.querySelector<HTMLElement>('.kit-btn')!;
        return {
          bars: bars.length,
          barAnimations: [...new Set(bars.map((b) => getComputedStyle(b).animationDuration))],
          bodyAnimation: getComputedStyle(body).animationDuration,
          buttonTransition: getComputedStyle(button).transitionDuration,
        };
      });
      assert.ok(motion.bars >= 8, `only ${String(motion.bars)} skeleton bars`);
      // The pulse runs on --duration-pulse, which motion.css zeroes (LAI-1208).
      assert.deepEqual(motion.barAnimations, ['0s']);
      // The body's entrance runs on a zeroed token (LAI-1208): no time at all.
      assert.equal(motion.bodyAnimation, '0s');
      assert.match(motion.buttonTransition, /^0s(, 0s)*$/);
    } finally {
      await h.close();
    }
  });

  void test('…and with motion allowed, the bars do pulse — the check above is not vacuous', async () => {
    const h = await gallery({
      before: (page) => page.emulateMedia({ reducedMotion: 'no-preference' }),
    });
    try {
      const name = await h.page
        .locator('[data-kit-specimen="primitives"] .skeleton')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName);
      assert.equal(name, 'skeleton-pulse');
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------------------------
// A migrated screen: Meeting review.
// ---------------------------------------------------------------------------

const PROJECT = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LC',
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

function meetingStub(reviews: unknown): ApiStub {
  return {
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
    '/api/v1/projects/laika-core/meeting-reviews': reviews,
    '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  };
}

void describe('Meeting review on the kit', () => {
  void test('no meeting yet is a neutral first-use empty state', async () => {
    const h = await open(
      '/meeting-review?project=laika-core',
      meetingStub({ data: [], next_cursor: null }),
    );
    try {
      const panel = h.page.locator('.empty-panel[data-variant="first-use"]');
      await panel.waitFor({ timeout: 20_000 });
      assert.equal(
        await panel.locator('.empty-panel-title').innerText(),
        'No meeting has been submitted',
      );
      assert.equal(await panel.getAttribute('role'), null);
      assert.equal(await h.page.locator('.error-panel, .state-error').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a failed read is an error panel, not an empty list', async () => {
    const h = await open(
      '/meeting-review?project=laika-core',
      meetingStub(refuse(500, 'internal', 'SQLITE_BUSY')),
    );
    try {
      const panel = h.page.locator('.error-panel');
      await panel.waitFor({ timeout: 20_000 });
      assert.equal(await panel.getAttribute('role'), 'alert');
      assert.equal(
        await panel.locator('.error-panel-title').innerText(),
        'Couldn’t load meeting reviews',
      );
      // The 500's own message is the server's insides, never shown.
      assert.ok(!(await panel.innerText()).includes('SQLITE_BUSY'));
      assert.equal(await h.page.locator('.empty-panel').count(), 0, 'an error read as empty');
    } finally {
      await h.close();
    }
  });

  void test('Retry asks again, and a good answer replaces the error', async () => {
    let asked = 0;
    const h = await open(
      '/meeting-review?project=laika-core',
      meetingStub(() => {
        asked += 1;
        return asked === 1
          ? refuse(500, 'internal', 'SQLITE_BUSY')
          : { data: [], next_cursor: null };
      }),
    );
    try {
      const retry = h.page.locator('.error-panel').getByRole('button', { name: 'Try again' });
      await retry.waitFor({ timeout: 20_000 });
      assert.equal(asked, 1);
      await retry.click();
      const empty = h.page.locator('.empty-panel-title', {
        hasText: 'No meeting has been submitted',
      });
      await empty.waitFor({ timeout: 10_000 });
      assert.equal(asked, 2, 'Retry did not ask again');
      assert.equal(await h.page.locator('.error-panel').count(), 0, 'the error outlived the retry');
    } finally {
      await h.close();
    }
  });
});
