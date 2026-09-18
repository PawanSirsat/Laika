/**
 * Org settings and role management render and act (LAI-459).
 *
 * ## Why this is a browser test and not a source grep
 *
 * The screen this replaces was guarded by reading its own source for the
 * *absence* of a `<select>`. That guard was honest about what it could see and
 * it could not see much: it went red for the change that satisfied its own
 * task, which is the LAI-158 shape, and it could never have caught the three
 * things that actually go wrong here.
 *
 * - **A control offered to somebody the server will refuse.** §3.1's
 *   *"(not to Owner)"* caveat is a rule about the *option list*, and no
 *   assertion about the file can tell you which options a browser rendered.
 * - **An `ai` key that is `null` rather than absent.** The server gates that
 *   field on `org.settings.edit` by omitting it; a client that asks
 *   `org.ai === null` renders "no provider configured" to a Viewer, which is a
 *   statement about the org that the reader was specifically not told.
 * - **A refusal shown as something other than the server's sentence.** The
 *   last-owner invariant is a `409` whose message is the whole product: a
 *   client that swallows it and prints "Something went wrong" has lost the one
 *   instruction that gets the person unstuck.
 *
 * So each test drives the real built SPA and reads what a person would see.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, type ApiStub, type StubCall } from './harness.ts';

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
  user('u3', 'Priya Raman', 'admin'),
  user('u4', 'Sam Okafor', 'viewer', false),
];

const ORG = {
  id: 'o1',
  name: 'Kvelld Dynamics',
  presence_enabled: true,
  created_at: 1,
  updated_at: 2,
  ai: { configured: true, provider: 'anthropic', key_last4: '9f2a' },
};

/** Everything but `/me`, which is what each test varies. */
const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': ORG,
};

const me = (id: string, org_role: string) => ({
  ...user(id, PEOPLE.find((p) => p.id === id)?.name ?? 'Someone', org_role),
  memberships: [],
});

void after(async () => {
  await closeBrowser();
});

void describe('the org itself', () => {
  void test('its name and settings come from GET /org, and the key never does', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const card = h.page.locator('.org-card').first();
      await card.locator('#org-name').waitFor({ timeout: 20_000 });

      const text = await card.innerText();
      assert.match(text, /Kvelld Dynamics/, 'the org name is not rendered');
      assert.match(text, /anthropic/i, 'the AI provider is not rendered');
      assert.match(text, /9f2a/, 'the key tail is not rendered');
      assert.match(text, /recorded/i, 'presence state is not rendered');

      // It came from `/org`, not from a literal and not from `/me`.
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/org' && c.method === 'GET'),
        'the screen never called GET /org',
      );
    } finally {
      await h.close();
    }
  });

  /**
   * **Absent, not null.** A Viewer's `/org` response carries no `ai` key at all,
   * and the failure this guards against is the screen rendering "AI provider —
   * none", which tells them something the gate exists to withhold.
   */
  void test('a reader without org.settings.edit is shown no AI row, not an empty one', async () => {
    const withheld = { ...ORG };
    // @ts-expect-error — the point of the fixture is the key's absence.
    delete withheld.ai;

    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/me': me('u2', 'viewer'),
      '/api/v1/org': withheld,
    });
    try {
      const card = h.page.locator('.org-card').first();
      await card.locator('#org-name').waitFor({ timeout: 20_000 });

      const text = await card.innerText();
      assert.match(text, /Kvelld Dynamics/, 'the org is missing entirely');
      assert.doesNotMatch(text, /AI provider/i, 'told a viewer about the AI settings');
      assert.doesNotMatch(text, /none/i, 'told a viewer there is no provider');
      assert.doesNotMatch(text, /undefined|null/i, 'leaked a placeholder');
    } finally {
      await h.close();
    }
  });
});

/**
 * Two defects a screenshot caught and every assertion above passed.
 *
 * Both are the shape that source tests are structurally blind to: the markup
 * and the class names were right, and what the browser *did* with them was not.
 */
