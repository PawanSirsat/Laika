/**
 * The Dashboard ranks who delivered, not who holds the most open work
 * (LAI-817, D-092).
 *
 * The owner, on OnRoute: Work by person said *"Ashutosh 24, Pawan 6"*, and
 * *"we want to show the highest contributor there."* These tests open the
 * dashboard on a space shaped like production OnRoute (`onroute-dashboard.ts`)
 * and hold the screen to D-092's numbers: on 7 days Ashutosh 23 delivered and
 * Pawan 3; on 30 days or all time Pawan 168, Ashutosh 86, Sakshi 16.
 *
 * **Every expected number is the fixture's**, summed there from named groups —
 * not computed by the code under test.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';
import {
  ASH,
  EVENTS,
  EXPECTED,
  NAMES,
  NOW,
  onrouteStub,
  PAW,
  routeRanged,
  SAK,
  TASKS,
} from './onroute-dashboard.ts';

const PEOPLE = '.dash-people';

async function openDashboard(
  range?: string,
  stub: ApiStub = onrouteStub(),
  ready = `${PEOPLE} .dash-contrib-row`,
): Promise<Harness> {
  const h = await open(
    `/dashboard?project=onroute${range === undefined ? '' : `&range=${range}`}`,
    stub,
    { before: routeRanged },
  );
  await h.page.locator(ready).first().waitFor({ timeout: 20_000 });
  return h;
}

/**
 * **A font wider than this machine's** (LAI-831, LAI-842): CI's Linux fonts
 * set the same words wider than macOS's, and a row that fits here was cut
 * there. Letter-spacing stands in for the wider face.
 */
async function wideFont(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.dash * { letter-spacing: 0.12em !important; }' });
}

async function close(h: Harness): Promise<void> {
  // A route still fulfilling fails the run while every assertion is green.
  await h.page.unrouteAll({ behavior: 'ignoreErrors' });
  await h.close();
}

/** The Delivered tab's rows, top to bottom: [person, delivered, reviewed]. */
async function ranking(page: Page): Promise<[string, number, number][]> {
  return page
    .locator(`${PEOPLE} .dash-contrib-row`)
    .evaluateAll((rows) =>
      rows.map((row): [string, number, number] => [
        row.getAttribute('data-person') ?? '?',
        Number(row.querySelector('[data-col="delivered"]')?.textContent),
        Number(row.querySelector('[data-col="reviewed"]')?.textContent),
      ]),
    );
}

async function openNow(page: Page): Promise<void> {
  await page.locator(`${PEOPLE} [role="tab"]`, { hasText: 'Open work now' }).click();
  await page.locator(`${PEOPLE} .donut-value`).waitFor({ timeout: 5_000 });
}

const text = async (page: Page, selector: string): Promise<string> =>
  ((await page.locator(selector).first().textContent()) ?? '').trim();

void after(async () => {
  await closeBrowser();
});

