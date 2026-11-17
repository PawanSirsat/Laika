import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  navigateInApp,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import {
  addDays,
  EARLIER,
  settledEntries,
  TOMORROW,
  viewOf,
  weekData,
  weekStub,
  YESTERDAY,
  type DayData,
} from './my-day-week.ts';
import {
  chunks,
  isoWeek,
  mondayOf,
  monthWeeks,
  periodOf,
  stepPeriod,
} from '../../src/routes/screens/my-day/span.ts';
import { dayLong } from '../../src/routes/screens/my-day/week-derive.ts';
import { tipText } from './tooltip-probe.ts';

/**
 * My day's View (LAI-1174, the owner's *My Day Calendar Zoom*): Day, Week,
 * Month and Year by the switch, the keys and the address; opening a part of
 * a period goes one view in, a block in Week opens its day in the editor;
 * the zoom between views runs, and is a fade or nothing for a reader who
 * asks for less motion; a phone gets the switch and no sideways scroll.
 * Day is the page as it always was.
 */

const sum = (list: readonly { minutes: number }[]): number =>
  list.reduce((n, x) => n + x.minutes, 0);

/** `GET /me/time/days` rows from the same fixture days the day view reads. */
function rows(from: string, to: string, data: Map<string, DayData>) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = data.get(d);
    const drafted = sum(day?.drafts ?? []);
    const confirmed = sum(day?.entries ?? []);
    out.push({
      day: d,
      state:
        drafted > 0 ? 'drafted' : confirmed > 0 ? 'confirmed' : d > TODAY ? 'future' : 'no_signal',
      confirmed_minutes: confirmed,
      drafted_minutes: drafted,
      untied_minutes: 0,
      off: day?.off ?? null,
      top_tasks:
        confirmed + drafted > 0
          ? [
              {
                task: { id: 't11', key: 'LAI-11', title: 'Search matches keys' },
                project: null,
                untied: false,
                confirmed_minutes: confirmed,
                drafted_minutes: drafted,
              },
            ]
          : [],
    });
  }
  return { from, to, tz: 'UTC', today: TODAY, days: out };
}

/**
 * Every range Month and Year ask for around today — two months either side
 * and the year before and after, since the stage reads the periods beside
 * the one shown ahead of time (LAI-1179).
 */
function daysRoutes(data: Map<string, DayData>): ApiStub {
  const shift = (span: 'month' | 'year', n: number): string => {
    let day = TODAY;
    for (let i = 0; i < Math.abs(n); i += 1) day = stepPeriod(span, day, n < 0 ? -1 : 1);
    return day;
  };
  const ranges: { from: string; to: string }[] = [];
  for (const by of [-2, -1, 0, 1, 2]) {
    ranges.push(periodOf('month', shift('month', by)));
  }
  for (const by of [-1, 0, 1]) {
    const year = periodOf('year', shift('year', by));
    ranges.push(...chunks(year.from, year.to));
  }
  return Object.fromEntries(
    ranges.map((r) => [
      `/api/v1/me/time/days?from=${r.from}&to=${r.to}`,
      () => rows(r.from, r.to, data),
    ]),
  );
}

function stub(data: Map<string, DayData> = weekData()): ApiStub {
  // The page still reads the day in the address for its header: ← in Month
  // puts it a month back, past the fixture's three weeks, so it is served too.
  const back = stepPeriod('month', TODAY, -1);
  const again = stepPeriod('month', back, 1);
  return {
    ...weekStub(data),
    ...daysRoutes(data),
    [`/api/v1/me/time?day=${back}`]: () => viewOf(back, data),
    [`/api/v1/me/time?day=${again}`]: () => viewOf(again, data),
  };
}

const spanOf = (page: Page): string | null => new URL(page.url()).searchParams.get('span');

async function pick(page: Page, label: 'Day' | 'Week' | 'Month' | 'Year'): Promise<void> {
  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: label }).click();
}