void describe('what it actually looks like', () => {
  void test('the provider and its key tail share a line', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const ai = h.page.locator('.org-ai');
      await ai.waitFor({ timeout: 20_000 });
      const key = ai.locator('.org-key');

      const [outer, tail] = await Promise.all([ai.boundingBox(), key.boundingBox()]);
      assert.ok(outer && tail, 'one of them has no box');

      // A comparison, not a pixel: the tail belongs on the provider's line, and
      // `dd { flex-direction: column }` put it on its own row underneath where
      // it read as a second, separate fact.
      assert.ok(
        tail.y + tail.height / 2 > outer.y && tail.y + tail.height / 2 < outer.y + outer.height,
        'the key tail is not on the provider line',
      );
      assert.ok(
        outer.height < tail.height * 2,
        `the provider block is ${String(Math.round(outer.height))}px tall — the tail wrapped`,
      );
    } finally {
      await h.close();
    }
  });

  /**
   * A deactivated row is dimmed, and `Reactivate` is the one control on it that
   * is somebody's way back. At the row's 0.55 it read as greyed-out — which is
   * exactly the "present-and-disabled" confusion the tests above exist to rule
   * out, arriving through CSS rather than through a `disabled` attribute.
   */
  void test('the deactivated row is dimmed and its Reactivate button is not', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-reactivate').first().waitFor({ timeout: 20_000 });
      const row = h.page.locator('.org-person', { hasText: 'Sam Okafor' });

      /** Opacity nests and multiplies, so the answer is the whole chain. */
      const effective = (selector: string) =>
        row.locator(selector).evaluate((el: Element) => {
          let value = 1;
          for (let node: Element | null = el; node !== null; node = node.parentElement) {
            value *= Number(getComputedStyle(node).opacity);
          }
          return value;
        });

      const name = await effective('.org-person-name');
      const button = await effective('.org-reactivate');

      assert.ok(name < 0.9, `the deactivated person is not dimmed (${String(name)})`);
      assert.ok(
        button > 0.99,
        `Reactivate is dimmed to ${String(button)} — it reads as a disabled control`,
      );
      // …and it really is clickable, not merely bright.
      assert.equal(await row.locator('.org-reactivate').isEnabled(), true);
    } finally {
      await h.close();
    }
  });
});

void describe('role management', () => {
  void test('a member gets no controls at all — absent, not disabled', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u2', 'member') });
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.org-person').count(), 4);

      // Absent is the claim, so `disabled` is asserted separately: a disabled
      // control still says "this exists and is yours", which is the untrue part.
      assert.equal(
        await h.page.locator('.org-person select').count(),
        0,
        'a member is offered a role dropdown',
      );
      // **Deliberately every button, not just the deactivate one.** A member
      // gets no controls at all, and this is the assertion that catches a new
      // control arriving on the row without a gate. LAI-238's `Tokens` toggle
      // is exactly that shape — which is why the *specific* locators elsewhere
      // in this file were narrowed and this one was not.
      assert.equal(
        await h.page.locator('.org-person button').count(),
        0,
        'a member is offered a button on a person row',
      );
      assert.equal(
        await h.page.locator('.org-person [disabled]').count(),
        0,
        'the controls are present-and-disabled rather than absent',
      );
    } finally {
      await h.close();
    }
  });

  void test('an owner may grant Owner; an admin may not, and it is missing not greyed', async () => {
    for (const [role, expected] of [
      ['owner', true],
      ['admin', false],
    ] as const) {
      const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u3', role) });
      try {
        await h.page.locator('.org-person select').first().waitFor({ timeout: 20_000 });

        // Tomas is a member, so no option is pinned by his own current role.
        const select = h.page.locator('.org-person', { hasText: 'Tomas Nel' }).locator('select');
        const options = await select.locator('option').allInnerTexts();

        assert.ok(options.includes('Member'), `${role}: Member is not offered`);
        assert.equal(
          options.includes('Owner'),
          expected,
          `${role}: Owner should ${expected ? '' : 'not '}be offered, saw ${options.join(', ')}`,
        );
        assert.equal(
          await select.locator('option[disabled]').count(),
          0,
          `${role}: an option is greyed rather than absent`,
        );
      } finally {
        await h.close();
      }
    }
  });

  /**
   * An Admin cannot *grant* Owner and can still be looking at one. A `<select>`
   * whose `value` matches none of its `<option>`s renders blank, so the row
   * would show an Owner as having no role at all.
   */
  void test("an admin sees an owner's actual role even though they cannot grant it", async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u3', 'admin') });
    try {
      await h.page.locator('.org-person select').first().waitFor({ timeout: 20_000 });
      const select = h.page.locator('.org-person', { hasText: 'Ada Lovelace' }).locator('select');
      assert.equal(await select.inputValue(), 'owner', "an owner's row shows no role");
      assert.ok(
        (await select.locator('option').allInnerTexts()).includes('Owner'),
        'the current role is not among the options, so the control renders blank',
      );
    } finally {
      await h.close();
    }
  });

  void test('your own row has no controls', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-person select').first().waitFor({ timeout: 20_000 });
      const mine = h.page.locator('.org-person', { hasText: 'Ada Lovelace' });
      assert.equal(await mine.locator('select').count(), 0, 'offered to change my own role');
      // Broad for the same reason: nothing on my own row, whatever it is.
      assert.equal(await mine.locator('button').count(), 0, 'offered a control on my own row');
      // …and the others still have theirs, or the assertion above is vacuous.
      assert.equal(await h.page.locator('.org-person select').count(), 3);
    } finally {
      await h.close();
    }
  });

  void test('changing a role PATCHes that person with that role', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-person select').first().waitFor({ timeout: 20_000 });
      const select = h.page.locator('.org-person', { hasText: 'Tomas Nel' }).locator('select');
      await select.selectOption('admin');

      await h.page.waitForFunction(
        () => document.querySelectorAll('.org-person').length === 4,
        undefined,
        { timeout: 20_000 },
      );
      await h.page.waitForTimeout(500);

      const patch = h.calls.find((c: StubCall) => c.method === 'PATCH');
      assert.ok(patch, `no PATCH was sent; saw ${h.calls.map((c) => c.method).join(', ')}`);
      assert.equal(patch.path, '/api/v1/users/u2', 'patched the wrong person');
      assert.deepEqual(patch.body, { org_role: 'admin' });
    } finally {
      await h.close();
    }
  });
});

