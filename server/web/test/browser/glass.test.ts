/**
 * Glass in a real browser (LAI-1132).
 *
 * What the source guard (`test/glass-guard.test.ts`) cannot see needs a page:
 * that the chrome and the floating surfaces really are frosted and the work
 * inside them really is not; that no blurred element sits inside another on
 * a real screen (the runtime half of "never nest"); that reduced transparency
 * and forced colours take the blur away; that a Dropdown opened over a
 * SidePanel paints above it (B16); that focus stays visible on glass; and
 * that the sign-in card is glass over the calm ambient ground in both themes.
 *
 * Set `GLASS_SHOTS=<dir>` to also write the review screenshots — off by
 * default, so the gate never writes files.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, setTheme, type ApiStub } from './harness.ts';

const PROJECT = {
  id: 'p1',
  slug: 'laika',
  name: 'Laika',
  prefix: 'LAIKA',
  description: null,
  repo: null,
  visibility: 'private',
  color: 'violet',
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 10, todo: 10, in_progress: 10, review: 10, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada Lovelace' }],
  last_activity_at: 2,
};

const STATUSES = ['backlog', 'todo', 'in_progress', 'review'] as const;

/** Forty cards, ten a lane — the board the perf numbers are taken on. */
const TASKS = Array.from({ length: 40 }, (_, i) => ({
  id: `t${String(i + 1)}`,
  key: `LAIKA-${String(i + 1)}`,
  project_id: 'p1',
  number: i + 1,
  title: `Glass card ${String(i + 1)} — a title long enough to wrap onto a second line`,
  description_md: i === 0 ? 'The document column stays solid.' : null,
  acceptance_md: null,
  status: STATUSES[i % 4] ?? 'todo',
  priority: (['p1', 'p2', 'p3'] as const)[i % 3],
  assignee_id: i % 2 === 0 ? 'u1' : null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: true,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: i % 3 === 0 ? ['ui'] : [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
}));

const ME = {
  id: 'u1',
  email: 'u1@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

const BOARD: ApiStub = {
  '/api/v1/me': ME,
  '/api/v1/projects': { data: [PROJECT], next_cursor: null },
  '/api/v1/projects/laika': PROJECT,
  '/api/v1/projects/laika/tasks': { data: TASKS, next_cursor: null },
  '/api/v1/projects/laika/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead', created_at: 1 },
    ],
  },
  '/api/v1/projects/laika/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika/tags': { tags: [] },
  '/api/v1/tasks/t1/dependencies': { blocked_by: [], blocks: [] },
  '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
  '/api/v1/tasks/t1/activity': { data: [], next_cursor: null },
  '/api/v1/tasks/t1/watchers': { watchers: [] },
  '/api/v1/presence': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
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

const SHOTS = process.env.GLASS_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined || SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Chromium's own media emulation — Playwright has no reduced-transparency switch. */
async function reduceTransparency(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
}

interface Glass {
  readonly own: string;
  readonly pane: string;
  readonly paneBg: string;
  readonly bg: string;
}

/** The element's own blur, its `::before` pane's blur and fill, and its fill. */
async function glass(page: Page, selector: string): Promise<Glass> {
  return await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      const pane = getComputedStyle(el, '::before');
      return {
        own: cs.backdropFilter,
        pane: pane.content === 'none' ? 'none' : pane.backdropFilter,
        paneBg: pane.backgroundColor,
        bg: cs.backgroundColor,
      };
    });
}

/** Alpha of a computed `rgb()` / `rgba()` / `color(srgb …)` colour. */
function alpha(color: string): number {
  const slash = /\/\s*([\d.]+)\s*\)$/.exec(color);
  if (slash?.[1] !== undefined) return Number(slash[1]);
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(color);
  if (rgba?.[1] !== undefined) return Number(rgba[1]);
  return 1;
}

/**
 * The runtime nesting check: every element whose own or `::before` blur is
 * real, and which has a blurred ancestor. Also counts the blurred layers.
 */
