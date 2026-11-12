/**
 * The Organisation tabs pass (LAI-1210), in a real browser against the stubbed
 * API: a figure leads somewhere; People's view lives in the address and
 * survives a reload; a row's actions are one ⋯ menu a keyboard can drive;
 * pending invites are said on every view; a phone gets cards, not a clipped
 * table; Security finds a person and flags tokens from their fields alone,
 * and a revoke confirms and reports; Activity reads by day and clears its
 * filters; Roles explains a role; Integrations says each card's state.
 *
 * Each test reads what a person would see, or what the page sent — and
 * asserts after every wait, so a wait that times out cannot pass silently.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { answerConfirm } from './confirm.ts';
import { closeBrowser, open, until, type StubCall } from './harness.ts';
import { PEOPLE } from './organisation-refine-fixtures.ts';
import { TABS } from './organisation-tabs-fixtures.ts';

void after(async () => {
  await closeBrowser();
});

type H = Awaited<ReturnType<typeof open>>;

const rows = '.org-person';
const query = (h: H): URLSearchParams => new URLSearchParams(new URL(h.page.url()).search);

const peopleReady = async (h: H): Promise<void> => {
  await h.page.locator(rows).first().waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator(rows).count()) > 0);
  assert.ok((await h.page.locator(rows).count()) > 0, 'no person rows drew');
};

void describe('Overview: a figure with a next step leads to it', () => {
  void test('Pending invites opens People on the pending invites', async () => {
    const h = await open('/organisation', TABS());
    try {
      const tile = h.page.locator('[data-stat="invites"] a.org-stat-link');
      await tile.waitFor({ timeout: 20_000 });
      assert.match((await tile.getAttribute('aria-label')) ?? '', /Pending invites: 2/);
      await tile.click();
      await h.page.locator('[data-people-pending]').waitFor({ timeout: 10_000 });
      assert.equal(query(h).get('tab'), 'people');
      assert.equal(query(h).get('show'), 'pending');
      assert.equal(await h.page.locator('[data-invite]').count(), 2);
    } finally {
      await h.close();
    }
  });

  void test('In review leads to Work filtered to review; Blocked leads nowhere', async () => {
    const h = await open('/organisation', TABS());
    try {
      const review = h.page.locator('[data-pulse="review"] a.org-stat-link');
      await review.waitFor({ timeout: 20_000 });
      assert.equal(await review.getAttribute('href'), '/organisation?tab=work&status=review');
      assert.equal(
        await h.page.locator('[data-pulse="blocked"] a').count(),
        0,
        'Blocked links to a list that cannot show blocked work',
      );
      // Security is offered to a reader who may list tokens, and names the place.
      assert.equal(
        await h.page.locator('[data-stat="security"] a').getAttribute('href'),
        '/organisation?tab=security',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('People: the view lives in the address', () => {
  void test('a search and a filter survive a reload', async () => {
    const h = await open('/organisation?tab=people', TABS());
    try {
      await peopleReady(h);
      await h.page.locator('[data-people-search]').fill('grace');
      await until(() => query(h).get('q') === 'grace');
      assert.equal(query(h).get('q'), 'grace');
      await h.page.locator('[data-people-filter="member"]').click();
      await until(() => query(h).get('show') === 'member');
      assert.equal(query(h).get('show'), 'member');

      await h.page.reload();
      await h.page.locator(rows).first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-people-search]').inputValue(), 'grace');
      assert.equal(
        await h.page.locator('[data-people-filter="member"]').getAttribute('aria-pressed'),
        'true',
      );
      await until(async () => (await h.page.locator(rows).count()) === 1);
      assert.equal(await h.page.locator(rows).count(), 1);
      assert.match(await h.page.locator(rows).innerText(), /Grace Hopper/);
    } finally {
      await h.close();
    }
  });

  void test('Show everyone on a filtered empty table clears the address too', async () => {
    const h = await open('/organisation?tab=people&q=nobody-at-all', TABS());
    try {
      const empty = h.page.locator('[data-people-empty]');
      await empty.waitFor({ timeout: 20_000 });
      assert.match(await empty.innerText(), /No one matches “nobody-at-all”/);
      await empty.locator('[data-people-clear]').click();
      await until(async () => (await h.page.locator(rows).count()) === PEOPLE.length);
      assert.equal(query(h).get('q'), null);
      assert.equal(await h.page.locator(rows).count(), PEOPLE.length);
    } finally {
      await h.close();
    }
  });

  void test('pending invites are said on every view, and one click away', async () => {
    const h = await open('/organisation?tab=people', TABS());
    try {
      const notice = h.page.locator('[data-pending-notice]');
      await notice.waitFor({ timeout: 20_000 });
      assert.match(await notice.innerText(), /2 invites are waiting to be accepted/);
      await notice.getByRole('button', { name: 'Review pending' }).click();
      await h.page.locator('[data-people-pending]').waitFor({ timeout: 10_000 });
      assert.equal(query(h).get('show'), 'pending');
      assert.equal(await notice.count(), 0, 'the notice stayed on the pending view itself');
    } finally {
      await h.close();
    }
  });
});

void describe('People: one ⋯ menu per row', () => {
  void test('the keyboard opens it, moves through it, chooses, and Escape gives focus back', async () => {
    const h = await open('/organisation?tab=people', TABS());
    try {
      await peopleReady(h);
      const tomas = h.page.locator(rows, { hasText: 'Tomas Nel' });
      const button = tomas.getByRole('button', { name: 'More actions for Tomas Nel' });
      await button.waitFor({ timeout: 10_000 });
      assert.equal(
        await tomas.locator('.org-row-menu').getAttribute('data-row-actions'),
        'tokens deactivate',
      );

      await button.focus();
      await h.page.keyboard.press('ArrowDown');
      const items = tomas.getByRole('menuitem');
      await until(async () => (await items.count()) === 2);
      assert.equal(await items.count(), 2);
      const focused = async () =>
        h.page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      assert.match(await focused(), /^Tokens/);

      // Escape closes it and puts focus back on the button, not on body.
      await h.page.keyboard.press('Escape');
      await until(async () => (await items.count()) === 0);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'More actions for Tomas Nel',
      );

      // Down to Deactivate, Enter: LAI-988's offboarding dialog, and nothing sent.
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await items.count()) === 2);
      await h.page.keyboard.press('ArrowDown');
      assert.match(await focused(), /^Deactivate/);
      await h.page.keyboard.press('Enter');
      const dialog = h.page.locator('.offb-dialog');
      await dialog.waitFor({ timeout: 10_000 });
      assert.match(await dialog.innerText(), /Deactivate Tomas Nel\?/);
      assert.equal(
        h.calls.filter((c: StubCall) => c.method === 'PATCH').length,
        0,
        'deactivated without asking',
      );
    } finally {
      await h.close();
    }
  });

  void test('Tokens from the menu opens that person on Security', async () => {
    const h = await open('/organisation?tab=people', TABS());
    try {
      await peopleReady(h);
      const tomas = h.page.locator(rows, { hasText: 'Tomas Nel' });
      await tomas.locator('.overflow-menu-button').click();
      await tomas.getByRole('menuitem', { name: /^Tokens/ }).click();
      await h.page.locator('#tokens-u2').waitFor({ timeout: 10_000 });
      assert.equal(query(h).get('tab'), 'security');
      assert.ok(await h.page.locator('#tokens-u2').isVisible());
    } finally {
      await h.close();
    }
  });
});

void describe('People at 390: cards, not a clipped table', () => {
  void test('each person is a card with role and last active in view; nothing scrolls sideways', async () => {
    const h = await open('/organisation?tab=people', TABS(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      await peopleReady(h);
      await h.page.waitForTimeout(300);
      const measured = await h.page.evaluate(() => {
        const row = [...document.querySelectorAll('.org-person')].find((el) =>
          el.textContent?.includes('Tomas Nel'),
        );
        const role = row?.querySelector('.org-people-role')?.getBoundingClientRect();
        const seen = row?.querySelector('[data-last-active]')?.getBoundingClientRect();
        const region = document.querySelector('[data-scroll-region]');
        return {
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          roleRight: role?.right ?? Infinity,
          seenRight: seen?.right ?? Infinity,
          header: getComputedStyle(document.querySelector('.org-people-header')!).display,
          overflow: region?.getAttribute('data-overflow'),
          width: window.innerWidth,
        };
      });
      assert.ok(
        measured.sideways <= 1,
        `the page scrolls sideways by ${String(measured.sideways)}`,
      );
      assert.ok(measured.roleRight <= measured.width, 'the role is cut off');
      assert.ok(measured.seenRight <= measured.width, 'last active is cut off');
      assert.equal(measured.header, 'none', 'a card layout still draws the column headers');
      assert.equal(measured.overflow, 'false', 'the card list still scrolls sideways');
    } finally {
      await h.close();
    }
  });
});

void describe('Security: find a person; flags from the fields; revoke confirms and reports', () => {
  void test('the search narrows the list, lives in the address, and an empty result offers a way back', async () => {
    const h = await open('/organisation?tab=security', TABS());
    try {
      const search = h.page.locator('[data-security-search]');
      await search.waitFor({ timeout: 20_000 });
      await search.fill('priya');
      await until(async () => (await h.page.locator('.org-people > li').count()) === 1);
      assert.equal(await h.page.locator('.org-people > li').count(), 1);
      assert.equal(query(h).get('q'), 'priya');
      assert.match(await h.page.locator('[data-security-shown]').innerText(), /^1 of 8$/);

      await search.fill('zzz');
      const empty = h.page.locator('[data-security-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.match(await empty.innerText(), /No one matches “zzz”/);
      await empty.getByRole('button', { name: 'Show everyone' }).click();
      await until(async () => (await h.page.locator('.org-people > li').count()) === PEOPLE.length);
      assert.equal(query(h).get('q'), null);
    } finally {
      await h.close();
    }
  });

  void test('a stale and an expiring token are flagged and summed; a fresh one is not', async () => {
    const h = await open('/organisation?tab=security&q=priya', TABS());
    try {
      await h.page.getByRole('button', { name: 'Show Priya Raman’s tokens' }).click();
      const summary = h.page.locator('[data-token-summary]');
      await summary.waitFor({ timeout: 20_000 });
      assert.equal(
        await summary.innerText(),
        '2 tokens · 1 unused 90+ days · 1 expires within 7 days',
      );
      const old = h.page.locator('.tok-row', { hasText: 'Old deploy script' });
      assert.deepEqual(await old.locator('[data-token-flag]').allTextContents(), [
        'Unused 90+ days',
      ]);
      const bot = h.page.locator('.tok-row', { hasText: 'Release bot' });
      assert.deepEqual(await bot.locator('[data-token-flag]').allTextContents(), [
        'Expires within 7 days',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('Revoke asks first, sends the DELETE to the owner’s path, then says what happened', async () => {
    const h = await open(
      '/organisation?tab=security',
      TABS({ '/api/v1/users/u3/tokens/t3': null }),
    );
    try {
      await h.page.getByRole('button', { name: 'Show Priya Raman’s tokens' }).click();
      const old = h.page.locator('.tok-row', { hasText: 'Old deploy script' });
      await old.locator('.tok-revoke').waitFor({ timeout: 20_000 });
      await old.locator('.tok-revoke').click();
      // Nothing leaves the browser before the answer.
      await h.page.locator('[data-confirm-dialog]').waitFor({ timeout: 10_000 });
      assert.equal(h.calls.filter((c: StubCall) => c.method === 'DELETE').length, 0);
      const said = await answerConfirm(h.page, true);
      assert.match(said, /Revoke “Old deploy script”\?/);

      await until(() => h.calls.some((c: StubCall) => c.method === 'DELETE'));
      const deleted = h.calls.find((c: StubCall) => c.method === 'DELETE');
      assert.equal(deleted?.path, '/api/v1/users/u3/tokens/t3');
      const result = h.page.locator('[data-token-result]');
      await until(async () => (await result.innerText()).length > 0);
      assert.match(await result.innerText(), /^Revoked “Old deploy script”\./);
    } finally {
      await h.close();
    }
  });
});

void describe('Activity: by day, and one way back from a filter', () => {
  void test('rows sit under Today and Yesterday, newest first', async () => {
    const h = await open('/organisation?tab=activity', TABS());
    try {
      await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.oh-row').count()) === 5);
      const days = await h.page
        .locator('.oh-day')
        .evaluateAll((els) =>
          els.map((el) => [
            el.querySelector('.oh-day-head')?.textContent,
            el.querySelectorAll('.oh-row').length,
          ]),
        );
      // The fixture pins three rows to today's calendar day and two to
      // yesterday's, so the groups do not depend on when the suite runs.
      assert.deepEqual(days, [
        ['Today', 3],
        ['Yesterday', 2],
      ]);
      // A row says its time alone; the day is the heading's.
      const when = await h.page.locator('.oh-row time.oh-when').first().innerText();
      assert.doesNotMatch(when, /Nov|Oct|Dec|Jan/, `the row repeats the date: ${when}`);
    } finally {
      await h.close();
    }
  });

  void test('Clear filters removes every filter from the address and keeps the tab', async () => {
    const h = await open('/organisation?tab=activity&actor=u2&type=task.created', TABS());
    try {
      const clear = h.page.locator('[data-history-clear]');
      await clear.waitFor({ timeout: 20_000 });
      await clear.click();
      await until(() => query(h).get('actor') === null);
      assert.equal(query(h).get('actor'), null);
      assert.equal(query(h).get('type'), null);
      assert.equal(query(h).get('tab'), 'activity');
      await until(async () => (await clear.count()) === 0);
      assert.equal(await clear.count(), 0, 'Clear filters outlived the filters');
    } finally {
      await h.close();
    }
  });
});

void describe('Roles: grouped, findable, and a role explained', () => {
  void test('the matrix groups rows by area, finds an action, and explains a role', async () => {
    const h = await open('/organisation?tab=roles', TABS());
    try {
      const org = h.page.locator('[data-matrix="org"]');
      await org.locator('.perm-table').waitFor({ timeout: 20_000 });
      const groups = await org
        .locator('tbody[data-group]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-group')));
      assert.ok(groups.includes('token') && groups.includes('user'), groups.join(','));
      assert.match(
        // The words, not the uppercase the stylesheet draws them in.
        (await org.locator('tbody[data-group="token"] .perm-group-head').textContent()) ?? '',
        /^Tokens/,
      );

      await h.page.locator('[data-matrix-find]').fill('anyone');
      await until(async () => (await org.locator('tbody tr[data-action]').count()) === 2);
      assert.deepEqual(
        await org
          .locator('tbody tr[data-action]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-action'))),
        ['token.list_any', 'token.revoke_any'],
      );
      await h.page.locator('[data-matrix-find]').fill('');

      await org.locator('[data-explain-role="admin"]').click();
      const sentence = org.locator('[data-explain]');
      await sentence.waitFor({ timeout: 10_000 });
      assert.match(
        await sentence.innerText(),
        /^An admin can take 25 of 28 organisation actions\. Not: Delete org data, Transfer ownership, Org settings/,
      );
      assert.equal(
        await org.locator('[data-explain-role="admin"]').getAttribute('aria-pressed'),
        'true',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Integrations: each card says its state', () => {
  void test('GitHub says not set up, with its steps, and fits a phone', async () => {
    const h = await open('/organisation?tab=integrations', TABS(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      const card = h.page.locator('[data-section="github"]');
      await card.waitFor({ timeout: 20_000 });
      const badge = card.locator('.org-status-badge');
      assert.equal(await badge.innerText(), 'not set up');
      assert.equal(await badge.getAttribute('data-tone'), 'off');
      assert.equal(await card.locator('[data-github-steps] li').count(), 3);
      const ai = h.page.locator('[data-section="ai"] .org-status-badge');
      assert.equal(await ai.innerText(), 'configured');

      const fits = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          right: box.right,
          width: window.innerWidth,
          scroll: el.scrollWidth - el.clientWidth,
        };
      });
      assert.ok(
        fits.right <= fits.width + 1,
        `the card runs off the screen by ${String(fits.right - fits.width)}`,
      );
      assert.ok(fits.scroll <= 1, `the card clips ${String(fits.scroll)}px of its own content`);
    } finally {
      await h.close();
    }
  });
});
