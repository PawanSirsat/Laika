/**
 * My day on a busy day (LAI-810), in a real browser, on the fixture shaped
 * like the owner's production screenshots: 42 drafted blocks and 200 tasks
 * waiting on the reader's review.
 *
 * - The column beside the day is bounded: *Agent minutes*, then five of each
 *   kind of work, and a scroll of its own — the page is as long as the day.
 *   *Draft my time* is in the header since LAI-831.
 * - The drafted blocks page ten at a time, are selected a page, every page or
 *   a Shift-run at a time, and confirmed in bulk through the endpoints that
 *   exist — **never a block on nothing**, which is left out and named.
 * - Every row links to its card; a card the reader cannot see does not.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, refuse, reply, until, type Harness, type StubCall } from './harness.ts';
import { open } from './my-day-clock.ts';
import {
  ARRIVED,
  BUSY_DAY,
  DRAFTS,
  TODAY,
  UNTIED_IDS,
  busyStub,
  defaultWrites,
} from './my-day-busy.ts';

void after(async () => {
  await closeBrowser();
});

const row = (h: Harness, id: string) => h.page.locator(`li[data-draft="${id}"]`);
const tick = (h: Harness, id: string) => row(h, id).locator('input.myday-check');
const pageBox = (h: Harness) =>
  h.page.getByRole('checkbox', { name: 'Select every block on this page' });
const count = (h: Harness) => h.page.locator('[data-bulk-count]');
const said = (h: Harness) => h.page.locator('[data-bulk-said]');
/** The selection bar's Confirm (LAI-831: *Confirm*, as the owner's design names it). */
const confirmSelected = (h: Harness) =>
  h.page.locator('.myday-bulk').getByRole('button', { name: 'Confirm', exact: true });

async function busy(writes?: (call: StubCall) => unknown): Promise<Harness> {
  const h = await open('/my-day', busyStub(writes));
  await h.page.setViewportSize({ width: 1440, height: 900 });
  await h.page.locator('.myday-drafts [data-pager-label]').waitFor({ timeout: 30_000 });
  return h;
}

const posts = (h: Harness, end: string) =>
  h.calls.filter((c) => c.method === 'POST' && c.path.endsWith(end)).map((c) => c.path);
const dayReads = (h: Harness) =>
  h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/me/time').length;

