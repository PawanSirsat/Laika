/**
 * My day's SIGNALS lane in a real browser (LAI-834, D-096): the day's prompts
 * as bars and commits as dots (LAI-883), each in the five minutes it fell in, above
 * the blocks — drawn only on a day the server sent them for, with its label
 * on its own row and "You" still on the blocks' row, in both themes.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';
import { at, TODAY, YESTERDAY, viewOf, weekData, weekStub } from './my-day-week.ts';

const SIGNAL_TIMES = {
  prompts: [
    [at(TODAY, 9, 10), 2],
    [at(TODAY, 14, 0), 1],
  ],
  commits: [[at(TODAY, 9, 40), 3]],
};

/** Today with its lane, yesterday as a board without it sends it, the day before empty. */
function stub(): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    signal_times: SIGNAL_TIMES,
  });
  return routes;
}

async function openDay(day: string): Promise<Harness> {
  const h = await open(`/my-day?day=${day}`, stub());
  await h.page.locator('.myday-week').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

/** The x of minute `m` of the day along the lane's track. */
async function xOf(page: Page, minute: number): Promise<number> {
  const track = page.locator('[data-dayline-track]');
  const box = await track.boundingBox();
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  assert.ok(box !== null, 'the lane has no box');
  return box.x + ((minute - from * 60) / ((to - from) * 60)) * box.width;
}

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  assert.ok(box !== null, `${what} has no box`);
  return box;
}

const middle = (b: { y: number; height: number }): number => b.y + b.height / 2;

/**
 * Where a label's text is drawn — not its box, which its padding stretches up
 * to the grid's top, so a box inside a row proves nothing either way.
 */
async function textBox(locator: Locator, what: string) {
  const box = await locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  assert.ok(box.height > 0, `${what} draws no text`);
  return box;
}

after(async () => {
  await closeBrowser();
});

void describe('the SIGNALS lane (LAI-834)', () => {
  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: prompts and commits sit in their five minutes, above the blocks`, async () => {
      const h = await openDay(TODAY);
      try {
        await setTheme(h.page, theme);
        const lane = h.page.locator('[data-signals-lane]');
        await lane.waitFor({ timeout: 10_000 });

        const marks = await h.page.locator('[data-signal]').evaluateAll((els) =>
          els.map((el) => ({
            kind: el.getAttribute('data-signal'),
            start: Number(el.getAttribute('data-signal-start')),
            title: el.getAttribute('title') ?? '',
            colour: getComputedStyle(el).backgroundColor,
          })),
        );
        assert.deepEqual(
          marks.map((m) => [m.kind, m.start]),
          [
            ['prompt', 9 * 60 + 10],
            ['prompt', 14 * 60],
            ['commit', 9 * 60 + 40],
          ],
        );
        assert.match(marks[0]?.title ?? '', /^2 prompts, /);
        assert.match(marks[2]?.title ?? '', /^3 commits, /);
        for (const m of marks) {
          assert.notEqual(m.colour, 'rgba(0, 0, 0, 0)', `a ${String(m.kind)} is drawn invisible`);
        }

        // Each mark is centred on the middle of its five minutes.
        for (const [i, start] of [9 * 60 + 10, 14 * 60, 9 * 60 + 40].entries()) {
          const box = await boxOf(h.page.locator('[data-signal]').nth(i), `mark ${String(i)}`);
          const want = await xOf(h.page, start + 2.5);
          assert.ok(
            Math.abs(box.x + box.width / 2 - want) <= 2,
            `mark ${String(i)} is at ${String(box.x + box.width / 2)}, not ${String(want)}`,
          );
        }

        // The lane is its own row, above the blocks' row, and each label is on its own row.
        const laneBox = await boxOf(lane, 'the lane');
        const rowBox = await boxOf(h.page.locator('.dayline-row'), 'the blocks’ row');
        assert.ok(laneBox.y + laneBox.height <= rowBox.y + 0.5, 'the lane overlaps the blocks');
        const signalsLabel = await textBox(
          h.page.locator('.dayline-label-signals'),
          'the Signals label',
        );
        const youLabel = await textBox(h.page.locator('.dayline-label-you'), 'the You label');
        assert.ok(
          middle(signalsLabel) >= laneBox.y && middle(signalsLabel) <= laneBox.y + laneBox.height,
          'Signals is not on the lane’s row',
        );
        assert.ok(
          youLabel.y >= rowBox.y && youLabel.y + youLabel.height <= rowBox.y + rowBox.height,
          'You is not on the blocks’ row',
        );
        // The lane opens scrolled to the first block, so where it is seen to start is
        // the scroller's edge, not the lane's own box.
        const seen = await boxOf(h.page.locator('[data-dayline-scroller]'), 'the scroller');
        assert.ok(
          signalsLabel.x + signalsLabel.width <= seen.x + 0.5,
          'the Signals label runs into the lane',
        );

        assert.equal(
          await lane.getAttribute('aria-label'),
          'Signals: 3 prompts and 3 commits, each in the five minutes it fell in',
        );
        // The lane's column names each kind with the day's total (LAI-883).
        const column = h.page.locator('.dayline-label-signals');
        assert.equal(await column.getByText('Prompts', { exact: true }).count(), 1);
        assert.equal(await column.getByText('Commits', { exact: true }).count(), 1);
        assert.equal(await column.locator('[data-prompt-total]').innerText(), '3');
        assert.equal(await column.locator('[data-commit-total]').innerText(), '3');
      } finally {
        await h.close();
      }
    });
  }

  void test('a day the server sent no times for has no lane, and You stays on its row', async () => {
    const h = await openDay(YESTERDAY);
    try {
      await h.page.locator('.dayline-row').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-signals-lane]').count(), 0);
      assert.equal(await h.page.locator('.dayline-label-signals').count(), 0);
      assert.equal(await h.page.locator('[data-prompt-total]').count(), 0);
      const youLabel = await textBox(h.page.locator('.dayline-label-you'), 'the You label');
      const rowBox = await boxOf(h.page.locator('.dayline-row'), 'the blocks’ row');
      assert.ok(
        youLabel.y >= rowBox.y && youLabel.y + youLabel.height <= rowBox.y + rowBox.height,
        'You is not on the blocks’ row',
      );
    } finally {
      await h.close();
    }
  });

  void test('on a phone the lane scrolls sideways with the blocks, never the page', async () => {
    const h = await open(`/my-day?day=${TODAY}`, stub(), {
      before: async (page) => page.setViewportSize({ width: 390, height: 844 }),
    });
    try {
      await h.page.locator('[data-signals-lane]').waitFor({ timeout: 20_000 });
      const pageWidth = await h.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(pageWidth <= 390, `the page is ${String(pageWidth)}px wide at 390`);
      const scroller = h.page.locator('[data-dayline-scroller]');
      const inside = await h.page
        .locator('[data-signals-lane]')
        .evaluate((lane, box) => box?.contains(lane) ?? false, await scroller.elementHandle());
      assert.equal(inside, true, 'the lane is not inside the timeline’s own scroller');
    } finally {
      await h.close();
    }
  });
});
