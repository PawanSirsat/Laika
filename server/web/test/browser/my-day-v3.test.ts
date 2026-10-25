/**
 * My day as the owner's "Laika App v3" design draws it (LAI-888), in a real
 * browser: the Timeline card's header figures, the hours along the top of
 * the track, the lane column's figures, Fit folding the idle hours, the
 * tooltip on a hovered block, ‹ › and ← → stepping along the blocks, and the
 * editor's agents tile — every figure from the stubbed response.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open } from './my-day-clock.ts';
import { zoomLevel, zoomTo } from './my-day-zoom.ts';
import { AGENT, at, TODAY, viewOf, weekData, weekStub } from './my-day-week.ts';

/** The agent at 9:00–9:10 on a card and 9:10–9:15 on none — inside d1 — and at 1 PM. */
const LANE = [
  [at(TODAY, 9, 0), 300, 300],
  [at(TODAY, 9, 5), 240, 240],
  [at(TODAY, 9, 10), 120, 0],
  [at(TODAY, 13, 0), 180, 180],
];

const SIGNAL_TIMES = {
  prompts: [
    [at(TODAY, 9, 10), 2],
    [at(TODAY, 14, 0), 1],
  ],
  commits: [[at(TODAY, 9, 40), 3]],
};

function stub(): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    agent: { ...AGENT, lane: LANE },
    signal_times: SIGNAL_TIMES,
  });
  return routes;
}

async function openToday(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub());
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-agents-lane]').waitFor({ timeout: 10_000 });
  return h;
}

/** The design's compact figure (`timeline-core.js`' `dur`): `2h 10m`, `35m`, `1h` (LAI-512). */
const dur = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${String(m)}m` : m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
};

/** The legend's compact figure, as the design's Timeline prints it (LAI-512): `1h 35m`, `35m`. */
const cmp = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${String(m)}m` : m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
};

/**
 * Hover something on the track: scrolled into view first and settled a frame,
 * because a scroll clears the tooltip (the thing under the pointer moved) and
 * Playwright's own scroll-then-hover would otherwise lose it a frame later.
 */
async function hoverOnTrack(h: Harness, selector: string): Promise<void> {
  const el = h.page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await h.page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await el.hover();
}

const pressed = async (h: Harness, id: string): Promise<boolean> =>
  (await h.page.locator(`[data-block-select="${id}"]`).getAttribute('aria-pressed')) === 'true';

after(async () => {
  await closeBrowser();
});

