/**
 * The profile's Activity card in a real browser (D-079, LAI-751).
 *
 * `activity-derive.test.ts` owns the rules — where a day sits, how dark it is,
 * the streaks. This proves the page: both designs from one response, the
 * choice kept per viewer, one request per range, the tooltip and the
 * cross-highlight, the keyboard, each state's sentence, and a year that
 * scrolls inside the card on a phone with its month labels never under the
 * weekday column.
 *
 * Days are anchored to `Date.now()` (CONVENTIONS §4): the fixture's last day
 * is today, and every value is placed by its distance from the end.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page, Request } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

const NOW = Date.now();
const DAY = 86_400_000;
const TODAY = new Date(NOW).toISOString().slice(0, 10);

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Owner',
  org_role: 'owner',
  is_active: true,
  memberships: [],
};

const PROFILE = {
  user: {
    id: 'u2',
    name: 'Bea Builder',
    email: 'bea@example.com',
    org_role: 'member',
    is_active: true,
    profile_kind: 'builder',
    created_at: NOW - 400 * DAY,
  },
  window: { weeks: 12, since: NOW - 84 * DAY, until: NOW },
  projects: [],
  review: {
    accepted: 0,
    sent_back: 0,
    last_30_days: 0,
    per_week: [],
    time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
    recent: [],
  },
  ratings: [],
  ratings_total: 0,
  current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
  delivery: {
    accepted_per_week: [],
    accepted: 0,
    sent_back: 0,
    reopened: 0,
    cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
  },
  agents: {
    tokens: [],
    tokens_total: 0,
    online: { enabled: true, clients: [], last_seen: null },
    writes: [],
    writes_total: 0,
  },
};

interface Sharing {
  org_enabled: boolean;
  enabled: boolean;
}

/**
 * A range ending today. `ago` days before today: today (0) has 4 pushed, 2
 * local commits, 23 prompts (Claude Code 18, Codex 5), 3 sessions, 1 board
 * action by her and 6 by her agents; yesterday (1) has a board action only;
 * three days ago (3) a push. Nothing else.
 */
function activity(
  range: '12w' | '52w',
  sharing: Sharing = { org_enabled: true, enabled: true },
  empty = false,
) {
  const days = range === '12w' ? 84 : 364;
  const start = new Date(NOW - (days - 1) * DAY).toISOString().slice(0, 10);
  const at = (ago: number) => days - 1 - ago;
  const series = (values: Record<number, number>) => {
    const out = new Array<number>(days).fill(0);
    if (!empty) for (const [ago, n] of Object.entries(values)) out[at(Number(ago))] = n;
    return out;
  };
  const shown = sharing.org_enabled && sharing.enabled;
  return {
    range,
    start,
    end: TODAY,
    tz: 'UTC',
    sharing,
    series: {
      github: shown ? series({ 0: 4, 3: 1 }) : null,
      local_commits: shown ? series({ 0: 2 }) : null,
      prompts: shown ? series({ 0: 23 }) : null,
      sessions: shown ? series({ 0: 3 }) : null,
      board_self: series({ 0: 1, 1: 1 }),
      board_agent: series({ 0: 6 }),
    },
    prompts_by_agent: shown && !empty ? { [TODAY]: { 'claude-code': 18, codex: 5 } } : {},
    agents: shown && !empty ? ['claude-code', 'codex'] : [],
  };
}

function stub(sharing?: Sharing, empty = false, me = ME): ApiStub {
  return {
    '/api/v1/me': me,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis',
      presence_enabled: true,
      developer_insights: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users/u2/profile': PROFILE,
    '/api/v1/people/u2/activity?range=12w': activity('12w', sharing, empty),
    '/api/v1/people/u2/activity?range=52w': activity('52w', sharing, empty),
  };
}

/** Every heatmap request the page made, with its query. */
function watch(requests: string[]) {
  return (page: Page): Promise<void> => {
    page.on('request', (request: Request) => {
      if (request.url().includes('/activity?')) requests.push(new URL(request.url()).search);
    });
    return Promise.resolve();
  };
}

