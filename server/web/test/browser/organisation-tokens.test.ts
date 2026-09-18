/**
 * An admin can see and revoke somebody else's tokens (LAI-238).
 *
 * ## Why this one is worth a browser
 *
 * It is the task on its list with a security shape: until now, revoking a
 * departed colleague's agent tokens meant calling the API by hand. The failures
 * that matter are all things a source test cannot see.
 *
 * - **A revoke that never left the browser.** A confirmation dialog nobody
 *   answers, a handler wired to the wrong id — both look like success.
 * - **A `DELETE` sent to the wrong path.** The service refuses a token that does
 *   not belong to the user in the path, so an admin cannot revoke anybody's
 *   token through anybody's URL. Passing the owner's id is what keeps that
 *   check meaningful, and only the request itself shows which id was used.
 * - **The token value appearing.** It cannot — §4.9 stores a hash — but *"an
 *   admin should be able to see it"* is a sentence that sounds reasonable, and
 *   the assertion belongs where the rendered text is.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, type ApiStub, type StubCall } from './harness.ts';

/**
 * **The real clock, not a pinned constant.**
 *
 * `TokenRow` renders `lastUsedLabel(token.last_used_at, now)` where `now` is the
 * screen's `Date.now()`. A fixture at a fixed epoch therefore reads as *"used
 * 240 days ago"* and the assertion for *"Used 1h ago"* fails — which is how this
 * was found, and it is LAI-420's shelf-life bug exactly: a fixture pinned to an
 * absolute time while the thing under test asks the clock.
 *
 * Every timestamp below is an offset from this, so the file does not expire.
 */
const now = Date.now();

const user = (id: string, name: string, org_role: string, is_active = true) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  user('u1', 'Ada Lovelace', 'owner'),
  user('u2', 'Tomas Nel', 'member'),
  user('u4', 'Sam Okafor', 'viewer', false),
];

const token = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  prefix: `lai_${id}xy`,
  scope: 'full',
  project_ids: null,
  last_used_at: now - 3_600_000,
  expires_at: null,
  revoked_at: null,
  created_at: now - 86_400_000,
  ...extra,
});

/** The plaintext a token row must never carry. Not served by anything. */
const SECRET = 'lai_t1xy_ThisIsTheWholeSecretAndMustNeverRender';

const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Kvelld Dynamics',
    presence_enabled: true,
    created_at: 1,
    updated_at: 2,
  },
  '/api/v1/users/u2/tokens': {
    data: [
      token('t1', 'Laptop — Claude Code'),
      token('t2', 'CI runner', { scope: 'read_only', last_used_at: null }),
      token('t3', 'Old key', { revoked_at: now - 7_200_000 }),
    ],
    next_cursor: null,
  },
  '/api/v1/users/u4/tokens': { data: [], next_cursor: null },
};

const me = (id: string, org_role: string) => ({
  ...user(id, 'Ada Lovelace', org_role),
  memberships: [],
});

const openPanel = async (h: Awaited<ReturnType<typeof open>>, name: string) => {
  const row = h.page.locator('.org-person', { hasText: name });
  await row.locator('.org-tokens-toggle').waitFor({ timeout: 20_000 });
  await row.locator('.org-tokens-toggle').click();
  return row;
};

void after(async () => {
  await closeBrowser();
});

void describe('who is offered it', () => {
  void test('a member gets no Tokens control — absent, not disabled', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u2', 'member') });
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.org-tokens-toggle').count(), 0);
      assert.equal(await h.page.locator('.org-person [disabled]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('an admin gets one per person, except their own row', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-tokens-toggle').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.org-tokens-toggle').count(),
        2,
        'not one per other person',
      );

      const mine = h.page.locator('.org-person', { hasText: 'Ada Lovelace' });
      assert.equal(
        await mine.locator('.org-tokens-toggle').count(),
        0,
        'offered on my own row — my tokens are the Tokens screen',
      );
    } finally {
      await h.close();
    }
  });

  /**
   * A page of people would be `n` extra requests if every row loaded eagerly,
   * on a screen whose main job is the member list.
   */
  void test('nothing is fetched until a panel is opened', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-tokens-toggle').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);
      assert.equal(
        h.calls.filter((c: StubCall) => c.path.includes('/tokens')).length,
        0,
        'tokens were fetched for rows nobody opened',
      );

      await openPanel(h, 'Tomas Nel');
      await h.page.locator('.org-tokens .tok-row').first().waitFor({ timeout: 20_000 });

      const fetched = h.calls.filter((c: StubCall) => c.path.includes('/tokens'));
      assert.equal(fetched.length, 1, `fetched ${String(fetched.length)} times`);
      assert.equal(fetched[0]?.path, '/api/v1/users/u2/tokens');
    } finally {
      await h.close();
    }
  });
});