void describe('Contributors ranks who delivered (D-092 item 1)', () => {
  void test('7 days: Ashutosh 23, Pawan 3 — and the self-close is footnoted', async () => {
    const h = await openDashboard();
    try {
      assert.equal(await text(h.page, `${PEOPLE} .dash-card-title`), 'Contributors');
      assert.deepEqual(await ranking(h.page), [
        [ASH, EXPECTED.delivered7d[ASH], 0],
        [PAW, EXPECTED.delivered7d[PAW], EXPECTED.reviewed7d[PAW]],
        [SAK, 0, EXPECTED.reviewed7d[SAK]],
      ]);
      const names = await h.page
        .locator(`${PEOPLE} .dash-contrib-row .dash-legend-name`)
        .allTextContents();
      assert.deepEqual(names, [NAMES[ASH], NAMES[PAW], NAMES[SAK]]);
      assert.match(
        await text(h.page, `${PEOPLE} [data-person="${PAW}"]`),
        /1 closed without review\*/,
      );
      assert.match(
        await text(h.page, `${PEOPLE} .dash-card-foot`),
        /an agent’s moves count for its owner\. \*1 of them was closed without review\./,
      );
      assert.equal(
        await text(h.page, `${PEOPLE} .dash-card-meta`),
        '3 people · in the last 7 days',
      );
    } finally {
      await close(h);
    }
  });

  for (const range of ['30d', 'all']) {
    void test(`${range}: Pawan 168, Ashutosh 86, Sakshi 16 — Pawan first`, async () => {
      const h = await openDashboard(range);
      try {
        assert.deepEqual(await ranking(h.page), [
          [PAW, EXPECTED.delivered30d[PAW], EXPECTED.reviewed30d[PAW]],
          [ASH, EXPECTED.delivered30d[ASH], EXPECTED.reviewed30d[ASH]],
          [SAK, EXPECTED.delivered30d[SAK], EXPECTED.reviewed30d[SAK]],
        ]);
        assert.match(
          await text(h.page, `${PEOPLE} .dash-card-foot`),
          new RegExp(
            `\\*${String(EXPECTED.selfClosed30d[PAW])} of them were closed without review`,
          ),
        );
      } finally {
        await close(h);
      }
    });
  }
});

/*
 * **Delivered says what it counts** (LAI-832). A move into done from review is
 * a review, not a delivery; "into review, or into done" let it read as both.
 * And All time is not a phrase to end a sentence on.
 */
void describe('Delivered says exactly what it counts', () => {
  void test('the footnote and the column say "straight into done", with the range', async () => {
    const h = await openDashboard();
    try {
      assert.match(
        await text(h.page, `${PEOPLE} .dash-card-foot`),
        /^Delivered: tasks moved into review, or straight into done, in the last 7 days — each task once/,
      );
      assert.equal(
        await h.page
          .locator(`${PEOPLE} th[scope="col"]`, { hasText: 'Delivered' })
          .getAttribute('title'),
        'Moved into review, or straight into done',
      );
    } finally {
      await close(h);
    }
  });

  void test('All time leaves the range out of the sentence', async () => {
    const h = await openDashboard('all');
    try {
      assert.match(
        await text(h.page, `${PEOPLE} .dash-card-foot`),
        /^Delivered: tasks moved into review, or straight into done — each task once/,
      );
    } finally {
      await close(h);
    }
  });

  for (const [range, said] of [
    ['all', 'Nobody has moved work into review, or straight into done, yet.'],
    ['7d', 'Nobody moved work into review, or straight into done, in the last 7 days.'],
  ] as const) {
    void test(`an empty ${range} reads as a sentence`, async () => {
      // Nothing moved: the range's activity has no status changes in it.
      const h = await open(`/dashboard?project=onroute&range=${range}`, onrouteStub(), {
        before: async (page) => {
          await routeRanged(page);
          await page.route('**/api/v1/projects/onroute/activity**', async (route) => {
            await route.fulfill({ json: { data: [], next_cursor: null } });
          });
        },
      });
      try {
        const empty = h.page.locator(`${PEOPLE} .dash-empty`);
        await empty.waitFor({ timeout: 20_000 });
        assert.equal(((await empty.textContent()) ?? '').trim(), said);
      } finally {
        await close(h);
      }
    });
  }
});

