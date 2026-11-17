/**
 * My day's body, the UX pass (LAI-1223), in a real browser on the pinned clock
 * (LAI-954, 15:00 UTC today): My availability is one control whose pointer and
 * focus never put anything over the date line; *Day confirmed* is a state, not
 * a button; the day's tools are one named group; ‹ Today ›, the week, the View
 * and its zoom share one row and each day shows its total; the empty Timeline
 * shades only the person's own working hours and says so, draws now, and
 * keeps its message out of the grid; the toolbar carries the one primary Start
 * timer; and the phone fits 390px. No CSP violation anywhere.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, type ApiStub, type Harness } from './harness.ts';
import { NOW, open } from './my-day-clock.ts';
import { TODAY, YESTERDAY, weekData, weekStub, type DayData } from './my-day-week.ts';
import { strictCsp } from './tooltip-probe.ts';

after(async () => {
  await closeBrowser();
});

async function violations(p: Page): Promise<string[]> {
  return p.evaluate(() => window.__cspViolations ?? []);
}

const EMPTY: DayData = { drafts: [], entries: [] };

/** The week with `day` replaced by `data`, plus any routes in `extra`. */
function stub(day: string, data: DayData, extra: ApiStub = {}): ApiStub {
  const week = weekData();
  week.set(day, data);
  return { ...weekStub(week), ...extra };
}

/** My availability, nothing set but the working week. */
function availability(work: { days: number[]; start: string; end: string } | null): ApiStub {
  return {
    '/api/v1/me/availability': {
      status: null,
      away: null,
      // Always sent since LAI-1185 (master): null when the HR system has none.
      on_leave: null,
      hours_per_week: null,
      note: null,
      tags: [],
      work_week: work === null ? null : { ...work, minutes: null },
      away_periods: [],
      updated_at: NOW - 86_400_000,
    },
  };
}

async function openDay(
  day: string,
  routes: ApiStub,
  width = 1440,
  theme: 'light' | 'dark' = 'dark',
): Promise<Harness> {
  const h = await open(`/my-day?day=${day}`, routes, { before: strictCsp });
  /*
   * **Closed if it never opens** (LAI-1306). Every caller's `try` starts after
   * this returns, so a page that did not draw left its stub server listening
   * and the file's process never exited: CI's web shard 2 sat 60 minutes and
   * was cancelled, with this file's failures the last thing it printed.
   */
  try {
    await h.page.setViewportSize({ width, height: 900 });
    await setTheme(h.page, theme);
    await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  } catch (cause) {
    await h.close();
    throw cause;
  }
  return h;
}

