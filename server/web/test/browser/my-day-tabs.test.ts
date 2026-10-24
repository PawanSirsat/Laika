import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { at, weekData, weekStub, type DayData } from './my-day-week.ts';

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
        kind: 'call',
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
    void test(`${theme}: a day with drafts opens on To review, grouped; Confirmed is grouped too; the tray lists the untimed`, async () => {
      const h = await myDay();
      try {
        await setTheme(h.page, theme);
        const tabs = h.page.locator('[data-day-tab]');
        assert.deepEqual(
          (await tabs.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')),
          ['Overview', 'To review 5', 'Confirmed 4'],
        );
        assert.equal(
          await h.page.locator('[data-day-tab="review"]').getAttribute('aria-current'),
          'page',
        );
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
      // Confirmed 30 + 30 + 20 + 30 = 1 h 50 min; drafted 5 h 10 min; meetings call 20 + meeting 30.
      assert.match(await ov.locator('[data-ov-stat="tracked"]').innerText(), /7 h\s/);
      assert.match(
        await ov.locator('[data-ov-stat="tracked"]').innerText(),
        /1 h 50 min confirmed/,
      );
      assert.match(await ov.locator('[data-ov-stat="review"]').innerText(), /5 h 10 min/);
      assert.match(await ov.locator('[data-ov-stat="meetings"]').innerText(), /50 min/);
      assert.match(await ov.locator('[data-ov-stat="meetings"]').innerText(), /12% of tracked/);
      // e1 and e2 are typed too: 30 + 30 + 20 + 30 off-screen.
      assert.match(await ov.locator('[data-ov-stat="off"]').innerText(), /1 h 20 min/);
      const kinds = await ov
        .locator('[data-ov-kind]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-ov-kind')));
      assert.ok(kinds.includes('meeting') && kinds.includes('call'), kinds.join(','));
      const tasks = await ov
        .locator('[data-ov-task]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-ov-task')));
      assert.equal(tasks.at(-1), 'No task yet');
      assert.ok(tasks.includes('LAI-11'), tasks.join(','));

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
});