void describe('Open work now has no range (D-092 items 2 and 3)', () => {
  const open7 = TASKS.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  /** Their load: to do and in progress — Capacity's rule (LAI-832). */
  const held = (id: string | null): number =>
    open7.filter((t) => t.assignee_id === id && (t.status === 'todo' || t.status === 'in_progress'))
      .length;
  const inReview = (id: string): number =>
    open7.filter((t) => t.assignee_id === id && t.status === 'review').length;
  const inBacklog = (id: string): number =>
    open7.filter((t) => t.assignee_id === id && t.status === 'backlog').length;

  void test('the same figures under 24 hours, 7 days and all time', async () => {
    assert.equal(open7.length, EXPECTED.open, 'positive control: the fixture’s 301');
    const seen: string[] = [];
    for (const range of ['24h', '7d', 'all']) {
      const h = await openDashboard(range);
      try {
        await openNow(h.page);
        const figures = {
          centre: await text(h.page, `${PEOPLE} .donut-value`),
          ash: await text(h.page, `${PEOPLE} [data-person="${ASH}"]`),
          paw: await text(h.page, `${PEOPLE} [data-person="${PAW}"]`),
          unassigned: await text(h.page, `${PEOPLE} [data-person="unassigned"]`),
          backlog: await text(h.page, `${PEOPLE} [data-person="backlog"]`),
          review: await text(h.page, `${PEOPLE} [data-person="review"]`),
        };
        assert.deepEqual(
          figures,
          {
            centre: String(EXPECTED.open),
            ash: String(held(ASH)),
            paw: String(held(PAW)),
            unassigned: String(held(null)),
            backlog: String(open7.filter((t) => t.status === 'backlog').length),
            review: String(open7.filter((t) => t.status === 'review').length),
          },
          range,
        );
        seen.push(JSON.stringify(figures));
      } finally {
        await close(h);
      }
    }
    assert.equal(new Set(seen).size, 1, 'a range changed open work now');
  });

  /*
   * **Backlog is shown apart** (LAI-832, D-092 item 3). Pawan held 70 open
   * tasks here and 42 of them were backlog; the number read as load, and at
   * 390 px the detail that said so was cut off.
   */
  void test('a person’s backlog is beside their count, never in it — and seen on a phone', async () => {
    const h = await openDashboard();
    try {
      await openNow(h.page);
      const paw = h.page.locator(`${PEOPLE} .dash-legend-row`, { hasText: NAMES[PAW]! });
      assert.ok(inBacklog(PAW) > held(PAW), 'positive control: most of Pawan’s is backlog');
      assert.equal(await text(h.page, `${PEOPLE} [data-person="${PAW}"]`), String(held(PAW)));
      assert.equal(
        ((await paw.locator('.dash-legend-backlog').textContent()) ?? '').trim(),
        `+${String(inBacklog(PAW))} in backlog`,
      );
      assert.doesNotMatch(
        (await paw.locator('.dash-legend-detail').first().textContent()) ?? '',
        /backlog/,
        'backlog is not in the count’s own detail',
      );
      for (const font of ['ours', 'wider']) {
        if (font === 'wider') await wideFont(h.page);
        for (const width of [1440, 390]) {
          await h.page.setViewportSize({ width, height: 900 });
          // Every line under every name: the count's detail ("… · 11
          // blocked") and the backlog beside it.
          const clipped = await h.page
            .locator(`${PEOPLE} .dash-legend-row .dash-legend-detail`)
            .evaluateAll((els) =>
              els.map((el) => {
                const edge = el.closest('.dash-legend-who')?.getBoundingClientRect().right ?? 0;
                return [
                  el.textContent ?? '',
                  Math.max(
                    el.getBoundingClientRect().right - edge,
                    el.scrollWidth - el.clientWidth,
                  ),
                ] as const;
              }),
            );
          assert.ok(
            clipped.some(([line]) => line === `+${String(inBacklog(PAW))} in backlog`),
            'positive control: Pawan’s backlog line was measured',
          );
          const cut = clipped.filter(([, by]) => by > 0.5);
          assert.deepEqual(cut, [], `${font} font, ${String(width)}px: lines cut`);
        }
      }
    } finally {
      await close(h);
    }
  });

  void test('a person’s work in review is beside their count, never in it', async () => {
    const h = await openDashboard();
    try {
      await openNow(h.page);
      const ash = h.page.locator(`${PEOPLE} .dash-legend-row`, { hasText: NAMES[ASH]! });
      assert.ok(inReview(ASH) > 0, 'positive control: Ashutosh has work in review');
      assert.match(
        (await ash.textContent()) ?? '',
        new RegExp(`\\+${String(inReview(ASH))} waiting for review`),
      );
      assert.equal(await text(h.page, `${PEOPLE} [data-person="${ASH}"]`), String(held(ASH)));
      // Seen, not merely present: at the end of the detail line an ellipsis
      // cut it off while its text still matched (LAI-817's own screenshots).
      // Measured against the column's edge — an inline span's clientWidth is
      // 0, so its own scroll width cannot say it was clipped.
      for (const font of ['ours', 'wider']) {
        if (font === 'wider') await wideFont(h.page);
        for (const width of [1440, 390]) {
          await h.page.setViewportSize({ width, height: 900 });
          const clipped = await ash.locator('.dash-legend-review').evaluate((el) => {
            const edge = el.closest('.dash-legend-who')?.getBoundingClientRect().right ?? 0;
            return Math.max(
              el.getBoundingClientRect().right - edge,
              el.scrollWidth - el.clientWidth,
            );
          });
          assert.ok(
            clipped <= 0.5,
            `${font} font, ${String(width)}px: the review line is cut by ${String(clipped)}px`,
          );
        }
      }
    } finally {
      await close(h);
    }
  });
});

