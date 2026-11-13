/**
 * Insights, read across its tabs (LAI-1216), as an owner sees it:
 *
 *  - the Time report's period and filters live in the address and survive a
 *    reload (LAI-1189); an untouched report keeps `/insights?tab=time`, and
 *    a value the report cannot use is read as the default and dropped;
 *  - Usage's Tokens figure says how it compares with the period before, from
 *    a read of twice the range — and says nothing at 90 days, which one read
 *    cannot double;
 *  - a space is one colour across the tabs: the Time report's swatch and
 *    Usage's by-space bar for Laika are the same paint;
 *  - figure links and the chart's keyboard tooltip still work;
 *  - with nothing in any endpoint, each tab says so once, with no chart of
 *    zeros and no filters for a list that is not there;
 *  - at 390 no tab scrolls sideways and the tile captions wrap;
 *  - no Content-Security-Policy violation on any tab.
 *
 * Every endpoint is `insights-fixtures.ts`; `/time/report` is answered by
 * `page.route`, which sees the whole query.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, until, type ApiStub, type Harness } from './harness.ts';
import { insightsStub, routeTimeReport, usageFor, type Fill } from './insights-fixtures.ts';
import { open } from './my-day-clock.ts';

void after(async () => {
  await closeBrowser();
});

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/** Record every CSP violation the page reports, from before it boots. */
async function watchCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(`${event.violatedDirective} ${event.sample}`);
    });
  });
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

async function openInsights(
  path: string,
  options: {
    readonly width?: number;
    readonly fill?: Fill;
    readonly asked?: URL[];
    readonly stub?: ApiStub;
  } = {},
): Promise<Harness> {
  return open(path, options.stub ?? insightsStub(options.fill ?? 'full'), {
    before: async (page) => {
      await page.setViewportSize({ width: options.width ?? 1440, height: 1000 });
      await watchCsp(page);
      await routeTimeReport(page, options.asked ?? [], options.fill ?? 'full');
    },
  });
}

async function done(h: Harness): Promise<void> {
  await h.page.unrouteAll({ behavior: 'ignoreErrors' });
  await h.close();
}

const search = (page: Page): Promise<string> => page.evaluate(() => window.location.search);

void describe('the Time report in the address (LAI-1189)', () => {
  void test('untouched it keeps the clean address; a period and a member survive a reload', async () => {
    const asked: URL[] = [];
    const h = await openInsights('/insights?tab=time', { asked });
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      assert.equal(await search(h.page), '?tab=time', 'an untouched report wrote to the address');

      await tr.locator('[data-tr-range="week"]').click();
      await tr.locator('[data-tr-chip="member"]').click();
      await tr.locator('[data-tr-option="u2"] input').check();
      await h.page.keyboard.press('Escape');
      await until(async () => (await search(h.page)).includes('member=u2'));
      const written = new URLSearchParams(await search(h.page));
      assert.equal(written.get('tab'), 'time');
      assert.equal(written.get('period'), 'week');
      assert.equal(written.get('member'), 'u2');
      assert.equal(written.get('drafts'), null, 'a default was written');

      asked.length = 0;
      await h.page.reload();
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      await until(() => asked.length > 0);
      assert.equal(await tr.locator('[data-tr-range="week"]').getAttribute('aria-checked'), 'true');
      assert.match(await tr.locator('[data-tr-chip="member"]').innerText(), /Bea Nkosi/);
      assert.ok(
        asked.every((u) => u.searchParams.get('members') === 'u2'),
        `the reloaded report asked for ${asked.map((u) => u.search).join(' ')}`,
      );
      assert.equal(new URLSearchParams(await search(h.page)).get('period'), 'week');
    } finally {
      await done(h);
    }
  });

  void test('a range, a kind and drafts are read from a pasted link; junk is the default, dropped', async () => {
    const asked: URL[] = [];
    const h = await openInsights(
      '/insights?tab=time&period=range&from=2026-10-01&to=2026-10-10&kind=meeting,bogus&drafts=include&link=nope',
      { asked },
    );
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      await until(() => asked.length > 0);
      const first = asked[0];
      assert.ok(first !== undefined);
      assert.equal(first.searchParams.get('from'), '2026-10-01');
      assert.equal(first.searchParams.get('to'), '2026-10-10');
      assert.equal(first.searchParams.get('kinds'), 'meeting');
      assert.equal(first.searchParams.get('drafts'), 'include');
      assert.equal(first.searchParams.get('link'), null, 'an unknown link was sent');
      await until(async () => !(await search(h.page)).includes('bogus'));
      const kept = new URLSearchParams(await search(h.page));
      assert.equal(kept.get('kind'), 'meeting');
      assert.equal(kept.get('link'), null);
      assert.equal(kept.get('from'), '2026-10-01');
    } finally {
      await done(h);
    }
  });
});

