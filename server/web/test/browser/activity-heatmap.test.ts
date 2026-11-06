/**
 * The profile's Activity card in a real browser (D-079, LAI-751; LAI-1154).
 *
 * `activity-derive.test.ts` owns the rules — where a day sits, how dark it is,
 * the streaks. This proves the page: both designs as one grid from one
 * response, no Board anywhere, the choice kept per viewer, one request per
 * range, your own profile reading `/me/activity`, the days before joining,
 * the opening range, the tooltip, the keyboard, each state's sentence, and a
 * year that scrolls inside the card on a phone with its month labels never
 * under the weekday column.
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
  now = NOW,
) {
  const days = range === '12w' ? 84 : 364;
  const today = new Date(now).toISOString().slice(0, 10);
  const start = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
  const at = (ago: number) => days - 1 - ago;
  const series = (values: Record<number, number>) => {
    const out = new Array<number>(days).fill(0);
    if (!empty) for (const [ago, n] of Object.entries(values)) out[at(Number(ago))] = n;
    return out;
  };
  // LAI-963: the server draws GitHub and Local on the organisation's switch alone.
  const shown = sharing.org_enabled;
  return {
    range,
    start,
    end: today,
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
    prompts_by_agent: shown && !empty ? { [today]: { 'claude-code': 18, codex: 5 } } : {},
    agents: shown && !empty ? ['claude-code', 'codex'] : [],
  };
}

/**
 * `now` moves the ranges' last day off today, for a calendar shape the clock
 * may not give; `joinedAt` is when Bea joined.
 */
function stub(
  sharing?: Sharing,
  empty = false,
  me = ME,
  now = NOW,
  joinedAt = NOW - 400 * DAY,
): ApiStub {
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
      user: { ...PROFILE.user, created_at: joinedAt },
      activity_sharing: sharing ?? { org_enabled: true, enabled: true },
    },
    '/api/v1/people/u2/activity?range=12w': activity('12w', sharing, empty, now),
    '/api/v1/people/u2/activity?range=52w': activity('52w', sharing, empty, now),
  };
}

