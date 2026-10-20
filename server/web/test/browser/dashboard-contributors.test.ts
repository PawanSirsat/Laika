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
import { closeBrowser, open, type Harness } from './harness.ts';
import {
  ASH,
  EXPECTED,
  NAMES,
  onrouteStub,
  PAW,
  routeRanged,
  SAK,
  TASKS,
} from './onroute-dashboard.ts';

const PEOPLE = '.dash-people';

async function openDashboard(range?: string): Promise<Harness> {
  const h = await open(
    `/dashboard?project=onroute${range === undefined ? '' : `&range=${range}`}`,
    onrouteStub(),
    { before: routeRanged },
  );
  await h.page.locator(`${PEOPLE} .dash-contrib-row`).first().waitFor({ timeout: 20_000 });
  return h;
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

void describe('Open work now has no range (D-092 item 2)', () => {
  const open7 = TASKS.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const held = (id: string | null): number =>
    open7.filter((t) => t.assignee_id === id && t.status !== 'review').length;
  const inReview = (id: string): number =>
    open7.filter((t) => t.assignee_id === id && t.status === 'review').length;

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
          review: await text(h.page, `${PEOPLE} [data-person="review"]`),
        };
        assert.deepEqual(
          figures,
          {
            centre: String(EXPECTED.open),
            ash: String(held(ASH)),
            paw: String(held(PAW)),
            unassigned: String(held(null)),
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