void describe('deactivation', () => {
  /**
   * **D-048 gave this two verbs**, and the screen has to say which one it is
   * doing. One button labelled "deactivate" that also reactivates would be the
   * UI equivalent of collapsing `user.deactivated` and `user.reactivated` into
   * one audit row — which the decision explicitly refused.
   */
  void test('an active person is deactivated and an inactive one reactivated', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-deactivate').first().waitFor({ timeout: 20_000 });

      const active = h.page
        .locator('.org-person', { hasText: 'Tomas Nel' })
        .locator('.org-deactivate');
      assert.match(await active.innerText(), /^Deactivate$/i, 'wrong verb for an active person');

      const inactive = h.page
        .locator('.org-person', { hasText: 'Sam Okafor' })
        .locator('.org-reactivate');
      assert.match(await inactive.innerText(), /^Reactivate$/i, 'wrong verb for an inactive one');

      // Reactivation asks nothing — it takes nobody's access away.
      await inactive.click();
      await h.page.waitForTimeout(500);
      const patch = h.calls.find((c: StubCall) => c.method === 'PATCH');
      assert.ok(patch, 'reactivating sent no PATCH');
      assert.equal(patch.path, '/api/v1/users/u4');
      assert.deepEqual(patch.body, { is_active: true });
    } finally {
      await h.close();
    }
  });

  void test('deactivating asks first, and says it is not deletion', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-deactivate').first().waitFor({ timeout: 20_000 });

      let asked = '';
      h.page.on('dialog', (d) => {
        asked = d.message();
        void d.dismiss();
      });

      await h.page
        .locator('.org-person', { hasText: 'Tomas Nel' })
        .locator('.org-deactivate')
        .click();
      await h.page.waitForTimeout(500);

      assert.match(asked, /Tomas Nel/, 'the confirmation does not name who');
      assert.match(asked, /not deletion/i, 'does not say the row and history are kept');
      assert.equal(
        h.calls.filter((c: StubCall) => c.method === 'PATCH').length,
        0,
        'dismissing the confirmation still sent the PATCH',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the directory includes people who left (LAI-240)', () => {
  /**
   * **Asserted on the request URL, not on the rendered list.**
   *
   * `harness.ts` matches stubs on **path alone** — *"a query string is the
   * client's business rather than the fixture's"* — so a fixture containing
   * Sam answers whether or not the client asked for inactive people. That is
   * exactly how this defect survived a test that claimed to cover it: the
   * assertion was structurally blind to the thing it asserted, and the bug was
   * found by running a real instance instead.
   *
   * Until LAI-241 teaches the harness about query strings, `page.on('request')`
   * is the instrument that can actually see it.
   */
  void test('the Organisation screen asks for inactive people', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      const urls: string[] = [];
      h.page.on('request', (r) => {
        if (r.url().includes('/api/v1/users')) urls.push(r.url());
      });

      await h.page.reload();
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });

      assert.ok(urls.length > 0, 'the screen never requested /users at all');
      for (const url of urls) {
        assert.match(url, /include_inactive=true/, `a directory request omitted the flag: ${url}`);
      }
    } finally {
      await h.close();
    }
  });

  /**
   * **Two screens disagreeing about how many people exist is the symptom a
   * user actually reports** — Capacity said 5 and Organisation said 4 on the
   * same database, in the same session. Neither number was obviously wrong on
   * its own, which is why the assertion is the comparison.
   */
  void test('Capacity and Organisation agree on how many people there are', async () => {
    const stub: ApiStub = {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/presence': { enabled: true, present: [] },
      '/api/v1/capacity': {
        enabled: true,
        people: PEOPLE.map((p) => ({
          user_id: p.id,
          name: p.name,
          active_sessions: 0,
          in_progress_tasks: [],
          oldest_in_progress_ms: null,
          tasks_in_review: [],
          last_seen: null,
          unlisted: [],
        })),
      },
      '/api/v1/unlisted': { data: [], next_cursor: null },
    };

    const org = await open('/organisation', stub);
    let orgCount = 0;
    try {
      await org.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      orgCount = await org.page.locator('.org-person').count();
    } finally {
      await org.close();
    }

    const cap = await open('/capacity', stub);
    let capCount = 0;
    try {
      await cap.page.locator('.cap-person, .cap-row, [class*="cap-"]').first().waitFor({
        timeout: 20_000,
      });
      capCount = await cap.page.evaluate(() => {
        // The people list, however Capacity spells it — counted from the names
        // it renders rather than from a class this test would have to chase.
        const names = new Set<string>();
        document.querySelectorAll('[class*="cap-"]').forEach((el) => {
          const text = el.textContent ?? '';
          for (const n of ['Ada Lovelace', 'Tomas Nel', 'Priya Raman', 'Sam Okafor']) {
            if (text.includes(n)) names.add(n);
          }
        });
        return names.size;
      });
    } finally {
      await cap.close();
    }

    assert.equal(orgCount, PEOPLE.length, `Organisation shows ${String(orgCount)} of 4`);
    assert.equal(
      orgCount,
      capCount,
      `Organisation shows ${String(orgCount)} people and Capacity shows ${String(capCount)}`,
    );
  });
});