/** Today's ISO weekday, 1 Monday to 7 Sunday, as the working week counts it. */
const ISO_TODAY = ((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

void describe('My availability: one control, nothing over the date line', () => {
  /*
   * Pointer only. A keyboard focus was tried too and dropped: with the old
   * tooltip put back it still passed — no focus in this harness raised that
   * Tooltip at all — so it proved nothing (CLAUDE.md §5: check your check ran).
   */
  void test('pointer: hovering the control opens no tooltip over the date under the title', async () => {
    const h = await openDay(TODAY, stub(TODAY, EMPTY));
    try {
      const trigger = h.page.locator('.screen-page [data-my-availability] > button');
      await trigger.waitFor({ timeout: 10_000 });
      assert.equal(await trigger.getAttribute('aria-label'), 'My availability: not set. Set it');
      assert.equal((await trigger.innerText()).replace(/\s+/g, ' ').trim(), 'Availability Not set');
      await trigger.hover();
      // Past the Tooltip's show delay, with room to spare.
      await h.page.waitForTimeout(900);
      const tips = await h.page.locator('[role="tooltip"]').evaluateAll((els) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        }),
      );
      assert.equal(tips.length, 0, 'a tooltip is showing beside My availability');
      // Whatever is drawn at the date line's middle is the date line.
      const onTop = await h.page.locator('[data-view-label]').evaluate((label) => {
        const r = label.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && label.contains(hit);
      });
      assert.equal(onTop, true, 'something covers the date line');
      // The control still opens its panel.
      await trigger.click();
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });
});

void describe('the toolbar: states are not buttons, the tools are one named group', () => {
  void test('a day all confirmed shows a Day confirmed state; a day with drafts offers Confirm day', async () => {
    const week = weekData();
    const today = week.get(TODAY);
    assert.ok(today !== undefined, 'the week fixture has no today');
    const h = await openDay(TODAY, stub(TODAY, { drafts: [], entries: today.entries }));
    try {
      const state = h.page.locator('[data-day-state="confirmed"]');
      await state.waitFor({ timeout: 10_000 });
      assert.equal(await state.evaluate((el) => el.tagName), 'SPAN');
      assert.equal(await state.getAttribute('role'), 'status');
      assert.equal((await state.innerText()).trim(), 'Day confirmed');
      assert.equal(await h.page.locator('[data-confirm-day]').count(), 0);
    } finally {
      await h.close();
    }
    const busy = await openDay(TODAY, weekStub());
    try {
      const confirm = busy.page.getByRole('button', { name: /^Confirm day/ });
      await confirm.waitFor({ timeout: 10_000 });
      assert.equal(await busy.page.locator('[data-day-state]').count(), 0);
    } finally {
      await busy.close();
    }
  });

  void test('the day’s tools are one group named Day tools, each named, each with a tooltip', async () => {
    const h = await openDay(TODAY, weekStub());
    try {
      const group = h.page.getByRole('group', { name: 'Day tools' });
      await group.waitFor({ timeout: 10_000 });
      const names = await group
        .getByRole('button')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      assert.deepEqual(names, [
        'Day settings',
        'Who is looking at your day',
        'Beside your day',
        'Keyboard shortcuts',
      ]);
      // One bordered cluster, and its buttons drawn without outlines of their own.
      const look = await group.evaluate((el) => {
        const own = getComputedStyle(el).borderTopStyle;
        const inner = [...el.querySelectorAll('button')].map(
          (b) => getComputedStyle(b).borderTopColor,
        );
        return { own, inner };
      });
      assert.equal(look.own, 'solid');
      for (const colour of look.inner) assert.match(colour, /rgba\(0, 0, 0, 0\)|transparent/);
      // Each says what it is on hover; the sheet's names its key.
      const tips: string[] = [];
      for (const button of await group.getByRole('button').all()) {
        await button.hover();
        const tip = h.page.locator('[role="tooltip"]').filter({ visible: true });
        await tip.first().waitFor({ timeout: 3_000 });
        tips.push(((await tip.first().textContent()) ?? '').trim());
        await h.page.mouse.move(0, 0);
        await tip.first().waitFor({ state: 'hidden', timeout: 3_000 });
      }
      assert.match(tips[0] ?? '', /Day settings/);
      assert.match(tips[1] ?? '', /Who looked at your day/);
      assert.match(tips[2] ?? '', /Agent time and On your plate/);
      assert.match(tips[3] ?? '', /Keyboard shortcuts\s*\?/);
      // No bare title anywhere in the page's head.
      assert.equal(await h.page.locator('.screen-page [title]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('navigation: one row, and every day shows its total', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: ‹ Today ›, the week, the View and its zoom share one row at 1440`, async () => {
      const h = await openDay(TODAY, weekStub(), 1440, theme);
      try {
        const row = h.page.locator('[data-nav-row]');
        await row.waitFor({ timeout: 10_000 });
        const parts = ['.myday-week-nav', '.myday-week-days', '.span-seg', '.span-zoom'];
        const boxes = [];
        for (const part of parts) {
          const box = await row.locator(part).boundingBox();
          assert.ok(box !== null, `${part} is not drawn in the nav row`);
          boxes.push(box);
        }
        const middles = boxes.map((b) => b.y + b.height / 2);
        const spread = Math.max(...middles) - Math.min(...middles);
        assert.ok(spread < 12, `the nav row is ${String(spread)}px from one line`);
        // In order, left to right, none on top of another.
        for (let i = 1; i < boxes.length; i += 1) {
          const left = boxes[i - 1];
          const right = boxes[i];
          assert.ok(left !== undefined && right !== undefined);
          assert.ok(
            right.x >= left.x + left.width - 1,
            `${parts[i] ?? ''} overlaps ${parts[i - 1] ?? ''}`,
          );
        }
        // Today's tile shows its whole figure, inside the tile.
        const tile = row.locator(`.myday-week-day[data-day="${TODAY}"]`);
        const fit = await tile.evaluate((el) => {
          const figure = el.querySelector('.myday-week-figure');
          if (figure === null) return 'no figure';
          const t = el.getBoundingClientRect();
          const f = figure.getBoundingClientRect();
          return f.width > 0 && f.right <= t.right - 1 && f.left >= t.left ? 'fits' : 'clipped';
        });
        assert.equal(fit, 'fits');
        assert.match(
          (await tile.locator('.myday-week-figure').innerText()).trim(),
          /^\d+ h \d+ min$/,
        );
        // Its state, marked: drafts still to review.
        assert.equal(await tile.locator('[data-week-mark="drafted"]').count(), 1);
        assert.deepEqual(await violations(h.page), []);
      } finally {
        await h.close();
      }
    });
  }

  void test('the View still switches from the one row, and Week keeps the same order', async () => {
    const h = await openDay(TODAY, weekStub());
    try {
      await h.page.locator('[data-nav-row] [data-span-option="week"]').click();
      const row = h.page.locator('[data-nav-row]');
      await row.locator('.span-nav').waitFor({ timeout: 10_000 });
      const nav = await row.locator('.span-nav').boundingBox();
      const seg = await row.locator('.span-seg').boundingBox();
      assert.ok(nav !== null && seg !== null);
      assert.ok(Math.abs(nav.y + nav.height / 2 - (seg.y + seg.height / 2)) < 12);
      assert.ok(nav.x < seg.x, 'the period steps come before the View');
    } finally {
      await h.close();
    }
  });
});

void describe('the empty Timeline', () => {
  void test('today: a now line at 3 PM, the message under the track, the toolbar’s one primary Start timer', async () => {
    const h = await openDay(TODAY, stub(TODAY, EMPTY));
    try {
      const card = h.page.locator('[data-day-empty="today"]');
      await card.waitFor({ timeout: 10_000 });
      // Now sits 8 of the 15 hours along (7 AM to 10 PM), within a pixel.
      const at = await card.evaluate((el) => {
        const lane = el.querySelector('.dstate-empty-lane')?.getBoundingClientRect();
        const now = el.querySelector('[data-now-line]')?.getBoundingClientRect();
        return lane === undefined || now === undefined
          ? undefined
          : { share: (now.left - lane.left) / lane.width, width: lane.width };
      });
      assert.ok(at !== undefined, 'no now line on today');
      assert.ok(Math.abs(at.share - 8 / 15) * at.width <= 2, `now is at ${String(at.share)}`);
      // The message is in the card's flow, below the track — over no grid line.
      const layout = await card.evaluate((el) => {
        const track = el.querySelector('.dstate-empty-track')?.getBoundingClientRect();
        const message = el.querySelector('.dstate-empty-message');
        return track === undefined || message === null
          ? undefined
          : {
              below: message.getBoundingClientRect().top >= track.bottom,
              position: getComputedStyle(message).position,
              height: el.getBoundingClientRect().height,
            };
      });
      assert.ok(layout !== undefined, 'the empty Timeline lost its track or message');
      assert.equal(layout.below, true, 'the message overlaps the track');
      assert.equal(layout.position, 'static');
      assert.ok(layout.height < 360, `the empty card is ${String(layout.height)}px tall`);
      // One Start timer on the page, the toolbar's, and it is the primary.
      assert.equal(await h.page.getByRole('button', { name: 'Start timer' }).count(), 1);
      const start = h.page.locator('.screen-page [data-timer-start] > button');
      assert.match((await start.getAttribute('class')) ?? '', /myday-chip-primary/);
      assert.equal(await card.locator('.myday-chip-primary').count(), 0);
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('a past day draws no now line', async () => {
    const h = await openDay(YESTERDAY, stub(YESTERDAY, EMPTY));
    try {
      await h.page.locator('[data-day-empty="past"]').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-now-line]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('working hours set: the hours outside them shaded, and a key that says so', async () => {
    const h = await openDay(
      TODAY,
      stub(
        TODAY,
        EMPTY,
        availability({ days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '16:00' }),
      ),
    );
    try {
      const card = h.page.locator('[data-day-empty="today"]');
      await card.waitFor({ timeout: 10_000 });
      const key = card.locator('[data-off-hours-key]');
      await key.waitFor({ timeout: 10_000 });
      assert.equal((await key.innerText()).trim(), 'Outside your working hours (08:00–16:00)');
      const bands = await card.evaluate((el) => {
        const lane = el.querySelector('.dstate-empty-lane')?.getBoundingClientRect();
        if (lane === undefined) return [];
        return [...el.querySelectorAll('[data-off-hours]')].map((b) => {
          const r = b.getBoundingClientRect();
          return [(r.left - lane.left) / lane.width, (r.right - lane.left) / lane.width];
        });
      });
      // 7–8 AM and 4–10 PM of the 7 AM to 10 PM track.
      assert.equal(bands.length, 2);
      const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.01;
      assert.ok(
        near(bands[0]?.[0], 0) && near(bands[0]?.[1], 1 / 15),
        `before: ${String(bands[0])}`,
      );
      assert.ok(
        near(bands[1]?.[0], 9 / 15) && near(bands[1]?.[1], 1),
        `after: ${String(bands[1])}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('a day that is not a working day: all of it shaded, and the key says why', async () => {
    const h = await openDay(
      TODAY,
      stub(
        TODAY,
        EMPTY,
        availability({
          days: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== ISO_TODAY),
          start: '09:00',
          end: '17:00',
        }),
      ),
    );
    try {
      const key = h.page.locator('[data-off-hours-key]');
      await key.waitFor({ timeout: 10_000 });
      assert.equal((await key.innerText()).trim(), 'Not one of your working days');
      assert.equal(await h.page.locator('[data-off-hours]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('the phone at 390', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: nothing scrolls sideways, every word fits its control`, async () => {
      const h = await openDay(TODAY, stub(TODAY, EMPTY), 390, theme);
      try {
        await h.page.locator('[data-day-empty="today"]').waitFor({ timeout: 10_000 });
        const wide = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(wide <= 0, `the page scrolls ${String(wide)}px sideways`);
        // The day note keeps its words inside its button (it squeezed to an icon's width).
        const note = h.page.locator('[data-day-note-button]');
        await note.waitFor({ timeout: 5_000 });
        const spill = await note.evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(spill <= 1, `Day note spills ${String(spill)}px`);
        // My availability in the bar: its state, inside the bar.
        const avail = h.page.locator('[data-myday-bar] [data-my-availability] > button');
        assert.match((await avail.innerText()).trim(), /Not set/);
        const box = await avail.boundingBox();
        assert.ok(box !== null && box.x >= 0 && box.x + box.width <= 390);
        // The now line and the message, as on a desktop.
        assert.equal(await h.page.locator('[data-now-line]').count(), 1);
        assert.deepEqual(await violations(h.page), []);
      } finally {
        await h.close();
      }
    });
  }
});
