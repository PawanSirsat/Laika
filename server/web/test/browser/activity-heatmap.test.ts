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
import { shortDate } from '../../src/routes/screens/profile/activity-derive.ts';

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
    // The profile carries the same two switches the activity answers with:
    // the card is drawn in its final shape from them (LAI-751).
    '/api/v1/users/u2/profile': {
      ...PROFILE,
      activity_sharing: sharing ?? { org_enabled: true, enabled: true },
    },
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
      // Today, yesterday and three days ago: three weekdays, each once. A tie
      // is said, never settled on the first (LAI-751).
      assert.match(await tile('busiest_weekday'), /—\s*no single busiest day/);
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

/*
 * LAI-761: a clicked day kept its tooltip and outline while the mouse went
 * elsewhere — the owner's screenshots show *Thu 25 Jun* still open with the
 * cursor off the grid. A click focuses the cell, focus drove the tooltip, and
 * only leaving the whole card body hid it.
 */
void describe('the tooltip after a click (LAI-761)', () => {
  const YESTERDAY = new Date(NOW - DAY).toISOString().slice(0, 10);

  for (const design of ['stacked', 'split'] as const) {
    for (const range of ['12w', '52w'] as const) {
      void test(`in ${design} over ${range}, the tooltip follows the mouse, not the click`, async () => {
        const h = await open('/people?user=u2', stub());
        try {
          const activityCard = await card(h.page);
          await activityCard.locator(`input[value="${design}"]`).check();
          await activityCard.locator(`input[value="${range}"]`).check();
          await h.page
            .locator(
              `.prof-card[data-section="activity"][data-range="${range}"][aria-busy="false"]`,
            )
            .waitFor({ timeout: 10_000 });

          const grid = h.page.locator('.hm-grid').first();
          const clicked = grid.locator(`.hm-cell[data-day="${TODAY}"]`);
          const other = grid.locator(`.hm-cell[data-day="${YESTERDAY}"]`);
          const tips = h.page.locator('.hm-tip');
          const dates = () => tips.locator('.hm-tip-date').allInnerTexts();

          await clicked.click();
          await until(async () => (await dates()).join() === shortDate(TODAY));
          assert.deepEqual(await dates(), [shortDate(TODAY)]);
          assert.equal(
            await clicked.evaluate((el) => getComputedStyle(el).boxShadow),
            'none',
            'a mouse click drew a focus outline',
          );

          // Another day: exactly one tooltip, and it is that day's.
          await other.hover();
          await until(async () => (await dates()).join() === shortDate(YESTERDAY));
          assert.deepEqual(await dates(), [shortDate(YESTERDAY)]);

          // Off the grids, still inside the card: nothing stays open or outlined.
          const stats = await h.page.locator('.hm-stats').boundingBox();
          assert.ok(stats !== null, 'no stats row to move to');
          await h.page.mouse.move(stats.x + stats.width / 2, stats.y + stats.height / 2);
          await until(async () => (await tips.count()) === 0);
          assert.equal(await tips.count(), 0, 'the tooltip stayed open off the grid');
          assert.equal(await h.page.locator('.hm-ring').count(), 0, 'the outline stayed');

          // Off the card entirely.
          await other.hover();
          await tips.waitFor({ timeout: 5_000 });
          await h.page.mouse.move(1, 1);
          await until(async () => (await tips.count()) === 0);
          assert.equal(await tips.count(), 0, 'the tooltip stayed open off the card');
        } finally {
          await h.close();
        }
      });
    }

    void test(`in ${design}, the keyboard shows it, Escape and Tab out close it`, async () => {
      const h = await open('/people?user=u2', stub());
      try {
        const activityCard = await card(h.page);
        await activityCard.locator(`input[value="${design}"]`).check();
        const tips = h.page.locator('.hm-tip');
        const dates = () => tips.locator('.hm-tip-date').allInnerTexts();
        // The last grid, so Tab leaves the grids rather than entering the next.
        const cell = h.page.locator('.hm-grid').last().locator('.hm-cell[tabindex="0"]');
        await h.page.mouse.move(1, 1);

        await cell.focus();
        await h.page.keyboard.press('ArrowUp');
        await until(async () => (await dates()).join() === shortDate(YESTERDAY));
        assert.deepEqual(await dates(), [shortDate(YESTERDAY)], 'the arrow key showed nothing');

        await h.page.keyboard.press('Escape');
        await until(async () => (await tips.count()) === 0);
        assert.equal(await tips.count(), 0, 'Escape did not close it');

        await h.page.keyboard.press('ArrowDown');
        await until(async () => (await dates()).join() === shortDate(TODAY));
        assert.deepEqual(await dates(), [shortDate(TODAY)]);

        await h.page.keyboard.press('Tab');
        assert.equal(
          await h.page.evaluate(() => document.activeElement?.classList.contains('hm-cell')),
          false,
          'Tab did not leave the grid',
        );
        await until(async () => (await tips.count()) === 0);
        assert.equal(await tips.count(), 0, 'Tab out did not close it');
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the states', () => {
  void test('Developer insights off: one panel for GitHub and Local, one link, then the board', async () => {
    const h = await open('/people?user=u2', stub({ org_enabled: false, enabled: true }));
    try {
      const activityCard = await card(h.page);
      const off = activityCard.locator('.hm-off');
      assert.equal(await off.count(), 1);
      assert.match(
        await off.innerText(),
        /GitHub and Local are not shown: Developer insights are off for this organisation\./,
      );
      // Said once, with one way to Organisation — not once per empty grid.
      assert.equal(await activityCard.locator('a[href="/organisation"]').count(), 1);
      assert.equal((await activityCard.innerText()).match(/not shown/g)?.length, 1);
      // No empty grids for GitHub and Local: the board's, alone.
      assert.deepEqual(
        await activityCard
          .locator('.hm-block')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-source'))),
        ['board'],
      );
      assert.equal(await cells(h.page, 'board').count(), 364);
      assert.match(await h.page.locator('[data-stat="pushed_share"]').innerText(), /not shared/);

      // A: the same panel, and the board as a single-colour grid.
      await activityCard.locator('input[value="split"]').check();
      assert.equal(await h.page.locator('.hm-grid').getAttribute('data-kind'), 'board');
      assert.equal(await activityCard.locator('.hm-off').count(), 1);
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
        await activityCard.locator('.hm-off').innerText(),
        /GitHub and Local are not shown: Bea Builder hasn’t turned on sharing, and only they can\./,
      );
      assert.equal(await activityCard.locator('a').count(), 0, 'nothing an admin can turn on');
      assert.equal(await h.page.locator('.hm-grid').count(), 1);
      assert.equal(await cells(h.page, 'board').count(), 364);
    } finally {
      await h.close();
    }
  });

  void test('both switches on and nothing arrived: says so in place, and draws the empty grids', async () => {
    const h = await open('/people?user=u2', stub(undefined, true));
    try {
      const activityCard = await card(h.page);
      assert.equal(await activityCard.locator('.hm-off').count(), 0);
      assert.deepEqual(await activityCard.locator('.hm-block-head .hm-total').allInnerTexts(), [
        'nothing from their machines yet',
        'nothing from their machines yet',
        // The empty fixture is empty on the board too.
        '0 actions by them · 0 by their agents',
      ]);
      assert.match(
        (await activityCard.locator('.hm-block-head .hm-total').first().getAttribute('title')) ??
          '',
        /they connect it with laika activity on/,
      );
      assert.equal(await cells(h.page, 'github').count(), 364);
    } finally {
      await h.close();
    }
  });

  /**
   * The card is drawn in its final shape while the activity is on its way
   * (LAI-751): every state, both designs, three widths. Measured with the
   * answer held until the skeleton has been read, then let go.
   */
  void test('loading holds the card’s size in every state: nothing moves when the answer lands', async () => {
    const states: [string, ApiStub][] = [
      ['shown', stub()],
      ['nothing yet', stub(undefined, true)],
      ['insights off', stub({ org_enabled: false, enabled: true })],
      ['not sharing', stub({ org_enabled: true, enabled: false })],
    ];
    const moved: string[] = [];
    for (const [state, api] of states) {
      // Every answer is held until let go; a reload leaves the one before it
      // held for good, which `unrouteAll` below drops.
      const held: (() => void)[] = [];
      const h = await open('/people?user=u2', api, {
        before: async (page) => {
          await page.route('**/api/v1/people/u2/activity**', async (route) => {
            await new Promise<void>((resolve) => {
              held.push(resolve);
            });
            await route.fallback();
          });
        },
      });
      try {
        for (const design of ['stacked', 'split']) {
          for (const width of [1366, 1024, 390]) {
            await h.page.setViewportSize({ width, height: 900 });
            await h.page.evaluate((d) => {
              localStorage.setItem('laika.profile.activity-design.u1', d);
            }, design);
            const asked = held.length;
            await h.page.reload();
            const busy = h.page.locator('.prof-card[data-section="activity"][aria-busy="true"]');
            await busy.waitFor({ timeout: 20_000 });
            await until(() => held.length > asked, 10_000);
            await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
            const before = await busy.evaluate((el) => el.getBoundingClientRect().height);
            held[held.length - 1]?.();
            const done = await card(h.page);
            await h.page.evaluate(
              () =>
                new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                }),
            );
            const after = await done.evaluate((el) => el.getBoundingClientRect().height);
            if (Math.abs(after - before) > 1) {
              moved.push(
                `${state}, ${design}, ${String(width)}: ${String(Math.round(before))} → ${String(Math.round(after))}px`,
              );
            }
          }
        }
      } finally {
        await h.page.unrouteAll({ behavior: 'ignoreErrors' });
        await h.close();
      }
    }
    assert.deepEqual(moved, [], 'the card changed height when its answer landed');
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
      // Each source's heading — its total and its Less…More key — is whole in
      // view wherever the year is scrolled (LAI-751).
      for (const end of ['newest', 'oldest']) {
        if (end === 'oldest') {
          await h.page.locator('.hm-scroll').evaluate((el) => {
            el.scrollLeft = 0;
          });
        }
        const cut = await h.page.evaluate(() => {
          const view = document.querySelector('.hm-scroll')?.getBoundingClientRect();
          if (view === undefined) return ['no scroller'];
          return [...document.querySelectorAll('.hm-block-head .hm-total, .hm-block-head .hm-ramp')]
            .map((el) => ({ el, box: el.getBoundingClientRect() }))
            .filter(({ box }) => box.left < view.left - 0.5 || box.right > view.right + 0.5)
            .map(({ el }) => el.closest('.hm-block')?.getAttribute('data-source') ?? '?');
        });
        assert.deepEqual(cut, [], `scrolled to the ${end} week: a heading runs out of view`);
      }
      await h.page.locator('.hm-scroll').evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
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

  for (const design of ['stacked', 'split']) {
    void test(`twelve weeks fit a phone in ${design}, with nothing wider than the card`, async () => {
      const h = await open('/people?user=u2', stub(), {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript((d) => {
            localStorage.setItem('laika.profile.activity-design.u1', d);
          }, design);
        },
      });
      try {
        const activityCard = await card(h.page);
        assert.equal(await activityCard.getAttribute('data-range'), '12w');
        assert.equal(await activityCard.getAttribute('data-design'), design);
        const over = await activityCard.evaluate((el) => {
          const scroll = el.querySelector('.hm-scroll');
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const left = box.left + Number.parseFloat(style.paddingLeft);
          const right = box.right - Number.parseFloat(style.paddingRight);
          return {
            scroll: scroll === null ? -1 : scroll.scrollWidth - scroll.clientWidth,
            outside: [...el.querySelectorAll('*')]
              .map((child) => ({ child, rect: child.getBoundingClientRect() }))
              .filter(({ rect }) => rect.width > 0 && rect.height > 0)
              .filter(({ rect }) => rect.left < left - 0.5 || rect.right > right + 0.5)
              .map(
                ({ child, rect }) =>
                  `${child.className} ${String(Math.round(rect.right - right))}px`,
              ),
          };
        });
        assert.equal(over.scroll, 0, `twelve weeks scroll sideways by ${String(over.scroll)}px`);
        assert.deepEqual(over.outside, [], 'something runs past the card’s edge');
      } finally {
        await h.close();
      }
    });
  }
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