void describe('what the panel shows', () => {
  void test('the prefix, and never anything that could be the token', async () => {
    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      // A response carrying the secret anyway — the server never sends this, and
      // the row must not render it if something ever does.
      '/api/v1/users/u2/tokens': {
        data: [{ ...token('t1', 'Laptop — Claude Code'), secret: SECRET }],
        next_cursor: null,
      },
    });
    try {
      const row = await openPanel(h, 'Tomas Nel');
      await row.locator('.tok-row').first().waitFor({ timeout: 20_000 });

      const text = await row.locator('.org-tokens').innerText();
      assert.match(text, /Laptop — Claude Code/, 'the name is missing');
      assert.match(text, /lai_t1xy/, 'the prefix is missing');
      assert.match(text, /Used 1h ago/, 'last used is missing');
      assert.ok(!text.includes(SECRET), 'the token value was rendered');
      assert.doesNotMatch(text, /ThisIsTheWholeSecret/, 'part of the value was rendered');

      // …and the screen says why there is nothing more to see, on the screen.
      assert.match(text, /never shown/i, 'does not say the value cannot be shown');
      assert.match(text, /hash/i, 'does not say why');
    } finally {
      await h.close();
    }
  });

  void test('a revoked token stays listed and offers no Revoke', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const row = await openPanel(h, 'Tomas Nel');
      await row.locator('.tok-row').first().waitFor({ timeout: 20_000 });

      assert.equal(await row.locator('.tok-row').count(), 3, 'a token was dropped from the list');

      const revoked = row.locator('.tok-row', { hasText: 'Old key' });
      assert.equal(await revoked.locator('.tok-revoke').count(), 0, 'offers to revoke it again');
      assert.match(await revoked.innerText(), /Revoked/, 'does not say it is revoked');

      // The live ones still do, or the assertion above is vacuous.
      assert.equal(await row.locator('.tok-revoke').count(), 2);
    } finally {
      await h.close();
    }
  });

  void test('somebody with no tokens says so, rather than showing an empty box', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const row = await openPanel(h, 'Sam Okafor');
      await row.locator('.org-tokens-empty').waitFor({ timeout: 20_000 });
      assert.match(await row.locator('.org-tokens-empty').innerText(), /No tokens/);
    } finally {
      await h.close();
    }
  });

  /**
   * The row is dimmed for a deactivated person, and **the panel must not be** —
   * somebody having left is the whole reason to be looking at their tokens.
   */
  void test("a deactivated person's panel is not dimmed with their row", async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const row = await openPanel(h, 'Sam Okafor');
      await row.locator('.org-tokens').waitFor({ timeout: 20_000 });

      const effective = (selector: string) =>
        row.locator(selector).evaluate((el: Element) => {
          let value = 1;
          for (let node: Element | null = el; node !== null; node = node.parentElement) {
            value *= Number(getComputedStyle(node).opacity);
          }
          return value;
        });

      assert.ok((await effective('.org-person-name')) < 0.9, 'the person is not dimmed at all');
      assert.ok((await effective('.org-tokens')) > 0.99, 'the token panel is dimmed with the row');
    } finally {
      await h.close();
    }
  });
});