void describe('the Timeline card (LAI-888, the v3 design)', () => {
  void test('its header carries the day in minutes, the hours run along the top, and the column names each lane with its figure', async () => {
    const h = await openToday();
    try {
      // Confirmed 30 + 30; drafted on a card 95 + 110 + 25; on nothing 40 + 40; gaps 25 + 10 + 30 + 40.
      const figure = async (stat: string): Promise<string> =>
        (await h.page.locator(`[data-stat="${stat}"] strong`).innerText()).trim();
      assert.equal(await figure('confirmed'), cmp(60));
      assert.equal(await figure('drafted'), cmp(230));
      assert.equal(await figure('needs-card'), cmp(80));
      assert.equal(await figure('gaps'), cmp(105));
      // The legend's words are the design's; the gaps' count is in the button's title (LAI-512).
      const legend = await h.page.locator('.dayline-totals').innerText();
      assert.match(legend, /Confirmed[\s\S]*Drafted[\s\S]*No task yet[\s\S]*Gaps/);
      assert.doesNotMatch(legend, /unaccounted|Needs a card/);
      assert.match(
        (await h.page.locator('[data-stat="gaps"]').getAttribute('title')) ?? '',
        /4 unaccounted/,
      );

      const axis = await h.page.locator('.dayline-axis').boundingBox();
      const row = await h.page.locator('.dayline-row').boundingBox();
      const signals = await h.page.locator('[data-signals-lane]').boundingBox();
      assert.ok(axis !== null && row !== null && signals !== null);
      assert.ok(axis.y + axis.height <= signals.y + 0.5, 'the hours are not above the lanes');
      assert.ok(
        signals.y + signals.height <= row.y + 0.5,
        'the signals lane is not above the blocks',
      );
      // No one hour but 9 AM by name: the now pill hides the hour it sits on.
      const hours = await h.page.locator('.dayline-axis-hour').allInnerTexts();
      assert.ok(
        hours.includes('9 AM') && hours.some((t) => t.endsWith(' PM')),
        `hours: ${hours.join(', ')}`,
      );

      assert.equal((await h.page.locator('[data-you-work]').innerText()).trim(), dur(370));
      assert.match(
        await h.page.locator('.dayline-label-you').innerText(),
        new RegExp(`of work · ${dur(60)} confirmed`),
      );
      assert.equal((await h.page.locator('[data-prompt-total]').innerText()).trim(), '3');
      assert.equal((await h.page.locator('[data-commit-total]').innerText()).trim(), '3');
      // Marks: the drafts' own, summed (d3 carries one).
      assert.equal((await h.page.locator('[data-mark-total]').innerText()).trim(), '1');
      assert.equal((await h.page.locator('[data-agent-work]').innerText()).trim(), '14 min');
      assert.equal(
        (await h.page.locator('[data-agent-on-card]').innerText()).trim(),
        '12 min on a card',
      );
      assert.match(
        await h.page.locator('.dayline-label-agents').innerText(),
        /Beside your day\. Never added to your hours\./,
      );
      // No footer (the design embeds the card with `no-footer`, LAI-512): the keys are the sheet's.
      assert.equal(await h.page.locator('.dayline-foot, .dayline-keys').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the card spans the page beside the drawer, and today opens with now in view (LAI-889, LAI-511)', async () => {
    const h = await openToday();
    try {
      // At 1×, now sits about three fifths of the way across the scroller —
      // measured before anything is picked, as the day opens (LAI-511).
      const seen = await h.page.locator('[data-dayline-scroller]').evaluate((el) => ({
        left: el.scrollLeft,
        width: el.clientWidth,
      }));
      const now = await h.page
        .locator('[data-now]')
        .evaluate((el) => (el as HTMLElement).offsetLeft);
      assert.ok(seen.left > 0, 'the scroller did not move');
      assert.ok(
        Math.abs(now - seen.left - seen.width * 0.6) <= 2,
        `now at ${String(now - seen.left)} of ${String(seen.width)}`,
      );
      await h.page.locator('[data-block-select]').first().click();
      const drawer = h.page.locator('[data-myday-drawer]');
      await drawer.waitFor({ timeout: 5_000 });
      const card = await h.page.locator('[data-dayline]').boundingBox();
      const main = await h.page.locator('.myday-main').boundingBox();
      const side = await drawer.boundingBox();
      assert.ok(card !== null && main !== null && side !== null);
      assert.ok(card.y + card.height <= main.y + 0.5, 'the Timeline is not above the lists');
      assert.ok(card.width >= main.width - 1, 'the Timeline is narrower than the page');
      assert.ok(side.x >= card.x + card.width - 0.5, 'the drawer is not beside the Timeline');
    } finally {
      await h.close();
    }
  });

  void test('Fit folds the idle hours before the first block and after now, and says so', async () => {
    const h = await openToday();
    try {
      // Wide enough that the morning before 8:40 makes room when folded: a
      // fold narrower than its stretch would be stays open (`buildScale`).
      await h.page.setViewportSize({ width: 1600, height: 900 });
      await zoomTo(h.page, 'fit');
      await until(async () => (await h.page.locator('[data-fold]').count()) >= 1);
      const track = h.page.locator('[data-dayline-track]');
      const from = Number(await track.getAttribute('data-from-hour'));
      // The morning before 8:40 is folded, and it starts where the axis does.
      const first = h.page.locator('[data-fold]').first();
      assert.equal(await first.getAttribute('data-fold'), String(from * 60));
      const label = h.page.locator('.dayline-fold-label').first();
      assert.match(
        (await label.getAttribute('aria-label')) ?? '',
        /^No activity, .+8:40 AM, folded$/,
      );
      assert.equal(
        (await h.page.locator('[data-axis-note]').innerText()).trim(),
        'Idle hours folded',
      );
      // Folded, the whole day fits: the track is no wider than its scroller.
      const over = await h.page
        .locator('[data-dayline-scroller]')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(over <= 1, `the track overflows Fit by ${String(over)}px`);
      // Every block is still placed and the first is still clickable.
      assert.equal(await h.page.locator('[data-block-id]').count(), 6);
      await h.page.locator('[data-block-select="d1"]').click();
      assert.equal(await pressed(h, 'd1'), true);
      // 1× is linear again: nothing folded, and 160 px an hour.
      await zoomTo(h.page, 1);
      await until(async () => (await h.page.locator('[data-fold]').count()) === 0);
      const to = Number(await track.getAttribute('data-to-hour'));
      const width = await track.evaluate((el) => el.getBoundingClientRect().width);
      assert.equal(Math.round(width), (to - from) * 160);
    } finally {
      await h.close();
    }
  });

  // D-113 replaced LAI-890's − and + and the Fit · 1× · 2× presets with one
  // Time zoom slider: its keys walk the same levels, and Fit is its least value.
  void test('the Time zoom slider walks the scale from Fit to 5× by its keys, keeping the middle of the view (LAI-890, D-113)', async () => {
    const h = await openToday();
    try {
      const track = h.page.locator('[data-dayline-track]');
      const hours =
        Number(await track.getAttribute('data-to-hour')) -
        Number(await track.getAttribute('data-from-hour'));
      const widthOf = () => track.evaluate((el) => el.getBoundingClientRect().width);
      const middle = () =>
        h.page.locator('[data-dayline-scroller]').evaluate((el) => {
          const box = el.getBoundingClientRect();
          const rail = el.querySelector('[data-dayline-track]')?.getBoundingClientRect();
          return rail === undefined ? 0 : (box.left + box.width / 2 - rail.left) / rail.width;
        });
      const slider = h.page.getByRole('slider', { name: 'Time zoom' });
      assert.equal(await zoomLevel(h.page), '1');
      assert.equal(await slider.inputValue(), '0');
      // Nothing selected is in view at now, so the slider keeps the middle.
      const before = await middle();
      await slider.focus();
      await h.page.keyboard.press('ArrowRight');
      await until(async () => (await zoomLevel(h.page)) === '1.5');
      assert.equal(Math.round(await widthOf()), hours * 240);
      // The minute at the middle stayed: the same share of the day, within a minute or two.
      assert.ok(Math.abs((await middle()) - before) * hours * 60 <= 2, 'the middle moved');
      // The slider shows the scale: a hundredth of a doubling, so 1.5× is 58.
      assert.equal(await slider.inputValue(), String(Math.round(Math.log2(1.5) * 100)));
      assert.equal(await slider.getAttribute('aria-valuetext'), '1.5×');
      await h.page.keyboard.press('ArrowRight');
      await until(async () => (await zoomLevel(h.page)) === '2');
      assert.equal(await slider.inputValue(), '100');
      // End is 5×, and past it there is no further in.
      await h.page.keyboard.press('End');
      await until(async () => (await zoomLevel(h.page)) === '5');
      assert.equal(Math.round(await widthOf()), hours * 800);
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await zoomLevel(h.page), '5');
      assert.equal(await slider.inputValue(), await slider.getAttribute('max'));
      // ← walks back the same levels.
      await h.page.keyboard.press('ArrowLeft');
      await until(async () => (await zoomLevel(h.page)) === '4');
      // Home is Fit: the slider's least value, the whole day in its box, and the button says so.
      await h.page.keyboard.press('Home');
      await until(async () => (await zoomLevel(h.page)) === 'fit');
      assert.equal(await slider.inputValue(), await slider.getAttribute('min'));
      assert.equal(await slider.getAttribute('aria-valuetext'), 'Fit day');
      assert.equal(await h.page.locator('[data-fit-day]').getAttribute('aria-pressed'), 'true');
      const over = await h.page
        .locator('[data-dayline-scroller]')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(over <= 1, `Fit overflows by ${String(over)}px`);
      // From Fit, ← does nothing and → is the first step past it.
      await h.page.keyboard.press('ArrowLeft');
      assert.equal(await zoomLevel(h.page), 'fit');
      await h.page.keyboard.press('ArrowRight');
      await until(async () => (await zoomLevel(h.page)) !== 'fit');
      // Fit day from anywhere.
      await zoomTo(h.page, 2);
      await zoomTo(h.page, 'fit');
      assert.equal(await h.page.locator('[data-fit-day]').getAttribute('aria-pressed'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('the slider keeps a selected block where it is on screen while it is in view (D-113)', async () => {
    const h = await openToday();
    try {
      // d3 1:00–2:50 PM, picked; in view at now (3 PM, three fifths across).
      await h.page.locator('[data-block-select="d3"]').click();
      await h.page.locator('[data-myday-drawer]').waitFor({ timeout: 5_000 });
      assert.equal(await pressed(h, 'd3'), true);
      // The drawer beside the day narrows the Timeline: measure once it has.
      await h.page.evaluate(async () => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished),
        );
      });
      const leftOf = async () =>
        (await h.page.locator('[data-block-id="d3"]').boundingBox())?.x ?? Number.NaN;
      const centreOf = async () => {
        const box = await h.page.locator('[data-block-id="d3"]').boundingBox();
        return box === null ? Number.NaN : box.x + box.width / 2;
      };
      assert.ok(Number.isFinite(await leftOf()), 'd3 is not drawn');
      const before = await centreOf();
      await zoomTo(h.page, 2);
      assert.ok(Math.abs((await centreOf()) - before) <= 2, 'the selected block moved on screen');
      await zoomTo(h.page, 1.5);
      assert.ok(Math.abs((await centreOf()) - before) <= 2, 'the selected block moved on screen');
    } finally {
      await h.close();
    }
  });

  // D-113 took away LAI-891's grip and the column's row-height slider: the row
  // is as tall as what it holds, and the column still follows it.
  void test('the row is as tall as it needs, with no grip and no row-height slider, the column beside it rule for rule (D-113)', async () => {
    const h = await openToday();
    try {
      assert.equal(await h.page.locator('[data-row-grip], [data-row-slider]').count(), 0);
      assert.equal(await h.page.getByText('drag to resize rows').count(), 0);
      // Box heights: the row is 28 above the blocks, the blocks, and 14 under, its rule inside.
      const rowH = () =>
        h.page.locator('.dayline-row').evaluate((el) => el.getBoundingClientRect().height);
      const blockH = (id: string) =>
        h.page
          .locator(`[data-block-id="${id}"]`)
          .evaluate((el) => el.getBoundingClientRect().height);
      assert.equal(Math.round(await rowH()), 122);
      assert.equal(Math.round(await blockH('d1')), 80);
      assert.equal(Math.round(await blockH('e2')), 80, 'a confirmed block is not the row’s height');
      const labelH = await h.page
        .locator('.dayline-label-you')
        .evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(
        Math.abs((await rowH()) - labelH) <= 0.5,
        `the column did not follow: ${String(labelH)} vs ${String(await rowH())}`,
      );
      // Nothing scrolls down on a day this short: the lanes fit their box.
      const down = await h.page
        .locator('[data-dayline-grid]')
        .evaluate((el) => el.scrollHeight - el.clientHeight);
      assert.ok(down <= 1, `the lanes scroll down by ${String(down)}px`);
    } finally {
      await h.close();
    }
  });

  void test('hovering a block, a gap or an agent run says what it is, when and how long — counts only', async () => {
    const h = await openToday();
    try {
      await hoverOnTrack(h, '[data-block-id="d1"]');
      const tip = h.page.locator('[role="tooltip"]');
      await tip.waitFor({ timeout: 5_000 });
      const said = await tip.innerText();
      assert.match(said, /Drafted/);
      assert.match(said, /LAI-11/);
      assert.match(said, /8:40–10:15 AM/);
      assert.match(said, /1 h 35 min/);
      assert.match(said, /18 prompts · 3 commits · 0 marks/);
      assert.match(said, /worked 11 min, 9 min of it on a card/);
      assert.equal(await tip.getAttribute('data-dayline-tip'), 'block');

      await hoverOnTrack(h, '.dayline-gap');
      await until(async () => (await tip.getAttribute('data-dayline-tip')) === 'gap');
      assert.match(await tip.innerText(), /Gap[\s\S]*No activity · click to fill/);

      await hoverOnTrack(h, '[data-agent-run]');
      await until(async () => (await tip.getAttribute('data-dayline-tip')) === 'agent');
      assert.match(await tip.innerText(), /Agent working[\s\S]*Not counted/);

      // Off the card, it goes.
      await h.page.locator('.myday-tabs').hover();
      await until(async () => (await tip.count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('‹ › and ← → step the selection along every placed block', async () => {
    const h = await openToday();
    try {
      // The day's placed blocks, in order: d1 8:40, d2 10:40, e1 11:30, e2 12:00, d3 1:00, d4 3:30.
      await h.page.locator('[data-block-select="d1"]').click();
      assert.equal(await pressed(h, 'd1'), true);
      await h.page.getByRole('button', { name: 'Next block' }).click();
      await until(() => pressed(h, 'd2'));
      await h.page.keyboard.press('ArrowRight');
      await until(() => pressed(h, 'e1'));
      assert.equal(await h.page.locator('[data-inspector="entry"]').count(), 1);
      await h.page.keyboard.press('ArrowLeft');
      await until(() => pressed(h, 'd2'));
      await h.page.getByRole('button', { name: 'Previous block' }).click();
      await until(() => pressed(h, 'd1'));
      // The arrows never fire while typing.
      await h.page.locator('[data-inspector-for="d1"]').getByLabel('Length, typed').fill('');
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await pressed(h, 'd1'), true);
    } finally {
      await h.close();
    }
  });

  void test('the editor counts the agent runs inside the block and says how long they worked', async () => {
    const h = await openToday();
    try {
      await h.page.locator('[data-block-select="d1"]').click();
      const editor = h.page.locator('[data-inspector-for="d1"]');
      await editor.waitFor({ timeout: 5_000 });
      const tiles = await editor.locator('.editor-tile span').allInnerTexts();
      assert.deepEqual(tiles, ['prompts', 'commits', 'marks', 'agents']);
      assert.equal((await editor.locator('[data-count="agents"]').innerText()).trim(), '2');
      assert.match(
        await editor.locator('[data-agent-line]').innerText(),
        /^During this time an agent worked 11 min, 9 min of it on a card\./,
      );
      // The pill reads *Draft*, as the design has it (LAI-504).
      assert.match(await editor.locator('.inspector-kind').innerText(), /Draft/);
      // A block no agent ran in says so.
      await h.page.locator('[data-block-select="d4"]').click();
      await until(async () => (await h.page.locator('[data-inspector-for="d4"]').count()) === 1);
      const d4 = h.page.locator('[data-inspector-for="d4"]');
      assert.equal((await d4.locator('[data-count="agents"]').innerText()).trim(), '0');
      assert.match(
        await d4.locator('[data-agent-line]').innerText(),
        /^No agent ran in this time\./,
      );
      assert.match(await d4.locator('.inspector-kind').innerText(), /No task yet/);
    } finally {
      await h.close();
    }
  });

  void test('on a phone, in both themes, the lane column folds away and the figures stay in the header', async () => {
    const h = await openToday();
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        assert.equal(await h.page.locator('.dayline-labels').isVisible(), false);
        // The phone's Timeline is the vertical one (LAI-518); its legend has the figure.
        assert.equal(
          (await h.page.locator('[data-mobile-stat="confirmed"] strong').innerText()).trim(),
          dur(60),
        );
        const sideways = await h.page.evaluate(() => {
          const main = document.querySelector('.shell-main') ?? document.scrollingElement;
          return main === null ? 0 : main.scrollWidth - main.clientWidth;
        });
        assert.ok(sideways <= 1, `${theme}: the page scrolls sideways by ${String(sideways)}px`);
      }
    } finally {
      await h.close();
    }
  });
});
