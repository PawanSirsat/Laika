import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, refuse, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { QUIET, SETTINGS, TOMORROW, viewOf, weekData, weekStub, YESTERDAY } from './my-day-week.ts';

/**
 * The page's states as the owner's `MyDay.dc.html` draws them (LAI-513): the
 * error card, time tracking off, a Timeline with nothing on it (today, a past
 * day, a day not begun, drafting off), *Fill gaps*, the *Who can see this*
 * popover and *Confirm day*'s label — every figure from the stubbed response.
 */

const weekday = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long' });

/** The week's stub with `day`'s view replaced. */
function withDay(day: string, patch: (view: Record<string, unknown>) => unknown): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${day}`] = () => patch(viewOf(day, data) as Record<string, unknown>);
  return routes;
}

async function openDay(day: string, routes: ApiStub): Promise<Harness> {
  const h = await open(`/my-day?day=${day}`, routes, {
    before: async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
    },
  });
  return h;
}

after(async () => {
  await closeBrowser();
});

void describe('the page states as designed (LAI-513)', () => {
  void test('a day that cannot be read: the weekday, the server’s words, Retry and the request', async () => {
    const routes: Record<string, unknown> = { ...weekStub() };
    routes[`/api/v1/me/time?day=${TODAY}`] = refuse(
      504,
      'upstream_timeout',
      'The request timed out after 10 seconds.',
    );
    const h = await openDay(TODAY, routes);
    try {
      const card = h.page.locator('[data-day-error]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), new RegExp(`Couldn’t load ${weekday(TODAY)}`));
      assert.match(await card.innerText(), /The request timed out after 10 seconds\./);
      assert.equal(await card.getByRole('button', { name: 'Retry' }).count(), 1);
      assert.equal(
        await card.locator('[data-day-error-request]').innerText(),
        `GET /api/v1/me/time?day=${TODAY} · 504`,
      );
    } finally {
      await h.close();
    }
  });

  void test('time tracking off for the organisation: the card, the way to the setting, no controls and no week', async () => {
    const h = await openDay(
      TODAY,
      withDay(TODAY, (view) => ({
        ...view,
        settings: { ...SETTINGS, org_mode: 'off', drafting: false },
      })),
    );
    try {
      const card = h.page.locator('[data-day-off]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), /Time tracking is off for/);
      assert.match(
        await card.innerText(),
        /Owners and admins can turn it on in Organisation settings/,
      );
      assert.equal(
        await card.getByRole('button', { name: 'Open Organisation settings' }).count(),
        1,
      );
      for (const sel of [
        '[data-add-time]',
        '[data-timer-start]',
        '[data-confirm-day]',
        '[data-day-settings]',
        '.myday-week',
        '[data-day-total]',
        '[data-dayline]',
      ]) {
        assert.equal(await h.page.locator(sel).count(), 0, `${sel} is drawn with tracking off`);
      }
      await card.getByRole('button', { name: 'Open Organisation settings' }).click();
      await h.page.waitForURL((url) => url.pathname === '/organisation', { timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: today with nothing on it — the empty Timeline, Start timer and Add time, 0 min · nothing yet, no lists`, async () => {
      const h = await openDay(
        TODAY,
        withDay(TODAY, (view) => ({
          ...view,
          drafts: [],
          entries: [],
          breaks: [],
          state: 'no_signal',
        })),
      );
      try {
        await setTheme(h.page, theme);
        const card = h.page.locator('[data-day-empty="today"]');
        await card.waitFor({ timeout: 20_000 });
        assert.match(await card.innerText(), /Nothing yet today/);
        assert.match(
          await card.innerText(),
          /your collector drafts time from prompts, commits and agent sessions/,
        );
        assert.equal(await card.getByRole('button', { name: 'Start timer' }).count(), 1);
        assert.equal(await card.getByRole('button', { name: 'Add time' }).count(), 1);
        // The hours along the top, with their sky.
        assert.equal(await card.locator('.dstate-empty-hour').count(), 15);
        assert.equal(await card.locator('.dstate-empty-hour[data-sky="night"]').count(), 4);
        assert.match(await h.page.locator('[data-day-total]').innerText(), /0 min\s+nothing yet/);
        assert.equal(await h.page.locator('.myday-tabs').count(), 0);
        assert.match(await h.page.locator('[data-confirm-day]').innerText(), /^Day confirmed$/);
        assert.equal(await h.page.locator('[data-confirm-day]').isDisabled(), true);
        // Start timer opens the timer popover.
        await card.getByRole('button', { name: 'Start timer' }).click();
        await h.page.locator('[data-timer-go]').waitFor({ timeout: 5_000 });
      } finally {
        await h.close();
      }
    });
  }

  void test('a day not begun: “hasn’t started”, not started in the header, Back to today', async () => {
    const h = await openDay(TOMORROW, weekStub());
    try {
      const card = h.page.locator('[data-day-empty="future"]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), new RegExp(`${weekday(TOMORROW)} hasn’t started`));
      assert.match(await card.innerText(), /Nothing can be confirmed ahead of time/);
      assert.match(await h.page.locator('[data-day-total]').innerText(), /0 min\s+not started/);
      assert.equal(await h.page.locator('[data-confirm-day]').count(), 0);
      await card.getByRole('button', { name: 'Back to today' }).click();
      await until(() => h.page.url().includes(`day=${TODAY}`));
    } finally {
      await h.close();
    }
  });

  void test('a past day nothing was recorded on: “Nothing recorded on”, Back to today and Add time', async () => {
    const h = await openDay(QUIET, weekStub());
    try {
      const card = h.page.locator('[data-day-empty="past"]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), new RegExp(`Nothing recorded on ${weekday(QUIET)}`));
      assert.equal(await card.getByRole('button', { name: 'Back to today' }).count(), 1);
      assert.equal(await card.getByRole('button', { name: 'Add time' }).count(), 1);
      await card.getByRole('button', { name: 'Add time' }).click();
      await h.page
        .locator('[data-myday-drawer] [data-inspector="range"]')
        .waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('drafting off and nothing added: “Nothing drafted”, Turn drafting on writes the switch; the banner and the tabs stay', async () => {
    const h = await openDay(
      TODAY,
      withDay(TODAY, (view) => ({
        ...view,
        drafts: [],
        entries: [],
        breaks: [],
        state: 'no_signal',
        settings: { ...SETTINGS, draft_my_time: false, drafting: false },
      })),
    );
    try {
      const card = h.page.locator('[data-day-empty="draftOff"]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), /Nothing drafted/);
      assert.match(
        await card.innerText(),
        /Draft my time is off, so Laika only shows time you add or record with a timer/,
      );
      assert.equal(await h.page.locator('[data-draft-off]').count(), 1);
      assert.equal(await h.page.locator('.myday-tabs').count(), 1);
      await card.getByRole('button', { name: 'Turn drafting on' }).click();
      await until(() =>
        h.calls.some((c) => c.method === 'PUT' && c.path === '/api/v1/me/time-settings'),
      );
    } finally {
      await h.close();
    }
  });

  void test('Fill gaps: today’s gaps before now, counted and timed; it opens the first gap', async () => {
    const h = await openDay(TODAY, weekStub());
    try {
      const button = h.page.locator('[data-fill-gaps]');
      await button.waitFor({ timeout: 20_000 });
      assert.match(await button.innerText(), /^Fill gaps\s+\d+ · \d+ (min|h)/);
      await button.click();
      const drawer = h.page.locator('[data-myday-drawer]');
      await drawer.locator('[data-inspector="gap"]').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('Who can see this is a popover: drafts, confirmed and agent time each named, hung from the left', async () => {
    const h = await openDay(TODAY, weekStub());
    try {
      const trigger = h.page.locator('[data-who-can-see] > button');
      await trigger.waitFor({ timeout: 20_000 });
      assert.match((await trigger.getAttribute('title')) ?? '', /Drafts: you, owners and admins/);
      await trigger.click();
      const panel = h.page.getByRole('region', { name: 'Who can see this' });
      await panel.waitFor({ timeout: 5_000 });
      const words = await panel.innerText();
      assert.match(words, /Drafts/);
      assert.match(words, /Confirmed/);
      assert.match(words, /Agent time/);
      assert.match(words, /Counts only, never what you typed/);
      const box = await panel.boundingBox();
      const anchor = await trigger.boundingBox();
      assert.ok(box !== null && anchor !== null);
      assert.ok(box.x >= 0, 'the popover runs off the page');
      assert.ok(Math.abs(box.x - anchor.x) < 2, 'the popover does not hang from the left');
      await panel.getByRole('button', { name: 'Who looked' }).click();
      await h.page.locator('[data-who-looked] .myday-pop-panel').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('Confirm day says what is ready; a day with no drafts says Day confirmed', async () => {
    const h = await openDay(TODAY, weekStub());
    try {
      const confirm = h.page.locator('[data-confirm-day]');
      await confirm.waitFor({ timeout: 20_000 });
      assert.match(await confirm.innerText(), /^Confirm day\s+3 ready · 3 h 50 min$/);
      assert.match(
        (await confirm.getAttribute('title')) ?? '',
        /2 without a task stay in To review/,
      );
      await h.page
        .locator(`[data-week-day="${YESTERDAY}"], .myday-week-day`)
        .first()
        .waitFor({ timeout: 5_000 });
      await h.page.goto(`${h.origin}/my-day?day=${YESTERDAY}`);
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await until(async () => (await confirm.innerText()).trim() === 'Day confirmed');
      assert.equal(await confirm.isDisabled(), true);
    } finally {
      await h.close();
    }
  });
});
