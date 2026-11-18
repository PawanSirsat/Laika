/**
 * Capacity's away and meetings (LAI-1331): under a person's name, why they are
 * away — the period they set, Outlook's out of office, or both, the Outlook
 * one named — and their meetings this week, with a sort by them.
 *
 * Served as the server answers each reader: `away` only for people whose
 * availability the reader sees (D-137), and `meeting_minutes_week` for every
 * person only for *See everyone's analytics* — a member has it on their own
 * row alone (D-102). Set `LAIKA_SHOTS` to keep the pictures the review asks
 * for: cards and list, 1440 and 390, light and dark.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { capacityFor, orgStub } from './capacity-org.ts';
import { optionsOf, pick } from './dropdown.ts';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';
import { tipText } from './tooltip-probe.ts';

void after(async () => {
  await closeBrowser();
});

const SHOTS = process.env.LAIKA_SHOTS;

type Reader = 'owner' | 'member';

/** The capacity answer for `reader`, with the two new fields as the server sends them. */
function answer(reader: Reader) {
  const base = capacityFor(reader);
  return {
    ...base,
    people: base.people.map((p) => {
      const extra: Record<string, unknown> = {};
      // Pawan shares a space with everyone here, so both readers see his away.
      if (p.user_id === 'u1') extra.away = null;
      if (p.user_id === 'u2') {
        extra.away = { own: { until: '2026-11-20' }, outlook: { until: '2026-11-25' } };
      }
      // The never-seen three: an owner sees their availability; a member is
      // told about Cal only (no shared space with Dee or Eli).
      if (p.user_id === 'u3') extra.away = { own: null, outlook: { until: '2026-11-19' } };
      if (reader === 'owner') {
        if (p.user_id === 'u4' || p.user_id === 'u5') extra.away = null;
        extra.meeting_minutes_week = { u1: 360, u2: 90, u3: 0, u4: 0, u5: 0 }[p.user_id] ?? 0;
      } else if (p.user_id === 'u2') {
        extra.meeting_minutes_week = 90;
      }
      return { ...p, ...extra };
    }),
  };
}

function stub(reader: Reader): ApiStub {
  return { ...orgStub(reader), '/api/v1/capacity': answer(reader) };
}

async function ready(page: Page): Promise<void> {
  await page
    .locator('.cap-grid > .cap-card:not(.cap-card-skeleton)')
    .first()
    .waitFor({ timeout: 20_000 });
}

const card = (page: Page, name: string) =>
  page.locator('.cap-grid > .cap-card', { has: page.locator('.cap-name', { hasText: name }) });

const pills = (scope: ReturnType<typeof card>) =>
  scope
    .locator('[data-cap-cal] .avail-pill')
    .evaluateAll((els) =>
      els.map((el) => [el.getAttribute('data-away') ?? '', (el.textContent ?? '').trim()]),
    );

const sort = (page: Page) => page.getByRole('combobox', { name: 'Sort' });

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

