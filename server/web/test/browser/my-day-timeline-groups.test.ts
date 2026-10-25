/**
 * My day's Timeline as D-113 draws it (LAI-300): one *Time zoom* slider, *Fit
 * day* and *Expand all*; a crowded stretch as one group with its count, which
 * opens in place into readable lanes and grows the Timeline, scrolling inside
 * its own box under a ruler that stays in view; pinch or Ctrl + wheel zooming
 * around the pointer's minute and Shift + wheel panning; and a drag that is
 * never a click and maps the pointer to the right minute at any zoom and any
 * scroll, even one made mid-drag.
 *
 * **Nothing here writes but a drag.** Every zoom, open, close and Fit is
 * checked against every request the page made (`h.calls`) and against the
 * day's totals in the header, before and after.
 *
 * The crowded day: s1 9:00–10:00 alone; p1 and p2 at once from 10:00; twelve
 * hour-long blocks a minute apart from 11:00 (c01–c12); five half-hours a
 * minute apart from 1 PM (f1–f5); a confirmed entry at 4 PM; signals and an
 * agent lane, so the lanes are tall enough to scroll once the twelve are
 * open. The sparse day: three blocks, nothing at once.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open } from './my-day-clock.ts';
import { zoomLevel, zoomTo } from './my-day-zoom.ts';
import {
  AGENT,
  ATLAS,
  CARD_A,
  CARD_B,
  CARD_C,
  SETTINGS,
  TODAY,
  at,
  weekData,
  weekStub,
  type Draft,
  type Entry,
} from './my-day-week.ts';

const CARDS = [CARD_A, CARD_B, CARD_C, null] as const;

/** A collector's block, `minutes` long from `h:m`. */
function block(id: string, h: number, m: number, minutes: number, i = 0): Draft {
  const started = at(TODAY, h, m);
  const card = CARDS[i % 4] ?? null;
  return {
    id,
    source: 'collector',
    day: TODAY,
    tz: 'UTC',
    started_at: started,
    ended_at: started + minutes * 60_000,
    minutes,
    task: card,
    task_key: null,
    project: card === null ? null : ATLAS,
    general: false,
    signals: { prompts: 1, replies: 2, sessions: 1, commits: 0, marks: 0 },
    note: null,
  };
}

/** `n` blocks `minutes` long, a minute apart from `h:m`, all at the same time. */
const atOnce = (prefix: string, h: number, m: number, n: number, minutes: number): Draft[] =>
  Array.from({ length: n }, (_, i) =>
    block(`${prefix}${String(i + 1).padStart(n > 9 ? 2 : 1, '0')}`, h, m + i, minutes, i),
  );

const TWELVE = atOnce('c', 11, 0, 12, 60);
const FIVE = atOnce('f', 13, 0, 5, 30);
const CROWD = 'g-c01';
const SMALL = 'g-f1';

function entry(id: string, h: number, minutes: number): Entry {
  const started = at(TODAY, h, 0);
  return {
    id,
    day: TODAY,
    tz: 'UTC',
    started_at: started,
    ended_at: started + minutes * 60_000,
    minutes,
    source: 'manual',
    task: null,
    project: null,
    note: 'Planning call',
    revision: 1,
    created_at: 1,
    updated_at: 1,
  };
}

function stub(crowded: boolean): ApiStub {
  const drafts = crowded
    ? [
        block('s1', 9, 0, 60),
        block('p1', 10, 0, 30, 1),
        block('p2', 10, 5, 30, 2),
        ...TWELVE,
        ...FIVE,
      ]
    : [block('s1', 9, 0, 60), block('s2', 11, 0, 45, 1), block('s3', 13, 30, 30, 2)];
  const data = weekData();
  data.set(TODAY, { drafts, entries: [entry('e1', 16, 30)] });
  const routes: Record<string, unknown> = { ...weekStub(data) };
  const base = routes[`/api/v1/me/time?day=${TODAY}`] as () => Record<string, unknown>;
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...base(),
    signal_times: { prompts: [[at(TODAY, 9, 10), 2]], commits: [[at(TODAY, 9, 40), 1]] },
    agent: {
      ...AGENT,
      lane: [
        [at(TODAY, 9, 0), 300, 300],
        [at(TODAY, 9, 5), 240, 0],
      ],
    },
  });
  routes['/api/v1/me/time-settings'] = SETTINGS;
  // The drag's write, answered so the page carries on; the stub keeps the day as it was.
  routes['/api/v1/me/time-drafts/s1'] = { id: 's1' };
  return routes;
}

