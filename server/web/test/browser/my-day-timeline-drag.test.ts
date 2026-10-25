import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  setTheme,
  until,
  withHeaders,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open, NOW, TODAY } from './my-day-clock.ts';
import { zoomTo } from './my-day-zoom.ts';
import { AGENT, at, CARD_A, weekData, weekStub } from './my-day-week.ts';

/**
 * The Timeline card as the owner's `TimelineV2.dc.html` draws it (LAI-512):
 * one header row with the legend inline and no footer; a block moved whole
 * or resized by its body, on the five-minute grid, with its words above it
 * and a refusal that bounces it back; a tray item dropped onto the track;
 * Alt+arrows moving the focused block; the running timer on the track and
 * the now line at its end. Every write is recorded and its body asserted.
 *
 * Today's fixture: d1 8:40–10:15, d2 10:40–11:20, e1 11:30–12:00 and e2
 * 12:00–12:30 confirmed, d3 1:00–2:50, d4 3:30–4:10, d5 25 min with no set
 * time; now is 3:00 PM.
 */

function stub(
  writes: StubCall[],
  timer: unknown = null,
  extra: Record<string, unknown> = {},
): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  const base = routes[`/api/v1/me/time?day=${TODAY}`] as () => Record<string, unknown>;
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({ ...base(), timer, ...extra });
  const record = (call: StubCall) => {
    if (call.method !== 'GET') writes.push(call);
  };
  for (const id of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    routes[`/api/v1/me/time-drafts/${id}`] = (call: StubCall) => {
      record(call);
      return withHeaders({ id }, { 'X-Undo-Id': `u-${id}` });
    };
  }
  for (const id of ['e1', 'e2']) {
    routes[`/api/v1/me/time-entries/${id}`] = (call: StubCall) => {
      record(call);
      return { id };
    };
  }
  return routes;
}

async function myDay(
  writes: StubCall[],
  timer: unknown = null,
  extra: Record<string, unknown> = {},
): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(writes, timer, extra), {
    before: async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
    },
  });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-block-id]').first().waitFor({ timeout: 10_000 });
  await zoomTo(h.page, 1);
  return h;
}

/** The page x of a minute of the day along the track, as drawn. */
async function xOf(page: Page, minute: number): Promise<number> {
  const track = page.locator('[data-dayline-track]');
  const box = await track.boundingBox();
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  assert.ok(box !== null, 'the track has no box');
  return box.x + ((minute - from * 60) / ((to - from) * 60)) * box.width;
}

/** Scroll the track so `minute` sits a little in from the left edge. */
async function show(h: Harness, minute: number): Promise<void> {
  const track = h.page.locator('[data-dayline-track]');
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  const width = await track.evaluate((el) => el.scrollWidth);
  const left = ((minute - from * 60) / ((to - from) * 60)) * width - 200;
  await h.page.locator('.dayline-scroller').evaluate((el, px) => {
    el.scrollLeft = Math.max(0, px);
  }, left);
  // The scroll event lands a frame later and clears any hover (a scroll moves
  // what is under the pointer): let it land before the pointer arrives, or a
  // hover made in between is cleared and the block shows no edges.
  await h.page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

const patches = (writes: StubCall[]) => writes.filter((w) => w.method === 'PATCH');

/** What `sel` says now; '' while it is not on the page. Never waits. */
const words = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s) => document.querySelector<HTMLElement>(s)?.innerText ?? '', sel);

/**
 * `sel`'s words once they say `want`. A drag's words appear on its first
 * move and change on every one after, and the last move can still be
 * rendering when the mouse call returns: waiting for the words to exist
 * read the first move's (LAI-512). Fails with what they said instead.
 */
async function settlesOn(page: Page, sel: string, want: RegExp): Promise<void> {
  await until(async () => want.test(await words(page, sel)));
  assert.match(await words(page, sel), want);
}