void describe('the column beside the day', () => {
  void test('Agent minutes, then On your plate — bounded, scrolling on its own; the switch in the header', async () => {
    const h = await busy();
    try {
      await h.page.locator('.myday-plate .plate-groups').waitFor({ timeout: 20_000 });
      const sides = async () =>
        (
          await h.page
            .locator('[data-myday-side] > section')
            .evaluateAll((els: Element[]) => els.map((el) => el.className))
        ).map((c) => c.split(' ').find((k: string) => k !== 'myday-card'));
      // Wait for both sections, not just the plate (LAI-715).
      await until(async () => (await sides()).join('|') === 'myday-agent|myday-plate');
      assert.deepEqual(await sides(), ['myday-agent', 'myday-plate']);
      // Draft my time sits in the header, as the owner's design has it (LAI-831).
      const draftSwitch = h.page
        .locator('.screen-page')
        .getByRole('switch', { name: 'Draft my time' });
      await until(async () => (await draftSwitch.count()) === 1);
      assert.equal(await draftSwitch.count(), 1);
      // One drafted card, one confirmed — never drawn twice.
      await until(async () => (await h.page.locator('.myday-entries').count()) === 1);
      assert.equal(await h.page.locator('.myday-drafts').count(), 1);
      assert.equal(await h.page.locator('.myday-entries').count(), 1);

      const laptop = await h.page.evaluate(() => {
        const side = document.querySelector<HTMLElement>('[data-myday-side]');
        const grid = document.querySelector('.myday-grid')?.getBoundingClientRect();
        const main = document.querySelector('.myday-main')?.getBoundingClientRect();
        const scroller = document.querySelector<HTMLElement>('.shell-main');
        if (side === null || grid === undefined || main === undefined || scroller === null) {
          return null;
        }
        const before = side.getBoundingClientRect();
        scroller.scrollTop = scroller.scrollHeight;
        const scrolled = side.getBoundingClientRect();
        side.scrollTop = side.scrollHeight;
        return {
          height: before.height,
          scrollHeight: side.scrollHeight,
          clientHeight: side.clientHeight,
          ownScroll: side.scrollTop,
          gridHeight: grid.height,
          mainHeight: main.height,
          scrolledTop: scrolled.top,
          scrolledBottom: scrolled.bottom,
          position: getComputedStyle(side).position,
          overflowY: getComputedStyle(side).overflowY,
        };
      });
      assert.ok(laptop !== null);
      assert.ok(laptop.height <= 900 - 32 + 1, `the column is ${String(laptop.height)}px tall`);
      // A scroll of its own whenever it is taller than that: overflow, not the page.
      assert.equal(laptop.overflowY, 'auto', 'the column does not scroll on its own');
      if (laptop.scrollHeight > laptop.clientHeight + 1) {
        assert.ok(laptop.ownScroll > 0, 'the column is taller than it shows, and does not scroll');
      }
      assert.ok(
        laptop.gridHeight - laptop.mainHeight < 2,
        `the column runs the page on: ${String(laptop.gridHeight)} > ${String(laptop.mainHeight)}`,
      );
      assert.equal(laptop.position, 'sticky');
      assert.ok(
        laptop.scrolledTop >= -1 && laptop.scrolledBottom <= 900 + 1,
        `scrolled to the foot of the page, the column left the viewport: ${JSON.stringify(laptop)}`,
      );

      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.waitForFunction(() => document.documentElement.clientWidth === 390);
      const phone = await h.page.evaluate(() => {
        const side = document.querySelector<HTMLElement>('[data-myday-side]');
        const main = document.querySelector('.myday-main')?.getBoundingClientRect();
        if (side === null || main === undefined) return null;
        const box = side.getBoundingClientRect();
        return {
          top: box.top,
          height: box.height,
          mainBottom: main.bottom,
          overflowY: getComputedStyle(side).overflowY,
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      assert.ok(phone !== null);
      assert.ok(phone.top >= phone.mainBottom - 1, 'on a phone the column is not under the day');
      assert.ok(
        phone.height <= 844 * 0.8 + 1,
        `on a phone the column is ${String(phone.height)}px`,
      );
      assert.equal(phone.overflowY, 'auto', 'on a phone the column is not bounded');
      assert.equal(phone.sideways, 0, 'the page scrolls sideways on a phone');
    } finally {
      await h.close();
    }
  });

  void test('On your plate: five of each, the true count, and +N more where the rest live', async () => {
    const h = await busy();
    try {
      const plate = h.page.locator('.myday-plate');
      await plate.locator('.plate-groups').waitFor({ timeout: 20_000 });
      const group = (id: string) => plate.locator(`[data-plate="${id}"]`);

      await until(async () => (await group('review').locator('a.plate-item').count()) === 5);
      assert.equal(await group('review').locator('a.plate-item').count(), 5);
      // The server cut the queue at 200 (`truncated`): a floor, said as one (LAI-820).
      assert.equal(await group('review').locator('.plate-count').innerText(), '200+');
      const reviewMore = group('review').locator('[data-plate-more]');
      assert.equal(await reviewMore.innerText(), '+195 more');
      assert.equal(await reviewMore.getAttribute('href'), '/inbox?tab=review');

      await until(async () => (await group('progress').locator('a.plate-item').count()) === 5);
      assert.equal(await group('progress').locator('a.plate-item').count(), 5);
      assert.equal(await group('progress').locator('.plate-count').innerText(), '10');
      // The five hidden are in two spaces: one link each, naming it (review round 1).
      const progressMore = group('progress').locator('[data-plate-more]');
      await until(
        async () => (await progressMore.allInnerTexts()).join('|') === '+3 in Atlas|+2 in Onroute',
      );
      assert.deepEqual(await progressMore.allInnerTexts(), ['+3 in Atlas', '+2 in Onroute']);
      assert.deepEqual(
        await progressMore.evaluateAll((els: Element[]) =>
          els.map((el) => el.getAttribute('href')),
        ),
        [
          '/list?project=atlas&assignee=u1&status=in_progress',
          '/list?project=onroute&assignee=u1&status=in_progress',
        ],
      );

      assert.equal(await group('blocked').locator('a.plate-item').count(), 2);
      assert.equal(await group('blocked').locator('[data-plate-more]').count(), 0);

      // The shell's queue, not a second read of it; and the spaces read once.
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/review').length, 1);
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/projects').length, 1);

      await reviewMore.click();
      await h.page.waitForURL(
        (url) => url.pathname === '/inbox' && url.searchParams.get('tab') === 'review',
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the drafted blocks', () => {
  void test('page ten at a time, with no scroll of their own; the confirmed ones too', async () => {
    const h = await busy();
    try {
      const card = h.page.locator('.myday-drafts');
      const label = card.locator('[data-pager-label]');
      const prev = card.getByRole('button', { name: '‹ Prev' });
      const next = card.getByRole('button', { name: 'Next ›' });
      const ids = () =>
        card
          .locator('li[data-draft]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-draft')));

      assert.equal(await label.innerText(), '1–10 of 42');
      assert.deepEqual(
        await ids(),
        DRAFTS.slice(0, 10).map((d) => d.id),
      );
      assert.equal(await prev.isDisabled(), true);

      await next.click();
      await until(async () => (await label.innerText()) === '11–20 of 42');
      assert.equal(await label.innerText(), '11–20 of 42');
      assert.deepEqual(
        await ids(),
        DRAFTS.slice(10, 20).map((d) => d.id),
      );

      for (let i = 0; i < 3; i += 1) await next.click();
      await until(async () => (await label.innerText()) === '41–42 of 42');
      assert.equal(await label.innerText(), '41–42 of 42');
      assert.equal(await next.isDisabled(), true);

      // The page of ten is the bound; a scroll of its own kept the wheel from the page (LAI-311).
      const area = await card.locator('.myday-scroll').evaluate((el) => ({
        overflow: getComputedStyle(el).overflowY,
        hidden: el.scrollHeight - el.clientHeight,
      }));
      assert.equal(area.overflow, 'visible', 'the drafted list scrolls on its own');
      assert.ok(area.hidden <= 1, `the drafted list hides ${String(area.hidden)}px`);

      // Fourteen confirmed entries, a page of ten — the owner's design lists them.
      const entries = h.page.locator('.myday-entries');
      assert.equal(
        await entries.locator('[data-confirmed-caption]').innerText(),
        '14 entries · 1 h 52 min',
      );
      assert.equal(await entries.locator('li[data-entry]').count(), 10);
      assert.equal(await entries.locator('.myday-pager-label').innerText(), '1–10 of 14');
    } finally {
      await h.close();
    }
  });

  void test('select-all takes the page, then offers every page; Shift selects a run; Space ticks one', async () => {
    const h = await busy();
    try {
      await pageBox(h).click();
      await count(h).waitFor({ timeout: 5_000 });
      // d01–d10 are 15 to 19 minutes, twice over.
      assert.equal(await count(h).innerText(), '10 selected · 2 h 50 min');

      const everyPage = h.page.getByRole('button', { name: 'Select all 42 drafted' });
      await everyPage.click();
      await until(async () => (await count(h).innerText()).startsWith('42'));
      assert.equal(await count(h).innerText(), '42 selected · 11 h 51 min');
      assert.equal(await everyPage.count(), 0, 'every page is selected, and it is still offered');

      await h.page.getByRole('button', { name: 'Clear' }).click();
      await until(async () => (await count(h).count()) === 0);
      assert.equal(await count(h).count(), 0);

      await tick(h, 'd02').click();
      await tick(h, 'd06').click({ modifiers: ['Shift'] });
      await until(async () => (await count(h).innerText()).startsWith('5 '));
      const ticked = async () =>
        Promise.all(
          ['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07'].map((id) => tick(h, id).isChecked()),
        );
      assert.deepEqual(await ticked(), [false, true, true, true, true, true, false]);

      // Shift-click a ticked one: the run back to it is unticked.
      await tick(h, 'd04').click({ modifiers: ['Shift'] });
      await until(async () => (await count(h).innerText()).startsWith('2 '));
      assert.deepEqual(await ticked(), [false, true, true, false, false, false, false]);

      await tick(h, 'd08').focus();
      await h.page.keyboard.press('Space');
      await until(async () => (await count(h).innerText()).startsWith('3 '));
      assert.equal(await tick(h, 'd08').isChecked(), true);
      assert.equal(
        await tick(h, 'd08').getAttribute('aria-label'),
        'Select 8:20–8:37 AM, LAI-2 Webhook retries back off',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('confirming in bulk', () => {
  void test('Confirm selected leaves out a block on nothing, names it, and re-reads the day once', async () => {
    const h = await busy();
    try {
      await pageBox(h).click();
      assert.equal(
        await h.page.locator('[data-bulk-needcard]').innerText(),
        '1 needs a card or General — left out of Confirm',
      );
      const reads = dayReads(h);

      await confirmSelected(h).click();
      await said(h).waitFor({ timeout: 20_000 });

      const page1 = DRAFTS.slice(0, 10).map((d) => d.id);
      assert.deepEqual(
        posts(h, '/confirm'),
        page1.filter((id) => id !== 'd04').map((id) => `/api/v1/me/time-drafts/${id}/confirm`),
        'a block on nothing was sent, or a block was missed',
      );
      assert.equal(
        await said(h).innerText(),
        'Confirmed 9 blocks. Left out, still selected — 1 needs a card or General: 7:00–7:18 AM.',
      );
      // The one left out stays selected, to be put on a card next.
      assert.equal(await count(h).innerText(), '1 selected · 18 min');
      assert.equal(await tick(h, 'd04').isChecked(), true);

      // One re-read for the whole batch, not one per block.
      await until(() => dayReads(h) > reads);
      await h.page.waitForTimeout(400);
      assert.equal(dayReads(h), reads + 1);
    } finally {
      await h.close();
    }
  });

  void test('a partial failure leaves the failed blocks selected and says why', async () => {
    const refused = new Set([
      '/api/v1/me/time-drafts/d02/confirm',
      '/api/v1/me/time-drafts/d05/confirm',
    ]);
    const h = await busy((call) =>
      refused.has(call.path)
        ? refuse(500, 'internal', 'The entry could not be written.')
        : defaultWrites(call),
    );
    try {
      await pageBox(h).click();
      await confirmSelected(h).click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.equal(await said(h).getAttribute('role'), 'alert');
      assert.equal(
        await said(h).innerText(),
        'Confirmed 7 blocks. 2 blocks did not save and stay selected: The entry could not be written. ' +
          'Left out, still selected — 1 needs a card or General: 7:00–7:18 AM.',
      );
      await until(async () => (await count(h).innerText()).startsWith('3 '));
      assert.match(await count(h).innerText(), /^3 selected/);
      for (const id of ['d02', 'd04', 'd05']) assert.equal(await tick(h, id).isChecked(), true, id);
      assert.equal(await tick(h, 'd01').isChecked(), false);
    } finally {
      await h.close();
    }
  });

  void test('every block ticked is still confirmed by id — never the day the server holds (B1)', async () => {
    // The page shows the 36 blocks on a card; the server's day also holds one
    // that arrived since, on nothing — confirm-day would make it General.
    const page = { ...BUSY_DAY, drafts: DRAFTS.filter((d) => !UNTIED_IDS.includes(d.id)) };
    const server = [...page.drafts, ARRIVED];
    const h = await open(
      '/my-day',
      busyStub((call) => defaultWrites(call, server), page),
    );
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await pageBox(h).waitFor({ timeout: 30_000 });
      await pageBox(h).click();
      await h.page.getByRole('button', { name: 'Select all 36 drafted' }).click();
      await until(async () => (await count(h).innerText()).startsWith('36 '));
      await confirmSelected(h).click();
      await said(h).waitFor({ timeout: 60_000 });

      const sent = posts(h, '/confirm');
      assert.ok(!sent.some((p) => p.includes('/time/days/')), 'Confirm selected confirmed the day');
      assert.ok(!sent.some((p) => p.includes('/dx/')), 'a block nobody saw was confirmed');
      assert.deepEqual(
        sent,
        page.drafts.map((d) => `/api/v1/me/time-drafts/${d.id}/confirm`),
      );
      assert.equal(await said(h).innerText(), 'Confirmed 36 blocks.');
    } finally {
      await h.close();
    }
  });

  void test('blocks that changed since the page loaded are one sentence, and not kept selected', async () => {
    const h = await busy((call) =>
      call.path.endsWith('/d02/confirm') || call.path.endsWith('/d03/confirm')
        ? refuse(404, 'not_found', `No draft "${call.path.split('/')[5] ?? ''}"`)
        : defaultWrites(call),
    );
    try {
      await pageBox(h).click();
      await confirmSelected(h).click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.equal(
        await said(h).innerText(),
        'Confirmed 7 blocks. 2 blocks changed since this page loaded — reloaded; please review again. ' +
          'Left out, still selected — 1 needs a card or General: 7:00–7:18 AM.',
      );
      // Only the one left out: the two that changed are not claimed as selected.
      await until(async () => (await count(h).innerText()).startsWith('1 '));
      assert.equal(await count(h).innerText(), '1 selected · 18 min');
      assert.equal(await tick(h, 'd02').isChecked(), false);
    } finally {
      await h.close();
    }
  });

  void test('Confirm day, every block ready: one request, and a server day that differs is said', async () => {
    const page = { ...BUSY_DAY, drafts: DRAFTS.filter((d) => !UNTIED_IDS.includes(d.id)) };
    const server = [...page.drafts, ARRIVED];
    const h = await open(
      '/my-day',
      busyStub((call) => defaultWrites(call, server), page),
    );
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      const button = h.page.locator('.screen-page .myday-chip-primary');
      await button.waitFor({ timeout: 30_000 });
      assert.equal(await button.innerText(), 'Confirm day · 10 h 8 min');
      const reads = dayReads(h);
      await button.click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.deepEqual(posts(h, '/confirm'), [`/api/v1/me/time/days/${TODAY}/confirm`]);
      assert.equal(await said(h).getAttribute('role'), 'alert');
      assert.equal(
        await said(h).innerText(),
        'Confirmed the day: 37 blocks, 10 h 28 min. 1 block more arrived since this page loaded and was ' +
          'confirmed too. 1 block on no card was confirmed as General — change it under Confirmed ' +
          'if it belongs on one.',
      );
      assert.doesNotMatch(await said(h).innerText(), /selected/);
      await until(() => dayReads(h) > reads);
      assert.equal(dayReads(h), reads + 1, 'the day was not re-read');
    } finally {
      await h.close();
    }
  });

  void test('Confirm day with blocks on nothing: exactly how many were confirmed, and why the rest were left', async () => {
    const h = await busy();
    try {
      const button = h.page.locator('.screen-page .myday-chip-primary');
      assert.equal(await button.innerText(), 'Confirm 36 ready · 10 h 8 min');
      await button.click();
      await said(h).waitFor({ timeout: 60_000 });
      const sent = posts(h, '/confirm');
      assert.equal(sent.length, 36);
      assert.ok(!sent.some((p) => p.includes('/time/days/')), 'the day was confirmed whole');
      for (const id of UNTIED_IDS) {
        assert.ok(!sent.includes(`/api/v1/me/time-drafts/${id}/confirm`), `${id} was confirmed`);
      }
      const text = await said(h).innerText();
      assert.match(
        text,
        /^Confirmed 36 of 42 blocks; 6 left drafted — 6 need a card or General \(7:00–7:18 AM, 9:20–9:35 AM, /,
      );
      assert.doesNotMatch(text, /selected/, 'the header selects nothing');
    } finally {
      await h.close();
    }
  });

  void test('Confirm day that fills the day part-way stops there and says so', async () => {
    const h = await busy((call) =>
      call.path.endsWith('/d20/confirm')
        ? reply(422, {
            error: {
              code: 'unprocessable',
              message: `That would put 1452 minutes on ${TODAY}; a day holds 1440`,
              details: { reason: 'day_full', field: 'minutes' },
            },
          })
        : defaultWrites(call),
    );
    try {
      await h.page.locator('.screen-page .myday-chip-primary').click();
      await said(h).waitFor({ timeout: 60_000 });
      // d01–d19 less the three on nothing, then d20; nothing after it is sent.
      assert.equal(posts(h, '/confirm').length, 17);
      assert.equal(
        await said(h).innerText(),
        'Confirmed 16 of 42 blocks; 26 left drafted — 6 need a card or General (7:00–7:18 AM, ' +
          '9:20–9:35 AM, 11:40–11:57 AM, 2:00–2:19 PM, 4:20–4:36 PM and 1 more); 20 blocks from ' +
          '12:20–12:39 PM on would put more than 24 hours on the day.',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the bar acts at once, and Undo takes it back (LAI-831)', () => {
  void test('Not work goes at once, says so, and Undo asks the server for each block, newest first', async () => {
    const h = await busy();
    try {
      await tick(h, 'd01').click();
      await tick(h, 'd02').click();
      await h.page.locator('.myday-bulk').getByRole('button', { name: 'Not work' }).click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.deepEqual(posts(h, '/dismiss'), [
        '/api/v1/me/time-drafts/d01/dismiss',
        '/api/v1/me/time-drafts/d02/dismiss',
      ]);
      assert.equal(await said(h).innerText(), 'Marked 2 blocks as not work.');
      await h.page.locator('[data-toast]').getByRole('button', { name: 'Undo' }).click();
      await until(() => posts(h, '/time/undo').length === 2);
      assert.deepEqual(
        h.calls.filter((c) => c.path === '/api/v1/me/time/undo').map((c) => c.body),
        [
          { id: 'u:POST:/api/v1/me/time-drafts/d02/dismiss' },
          { id: 'u:POST:/api/v1/me/time-drafts/d01/dismiss' },
        ],
      );
    } finally {
      await h.close();
    }
  });

  void test('General moves every ticked block — on a card or not — and Undo puts each back', async () => {
    const h = await busy();
    try {
      const patches = () =>
        h.calls.filter((c) => c.method === 'PATCH').map((c) => c.path.split('/').pop());
      await tick(h, 'd01').click();
      await tick(h, 'd04').click();
      await h.page
        .locator('.myday-bulk')
        .getByRole('button', { name: 'General', exact: true })
        .click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.deepEqual(patches(), ['d01', 'd04']);
      assert.equal(await said(h).innerText(), 'Moved 2 blocks to General.');
      await h.page.locator('[data-toast]').getByRole('button', { name: 'Undo' }).click();
      await until(() => posts(h, '/time/undo').length === 2);
      assert.deepEqual(
        h.calls.filter((c) => c.path === '/api/v1/me/time/undo').map((c) => c.body),
        [
          { id: 'u:PATCH:/api/v1/me/time-drafts/d04' },
          { id: 'u:PATCH:/api/v1/me/time-drafts/d01' },
        ],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('while a batch runs', () => {
  void test('the day cannot be changed and no time added; both come back after', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await busy();
    try {
      await h.page.route('**/api/v1/me/time-drafts/d02/confirm', async (route) => {
        await held;
        await route.continue();
      });
      await tick(h, 'd01').click();
      await tick(h, 'd02').click();
      await confirmSelected(h).click();
      const progress = h.page.locator('.myday-bulk-progress');
      await progress.waitFor({ timeout: 10_000 });

      const add = h.page.locator('[data-add-submit]');
      const previous = h.page.getByRole('button', { name: 'Previous week' });
      // An earlier day of this week, when there is one (there is none on a Monday).
      const earlier = h.page.locator('.myday-week-day.myday-week-confirmed');
      assert.equal(await add.isDisabled(), true, 'time can be added mid-batch');
      assert.equal(await previous.isDisabled(), true, 'the week can be changed mid-batch');
      if ((await earlier.count()) > 0) {
        assert.equal(
          await earlier.first().isDisabled(),
          true,
          'another day can be opened mid-batch',
        );
      }

      release();
      await said(h).waitFor({ timeout: 20_000 });
      await until(async () => !(await add.isDisabled()));
      assert.equal(await add.isDisabled(), false);
      assert.equal(await previous.isDisabled(), false);
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'wait' });
      await h.close();
    }
  });
});

void describe('names a screen reader can tell apart', () => {
  void test('blocks with no set time are named by their place in the day and how long', async () => {
    const untimed = (d: (typeof DRAFTS)[number]) => ({ ...d, started_at: null, ended_at: null });
    const drafts = DRAFTS.slice(0, 2).map(untimed);
    const h = await open('/my-day', busyStub(undefined, { ...BUSY_DAY, drafts }));
    try {
      await h.page.locator('li[data-draft]').first().waitFor({ timeout: 30_000 });
      const expected = [
        'Select block 1 of 2, no set time, 15 min, LAI-1 Search matches keys',
        'Select block 2 of 2, no set time, 16 min, LAI-2 Webhook retries back off',
      ];
      const labels = () =>
        h.page
          .locator('li[data-draft] input.myday-check')
          .evaluateAll((els: Element[]) => els.map((el) => el.getAttribute('aria-label')));
      // Wait for both rows, not the first (LAI-715).
      await until(async () => (await labels()).join('|') === expected.join('|'));
      const names = await labels();
      assert.deepEqual(names, expected);
      const rows = await h.page
        .locator('li[data-draft] [data-select]')
        .evaluateAll((els: Element[]) => els.map((el) => el.getAttribute('aria-label')));
      assert.equal(new Set(rows).size, 2, `rows share a name: ${JSON.stringify(rows)}`);
    } finally {
      await h.close();
    }
  });
});

void describe('every row is connected to its card (LAI-810, the owner)', () => {
  void test('a known card is a link to it in its own space; one the reader cannot see is not', async () => {
    const h = await busy();
    try {
      const link = row(h, 'd01').locator('.myday-row-target a.myday-cardlink');
      assert.equal(await link.getAttribute('href'), '/board?project=atlas&task=t1');
      assert.equal(await link.innerText(), 'LAI-1 Search matches keys');
      // On nothing: words, never a dead link.
      assert.equal(await row(h, 'd04').locator('.myday-row-target a').count(), 0);

      await h.page.locator('.myday-drafts').getByRole('button', { name: 'Next ›' }).click();
      const hidden = row(h, 'd11').locator('.myday-row-target');
      await hidden.waitFor({ timeout: 5_000 });
      assert.equal(await hidden.locator('a').count(), 0, 'a card the reader cannot see is a link');
      assert.match(await hidden.innerText(), /LAI-758 was named — a card you can’t read/);

      // Confirmed entries — imported from Solidtime too — and agent minutes.
      const entry = (id: string) => h.page.locator(`li[data-entry="${id}"]`);
      await entry('e01').waitFor({ timeout: 5_000 });
      assert.equal(
        await entry('e01').locator('a.myday-cardlink').getAttribute('href'),
        '/board?project=atlas&task=t3',
      );
      assert.equal(
        await entry('e02').locator('a.myday-cardlink').getAttribute('href'),
        '/board?project=atlas&task=t4',
      );
      assert.match(await entry('e02').innerText(), /Solidtime/);
      assert.equal(await entry('e03').locator('a').count(), 0, 'General is a link');
      // Agent minutes: a link only to a card the reader can read, in its space.
      const agent = h.page.locator('.myday-agent');
      assert.equal(
        await agent.locator('a.myday-cardlink').first().getAttribute('href'),
        '/board?project=atlas&task=t1',
      );
      await until(async () => (await agent.locator('a.myday-cardlink').count()) === 6);
      assert.equal(await agent.locator('a.myday-cardlink').count(), 6);
      const secret = agent.locator('li', { hasText: 'SEC-9' });
      assert.equal(await secret.locator('a').count(), 0, 'a card the reader cannot read is a link');
      assert.match(await secret.innerText(), /SEC-9 \(not a card you can see\)/);
      assert.doesNotMatch(await agent.innerText(), /Secret plan/);

      // By keyboard, as a link is.
      await h.page.locator('.myday-drafts').getByRole('button', { name: '‹ Prev' }).click();
      await link.focus();
      await h.page.keyboard.press('Enter');
      await h.page.waitForURL(
        (url) =>
          url.pathname === '/board' &&
          url.searchParams.get('project') === 'atlas' &&
          url.searchParams.get('task') === 't1',
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('the inspector holds the rest, by keyboard; an import has nothing to change here', async () => {
    const h = await busy();
    try {
      // A row is picked by keyboard, and its block opens in the inspector.
      await h.page.locator('[data-select="d01"]').focus();
      await h.page.keyboard.press('Enter');
      const inspector = h.page.locator('[data-inspector-for="d01"]');
      await inspector.waitFor({ timeout: 5_000 });
      assert.match(await inspector.innerText(), /6:00–6:15 AM/);
      for (const name of [
        'Not work',
        'Shorter by 5 minutes',
        'Longer by 5 minutes',
        'Split in two',
      ]) {
        await until(async () => (await inspector.getByRole('button', { name }).count()) === 1);
        assert.equal(await inspector.getByRole('button', { name }).count(), 1, name);
      }
      // Other card… opens the field, and focus is in it.
      await inspector.getByRole('button', { name: 'Other card…' }).focus();
      await h.page.keyboard.press('Enter');
      await until(() => h.page.evaluate(() => document.activeElement?.tagName === 'INPUT'));
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Another card’s key',
      );

      // LAI-788: an entry from Solidtime is read here and changed there.
      await h.page.locator('[data-select="e02"]').click();
      const imported = h.page.locator('[data-inspector-for="e02"]');
      await imported.waitFor({ timeout: 5_000 });
      assert.match(await imported.innerText(), /change it in Solidtime/);
      assert.equal(await imported.getByRole('button', { name: 'Delete' }).count(), 0);
      assert.equal(await imported.getByRole('button', { name: 'Longer by 5 minutes' }).count(), 0);
      await h.page.locator('[data-select="e01"]').click();
      const own = h.page.locator('[data-inspector-for="e01"]');
      await own.waitFor({ timeout: 5_000 });
      await until(async () => (await own.getByRole('button', { name: 'Delete' }).count()) === 1);
      assert.equal(await own.getByRole('button', { name: 'Delete' }).count(), 1);
    } finally {
      await h.close();
    }
  });
});