void describe('Needs attention says what it counts (D-092 items 3 and 4)', () => {
  const count = async (page: Page, tab: string): Promise<number> =>
    Number(
      await page
        .locator('.dash-attention [role="tab"]', { hasText: tab })
        .locator('.dash-tab-count')
        .textContent(),
    );

  void test('Stale is the server’s 7, review waits are their own 37, Blocked is 11 with 19 apart', async () => {
    const h = await openDashboard();
    try {
      assert.equal(await count(h.page, 'Stale'), EXPECTED.staleFlagged);
      assert.equal(await count(h.page, 'Waiting for review > 5 days'), EXPECTED.reviewOver5d);
      assert.equal(await count(h.page, 'Blocked'), EXPECTED.blockedCommitted);
      assert.equal(
        await h.page
          .locator('.dash-attention .dash-att-list:not(.dash-att-list-apart) .dash-att-row')
          .count(),
        EXPECTED.blockedCommitted,
      );
      assert.equal(
        await h.page.locator('.dash-attention .dash-att-list-apart .dash-att-row').count(),
        EXPECTED.blockedBacklog,
      );
      assert.match(
        await text(h.page, '.dash-att-apart'),
        new RegExp(`Not counted — ${String(EXPECTED.blockedBacklog)} in backlog or review`),
      );
      await h.page.locator('.dash-attention [role="tab"]', { hasText: 'Stale' }).click();
      assert.equal(
        await h.page.locator('.dash-attention .dash-att-row').count(),
        EXPECTED.staleFlagged,
      );
    } finally {
      await close(h);
    }
  });
});

/*
 * **The wait does not move with the range** (LAI-832). The 37 waiting more
 * than five days were touched an hour ago — a sprint move — so the range's
 * activity on "Last 24 hours" cannot see when they went into review. The
 * review queue can: `GET /review` says, at any age.
 */