/** Every heatmap request the page made: its path and query. */
function watch(requests: string[]) {
  return (page: Page): Promise<void> => {
    page.on('request', (request: Request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/activity')) requests.push(url.pathname + url.search);
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

const cells = (page: Page, kind?: string) =>
  page.locator(
    `.prof-card[data-section="activity"] .hm-grid${kind === undefined ? '' : `[data-kind="${kind}"]`} .hm-cell`,
  );

/** The board's words — none of which the card says any more (LAI-1154). */
const BOARD = /Board|board action|by their agents|actions by them/;

void after(async () => {
  await closeBrowser();
});

void describe('the Activity card', () => {
  void test('opens on Split over a year: one grid, a square a day, and no Board anywhere', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      const activityCard = await card(h.page);
      assert.equal(await activityCard.getAttribute('data-design'), 'split');
      assert.equal(await activityCard.getAttribute('data-range'), '52w');
      assert.equal(await h.page.locator('.hm-grid').count(), 1);
      await until(async () => (await cells(h.page, 'split').count()) === 364);
      assert.equal(await cells(h.page, 'split').count(), 364);
      const today = h.page.locator(`.hm-grid[data-kind="split"] .hm-cell[data-day="${TODAY}"]`);
      assert.equal(await today.getAttribute('data-g'), '4');
      assert.equal(await today.getAttribute('data-l'), '4');
      assert.match(
        await today.evaluate((el) => getComputedStyle(el).backgroundImage),
        /linear-gradient/,
      );
      const legend = await activityCard.locator('.hm-legend').innerText();
      assert.match(legend, /Each day: GitHub top-left, Local bottom-right/);
      assert.match(legend, /5 commits pushed/);
      assert.match(legend, /23 prompts · 3 sessions · 2 not pushed/);
      // Board actions are in the fixture and nowhere on the card, its (i) included.
      assert.doesNotMatch(await activityCard.innerText(), BOARD);
      assert.doesNotMatch((await today.getAttribute('aria-label')) ?? '', BOARD);
      // No day before joining in this range: no chip, no note.
      assert.doesNotMatch(legend, /Before joining/);
      assert.equal(
        await activityCard.locator('.prof-card-caption').first().innerText(),
        'last 12 months',
      );
    } finally {
      await h.close();
    }
  });

  void test('Stacked is one grid of GitHub and Local together; the choice is kept per viewer', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      const activityCard = await card(h.page);
      await activityCard.locator('input[value="stacked"]').check();
      assert.equal(await activityCard.getAttribute('data-design'), 'stacked');
      assert.equal(await h.page.locator('.hm-grid').count(), 1, 'Stacked drew more than one grid');
      assert.equal(await cells(h.page, 'all').count(), 364);
      const level = (ago: number) =>
        h.page
          .locator(
            `.hm-grid[data-kind="all"] .hm-cell[data-day="${new Date(NOW - ago * DAY).toISOString().slice(0, 10)}"]`,
          )
          .getAttribute('data-v');
      // Today: 4 pushed + 28 local = 32, the busiest. Three days ago: 1 pushed.
      // Yesterday: a board action only, which is not on the card.
      assert.equal(await level(0), '4');
      assert.equal(await level(3), '1');
      assert.equal(await level(1), '0');
      const legend = await activityCard.locator('.hm-legend').innerText();
      assert.match(legend, /Each day: GitHub and Local together/);
      assert.match(legend, /5 commits pushed/);
      assert.match(legend, /23 prompts · 3 sessions · 2 not pushed/);
      assert.doesNotMatch(await activityCard.innerText(), BOARD);

      await h.page.reload();
      assert.equal(await (await card(h.page)).getAttribute('data-design'), 'stacked');
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.profile.activity-design.u1')),
        'stacked',
      );
    } finally {
      await h.close();
    }
    // Another viewer on the same browser starts on Split.
    const other = await open(
      '/people?user=u2',
      stub(undefined, false, { ...ME, id: 'u9', name: 'Ari Admin', org_role: 'admin' }),
    );
    try {
      assert.equal(await (await card(other.page)).getAttribute('data-design'), 'split');
    } finally {
      await other.close();
    }
  });

  void test('computes the stats row on the client from the days', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      const tile = (name: string) => h.page.locator(`.hm-stats [data-stat="${name}"]`).innerText();
      // Active: today and three days ago — yesterday's board action is not
      // on the card (LAI-1154).
      assert.match(await tile('active_days'), /2\s*of 364$/);
      assert.match(await tile('current_streak'), /1\s*day$/);
      // A one-day streak is named by its day: the first of the two, three days ago.
      const first = shortDate(new Date(NOW - 3 * DAY).toISOString().slice(0, 10)).slice(4);
      assert.match(await tile('longest_streak'), new RegExp(`1\\s*${first}$`));
      // 5 pushed, 2 not: 71%.
      assert.match(await tile('pushed_share'), /71%\s*pushed/);
      // Two weekdays, each once: no single day yet.
      assert.match(await tile('busiest_weekday'), /—\s*no single day yet/);
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
      await until(async () => (await cells(h.page).count()) === 84);
      await activityCard.locator('input[value="52w"]').check();
      await until(async () => (await cells(h.page).count()) === 364);
      await activityCard.locator('input[value="12w"]').check();
      await until(async () => (await cells(h.page).count()) === 84);
      assert.deepEqual(requests, [
        '/api/v1/people/u2/activity?range=52w',
        '/api/v1/people/u2/activity?range=12w',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('the tooltip gives the day whole — GitHub and Local, no board — and rings it', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      await h.page.locator(`.hm-grid .hm-cell[data-day="${TODAY}"]`).hover();
      const tip = h.page.locator('.hm-tip');
      await tip.waitFor();
      const text = await tip.innerText();
      for (const part of [
        /4\s*commits pushed/,
        /2\s*local commits not pushed/,
        /23\s*prompts \(Claude Code 18, Codex 5\)/,
        /3\s*agent sessions/,
      ]) {
        assert.match(text, part);
      }
      assert.doesNotMatch(text, BOARD);
      await until(async () => (await h.page.locator('.hm-ring').count()) === 1);
      assert.equal(await h.page.locator('.hm-ring').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('arrow keys move between days, and each day reads as text', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      await card(h.page);
      const focusable = h.page.locator('.hm-grid .hm-cell[tabindex="0"]');
      assert.equal(await focusable.count(), 1, 'one day in the tab order');
      assert.equal(await focusable.getAttribute('data-day'), TODAY);
      await focusable.focus();
      const label = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
      assert.match(await label(), /4 commits pushed, 2 local commits not pushed/);

      await h.page.keyboard.press('ArrowUp');
      const yesterday = new Date(NOW - DAY).toISOString().slice(0, 10);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-day')),
        yesterday,
      );
      assert.match(await label(), /0 commits pushed, 0 local commits not pushed/);

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
  void test('Developer insights off: one panel, one link, and nothing else drawn', async () => {
    const h = await open('/people?user=u2', stub({ org_enabled: false, enabled: true }));
    try {
      const activityCard = await card(h.page);
      for (const design of ['split', 'stacked']) {
        await activityCard.locator(`input[value="${design}"]`).check();
        const off = activityCard.locator('.hm-off');
        assert.equal(await off.count(), 1);
        assert.match(
          await off.innerText(),
          /GitHub and Local are not shown: Developer insights are off for this organisation\./,
        );
        assert.equal(await activityCard.locator('a[href="/organisation"]').count(), 1);
        // GitHub and Local are all the card draws: no grid, no tiles, no Board.
        assert.equal(await activityCard.locator('.hm-grid, .hm-ghost').count(), 0, design);
        assert.equal(await activityCard.locator('.hm-stats').count(), 0, design);
        assert.doesNotMatch(await activityCard.innerText(), BOARD);
      }
    } finally {
      await h.close();
    }
  });

  /**
   * D-102 amended (LAI-967): collection follows the organisation's switch
   * alone, and a current server sends `enabled` equal to `org_enabled`. An
   * `enabled: false` beside it is a stale personal answer that decides nothing:
   * GitHub and Local are drawn, and nobody is sent to a switch that is gone.
   */
  void test('organisation on: a stale personal “off” hides nothing and names no switch', async () => {
    const h = await open('/people?user=u2', stub({ org_enabled: true, enabled: false }));
    try {
      const activityCard = await card(h.page);
      await until(async () => (await cells(h.page, 'split').count()) === 364);
      assert.equal(await activityCard.locator('.hm-off').count(), 0);
      assert.doesNotMatch(await activityCard.innerText(), /turned on sharing|only they can/);
      assert.equal(await cells(h.page, 'split').count(), 364);
    } finally {
      await h.close();
    }
  });

  void test('both switches on and nothing arrived: says so in place, and draws the empty grid', async () => {
    const h = await open('/people?user=u2', stub(undefined, true));
    try {
      const activityCard = await card(h.page);
      assert.equal(await activityCard.locator('.hm-off').count(), 0);
      assert.deepEqual(await activityCard.locator('.hm-legend .hm-total').allInnerTexts(), [
        'nothing from their machines yet',
        'nothing from their machines yet',
      ]);
      assert.match(
        (await activityCard.locator('.hm-legend .hm-total').first().getAttribute('title')) ?? '',
        /they connect it with laika activity on/,
      );
      assert.equal(await cells(h.page, 'split').count(), 364);
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
      ['stale personal off', stub({ org_enabled: true, enabled: false })],
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

/**
 * A loaded runner, made certain (LAI-1035). Chromium fires an element's
 * `scroll` event at its next rendered frame, and the card hides a pushed-out
 * month label from that event. Under `page.clock` a `requestAnimationFrame` is
 * a 16 ms timer, not a frame, so a wait counted in them can end before the
 * frame — and read the labels as the last position left them. This holds
 * every `.hm-scroll` scroll event 100 ms, for every listener, as a slow frame
 * does.
 */
const HOLD_SCROLL_EVENTS = `(() => {
  const late = new WeakSet();
  window.addEventListener('scroll', (event) => {
    const target = event.target;
    if (late.has(event) || !(target instanceof Element) || !target.classList.contains('hm-scroll')) return;
    event.stopImmediatePropagation();
    setTimeout(() => {
      const again = new Event('scroll');
      late.add(again);
      target.dispatchEvent(again);
    }, 100);
  }, true);
})();`;

void describe('on a phone', () => {
  // The clock's today, and a day it may not give: Sun 1 Nov 2026, a month's
  // 1st alone in the newest week. Its label once ran past the canvas, and
  // scrolled to that week every heading was left out of view (LAI-1017).
  for (const [when, now, late] of [
    ['', NOW, false],
    [', a month’s 1st alone in the newest week', Date.parse('2026-11-01T12:00:00Z'), false],
    [', with the scroll event a frame late', NOW, true],
  ] as const) {
    void test(`opens on 12 weeks; a year scrolls inside the card, months never under the weekdays${when}`, async () => {
      const h = await open('/people?user=u2', stub(undefined, false, ME, now), {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
          // The page's today is the fixture's: the grid drawn while an answer
          // is on its way ends on the browser's today, not the pinned one.
          await page.clock.setFixedTime(now);
          if (late) await page.addInitScript(HOLD_SCROLL_EVENTS);
        },
      });
      try {
        const activityCard = await card(h.page);
        assert.equal(await activityCard.getAttribute('data-range'), '12w');
        assert.equal(await cells(h.page).count(), 84);

        await activityCard.locator('input[value="52w"]').check();
        await until(async () => (await cells(h.page).count()) === 364);
        // Measured on the year's answer, not on what stood in for it.
        await h.page
          .locator('.prof-card[data-section="activity"][data-range="52w"][aria-busy="false"]')
          .waitFor();
        assert.equal(
          await cells(h.page).last().getAttribute('data-day'),
          new Date(now).toISOString().slice(0, 10),
          'the newest week is not the one this case is about',
        );
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
          // The card settles from the scroll event, which comes with a frame;
          // under page.clock two requestAnimationFrames are 32 ms of timers,
          // not two frames (LAI-1035). So wait for the event itself — the
          // card's listener runs first, being the older — and then for the
          // frame its settle was booked on. A step that moves nothing (the
          // overshoot past the end) fires no event and has nothing to settle.
          await scroller.evaluate(
            (el, to) =>
              new Promise<void>((done) => {
                const frames = (): void => {
                  requestAnimationFrame(() => requestAnimationFrame(() => done()));
                };
                const from = el.scrollLeft;
                el.addEventListener('scroll', frames, { once: true });
                el.scrollLeft = to;
                if (el.scrollLeft === from) {
                  el.removeEventListener('scroll', frames);
                  frames();
                }
              }),
            left,
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
  }

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

/**
 * A member of four days (LAI-1154): the card opens on 12 weeks, and the
 * weeks before they joined are drawn apart — no fill, a ring — named so, and
 * counted in no tile. The joining day is in the series' zone, UTC here.
 */
void describe('before joining (LAI-1154)', () => {
  const JOINED_AT = NOW - 4 * DAY;
  const JOINED = new Date(JOINED_AT).toISOString().slice(0, 10);

  for (const design of ['split', 'stacked'] as const) {
    void test(`in ${design}, days before joining are drawn apart, titled, keyed and captioned`, async () => {
      const h = await open('/people?user=u2', stub(undefined, false, ME, NOW, JOINED_AT), {
        before: async (page) => {
          await page.addInitScript((d) => {
            localStorage.setItem('laika.profile.activity-design.u1', d);
          }, design);
        },
      });
      try {
        const activityCard = await card(h.page);
        // A member of under 12 weeks opens on 12 weeks, on a wide screen too.
        assert.equal(await activityCard.getAttribute('data-range'), '12w');
        assert.equal(await activityCard.getAttribute('data-design'), design);
        assert.equal(
          await activityCard.locator('.prof-card-caption').first().innerText(),
          `last 12 weeks · joined ${shortDate(JOINED)}`,
        );

        const pre = h.page.locator('.hm-grid .hm-cell[data-pre="true"]');
        // 84 days, the last five since joining.
        assert.equal(await pre.count(), 79);
        assert.equal(
          await pre.last().getAttribute('data-day'),
          new Date(JOINED_AT - DAY).toISOString().slice(0, 10),
        );
        assert.match((await pre.first().getAttribute('aria-label')) ?? '', / · before joining$/);
        assert.equal(
          await h.page.locator(`.hm-cell[data-day="${JOINED}"]`).getAttribute('data-pre'),
          null,
          'the joining day itself is counted',
        );
        const look = await pre.first().evaluate((el) => {
          const style = getComputedStyle(el);
          return { bg: style.backgroundColor, image: style.backgroundImage, ring: style.boxShadow };
        });
        assert.equal(
          look.bg,
          'rgba(0, 0, 0, 0)',
          'a day before joining must be transparent, and it has a fill',
        );
        assert.equal(look.image, 'none');
        assert.match(
          look.ring,
          /inset/,
          'a day before joining must carry an inset ring, and it has none',
        );

        assert.match(await activityCard.locator('.hm-legend').innerText(), /Before joining/);
        const tile = (name: string) =>
          h.page.locator(`.hm-stats [data-stat="${name}"]`).innerText();
        // Today and three days ago, of the five days since joining.
        assert.match(await tile('active_days'), /2\s*of 5 since joining/);

        await pre.first().hover();
        const tip = h.page.locator('.hm-tip');
        await tip.waitFor();
        assert.match(await tip.innerText(), /before joining/);
        assert.doesNotMatch(await tip.innerText(), /commits pushed/);

        // A year: more of it before joining, and still said.
        await activityCard.locator('input[value="52w"]').check();
        await until(async () => (await pre.count()) === 359);
        assert.equal(await pre.count(), 359);
        assert.equal(
          await activityCard.locator('.prof-card-caption').first().innerText(),
          `last 12 months · joined ${shortDate(JOINED)}`,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('a member of 12 weeks or more opens on a year', async () => {
    const h = await open('/people?user=u2', stub(undefined, false, ME, NOW, NOW - 90 * DAY));
    try {
      const activityCard = await card(h.page);
      assert.equal(await activityCard.getAttribute('data-range'), '52w');
      // Joined inside the year: the days before it are marked there too.
      assert.equal(await h.page.locator('.hm-cell[data-pre="true"]').count(), 364 - 91);
    } finally {
      await h.close();
    }
  });
});

/**
 * Your own profile reads `GET /me/activity` (D-139 item 1, LAI-1150): any role
 * may, and it writes no look. Someone else's stays on the logged read.
 */
void describe('your own profile (LAI-1154)', () => {
  void test('reads /me/activity, never /people/:you/activity', async () => {
    const requests: string[] = [];
    const own = stub();
    const h = await open(
      '/people?user=u1',
      {
        ...own,
        // Your own profile is `/me/profile` (LAI-1152), every role's.
        '/api/v1/me/profile': {
          ...PROFILE,
          user: { ...PROFILE.user, id: 'u1', name: 'Ada Owner', email: 'ada@example.com' },
          activity_sharing: { org_enabled: true, enabled: true },
        },
        '/api/v1/me/activity?range=12w': activity('12w'),
        '/api/v1/me/activity?range=52w': activity('52w'),
      },
      { before: watch(requests) },
    );
    try {
      const activityCard = await card(h.page);
      assert.equal(await cells(h.page).count(), 364);
      await activityCard.locator('input[value="12w"]').check();
      await until(async () => (await cells(h.page).count()) === 84);
      await activityCard.locator('input[value="52w"]').check();
      await until(async () => (await cells(h.page).count()) === 364);
      // Once per range, the way back answered from the cache.
      assert.deepEqual(requests, [
        '/api/v1/me/activity?range=52w',
        '/api/v1/me/activity?range=12w',
      ]);
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });
});

void describe('both themes', () => {
  void test('the heat colours follow the theme, in Split and in Stacked', async () => {
    const h = await open('/people?user=u2', stub());
    try {
      const activityCard = await card(h.page);
      const colour = (kind: string, ago: number) =>
        h.page
          .locator(
            `.hm-grid[data-kind="${kind}"] .hm-cell[data-day="${new Date(NOW - ago * DAY).toISOString().slice(0, 10)}"]`,
          )
          .evaluate((el) => getComputedStyle(el).backgroundColor);
      // Split, three days ago: GitHub alone at its lowest step, --heat-gh-1.
      await setTheme(h.page, 'Light');
      assert.equal(await colour('split', 3), 'rgb(204, 193, 254)');
      await setTheme(h.page, 'Dark');
      assert.equal(await colour('split', 3), 'rgb(75, 59, 120)');
      // Stacked, today: the busiest day together, --heat-all-4.
      await activityCard.locator('input[value="stacked"]').check();
      await setTheme(h.page, 'Light');
      assert.equal(await colour('all', 0), 'rgb(72, 77, 88)');
      await setTheme(h.page, 'Dark');
      assert.equal(await colour('all', 0), 'rgb(194, 195, 209)');
    } finally {
      await h.close();
    }
  });
});
