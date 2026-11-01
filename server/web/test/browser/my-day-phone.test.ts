import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, until, type Harness } from './harness.ts';
import { NOW, open, TODAY } from './my-day-clock.ts';
import { AGENT, at, viewOf, weekData, weekStub, YESTERDAY } from './my-day-week.ts';

/**
 * My day on a phone, as the owner's design draws it (LAI-518): the 48px top
 * bar, the day row with its icon buttons, the letter week with a dot a day,
 * the summary with Confirm, and `TimelineMobileV2`'s vertical Timeline — at
 * 390 and 360 px, light and dark. The desktop at 1440 keeps its own page.
 */

const SHOTS = process.env.LAIKA_SHOTS;
const WIDTHS = [390, 360] as const;
const THEMES = ['light', 'dark'] as const;

/** Today's prompts and commits, and an agent at work 1–2 PM, so SIG and AGENTS have marks. */
const SIGNAL_TIMES = {
  prompts: [
    [at(TODAY, 9, 0), 3],
    [at(TODAY, 9, 5), 1],
    [at(TODAY, 13, 20), 2],
  ],
  commits: [
    [at(TODAY, 9, 10), 1],
    [at(TODAY, 13, 40), 2],
  ],
};
const LANE = Array.from({ length: 12 }, (_, i) => [at(TODAY, 13, i * 5), 300, 300]);

const RUNNING = {
  started_at: NOW - 25 * 60_000,
  resumed_at: NOW - 25 * 60_000,
  paused_at: null,
  accumulated_ms: 0,
  tz: 'UTC',
  task: null,
  kind: 'thinking',
  title: 'Keyboard steps',
};

function stub(timer: typeof RUNNING | null = null): Record<string, unknown> {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as Record<string, unknown>),
    signal_times: SIGNAL_TIMES,
    agent: { ...AGENT, lane: LANE },
    timer,
  });
  routes['/api/v1/me/analytics-views'] = {
    data: [
      {
        id: 'v1',
        viewer: { id: 'u9', name: 'Grace Hopper' },
        kind: 'time',
        day: TODAY,
        // Inside LAI-529's 15 minutes of the pinned 15:00.
        viewed_at: at(TODAY, 14, 57),
      },
    ],
    next_cursor: null,
  };
  return routes;
}

async function phone(width: number, timer: typeof RUNNING | null = null): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(timer), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 844 });
    },
  });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-timeline-mobile]').waitFor({ timeout: 10_000 });
  return h;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  // The theme's colours ease in; a picture taken mid-way shows neither theme.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const rect = (page: Page, css: string): Promise<Rect> =>
  page
    .locator(css)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

const sideways = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const main = document.querySelector('.shell-main') ?? document.scrollingElement;
    return main === null ? 0 : main.scrollWidth - main.clientWidth;
  });

/** `Sun 25 Oct`: how the day row names a day. */
const dayName = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * `until`, then the condition asserted: the harness's `until` returns quietly
 * when its time runs out, so a wait alone proves nothing.
 */
async function soon(done: () => boolean | Promise<boolean>, message: string): Promise<void> {
  await until(done, 10_000);
  assert.ok(await done(), message);
}

/** Lets go of the sheet by its scrim, as a thumb does, and checks it went. */
async function closeSheet(h: Harness): Promise<void> {
  await h.page.locator('[data-myday-scrim]').click({ position: { x: 10, y: 10 } });
  await soon(
    async () => (await h.page.locator('[data-myday-drawer]').count()) === 0,
    'the sheet did not close',
  );
}

after(async () => {
  await closeBrowser();
});