async function card(page: Page) {
  const found = page.locator('.prof-card[data-section="activity"]');
  await found.waitFor({ timeout: 20_000 });
  await page.locator('.prof-card[data-section="activity"][aria-busy="false"]').waitFor();
  return found;
}

const cells = (page: Page, kind: string) =>
  page.locator(`.prof-card[data-section="activity"] .hm-grid[data-kind="${kind}"] .hm-cell`);

void after(async () => {
  await closeBrowser();
});

void describe('the Activity card', () => {
  void test('opens on B: GitHub, Local and Board grids over a year, a square a day', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      const activityCard = await card(h.page);
      assert.equal(await activityCard.getAttribute('data-design'), 'stacked');
      assert.equal(await activityCard.getAttribute('data-range'), '52w');
      for (const kind of ['github', 'local', 'board']) {
        assert.equal(await cells(h.page, kind).count(), 364, kind);
      }
      // Today's squares carry today's levels; an empty day carries none.
      const today = (kind: string) =>
        h.page
          .locator(`.hm-grid[data-kind="${kind}"] .hm-cell[data-day="${TODAY}"]`)
          .getAttribute('data-v');
      assert.equal(await today('github'), '4');
      assert.equal(await today('local'), '4');
      assert.equal(await today('board'), '4');
      const text = await activityCard.innerText();
      assert.match(text, /5 commits pushed/);
      assert.match(text, /23 prompts · 3 sessions · 2 not pushed/);
      assert.match(text, /2 actions by them · 6 by their agents/);
    } finally {
      await h.close();
    }
  });

  void test('computes the stats row on the client from the days', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      const tile = (name: string) => h.page.locator(`.hm-stats [data-stat="${name}"]`).innerText();
      // Active: today, yesterday, three days ago.
      assert.match(await tile('active_days'), /3\s*of 364/);
      assert.match(await tile('current_streak'), /2\s*days/);
      assert.match(await tile('longest_streak'), /2\s*days/);
      // 5 pushed, 2 not: 71%.
      assert.match(await tile('pushed_share'), /71%\s*29% local only/);
    } finally {
      await h.close();
    }
  });

  void test('asks once per range, and switching back is answered from the cache', async () => {
    const requests: string[] = [];
    const h = await open('/people?user=u2', stub(), { before: watch(requests) });
    try {
      const activityCard = await card(h.page);
      await activityCard.locator('input[value="12w"]').check();
      await until(async () => (await cells(h.page, 'github').count()) === 84);
      await activityCard.locator('input[value="52w"]').check();
      await until(async () => (await cells(h.page, 'github').count()) === 364);
      await activityCard.locator('input[value="12w"]').check();
      await until(async () => (await cells(h.page, 'github').count()) === 84);
      assert.deepEqual(requests, ['?range=52w', '?range=12w']);
    } finally {
      await h.close();
    }
  });

  void test('A splits each day; the choice is kept for this viewer and not for another', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      const activityCard = await card(h.page);
      await activityCard.locator('input[value="split"]').check();
      assert.equal(await activityCard.getAttribute('data-design'), 'split');
      assert.equal(await h.page.locator('.hm-grid').count(), 1);
      const today = h.page.locator(`.hm-grid[data-kind="split"] .hm-cell[data-day="${TODAY}"]`);
      assert.equal(await today.getAttribute('data-g'), '4');
      assert.equal(await today.getAttribute('data-l'), '4');
      assert.match(
        await today.evaluate((el) => getComputedStyle(el).backgroundImage),
        /linear-gradient/,
      );
      assert.match(
        await activityCard.locator('.hm-legend').innerText(),
        /GitHub top-left, Local bottom-right/,
      );

      await h.page.reload();
      assert.equal(await (await card(h.page)).getAttribute('data-design'), 'split');

      // Another viewer on the same browser starts on B.
      await h.page.evaluate(() => {
        localStorage.setItem('laika.profile.activity-design.someone-else', 'stacked');
      });
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.profile.activity-design.u1')),
        'split',
      );
    } finally {
      await h.close();
    }
    const other = await open(
      '/people?user=u2',
      stub(undefined, false, { ...ME, id: 'u9', name: 'Ari Admin', org_role: 'admin' }),
    );
    try {
      assert.equal(await (await card(other.page)).getAttribute('data-design'), 'stacked');
    } finally {
      await other.close();
    }
  });

  void test('the tooltip gives the day whole, and B outlines that day in every grid', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      await h.page.locator(`.hm-grid[data-kind="github"] .hm-cell[data-day="${TODAY}"]`).hover();
      const tip = h.page.locator('.hm-tip');
      await tip.waitFor();
      const text = await tip.innerText();
      for (const part of [
        /4\s*commits pushed/,
        /2\s*local commits not pushed/,
        /23\s*prompts \(Claude Code 18, Codex 5\)/,
        /3\s*agent sessions/,
        /1\s*board action by them/,
        /6\s*board actions by their agents/,
      ]) {
        assert.match(text, part);
      }
      const rings = await h.page
        .locator('.hm-ring')
        .evaluateAll((els) =>
          els.map((el) => [
            el.closest('.hm-grid')?.getAttribute('data-kind'),
            el.getAttribute('data-twin'),
          ]),
        );
      assert.deepEqual(rings, [
        ['github', 'false'],
        ['local', 'true'],
        ['board', 'true'],
      ]);
    } finally {
      await h.close();
    }
  });

  void test('arrow keys move between days, and each day reads as text', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      const grid = '.hm-grid[data-kind="board"]';
      const focusable = h.page.locator(`${grid} .hm-cell[tabindex="0"]`);
      assert.equal(await focusable.count(), 1, 'one day in the tab order per grid');
      assert.equal(await focusable.getAttribute('data-day'), TODAY);
      await focusable.focus();
      const label = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
      assert.match(await label(), /1 board action by them, 6 board actions by their agents/);

      await h.page.keyboard.press('ArrowUp');
      const yesterday = new Date(NOW - DAY).toISOString().slice(0, 10);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-day')),
        yesterday,
      );
      assert.match(await label(), /1 board action by them, 0 board actions by their agents/);

      await h.page.keyboard.press('ArrowLeft');
      const weekBefore = new Date(NOW - 8 * DAY).toISOString().slice(0, 10);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-day')),
        weekBefore,
      );
      // The tooltip follows the keyboard as well as the pointer.
      assert.match(await h.page.locator('.hm-tip').innerText(), /0\s*commits pushed/);
    } finally {
      await h.close();
    }
  });
});