/** Count the stage's running animations on every frame for 900 ms. */
async function sample(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __spanMax: number };
    w.__spanMax = 0;
    const end = performance.now() + 900;
    const tick = (): void => {
      const n = [...document.querySelectorAll<HTMLElement>('[data-stage] .span-layer')].reduce(
        (sum, el) => sum + el.getAnimations().length,
        0,
      );
      w.__spanMax = Math.max(w.__spanMax, n);
      if (performance.now() < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function sampled(page: Page): Promise<number> {
  await page.waitForTimeout(950);
  return page.evaluate(() => (window as unknown as { __spanMax: number }).__spanMax);
}

/** The layer the stage shows now, once nothing is leaving. */
async function settled(page: Page, layer: string): Promise<void> {
  const current = page.locator(`[data-layer="${layer}"][data-layer-role="current"]`);
  await current.waitFor();
  // Loaded, not just mounted: a slower machine (CI) still shows the skeleton here.
  await current.locator('.span-card:not([aria-busy])').waitFor();
  await until(async () => (await page.locator('[data-layer-role="leaving"]').count()) === 0);
}

void describe('My day — the View (LAI-1174)', () => {
  after(async () => {
    await closeBrowser();
  });

  let h: Harness | undefined;
  const close = async () => {
    await h?.close();
    h = undefined;
  };
  const page = (): Page => {
    assert.ok(h !== undefined);
    return h.page;
  };

  void test('Day is the page as it was, with the switch on Day', async () => {
    h = await open('/my-day', stub());
    try {
      await h.page.locator('[data-myday-ready]').waitFor();
      const group = h.page.getByRole('radiogroup', { name: 'View' });
      assert.equal(
        await group.getByRole('radio', { name: 'Day' }).getAttribute('aria-checked'),
        'true',
      );
      assert.equal(spanOf(h.page), null);
      // The day's own nav and week strip are still there. The stage is up
      // under the page (LAI-1179: Day is a layer, so a zoom can leave it in
      // view), idle: one layer, Day's, nothing leaving.
      assert.equal(await h.page.locator('[data-day-nav]').count(), 1);
      assert.equal(await h.page.locator('[data-stage]').getAttribute('data-span'), 'day');
      assert.equal(await h.page.locator('[data-stage] .span-layer').count(), 1);
      assert.equal(await h.page.locator('[data-layer-role="leaving"]').count(), 0);
    } finally {
      await close();
    }
  });

  void test('Week: seven days, the blocks where they happened, and the address', async () => {
    h = await open('/my-day', stub());
    try {
      await h.page.locator('[data-myday-ready]').waitFor();
      await pick(h.page, 'Week');
      await settled(h.page, 'week');
      assert.equal(spanOf(h.page), 'week');
      const days = h.page.locator('[data-span-week] .span-week-day');
      assert.equal(await days.count(), 7);
      const data = weekData();
      const today = data.get(TODAY);
      const placed = [...(today?.drafts ?? []), ...(today?.entries ?? [])].filter(
        (x) => typeof x.started_at === 'number',
      ).length;
      const todayCol = h.page.locator('.span-week-col[data-today]');
      assert.equal(await todayCol.locator('.span-week-block').count(), placed);
      assert.equal(
        (await h.page.locator('[data-view-label]').textContent())?.startsWith(
          `Week ${String(isoWeek(TODAY))}`,
        ),
        true,
      );
      // The day's own figure and lists are not drawn over a week.
      assert.equal(await h.page.locator('[data-day-total]').count(), 0);
      assert.equal(await h.page.locator('[data-myday-ready]').count(), 0);
    } finally {
      await close();
    }
  });

  void test('a block in Week opens its day with the block in the editor', async () => {
    h = await open('/my-day?span=week', stub());
    try {
      await settled(h.page, 'week');
      await h.page.locator('.span-week-col[data-today] .span-week-block').first().click();
      await h.page.locator('[data-myday-ready]').waitFor();
      assert.equal(spanOf(h.page), null);
      assert.equal(new URL(h.page.url()).searchParams.get('day'), TODAY);
      await h.page.locator('[data-myday-drawer]').waitFor();
    } finally {
      await close();
    }
  });

  void test('Month: its weeks, a day nothing reached says —, and a week number opens the week', async () => {
    // A past day the fixture holds nothing for, in the month shown. Today's
    // month has one unless its grid starts within a day of today — the 1st on
    // a Monday or a Tuesday, the 2nd on a Tuesday — when only today and
    // yesterday are before it; then last month, all of it past (LAI-1186).
    const data = weekData();
    // The latest such day: its week is within the three weeks the fixture serves.
    const quietIn = (day: string): string | undefined =>
      monthWeeks(day)
        .flat()
        .filter((d) => d < TODAY && !data.has(d))
        .at(-1);
    const shown = quietIn(TODAY) === undefined ? stepPeriod('month', TODAY, -1) : TODAY;
    h = await open(`/my-day?span=month&day=${shown}`, stub());
    try {
      await settled(h.page, 'month');
      const cells = h.page.locator('.span-month-cell');
      assert.equal(await cells.count(), monthWeeks(shown).length * 7);
      const quietDay = quietIn(shown);
      assert.ok(quietDay !== undefined, 'the grid has a past day with nothing in it');
      const quiet = h.page.locator(`.span-month-cell[data-zk="d:${quietDay}"]`);
      assert.equal(await quiet.getAttribute('data-kind'), 'no_signal');
      assert.equal((await quiet.locator('.span-month-total').textContent())?.trim(), '—');
      for (const d of [YESTERDAY, EARLIER].filter((x) => x.slice(0, 7) === shown.slice(0, 7))) {
        assert.equal(
          await h.page.locator(`.span-month-cell[data-zk="d:${d}"]`).getAttribute('data-kind'),
          'time',
        );
      }
      // The quiet day's week is a row of the grid shown, whichever month that is.
      await h.page.getByRole('button', { name: `Open week ${String(isoWeek(quietDay))}` }).click();
      await settled(h.page, 'week');
      assert.equal(spanOf(h.page), 'week');
    } finally {
      await close();
    }
  });

  void test('Year: twelve months, today ringed; a month opens Month and a day opens Day', async () => {
    h = await open(`/my-day?span=year&day=${TODAY}`, stub());
    try {
      await settled(h.page, 'year');
      assert.equal(await h.page.locator('.span-year-month').count(), 12);
      const today = h.page.locator(`.span-year-day[data-zk="d:${TODAY}"]`);
      assert.equal(await today.getAttribute('data-today'), '');
      assert.notEqual(await today.getAttribute('data-heat'), '0');
      await h.page.locator(`[data-zk="m:${TODAY.slice(0, 7)}"] .span-year-title`).click();
      await settled(h.page, 'month');
      assert.equal(spanOf(h.page), 'month');
      await h.page.locator(`.span-month-cell[data-zk="d:${TODAY}"]`).click();
      await h.page.locator('[data-myday-ready]').waitFor();
      assert.equal(spanOf(h.page), null);
    } finally {
      await close();
    }
  });

  void test('the keys: D W M Y, − and +, Esc a step out, ← → a period', async () => {
    h = await open('/my-day', stub());
    try {
      await h.page.locator('[data-myday-ready]').waitFor();
      await h.page.keyboard.press('y');
      await settled(h.page, 'year');
      assert.equal(spanOf(h.page), 'year');
      await h.page.keyboard.press('+');
      await settled(h.page, 'month');
      assert.equal(spanOf(h.page), 'month');
      await h.page.keyboard.press('ArrowLeft');
      await until(
        () =>
          new URL(h?.page.url() ?? '').searchParams.get('day') === stepPeriod('month', TODAY, -1),
      );
      assert.equal(new URL(h.page.url()).searchParams.get('day'), stepPeriod('month', TODAY, -1));
      await settled(h.page, 'month');
      // → back to this month: the fixture's days are only three weeks either side of today.
      await h.page.keyboard.press('ArrowRight');
      await until(
        () =>
          new URL(h?.page.url() ?? '').searchParams.get('day') ===
          stepPeriod('month', stepPeriod('month', TODAY, -1), 1),
      );
      await settled(h.page, 'month');
      await h.page.keyboard.press('Escape');
      await settled(h.page, 'year');
      await h.page.keyboard.press('w');
      await settled(h.page, 'week');
      await h.page.keyboard.press('-');
      await settled(h.page, 'month');
      await h.page.keyboard.press('d');
      await h.page.locator('[data-myday-ready]').waitFor();
      assert.equal(spanOf(h.page), null);
      // Back walks the views as they were seen.
      await h.page.goBack();
      await settled(h.page, 'month');
    } finally {
      await close();
    }
  });

  void test('the zoom runs between views, and a reader who asks for less motion gets none', async () => {
    h = await open(`/my-day?span=year&day=${TODAY}`, stub());
    try {
      await settled(h.page, 'year');
      await h.page.locator(`[data-zk="m:${TODAY.slice(0, 7)}"] .span-year-title`).click();
      // Mid-zoom the year is still drawn, leaving, and both layers are moving.
      await h.page.locator('[data-layer="year"][data-layer-role="leaving"]').waitFor();
      // Polled, not read once: the zoom starts when the month has loaded, and lasts 520 ms.
      let moving = false;
      await until(async () => {
        moving = await page().evaluate(() => {
          const layers = [...document.querySelectorAll<HTMLElement>('[data-stage] .span-layer')];
          return layers.length > 1 && layers.every((el) => el.getAnimations().length > 0);
        });
        return moving;
      });
      assert.equal(moving, true, 'both layers animate during the zoom');
      await settled(h.page, 'month');

      // Less motion: every frame for 900 ms is sampled — a zoom that ran and
      // finished would otherwise look the same as one that never started.
      await h.page.emulateMedia({ reducedMotion: 'reduce' });
      await sample(page());
      await pick(h.page, 'Year');
      await settled(h.page, 'year');
      assert.equal(await sampled(page()), 0, 'nothing moves under prefers-reduced-motion');

      // The sampler's positive control: with motion back, the same switch is seen moving.
      await h.page.emulateMedia({ reducedMotion: 'no-preference' });
      await sample(page());
      await h.page.locator(`[data-zk="m:${TODAY.slice(0, 7)}"] .span-year-title`).click();
      await settled(h.page, 'month');
      assert.ok((await sampled(page())) > 0, 'the sampler sees a zoom when there is one');
    } finally {
      await close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`390 px, ${theme}: the Year's heat key keeps its swatches (LAI-1187)`, async () => {
      h = await open(`/my-day?span=year&day=${TODAY}`, stub(), {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
        },
      });
      try {
        await setTheme(h.page, theme);
        await settled(h.page, 'year');
        const key = await h.page
          .locator('[data-layer-role="current"] .span-heat-key')
          .evaluate((el) => {
            const head = (el.closest('.span-head') ?? el).getBoundingClientRect();
            return [...el.querySelectorAll<HTMLElement>('.span-heat-swatch')].map((s) => {
              const r = s.getBoundingClientRect();
              return {
                w: r.width,
                h: r.height,
                left: r.left,
                right: r.right,
                inside:
                  r.left >= head.left - 0.5 &&
                  r.right <= head.right + 0.5 &&
                  r.top >= head.top - 0.5 &&
                  r.bottom <= head.bottom + 0.5,
              };
            });
          });
        assert.equal(key.length, 5);
        for (const [i, s] of key.entries()) {
          assert.deepEqual(
            [s.w, s.h],
            [12, 12],
            `swatch ${String(i)} is ${String(s.w)}×${String(s.h)}`,
          );
          assert.equal(s.inside, true, `swatch ${String(i)} is outside the card's head`);
          const next = key[i + 1];
          if (next !== undefined)
            assert.ok(
              next.left >= s.right - 0.5,
              `swatches ${String(i)} and ${String(i + 1)} overlap`,
            );
        }
      } finally {
        await close();
      }
    });

    void test(`390 px, ${theme}: the switch is there and nothing scrolls sideways`, async () => {
      h = await open('/my-day', stub(), {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
        },
      });
      try {
        await setTheme(h.page, theme);
        await h.page.locator('[data-myday-ready]').waitFor();
        await pick(h.page, 'Month');
        await settled(h.page, 'month');
        for (const view of ['Month', 'Year', 'Week'] as const) {
          if (view !== 'Month') {
            await pick(h.page, view);
            await settled(h.page, view.toLowerCase());
          }
          const wide = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(wide <= 0, `${view} at 390 px scrolls ${String(wide)} px sideways`);
        }
      } finally {
        await close();
      }
    });
  }
});

/**
 * The zoom as the design plays it (LAI-1179): it starts on the click, before
 * any data; the view left is the same element it was; the arriving view is on
 * top going in and the leaving one going out; quick switches queue and land
 * on the last; Day is a layer like the others; ‹ › slide; and the periods
 * around the one shown are read ahead.
 */

/** A route held back until the test lets it answer. */
function held(answer: () => unknown): { route: () => Promise<unknown>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { route: () => gate.then(answer), release };
}

const monthRange = periodOf('month', TODAY);
const monthPath = `/api/v1/me/time/days?from=${monthRange.from}&to=${monthRange.to}`;

interface Trace {
  frames: number;
  maxGap: number;
  minHeight: number;
  bothMoving: number;
  /** Frames seen while the stage carried `data-zooming`. */
  zooming: number;
  /** How many times the arriving layer's computed transform changed mid-zoom. */
  moved: number;
}

/**
 * Watch the stage from the page: every frame for `ms`, the stage's height,
 * whether both layers were animating, the arriving layer's transform, and
 * the gap since the last frame.
 */
async function trace(page: Page, ms: number): Promise<void> {
  await page.evaluate((duration) => {
    const w = window as unknown as { __trace: Trace };
    const stage = document.querySelector<HTMLElement>('[data-stage]');
    const t: Trace = {
      frames: 0,
      maxGap: 0,
      minHeight: Number.POSITIVE_INFINITY,
      bothMoving: 0,
      zooming: 0,
      moved: 0,
    };
    w.__trace = t;
    const start = performance.now();
    let last = start;
    let lastTransform = '';
    const tick = (now: number): void => {
      t.frames += 1;
      t.maxGap = Math.max(t.maxGap, now - last);
      last = now;
      // Height and movement are read while the zoom runs: at its end the
      // stage is let go to the height of the view that stays.
      if (stage?.dataset.zooming !== undefined) {
        t.zooming += 1;
        t.minHeight = Math.min(t.minHeight, stage.offsetHeight);
        const layers = [...document.querySelectorAll<HTMLElement>('[data-stage] .span-layer')];
        if (layers.length === 2 && layers.every((el) => el.getAnimations().length > 0)) {
          t.bothMoving += 1;
        }
        const arriving = document.querySelector<HTMLElement>('[data-layer-role="current"]');
        const transform = arriving === null ? '' : getComputedStyle(arriving).transform;
        if (transform !== lastTransform) {
          if (lastTransform !== '') t.moved += 1;
          lastTransform = transform;
        }
      }
      if (now - start < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function traced(page: Page): Promise<Trace> {
  return page.evaluate(() => (window as unknown as { __trace: Trace }).__trace);
}

/** Two frames from now, so what the click set in motion has had a chance to be seen. */
const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

const animating = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate(
    (sel) => (document.querySelector<HTMLElement>(sel)?.getAnimations().length ?? 0) > 0,
    selector,
  );

const zIndexOf = (page: Page, selector: string): Promise<number> =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    return el === null ? Number.NaN : Number(getComputedStyle(el).zIndex);
  }, selector);

void describe('My day — the zoom as the design plays it (LAI-1179)', () => {
  after(async () => {
    await closeBrowser();
  });

  let h: Harness | undefined;
  const close = async () => {
    await h?.close();
    h = undefined;
  };
  const page = (): Page => {
    assert.ok(h !== undefined);
    return h.page;
  };
  // Anything thrown, and anything React or the stage says on the console. Not
  // a 404 from the shell's own reads this fixture does not stub (`/org`,
  // `/users`, `/health`), which every My day fixture has always had.
  const errors: string[] = [];
  const watchErrors = (p: Page): void => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
        errors.push(m.text());
      }
    });
  };

  void test('Year → Month starts on the click with the month still unread, holds the stage’s height, and fills the same layer in', async (t) => {
    const month = held(() => rows(monthRange.from, monthRange.to, weekData()));
    h = await open(`/my-day?span=year&day=${TODAY}`, { ...stub(), [monthPath]: month.route });
    try {
      watchErrors(h.page);
      await settled(h.page, 'year');
      const yearHeight = await h.page.evaluate(
        () => document.querySelector<HTMLElement>('[data-layer="year"]')?.offsetHeight ?? 0,
      );
      assert.ok(yearHeight > 300, `the year is drawn (${String(yearHeight)} px)`);
      await trace(h.page, 700);
      await h.page.locator(`[data-zk="m:${TODAY.slice(0, 7)}"] .span-year-title`).click();
      await twoFrames(h.page);
      // Both layers move, two frames after the click, with the month unread.
      assert.equal(
        await animating(h.page, '[data-layer="month"][data-layer-role="current"]'),
        true,
      );
      assert.equal(await animating(h.page, '[data-layer="year"][data-layer-role="leaving"]'), true);
      const monthLayer = await h.page.$('[data-layer="month"]');
      assert.ok(monthLayer !== null);
      assert.equal(await h.page.locator('[data-layer="month"] .span-card[aria-busy]').count(), 1);
      // At its shape already: the grid's cells carry their keys, so the next zoom has its anchor.
      assert.equal(
        await h.page.locator('[data-layer="month"] .span-month-cell[data-zk]').count(),
        monthWeeks(TODAY).length * 7,
      );
      assert.equal(await h.page.locator('[data-stage] .skeleton').count(), 0, 'no loading card');
      await h.page.waitForTimeout(750);
      const tr = await traced(h.page);
      assert.ok(
        tr.minHeight >= yearHeight - 1,
        `the stage never dropped below the year (${String(tr.minHeight)} < ${String(yearHeight)})`,
      );
      // What the machine cannot fail honestly: the arriving layer's transform
      // changed through the zoom (it moved, not just started), both layers were
      // seen moving at once, and the main thread was never blocked for long.
      // The frame count and the longest gap are **evidence, not a bound**: a
      // shared CI runner delivers frames late on its own load (87 ms measured
      // on one), so a tight number there would measure the machine, not the
      // stage. The 250 ms catches only a blocked main thread.
      t.diagnostic(
        `zoom trace: ${String(tr.frames)} frames in 700 ms, ${String(tr.zooming)} while zooming, longest gap ${String(Math.round(tr.maxGap))} ms, transform changed ${String(tr.moved)} times`,
      );
      assert.ok(tr.moved >= 2, `the arriving layer moved (${String(tr.moved)} changes)`);
      assert.ok(tr.bothMoving >= 1, 'both layers were seen moving at once');
      assert.ok(tr.maxGap <= 250, `main thread blocked ${String(Math.round(tr.maxGap))} ms`);
      // Still unread, still the same element, still busy.
      assert.equal(await h.page.locator('[data-layer="month"] .span-card[aria-busy]').count(), 1);
      month.release();
      await h.page.locator('[data-layer="month"] .span-card:not([aria-busy])').waitFor();
      assert.equal(
        await monthLayer.evaluate((el) =>
          el.isSameNode(document.querySelector('[data-layer="month"]')),
        ),
        true,
        'the data filled the layer that was mounted on the click',
      );
      assert.match(
        (await h.page.locator('[data-layer="month"] [data-span-figure]').textContent()) ?? '',
        /Confirmed/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  void test('the view left is the same element it was, with its role changed — not rebuilt', async () => {
    h = await open(`/my-day?span=year&day=${TODAY}`, stub());
    try {
      await settled(h.page, 'year');
      const year = await h.page.$('[data-layer="year"]');
      assert.ok(year !== null);
      const period = await year.getAttribute('data-period');
      await h.page.locator(`[data-zk="m:${TODAY.slice(0, 7)}"] .span-year-title`).click();
      await twoFrames(h.page);
      assert.equal(await year.evaluate((el) => el.isConnected), true);
      assert.equal(await year.getAttribute('data-layer-role'), 'leaving');
      assert.equal(await year.getAttribute('data-period'), period);
      assert.equal(
        await year.evaluate((el) =>
          el.isSameNode(document.querySelector('[data-layer-role="leaving"]')),
        ),
        true,
      );
    } finally {
      await close();
    }
  });

  void test('zooming in the arriving view is on top; zooming out the leaving one is', async () => {
    h = await open(`/my-day?span=year&day=${TODAY}`, stub());
    try {
      await settled(h.page, 'year');
      await h.page.locator(`[data-zk="m:${TODAY.slice(0, 7)}"] .span-year-title`).click();
      await twoFrames(h.page);
      assert.equal(await h.page.locator('[data-stage]').getAttribute('data-zooming'), 'in');
      const inCurrent = await zIndexOf(h.page, '[data-layer-role="current"]');
      const inLeaving = await zIndexOf(h.page, '[data-layer-role="leaving"]');
      assert.ok(
        inCurrent > inLeaving,
        `in: current ${String(inCurrent)} over leaving ${String(inLeaving)}`,
      );
      await settled(h.page, 'month');
      await pick(h.page, 'Year');
      await twoFrames(h.page);
      assert.equal(await h.page.locator('[data-stage]').getAttribute('data-zooming'), 'out');
      const outCurrent = await zIndexOf(h.page, '[data-layer-role="current"]');
      const outLeaving = await zIndexOf(h.page, '[data-layer-role="leaving"]');
      assert.ok(
        outLeaving > outCurrent,
        `out: leaving ${String(outLeaving)} over current ${String(outCurrent)}`,
      );
      await settled(h.page, 'year');
      assert.equal(await h.page.locator('[data-stage]').getAttribute('data-zooming'), null);
    } finally {
      await close();
    }
  });

  void test('Week → Month → Year in quick succession lands on Year with nothing left behind', async () => {
    h = await open(`/my-day?span=week&day=${TODAY}`, stub());
    try {
      watchErrors(h.page);
      await settled(h.page, 'week');
      const group = h.page.getByRole('radiogroup', { name: 'View' });
      await group.getByRole('radio', { name: 'Month' }).click();
      await group.getByRole('radio', { name: 'Year' }).click();
      // The switch said Year at once; the stage is still playing Week → Month
      // — the Week layer leaving, Month arriving — and takes Year up after.
      assert.equal(spanOf(h.page), 'year');
      assert.equal(
        await h.page.locator('[data-layer-role="current"]').getAttribute('data-layer'),
        'month',
        'the first zoom plays out before the second begins',
      );
      assert.equal(
        await h.page.locator('[data-layer="week"][data-layer-role="leaving"]').count(),
        1,
      );
      await settled(h.page, 'year');
      await until(async () => (await h?.page.locator('[data-stage] .span-layer').count()) === 1);
      assert.equal(await h.page.locator('[data-stage] .span-layer').count(), 1);
      assert.equal(
        await h.page.locator('[data-layer-role="current"]').getAttribute('data-layer'),
        'year',
      );
      assert.equal(await h.page.locator('[data-stage]').getAttribute('data-zooming'), null);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  void test('Day is a layer: zooming out leaves the Day page in view, and zooming in lands on the right day', async () => {
    h = await open('/my-day', stub());
    try {
      watchErrors(h.page);
      await h.page.locator('[data-myday-ready]').waitFor();
      await h.page.keyboard.press('w');
      // The Day page is the layer leaving — the Timeline still drawn, moving.
      let dayLeft = false;
      await until(async () => {
        dayLeft = await page().evaluate(() => {
          const el = document.querySelector<HTMLElement>(
            '[data-layer="day"][data-layer-role="leaving"]',
          );
          return (
            el !== null &&
            el.getAnimations().length > 0 &&
            el.querySelector('[data-dayline]') !== null
          );
        });
        return dayLeft;
      });
      assert.equal(dayLeft, true, 'the Day page zooms out as the leaving layer');
      await settled(h.page, 'week');
      assert.equal(await h.page.locator('[data-layer="day"]').count(), 0);

      // A day's column in Week: Day arrives zooming in from its cell, and is that day.
      // Another day of this week than today, whatever today is: yesterday, or
      // tomorrow on a Monday, when yesterday is last week's (LAI-1186).
      const other = mondayOf(YESTERDAY) === mondayOf(TODAY) ? YESTERDAY : TOMORROW;
      await h.page.locator(`.span-week-day[data-zk="d:${other}"]`).click();
      let dayIn = false;
      await until(async () => {
        dayIn = await animating(page(), '[data-layer="day"][data-layer-role="current"]');
        return dayIn;
      });
      assert.equal(dayIn, true, 'the Day layer zooms in');
      await h.page.locator('[data-myday-ready]').waitFor();
      assert.equal(new URL(h.page.url()).searchParams.get('day'), other);
      assert.equal(
        ((await h.page.locator('[data-view-label]').textContent()) ?? '').startsWith(
          dayLong(other),
        ),
        true,
        'the page shown is that day’s, never today’s under its address',
      );
      await until(async () => (await h?.page.locator('[data-layer-role="leaving"]').count()) === 0);

      // And by the key, from Week, onto the same day.
      await h.page.keyboard.press('w');
      await settled(h.page, 'week');
      await h.page.keyboard.press('d');
      let byKey = false;
      await until(async () => {
        byKey = await animating(page(), '[data-layer="day"][data-layer-role="current"]');
        return byKey;
      });
      assert.equal(byKey, true, 'D from Week zooms in too');
      await h.page.locator('[data-myday-ready]').waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  void test('a fresh visit reads a period it still holds again, and draws the one it holds meanwhile', async () => {
    // The week's other six days answer at once the first time and are held
    // the second: the re-read a fresh visit makes is seen, and seen pending.
    const data = weekData();
    const week = periodOf('week', TODAY);
    const others = Array.from({ length: 7 }, (_, i) => addDays(week.from, i)).filter(
      (d) => d !== TODAY,
    );
    const again = held(() => undefined);
    const seen = new Map<string, number>();
    const routes = Object.fromEntries(
      others.map((d) => [
        `/api/v1/me/time?day=${d}`,
        () => {
          const n = (seen.get(d) ?? 0) + 1;
          seen.set(d, n);
          return n === 1 ? viewOf(d, data) : again.route().then(() => viewOf(d, data));
        },
      ]),
    );
    h = await open(`/my-day?span=week&day=${TODAY}`, { ...stub(), ...routes });
    try {
      await settled(h.page, 'week');
      const blocks = await h.page.locator('.span-week-block').count();
      assert.ok(blocks > 0);
      // Away — anything could change the week from here — and back.
      await navigateInApp(h.page, '/board?project=atlas');
      await h.page.locator('[data-stage]').waitFor({ state: 'detached' });
      await navigateInApp(h.page, `/my-day?span=week&day=${TODAY}`);
      await h.page.locator('[data-layer="week"][data-layer-role="current"]').waitFor();
      await until(() => [...seen.values()].some((n) => n >= 2));
      // Read again, and while that is out the week held is what is drawn —
      // its blocks, no bones, no busy card.
      assert.equal(await h.page.locator('[data-layer="week"] .span-card[aria-busy]').count(), 0);
      assert.equal(await h.page.locator('.span-week-block').count(), blocks);
      assert.equal(
        (
          await h.page.locator('[data-span-week] .span-week-total').first().textContent()
        )?.trim() !== '',
        true,
      );
      again.release();
      await until(() => others.every((d) => (seen.get(d) ?? 0) >= 2));
      await settled(h.page, 'week');
      assert.equal(await h.page.locator('.span-week-block').count(), blocks);
      // The day on screen was not asked for by the week: the page's own answer stands for it.
      assert.equal(
        (h?.requests ?? []).filter(
          (r) =>
            r.url.startsWith('/api/v1/me/time?') &&
            new URL(r.url, 'http://stub').searchParams.get('day') === TODAY,
        ).length,
        2,
        'today: once per visit, by the page',
      );
    } finally {
      await close();
    }
  });

  void test('a Day whose read has not landed leaves as its skeleton, never as the day before', async () => {
    const before = held(() => viewOf(YESTERDAY, weekData()));
    h = await open('/my-day', { ...stub(), [`/api/v1/me/time?day=${YESTERDAY}`]: before.route });
    try {
      await h.page.locator('[data-myday-ready]').waitFor();
      // Yesterday into the address, as the week strip or the phone's ‹ would put it.
      await navigateInApp(h.page, `/my-day?day=${YESTERDAY}`);
      // Yesterday is in the address and not yet here: the Day layer is its skeleton.
      await h.page.locator('[data-myday-pending]').waitFor();
      await h.page.keyboard.press('w');
      const leaving = h.page.locator('[data-layer="day"][data-layer-role="leaving"]');
      await leaving.waitFor();
      assert.equal(
        await leaving.locator('[data-dayline]').count(),
        0,
        'today’s page under yesterday’s address',
      );
      assert.equal(await leaving.locator('[data-day-loading]').count(), 1);
      before.release();
      await settled(h.page, 'week');
    } finally {
      await close();
    }
  });

  void test('‹ › slide: out on the key, the next period at its shape, in — never a loading card', async () => {
    h = await open(`/my-day?span=month&day=${TODAY}`, stub());
    try {
      await settled(h.page, 'month');
      const before = stepPeriod('month', TODAY, -1);
      await h.page.keyboard.press('ArrowLeft');
      // The slide out is 130 ms: the layer shown is moving straight after the key.
      let sliding = false;
      await until(async () => {
        sliding = await animating(page(), '[data-layer-role="current"]');
        return sliding;
      }, 400);
      assert.equal(sliding, true, 'the month slides out on the key');
      await h.page.locator(`[data-period="month:${before.slice(0, 7)}"]`).waitFor();
      // Mounted at its shape, whether or not its rows are here.
      assert.equal(
        await h.page
          .locator(`[data-period="month:${before.slice(0, 7)}"] .span-month-cell`)
          .count(),
        monthWeeks(before).length * 7,
      );
      assert.equal(await h.page.locator('[data-stage] .skeleton').count(), 0);
      await settled(h.page, 'month');
      assert.equal(
        await h.page.locator('[data-layer-role="current"]').getAttribute('data-period'),
        `month:${before.slice(0, 7)}`,
      );
    } finally {
      await close();
    }
  });

  void test('with the day on screen its week, month and year are read behind it, and the switch asks for nothing new', async () => {
    h = await open('/my-day', stub());
    try {
      await h.page.locator('[data-myday-ready]').waitFor();
      const year = periodOf('year', TODAY);
      const yearPaths = chunks(year.from, year.to).map(
        (c) => `/api/v1/me/time/days?from=${c.from}&to=${c.to}`,
      );
      const week = periodOf('week', TODAY);
      const weekPaths = Array.from(
        { length: 7 },
        (_, i) => `/api/v1/me/time?day=${addDays(week.from, i)}`,
      );
      const asked = (): string[] =>
        (h?.calls ?? []).filter((c) => c.method === 'GET').map((c) => c.path);
      // Paths are recorded without their query; the stub's keys carry it, so
      // what was served is in the harness's own accounting of matched calls.
      const served = (): Set<string> => new Set(asked());
      await until(
        () =>
          served().has('/api/v1/me/time/days') &&
          asked().filter((p) => p === '/api/v1/me/time/days').length >= 1 + yearPaths.length &&
          asked().filter((p) => p === '/api/v1/me/time').length >= weekPaths.length,
        10_000,
      );
      const daysReads = asked().filter((p) => p === '/api/v1/me/time/days').length;
      assert.ok(
        daysReads >= 1 + yearPaths.length,
        `the month and the year's four stretches were read ahead (${String(daysReads)} reads)`,
      );
      assert.ok(
        asked().filter((p) => p === '/api/v1/me/time').length >= weekPaths.length,
        'the week’s days were read ahead (the page’s own answer stands for today)',
      );
      // Now Month, then Year: both already here, so no further read of either.
      const was = asked().length;
      await pick(h.page, 'Month');
      await settled(h.page, 'month');
      await pick(h.page, 'Year');
      await settled(h.page, 'year');
      assert.equal(
        (await h.page.locator('[data-layer="year"] .span-year-day[data-kind="time"]').count()) > 0,
        true,
        'the year is drawn from the cache, with its heat',
      );
      const sinceLength = asked().length - was;
      assert.equal(h.unmatched.length, 0, `unstubbed: ${h.unmatched.join(', ')}`);
      // What a switch may add is the reads **beside** the view shown (its
      // neighbours), never the view itself: the two months beside this one
      // and the two years beside this one, at most.
      assert.ok(
        sinceLength <= 2 + 2 * yearPaths.length,
        `${String(sinceLength)} reads after switching`,
      );
    } finally {
      await close();
    }
  });
});

/**
 * Days off (D-149, LAI-1184): a holiday and leave are drawn in their own
 * tones on Year, Month and Week, the legend names them, and the Day page says
 * so. Last week holds one of each — every day of it past, whatever today is —
 * and each view is opened on it: a holiday and whole-day leave with nothing
 * on them, half-day leave, leave still requested, and a holiday with time.
 */
const OFF_WEEK = mondayOf(addDays(TODAY, -7));
const HOLIDAY = OFF_WEEK;
const LEAVE = addDays(OFF_WEEK, 1);
const HALF = addDays(OFF_WEEK, 2);
const ASKED = addDays(OFF_WEEK, 3);
const WORKED = addDays(OFF_WEEK, 4);

function offData(): Map<string, DayData> {
  const data = weekData();
  const none = { drafts: [], entries: [] };
  data.set(HOLIDAY, { ...none, off: { holiday: { label: 'Heritage Day' }, leave: null } });
  data.set(LEAVE, {
    ...none,
    off: { holiday: null, leave: { part: 'full', status: 'approved', type: 'Annual' } },
  });
  data.set(HALF, {
    ...none,
    off: { holiday: null, leave: { part: 'first_half', status: 'approved', type: 'Sick' } },
  });
  data.set(ASKED, {
    ...none,
    off: { holiday: null, leave: { part: 'full', status: 'pending', type: null } },
  });
  data.set(WORKED, {
    drafts: [],
    entries: settledEntries(WORKED),
    off: { holiday: { label: 'Founders Day' }, leave: null },
  });
  return data;
}

/** A token as the browser resolves it in the theme shown, to compare with a computed colour. */
const tokenRgb = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, name);

/** One computed property of the first match, or of its `::after`. */
const styleOf = (
  page: Page,
  selector: string,
  property: string,
  pseudo: '::after' | null = null,
): Promise<string | null> =>
  page.evaluate(
    ([sel, prop, ps]) => {
      const el = document.querySelector(sel);
      return el === null ? null : getComputedStyle(el, ps).getPropertyValue(prop);
    },
    [selector, property, pseudo] as const,
  );

/** Every match lies inside its own `container` — not cut by it, not past it. */
async function inside(page: Page, selector: string, container: string): Promise<string[]> {
  return page.evaluate(
    ([sel, box]) =>
      [...document.querySelectorAll<HTMLElement>(sel)].flatMap((el) => {
        const outer = el.closest<HTMLElement>(box);
        if (outer === null || el.getClientRects().length === 0) return [];
        const a = el.getBoundingClientRect();
        const b = outer.getBoundingClientRect();
        const fits =
          a.left >= b.left - 0.5 &&
          a.right <= b.right + 0.5 &&
          a.top >= b.top - 0.5 &&
          a.bottom <= b.bottom + 0.5;
        return fits ? [] : [`${sel} ${el.textContent ?? ''} outside ${box}`];
      }),
    [selector, container] as const,
  );
}

const SHOTS = process.env.LAIKA_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

void describe('My day — days off (D-149, LAI-1184)', () => {
  after(async () => {
    await closeBrowser();
  });

  let h: Harness | undefined;
  const close = async () => {
    await h?.close();
    h = undefined;
  };

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390] as const) {
      void test(`days off on Year, Month, Week and the Day page, ${theme}, ${String(width)} px`, async () => {
        h = await open(`/my-day?span=year&day=${HOLIDAY}`, stub(offData()), {
          before: async (page) => {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          },
        });
        try {
          const page = h.page;
          await setTheme(page, theme);
          // The theme's colours ease in: wait until a chip shows the theme's own
          // card colour, so no screenshot catches the switch half-way (LAI-1187).
          // The colour the wait saw is the one asserted: a second read can land
          // while the bar is re-rendered and find no chip at all.
          const card = await tokenRgb(page, '--bg-card');
          let chip: string | null = null;
          await until(async () => {
            chip = await styleOf(page, '.myday-viewing-trigger', 'background-color');
            return chip === card;
          });
          assert.equal(chip, card, 'the chips settled in the theme');
          const phone = width === 390;
          const holidayBg = await tokenRgb(page, '--holiday-bg');
          const holidayBorder = await tokenRgb(page, '--holiday-border');
          const holiday = await tokenRgb(page, '--holiday');
          const leaveBg = await tokenRgb(page, '--leave-bg');

          // ---------------------------------------------------------- Year
          await settled(page, 'year');
          const year = (d: string) =>
            `[data-layer-role="current"] .span-year-day[data-zk="d:${d}"]`;
          // Last week may run into this year from the last: only its days in the year shown are drawn.
          const inYear = (d: string): boolean => d.slice(0, 4) === HOLIDAY.slice(0, 4);
          const tile = page.locator(year(HOLIDAY));
          assert.deepEqual(
            [
              await tile.getAttribute('data-kind'),
              await tile.getAttribute('data-off'),
              await tile.getAttribute('data-mark'),
            ],
            ['off', 'holiday', 'tint'],
          );
          // A tile's words are its Tooltip since LAI-1214 (My day: bare title= replaced).
          assert.match(await tipText(tile), /· Heritage Day$/);
          assert.equal(await styleOf(page, year(HOLIDAY), 'background-color'), holidayBg);
          assert.equal(await styleOf(page, year(HOLIDAY), 'border-top-color'), holidayBorder);
          if (inYear(LEAVE)) {
            assert.equal(await page.locator(year(LEAVE)).getAttribute('data-off'), 'leave');
            assert.equal(await styleOf(page, year(LEAVE), 'background-color'), leaveBg);
            assert.match(await tipText(page.locator(year(LEAVE))), /On leave · Annual/);
          }
          if (inYear(HALF)) {
            // Half-day leave owes half: still no signal, half filled, and said as the half.
            assert.equal(await page.locator(year(HALF)).getAttribute('data-kind'), 'no_signal');
            assert.equal(await page.locator(year(HALF)).getAttribute('data-mark'), 'half');
            assert.match(
              await tipText(page.locator(year(HALF))),
              /no signal · On leave · Sick · morning$/,
            );
            assert.match(
              (await styleOf(page, year(HALF), 'background-image')) ?? '',
              /linear-gradient/,
            );
          }
          if (inYear(ASKED)) {
            // Pending leave is a dashed edge only, never the fill.
            assert.equal(await page.locator(year(ASKED)).getAttribute('data-off'), 'requested');
            assert.equal(await page.locator(year(ASKED)).getAttribute('data-mark'), 'dash');
            assert.equal(await styleOf(page, year(ASKED), 'border-top-style'), 'dashed');
            assert.notEqual(await styleOf(page, year(ASKED), 'background-color'), leaveBg);
            assert.match(await tipText(page.locator(year(ASKED))), /Leave requested$/);
          }
          if (inYear(WORKED)) {
            // With time: its heat, and a dot in the tone — an ::after, never the tile's own shadow.
            assert.equal(await page.locator(year(WORKED)).getAttribute('data-kind'), 'time');
            assert.notEqual(await page.locator(year(WORKED)).getAttribute('data-heat'), '0');
            assert.equal(await page.locator(year(WORKED)).getAttribute('data-mark'), 'dot');
            assert.equal(await styleOf(page, year(WORKED), 'content', '::after'), '""');
            assert.equal(await styleOf(page, year(WORKED), 'background-color', '::after'), holiday);
            assert.equal(await styleOf(page, year(WORKED), 'box-shadow'), 'none');
          }
          const legend = page.locator('[data-layer-role="current"] [data-off-key]');
          assert.deepEqual(
            await legend
              .locator('[data-off-legend]')
              .evaluateAll((els) =>
                els.map((el) => [el.getAttribute('data-off-legend'), el.textContent?.trim()]),
              ),
            [
              ['holiday', 'Holiday'],
              ['leave', 'Leave'],
              ['requested', 'Leave requested'],
            ],
          );
          assert.equal(
            await styleOf(
              page,
              '[data-layer-role="current"] .span-swatch-off[data-off="holiday"]',
              'background-color',
            ),
            holidayBg,
          );
          assert.deepEqual(await inside(page, '[data-off-key]', '.span-head'), []);
          assert.deepEqual(await inside(page, '.span-year-day[data-off]', '.span-year-grid'), []);
          await shot(page, `year-${theme}-${String(width)}`);
          if (SHOTS !== undefined) {
            // The page scrolls inside its column, so the month itself is shot too.
            await page
              .locator(`[data-layer-role="current"] [data-zk="m:${HOLIDAY.slice(0, 7)}"]`)
              .screenshot({ path: join(SHOTS, `year-month-${theme}-${String(width)}.png`) });
          }

          // --------------------------------------------------------- Month
          await navigateInApp(page, `/my-day?span=month&day=${HOLIDAY}`);
          await settled(page, 'month');
          const cell = (d: string) =>
            `[data-layer-role="current"] .span-month-cell[data-zk="d:${d}"]`;
          assert.equal(await page.locator(cell(HOLIDAY)).getAttribute('data-mark'), 'tint');
          assert.equal(await styleOf(page, cell(HOLIDAY), 'background-color'), holidayBg);
          assert.match(
            (await page.locator(cell(HALF)).getAttribute('aria-label')) ?? '',
            /, no signal, On leave · Sick · morning$/,
          );
          assert.equal(await styleOf(page, cell(ASKED), 'border-top-style'), 'dashed');
          if (phone) {
            // No room for chips: the tint carries it, and a day off with time keeps a dot.
            assert.equal(await page.locator(`${cell(HOLIDAY)} .span-month-off`).isVisible(), false);
            assert.equal(await styleOf(page, cell(WORKED), 'content', '::after'), '""');
          } else {
            // The chip says it in place of —, or beside the time.
            assert.equal(
              (await page.locator(`${cell(HOLIDAY)} .span-month-off`).textContent())?.trim(),
              'Heritage Day',
            );
            assert.equal(
              (await page.locator(`${cell(HOLIDAY)} .span-month-total`).textContent())?.trim(),
              '',
            );
            assert.equal(
              (await page.locator(`${cell(ASKED)} .span-month-off`).textContent())?.trim(),
              'Leave requested',
            );
            assert.equal(
              (await page.locator(`${cell(WORKED)} .span-month-off`).textContent())?.trim(),
              'Founders Day',
            );
            assert.notEqual(
              (await page.locator(`${cell(WORKED)} .span-month-total`).textContent())?.trim(),
              '',
            );
            assert.equal(await styleOf(page, `${cell(HOLIDAY)} .span-month-off`, 'color'), holiday);
            assert.deepEqual(await inside(page, '.span-month-off', '.span-month-cell'), []);
          }
          assert.equal(await legend.locator('[data-off-legend]').count(), 3);
          await shot(page, `month-${theme}-${String(width)}`);

          // ---------------------------------------------------------- Week
          await navigateInApp(page, `/my-day?span=week&day=${HOLIDAY}`);
          await settled(page, 'week');
          const cols = page.locator('[data-layer-role="current"] .span-week-col');
          // Monday's column says the holiday in place of No signal.
          assert.equal(
            (await cols.nth(0).locator('.span-week-off').textContent())?.trim(),
            'Heritage Day',
          );
          assert.equal(await cols.nth(0).locator('.span-week-nosignal').count(), 0);
          assert.equal(
            await cols
              .nth(0)
              .locator('.span-week-off')
              .evaluate((el) => getComputedStyle(el).backgroundColor),
            holidayBg,
          );
          assert.equal(
            (await cols.nth(3).locator('.span-week-off').textContent())?.trim(),
            'Leave requested',
          );
          assert.equal(
            await cols
              .nth(3)
              .locator('.span-week-off')
              .evaluate((el) => getComputedStyle(el).borderTopStyle),
            'dashed',
          );
          const worked = `[data-layer-role="current"] .span-week-day[data-zk="d:${WORKED}"]`;
          assert.match(
            (await page.locator(worked).getAttribute('aria-label')) ?? '',
            /, Founders Day$/,
          );
          if (phone) {
            // No heads on a phone: the row says the day off, with time or without.
            assert.equal(await cols.nth(4).locator('.span-week-off').isVisible(), true);
          } else {
            assert.equal(await page.locator(worked).getAttribute('data-off'), 'holiday');
            assert.equal(await styleOf(page, worked, 'content', '::after'), '""');
            assert.equal(await cols.nth(4).locator('.span-week-off').isVisible(), false);
          }
          assert.deepEqual(await inside(page, '.span-week-off', '.span-week-col'), []);
          await shot(page, `week-${theme}-${String(width)}`);

          // ------------------------------------------------------ the Day
          await navigateInApp(page, `/my-day?day=${HOLIDAY}`);
          const banner = page.locator('[data-off-banner="holiday"]');
          await banner.waitFor();
          // Landed, not mid-zoom: the Week layer gone and the day's own page ready.
          await page.locator('[data-myday-ready]').waitFor();
          await until(
            async () => (await page.locator('[data-layer-role="leaving"]').count()) === 0,
          );
          assert.equal((await banner.textContent())?.trim(), 'Public holiday — Heritage Day');
          assert.equal(
            await banner.evaluate((el) => getComputedStyle(el).backgroundColor),
            holidayBg,
          );
          const empty = page.locator('[data-day-empty]');
          assert.equal(await empty.getAttribute('data-day-empty'), 'off');
          assert.equal(
            (await empty.locator('.dstate-empty-title').textContent())?.trim(),
            'Heritage Day',
          );
          assert.doesNotMatch((await empty.textContent()) ?? '', /no signal/i);
          if (phone) {
            assert.match(
              (await page.locator('[data-phone-summary]').textContent()) ?? '',
              /Heritage Day/,
            );
            const dot = (d: string) =>
              page.locator(`[data-phone-week] [data-day="${d}"] [data-dot]`);
            // Every mark a day off can have, as Year draws it; with time, the time's own dot.
            assert.deepEqual(
              await Promise.all(
                [HOLIDAY, LEAVE, HALF, ASKED, WORKED].map((d) => dot(d).getAttribute('data-dot')),
              ),
              ['holiday', 'leave', 'half-leave', 'requested', 'settled'],
            );
            const leave = await tokenRgb(page, '--leave');
            assert.equal(
              await dot(HALF).evaluate((el) => getComputedStyle(el).borderTopColor),
              leave,
            );
            assert.match(
              await dot(HALF).evaluate((el) => getComputedStyle(el).backgroundImage),
              new RegExp(`linear-gradient\\(90deg, ${leave.replace(/[()]/g, '\\$&')} 50%`),
            );
          } else {
            assert.equal(
              (await page.locator('[data-day-total-sub]').textContent())?.trim(),
              'Heritage Day',
            );
            const strip = (d: string) => `.myday-week-day[data-day="${d}"]`;
            assert.equal(await page.locator(strip(LEAVE)).getAttribute('data-mark'), 'tint');
            assert.equal(await styleOf(page, strip(LEAVE), 'background-color'), leaveBg);
            assert.equal(await styleOf(page, strip(ASKED), 'border-top-style'), 'dashed');
            assert.equal(await styleOf(page, strip(WORKED), 'content', '::after'), '""');
            // The open day keeps its accent, and a dot says it is a day off.
            assert.equal(await styleOf(page, strip(HOLIDAY), 'content', '::after'), '""');
          }
          assert.deepEqual(await inside(page, '[data-off-banner]', '.myday-column'), []);
          const wide = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(wide <= 0, `the Day page at ${String(width)} px scrolls ${String(wide)} px`);
          await shot(page, `day-${theme}-${String(width)}`);
        } finally {
          await close();
        }
      });
    }
  }

  void test('the Day page: half-day leave says its half, requested leave is only requested', async () => {
    h = await open(`/my-day?day=${HALF}`, stub(offData()));
    try {
      const page = h.page;
      const leave = page.locator('[data-off-banner="leave"]');
      await leave.waitFor();
      assert.equal((await leave.textContent())?.trim(), 'On leave — Sick (morning)');
      // Half is still owed: an empty day stays no signal, and says so.
      assert.equal(await page.locator('[data-day-empty]').getAttribute('data-day-empty'), 'past');
      assert.equal((await page.locator('[data-day-total-sub]').textContent())?.trim(), 'no signal');

      await navigateInApp(page, `/my-day?day=${ASKED}`);
      const asked = page.locator('[data-off-banner="requested"]');
      await asked.waitFor();
      assert.equal((await asked.textContent())?.trim(), 'Leave requested');
      assert.equal(await asked.evaluate((el) => getComputedStyle(el).borderTopStyle), 'dashed');
      assert.equal(await page.locator('[data-off-banner="leave"]').count(), 0);

      // A day off with time is the day as it was, with the banner over it.
      await navigateInApp(page, `/my-day?day=${WORKED}`);
      await page.locator('[data-off-banner="holiday"]').waitFor();
      await page.locator('[data-dayline]').waitFor();
      assert.equal(await page.locator('[data-day-empty]').count(), 0);

      // Wider views show no day's banner.
      await navigateInApp(page, `/my-day?span=week&day=${WORKED}`);
      await settled(page, 'week');
      assert.equal(await page.locator('[data-off-banner]').count(), 0);
    } finally {
      await close();
    }
  });
});