async function blurCensus(page: Page): Promise<{ nested: string[]; blurred: string[] }> {
  return await page.evaluate(() => {
    const blurs = (el: Element): boolean => {
      const own = getComputedStyle(el).backdropFilter;
      const pane = getComputedStyle(el, '::before');
      return (
        (own !== 'none' && own !== '') ||
        (pane.content !== 'none' && pane.backdropFilter !== 'none' && pane.backdropFilter !== '')
      );
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className === '' ? '' : `.${String(el.className).trim().split(/\s+/).join('.')}`}`;
    const nested: string[] = [];
    const blurred: string[] = [];
    for (const el of document.querySelectorAll('*')) {
      if (!blurs(el)) continue;
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) blurred.push(name(el));
      for (let up = el.parentElement; up !== null; up = up.parentElement) {
        if (blurs(up)) {
          nested.push(`${name(el)} inside ${name(up)}`);
          break;
        }
      }
    }
    return { nested, blurred };
  });
}

void after(async () => {
  await closeBrowser();
});

async function board(width = 1440): Promise<Awaited<ReturnType<typeof open>>> {
  const h = await open('/board?project=laika', BOARD, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
  await h.page.locator('.card-title').nth(39).waitFor({ state: 'attached', timeout: 30_000 });
  return h;
}

void describe('the board at 1440', () => {
  void test('chrome is frosted, lanes are tinted, cards are solid, and nothing nests', async () => {
    const h = await board();
    try {
      for (const chrome of ['.sidebar', '.space-bar']) {
        const g = await glass(h.page, chrome);
        assert.match(g.pane, /blur\(\d+px\)/, `${chrome} is not frosted`);
        assert.equal(
          g.own,
          'none',
          `${chrome} blurs itself — its fixed descendants would be trapped`,
        );
        assert.ok(alpha(g.paneBg) < 1, `${chrome}'s pane is opaque`);
      }

      const lane = await glass(h.page, '.lane');
      assert.equal(lane.own, 'none', 'a lane blurs — cards scroll in it');
      assert.equal(lane.pane, 'none');
      assert.ok(alpha(lane.bg) < 1, 'the lane is not a glass tint');

      const cards = await h.page.locator('.card').evaluateAll((els) =>
        els.map((el) => ({
          own: getComputedStyle(el).backdropFilter,
          pane: getComputedStyle(el, '::before').backdropFilter,
          bg: getComputedStyle(el).backgroundColor,
        })),
      );
      assert.equal(cards.length, 40);
      for (const c of cards) {
        assert.equal(c.own, 'none', 'a card blurs');
        assert.ok(c.pane === 'none' || c.pane === '', 'a card pane blurs');
        assert.equal(alpha(c.bg), 1, `a card is translucent: ${c.bg}`);
      }

      const census = await blurCensus(h.page);
      assert.deepEqual(census.nested, [], 'a blurred surface inside another');
      assert.ok(
        census.blurred.length <= 4,
        `${String(census.blurred.length)} blurred layers on screen: ${census.blurred.join(', ')}`,
      );
      await setTheme(h.page, 'dark');
      await shoot(h.page, 'board-dark-1440');
      await setTheme(h.page, 'light');
      await shoot(h.page, 'board-light-1440');
      if (SHOTS !== undefined && SHOTS !== '') {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await shoot(h.page, 'board-light-390');
        await setTheme(h.page, 'dark');
        await shoot(h.page, 'board-dark-390');
      }
    } finally {
      await h.close();
    }
  });

  void test('the task drawer: a frosted scrim, a glass frame, a solid document', async () => {
    const h = await open('/board?project=laika&task=t1', BOARD, {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    });
    try {
      await h.page.locator('.drawer-slot').waitFor({ timeout: 30_000 });
      const scrim = await glass(h.page, '.drawer-scrim');
      assert.match(scrim.own, /blur\(\d+px\)/, 'the drawer scrim is not frosted');
      const frame = await glass(h.page, '.drawer');
      assert.equal(frame.own, 'none', 'the drawer blurs itself — its dropdowns would be trapped');
      assert.ok(alpha(frame.bg) < 1, 'the drawer frame is not glass');
      const slot = await glass(h.page, '.drawer-slot');
      assert.equal(slot.own, 'none');
      assert.equal(alpha(slot.bg), 1, 'the document column is on glass');
      assert.deepEqual((await blurCensus(h.page)).nested, []);
      if (SHOTS !== undefined && SHOTS !== '') {
        for (const theme of ['dark', 'light']) {
          await setTheme(h.page, theme);
          await h.page.setViewportSize({ width: 1440, height: 900 });
          await shoot(h.page, `drawer-${theme}-1440`);
          await h.page.setViewportSize({ width: 390, height: 844 });
          await shoot(h.page, `drawer-${theme}-390`);
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('a Dropdown over a SidePanel (B16)', () => {
  void test('paints above the panel it opens from, portalled to the body or into the panel', async () => {
    const h = await board();
    try {
      const top = await h.page.evaluate(() => {
        // Real stylesheet, real classes: a SidePanel, and a Dropdown panel in
        // both places the component can portal it — the body and the panel.
        const panel = document.createElement('div');
        panel.className = 'side-panel';
        document.body.append(panel);
        const results: string[] = [];
        for (const host of [document.body, panel]) {
          const menu = document.createElement('div');
          menu.className = 'dd-panel';
          Object.assign(menu.style, {
            top: '200px',
            right: '40px',
            width: '200px',
            height: '120px',
          });
          const row = document.createElement('div');
          row.className = 'probe-row';
          row.style.height = '100%';
          menu.append(row);
          host.append(menu);
          const box = menu.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          results.push(hit?.className ?? 'nothing');
          menu.remove();
        }
        const z = {
          panel: getComputedStyle(panel).zIndex,
          menu: (() => {
            const probe = document.createElement('div');
            probe.className = 'dd-panel';
            document.body.append(probe);
            const v = getComputedStyle(probe).zIndex;
            probe.remove();
            return v;
          })(),
        };
        panel.remove();
        return { results, z };
      });
      assert.deepEqual(top.results, ['probe-row', 'probe-row'], 'the panel paints over its menu');
      assert.ok(
        Number(top.z.menu) > Number(top.z.panel),
        `menu ${top.z.menu} ≤ panel ${top.z.panel}`,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('sign-in, the brand’s showcase', () => {
  for (const theme of ['dark', 'light']) {
    void test(`${theme}: the card is level-2 glass over the ambient layer`, async () => {
      const h = await open('/login', SIGNED_OUT, {
        before: async (page) => {
          await page.setViewportSize({ width: 1440, height: 900 });
        },
      });
      try {
        await h.page.locator('.auth-card').waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        const ambient = await h.page.evaluate(() => {
          const cs = getComputedStyle(document.body, '::before');
          return {
            position: cs.position,
            image: cs.backgroundImage,
            events: cs.pointerEvents,
            animation: cs.animationName,
          };
        });
        assert.equal(ambient.position, 'fixed');
        assert.equal(ambient.events, 'none');
        // v3: one calm linear gradient — no discs, arcs or hazes, no drift.
        assert.match(ambient.image, /^linear-gradient\(/, 'no ambient layer');
        assert.equal(
          ambient.image.match(/gradient\(/g)?.length,
          1,
          'the ambient layer stacks gradients',
        );
        assert.doesNotMatch(ambient.image, /radial-gradient/, 'the ambient layer has discs again');
        assert.equal(ambient.animation, 'none', 'the ambient layer moves');
        // Nothing opaque between it and the glass: a body or shell background
        // paints over a negative-z pseudo-element, and hid it once already.
        const grounds = await h.page.evaluate(() =>
          ['body', '.shell'].map((s) => {
            const el = document.querySelector(s);
            return el === null ? 'absent' : getComputedStyle(el).backgroundColor;
          }),
        );
        assert.deepEqual(
          grounds,
          ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
          'the ambient layer is covered',
        );

        const card = await glass(h.page, '.auth-card');
        assert.match(card.pane, /blur\(\d+px\)/, 'the sign-in card is not frosted');
        assert.ok(alpha(card.paneBg) < 1, 'the sign-in card is opaque');
        assert.deepEqual((await blurCensus(h.page)).nested, []);
        await shoot(h.page, `login-${theme}-1440`);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await shoot(h.page, `login-${theme}-390`);
      } finally {
        await h.close();
      }
    });
  }

  for (const theme of ['dark', 'light']) {
    void test(`${theme}: the focus ring clears 3:1 against the worst case behind the glass`, async () => {
      const h = await open('/login', SIGNED_OUT);
      try {
        await h.page.locator('.auth-card input').first().waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        await h.page.locator('.auth-card input').first().focus();
        await h.page.keyboard.press('Tab');
        const read = await h.page.evaluate(() => {
          const el = document.activeElement;
          if (el?.closest('.auth-card') == null) return null;
          const root = getComputedStyle(document.documentElement);
          return {
            ring: getComputedStyle(el).outlineColor,
            width: getComputedStyle(el).outlineWidth,
            glass: root.getPropertyValue('--glass-2').trim(),
            peak: root.getPropertyValue('--ambient-peak').trim(),
          };
        });
        assert.ok(read, 'focus left the sign-in card');
        assert.notEqual(read.width, '0px', 'no focus outline on glass');
        const nums = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
        const [gr = 0, gg = 0, gb = 0, ga = 1] = nums(read.glass);
        const [pr = 0, pg = 0, pb = 0] = hex(read.peak);
        const surface = [gr * ga + pr * (1 - ga), gg * ga + pg * (1 - ga), gb * ga + pb * (1 - ga)];
        const lum = (c: number[]) =>
          c
            .map((v) => v / 255)
            .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
        const [a, b] = [lum(nums(read.ring).slice(0, 3)), lum(surface)];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 3, `focus ring ${read.ring} on glass is ${ratio.toFixed(2)}:1`);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('fallbacks', () => {
  void test('reduced transparency: nothing blurs, every surface is solid, no ambient', async () => {
    const h = await open('/board?project=laika&task=t1', BOARD, { before: reduceTransparency });
    try {
      await h.page.locator('.drawer-slot').waitFor({ timeout: 30_000 });
      assert.deepEqual((await blurCensus(h.page)).blurred, [], 'something still blurs');
      for (const s of ['.sidebar', '.space-bar']) {
        assert.equal(alpha((await glass(h.page, s)).paneBg), 1, `${s} is still translucent`);
      }
      assert.equal(alpha((await glass(h.page, '.lane')).bg), 1, 'the lane is still translucent');
      assert.equal(
        alpha((await glass(h.page, '.drawer')).bg),
        1,
        'the drawer is still translucent',
      );
      assert.equal(
        await h.page.evaluate(() => getComputedStyle(document.body, '::before').display),
        'none',
      );
      await shoot(h.page, 'drawer-reduced-transparency-1440');
      await h.page.goto(`${h.origin}/board?project=laika`);
      await h.page.locator('.card-title').first().waitFor({ timeout: 30_000 });
      await shoot(h.page, 'board-reduced-transparency-1440');
    } finally {
      await h.close();
    }
  });

  void test('forced colours: no blur anywhere, no ambient', async () => {
    const h = await open('/login', SIGNED_OUT, {
      before: async (page) => {
        await page.emulateMedia({ forcedColors: 'active' });
      },
    });
    try {
      await h.page.locator('.auth-card').waitFor({ timeout: 20_000 });
      assert.deepEqual((await blurCensus(h.page)).blurred, [], 'something blurs in forced colours');
      assert.equal(
        await h.page.evaluate(() => getComputedStyle(document.body, '::before').display),
        'none',
      );
    } finally {
      await h.close();
    }
  });
});
