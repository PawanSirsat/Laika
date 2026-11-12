/**
 * Organisation, People and Roles against the interaction contract (LAI-1194):
 * every consequential action asks first and then says what happened; an empty
 * list offers a way on; a failed refresh keeps the last good answer beside a
 * Retry; a disabled control says why; Roles is a summary with the inventory
 * on request; a wide table says it scrolls; and each of those is reachable
 * from the keyboard.
 *
 * Each test reads what a person would see, or what the page sent.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type StubCall } from './harness.ts';
import { pick } from './dropdown.ts';
import { MEMBER, OWNER, PEOPLE, user } from './organisation-refine-fixtures.ts';

const rows = '.org-person';

void after(async () => {
  await closeBrowser();
});

const ready = async (h: Awaited<ReturnType<typeof open>>): Promise<void> => {
  await h.page.locator(rows).first().waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator(rows).count()) === PEOPLE.length);
};

const patches = (h: Awaited<ReturnType<typeof open>>, path?: string) =>
  h.calls.filter((c) => c.method === 'PATCH' && (path === undefined || c.path === path));

void describe('People: consequential actions confirm, then say what happened', () => {
  void test('a role change asks, reports the result in words, and Undo puts it back', async () => {
    let role = 'member';
    const h = await open(
      '/organisation?tab=people',
      OWNER({
        '/api/v1/users/u2': (call: StubCall) => {
          role = (call.body as { org_role: string }).org_role;
          return user('u2', 'Tomas Nel', role);
        },
      }),
    );
    try {
      await ready(h);
      await pick(h.page.locator(rows, { hasText: 'Tomas Nel' }).getByRole('combobox'), 'admin');
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(patches(h).length, 0, 'the change went out before the confirmation');
      await dialog.locator('[data-confirm-ok] button').click();

      // The app's one toast (LAI-1129), with a real Undo.
      const result = h.page.locator('[data-people-undo]');
      await result.waitFor({ timeout: 10_000 });
      assert.equal(
        (await result.locator('.toast-text').innerText()).trim(),
        'Tomas Nel is now an admin.',
      );
      assert.equal(
        await result.locator('.toast-text').getAttribute('role'),
        'status',
        'the result is not announced',
      );

      await result.getByRole('button', { name: 'Undo' }).click();
      await until(() => patches(h, '/api/v1/users/u2').length === 2);
      assert.deepEqual(patches(h, '/api/v1/users/u2')[1]?.body, { org_role: 'member' });
      await until(async () => (await result.innerText()).includes('again'));
      assert.equal(
        (await result.locator('.toast-text').innerText()).trim(),
        'Tomas Nel is a member again.',
      );
    } finally {
      await h.close();
    }
  });

  void test('Escape closes the role confirmation and nothing is sent', async () => {
    const h = await open('/organisation?tab=people', OWNER());
    try {
      await ready(h);
      await pick(h.page.locator(rows, { hasText: 'Tomas Nel' }).getByRole('combobox'), 'admin');
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await until(async () => (await dialog.count()) === 0);
      assert.equal(await dialog.count(), 0, 'Escape did not close the confirmation');
      await h.page.waitForTimeout(300);
      assert.equal(patches(h).length, 0);
      assert.equal(await h.page.locator('[data-toast]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Reactivate asks first; Cancel sends nothing, Confirm sends and says so', async () => {
    const h = await open(
      '/organisation?tab=people',
      OWNER({
        '/api/v1/users/u4': () => user('u4', 'Sam Okafor', 'viewer'),
      }),
    );
    try {
      await ready(h);
      const sam = h.page.locator(rows, { hasText: 'Sam Okafor' });
      await sam.locator('.org-reactivate').click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.match(await dialog.innerText(), /Reactivate Sam Okafor\?/);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await until(async () => (await dialog.count()) === 0);
      await h.page.waitForTimeout(300);
      assert.equal(patches(h).length, 0, 'Cancel reactivated them anyway');

      await sam.locator('.org-reactivate').click();
      await dialog.locator('[data-confirm-ok] button').click();
      await until(() => patches(h, '/api/v1/users/u4').length === 1);
      assert.deepEqual(patches(h, '/api/v1/users/u4')[0]?.body, { is_active: true });
      const result = h.page.locator('[data-people-result]');
      await result.waitFor({ timeout: 10_000 });
      assert.match(await result.innerText(), /Sam Okafor can sign in again/);
      assert.equal(
        await result.getByRole('button', { name: 'Undo' }).count(),
        0,
        'Undo offered for it',
      );
    } finally {
      await h.close();
    }
  });

  void test('a bulk change counts what the server took and names the refusal', async () => {
    const REFUSED = 'Grace Hopper holds open work.';
    const h = await open(
      '/organisation?tab=people',
      OWNER({
        '/api/v1/users/u6': () => user('u6', 'Lin Zhao', 'admin'),
        '/api/v1/users/u5': refuse(409, 'conflict', REFUSED),
      }),
    );
    try {
      await ready(h);
      await h.page.locator('[data-people-tick="u5"]').check();
      await h.page.locator('[data-people-tick="u6"]').check();
      await h.page.locator('[data-people-bulk] button', { hasText: 'Make Admin' }).click();
      await h.page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();

      const result = h.page.locator('[data-people-result]');
      await result.waitFor({ timeout: 10_000 });
      assert.equal(
        (await result.locator('.toast-text').innerText()).trim(),
        '1 person is now admin. 1 could not be changed — the reason is under the table.',
      );
      assert.equal(await h.page.locator('.org-people-error').innerText(), REFUSED);
    } finally {
      await h.close();
    }
  });

  void test('revoking an invite confirms, then says the link is dead', async () => {
    const h = await open(
      '/organisation?tab=people',
      OWNER({ '/api/v1/invites/i1': () => ({ revoked: true }) }),
    );
    try {
      await ready(h);
      await h.page.locator('[data-people-filter="pending"]').click();
      const invite = h.page.locator('[data-invite="i1"]');
      await invite.waitFor({ timeout: 10_000 });
      await invite.locator('.org-invite-revoke').click();
      await h.page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();
      const result = h.page.locator('[data-people-result]');
      await result.waitFor({ timeout: 10_000 });
      assert.match(
        await result.innerText(),
        /The invite for new\.hire@example\.com is revoked; its link no longer works\./,
      );
      assert.ok(h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/invites/i1'));

      // Dismissing it is a keyboard action like any other.
      await result.locator('.toast-close').focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await h.page.locator('[data-people-result]').count()) === 0);
      assert.equal(await h.page.locator('[data-people-result]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('empty states offer a way on, and are not errors', () => {
  void test('no pending invites: a sentence and Invite people, not an error', async () => {
    const h = await open(
      '/organisation?tab=people',
      OWNER({ '/api/v1/invites': { data: [], next_cursor: null } }),
    );
    try {
      await ready(h);
      await h.page.locator('[data-people-filter="pending"]').click();
      const empty = h.page.locator('[data-pending-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.match(await empty.innerText(), /No pending invites/);
      assert.equal(await empty.locator('[role="alert"]').count(), 0, 'the empty list is an alert');
      assert.equal(await h.page.locator('[data-pending-empty] .org-error').count(), 0);
      await empty.getByRole('button', { name: 'Invite people' }).click();
      await h.page.locator('.org-dialog, [role="dialog"]').first().waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a search with no match offers Show everyone, which brings them back', async () => {
    const h = await open('/organisation?tab=people', OWNER());
    try {
      await ready(h);
      await h.page.locator('[data-people-search]').fill('zzz-nobody');
      const empty = h.page.locator('[data-people-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.match(await empty.innerText(), /No one matches “zzz-nobody”/);
      await empty.locator('[data-people-clear]').click();
      await until(async () => (await h.page.locator(rows).count()) === PEOPLE.length);
      assert.equal(await h.page.locator(rows).count(), PEOPLE.length);
      assert.equal(await h.page.locator('[data-people-search]').inputValue(), '');
    } finally {
      await h.close();
    }
  });
});

void describe('a failed refresh keeps the last good answer', () => {
  void test('People stays on screen beside a Retry, and Retry clears it', async () => {
    let reads = 0;
    let failing = false;
    const h = await open(
      '/organisation?tab=people',
      OWNER({
        '/api/v1/users': () => {
          reads += 1;
          return failing
            ? refuse(503, 'unavailable', 'The board is restarting.')
            : { data: PEOPLE, next_cursor: null };
        },
        '/api/v1/users/u2': () => user('u2', 'Tomas Nel', 'admin'),
      }),
    );
    try {
      await ready(h);
      failing = true;
      await pick(h.page.locator(rows, { hasText: 'Tomas Nel' }).getByRole('combobox'), 'admin');
      await h.page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();

      const banner = h.page.locator('[data-refresh-error]');
      await banner.waitFor({ timeout: 10_000 });
      assert.match(await banner.innerText(), /Couldn’t refresh the organisation/);
      assert.equal(
        await h.page.locator(rows).count(),
        PEOPLE.length,
        'the refresh failure took the directory away',
      );

      failing = false;
      const before = reads;
      await banner.getByRole('button', { name: 'Retry' }).click();
      await until(() => reads > before);
      await until(async () => (await h.page.locator('[data-refresh-error]').count()) === 0);
      assert.equal(await h.page.locator('[data-refresh-error]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Overview says the settings could not be read, with a Retry that works', async () => {
    let failing = true;
    const h = await open(
      '/organisation',
      OWNER({
        '/api/v1/org': () =>
          failing
            ? refuse(500, 'internal', 'Something broke.')
            : {
                id: 'o1',
                name: 'Northwind',
                presence_enabled: true,
                developer_insights: false,
                created_at: 1,
                updated_at: 2,
              },
      }),
    );
    try {
      const error = h.page.locator('[data-org-error]');
      await error.waitFor({ timeout: 20_000 });
      assert.match(await error.innerText(), /Couldn’t load the organisation’s settings/);
      failing = false;
      await error.locator('[data-org-retry]').click();
      await h.page.locator('#org-name').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('#org-name').innerText(), 'Organisation settings');
      assert.equal(await h.page.locator('[data-org-error]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('disabled controls say why; hidden ones are not offered', () => {
  void test('Transfer ownership says to choose someone first, until someone is chosen', async () => {
    const h = await open('/organisation?tab=people', OWNER());
    try {
      const card = h.page.locator('.org-transfer');
      await card.waitFor({ timeout: 20_000 });
      assert.equal(await card.locator('[data-transfer-open] button').isDisabled(), true);
      assert.match(await card.locator('[data-transfer-why]').innerText(), /Choose the new owner/);
      await pick(card.getByRole('combobox'), 'u3');
      await until(async () => (await card.locator('[data-transfer-why]').count()) === 0);
      assert.equal(await card.locator('[data-transfer-why]').count(), 0);
      assert.equal(await card.locator('[data-transfer-open] button').isDisabled(), false);
    } finally {
      await h.close();
    }
  });

  void test('a member gets the directory with no controls, and the space wording', async () => {
    const h = await open('/organisation?tab=people', MEMBER());
    try {
      await ready(h);
      assert.equal(await h.page.locator('.org-person [role="combobox"]').count(), 0);
      assert.equal(await h.page.locator('.org-deactivate, .org-reactivate').count(), 0);
      assert.equal(await h.page.locator('.org-transfer').count(), 0);
      const foot = await h.page.locator('.org-people-foot-note').innerText();
      assert.match(foot, /Space roles are set in each space’s settings\./);
      assert.doesNotMatch(foot, /project/i);
    } finally {
      await h.close();
    }
  });
});

void describe('Security: revoking a token confirms and reports', () => {
  void test('the result names the token once the server took it', async () => {
    const h = await open(
      '/organisation?tab=security',
      OWNER({
        '/api/v1/users/u2/tokens/t1': () => ({ revoked: true }),
      }),
    );
    try {
      const row = h.page.locator('.org-person', { hasText: 'Tomas Nel' });
      await row.locator('.org-tokens-toggle').click();
      const revoke = row
        .locator('.tok-row', { hasText: 'Laptop — Claude Code' })
        .locator('.tok-revoke');
      await revoke.waitFor({ timeout: 10_000 });
      await revoke.click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);
      await dialog.locator('[data-confirm-ok] button').click();
      const result = h.page.locator('[data-token-result]');
      await until(async () => (await result.innerText()).trim() !== '');
      assert.match(await result.innerText(), /Revoked “Laptop — Claude Code”/);
    } finally {
      await h.close();
    }
  });

  void test('a person with no tokens is told there is nothing to revoke', async () => {
    const h = await open(
      '/organisation?tab=security',
      OWNER({ '/api/v1/users/u2/tokens': { data: [], next_cursor: null } }),
    );
    try {
      const row = h.page.locator('.org-person', { hasText: 'Tomas Nel' });
      await row.locator('.org-tokens-toggle').click();
      const empty = row.locator('[data-tokens-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.match(await empty.innerText(), /nothing to revoke/);
    } finally {
      await h.close();
    }
  });
});

void describe('Roles & permissions is a summary, with the inventory on request', () => {
  void test('groups are folded to a line with a count, and open from the keyboard', async () => {
    const h = await open('/organisation?tab=roles', OWNER());
    try {
      const summary = h.page.locator('[data-perm-summary]');
      await summary.waitFor({ timeout: 20_000 });
      assert.match(await summary.innerText(), /You can take 28 actions across the organisation/);

      const org = h.page.locator('.perm-org-group');
      assert.equal((await org.locator('[data-held-count]').innerText()).trim(), '28 actions');
      const list = org.locator('[data-held="org"]');
      assert.equal(await list.isVisible(), false, 'the inventory is open by default');
      // Still in the document while folded, so find-in-page and a reader see it.
      assert.equal(await list.locator('li').count(), 28);

      const toggle = org.locator('.perm-group-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.focus();
      await h.page.keyboard.press('Enter');
      await until(async () => list.isVisible());
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await list.isVisible(), true);

      // Space headings say space, never project.
      const text = await h.page.locator('.perm-card').first().innerText();
      assert.match(text, /In your spaces/);
      assert.doesNotMatch(text, /project/i);
    } finally {
      await h.close();
    }
  });

  void test('a find narrows every group, and no match offers Clear', async () => {
    const h = await open('/organisation?tab=roles', OWNER());
    try {
      const find = h.page.locator('[data-perm-find]');
      await find.waitFor({ timeout: 20_000 });
      await find.fill('invite');
      const org = h.page.locator('.perm-org-group');
      await until(async () => org.locator('[data-held="org"]').isVisible());
      assert.deepEqual(await org.locator('[data-held="org"] li').allTextContents(), [
        'Invite users',
      ]);
      assert.equal((await org.locator('[data-held-count]').innerText()).trim(), '1 of 28 actions');

      await find.fill('kite');
      const none = h.page.locator('[data-perm-no-match]');
      await none.waitFor({ timeout: 10_000 });
      assert.match(await none.innerText(), /No action matches “kite”/);
      await none.getByRole('button', { name: 'Clear the search' }).click();
      await until(async () => (await find.inputValue()) === '');
      assert.equal(await h.page.locator('[data-perm-no-match]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('a wide table says it scrolls', () => {
  void test('at 390 the People table is a focusable region with a hint, and arrows scroll it', async () => {
    const h = await open('/organisation?tab=people', OWNER(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      await ready(h);
      const region = h.page.locator('[data-scroll-region]').first();
      await until(async () => (await region.getAttribute('data-overflow')) === 'true');
      assert.equal(await region.getAttribute('data-overflow'), 'true');
      assert.match(await region.locator('[data-scroll-hint]').innerText(), /Scroll sideways/);

      const inner = region.locator('[role="region"]');
      assert.match((await inner.getAttribute('aria-label')) ?? '', /scrolls sideways/);
      assert.equal(await inner.getAttribute('tabindex'), '0');
      await inner.focus();
      const start = await inner.evaluate((el) => el.scrollLeft);
      for (let i = 0; i < 4; i += 1) await h.page.keyboard.press('ArrowRight');
      await until(async () => (await inner.evaluate((el) => el.scrollLeft)) > start);
      assert.ok((await inner.evaluate((el) => el.scrollLeft)) > start, 'the arrows did not scroll');
    } finally {
      await h.close();
    }
  });

  void test('at 1440 nothing is hidden, so there is no hint and no extra tab stop', async () => {
    const h = await open('/organisation?tab=people', OWNER(), {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    });
    try {
      await ready(h);
      const region = h.page.locator('[data-scroll-region]').first();
      await h.page.waitForTimeout(300);
      assert.equal(await region.getAttribute('data-overflow'), 'false');
      assert.equal(await region.locator('[data-scroll-hint]').count(), 0);
      assert.equal(await region.locator('[role="region"]').getAttribute('tabindex'), null);
    } finally {
      await h.close();
    }
  });
});