void describe('an owner (See everyone’s analytics)', () => {
  void test('Bea’s own away and Outlook’s, the Outlook one named; each person’s meetings this week', async () => {
    const h = await open('/insights?tab=capacity', stub('owner'));
    try {
      await ready(h.page);
      assert.deepEqual(await pills(card(h.page, 'Bea Nkosi')), [
        ['own', '◐Away until Fri 20 Nov'],
        ['outlook', '◐Outlook · Out of office until Wed 25 Nov'],
      ]);
      assert.equal(
        await card(h.page, 'Bea Nkosi').locator('[data-meetings]').textContent(),
        '1 h 30 min in meetings this week',
      );
      // Pawan: not away, six hours of meetings.
      assert.deepEqual(await pills(card(h.page, 'Pawan Sirsat')), []);
      assert.equal(
        await card(h.page, 'Pawan Sirsat').locator('[data-meetings]').textContent(),
        '6 h in meetings this week',
      );
      // The pill says where it comes from on hover.
      assert.equal(
        await tipText(card(h.page, 'Bea Nkosi').locator('[data-away="outlook"]')),
        'Outlook · Out of office until Wed 25 Nov — Out of office in their Outlook calendar',
      );
      // The whole of it shows: nothing cut off behind an ellipsis.
      const clipped = await card(h.page, 'Bea Nkosi')
        .locator('[data-cap-cal] .avail-pill > span:not(.avail-pill-glyph)')
        .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
      assert.equal(clipped, 0, 'a pill is cut off');
    } finally {
      await h.close();
    }
  });

  void test('a sort by meetings this week is offered, and orders the cards by it', async () => {
    const h = await open('/insights?tab=capacity', stub('owner'));
    try {
      await ready(h.page);
      const { labels } = await optionsOf(sort(h.page));
      assert.ok(labels.includes('Sort: Most meetings this week'), labels.join(' | '));
      await pick(sort(h.page), 'meetings');
      const names = (await h.page.locator('.cap-grid > .cap-card .cap-name').allInnerTexts()).map(
        (n) => n.trim(),
      );
      assert.deepEqual(names.slice(0, 2), ['Pawan Sirsat', 'Bea Nkosi']);
      assert.match(h.page.url(), /sort=meetings/);
    } finally {
      await h.close();
    }
  });

  void test('the List view says the same under each name', async () => {
    const h = await open('/insights?tab=capacity', stub('owner'));
    try {
      await ready(h.page);
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      const row = h.page.locator('.cap-list tr', { hasText: 'Bea Nkosi' });
      await row.waitFor({ timeout: 10_000 });
      assert.equal(await row.locator('[data-cap-cal] .avail-pill').count(), 2);
      // Whole, not cut short behind an ellipsis.
      const clipped = await row
        .locator('[data-cap-cal] .avail-pill > span:not(.avail-pill-glyph)')
        .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
      assert.equal(clipped, 0, 'a pill is cut off in the list');
      // And the name stays beside the avatar, not wrapped under it.
      const [avatar, who] = await Promise.all([
        row.locator('.cap-avatar').boundingBox(),
        row.locator('.cap-who').boundingBox(),
      ]);
      assert.ok(avatar !== null && who !== null);
      assert.ok(who.x >= avatar.x + avatar.width, 'the name wrapped under the avatar');
      assert.equal(
        await row.locator('[data-meetings]').textContent(),
        '1 h 30 min in meetings this week',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a member', () => {
  void test('their own meetings only, no sort by them, and away for whoever shares a space', async () => {
    const h = await open('/insights?tab=capacity', stub('member'));
    try {
      await ready(h.page);
      assert.equal(
        await card(h.page, 'Bea Nkosi').locator('[data-meetings]').textContent(),
        '1 h 30 min in meetings this week',
      );
      assert.equal(await card(h.page, 'Pawan Sirsat').locator('[data-cap-cal]').count(), 0);
      const { labels } = await optionsOf(sort(h.page));
      assert.ok(!labels.includes('Sort: Most meetings this week'), labels.join(' | '));
      assert.deepEqual(await pills(card(h.page, 'Bea Nkosi')), [
        ['own', '◐Away until Fri 20 Nov'],
        ['outlook', '◐Outlook · Out of office until Wed 25 Nov'],
      ]);
    } finally {
      await h.close();
    }
  });

  void test('an address asking for the meetings sort falls back to load', async () => {
    const h = await open('/insights?tab=capacity&sort=meetings', stub('member'));
    try {
      await ready(h.page);
      assert.equal(await sort(h.page).getAttribute('data-value'), 'load');
    } finally {
      await h.close();
    }
  });
});

void describe('look and fit', () => {
  for (const theme of ['Light', 'Dark'] as const) {
    void test(`${theme}: cards and list at 1440 and 390, no sideways scroll`, async () => {
      const h = await open('/insights?tab=capacity', stub('owner'));
      try {
        await ready(h.page);
        await h.page.setViewportSize({ width: 1440, height: 1000 });
        await setTheme(h.page, theme);
        // The theme's transition settles before the picture.
        await h.page.waitForTimeout(400);
        await shoot(h.page, `capacity-cards-1440-${theme.toLowerCase()}`);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await h.page.waitForTimeout(500);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 0, `${theme} at 390: ${String(overflow)} px sideways`);
        await card(h.page, 'Bea Nkosi').scrollIntoViewIfNeeded();
        await shoot(h.page, `capacity-cards-390-${theme.toLowerCase()}`);
        await h.page.setViewportSize({ width: 1440, height: 1000 });
        await h.page.getByRole('button', { name: 'List', exact: true }).click();
        await h.page.locator('.cap-list').waitFor({ timeout: 10_000 });
        await h.page.waitForTimeout(300);
        await shoot(h.page, `capacity-list-1440-${theme.toLowerCase()}`);
      } finally {
        await h.close();
      }
    });
  }
});