void describe('My day on a phone (LAI-518)', () => {
  for (const width of WIDTHS) {
    void test(`${String(width)} px: the top bar, the day row with icon buttons, the letter week, the summary with Confirm`, async () => {
      const h = await phone(width);
      try {
        for (const theme of THEMES) {
          await setTheme(h.page, theme);
          const where = `${String(width)} px, ${theme}`;

          // The shell's bar is My day's: 48px, the mark and Laika, the eye, Viewing, the avatar.
          const bar = h.page.locator('.shell-head[data-myday-bar]');
          assert.equal((await rect(h.page, '.shell-head[data-myday-bar]')).h, 48, where);
          assert.equal(await bar.locator('.myday-bar-name').innerText(), 'Laika');
          assert.equal(await bar.locator('[data-who-looked] > button').count(), 1);
          assert.equal(await bar.locator('[data-viewing-switch]').count(), 1);
          assert.equal(await bar.locator('.myday-bar-avatar').innerText(), 'AL');
          await soon(
            async () => (await bar.locator('[data-looked-count]').count()) === 1,
            `${where}: no badge on the eye`,
          );
          // The desktop's header gives way to the day row.
          assert.equal(await h.page.locator('[data-day-total]').count(), 0, where);
          assert.equal(await h.page.locator('.myday-week-days').count(), 0, where);

          // ‹ the day ›, Today under it, then the timer, Add time and Day settings at 40px.
          const head = h.page.locator('[data-phone-head]');
          assert.equal(await head.locator('[data-phone-date]').innerText(), dayName(TODAY));
          assert.equal(await head.locator('.myday-phone-word').innerText(), 'Today');
          assert.equal(await head.getByRole('button', { name: 'Next day' }).isDisabled(), true);
          for (const css of [
            '[data-phone-head] [data-timer-start] > button',
            '[data-phone-head] [data-add-time]',
            '[data-phone-head] [data-day-settings] > button',
          ]) {
            const r = await rect(h.page, css);
            assert.deepEqual(
              [r.w, r.h],
              [40, 40],
              `${where}: ${css} is ${String(r.w)}×${String(r.h)}`,
            );
            assert.ok(r.x >= 0 && r.x + r.w <= width, `${where}: ${css} is off the screen`);
          }
          assert.equal(
            await h.page
              .locator('[data-phone-head] .myday-head-text')
              .evaluateAll(
                (els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length,
              ),
            0,
            `${where}: a tool shows its words`,
          );

          // The week: seven letters in seven columns, a dot each by the day's state.
          const days = await h.page.locator('[data-phone-week] [data-day]').evaluateAll((els) =>
            els.map((el) => ({
              day: el.getAttribute('data-day') ?? '',
              letter: el.querySelector('.myday-phone-letter')?.textContent ?? '',
              dot: el.querySelector('[data-dot]')?.getAttribute('data-dot') ?? '',
              x: el.getBoundingClientRect().x,
              right: el.getBoundingClientRect().right,
              pressed: el.getAttribute('aria-pressed'),
            })),
          );
          assert.equal(days.map((d) => d.letter).join(''), 'MTWTFSS', where);
          for (let i = 1; i < days.length; i += 1) {
            assert.ok((days[i]?.x ?? 0) > (days[i - 1]?.x ?? 0), `${where}: the week is not a row`);
          }
          assert.ok((days.at(-1)?.right ?? width + 1) <= width, `${where}: the week overflows`);
          const settled = new Set(weekData().keys());
          for (const d of days) {
            const expected =
              d.day === TODAY
                ? 'half'
                : d.day > TODAY
                  ? 'future'
                  : settled.has(d.day)
                    ? 'settled'
                    : 'quiet';
            assert.equal(d.dot, expected, `${where}: ${d.day}'s dot`);
            assert.equal(d.pressed, String(d.day === TODAY), `${where}: ${d.day} pressed`);
          }

          // The summary: the day's figure, what is to review, Confirm at 44px.
          assert.equal(await h.page.locator('[data-phone-total]').innerText(), '6 h 10 min');
          assert.match(
            await h.page.locator('[data-phone-summary]').innerText(),
            /5 h 10 min to review/,
          );
          const confirm = h.page.locator('[data-phone-summary] [data-confirm-day]');
          assert.match(await confirm.innerText(), /^Confirm \d/);
          assert.equal((await rect(h.page, '[data-phone-summary] [data-confirm-day]')).h, 44);

          assert.ok((await sideways(h.page)) <= 1, `${where}: the page scrolls sideways`);
          await shoot(h.page, `phone-${String(width)}-${theme}-head`);
        }

        // Day settings hangs from the row's right edge, 300px, whole on the screen.
        await h.page.locator('[data-phone-head] [data-day-settings] > button').click();
        const settings = await rect(h.page, '[data-day-settings] .myday-pop-panel');
        assert.ok(settings.x >= 0 && settings.x + settings.w <= width, 'Day settings is cut off');
        assert.equal(Math.round(settings.w), Math.min(300, width - 24));
        await h.page.keyboard.press('Escape');
        await soon(
          async () => (await h.page.locator('[data-day-settings] .myday-pop-panel').count()) === 0,
          'Day settings did not close',
        );
        // Who looked: 280px under the bar's right edge.
        await h.page.locator('.shell-head [data-who-looked] > button').click();
        await h.page.locator('[data-looked]').first().waitFor({ timeout: 10_000 });
        const looked = await rect(h.page, '.shell-head [data-who-looked] .myday-pop-panel');
        assert.equal(Math.round(looked.w), 280);
        assert.ok(looked.x >= 0 && looked.x + looked.w <= width, 'Who looked is cut off');
        assert.ok(looked.y >= 48, 'Who looked is not under the bar');
        await h.page.keyboard.press('Escape');
        await soon(
          async () => (await h.page.locator('[data-who-looked] .myday-pop-panel').count()) === 0,
          'Who looked did not close',
        );

        // ‹ walks back a day; a letter walks to its day.
        await h.page
          .locator('[data-phone-head]')
          .getByRole('button', { name: 'Previous day' })
          .click();
        await soon(() => h.page.url().includes(`day=${YESTERDAY}`), '‹ did not walk back');
        await soon(
          async () =>
            (await h.page.locator('[data-phone-date]').innerText()) === dayName(YESTERDAY),
          'the day row does not name yesterday',
        );
        assert.equal(await h.page.locator('.myday-phone-word').innerText(), 'Past');
        // Today's letter when yesterday's week holds it; on a Monday yesterday is
        // last week's, so another of that week's letters (LAI-525).
        const letters = await h.page
          .locator('[data-phone-week] [data-day]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-day') ?? ''));
        const to = letters.includes(TODAY)
          ? TODAY
          : (letters.find((d) => d !== YESTERDAY && d !== '') ?? TODAY);
        await h.page.locator(`[data-phone-week] [data-day="${to}"]`).click();
        await soon(() => h.page.url().includes(`day=${to}`), 'a letter did not walk to its day');
      } finally {
        await h.close();
      }
    });
  }

  void test('360 px: a running timer is the pill with its clock and stop, and the row still fits', async () => {
    const h = await phone(360, RUNNING);
    try {
      const pill = h.page.locator('[data-phone-head] [data-timer="running"]');
      await pill.waitFor({ timeout: 10_000 });
      assert.equal((await rect(h.page, '[data-phone-head] [data-timer]')).h, 40);
      assert.equal(await pill.locator('[data-timer-clock]').isVisible(), true);
      assert.equal(
        await pill.getByRole('button', { name: 'Stop timer and save' }).isVisible(),
        true,
      );
      assert.equal(await pill.getByRole('button', { name: 'Pause timer' }).isVisible(), false);
      assert.equal(await pill.locator('.myday-timer-label').isVisible(), false);
      const row = await h.page.locator('[data-day-nav]').evaluate((el) => ({
        over: el.scrollWidth - el.clientWidth,
        right: el.getBoundingClientRect().right,
      }));
      assert.ok(row.over <= 1, `the day row overflows by ${String(row.over)}px`);
      const last = await rect(h.page, '[data-phone-head] [data-day-settings] > button');
      assert.ok(last.x + last.w <= 360, 'Day settings is off the screen');
      // The day keeps its date whole beside the pill — the weekday gives way, not the date.
      const date = await h.page.locator('[data-phone-date]').evaluate((el) => ({
        cut: el.scrollWidth > el.clientWidth + 1,
        text: (el as HTMLElement).innerText,
      }));
      assert.equal(date.cut, false, `the date is cut: ${date.text}`);
      assert.match(date.text, /\d+ [A-Z][a-z]{2}$/);
      await shoot(h.page, 'phone-360-timer');
    } finally {
      await h.close();
    }
  });

  for (const width of WIDTHS) {
    void test(`${String(width)} px: the vertical Timeline — a block's lines, Fit and its folds, 1× and 2×, Now, and a tap opens the sheet`, async () => {
      const h = await phone(width);
      try {
        for (const theme of THEMES) {
          await setTheme(h.page, theme);
          const where = `${String(width)} px, ${theme}`;
          const card = h.page.locator('[data-timeline-mobile]');
          // The horizontal Timeline is the desktop's.
          assert.equal(await h.page.locator('[data-dayline-scroller]').count(), 0, where);
          await card.locator('[data-mobile-zoom-option="fit"]').click();

          // The track: 340px in view, scrolling down, never across.
          const scroller = await h.page
            .locator('[data-timeline-mobile-scroller]')
            .evaluate((el) => ({
              h: el.clientHeight,
              y: getComputedStyle(el).overflowY,
              x: getComputedStyle(el).overflowX,
              taller: el.scrollHeight > el.clientHeight,
            }));
          assert.deepEqual(scroller, { h: 340, y: 'auto', x: 'hidden', taller: true }, where);

          // The legend and the YOU figure: the API's minutes.
          // The design's short figure, as the desktop legend prints it (LAI-510).
          assert.match(await card.locator('[data-mobile-stat="confirmed"]').innerText(), /\b1h$/);
          assert.equal(await card.locator('[data-mobile-you-work]').innerText(), '6h 10m');

          // A long block has all three lines: the key and its length, the range, the title.
          const d1 = card.locator('[data-mobile-block="d1"]');
          assert.equal(await d1.locator('.tlm-text').innerText(), 'LAI-11');
          assert.equal(await d1.locator('[data-mobile-dur]').innerText(), '1h 35m');
          assert.match(await d1.locator('[data-mobile-range]').innerText(), /8:40.*10:15/);
          assert.equal(await d1.locator('[data-mobile-title]').innerText(), 'Search matches keys');
          // Half an hour at Fit is 49px: the range, and no room for a title.
          const e2 = card.locator('[data-mobile-block="e2"]');
          assert.equal(await e2.locator('[data-mobile-range]').count(), 1, where);
          assert.equal(await e2.locator('[data-mobile-title]').count(), 0, where);

          // The columns: hours at the left, SIG, YOU, AGENTS 64px at the right.
          const track = await rect(h.page, '[data-timeline-mobile-track]');
          const block = await d1.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, right: r.right };
          });
          assert.ok(
            Math.abs(block.x - (track.x + 90)) <= 1,
            `${where}: YOU starts at ${String(block.x - track.x)}`,
          );
          assert.ok(
            Math.abs(track.x + track.w - 70 - block.right) <= 1,
            `${where}: YOU ends wrong`,
          );
          const signals = await card.locator('[data-mobile-signal]').evaluateAll((els) =>
            els.map((el) => ({
              kind: el.getAttribute('data-mobile-signal'),
              x: el.getBoundingClientRect().x,
            })),
          );
          assert.deepEqual(
            signals.map((s) => s.kind).sort(),
            ['commit', 'commit', 'prompt', 'prompt', 'prompt'],
            where,
          );
          for (const s of signals) {
            assert.ok(
              s.x >= track.x + 48 && s.x < track.x + 84,
              `${where}: a signal is outside SIG`,
            );
          }
          assert.equal(await card.locator('[data-mobile-prompts]').innerText(), '6');
          assert.equal(await card.locator('[data-mobile-commits]').innerText(), '3');
          const agent = await rect(h.page, '[data-mobile-agent]');
          assert.ok(
            Math.abs(agent.x - (track.x + track.w - 64)) <= 1,
            `${where}: AGENTS is not at the right`,
          );
          assert.equal(Math.round(agent.w), 64, where);

          // Fit folds the idle ends: before the first thing, and after the last on today.
          const folds = await card
            .locator('[data-mobile-fold]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('data-mobile-fold')));
          assert.deepEqual(folds, ['No activity', 'Later today'], where);
          assert.equal(
            await card.locator('[data-mobile-hour="7"]').count(),
            0,
            `${where}: 7 AM is folded`,
          );
          assert.equal(await card.locator('[data-mobile-hour="9"]').innerText(), '9 AM');
          const fit = (await rect(h.page, '[data-timeline-mobile-track]')).h;

          // 1×: nothing folded, the track taller, and half an hour has room for its title.
          await card.locator('[data-mobile-zoom-option="1"]').click();
          await soon(
            async () => (await card.locator('[data-mobile-fold]').count()) === 0,
            `${where}: 1× folds`,
          );
          const one = (await rect(h.page, '[data-timeline-mobile-track]')).h;
          assert.ok(one > fit, `${where}: 1× is not taller than Fit`);
          assert.equal(
            await e2.locator('[data-mobile-title]').innerText(),
            'Webhook retries back off',
          );
          // 2× is twice 1×'s pace: the track's minutes, without the padding, double.
          await card.locator('[data-mobile-zoom-option="2"]').click();
          await soon(
            async () => (await rect(h.page, '[data-timeline-mobile-track]')).h > one,
            `${where}: 2× is not taller than 1×`,
          );
          const two = (await rect(h.page, '[data-timeline-mobile-track]')).h;
          assert.ok(
            Math.abs((two - 20) / (one - 20) - 2) < 0.01,
            `${where}: 2× is ${String(two)}, 1× ${String(one)}`,
          );
          assert.equal(
            await card.locator('[data-mobile-zoom-option="2"]').getAttribute('aria-checked'),
            'true',
          );

          // Now: from the top of the day, Now brings the now line into the track's view.
          await h.page.locator('[data-timeline-mobile-scroller]').evaluate((el) => {
            el.scrollTop = 0;
          });
          await card.locator('[data-mobile-go-now]').click();
          await soon(async () => {
            const view = await rect(h.page, '[data-timeline-mobile-scroller]');
            const now = await rect(h.page, '[data-mobile-now]');
            return now.y >= view.y && now.y <= view.y + view.h;
          }, `${where}: Now did not bring now into view`);
          await card.locator('[data-mobile-zoom-option="fit"]').click();
          await shoot(h.page, `phone-${String(width)}-${theme}-timeline`);

          // A tap on a block opens the sheet on it.
          await d1.click();
          const drawer = h.page.locator('[data-myday-drawer]');
          await drawer.locator('[data-inspector-for="d1"]').waitFor({ timeout: 10_000 });
          assert.equal(await d1.getAttribute('aria-pressed'), 'true');
          await closeSheet(h);
          // A gap's, on the gap.
          await card.locator('[data-mobile-gap-start="750"]').click();
          await drawer.locator('[data-inspector="gap"]').waitFor({ timeout: 10_000 });
          await closeSheet(h);
          // An agent's, on Agent time.
          await card.locator('[data-mobile-agent]').first().click();
          await drawer.locator('.myday-drawer-cards').waitFor({ timeout: 10_000 });
          assert.match(await drawer.locator('.myday-drawer-title').innerText(), /Beside your day/);
          await closeSheet(h);

          // › walks the blocks and rings one without opening the sheet.
          await card.getByRole('button', { name: 'Next block' }).click();
          assert.equal(await card.locator('.tlm-picked').count(), 1, where);
          assert.equal(await drawer.count(), 0, `${where}: › opened the sheet`);

          assert.ok((await sideways(h.page)) <= 1, `${where}: the page scrolls sideways`);
        }
      } finally {
        await h.close();
      }
    });
  }

  void test('390 px: rows put the range and length under the label; the bulk bar wraps to two rows; the tabs scroll', async () => {
    const h = await phone(390);
    try {
      await h.page.locator('[data-day-tab="review"]').click();
      const row = h.page.locator('[data-settle-row="d1"]');
      await row.waitFor({ timeout: 10_000 });
      const label = await rect(h.page, '[data-settle-row="d1"] .myday-row-target');
      const under = await rect(h.page, '[data-settle-row="d1"] .myday-row-select');
      assert.ok(under.y >= label.y + label.h - 1, 'the range is not under the label');
      assert.ok(Math.abs(under.x - label.x) <= 1, 'the range is not under the label');
      // The range, a dot, the length: one line.
      const line = await row.locator('.myday-row-select').evaluate((el) => {
        const time = el.querySelector('.myday-row-time');
        const length = el.querySelector('.myday-row-minutes');
        return {
          time: time?.textContent ?? '',
          length: length?.textContent ?? '',
          dot: length === null ? '' : getComputedStyle(length, '::before').content,
          apart:
            time === null || length === null
              ? -1
              : Math.abs(time.getBoundingClientRect().top - length.getBoundingClientRect().top),
        };
      });
      assert.match(line.time, /8:40.*10:15/);
      assert.equal(line.length, '1 h 35 min');
      assert.equal(line.dot, '"·"');
      assert.ok(line.apart >= 0 && line.apart <= 2, 'the range and the length are not one line');
      assert.equal(await row.locator('.myday-source').isVisible(), false);

      await h.page.locator('[data-settle-row="d1"] .myday-check').check();
      await h.page.locator('[data-settle-row="d3"] .myday-check').check();
      const bulk = h.page.locator('.myday-bulk');
      await bulk.waitFor({ timeout: 5_000 });
      const confirm = await bulk.getByRole('button', { name: 'Confirm' }).boundingBox();
      const count = await bulk.locator('[data-bulk-count]').boundingBox();
      const rest = await bulk.getByRole('button', { name: 'Not work' }).boundingBox();
      assert.ok(confirm !== null && count !== null && rest !== null);
      assert.ok(
        Math.abs(confirm.y + confirm.height / 2 - (count.y + count.height / 2)) <= 4,
        'Confirm is not beside the count',
      );
      assert.ok(rest.y >= confirm.y + confirm.height, 'the bar is one row');
      assert.ok((await sideways(h.page)) <= 1, 'the page scrolls sideways');
      const tabs = await h.page
        .locator('.myday-tabs ul')
        .evaluate((el) => getComputedStyle(el).overflowX);
      assert.equal(tabs, 'auto');
      await shoot(h.page, 'phone-390-rows');
    } finally {
      await h.close();
    }
  });

  void test('1440 px: the desktop is unchanged — the horizontal Timeline, its header, no phone bar — and stays so after a phone', async () => {
    const h = await open(`/my-day?day=${TODAY}`, stub(), {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    });
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      const desktop = async (): Promise<void> => {
        await h.page.locator('[data-dayline-scroller]').waitFor({ timeout: 10_000 });
        assert.equal(await h.page.locator('[data-day-total]').isVisible(), true);
        assert.equal(await h.page.locator('.myday-week-days').isVisible(), true);
        assert.equal(await h.page.locator('[data-timeline-mobile]').count(), 0);
        assert.equal(await h.page.locator('[data-phone-head]').count(), 0);
        assert.equal(await h.page.locator('.myday-bar').count(), 0);
        assert.equal(await h.page.locator('.shell-head[data-myday-bar]').count(), 0);
        assert.equal(await h.page.locator('.myday-page[data-phone]').count(), 0);
      };
      for (const theme of THEMES) {
        await setTheme(h.page, theme);
        await desktop();
        await shoot(h.page, `phone-1440-${theme}`);
      }
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('[data-timeline-mobile]').waitFor({ timeout: 10_000 });
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await desktop();
    } finally {
      await h.close();
    }
  });
});
