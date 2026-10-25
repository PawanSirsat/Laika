import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { at, weekData, weekStub, type DayData } from './my-day-week.ts';
import { offered, pick } from './dropdown.ts';

/**
 * The tabs under the Timeline (the owner's design, D-110, LAI-505): Overview
 * with Day and Week, To review and Confirmed grouped by the part of the day,
 * the No set time tray, and the tab remembered per browser. Both themes.
 */

function stub(): { routes: ApiStub; data: Map<string, DayData> } {
  const data = weekData();
  const today = data.get(TODAY);
  if (today !== undefined) {
    // An untimed, typed entry for the tray, and a meeting for the figures.
    today.entries = [
      ...today.entries,
      {
        id: 'u1',
        day: TODAY,
        tz: 'UTC',
        started_at: null,
        ended_at: null,
        minutes: 20,
        source: 'manual',
        task: null,
        project: null,
        note: null,
        kind: 'thinking',
        title: 'Call with the bank',
        description: null,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'm1',
        day: TODAY,
        tz: 'UTC',
        started_at: at(TODAY, 17, 0),
        ended_at: at(TODAY, 17, 30),
        minutes: 30,
        source: 'manual',
        task: null,
        project: null,
        note: null,
        kind: 'meeting',
        title: 'Retro',
        description: null,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      },
    ];
  }
  return { routes: weekStub(data), data };
}

async function myDay(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub().routes);
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  return h;
}

after(async () => {
  await closeBrowser();
});

