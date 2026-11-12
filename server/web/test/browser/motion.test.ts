/**
 * The motion system, in a real browser (LAI-1208).
 *
 * The key moments run on the tokens in `styles/motion.css` — the drawer's
 * rise, the dropdown panel's fade, a button's press, the dragged card's fade
 * — and under `prefers-reduced-motion: reduce` every one of them runs in 0s
 * while its end state still lands. Both themes: motion is theme-independent,
 * and this proves it rather than assuming it.
 *
 * Every reading is taken after a wait that is itself asserted: the element is
 * there, and every animation on it has finished, before a value is read.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub, type Harness } from './harness.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const FULL_PROJECT = {
  ...PROJECT,
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

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [FULL_PROJECT], next_cursor: null },
  '/api/v1/permissions': {
    org_roles: [],
    project_roles: [],
    permissions: [],
    me: {
      org_role: 'owner',
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: 'lead',
      actions: ['project.create'],
      projects: [],
    },
  },
  '/api/v1/projects/laika-core': FULL_PROJECT,
  '/api/v1/projects/laika-core/statuses': {
    data: [
      ['st-todo', 'To do', 'todo', false],
      ['st-doing', 'In progress', 'in_progress', false],
      ['st-done', 'Done', 'done', false],
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
  '/api/v1/tasks/t1': TASK,
  '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
  '/api/v1/tasks/t1/watchers': { watchers: [] },
  '/api/v1/tasks/t1/dependencies': TASK,
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada' }] },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/presence': { data: [], next_cursor: null },
};

void after(async () => {
  await closeBrowser();
});

type Motion = 'normal' | 'reduce';

async function visit(path: string, motion: Motion): Promise<Harness> {
  return open(path, STUB, {
    before: async (page: Page) => {
      await page.emulateMedia({ reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference' });
    },
  });
}

/**
 * A duration token's resolved value on the root, in milliseconds. The build
 * minifies `120ms` to `.12s` and `0ms` to `0s`, so the spelling is not the
 * contract; the length of time is.
 */
const ms = (page: Page, name: string): Promise<number> =>
  page.evaluate((n) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const m = /^(\d*\.?\d+)(ms|s)$/.exec(v);
    if (m === null) return Number.NaN;
    return Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1));
  }, name);

/** Wait, asserted, until nothing on the element is still animating. */
async function settled(l: Locator, what: string): Promise<void> {
  const still = (): Promise<boolean> =>
    l.evaluate((el) =>
      el.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'),
    );
  // `until` returns at its deadline either way, so ask once more and assert.
  await until(still, 5_000);
  assert.equal(await still(), true, `${what} never finished animating`);
}

const style = (l: Locator, props: readonly string[]): Promise<Record<string, string>> =>
  l.evaluate((el, ps) => {
    const s = getComputedStyle(el);
    return Object.fromEntries(ps.map((p) => [p, s.getPropertyValue(p)]));
  }, props);

