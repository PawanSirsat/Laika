import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import {
  addDays,
  EARLIER,
  viewOf,
  weekData,
  weekStub,
  YESTERDAY,
  type DayData,
} from './my-day-week.ts';
import {
  chunks,
  isoWeek,
  monthWeeks,
  periodOf,
  stepPeriod,
} from '../../src/routes/screens/my-day/span.ts';

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

/** Every range Month and Year ask for around today, a month either side. */
function daysRoutes(data: Map<string, DayData>): ApiStub {
  const ranges: { from: string; to: string }[] = [];
  for (const anchor of [stepPeriod('month', TODAY, -1), TODAY, stepPeriod('month', TODAY, 1)]) {
    ranges.push(periodOf('month', anchor));
  }
  const year = periodOf('year', TODAY);
  ranges.push(...chunks(year.from, year.to));
  return Object.fromEntries(
    ranges.map((r) => [
      `/api/v1/me/time/days?from=${r.from}&to=${r.to}`,
      () => rows(r.from, r.to, data),
    ]),
  );
}

function stub(): ApiStub {
  const data = weekData();
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
      // The day's own nav and week strip are still there.
      assert.equal(await h.page.locator('[data-day-nav]').count(), 1);
      assert.equal(await h.page.locator('[data-stage]').count(), 0);
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
    h = await open(`/my-day?span=month&day=${TODAY}`, stub());
    try {
      await settled(h.page, 'month');
      const cells = h.page.locator('.span-month-cell');
      assert.equal(await cells.count(), monthWeeks(TODAY).length * 7);
      // A past day in the grid the fixture holds nothing for — today's month
      // always has one, as only today, yesterday and three days ago hold time.
      const data = weekData();
      const quietDay = monthWeeks(TODAY)
        .flat()
        .find((d) => d < TODAY && !data.has(d));
      assert.ok(quietDay !== undefined, 'the grid has a past day with nothing in it');
      const quiet = h.page.locator(`.span-month-cell[data-zk="d:${quietDay}"]`);
      assert.equal(await quiet.getAttribute('data-kind'), 'no_signal');
      assert.equal((await quiet.locator('.span-month-total').textContent())?.trim(), '—');
      for (const d of [YESTERDAY, EARLIER].filter((x) => x.slice(0, 7) === TODAY.slice(0, 7))) {
        assert.equal(
          await h.page.locator(`.span-month-cell[data-zk="d:${d}"]`).getAttribute('data-kind'),
          'time',
        );
      }
      await h.page.getByRole('button', { name: `Open week ${String(isoWeek(TODAY))}` }).click();
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