async function openDay(crowded: boolean, width = 1440): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(crowded), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-block-id]').first().waitFor({ timeout: 10_000 });
  return h;
}

/** Every request but a read: a zoom, an open or a close must never add one. */
const writes = (h: Harness): string[] =>
  h.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

/** The day's figures as the header and the YOU column show them. */
const totals = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-stat] strong, [data-you-work]')].map((el) =>
      (el.textContent ?? '').trim(),
    ),
  );

/**
 * Until every transition a resize started has finished: below 1280px the
 * sidebar folds over 160ms, and the Timeline's width with it.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished),
    );
  });
}

/** Two frames: whatever a click or a scroll set off has been drawn. */
const frames = (page: Page): Promise<unknown> =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

interface Box {
  readonly id: string;
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

const boxes = (page: Page): Promise<Box[]> =>
  page.locator('[data-block-id]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: (el as HTMLElement).dataset.blockId ?? '',
        l: r.left,
        r: r.right,
        t: r.top,
        b: r.bottom,
      };
    }),
  );

const overlapping = (all: readonly Box[]): string[] => {
  const found: string[] = [];
  for (const [i, a] of all.entries()) {
    for (const b of all.slice(i + 1)) {
      if (
        Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 &&
        Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
      ) {
        found.push(`${a.id} lies over ${b.id}`);
      }
    }
  }
  return found;
};

/** The minute of the day under page x `px`, from the track as drawn (linear at any multiple). */
async function minuteAt(page: Page, px: number): Promise<number> {
  const track = page.locator('[data-dayline-track]');
  const box = await track.boundingBox();
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  assert.ok(box !== null, 'the track has no box');
  return from * 60 + ((px - box.x) / box.width) * (to - from) * 60;
}

/** The page x of a minute of the day, from the track as drawn. */
async function xOf(page: Page, minute: number): Promise<number> {
  const track = page.locator('[data-dayline-track]');
  const box = await track.boundingBox();
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  assert.ok(box !== null, 'the track has no box');
  return box.x + ((minute - from * 60) / ((to - from) * 60)) * box.width;
}

/** Scroll the track so `minute` sits `inset` px in from the scroller's left edge. */
async function show(page: Page, minute: number, inset = 200): Promise<void> {
  const track = page.locator('[data-dayline-track]');
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  const width = await track.evaluate((el) => el.scrollWidth);
  const left = ((minute - from * 60) / ((to - from) * 60)) * width - inset;
  await page.locator('[data-dayline-scroller]').evaluate((el, px) => {
    el.scrollLeft = Math.max(0, px);
  }, left);
  await frames(page);
}

const scrollLeft = (page: Page): Promise<number> =>
  page.locator('[data-dayline-scroller]').evaluate((el) => el.scrollLeft);

/** The words of the drag's label once they match, or a failure saying what they were. */
async function settlesOn(page: Page, want: RegExp): Promise<void> {
  const words = (): Promise<string> =>
    page.evaluate(() => document.querySelector<HTMLElement>('[data-drag-label]')?.innerText ?? '');
  await until(async () => want.test(await words()));
  assert.match(await words(), want);
}

void after(async () => {
  await closeBrowser();
});

