/**
 * The harness can be told to care about a query string (LAI-241).
 *
 * ## The hole this closes
 *
 * `harness.ts` matches stubs on **path alone**, and its own comment says why —
 * *"a query string is the client's business rather than the fixture's"* — which
 * is right for most tests. But it means a stub answers **whether or not the
 * client asked the right question**, so an assertion about a filtered list is
 * structurally blind to the filter.
 *
 * That is not hypothetical. LAI-459's *"a deactivated member stays visible"*
 * passed against a stub that returned the deactivated person whether or not
 * `?include_inactive=true` was sent — and the client never sent it. The defect
 * shipped, was accepted, and was found by running a real instance.
 *
 * ## This file tests the harness, not a screen
 *
 * `/organisation` is used only because it is a caller that sends a query. What
 * is being asserted throughout is **which stub the harness picked and why**.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const user = (id: string, name: string, is_active = true) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role: 'member',
  is_active,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [user('u1', 'Ada Lovelace'), user('u2', 'Sam Okafor', false)];

const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'An Org',
    presence_enabled: true,
    created_at: 1,
    updated_at: 2,
  },
  '/api/v1/me': { ...user('u1', 'Ada Lovelace'), org_role: 'owner', memberships: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('a stub may be keyed on its query', () => {
  void test('a request carrying the query is served by it', async () => {
    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/users?include_inactive=true': { data: PEOPLE, next_cursor: null },
    });
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.org-person').count(), 2);
      assert.deepEqual([...h.unmatched], [], 'a request went unmatched');
    } finally {
      await h.close();
    }
  });

  /**
   * **The assertion this whole task exists for.** With the query-keyed stub
   * demanding something the client does not send, the request must *not* be
   * served — and must not quietly fall through to a path-only stub either,
   * which would be the original defect with an extra step.
   */
  void test('a request missing the query is refused, and says what was asked', async () => {
    const h = await open('/organisation', {
      ...BASE,
      // The client sends `include_inactive=true`. This demands the opposite.
      '/api/v1/users?include_inactive=false': { data: PEOPLE, next_cursor: null },
    });
    try {
      await h.page.waitForFunction(() => document.body.innerText.length > 0, undefined, {
        timeout: 20_000,
      });
      await h.page.waitForTimeout(1200);

      assert.equal(
        await h.page.locator('.org-person').count(),
        0,
        'the mismatched stub answered anyway',
      );
      assert.equal(h.unmatched.length > 0, true, 'the mismatch was silent');
      assert.match(
        h.unmatched[0] ?? '',
        /include_inactive=true/,
        `the report does not name what was actually requested: ${h.unmatched[0] ?? '(none)'}`,
      );
    } finally {
      await h.close();
    }
  });

  /**
   * **Opt in, not opt out** — the harness comment is right for most tests, and
   * making every fixture query-exact would break dozens to fix a handful.
   */
  void test('a path-only stub still ignores the query, as it always did', async () => {
    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/users': { data: PEOPLE, next_cursor: null },
    });
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.org-person').count(), 2);
      assert.deepEqual([...h.unmatched], [], 'a path-only stub started caring about the query');
    } finally {
      await h.close();
    }
  });

  /**
   * A query-keyed stub names the parameters it cares about, not all of them.
   *
   * **This needs a request that genuinely carries an extra one**, or it proves
   * nothing. The first version of this test used a single-page response, so the
   * only parameter sent was the one the key named — exact and subset matching
   * are indistinguishable there, and a mutation turning subset into exact came
   * back **green**. The test was named for a property it did not exercise.
   *
   * Two pages fixes that: `listAllUsers` follows the cursor, so the second
   * request is `?cursor=c1&include_inactive=true` while the key still names only
   * `include_inactive`.
   */
  void test('matching is by subset, so unrelated parameters do not break it', async () => {
    let served = 0;
    const h = await open('/organisation', {
      ...BASE,
      '/api/v1/users?include_inactive=true': () => {
        served += 1;
        return served === 1
          ? { data: [PEOPLE[0]], next_cursor: 'c1' }
          : { data: [PEOPLE[1]], next_cursor: null };
      },
    });
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(600);

      assert.equal(served, 2, `the cursor was not followed — ${String(served)} request(s)`);
      assert.equal(
        await h.page.locator('.org-person').count(),
        2,
        'the second page did not reach the screen',
      );
      assert.deepEqual(
        [...h.unmatched],
        [],
        'the paged request was refused — matching is exact, not subset',
      );

      // The extra parameter really was there, or the subset claim is untested.
      const paged = h.calls.filter((c) => c.path === '/api/v1/users');
      assert.equal(paged.length, 2, 'expected two /users requests');
    } finally {
      await h.close();
    }
  });
});