void describe('revoking', () => {
  void test('it asks first, and says what stops working', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const row = await openPanel(h, 'Tomas Nel');
      await row.locator('.tok-revoke').first().waitFor({ timeout: 20_000 });

      let asked = '';
      h.page.on('dialog', (d) => {
        asked = d.message();
        void d.dismiss();
      });

      await row
        .locator('.tok-row', { hasText: 'Laptop — Claude Code' })
        .locator('.tok-revoke')
        .click();
      await h.page.waitForTimeout(500);

      assert.match(asked, /Laptop — Claude Code/, 'does not name the token');
      assert.match(asked, /Tomas Nel/, 'does not name whose it is');
      assert.match(asked, /stops working/i, 'does not say what breaks');
      assert.equal(
        h.calls.filter((c: StubCall) => c.method === 'DELETE').length,
        0,
        'dismissing the confirmation still sent the DELETE',
      );
    } finally {
      await h.close();
    }
  });

  /**
   * **The owner's id is in the path, not just the token's.** Without it the
   * service's own cross-owner check has nothing to compare against, and an audit
   * row could name the wrong owner.
   */
  void test('confirming DELETEs the token under its owner, and reloads', async () => {
    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/tokens/t1': null,
    });
    try {
      const row = await openPanel(h, 'Tomas Nel');
      await row.locator('.tok-revoke').first().waitFor({ timeout: 20_000 });

      h.page.on('dialog', (d) => void d.accept());
      await row
        .locator('.tok-row', { hasText: 'Laptop — Claude Code' })
        .locator('.tok-revoke')
        .click();
      await h.page.waitForTimeout(700);

      const deleted = h.calls.find((c: StubCall) => c.method === 'DELETE');
      assert.ok(deleted, `no DELETE was sent; saw ${h.calls.map((c) => c.method).join(', ')}`);
      assert.equal(deleted.path, '/api/v1/users/u2/tokens/t1', 'wrong path — check the owner id');

      // The list is re-read, or the panel shows a token that is gone.
      const fetches = h.calls.filter(
        (c: StubCall) => c.method === 'GET' && c.path === '/api/v1/users/u2/tokens',
      );
      assert.equal(fetches.length, 2, 'the panel was not reloaded after revoking');
    } finally {
      await h.close();
    }
  });

  void test("a refusal is shown in the server's own words", async () => {
    const MESSAGE = 'No token with id "t1" for that user';
    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/tokens/t1': refuse(404, 'not_found', MESSAGE),
    });
    try {
      const row = await openPanel(h, 'Tomas Nel');
      await row.locator('.tok-revoke').first().waitFor({ timeout: 20_000 });

      h.page.on('dialog', (d) => void d.accept());
      await row
        .locator('.tok-row', { hasText: 'Laptop — Claude Code' })
        .locator('.tok-revoke')
        .click();

      const error = row.locator('.org-error');
      await error.waitFor({ timeout: 20_000 });
      assert.equal(await error.innerText(), MESSAGE, 'the refusal was reworded');
    } finally {
      await h.close();
    }
  });
});

void describe('both themes', () => {
  void test('the panel renders in light and dark', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const row = await openPanel(h, 'Tomas Nel');
      await row.locator('.tok-row').first().waitFor({ timeout: 20_000 });

      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        const panel = row.locator('.org-tokens');
        const box = await panel.boundingBox();
        assert.ok(box !== null && box.height > 0, `${theme}: the panel has no box`);

        // A computed colour, not a class — the class is identical in both.
        const button = row.locator('.tok-revoke').first();
        const ink = await button.evaluate((el: Element) => getComputedStyle(el).color);
        const paper = await button.evaluate((el: Element) => getComputedStyle(el).backgroundColor);
        assert.notEqual(ink, paper, `${theme}: Revoke is the same colour as its own background`);

        // **At three widths, not one.** The first version of this checked only
        // the default viewport and passed while the panel pushed 89px off the
        // page at 420px — `flex-basis: 100%` shrinks unless told not to, so the
        // panel rendered *beside* a squeezed name column instead of below it.
        // A single-width overflow check is the instrument not seeing the thing.
        for (const width of [1280, 760, 420]) {
          await h.page.setViewportSize({ width, height: 1000 });
          await h.page.waitForTimeout(250);
          const over = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.equal(over, 0, `${theme} at ${String(width)}px: the page scrolls sideways`);

          // Overflow zero is necessary and not sufficient: content can be
          // clipped rather than pushing. The panel must still be on its own
          // full-width line, below the controls rather than beside them.
          const panel = await row.locator('.org-tokens').boundingBox();
          const who = await row.locator('.org-person-who').boundingBox();
          assert.ok(panel && who, `${theme} at ${String(width)}px: a box is missing`);
          assert.ok(
            panel.y >= who.y + who.height,
            `${theme} at ${String(width)}px: the panel sits beside the name, not below it`,
          );
        }
        await h.page.setViewportSize({ width: 1280, height: 1000 });
      }
    } finally {
      await h.close();
    }
  });
});