after(async () => {
  await closeBrowser();
});

void describe('the Timeline card as TimelineV2 draws it (LAI-512)', () => {
  void test('one header row, a 16px card, the D-113 zoom controls, Marks in the column, nothing in it cut, no footer', async () => {
    const writes: StubCall[] = [];
    // With every lane the column names: SIGNALS (the server's times), YOU, AGENTS.
    const h = await myDay(writes, null, {
      signal_times: { prompts: [[at(TODAY, 9, 10), 2]], commits: [[at(TODAY, 9, 40), 1]] },
      agent: {
        ...AGENT,
        lane: [
          [at(TODAY, 9, 0), 300, 300],
          [at(TODAY, 9, 5), 240, 0],
        ],
      },
    });
    try {
      const top = async (sel: string) => (await h.page.locator(sel).boundingBox())?.y ?? -1;
      const title = await top('.dayline-head-title');
      assert.ok(Math.abs((await top('.dayline-totals')) - title) <= 4, 'the legend wraps');
      assert.ok(Math.abs((await top('.dayline-nav')) - title) <= 4, 'the controls wrap');
      assert.equal(
        await h.page.locator('[data-dayline]').evaluate((el) => getComputedStyle(el).borderRadius),
        '16px',
      );
      // The zoom controls beside ‹ Now › (D-113, LAI-300): the Time zoom slider,
      // Fit day and one Expand all toggle — the stepper, the three presets, the
      // row-height slider and its grip are gone.
      const zooms = h.page.locator('.dayline-zooms');
      assert.equal(await zooms.getByRole('slider', { name: 'Time zoom' }).count(), 1);
      assert.deepEqual(
        await zooms.getByRole('button').evaluateAll((els) => els.map((el) => el.textContent)),
        ['Fit day', 'Expand all'],
      );
      assert.equal(
        await h.page
          .locator('[data-zoom-step], [data-zoom], [data-row-slider], [data-row-grip]')
          .count(),
        0,
      );
      assert.equal((await h.page.locator('[data-mark-total]').innerText()).trim(), '1');
      assert.equal(await h.page.locator('[data-agent-work]').innerText(), '9 min');
      // Nothing in the lane column is cut at 1440: no cell's words run past
      // its bottom, and no line inside one is squeezed or clipped. Text alone
      // cannot show this — a line squeezed to a pixel still reads back whole.
      const cut = await h.page.locator('.dayline-labels').evaluate((column) =>
        [...column.querySelectorAll<HTMLElement>('.dayline-lane-label, .dayline-lane-label *')]
          .filter((el) => (el.textContent ?? '').trim() !== '')
          .filter(
            (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
          )
          .map((el) => `${el.className}: ${(el.textContent ?? '').trim().slice(0, 24)}`),
      );
      assert.deepEqual(cut, []);
      assert.equal(await h.page.locator('.dayline-label-signals .dayline-lane-row').count(), 3);
      assert.equal(await h.page.locator('.dayline-foot').count(), 0);
      assert.equal((await h.page.locator('[data-axis-note]').innerText()).trim(), '');
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: a block dragged by its body moves whole on the grid, says where it is, and writes both edges with Undo`, async () => {
      const writes: StubCall[] = [];
      const h = await myDay(writes);
      try {
        await setTheme(h.page, theme);
        // d3 1:00–2:50, by +30 min.
        await show(h, 12 * 60 + 30);
        const body = h.page.locator('[data-block-select="d3"]');
        const box = await body.boundingBox();
        assert.ok(box !== null);
        const y = box.y + box.height / 2;
        const x0 = await xOf(h.page, 13 * 60 + 55);
        const x1 = await xOf(h.page, 14 * 60 + 25);
        await h.page.mouse.move(x0, y);
        await h.page.mouse.down();
        await h.page.mouse.move(x1, y, { steps: 8 });
        // In hand: the block has moved, its old place is a ghost, its words are above it.
        await settlesOn(h.page, '[data-drag-label]', /^1:30–3:20 PM · 1 h 50 min$/);
        assert.equal(await h.page.locator('[data-drag-ghost]').count(), 1);
        const moved = await h.page.locator('[data-block-id="d3"]').boundingBox();
        assert.ok(moved !== null);
        assert.ok(Math.abs(moved.x - (await xOf(h.page, 13 * 60 + 30))) <= 2, 'not at 1:30');
        await h.page.mouse.up();
        await until(() => patches(writes).length === 1);
        assert.deepEqual(patches(writes)[0], {
          method: 'PATCH',
          path: '/api/v1/me/time-drafts/d3',
          body: { minutes: 110, started_at: at(TODAY, 13, 30), ended_at: at(TODAY, 15, 20) },
        });
        assert.equal(await h.page.locator('[data-drag-ghost]').count(), 0);
        const toast = h.page.locator('[data-toast]');
        await toast.waitFor({ timeout: 5_000 });
        assert.match(await toast.innerText(), /Moved LAI-13 to 1:30–3:20 PM\./);
        assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 1);
        // A drag is not a click: nothing opened.
        assert.equal(await h.page.locator('[data-myday-drawer]').count(), 0);
        assert.match(
          await h.page.locator('[data-dayline-live]').innerText(),
          /^Saved, 1:30–3:20 PM$/,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('an edge within 9px of the end resizes it; the write carries that edge and the minutes', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      // d1 8:40–10:15: its end to 10:35.
      await show(h, 8 * 60);
      const body = h.page.locator('[data-block-select="d1"]');
      const box = await body.boundingBox();
      assert.ok(box !== null);
      const y = box.y + box.height / 2;
      const x = box.x + box.width - 4;
      await h.page.mouse.move(x, y);
      // As a person does it: the pointer over the block shows its edges, and
      // the press lands on the end's handle — which must outlive the hover the
      // drag's first move clears, or the rest of the drag is lost.
      await h.page.locator('[data-block-id="d1"] [data-edge="end"]').waitFor({ timeout: 5_000 });
      assert.equal(
        await h.page.evaluate(
          ([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.getAttribute('data-edge'),
          [x, y],
        ),
        'end',
      );
      await h.page.mouse.down();
      await h.page.mouse.move((await xOf(h.page, 10 * 60 + 35)) - 4, y, { steps: 8 });
      await settlesOn(h.page, '[data-drag-label]', /^8:40–10:35 AM · 1 h 55 min$/);
      await h.page.mouse.up();
      await until(() => patches(writes).length === 1);
      assert.deepEqual(patches(writes)[0]?.body, { minutes: 115, ended_at: at(TODAY, 10, 35) });
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });
      assert.match(
        await h.page.locator('[data-toast]').innerText(),
        /Changed LAI-11 to 8:40–10:35 AM\./,
      );
    } finally {
      await h.close();
    }
  });

  void test('over confirmed time the words turn red and name the block, and the drop bounces back with nothing written', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      // e1 11:30–12:00 (confirmed) by +15 min: over e2 12:00–12:30.
      await show(h, 11 * 60);
      const body = h.page.locator('[data-block-select="e1"]');
      const box = await body.boundingBox();
      assert.ok(box !== null);
      const y = box.y + box.height / 2;
      const before = (await h.page.locator('[data-block-id="e1"]').boundingBox())?.x ?? -1;
      await h.page.mouse.move(await xOf(h.page, 11 * 60 + 45), y);
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 12 * 60), y, { steps: 8 });
      await settlesOn(h.page, '[data-drag-label]', /^Overlaps LAI-12, 12:00–12:30 PM$/);
      assert.equal(await h.page.locator('[data-block-id="e2"].dayline-conflict').count(), 1);
      assert.equal(await h.page.locator('[data-block-id="e1"].dayline-drag-bad').count(), 1);
      await h.page.mouse.up();
      // Back where it was; the refusal stays a moment, in red; nothing written.
      await settlesOn(
        h.page,
        '[data-drag-refused]',
        /^Overlaps LAI-12, 12:00–12:30 PM · moved back$/,
      );
      const after = (await h.page.locator('[data-block-id="e1"]').boundingBox())?.x ?? -2;
      assert.ok(Math.abs(after - before) <= 1, 'the block did not bounce back');
      assert.equal(patches(writes).length, 0);
      await until(async () => (await h.page.locator('[data-drag-refused]').count()) === 0, 4_000);
    } finally {
      await h.close();
    }
  });

  void test('a draft dragged over confirmed time lands there and is written — the design lets a draft go anywhere (LAI-510)', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      // d2 10:40–11:20, drafted, by +45 min: over e1 11:30–12:00, confirmed.
      await show(h, 10 * 60);
      const body = h.page.locator('[data-block-select="d2"]');
      const box = await body.boundingBox();
      assert.ok(box !== null);
      const y = box.y + box.height / 2;
      await h.page.mouse.move(await xOf(h.page, 11 * 60), y);
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 11 * 60 + 45), y, { steps: 8 });
      await settlesOn(h.page, '[data-drag-label]', /^11:25 AM–12:05 PM · 40 min$/);
      assert.equal(await h.page.locator('.dayline-conflict').count(), 0);
      assert.equal(await h.page.locator('[data-block-id="d2"].dayline-drag-bad').count(), 0);
      await h.page.mouse.up();
      await until(() => patches(writes).length === 1);
      assert.deepEqual(patches(writes)[0], {
        method: 'PATCH',
        path: '/api/v1/me/time-drafts/d2',
        body: { minutes: 40, started_at: at(TODAY, 11, 25), ended_at: at(TODAY, 12, 5) },
      });
      assert.equal(await h.page.locator('[data-drag-refused]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Alt+← → move the focused block five minutes, Shift fifteen; Enter saves, Escape cancels', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await show(h, 10 * 60);
      const body = h.page.locator('[data-block-select="d2"]');
      await body.focus();
      // d2 10:40–11:20: two steps right, then saved.
      await h.page.keyboard.press('Alt+ArrowRight');
      await h.page.keyboard.press('Alt+ArrowRight');
      await until(async () =>
        /^10:50–11:30 AM\. Enter to save, Escape to cancel\.$/.test(
          await h.page.locator('[data-dayline-live]').innerText(),
        ),
      );
      assert.equal(await h.page.locator('[data-drag-ghost]').count(), 1);
      await h.page.keyboard.press('Enter');
      await until(() => patches(writes).length === 1);
      assert.deepEqual(patches(writes)[0]?.body, {
        minutes: 40,
        started_at: at(TODAY, 10, 50),
        ended_at: at(TODAY, 11, 30),
      });
      // Enter saved the move; it did not confirm the draft.
      assert.equal(
        writes.some((w) => w.path.endsWith('/confirm')),
        false,
      );
      // The write has answered (its toast) before the next move: a block does
      // not move while a write is in flight, so a key pressed then is ignored.
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });

      // Fifteen at once lies over e1 11:30, confirmed: a draft may (the design's
      // check, LAI-510), so the words name no overlap. Escape puts it back.
      await body.focus();
      await h.page.keyboard.press('Alt+Shift+ArrowRight');
      await until(async () =>
        /^10:55–11:35 AM\. Enter to save, Escape to cancel\.$/.test(
          await h.page.locator('[data-dayline-live]').innerText(),
        ),
      );
      assert.equal(
        await h.page.locator('[data-dayline-live]').innerText(),
        '10:55–11:35 AM. Enter to save, Escape to cancel.',
      );
      await h.page.keyboard.press('Escape');
      await until(
        async () => (await h.page.locator('[data-dayline-live]').innerText()) === 'Move cancelled',
      );
      assert.equal(await h.page.locator('[data-drag-ghost]').count(), 0);
      assert.equal(patches(writes).length, 1);
      // Escape on the block let go of the move only: nothing on the page was in hand to close.
      assert.equal(await h.page.locator('[data-myday-drawer]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a tray item dragged onto the track lands centred on the pointer, on the grid, and is written its time', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      // d5, 25 min with no set time, dropped at 4:30 PM: 4:20–4:45.
      await show(h, 15 * 60 + 30);
      const item = h.page.locator('[data-tray-item="d5"]');
      assert.equal(await item.getAttribute('data-tray-draggable'), 'true');
      const from = await item.boundingBox();
      const row = await h.page.locator('[data-dayline-row]').boundingBox();
      assert.ok(from !== null && row !== null);
      const tx = await xOf(h.page, 16 * 60 + 30);
      const ty = row.y + row.height * 0.6;
      await h.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await h.page.mouse.down();
      await h.page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 - 10, {
        steps: 3,
      });
      await h.page.mouse.move(tx, ty, { steps: 10 });
      await h.page.mouse.move(tx + 1, ty, { steps: 2 });
      await settlesOn(h.page, '[data-drag-label]', /^LAI-12 · 4:20–4:45 PM · 25 min$/);
      assert.equal(await h.page.locator('[data-ext-preview="d5"]').count(), 1);
      await h.page.mouse.up();
      await until(() => patches(writes).length === 1);
      assert.deepEqual(patches(writes)[0], {
        method: 'PATCH',
        path: '/api/v1/me/time-drafts/d5',
        body: { started_at: at(TODAY, 16, 20), ended_at: at(TODAY, 16, 45) },
      });
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });
      assert.match(
        await h.page.locator('[data-toast]').innerText(),
        /Placed LAI-12 at 4:20–4:45 PM\./,
      );
      assert.equal(await h.page.locator('[data-ext-preview]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the running timer is a block on the track from its start to now, and the now line stands at its end', async () => {
    const writes: StubCall[] = [];
    // Started 2:20 PM with 50 minutes on the clock at 3:00 PM: it runs to 3:10.
    const timer = {
      started_at: at(TODAY, 14, 20),
      resumed_at: NOW - 60_000,
      paused_at: null,
      accumulated_ms: 49 * 60_000,
      tz: 'UTC',
      task: CARD_A,
      kind: null,
      title: null,
    };
    const h = await myDay(writes, timer);
    try {
      const block = h.page.locator('[data-timer-block]');
      await block.waitFor({ timeout: 5_000 });
      assert.equal(await block.getAttribute('data-timer-state'), 'running');
      assert.match(await block.innerText(), /LAI-11/);
      // The design's compact figure: `50m · running`.
      assert.match(await block.innerText(), /50m · running/);
      const box = await block.boundingBox();
      assert.ok(box !== null);
      assert.ok(Math.abs(box.x - (await xOf(h.page, 14 * 60 + 20))) <= 2, 'not at 2:20');
      assert.ok(
        Math.abs(box.x + box.width - (await xOf(h.page, 15 * 60 + 10))) <= 2,
        'not to 3:10',
      );
      const now = await h.page.locator('[data-now]').boundingBox();
      assert.ok(now !== null);
      assert.ok(
        Math.abs(now.x - (await xOf(h.page, 15 * 60 + 10))) <= 2,
        'the now line is not at the timer’s end',
      );
      assert.equal((await h.page.locator('.dayline-now-label').innerText()).trim(), '3:10 PM');
      // Its click hands the keyboard to the header's pill, where the timer's controls are.
      await block.click();
      await until(async () =>
        h.page.evaluate(
          () => document.querySelector('[data-timer]')?.contains(document.activeElement) === true,
        ),
      );
    } finally {
      await h.close();
    }
  });
});