void describe('Usage: the lead figures', () => {
  void test('Tokens says how it compares with the 30 days before, and nothing at 90', async () => {
    const h = await openInsights('/insights?tab=usage');
    try {
      const change = h.page.locator('[data-stat="tokens"] .usage-stat-change');
      await change.waitFor({ timeout: 20_000 });
      // What the fixture's own trend makes of it: the doubled read's first half.
      const wide = usageFor(60) as { trend: { tokens: number }[] };
      const now = usageFor(30) as { totals: { tokens: number } };
      const before = wide.trend.slice(0, 30).reduce((n, d) => n + d.tokens, 0);
      const pct = Math.round(((now.totals.tokens - before) / before) * 100);
      const arrow = pct > 0 ? '▲' : '▼';
      assert.equal(
        await change.locator('[aria-hidden="true"]').innerText(),
        `${arrow} ${String(Math.abs(pct))}% vs previous 30 days`,
      );
      assert.equal(await change.getAttribute('data-change'), pct > 0 ? 'up' : 'down');

      await h.page.getByRole('button', { name: /90 days/ }).click();
      await until(async () => (await search(h.page)).includes('range=90'));
      await h.page.locator('[data-stat="tokens"]').waitFor();
      await until(async () => (await change.count()) === 0);
      assert.equal(await change.count(), 0, 'a 90-day comparison was drawn');
    } finally {
      await done(h);
    }
  });

  void test('a figure opens its card; the chart walks with the arrow keys and says the day', async () => {
    const h = await openInsights('/insights?tab=usage');
    try {
      const figure = h.page.locator('[data-stat="tokens"] a[data-figure-to="trend"]');
      await figure.waitFor({ timeout: 20_000 });
      await figure.click();
      await until(() =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-section') === 'trend'),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-section')),
        'trend',
      );
      const chart = h.page.locator('.usage-trend');
      await chart.focus();
      await h.page.keyboard.press('End');
      await h.page.keyboard.press('ArrowLeft');
      const tip = chart.locator('.usage-tip');
      await until(async () => (await tip.innerText()).includes('tokens'));
      assert.match(await tip.innerText(), /^\d{1,2} \w{3} · [\d,]+ tokens · /);
    } finally {
      await done(h);
    }
  });
});

void describe('one colour per space across the tabs', () => {
  void test('Laika is the same paint in the Time report and on Usage’s by-space bar', async () => {
    const time = await openInsights('/insights?tab=time');
    let timePaint = '';
    try {
      const swatch = time.page.locator('[data-tr-row="p1"] .trep-swatch').first();
      await swatch.waitFor({ timeout: 20_000 });
      timePaint = await swatch.evaluate((e) => getComputedStyle(e).backgroundColor);
      const other = await time.page
        .locator('[data-tr-row="p2"] .trep-swatch')
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor);
      assert.notEqual(timePaint, other, 'two spaces drawn alike');
    } finally {
      await done(time);
    }
    const usage = await openInsights('/insights?tab=usage');
    try {
      const bar = usage.page.locator('.usage-row-bar[data-series="laika"]');
      await bar.waitFor({ timeout: 20_000 });
      const usagePaint = await bar.evaluate((e) => getComputedStyle(e).backgroundColor);
      assert.equal(usagePaint, timePaint, 'Laika changed colour between tabs');
    } finally {
      await done(usage);
    }
  });
});

void describe('nothing at all', () => {
  void test('each tab says so once, with no chart of zeros and no filters for nobody', async () => {
    const usage = await openInsights('/insights?tab=usage', { fill: 'zero' });
    try {
      await usage.page.locator('[data-state="usage-empty"]').waitFor({ timeout: 20_000 });
      assert.equal(await usage.page.locator('.usage-trend').count(), 0, 'a chart of zeros');
      assert.equal(await usage.page.locator('[data-section="breakdown"]').count(), 0);
      assert.equal(await usage.page.locator('[data-stat="tokens"] .usage-stat-change').count(), 0);
    } finally {
      await done(usage);
    }
    const capacity = await openInsights('/insights', { fill: 'zero' });
    try {
      await capacity.page.getByText('No one to show yet').waitFor({ timeout: 20_000 });
      assert.equal(await capacity.page.locator('.cap-toolbar').count(), 0, 'filters for nobody');
      assert.equal(await capacity.page.locator('.cap-legend').count(), 0);
    } finally {
      await done(capacity);
    }
  });
});

void describe('on a phone, and under the policy', () => {
  for (const [name, path, ready] of [
    ['Capacity', '/insights', '.cap-tile-label'],
    ['Usage', '/insights?tab=usage', '[data-stat="tokens"]'],
    ['Time', '/insights?tab=time', '[data-tr-stat="tracked"]'],
    ['Availability', '/insights?tab=time&view=availability', '[data-availability-view]'],
  ] as const) {
    void test(`${name} at 390: nothing sideways, no CSP violation`, async () => {
      const h = await openInsights(path, { width: 390 });
      try {
        await h.page.locator(ready).first().waitFor({ timeout: 20_000 });
        const wide = await h.page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(wide <= 390, `${name} is ${String(wide)}px wide at 390`);
        if (name === 'Usage') {
          const wrap = await h.page
            .locator('[data-stat="tokens"] .usage-stat-sub')
            .first()
            .evaluate((e) => getComputedStyle(e).whiteSpace);
          assert.equal(wrap, 'normal', 'the caption is cut off on a phone');
        }
        assert.deepEqual(await violations(h.page), []);
      } finally {
        await done(h);
      }
    });
  }
});