void describe('deactivation is not deletion', () => {
  /**
   * The row is the record that they were here. §4.1 keeps it so history keeps
   * its author, and a directory that quietly drops somebody makes every task
   * and comment they wrote unattributable.
   */
  void test('a deactivated person stays in the list, wearing the chip', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u2', 'member') });
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });

      const row = h.page.locator('.org-person', { hasText: 'Sam Okafor' });
      assert.equal(await row.count(), 1, 'the deactivated person was dropped from the list');
      assert.match(await row.innerText(), /Sam Okafor/);
      assert.match(await row.locator('.org-chip-off').innerText(), /DEACTIVATED/);

      // Only them — a chip on everybody says nothing.
      assert.equal(await h.page.locator('.org-chip-off').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('both themes', () => {
  void test('the org card and the controls render in light and dark', async () => {
    const h = await open('/organisation', { ...BASE, '/api/v1/me': me('u1', 'owner') });
    try {
      await h.page.locator('.org-person select').first().waitFor({ timeout: 20_000 });

      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        const card = h.page.locator('.org-card').first();
        const box = await card.boundingBox();
        assert.ok(box !== null && box.height > 0, `${theme}: the org card has no box`);
        assert.match(await card.innerText(), /Kvelld Dynamics/, `${theme}: the org name is gone`);

        // A colour, not a class name — the class is identical in both themes and
        // so tells you nothing about whether the theme reached the element.
        const ink = await card
          .locator('#org-name')
          .evaluate((el: Element) => getComputedStyle(el).color);
        const paper = await card.evaluate((el: Element) => getComputedStyle(el).backgroundColor);
        assert.ok(/^rgba?\(/.test(ink) && /^rgba?\(/.test(paper), `${theme}: unresolved colours`);
        assert.notEqual(ink, paper, `${theme}: the heading is the same colour as its card`);

        const button = h.page
          .locator('.org-person', { hasText: 'Tomas Nel' })
          .locator('.org-deactivate');
        const bbox = await button.boundingBox();
        assert.ok(bbox !== null && bbox.height > 0, `${theme}: the deactivate button has no box`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('a refusal', () => {
  /**
   * The sentence is the product. `assertAnOwnerRemains` answers `409` with
   * *"Promote somebody else to Owner first"* — the instruction that gets the
   * person unstuck — and a client that renders its own wording loses it.
   */
  void test("the server's own words are shown, not a rule the client invented", async () => {
    const MESSAGE =
      'This is the last active Owner. Promote somebody else to Owner first — an organisation with no Owner cannot be recovered.';

    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/me': me('u3', 'admin'),
      '/api/v1/users/u1': refuse(409, 'conflict', MESSAGE),
    });
    try {
      await h.page.locator('.org-person select').first().waitFor({ timeout: 20_000 });

      // The client did not pre-empt it: demoting the last owner is offered.
      const select = h.page.locator('.org-person', { hasText: 'Ada Lovelace' }).locator('select');
      await select.selectOption('member');

      const error = h.page.locator('.org-error');
      await error.waitFor({ timeout: 20_000 });
      assert.equal(await error.innerText(), MESSAGE, 'the refusal was reworded rather than shown');
    } finally {
      await h.close();
    }
  });
});