void describe('motion tokens resolve, and reduced motion zeroes them', () => {
  for (const motion of ['normal', 'reduce'] as const) {
    void test(`${motion}: the scale on :root`, async () => {
      const h = await visit('/board?project=laika-core', motion);
      try {
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        const read = Object.fromEntries(
          await Promise.all(
            [
              '--duration-fast',
              '--duration-slow',
              '--duration-glide',
              '--duration-pulse',
              '--duration-flash',
            ].map(async (n) => [n, await ms(h.page, n)] as const),
          ),
        );
        assert.deepEqual(
          read,
          motion === 'normal'
            ? {
                '--duration-fast': 120,
                '--duration-slow': 280,
                '--duration-glide': 200,
                '--duration-pulse': 2000,
                '--duration-flash': 3600,
              }
            : {
                '--duration-fast': 0,
                '--duration-slow': 0,
                '--duration-glide': 0,
                '--duration-pulse': 0,
                // The arrival glow's hold is the information, so it stays.
                '--duration-flash': 3600,
              },
        );
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the drawer rises on the drawer curve', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const motion of ['normal', 'reduce'] as const) {
      void test(`${theme}, ${motion}`, async () => {
        const h = await visit('/board?project=laika-core', motion);
        try {
          await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
          await setTheme(h.page, theme);
          await h.page.locator('.card').first().click();
          const drawer = h.page.locator('.drawer');
          await drawer.waitFor({ timeout: 20_000 });
          const s = await style(drawer, [
            'animation-name',
            'animation-duration',
            'animation-timing-function',
          ]);
          assert.deepEqual(s, {
            'animation-name': 'drawer-slidein',
            'animation-duration': motion === 'normal' ? '0.28s' : '0s',
            'animation-timing-function': 'cubic-bezier(0.32, 0.72, 0, 1)',
          });
          await settled(drawer, 'the drawer');
          // Either way, it lands: in place and opaque.
          assert.deepEqual(await style(drawer, ['transform', 'opacity']), {
            transform: 'none',
            opacity: '1',
          });
        } finally {
          await h.close();
        }
      });
    }
  }
});

void describe('a dropdown panel fades in, and only fades', () => {
  for (const motion of ['normal', 'reduce'] as const) {
    void test(motion, async () => {
      const h = await visit('/board?project=laika-core', motion);
      try {
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        // The card's move control is reached from the keyboard (dropdown-global.test.ts).
        await h.page.getByRole('combobox', { name: 'Move LAI-1 to', exact: true }).focus();
        await h.page.keyboard.press('ArrowDown');
        const panel = h.page.locator('[data-dropdown-panel]');
        await panel.waitFor({ timeout: 5_000 });
        assert.deepEqual(
          await style(panel, ['animation-name', 'animation-duration', 'animation-timing-function']),
          {
            'animation-name': 'dd-panel-in',
            'animation-duration': motion === 'normal' ? '0.12s' : '0s',
            'animation-timing-function': 'cubic-bezier(0.23, 1, 0.32, 1)',
          },
        );
        // No transform at any point: the panel places itself by measuring its box.
        const keyframes = await panel.evaluate((el) =>
          el
            .getAnimations()
            .flatMap((a) =>
              a.effect instanceof KeyframeEffect
                ? a.effect.getKeyframes().map((k) => Object.keys(k))
                : [],
            ),
        );
        assert.ok(
          keyframes.flat().every((k) => k !== 'transform'),
          `the panel animates a transform: ${JSON.stringify(keyframes)}`,
        );
        await settled(panel, 'the dropdown panel');
        assert.equal((await style(panel, ['opacity'])).opacity, '1');
      } finally {
        await h.close();
      }
    });
  }
});

void describe('a button gives under the pointer', () => {
  for (const motion of ['normal', 'reduce'] as const) {
    void test(motion, async () => {
      const h = await visit('/projects', motion);
      try {
        const button = h.page.locator('.button', { hasText: 'New space' }).first();
        await button.waitFor({ timeout: 20_000 });
        assert.deepEqual(await style(button, ['transition-property', 'transition-duration']), {
          'transition-property': 'transform',
          'transition-duration': motion === 'normal' ? '0.09s' : '0s',
        });
        const box = await button.boundingBox();
        assert.ok(box !== null, 'the button has no box');
        await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await h.page.mouse.down();
        try {
          await settled(button, 'the pressed button');
          assert.equal(
            (await style(button, ['transform'])).transform,
            'matrix(0.97, 0, 0, 0.97, 0, 0)',
          );
        } finally {
          await h.page.mouse.up();
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the dragged card fades rather than snaps', () => {
  for (const motion of ['normal', 'reduce'] as const) {
    void test(motion, async () => {
      const h = await visit('/board?project=laika-core', motion);
      try {
        const card = h.page.locator('.lane-item > .card').first();
        await card.waitFor({ timeout: 20_000 });
        assert.deepEqual(await style(card, ['transition-property', 'transition-duration']), {
          'transition-property': 'opacity',
          'transition-duration': motion === 'normal' ? '0.12s' : '0s',
        });
      } finally {
        await h.close();
      }
    });
  }
});