void describe('My day’s Timeline: crowded stretches as groups that open into lanes (D-113, LAI-300)', () => {
  void test('a crowded day at 1440 and 901, light and dark: counts, opening one and then a second, Expand all, Collapse all, Fit day — lanes never overlap, nothing is written and the totals hold', async () => {
    const h = await openDay(true);
    const problems: string[] = [];
    const check = (ok: boolean, problem: string): void => {
      if (!ok) problems.push(problem);
    };
    try {
      const before = await totals(h.page);
      for (const width of [1440, 901]) {
        await h.page.setViewportSize({ width, height: 900 });
        await settle(h.page);
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          const where = `${String(width)} px, ${theme}`;
          await zoomTo(h.page, 1);
          const expandAll = h.page.locator('[data-expand-all]');
          if ((await expandAll.getAttribute('aria-expanded')) === 'true') await expandAll.click();
          await until(async () => (await h.page.locator('[data-group-toggle]').count()) === 0);

          // Closed: two groups, each with its count, and none of their blocks drawn.
          const crowd = h.page.locator(`[data-group="${CROWD}"]`);
          const small = h.page.locator(`[data-group="${SMALL}"]`);
          check((await crowd.getAttribute('data-group-count')) === '12', `${where}: not 12`);
          check((await small.getAttribute('data-group-count')) === '5', `${where}: not 5`);
          check(
            /^12 tasks at once, 11:00 AM–12:11 PM/.test(
              (await crowd.getAttribute('aria-label')) ?? '',
            ),
            `${where}: the group does not say what it holds`,
          );
          check((await crowd.innerText()).includes('12 tasks'), `${where}: no "12 tasks" on it`);
          check((await crowd.getAttribute('aria-expanded')) === 'false', `${where}: not closed`);
          check(
            (await h.page.locator('[data-block-id^="c"], [data-block-id^="f"]').count()) === 0,
            `${where}: a closed group draws its blocks`,
          );
          // Its faint bars: one a block, inside the marker.
          check(
            (await crowd.locator('.dayline-group-bar').count()) === 12,
            `${where}: the preview is not one bar a block`,
          );
          // The two at once at 10:00 are lanes in the row, not a group.
          check(
            (await h.page.locator('[data-block-id="p1"], [data-block-id="p2"]').count()) === 2,
            `${where}: two at once were grouped`,
          );

          // A click opens the twelve in place, a Collapse control where the strip would be.
          // In view first: Playwright scrolls a target into view before it clicks.
          // 11 AM 40px in: both groups, 11:00 to 1:35 PM, are in view at 1×.
          await show(h.page, 11 * 60, 40);
          const scroll0 = await scrollLeft(h.page);
          await crowd.click();
          const toggle = h.page.locator(`[data-group-toggle="${CROWD}"]`);
          await toggle.waitFor({ timeout: 5_000 });
          check((await toggle.getAttribute('aria-expanded')) === 'true', `${where}: not open`);
          check((await toggle.innerText()).includes('Collapse'), `${where}: no Collapse`);
          check(
            (await h.page.locator('[data-block-id^="c"]').count()) === 12,
            `${where}: the open group does not draw its twelve`,
          );
          // Opening a second leaves the first open.
          await small.click();
          await h.page.locator(`[data-group-toggle="${SMALL}"]`).waitFor({ timeout: 5_000 });
          check((await toggle.count()) === 1, `${where}: opening the second closed the first`);
          check(
            (await h.page.locator('[data-block-id^="f"]').count()) === 5,
            `${where}: the second does not draw its five`,
          );
          // Every block has its own box, and an open lane is never under the readable minimum.
          const drawn = await boxes(h.page);
          for (const problem of overlapping(drawn)) check(false, `${where}: ${problem}`);
          for (const b of drawn.filter((d) => /^[cf]/.test(d.id))) {
            check(b.b - b.t >= 24, `${where}: ${b.id} is ${String(b.b - b.t)}px tall`);
          }
          // The row grew to hold them, and the column grew with it.
          const rowH = await h.page
            .locator('.dayline-row')
            .evaluate((el) => el.getBoundingClientRect().height);
          const labelH = await h.page
            .locator('.dayline-label-you')
            .evaluate((el) => el.getBoundingClientRect().height);
          check(rowH > 122 + 200, `${where}: the row did not grow (${String(rowH)}px)`);
          check(Math.abs(rowH - labelH) <= 0.5, `${where}: the column did not follow the row`);
          // Neither the zoom nor the scroll changed.
          check((await zoomLevel(h.page)) === '1', `${where}: opening a group zoomed`);
          check(Math.abs((await scrollLeft(h.page)) - scroll0) <= 1, `${where}: it scrolled`);

          // Its own Collapse closes it; the other stays open.
          await toggle.click();
          await crowd.waitFor({ timeout: 5_000 });
          check(
            (await h.page.locator(`[data-group-toggle="${SMALL}"]`).count()) === 1,
            `${where}: closing one closed the other`,
          );

          // Expand all, then Collapse all: one toggle, its words following its state.
          check((await expandAll.innerText()).trim() === 'Expand all', `${where}: not Expand all`);
          await expandAll.click();
          await until(async () => (await expandAll.getAttribute('aria-expanded')) === 'true');
          check((await expandAll.innerText()).trim() === 'Collapse all', `${where}: words`);
          check((await h.page.locator('[data-group]').count()) === 0, `${where}: one still closed`);
          check((await zoomLevel(h.page)) === '1', `${where}: Expand all zoomed`);
          check(Math.abs((await scrollLeft(h.page)) - scroll0) <= 1, `${where}: it scrolled`);
          await expandAll.click();
          await until(async () => (await h.page.locator('[data-group]').count()) === 2);
          check((await expandAll.innerText()).trim() === 'Expand all', `${where}: words`);

          // From the keyboard: Enter opens a group and hands the keyboard to its
          // Collapse; Space there closes it and hands it back.
          await crowd.focus();
          await h.page.keyboard.press('Enter');
          await toggle.waitFor({ timeout: 5_000 });
          check(
            await toggle.evaluate((el) => el === document.activeElement),
            `${where}: the keyboard was not handed to Collapse`,
          );
          await h.page.keyboard.press('Space');
          await crowd.waitFor({ timeout: 5_000 });
          check(
            await crowd.evaluate((el) => el === document.activeElement),
            `${where}: the keyboard was not handed back to the group`,
          );

          // Fit day: the whole day, every group closed, the selection kept.
          await crowd.click();
          await toggle.waitFor({ timeout: 5_000 });
          await h.page.locator('[data-block-select="c03"]').click();
          await until(
            async () =>
              (await h.page.locator('[data-block-select="c03"]').getAttribute('aria-pressed')) ===
              'true',
          );
          await zoomTo(h.page, 'fit');
          await until(async () => (await h.page.locator('[data-group]').count()) === 2);
          const over = await h.page
            .locator('[data-dayline-scroller]')
            .evaluate((el) => el.scrollWidth - el.clientWidth);
          check(over <= 1, `${where}: Fit day overflows by ${String(over)}px`);
          check(
            (await crowd.getAttribute('class'))?.includes('dayline-group-picked') === true,
            `${where}: the group holding the selection does not say so after Fit day`,
          );
          if ((await h.page.locator('[data-myday-drawer]').count()) > 0) {
            await h.page.keyboard.press('Escape');
          }

          check(
            JSON.stringify(await totals(h.page)) === JSON.stringify(before),
            `${where}: the totals changed`,
          );
          check(writes(h).length === 0, `${where}: something was written: ${writes(h).join(', ')}`);
        }
      }
      assert.deepEqual(problems, []);
    } finally {
      await h.close();
    }
  });

  void test('a sparse day at 1440 and 901, light and dark: no group, Expand all has nothing to do, the three controls and nothing else', async () => {
    const h = await openDay(false);
    try {
      const before = await totals(h.page);
      for (const width of [1440, 901]) {
        await h.page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          const where = `${String(width)} px, ${theme}`;
          assert.equal(await h.page.locator('[data-group], [data-group-toggle]').count(), 0, where);
          // s1, s2, s3 and the confirmed e1.
          assert.equal(await h.page.locator('[data-block-id]').count(), 4, where);
          const expandAll = h.page.locator('[data-expand-all]');
          assert.equal(await expandAll.isDisabled(), true, `${where}: Expand all is live`);
          const zooms = h.page.locator('.dayline-zooms');
          assert.equal(await zooms.getByRole('slider', { name: 'Time zoom' }).count(), 1, where);
          assert.equal(await zooms.getByText('Time zoom', { exact: true }).isVisible(), true);
          assert.deepEqual(
            await zooms.getByRole('button').evaluateAll((els) => els.map((el) => el.textContent)),
            ['Fit day', 'Expand all'],
          );
          await zoomTo(h.page, 'fit');
          await zoomTo(h.page, 2);
          await zoomTo(h.page, 1);
          assert.deepEqual(overlapping(await boxes(h.page)), [], where);
        }
      }
      assert.deepEqual(await totals(h.page), before);
      assert.deepEqual(writes(h), []);

      // Less motion asked for: Now scrolls there at once, not over a few frames.
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await h.page.emulateMedia({ reducedMotion: 'reduce' });
      await show(h.page, 6 * 60, 0);
      const from = await scrollLeft(h.page);
      await h.page.locator('.dayline-tool-now').click();
      await frames(h.page);
      const first = await scrollLeft(h.page);
      await h.page.waitForTimeout(400);
      assert.ok(
        first > from + 100,
        `Now did not scroll at once (${String(from)} → ${String(first)})`,
      );
      assert.equal(await scrollLeft(h.page), first, 'Now kept scrolling after the first frame');
    } finally {
      await h.close();
    }
  });

  for (const width of [1440, 901]) {
    void test(`${String(width)} px: open, the lanes scroll down inside the Timeline under a ruler that stays in view, and at the bottom the wheel scrolls the page`, async () => {
      const h = await openDay(true, width);
      try {
        await zoomTo(h.page, 1);
        await h.page.locator('[data-expand-all]').click();
        await until(async () => (await h.page.locator('[data-group]').count()) === 0);
        const grid = h.page.locator('[data-dayline-grid]');
        const room = await grid.evaluate((el) => el.scrollHeight - el.clientHeight);
        assert.ok(room > 60, `the open lanes do not need to scroll (${String(room)}px)`);
        // Bring the Timeline into view at the top of the page, with room below it.
        await h.page.evaluate(() => {
          const main = document.querySelector<HTMLElement>('.shell-main');
          const card = document.querySelector<HTMLElement>('[data-dayline]');
          if (main !== null && card !== null) {
            main.scrollTop += card.getBoundingClientRect().top - 20;
          }
        });
        const pageTop = () =>
          h.page.evaluate(
            () => (document.querySelector('.shell-main')?.scrollTop ?? 0) + window.scrollY,
          );
        const box = await grid.boundingBox();
        assert.ok(box !== null);
        const row = await h.page.locator('.dayline-row').boundingBox();
        assert.ok(row !== null);
        const px = box.x + box.width * 0.6;
        const py = Math.min(box.y + box.height - 20, row.y + 60);
        await h.page.mouse.move(px, py);

        // A plain wheel scrolls the lanes, not the page, while they can go.
        const page0 = await pageTop();
        await h.page.mouse.wheel(0, 120);
        await until(async () => (await grid.evaluate((el) => el.scrollTop)) > 40);
        assert.ok(Math.abs((await pageTop()) - page0) <= 1, 'the page moved under the lanes');
        await frames(h.page);
        // The ruler and the column's corner stayed at the top, solid over the lanes.
        const g = await grid.boundingBox();
        const axis = await h.page.locator('.dayline-axis').boundingBox();
        const note = await h.page.locator('[data-axis-note]').boundingBox();
        assert.ok(g !== null && axis !== null && note !== null);
        assert.ok(Math.abs(axis.y - g.y) <= 2, `the ruler is at ${String(axis.y - g.y)}px`);
        assert.ok(Math.abs(note.y - g.y) <= 2, `the column's corner is at ${String(note.y - g.y)}`);
        assert.notEqual(
          await h.page
            .locator('.dayline-axis')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
          'rgba(0, 0, 0, 0)',
          'the ruler lets the lanes show through',
        );
        const hour = await h.page.locator('.dayline-axis-hour').first().boundingBox();
        assert.ok(hour !== null && hour.y >= g.y && hour.y + hour.height <= g.y + 30, 'no hour');
        // The labels stay beside their lanes while the track scrolls sideways.
        const label0 = await h.page.locator('.dayline-label-you').boundingBox();
        await show(h.page, 15 * 60);
        const label1 = await h.page.locator('.dayline-label-you').boundingBox();
        assert.ok(label0 !== null && label1 !== null);
        assert.ok(Math.abs(label0.x - label1.x) <= 0.5, 'the column scrolled sideways');

        // At the bottom of the lanes the wheel is the page's.
        await grid.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await frames(h.page);
        const pageRoom = await h.page.evaluate(() => {
          const main = document.querySelector<HTMLElement>('.shell-main');
          return main === null ? 0 : main.scrollHeight - main.clientHeight - main.scrollTop;
        });
        assert.ok(pageRoom > 60, `the page has no room to scroll (${String(pageRoom)}px)`);
        const page1 = await pageTop();
        await h.page.mouse.move(px, py);
        for (let i = 0; i < 6; i += 1) await h.page.mouse.wheel(0, 240);
        await until(async () => (await pageTop()) - page1 > 40, 3_000);
        assert.ok((await pageTop()) - page1 > 40, 'the wheel at the bottom did not move the page');
        assert.deepEqual(writes(h), []);
      } finally {
        await h.close();
      }
    });

    void test(`${String(width)} px: Ctrl + wheel zooms around the pointer’s minute, in and out, and Shift + wheel pans — nothing written, the totals hold`, async () => {
      const h = await openDay(true, width);
      try {
        const before = await totals(h.page);
        await zoomTo(h.page, 1);
        const scroller = h.page.locator('[data-dayline-scroller]');
        const box = await scroller.boundingBox();
        const row = await h.page.locator('.dayline-row').boundingBox();
        assert.ok(box !== null && row !== null);
        const px = box.x + box.width * 0.4;
        const py = row.y + 10;
        await h.page.mouse.move(px, py);
        const minute0 = await minuteAt(h.page, px);

        await h.page.keyboard.down('Control');
        await h.page.mouse.wheel(0, -100);
        await h.page.keyboard.up('Control');
        await until(async () => Number(await zoomLevel(h.page)) > 1.1);
        await frames(h.page);
        const zoomed = Number(await zoomLevel(h.page));
        const minute1 = await minuteAt(h.page, px);
        assert.ok(
          Math.abs(minute1 - minute0) < 2,
          `in: the minute under the pointer moved ${String(minute1 - minute0)} min (zoom ${String(zoomed)})`,
        );
        // The slider shows the zoom a wheel made.
        assert.equal(
          await h.page.locator('[data-zoom-slider]').inputValue(),
          String(Math.round(Math.log2(zoomed) * 100)),
        );

        await h.page.keyboard.down('Control');
        await h.page.mouse.wheel(0, 100);
        await h.page.keyboard.up('Control');
        await until(async () => Number(await zoomLevel(h.page)) < zoomed - 0.1);
        await frames(h.page);
        const minute2 = await minuteAt(h.page, px);
        const out = await zoomLevel(h.page);
        assert.ok(
          Math.abs(minute2 - minute0) < 2,
          `out: the minute under the pointer moved ${String(minute2 - minute0)} min`,
        );

        // Shift + wheel pans sideways.
        const left0 = await scrollLeft(h.page);
        await h.page.keyboard.down('Shift');
        await h.page.mouse.wheel(0, 200);
        await h.page.keyboard.up('Shift');
        await until(async () => (await scrollLeft(h.page)) > left0 + 50);
        assert.equal(await zoomLevel(h.page), out, 'Shift + wheel zoomed');

        assert.deepEqual(await totals(h.page), before);
        assert.deepEqual(writes(h), []);
      } finally {
        await h.close();
      }
    });
  }

  void test('a drag at 1× and 2×, from a scrolled track and with a scroll mid-drag, saves the times it says; zoom waits; a drag across a group never opens or closes it', async () => {
    const h = await openDay(true);
    try {
      const saved = () =>
        h.calls
          .filter((c) => c.method === 'PATCH' && c.path === '/api/v1/me/time-drafts/s1')
          .map((c) => c.body);
      const y = async (): Promise<number> => {
        const b = await h.page.locator('[data-block-select="s1"]').boundingBox();
        assert.ok(b !== null, 's1 has no box');
        return b.y + b.height / 2;
      };

      // The twelve open first: every write below reloads the day, and an open group stays open.
      await zoomTo(h.page, 1);
      await h.page.locator(`[data-group="${CROWD}"]`).click();
      await h.page.locator(`[data-group-toggle="${CROWD}"]`).waitFor({ timeout: 5_000 });

      // 1×, scrolled so 9 AM is 200px in: s1 9:00–10:00 by +30 min.
      await show(h.page, 9 * 60);
      assert.ok((await scrollLeft(h.page)) > 0, 'the track is not scrolled');
      await h.page.mouse.move(await xOf(h.page, 9 * 60 + 30), await y());
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 10 * 60), await y(), { steps: 8 });
      await settlesOn(h.page, /^9:30–10:30 AM · /);
      await h.page.mouse.up();
      await until(() => saved().length === 1);
      assert.deepEqual(saved()[0], {
        minutes: 60,
        started_at: at(TODAY, 9, 30),
        ended_at: at(TODAY, 10, 30),
      });
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });

      // 2×, scrolled elsewhere: by −45 min.
      await zoomTo(h.page, 2);
      await show(h.page, 8 * 60, 120);
      assert.ok((await scrollLeft(h.page)) > 0, 'the track is not scrolled');
      await h.page.mouse.move(await xOf(h.page, 9 * 60 + 30), await y());
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 8 * 60 + 45), await y(), { steps: 8 });
      await settlesOn(h.page, /^8:15–9:15 AM · /);
      // Ctrl + wheel mid-drag does not zoom: the block in hand cannot jump.
      await h.page.keyboard.down('Control');
      await h.page.mouse.wheel(0, -100);
      await h.page.keyboard.up('Control');
      await frames(h.page);
      await frames(h.page);
      assert.equal(await zoomLevel(h.page), '2', 'a drag in flight zoomed');
      await settlesOn(h.page, /^8:15–9:15 AM · /);
      await h.page.mouse.up();
      await until(() => saved().length === 2);
      assert.deepEqual(saved()[1], {
        minutes: 60,
        started_at: at(TODAY, 8, 15),
        ended_at: at(TODAY, 9, 15),
      });
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });

      // 1×, the track scrolled an hour under a still pointer mid-drag: the block
      // goes with the track, 20 min by the pointer and 60 by the scroll.
      await zoomTo(h.page, 1);
      await show(h.page, 9 * 60);
      await h.page.mouse.move(await xOf(h.page, 9 * 60 + 30), await y());
      await h.page.mouse.down();
      const x20 = await xOf(h.page, 9 * 60 + 50);
      await h.page.mouse.move(x20, await y(), { steps: 6 });
      await settlesOn(h.page, /^9:20–10:20 AM · /);
      await h.page.locator('[data-dayline-scroller]').evaluate((el) => {
        el.scrollLeft += 160;
      });
      await settlesOn(h.page, /^10:20–11:20 AM · /);
      await h.page.mouse.up();
      await until(() => saved().length === 3);
      assert.deepEqual(saved()[2], {
        minutes: 60,
        started_at: at(TODAY, 10, 20),
        ended_at: at(TODAY, 11, 20),
      });
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });

      // A press on a closed group dragged sideways is not a click: it stays closed.
      const writesBefore = writes(h).length;
      const small = h.page.locator(`[data-group="${SMALL}"]`);
      await small.scrollIntoViewIfNeeded();
      const g = await small.boundingBox();
      assert.ok(g !== null);
      await h.page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await h.page.mouse.down();
      await h.page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2, { steps: 6 });
      await h.page.mouse.up();
      await frames(h.page);
      assert.equal(await small.count(), 1, 'a drag opened the group');
      assert.equal(await h.page.locator(`[data-group-toggle="${SMALL}"]`).count(), 0);
      // …and an open one, dragged by its Collapse, stays open.
      await small.click();
      const toggle = h.page.locator(`[data-group-toggle="${SMALL}"]`);
      await toggle.waitFor({ timeout: 5_000 });
      const t = await toggle.boundingBox();
      assert.ok(t !== null);
      await h.page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await h.page.mouse.down();
      await h.page.mouse.move(t.x + t.width / 2 + 60, t.y + t.height / 2 + 4, { steps: 6 });
      await h.page.mouse.up();
      await frames(h.page);
      assert.equal(await toggle.count(), 1, 'a drag closed the group');
      // A click still does what a click does.
      await toggle.click();
      await small.waitFor({ timeout: 5_000 });
      assert.equal(writes(h).length, writesBefore, 'a drag on a group wrote something');

      // Three writes and their reloads later the twelve are still open — and after a reload of the page.
      assert.equal(await h.page.locator(`[data-group-toggle="${CROWD}"]`).count(), 1);
      await h.page.reload();
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await h.page.locator(`[data-group-toggle="${CROWD}"]`).waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator(`[data-group="${CROWD}"]`).count(), 0);
    } finally {
      await h.close();
    }
  });
});
