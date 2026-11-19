/**
 * People from Microsoft's directory, in a real browser (D-161, LAI-1330): the
 * synced photo on every converged avatar, the job title, department and
 * manager under a name on Capacity and People, and Capacity's *My team*.
 *
 * `GET /people/directory` is stubbed with the people the sync has read; the
 * photos are small PNGs `people-photos.ts` makes, served by `page.route` the
 * way Laika serves them, at their `?v=`. `LAIKA_SHOTS=<dir>` also writes the screens'
 * screenshots there, in both themes at 1440 and 390.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { NOW, orgStub } from './capacity-org.ts';
import { pick } from './dropdown.ts';
import { closeBrowser, open, until, type ApiStub } from './harness.ts';
import { bothThemes, entry, photos, V } from './people-photos.ts';

/**
 * Capacity's people (`capacity-org.ts`): Pawan reads, and has no photo; Bea
 * reports to him. Cal, Dee and Eli have never signed in, so they fold into
 * one line rather than cards.
 */
const CAPACITY_DIRECTORY = {
  people: {
    u1: entry({ job_title: 'Founder', department: 'Leadership' }),
    u2: entry({
      photo_v: V,
      job_title: 'Senior engineer',
      department: 'Platform',
      manager_id: 'u1',
      manager_name: 'Pawan Sirsat',
    }),
    u3: entry({ job_title: 'Designer', department: 'Product' }),
    u4: entry({ photo_v: V, job_title: 'Engineer', department: 'Platform' }),
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('Capacity (D-161)', () => {
  const stub = (): ApiStub => ({
    ...orgStub('owner'),
    '/api/v1/people/directory': CAPACITY_DIRECTORY,
  });

  void test('photos on the cards, the facts under each name, and My team', async () => {
    const asked: string[] = [];
    const h = await open('/insights?tab=capacity', stub(), { before: photos(asked) });
    try {
      await h.page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });
      const bea = h.page.locator('.cap-grid > .cap-card', {
        has: h.page.locator('.cap-name', { hasText: 'Bea Nkosi' }),
      });
      await until(async () => (await bea.locator('img.avatar-img').count()) === 1);
      assert.equal(
        await bea.locator('img.avatar-img').getAttribute('src'),
        `/api/v1/users/u2/photo?v=${String(V)}`,
      );
      assert.equal(
        await bea.locator('[data-person-facts]').getAttribute('data-person-facts'),
        'Senior engineer · Platform · reports to Pawan Sirsat',
      );
      // No photo is initials, never a broken image — and nothing is asked for.
      const pawan = h.page.locator('.cap-grid > .cap-card', {
        has: h.page.locator('.cap-name', { hasText: 'Pawan Sirsat' }),
      });
      assert.equal(await pawan.locator('img').count(), 0);
      assert.equal((await pawan.locator('.cap-avatar').innerText()).trim(), 'PS');
      assert.equal(asked.includes('u1'), false, 'a photo asked for someone with none');

      // My team: the one whose manager is the reader.
      const people = h.page.getByRole('combobox', { name: 'People' });
      await pick(people, 'team');
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 1);
      const names = await h.page.locator('.cap-grid > .cap-card .cap-name').allInnerTexts();
      assert.deepEqual(
        names.map((n) => n.trim()),
        ['Bea Nkosi'],
      );
      assert.match(h.page.url(), /[?&]team=mine\b/);

      await pick(people, 'everyone');
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) > 1);
      await bothThemes(h, 'capacity', '.cap-grid > .cap-card');
    } finally {
      await h.close();
    }
  });

  void test('no My team for a reader nobody reports to', async () => {
    const h = await open('/insights?tab=capacity', {
      ...orgStub('owner'),
      '/api/v1/people/directory': { people: {} },
    });
    try {
      await h.page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('combobox', { name: 'People' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('People (D-161)', () => {
  const user = (id: string, name: string, org_role: string) => ({
    id,
    name,
    email: `${id}@example.com`,
    org_role,
    is_active: true,
    created_at: 1,
    updated_at: 1,
  });
  const PEOPLE = [
    user('u1', 'Ada Lovelace', 'owner'),
    user('u2', 'Tomas Nel', 'member'),
    user('u3', 'Priya Raman', 'admin'),
    user('u5', 'Bea Nkosi', 'member'),
  ];

  void test('a photo and the directory’s facts on each row', async () => {
    const asked: string[] = [];
    const h = await open(
      '/organisation?tab=people',
      {
        '/api/v1/projects': { data: [], next_cursor: null },
        '/api/v1/users': { data: PEOPLE, next_cursor: null },
        '/api/v1/invites': { data: [], next_cursor: null },
        '/api/v1/org': {
          id: 'o1',
          name: 'Kvelld Dynamics',
          presence_enabled: true,
          created_at: NOW - 60 * 86_400_000,
          updated_at: 2,
        },
        '/api/v1/capacity': { enabled: true, people: [] },
        '/api/v1/me': { ...PEOPLE[0], memberships: [] },
        '/api/v1/people/directory': {
          people: {
            u1: entry({ photo_v: V, job_title: 'Founder', department: 'Leadership' }),
            u2: entry({
              photo_v: V,
              job_title: 'Engineer',
              department: 'Platform',
              manager_id: 'u3',
              manager_name: 'Priya Raman',
            }),
            u3: entry({ photo_v: V, job_title: 'Head of engineering', department: 'Platform' }),
          },
        },
      },
      { before: photos(asked) },
    );
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      const tomas = h.page.locator('.org-person[data-person="u2"]');
      await until(async () => (await tomas.locator('img.avatar-img').count()) === 1);
      assert.equal(
        await tomas.locator('[data-person-facts]').getAttribute('data-person-facts'),
        'Engineer · Platform · reports to Priya Raman',
      );
      const bea = h.page.locator('.org-person[data-person="u5"]');
      assert.equal(await bea.locator('[data-person-facts]').count(), 0, 'nothing for no entry');
      assert.equal(await bea.locator('img').count(), 0);
      await bothThemes(h, 'people', '.org-person');
    } finally {
      await h.close();
    }
  });
});