void describe('the tabs (LAI-505)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the day opens on Overview (LAI-514); To review is grouped; Confirmed is grouped too; the tray lists the untimed`, async () => {
      const h = await myDay();
      try {
        await setTheme(h.page, theme);
        const tabs = h.page.locator('[data-day-tab]');
        assert.deepEqual(
          (await tabs.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')),
          ['Overview', 'To review 5', 'Confirmed 4', 'All'],
        );
        assert.equal(
          await h.page.locator('[data-day-tab="overview"]').getAttribute('aria-current'),
          'page',
        );
        await h.page.locator('[data-day-tab="review"]').click();
        await h.page.locator('.myday-drafts').waitFor({ timeout: 5_000 });
        const groups = await h.page
          .locator('.myday-drafts [data-group]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-group')));
        // d1 8:40, d2 10:40 morning; d3 13:00, d4 15:30 afternoon; d5 untimed.
        assert.deepEqual(groups, ['morning', 'afternoon', 'untimed']);
        assert.match(
          await h.page.locator('.myday-drafts [data-group="morning"]').innerText(),
          /Morning\s*2\s*2 h 15 min/i,
        );
        assert.equal(await h.page.locator('.myday-pager').count(), 0);

        // The tray: the untimed entry and the untimed draft.
        const tray = h.page.locator('[data-untimed-tray]');
        assert.match(await tray.innerText(), /No set time/);
        assert.match(await tray.innerText(), /Call with the bank/);
        assert.match(await tray.innerText(), /Call/);
        await tray.locator('[data-tray-item="u1"]').click();
        await h.page.locator('[data-inspector-for="u1"]').waitFor({ timeout: 5_000 });

        await h.page.locator('[data-day-tab="confirmed"]').click();
        const cgroups = await h.page
          .locator('.myday-entries [data-group]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-group')));
        assert.deepEqual(cgroups, ['morning', 'afternoon', 'evening', 'untimed']);
        assert.equal(await h.page.locator('.myday-drafts').count(), 0);
      } finally {
        await h.close();
      }
    });
  }

  void test('Overview: the day’s figures, by kind and by task; the week’s figures and by day', async () => {
    const h = await myDay();
    try {
      await h.page.locator('[data-day-tab="overview"]').click();
      const ov = h.page.locator('[data-overview]');
      await ov.waitFor({ timeout: 5_000 });
      // Confirmed 30 + 30 + 20 + 30 = 1 h 50 min; drafted 5 h 10 min; meetings: the one meeting, 30.
      assert.match(await ov.locator('[data-ov-stat="tracked"]').innerText(), /7 h\s/);
      assert.match(
        await ov.locator('[data-ov-stat="tracked"]').innerText(),
        /1 h 50 min confirmed/,
      );
      assert.match(await ov.locator('[data-ov-stat="review"]').innerText(), /5 h 10 min/);
      assert.match(await ov.locator('[data-ov-stat="meetings"]').innerText(), /30 min/);
      assert.match(await ov.locator('[data-ov-stat="meetings"]').innerText(), /7% of tracked/);
      // e1 and e2 are typed too: 30 + 30 + 20 + 30 off-screen.
      assert.match(await ov.locator('[data-ov-stat="off"]').innerText(), /1 h 20 min/);
      const kinds = await ov
        .locator('[data-ov-kind]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-ov-kind')));
      assert.ok(kinds.includes('meeting') && kinds.includes('thinking'), kinds.join(','));
      const tasks = await ov
        .locator('[data-ov-task]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-ov-task')));
      assert.ok(tasks.includes('LAI-11'), tasks.join(','));
      // Ranked by their time whatever they are, No task yet among them (LAI-510).
      assert.ok(tasks.includes('No task yet'), tasks.join(','));
      const figures = await ov.locator('[data-ov-task] .myday-ov-figure').allInnerTexts();
      const minutes = figures.map((f) => {
        const h = /(\d+) h/.exec(f)?.[1] ?? '0';
        const m = /(\d+) min/.exec(f)?.[1] ?? '0';
        return Number(h) * 60 + Number(m);
      });
      assert.deepEqual(
        minutes,
        [...minutes].sort((a, b) => b - a),
        `not largest first: ${figures.join(', ')}`,
      );

      await ov.locator('[data-ov-scope="week"]').click();
      await ov.locator('[data-ov-stat="per-day"]').waitFor({ timeout: 5_000 });
      assert.equal(await ov.locator('[data-ov-day]').count(), 7);
      assert.equal(await ov.locator(`[data-ov-day="${TODAY}"].myday-ov-day-open`).count(), 1);
      assert.equal(await ov.locator('[data-ov-kind]').count(), 0);
      assert.match(await ov.innerText(), /the week carries minutes, not kinds/);

      // The tab is remembered per browser.
      await h.page.reload();
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await until(
        async () =>
          (await h.page.locator('[data-day-tab="overview"]').getAttribute('aria-current')) ===
          'page',
      );
      assert.equal(
        await h.page.locator('[data-day-tab="overview"]').getAttribute('aria-current'),
        'page',
      );
    } finally {
      await h.close();
    }
  });
  void test('All stacks Overview, To review and Confirmed; the tray says to drag on a desktop; the head says how many have no task', async () => {
    const h = await myDay();
    try {
      await h.page.locator('[data-day-tab="all"]').click();
      await h.page.locator('.myday-drafts').waitFor({ timeout: 5_000 });
      const order = await h.page
        .locator('.myday-main > section')
        .evaluateAll((els) =>
          els.map((el) =>
            [...el.classList].find((c) => c.startsWith('myday-') && c !== 'myday-card'),
          ),
        );
      assert.deepEqual(order.slice(-3), ['myday-ov', 'myday-drafts', 'myday-entries']);
      assert.match(
        await h.page.locator('[data-untimed-tray] .myday-tray-hint-desk').innerText(),
        /Drag onto the Timeline to give it a time/,
      );
      assert.equal(
        await h.page.locator('[data-untimed-tray] .myday-tray-hint-phone').isVisible(),
        false,
      );
      assert.match(
        await h.page.locator('.myday-drafts [data-settle-hint]').innerText(),
        /^2 with no task yet$/,
      );
      // Rows carry where they came from, as the design names it.
      assert.equal(
        await h.page.locator('[data-settle-row="d1"] .myday-source').innerText(),
        'Collector',
      );
      assert.equal(
        await h.page.locator('[data-settle-row="d5"] .myday-source').innerText(),
        'Agent',
      );
      assert.equal(
        await h.page.locator('[data-ledger-row="e1"] .myday-source').innerText(),
        'You added',
      );
      // The range and length keep the design's widths at least.
      const widths = await h.page.locator('[data-settle-row="d1"]').evaluate((row) => ({
        time: row.querySelector('.myday-row-time')?.getBoundingClientRect().width ?? 0,
        len: row.querySelector('.myday-row-minutes')?.getBoundingClientRect().width ?? 0,
      }));
      assert.ok(widths.time >= 115, `the range is ${String(widths.time)}px`);
      assert.ok(widths.len >= 71, `the length is ${String(widths.len)}px`);
    } finally {
      await h.close();
    }
  });

  void test('Overview’s Range: two days of the week picked, the figures and the bars cover them', async () => {
    const h = await myDay();
    try {
      const ov = h.page.locator('[data-overview]');
      await ov.waitFor({ timeout: 10_000 });
      await ov.locator('[data-ov-scope="range"]').click();
      const fromBox = ov.getByRole('combobox', { name: 'From' });
      const toBox = ov.getByRole('combobox', { name: 'To' });
      assert.equal((await offered(fromBox)).length, 7);
      await h.page.keyboard.press('Escape');
      const days = Array.from({ length: 7 }, (_, i) => {
        const monday = new Date(`${TODAY}T00:00:00Z`);
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) + i);
        return monday.toISOString().slice(0, 10);
      });
      // The days ending today, which the fixture fills (yesterday and today at least).
      const idx = days.indexOf(TODAY);
      assert.ok(idx >= 0, 'today is not in the week');
      const from = days[Math.max(0, idx - 2)] ?? '';
      const to = TODAY;
      const span = idx - Math.max(0, idx - 2) + 1;
      await pick(fromBox, from);
      await pick(toBox, to);
      await until(async () => (await ov.locator('[data-ov-day]').count()) === span);
      assert.equal(await ov.locator('[data-ov-day]').count(), span);
      assert.equal(await ov.locator('[data-ov-stat="per-day"]').count(), 1);
      if (span > 1) assert.match(await ov.locator('[data-ov-range]').innerText(), / – /);
      // Picked the other way round, the same three days.
      await pick(fromBox, to);
      await pick(toBox, from);
      await until(async () => (await ov.locator('[data-ov-day]').count()) === span);
      assert.equal(await ov.locator('[data-ov-day]').count(), span);
    } finally {
      await h.close();
    }
  });
});