void describe('Waiting for review > 5 days holds under any range', () => {
  /** When each task last moved into review, from another category — the fixture's own log. */
  const entered = new Map<string, number>();
  for (const e of EVENTS) {
    const move = e.payload as { from?: string; to?: string };
    if (e.type !== 'task.status_changed' || move.to !== 'review' || move.from === 'review')
      continue;
    entered.set(e.task_id, Math.max(entered.get(e.task_id) ?? 0, e.created_at));
  }
  const touched = TASKS.map((t) =>
    t.status === 'review' ? { ...t, updated_at: NOW - 3_600_000 } : t,
  );
  const stub = (queue: boolean): ApiStub => ({
    ...onrouteStub(),
    '/api/v1/projects/onroute/tasks': () => ({
      data: touched.map((t) => ({ ...t })),
      next_cursor: null,
    }),
    ...(queue
      ? {
          '/api/v1/review': {
            tasks: touched
              .filter((t) => t.status === 'review')
              .map((t) => ({
                task: { id: t.id },
                waiting_since: entered.get(t.id) ?? t.updated_at,
              })),
            truncated: false,
          },
        }
      : {}),
  });
  const reviewCount = async (page: Page): Promise<number> =>
    Number(
      await page
        .getByRole('tab', { name: /^Waiting for review > 5 days/ })
        .locator('.dash-tab-count')
        .textContent(),
    );

  void test('Last 24 hours still lists the 37, from the review queue', async () => {
    for (const range of ['24h', '7d', 'all']) {
      const h = await openDashboard(range, stub(true), '.dash-attention [role="tab"]');
      try {
        await h.page.waitForFunction(
          (n) =>
            document.querySelector('#dash-tab-review .dash-tab-count')?.textContent?.trim() ===
            String(n),
          EXPECTED.reviewOver5d,
          { timeout: 10_000 },
        );
        assert.equal(await reviewCount(h.page), EXPECTED.reviewOver5d, range);
      } finally {
        await close(h);
      }
    }
  });

  void test('CONTROL: without the queue, the range alone cannot see them', async () => {
    // What the screen did before: the touch an hour ago hides the move.
    const h = await openDashboard('24h', stub(false), '.dash-attention [role="tab"]');
    try {
      assert.equal(await reviewCount(h.page), 0);
    } finally {
      await close(h);
    }
  });
});

/*
 * **The tabs fit a phone** (LAI-832). The third tab's count ran into the card
 * edge at 390 px. Every tab and every count stays inside the card's content
 * box, on this machine's font and on a wider one.
 */
void describe('Needs attention’s tabs fit a phone', () => {
  void test('no tab or count runs past the card edge at 390 px, on any font', async () => {
    const h = await openDashboard();
    try {
      await h.page.setViewportSize({ width: 390, height: 900 });
      const card = h.page.locator('.dash-attention');
      for (const font of ['ours', 'wider']) {
        if (font === 'wider') await wideFont(h.page);
        const tabs = card.getByRole('tab');
        assert.equal(await tabs.count(), 3);
        // Named whole, whatever is drawn: the name is what a reader hears.
        for (const name of [/^Blocked \d+$/, /^Stale \d+$/, /^Waiting for review > 5 days \d+$/]) {
          assert.equal(
            await card.getByRole('tab', { name }).count(),
            1,
            `${font}: ${String(name)}`,
          );
        }
        // How far the furthest tab or count runs past the card's content box.
        const worst = await card.evaluate((el) => {
          const edge =
            el.getBoundingClientRect().right -
            (Number.parseFloat(getComputedStyle(el).paddingRight) || 0);
          return Math.max(
            ...[...el.querySelectorAll('[role="tab"], [role="tab"] .dash-tab-count')].map(
              (t) => t.getBoundingClientRect().right - edge,
            ),
          );
        });
        assert.ok(worst <= 0.5, `${font} font: a tab runs ${String(worst)}px past the card edge`);
        const sideways = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.equal(sideways, 0, `${font} font: the page scrolls sideways`);
      }
    } finally {
      await close(h);
    }
  });
});

void describe('labels say what they count (D-092 item 5)', () => {
  void test('touched, done of touched, and a due tile that admits few dates', async () => {
    const h = await openDashboard();
    try {
      assert.match(await text(h.page, '.dash-stat-touched .dash-stat-figure'), /\d+ touched$/);
      assert.equal(await h.page.locator('.dash-stat-updated').count(), 0, '"updated" is gone');
      assert.equal(await text(h.page, '.dash-status .donut-caption'), 'done of touched');
      assert.equal(
        await text(h.page, '.dash-stat-due .dash-stat-note'),
        `only ${String(EXPECTED.dated)} of ${String(EXPECTED.open)} open tasks have a due date`,
      );
    } finally {
      await close(h);
    }
  });
});