void describe('the states', () => {
  void test('Developer insights off: board only, said plainly, with the way to Organisation', async () => {
    const h = await open('/people?user=u2', stub({ org_enabled: false, enabled: true }));
    try {
      const activityCard = await card(h.page);
      assert.match(
        await activityCard.locator('.hm-note').innerText(),
        /Developer insights are off/,
      );
      assert.equal(await activityCard.locator('.hm-note a').getAttribute('href'), '/organisation');
      // B: GitHub and Local keep their footprint, and say why they are empty.
      assert.equal(await h.page.locator('.hm-blocked[data-reason="org_off"]').count(), 2);
      assert.equal(await cells(h.page, 'board').count(), 364);
      assert.match(await h.page.locator('[data-stat="pushed_share"]').innerText(), /not shared/);

      // A: the board, alone, as a single-colour grid with its note.
      await activityCard.locator('input[value="split"]').check();
      assert.equal(await h.page.locator('.hm-grid').getAttribute('data-kind'), 'board');
      assert.match(await activityCard.locator('.hm-legend').innerText(), /Board/);
    } finally {
      await h.close();
    }
  });

  void test('a developer who has not shared: named, and only they can turn it on', async () => {
    const h = await open('/people?user=u2', stub({ org_enabled: true, enabled: false }));
    try {
      const activityCard = await card(h.page);
      assert.match(
        await activityCard.locator('.hm-note').innerText(),
        /Local activity off: Bea Builder hasn’t turned on sharing/,
      );
      assert.equal(await h.page.locator('.hm-blocked[data-reason="not_sharing"]').count(), 2);
      assert.match(
        await h.page.locator('.hm-blocked-msg').first().innerText(),
        /only they can switch it on/,
      );
    } finally {
      await h.close();
    }
  });

  void test('both switches on and nothing arrived: says so, and draws the empty grids', async () => {
    const h = await open('/people?user=u2', stub(undefined, true));
    try {
      const activityCard = await card(h.page);
      assert.match(await activityCard.locator('.hm-note').innerText(), /No local activity yet/);
      assert.equal(await h.page.locator('.hm-blocked').count(), 0);
      assert.equal(await cells(h.page, 'github').count(), 364);
    } finally {
      await h.close();
    }
  });

  void test('loading holds the card’s size: no shift when the answer lands', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open('/people?user=u2', stub(), {
      before: async (page) => {
        await page.route('**/api/v1/people/u2/activity**', async (route) => {
          await held;
          await route.fallback();
        });
      },
    });
    try {
      const busy = h.page.locator('.prof-card[data-section="activity"][aria-busy="true"]');
      await busy.waitFor({ timeout: 20_000 });
      const before = await busy.evaluate((el) => el.getBoundingClientRect().height);
      release();
      const done = await card(h.page);
      const after = await done.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(Math.abs(after - before) <= 2, `the card moved ${String(after - before)}px`);
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('on a phone', () => {
  void test('opens on 12 weeks; a year scrolls inside the card, months never under the weekdays', async () => {
    const h = await open('/people?user=u2', stub(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      const activityCard = await card(h.page);
      assert.equal(await activityCard.getAttribute('data-range'), '12w');
      assert.equal(await cells(h.page, 'github').count(), 84);

      await activityCard.locator('input[value="52w"]').check();
      await until(async () => (await cells(h.page, 'github').count()) === 364);
      const pageOver = await h.page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(pageOver <= 0, `the page scrolls sideways by ${String(pageOver)}px`);

      const scroller = h.page.locator('.hm-scroll');
      const box = await scroller.evaluate((el) => ({
        width: el.clientWidth,
        content: el.scrollWidth,
        left: el.scrollLeft,
      }));
      assert.ok(box.content > box.width, 'a year fits a phone — it should scroll');
      assert.ok(box.left >= box.content - box.width - 2, 'the newest week is not in view');

      // Across the whole year, a step at a time — the push-out moments
      // included: no month label drawn under the weekday column, and always
      // at least one month named.
      const width = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      for (let left = 0; left <= width + 37; left += 37) {
        await scroller.evaluate((el, to) => {
          el.scrollLeft = to;
        }, left);
        await h.page.evaluate(
          () =>
            new Promise((done) => {
              requestAnimationFrame(() => requestAnimationFrame(done));
            }),
        );
        const seen = await h.page.evaluate(() => {
          const days = document.querySelector('.hm-corner')?.getBoundingClientRect();
          const scroll = document.querySelector('.hm-scroll')?.getBoundingClientRect();
          if (days === undefined || scroll === undefined)
            return { under: ['no weekday column'], shown: 0 };
          const drawn = [...document.querySelectorAll('.hm-month-label')]
            .map((el) => ({ el, text: el.textContent ?? '', box: el.getBoundingClientRect() }))
            // A label being pushed out is hidden, not drawn half covered.
            .filter(({ el }) => getComputedStyle(el).visibility !== 'hidden')
            .filter(({ box }) => box.right > scroll.left && box.left < scroll.right);
          return {
            under: drawn.filter(({ box }) => box.left < days.right - 0.5).map(({ text }) => text),
            shown: drawn.length,
          };
        });
        assert.deepEqual(seen.under, [], `at ${String(left)}px: month labels under the weekdays`);
        assert.ok(seen.shown >= 1, `at ${String(left)}px: no month is named`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('both themes', () => {
  void test('the heat colours follow the theme', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      const colour = () =>
        h.page
          .locator(`.hm-grid[data-kind="github"] .hm-cell[data-day="${TODAY}"]`)
          .evaluate((el) => getComputedStyle(el).backgroundColor);
      await setTheme(h.page, 'Light');
      const light = await colour();
      await setTheme(h.page, 'Dark');
      const dark = await colour();
      // --heat-gh-4: #5f2db7 light, #c0b0fe dark.
      assert.equal(light, 'rgb(95, 45, 183)');
      assert.equal(dark, 'rgb(192, 176, 254)');
    } finally {
      await h.close();
    }
  });
});
