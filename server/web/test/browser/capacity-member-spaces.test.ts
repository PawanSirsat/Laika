/**
 * Capacity's Spaces column lists the spaces a person is in, not only where
 * they have open work (LAI-1334): a space with open work of theirs keeps its
 * committed count, and one they are in with none is greyed, with no count —
 * on the cards and in the list, in both themes.
 *
 * Served as the server answers (LAI-1334's server tests hold that half): Cal
 * has no open work and is in Laika and Onroute; Bea has work in Laika and is
 * in Onroute too; Eli is in no space the reader sees. Cal and Eli were seen
 * two days ago — between tasks, as the report had it, not never seen, which
 * folds into one line. Set `LAIKA_SHOTS` to keep the pictures the review asks for:
 * cards and list, 1440 and 390, light and dark.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { capacityFor, LAIKA, NOW, ONROUTE, orgStub, space } from './capacity-org.ts';
import { pick } from './dropdown.ts';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';
import { tipText } from './tooltip-probe.ts';

void after(async () => {
  await closeBrowser();
});

const SHOTS = process.env.LAIKA_SHOTS;
const DAY = 86_400_000;

function stub(): ApiStub {
  const base = capacityFor('owner');
  return {
    ...orgStub('owner'),
    '/api/v1/capacity': {
      ...base,
      people: base.people.map((p) => {
        if (p.user_id === 'u2') {
          return {
            ...p,
            spaces: [
              space(LAIKA, 'light', { in_progress: 1, in_review: 1, todo: 2, due_soon: 1 }),
              space(ONROUTE, 'none', {}),
            ],
          };
        }
        const seen = { status: 'offline', last_seen: NOW - 2 * DAY, last_seen_via: 'web' };
        if (p.user_id === 'u3') {
          return { ...p, ...seen, spaces: [space(LAIKA, 'none', {}), space(ONROUTE, 'none', {})] };
        }
        if (p.user_id === 'u5') return { ...p, ...seen, spaces: [] };
        return p;
      }),
    },
  };
}

async function ready(page: Page): Promise<void> {
  await page
    .locator('.cap-grid > .cap-card:not(.cap-card-skeleton)')
    .first()
    .waitFor({ timeout: 20_000 });
}

const card = (page: Page, name: string) =>
  page.locator('.cap-grid > .cap-card', { has: page.locator('.cap-name', { hasText: name }) });

/** The spaces block sits behind a card's Details (LAI-1222). */
async function expand(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Show details for ${name}` }).click();
  await card(page, name).locator('.cap-details:not([hidden])').waitFor({ timeout: 5_000 });
}

/** Each chip as `[slug, idle?, count or null]`, in the order drawn. */
const chips = (scope: Locator) =>
  scope
    .locator('.cap-spaces > .cap-space')
    .evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-space') ?? '',
        el.hasAttribute('data-idle'),
        el.querySelector('.cap-space-n')?.textContent ?? null,
      ]),
    );

/**
 * How a chip is drawn: its edge, its fill, and whether its text is the muted
 * token — read against a probe painted with `--text-muted` in the same theme.
 */
const look = (chip: Locator) =>
  chip.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-muted)';
    document.body.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(el);
    return {
      edge: style.borderTopStyle,
      fill: style.backgroundColor,
      muted: style.color === muted,
    };
  });

void describe('the cards', () => {
  void test('someone with no open work lists their spaces greyed, with no count', async () => {
    const h = await open('/insights?tab=capacity', stub());
    try {
      await ready(h.page);
      await expand(h.page, 'Cal Mokoena');
      const cal = card(h.page, 'Cal Mokoena');
      assert.deepEqual(await chips(cal), [
        ['laika', true, null],
        ['onroute', true, null],
      ]);
      assert.equal(await cal.locator('.cap-spaces-block .cap-quiet').count(), 0, 'No spaces');
      assert.match(await cal.locator('.cap-spaces-block .cap-label').innerText(), /2 spaces/);
      assert.deepEqual(await look(cal.locator('[data-space="laika"]')), {
        edge: 'dashed',
        fill: 'rgba(0, 0, 0, 0)',
        muted: true,
      });
      assert.equal(
        await tipText(cal.locator('[data-space="laika"]')),
        'In Laika, with no open work of theirs there',
      );
    } finally {
      await h.close();
    }
  });

  void test('open work in one of two spaces: that one first with its count, the other greyed', async () => {
    const h = await open('/insights?tab=capacity', stub());
    try {
      await ready(h.page);
      await expand(h.page, 'Bea Nkosi');
      const bea = card(h.page, 'Bea Nkosi');
      assert.deepEqual(await chips(bea), [
        ['laika', false, '3'],
        ['onroute', true, null],
      ]);
      const busy = await look(bea.locator('[data-space="laika"]'));
      assert.equal(busy.edge, 'solid');
      assert.equal(busy.muted, false);
      // The label says what the column is.
      assert.equal(
        await tipText(bea.locator('.cap-spaces-block .cap-label-note')),
        'The spaces they are in that you can see. The number is their committed work there, in progress plus to do; a greyed space has no open work of theirs.',
      );
    } finally {
      await h.close();
    }
  });

  void test('a space chosen where they have no work: that space’s zero load, its chip chosen and greyed', async () => {
    const h = await open('/insights?tab=capacity', stub());
    try {
      await ready(h.page);
      const bea = card(h.page, 'Bea Nkosi');
      const badge = async () => (await bea.locator('.cap-load').innerText()).trim();
      assert.match(await badge(), /Light$/);
      await pick(h.page.getByRole('combobox', { name: 'Space' }), 'p2');
      await until(async () => (await badge()).endsWith('No load'));
      assert.match(await badge(), /No load$/);
      assert.match(await bea.locator('.cap-counts').innerText(), /0\s*in progress/);
      await expand(h.page, 'Bea Nkosi');
      const onroute = bea.locator('[data-space="onroute"]');
      assert.equal(await onroute.getAttribute('class'), 'cap-space cap-space-on cap-space-idle');
      // All spaces again: her load across every space.
      await pick(h.page.getByRole('combobox', { name: 'Space' }), '');
      await until(async () => (await badge()).endsWith('Light'));
      assert.match(await badge(), /Light$/);
    } finally {
      await h.close();
    }
  });
});

void describe('the list', () => {
  void test('says the same: counts where there is work, greyed where there is none', async () => {
    const h = await open('/insights?tab=capacity', stub());
    try {
      await ready(h.page);
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      const row = (name: string) => h.page.locator('.cap-list tr', { hasText: name });
      await row('Cal Mokoena').waitFor({ timeout: 10_000 });
      assert.deepEqual(await chips(row('Cal Mokoena')), [
        ['laika', true, null],
        ['onroute', true, null],
      ]);
      assert.equal(await row('Cal Mokoena').locator('.cap-list-spaces-n').innerText(), '2');
      assert.deepEqual(await chips(row('Bea Nkosi')), [
        ['laika', false, '3'],
        ['onroute', true, null],
      ]);
      // Still "No spaces" for someone in none the reader can see.
      assert.match(await row('Eli van Wyk').locator('.cap-list-spaces').innerText(), /No spaces/);
      // The header says what the column shows.
      assert.equal(
        await tipText(h.page.locator('.cap-list th', { hasText: 'Spaces' })),
        'The spaces they are in that you can see. The number is their committed work there, in progress plus to do; a greyed space has no open work of theirs.',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('look and fit', () => {
  for (const theme of ['Light', 'Dark'] as const) {
    void test(`${theme}: greyed in both themes; cards and list at 1440 and 390, no sideways scroll`, async () => {
      const h = await open('/insights?tab=capacity', stub());
      try {
        await ready(h.page);
        await h.page.setViewportSize({ width: 1440, height: 1000 });
        await setTheme(h.page, theme);
        // The theme's transition settles before reading colours or a picture.
        await h.page.waitForTimeout(400);
        await expand(h.page, 'Cal Mokoena');
        await expand(h.page, 'Bea Nkosi');
        assert.equal(
          (await look(card(h.page, 'Cal Mokoena').locator('[data-space="onroute"]'))).muted,
          true,
        );
        await shoot(h.page, `capacity-spaces-cards-1440-${theme.toLowerCase()}`);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await h.page.waitForTimeout(500);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 0, `${theme} at 390: ${String(overflow)} px sideways`);
        await card(h.page, 'Bea Nkosi').scrollIntoViewIfNeeded();
        await shoot(h.page, `capacity-spaces-cards-390-${theme.toLowerCase()}`);
        await h.page.setViewportSize({ width: 1440, height: 1000 });
        await h.page.getByRole('button', { name: 'List', exact: true }).click();
        await h.page.locator('.cap-list').waitFor({ timeout: 10_000 });
        await h.page.waitForTimeout(300);
        await shoot(h.page, `capacity-spaces-list-1440-${theme.toLowerCase()}`);
        // The Spaces column is the last, past the list's own sideways scroll.
        await h.page.locator('.cap-list-wrap').evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        await h.page.waitForTimeout(200);
        await shoot(h.page, `capacity-spaces-list-1440-end-${theme.toLowerCase()}`);
      } finally {
        await h.close();
      }
    });
  }
});

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
