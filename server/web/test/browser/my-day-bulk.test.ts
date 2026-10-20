/**
 * My day on a busy day (LAI-810), in a real browser, on the fixture shaped
 * like the owner's production screenshots: 42 drafted blocks and 200 tasks
 * waiting on the reader's review.
 *
 * - The column beside the day is bounded: *Draft my time* first, five of each
 *   kind of work, and a scroll of its own — the page is as long as the day.
 * - The drafted blocks page ten at a time, are selected a page, every page or
 *   a Shift-run at a time, and confirmed in bulk through the endpoints that
 *   exist — **never a block on nothing**, which is left out and named.
 * - Every row links to its card; a card the reader cannot see does not.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type Harness, type StubCall } from './harness.ts';
import { BUSY_DAY, DRAFTS, TODAY, UNTIED_IDS, busyStub, defaultWrites } from './my-day-busy.ts';

void after(async () => {
  await closeBrowser();
});

const row = (h: Harness, id: string) => h.page.locator(`li[data-draft="${id}"]`);
const tick = (h: Harness, id: string) => row(h, id).locator('input.myday-check');
const pageBox = (h: Harness) =>
  h.page.getByRole('checkbox', { name: 'Select every block on this page' });
const count = (h: Harness) => h.page.locator('[data-bulk-count]');
const said = (h: Harness) => h.page.locator('[data-bulk-said]');

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
  void test('Draft my time first, then On your plate, then Agent minutes — bounded, scrolling on its own', async () => {
    const h = await busy();
    try {
      await h.page.locator('.myday-plate .plate-groups').waitFor({ timeout: 20_000 });
      const order = await h.page
        .locator('[data-myday-side] > section')
        .evaluateAll((els) => els.map((el) => el.className));
      assert.deepEqual(
        order.map((c) => c.split(' ').find((k) => k !== 'myday-card')),
        ['myday-settings', 'myday-plate', 'myday-agent'],
      );
      // One drafted card, one confirmed — never drawn twice.
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
        };
      });
      assert.ok(laptop !== null);
      assert.ok(laptop.height <= 900 - 32 + 1, `the column is ${String(laptop.height)}px tall`);
      assert.ok(
        laptop.scrollHeight > laptop.clientHeight + 50 && laptop.ownScroll > 0,
        'the column does not scroll on its own',
      );
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
          scrolls: side.scrollHeight > side.clientHeight,
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      assert.ok(phone !== null);
      assert.ok(phone.top >= phone.mainBottom - 1, 'on a phone the column is not under the day');
      assert.ok(
        phone.height <= 844 * 0.8 + 1,
        `on a phone the column is ${String(phone.height)}px`,
      );
      assert.ok(phone.scrolls, 'on a phone the column is not bounded');
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

      assert.equal(await group('review').locator('a.plate-item').count(), 5);
      assert.equal(await group('review').locator('.plate-count').innerText(), '200');
      const reviewMore = group('review').locator('[data-plate-more]');
      assert.equal(await reviewMore.innerText(), '+195 more');
      assert.equal(await reviewMore.getAttribute('href'), '/inbox?tab=review');

      assert.equal(await group('progress').locator('a.plate-item').count(), 5);
      assert.equal(await group('progress').locator('.plate-count').innerText(), '8');
      const progressMore = group('progress').locator('[data-plate-more]');
      assert.equal(await progressMore.innerText(), '+3 more');
      assert.equal(
        await progressMore.getAttribute('href'),
        '/list?project=atlas&assignee=u1&status=in_progress',
      );

      assert.equal(await group('blocked').locator('a.plate-item').count(), 2);
      assert.equal(await group('blocked').locator('[data-plate-more]').count(), 0);

      // The shell's queue, not a second read of it.
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/review').length, 1);

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
  void test('page ten at a time in a scroll area of their own; the confirmed ones fold to a line', async () => {
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

      const area = await card.locator('.myday-scroll').evaluate((el) => {
        const style = getComputedStyle(el);
        return { overflow: style.overflowY, max: style.maxHeight };
      });
      assert.equal(area.overflow, 'auto');
      assert.notEqual(area.max, 'none', 'the drafted list is not bounded');

      // Fourteen confirmed entries: one line until asked, then a page of ten.
      const entries = h.page.locator('.myday-entries');
      assert.equal(
        await entries.locator('[data-confirmed-caption]').innerText(),
        '14 entries · 1:52',
      );
      assert.equal(await entries.locator('li[data-entry]').count(), 0);
      const show = entries.getByRole('button', { name: 'Show them' });
      assert.equal(await show.getAttribute('aria-expanded'), 'false');
      await show.click();
      await entries.locator('li[data-entry]').first().waitFor({ timeout: 5_000 });
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
      assert.equal(await count(h).innerText(), '10 selected · 2:50');

      const everyPage = h.page.getByRole('button', { name: 'Select all 42 drafted' });
      await everyPage.click();
      await until(async () => (await count(h).innerText()).startsWith('42'));
      assert.equal(await count(h).innerText(), '42 selected · 11:51');
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
        'Select 08:20–08:37, LAI-2 Webhook retries back off',
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

      await h.page.getByRole('button', { name: 'Confirm selected' }).click();
      await said(h).waitFor({ timeout: 20_000 });

      const page1 = DRAFTS.slice(0, 10).map((d) => d.id);
      assert.deepEqual(
        posts(h, '/confirm'),
        page1.filter((id) => id !== 'd04').map((id) => `/api/v1/me/time-drafts/${id}/confirm`),
        'a block on nothing was sent, or a block was missed',
      );
      assert.equal(
        await said(h).innerText(),
        'Confirmed 9 blocks. Left out, still selected — 1 needs a card or General: 07:00–07:18.',
      );
      // The one left out stays selected, to be put on a card next.
      assert.equal(await count(h).innerText(), '1 selected · 0:18');
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
        ? refuse(422, 'unprocessable', 'That day would hold more than 24 hours.')
        : defaultWrites(call),
    );
    try {
      await pageBox(h).click();
      await h.page.getByRole('button', { name: 'Confirm selected' }).click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.equal(await said(h).getAttribute('role'), 'alert');
      assert.equal(
        await said(h).innerText(),
        'Confirmed 7 blocks. 2 blocks did not save and stay selected: That day would hold more than 24 hours. ' +
          'Left out, still selected — 1 needs a card or General: 07:00–07:18.',
      );
      await until(async () => (await count(h).innerText()).startsWith('3 '));
      assert.match(await count(h).innerText(), /^3 selected/);
      for (const id of ['d02', 'd04', 'd05']) assert.equal(await tick(h, id).isChecked(), true, id);
      assert.equal(await tick(h, 'd01').isChecked(), false);
    } finally {
      await h.close();
    }
  });

  void test('the whole day, every block ready: one confirm-day request', async () => {
    const tied = { ...BUSY_DAY, drafts: DRAFTS.filter((d) => !UNTIED_IDS.includes(d.id)) };
    const h = await open('/my-day', { ...busyStub(), '/api/v1/me/time': tied });
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      const button = h.page.locator('.screen-page .myday-chip-primary');
      await button.waitFor({ timeout: 30_000 });
      assert.match(await button.innerText(), /^Confirm day · \d+:\d\d$/);
      await button.click();
      await said(h).waitFor({ timeout: 20_000 });
      assert.deepEqual(posts(h, '/confirm'), [`/api/v1/me/time/days/${TODAY}/confirm`]);
      assert.equal(await said(h).innerText(), `Confirmed ${String(tied.drafts.length)} blocks.`);
    } finally {
      await h.close();
    }
  });

  void test('Confirm day with blocks on nothing confirms the ready ones and names the rest', async () => {
    const h = await busy();
    try {
      const button = h.page.locator('.screen-page .myday-chip-primary');
      assert.equal(await button.innerText(), 'Confirm 36 ready · 10:08');
      await button.click();
      await said(h).waitFor({ timeout: 60_000 });
      const sent = posts(h, '/confirm');
      assert.equal(sent.length, 36);
      assert.ok(!sent.some((p) => p.includes('/time/days/')), 'the day was confirmed whole');
      for (const id of UNTIED_IDS) {
        assert.ok(!sent.includes(`/api/v1/me/time-drafts/${id}/confirm`), `${id} was confirmed`);
      }
      assert.match(
        await said(h).innerText(),
        /^Confirmed 36 blocks\. Left out, still selected — 6 need a card or General: 07:00–07:18, /,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('every row is connected to its card (LAI-810, the owner)', () => {
  void test('a known card is a link to it in its own space; one the reader cannot see is not', async () => {
    const h = await busy();
    try {
      const link = row(h, 'd01').locator('.myday-block-target a.myday-cardlink');
      assert.equal(await link.getAttribute('href'), '/board?project=atlas&task=t1');
      assert.equal(await link.innerText(), 'LAI-1 Search matches keys');
      // On nothing: words, never a dead link.
      assert.equal(await row(h, 'd04').locator('.myday-block-target a').count(), 0);

      await h.page.locator('.myday-drafts').getByRole('button', { name: 'Next ›' }).click();
      const hidden = row(h, 'd11').locator('.myday-block-target');
      await hidden.waitFor({ timeout: 5_000 });
      assert.equal(await hidden.locator('a').count(), 0, 'a card the reader cannot see is a link');
      assert.match(await hidden.innerText(), /LAI-758 is not a card you can see/);

      // Confirmed entries — imported from Solidtime too — and agent minutes.
      await h.page.getByRole('button', { name: 'Show them' }).click();
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
      assert.match(await entry('e02').innerText(), /from Solidtime · Change it in Solidtime/);
      assert.equal(await entry('e03').locator('a').count(), 0, 'General is a link');
      assert.equal(
        await h.page.locator('.myday-agent a.myday-cardlink').first().getAttribute('href'),
        '/board?q=LAI-1',
      );

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

  void test('the row menu holds the rest, by keyboard, and closes on Escape', async () => {
    const h = await busy();
    try {
      const trigger = row(h, 'd01').getByRole('button', { name: 'More for 06:00–06:15' });
      await trigger.focus();
      await h.page.keyboard.press('Enter');
      const menu = h.page.getByRole('menu', { name: 'Change this block' });
      await menu.waitFor({ timeout: 5_000 });
      assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), [
        'Card…',
        'General',
        'Minutes…',
        'Split…',
        'Not work',
      ]);
      const focused = () => h.page.evaluate(() => document.activeElement?.textContent ?? '');
      assert.equal(await focused(), 'Card…');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await focused(), 'General');
      await h.page.keyboard.press('Escape');
      await until(async () => (await menu.count()) === 0);
      assert.equal(await menu.count(), 0);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'More for 06:00–06:15',
      );

      // Card… opens the field, and focus is in it.
      await h.page.keyboard.press('Enter');
      await menu.waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Enter');
      await until(() => h.page.evaluate(() => document.activeElement?.tagName === 'INPUT'));
      assert.equal(
        await h.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value),
        'LAI-1',
      );

      // LAI-788: an entry from Solidtime has History and nothing to change.
      await h.page.getByRole('button', { name: 'Show them' }).click();
      const entryMenu = async (id: string): Promise<string[]> => {
        await h.page.locator(`li[data-entry="${id}"] .myday-more`).click();
        const m = h.page.getByRole('menu', { name: 'Change this entry' });
        await m.waitFor({ timeout: 5_000 });
        const items = await m.getByRole('menuitem').allInnerTexts();
        await h.page.keyboard.press('Escape');
        await until(async () => (await m.count()) === 0);
        return items;
      };
      assert.deepEqual(await entryMenu('e02'), ['History']);
      assert.deepEqual(await entryMenu('e01'), ['Edit', 'Delete', 'History']);
    } finally {
      await h.close();
    }
  });
});
