/**
 * Status rings on people (LAI-1349): whoever is online wears a green ring and
 * whoever is away an amber one — on the board toolbar's member faces, in the
 * members popover and in the Assignee picker — from the page's one read of
 * `GET /presence/people`, the same one the header's who's-here makes.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator } from 'playwright';
import { closeBrowser, open, type ApiStub } from './harness.ts';

void after(async () => {
  await closeBrowser();
});

const HOME = {
  id: '01P01',
  slug: 'space-01',
  prefix: 'S01',
  name: 'Space 01',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 6,
  members: [],
  last_activity_at: 2,
};

const MEMBERS = [
  ['u1', 'Ada Lovelace', 'lead'],
  ['u2', 'Grace Hopper', 'member'],
  ['u3', 'Tomas Nel', 'member'],
  ['u4', 'Priya Raman', 'member'],
  ['u5', 'Kenji Sato', 'member'],
  ['u6', 'Lena Fischer', 'member'],
] as const;

const seen = (user_id: string, name: string, status: 'online' | 'away') => ({
  user_id,
  name,
  status,
  last_seen: Date.now() - 60_000,
  last_seen_via: 'board',
});

/** Ada online, Grace away, Kenji (behind the +N) online; the rest not here. */
const HERE = {
  enabled: true,
  people: [
    seen('u1', 'Ada Lovelace', 'online'),
    seen('u5', 'Kenji Sato', 'online'),
    seen('u2', 'Grace Hopper', 'away'),
  ],
};

function stub(presence: unknown): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: HOME.id, role: 'lead' }],
    },
    '/api/v1/projects': { data: [HOME], next_cursor: null },
    [`/api/v1/projects/${HOME.slug}`]: HOME,
    [`/api/v1/projects/${HOME.slug}/tasks`]: { data: [], next_cursor: null },
    [`/api/v1/projects/${HOME.slug}/sprints`]: { data: [], next_cursor: null },
    [`/api/v1/projects/${HOME.slug}/members`]: {
      members: MEMBERS.map(([user_id, name, role]) => ({
        user_id,
        name,
        email: `${user_id}@example.com`,
        role,
        created_at: 1,
      })),
    },
    [`/api/v1/projects/${HOME.slug}/mentionable`]: { users: [] },
    [`/api/v1/projects/${HOME.slug}/activity`]: { data: [], next_cursor: null },
    [`/api/v1/projects/${HOME.slug}/tags`]: { tags: [] },
    [`/api/v1/projects/${HOME.slug}/meeting-reviews`]: { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o',
      name: 'Kvelld',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence/people': presence,
  };
}

/** The colour a token paints, read in the page's own theme. */
const tokenColour = (at: Locator, token: string) =>
  at.evaluate((_el, name) => {
    const probe = document.createElement('span');
    probe.style.borderColor = `var(${name})`;
    probe.style.borderStyle = 'solid';
    document.body.append(probe);
    const colour = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return colour;
  }, token);

const rings = (scope: Locator, selector: string) =>
  scope
    .locator(selector)
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('avatar-ring-online')
          ? 'online'
          : el.classList.contains('avatar-ring-away')
            ? 'away'
            : '',
      ),
    );

void describe('the board toolbar', () => {
  void test('the faces wear their status; one read serves the header and the board', async () => {
    const h = await open(`/board?project=${HOME.slug}`, stub(HERE));
    try {
      const ada = h.page.locator('button.bt-member').first();
      await h.page.locator('button.bt-member[data-ring]').first().waitFor({ timeout: 20_000 });
      const faces = await h.page
        .locator('button.bt-member')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-ring') ?? ''));
      // The stack draws the first four; Ada online, Grace away, Tomas and Priya not here.
      assert.deepEqual(faces, ['online', 'away', '', '']);
      assert.equal(
        await ada.evaluate((el) => getComputedStyle(el).borderTopColor),
        await tokenColour(ada, '--chip-green'),
      );
      const grace = h.page.locator('button.bt-member').nth(1);
      assert.equal(
        await grace.evaluate((el) => getComputedStyle(el).borderTopColor),
        await tokenColour(grace, '--chip-orange'),
      );

      // The header's stack is there too — and the two asked once between them.
      await h.page.locator('[data-header-here]').waitFor({ timeout: 10_000 });
      await h.page.waitForTimeout(800);
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/presence/people').length, 1);
    } finally {
      await h.close();
    }
  });

  void test('the members popover and the Assignee picker ring each face', async () => {
    const h = await open(`/board?project=${HOME.slug}`, stub(HERE));
    try {
      await h.page.locator('button.bt-member[data-ring]').first().waitFor({ timeout: 20_000 });
      await h.page.locator('button.bt-member-more').click();
      const pop = h.page.getByRole('dialog', { name: 'Members' });
      await pop.waitFor({ timeout: 5_000 });
      assert.deepEqual(await rings(pop, '.bt-mp-avatar'), ['online', 'away', '', '', 'online', '']);
      await h.page.keyboard.press('Escape');

      await h.page
        .getByRole('button', { name: /^Filter/ })
        .first()
        .click();
      await h.page.getByRole('combobox', { name: 'Assignee' }).first().click();
      const options = h.page.locator('[role="option"]');
      await options.filter({ hasText: 'Kenji Sato' }).waitFor({ timeout: 5_000 });
      const byName = await options.evaluateAll((els) =>
        els.map((el) => {
          const face = el.querySelector('.dd-avatar');
          const ring = face?.classList.contains('avatar-ring-online')
            ? 'online'
            : face?.classList.contains('avatar-ring-away')
              ? 'away'
              : '';
          return [(el.textContent ?? '').trim(), ring];
        }),
      );
      // A row says more than the name (its detail); find each by the name it holds.
      const ringOf = new Map(
        ['Ada Lovelace', 'Grace Hopper', 'Kenji Sato', 'Tomas Nel'].map((name) => [
          name,
          byName.find(([text]) => text?.includes(name))?.[1],
        ]),
      );
      assert.equal(ringOf.get('Ada Lovelace'), 'online');
      assert.equal(ringOf.get('Grace Hopper'), 'away');
      assert.equal(ringOf.get('Kenji Sato'), 'online');
      assert.equal(ringOf.get('Tomas Nel'), '');
    } finally {
      await h.close();
    }
  });

  void test('with presence off, no face wears a ring', async () => {
    const h = await open(
      `/board?project=${HOME.slug}`,
      stub({ enabled: false, people: HERE.people }),
    );
    try {
      await h.page.locator('button.bt-member').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(800);
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/presence/people'),
        'never asked',
      );
      assert.equal(await h.page.locator('button.bt-member[data-ring]').count(), 0);
      assert.equal(await h.page.locator('.avatar-ring').count(), 0);
    } finally {
      await h.close();
    }
  });
});
